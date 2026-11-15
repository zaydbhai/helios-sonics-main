import { Router } from 'express';
import { nasaProvider, type CustomDatasetIngestInput } from '../nasa/adapter.ts';
import {
  autoSetupAndFetchNasaProjection,
  buildGibsWmsUrl,
  connectCustomNasaApi,
  fetchDonkiSpaceWeatherDataset,
  fetchLiveIssTelemetry,
  getDefaultGibsDate,
  getNasaApiPresets,
  getNasaKeyStatus,
  setRuntimeNasaApiKey,
  SUPPORTED_GIBS_LAYERS,
  type ConnectNasaApiInput,
} from '../nasa/liveNasa.ts';

export const nasaRouter = Router();

nasaRouter.get('/health', async (_req, res) => {
  try {
    const datasets = await nasaProvider.listDatasets();
    const keyStatus = getNasaKeyStatus();
    res.json({
      status: 'operational',
      activeAdapter: nasaProvider.mode,
      hasNasaApiKey: keyStatus.configured,
      keySource: keyStatus.source,
      datasetCount: datasets.length,
      serverTimeUtc: new Date().toISOString(),
      endpoints: [
        { method: 'GET', path: '/api/health', purpose: 'Backend adapter & telemetry catalog health' },
        { method: 'GET', path: '/api/datasets', purpose: 'List available NASA test & ingested datasets' },
        { method: 'GET', path: '/api/datasets/:id', purpose: 'Fetch full normalized samples & sonification defaults' },
        { method: 'POST', path: '/api/datasets/ingest', purpose: 'Normalize and register a new NASA JSON/CSV telemetry array' },
        { method: 'GET', path: '/api/nasa/presets', purpose: 'List 1-click live NASA Open API preset endpoints' },
        { method: 'POST', path: '/api/nasa/setup-key', purpose: 'Save session NASA API key (optional) and auto-launch a live NASA projection' },
        { method: 'POST', path: '/api/nasa/connect', purpose: 'Fetch any NASA/NOAA HTTPS JSON endpoint, normalize series, and register for projection' },
        { method: 'GET', path: '/api/nasa/donki', purpose: 'Fetch live NASA DONKI / GOES-18 Solar Flares (FLR) & Kp Storms (GST)' },
        { method: 'GET', path: '/api/nasa/gibs/layers', purpose: 'List supported NASA GIBS / Worldview daily satellite imagery layers' },
        { method: 'GET', path: '/api/nasa/gibs/image', purpose: 'Same-origin proxy for daily NASA GIBS global equirectangular snapshots' },
        { method: 'GET', path: '/api/nasa/iss', purpose: 'Live ISS latitude, longitude, orbital track, and day/night terminator telemetry' },
        { method: 'GET', path: '/api/nasa/integration-blueprint', purpose: 'Contract & adapter guide for live NASA APIs' },
      ],
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to inspect backend health',
    });
  }
});

nasaRouter.get('/datasets', async (req, res) => {
  try {
    const domain = typeof req.query.domain === 'string' ? req.query.domain : undefined;
    const datasets = await nasaProvider.listDatasets(domain);
    res.json({
      sourceMode: nasaProvider.mode,
      count: datasets.length,
      datasets,
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to list datasets',
    });
  }
});

nasaRouter.get('/datasets/:id', async (req, res) => {
  try {
    const record = await nasaProvider.getDatasetById(req.params.id);
    if (!record) {
      res.status(404).json({ error: `Dataset '${req.params.id}' not found.` });
      return;
    }
    res.json(record);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to load dataset',
    });
  }
});

nasaRouter.post('/datasets/ingest', async (req, res) => {
  try {
    const body = req.body as Partial<CustomDatasetIngestInput> | undefined;
    if (!body || typeof body.title !== 'string' || !body.title.trim()) {
      res.status(400).json({ error: 'Request body must include a non-empty string "title".' });
      return;
    }

    if (!Array.isArray(body.values) || body.values.length < 4) {
      res.status(400).json({
        error: 'Request body must include "values" with at least 4 numeric samples.',
      });
      return;
    }

    const numericValues = body.values.map((v) => Number(v));
    if (numericValues.some((v) => !Number.isFinite(v))) {
      res.status(400).json({ error: 'All entries in "values" must be finite numbers.' });
      return;
    }

    const secondaryValues = Array.isArray(body.secondaryValues)
      ? body.secondaryValues.map((v) => Number(v))
      : undefined;

    const created = await nasaProvider.ingestDataset({
      ...body,
      title: body.title,
      values: numericValues,
      secondaryValues,
    });

    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Invalid ingest payload',
    });
  }
});

nasaRouter.get('/nasa/presets', (_req, res) => {
  const keyStatus = getNasaKeyStatus();
  res.json({
    hasServerNasaApiKey: keyStatus.configured,
    keySource: keyStatus.source,
    presets: getNasaApiPresets(),
  });
});

nasaRouter.post('/nasa/setup-key', async (req, res) => {
  try {
    const body = (req.body ?? {}) as {
      apiKey?: string;
      presetId?: string;
    };
    const result = await autoSetupAndFetchNasaProjection({
      apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
      presetId: typeof body.presetId === 'string' ? body.presetId : undefined,
    });
    await nasaProvider.registerDataset(result.dataset);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Unable to connect with that NASA API key',
    });
  }
});

nasaRouter.delete('/nasa/setup-key', (_req, res) => {
  const keyStatus = setRuntimeNasaApiKey(null);
  res.json({ keyStatus });
});

nasaRouter.post('/nasa/connect', async (req, res) => {
  try {
    const body = req.body as Partial<ConnectNasaApiInput> | undefined;
    if (!body || typeof body.url !== 'string' || !body.url.trim()) {
      res.status(400).json({ error: 'Request body must include an HTTPS NASA API "url".' });
      return;
    }
    const result = await connectCustomNasaApi({
      url: body.url,
      title: body.title,
      mission: body.mission,
      domain: body.domain,
      channelName: body.channelName,
      unit: body.unit,
      jsonPath: body.jsonPath,
      secondaryJsonPath: body.secondaryJsonPath,
    });
    await nasaProvider.registerDataset(result.dataset);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to connect NASA API endpoint',
    });
  }
});

nasaRouter.get('/nasa/donki', async (req, res) => {
  try {
    const rawType = typeof req.query.type === 'string' ? req.query.type.toUpperCase() : 'FLR';
    const feedType: 'FLR' | 'GST' = rawType === 'GST' ? 'GST' : 'FLR';
    const shouldRegister = req.query.register !== 'false';

    const result = await fetchDonkiSpaceWeatherDataset(feedType);
    if (shouldRegister) {
      await nasaProvider.registerDataset(result.dataset);
    }

    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch NASA DONKI feed',
    });
  }
});

nasaRouter.get('/nasa/gibs/layers', (_req, res) => {
  res.json({
    defaultDate: getDefaultGibsDate(2),
    layers: SUPPORTED_GIBS_LAYERS,
  });
});

nasaRouter.get('/nasa/gibs/image', async (req, res) => {
  try {
    const layer =
      typeof req.query.layer === 'string' && req.query.layer.trim()
        ? req.query.layer.trim()
        : SUPPORTED_GIBS_LAYERS[0].id;
    const date =
      typeof req.query.date === 'string' && req.query.date.trim()
        ? req.query.date.trim()
        : getDefaultGibsDate(2);
    const width = typeof req.query.width === 'string' ? Number(req.query.width) : 960;
    const height = typeof req.query.height === 'string' ? Number(req.query.height) : 480;

    const upstreamUrl = buildGibsWmsUrl(layer, date, width, height);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const upstream = await fetch(upstreamUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!upstream.ok) {
      res.status(502).json({ error: `NASA GIBS upstream returned HTTP ${upstream.status}` });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      res.status(502).json({ error: 'NASA GIBS did not return a valid satellite image.' });
      return;
    }

    const arrayBuffer = await upstream.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Failed to proxy NASA GIBS snapshot',
    });
  }
});

nasaRouter.get('/nasa/iss', async (_req, res) => {
  try {
    const data = await fetchLiveIssTelemetry();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch ISS telemetry',
    });
  }
});

nasaRouter.get('/nasa/integration-blueprint', (_req, res) => {
  res.json({
    architecture: 'Separate Express REST Adapter -> Normalized Telemetry Schema -> Web Audio Synth Frontend',
    adapterFile: 'server/nasa/adapter.ts',
    liveNasaFile: 'server/nasa/liveNasa.ts',
    routeFile: 'server/routes/nasaRoutes.ts',
    environmentVariables: {
      NASA_API_KEY: 'Set in AI Studio Secrets or .env for NASA Open APIs / DONKI / APOD / NEO',
      NASA_DATASET_SOURCE: '"test-catalog" (active fallback) or "live-nasa-api"',
    },
    activeLiveIntegrations: [
      {
        name: 'NASA DONKI (Space Weather FLR & GST)',
        endpoint: '/api/nasa/donki?type=FLR|GST',
        mapping: 'Maps GOES X-Ray Flare classes & Kp storm index into normalized [0..1] amplitude + spectralFlux.',
      },
      {
        name: 'NASA GIBS / Worldview Daily Satellite Proxy',
        endpoint: '/api/nasa/gibs/image?layer=MODIS_Terra_CorrectedReflectance_TrueColor&date=YYYY-MM-DD',
        mapping: 'Serves CORS-safe daily Plate Carree satellite imagery for <canvas> ROI luminance & Three.js Globe.',
      },
    ],
    sampleIngestPayload: {
      title: 'Solar Flare X-Ray Burst Test',
      mission: 'GOES-16 / DONKI',
      instrument: 'EXIS XRS-B',
      domain: 'Heliophysics',
      primaryChannelName: 'Long-Wavelength X-Ray Flux',
      primaryUnit: 'W/m²',
      values: [0.0000012, 0.0000045, 0.000019, 0.000084, 0.000042, 0.000015, 0.000006, 0.0000021],
    },
  });
});

