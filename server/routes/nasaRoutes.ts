import { Router } from 'express';
import jpeg from 'jpeg-js';
import { nasaProvider, type CustomDatasetIngestInput } from '../nasa/adapter.ts';
import {
  autoSetupAndFetchNasaProjection,
  buildGibsWmsUrl,
  buildGibsRawUrl,
  shiftIsoDate,
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

/**
 * Fraction (0..1) of sampled pixels that are visibly non-black. Used to detect
 * "no data" GIBS images, which come back as all-black JPEGs that are NOT small in bytes.
 */
function nonBlackFraction(buf: Buffer): number {
  try {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    const { data, width, height } = img;
    const step = Math.max(1, Math.floor(Math.sqrt((width * height) / 60_000)));
    let lit = 0;
    let total = 0;
    for (let y = 0; y < height; y += step) {
      for (let x = 0; x < width; x += step) {
        const i = (y * width + x) * 4;
        if (data[i] + data[i + 1] + data[i + 2] > 45) lit++;
        total++;
      }
    }
    return total ? lit / total : 0;
  } catch {
    return 1; // can't decode (unexpected format): assume usable rather than reject
  }
}

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
    const width = typeof req.query.width === 'string' ? Number(req.query.width) : 3072;
    const height = typeof req.query.height === 'string' ? Number(req.query.height) : 1536;
    const debug = req.query.debug === '1';

    // Vercel caps response bodies at ~4.5 MB, so stay safely below that.
    const MAX_BYTES = 4_000_000;
    // Below this share of non-black pixels we treat the image as "no data for this date".
    const MIN_LIT_FRACTION = 0.01;
    const deadline = Date.now() + 24_000;
    const log: Array<Record<string, unknown>> = [];

    const tryFetch = async (label: string, url: string) => {
      const remaining = deadline - Date.now();
      if (remaining < 1500) {
        log.push({ label, skipped: 'time budget exhausted' });
        return null;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.min(12_000, remaining));
      try {
        const upstream = await fetch(url, { signal: controller.signal });
        const type = upstream.headers.get('content-type') || '';
        if (!upstream.ok || !type.startsWith('image/')) {
          const text = type.startsWith('image/') ? '' : (await upstream.text()).slice(0, 200);
          log.push({ label, http: upstream.status, type, note: text });
          return null;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        const lit = nonBlackFraction(buf);
        log.push({ label, http: upstream.status, type, bytes: buf.length, litPixels: Number(lit.toFixed(4)) });
        return { type, buf, lit };
      } catch (err) {
        log.push({ label, error: err instanceof Error ? err.message : String(err) });
        return null;
      } finally {
        clearTimeout(timeoutId);
      }
    };

    type Candidate = { label: string; url: string; date: string };
    const candidates: Candidate[] = [];
    // 1) requested layer, requested date then up to 5 earlier days
    for (let back = 0; back <= 5; back++) {
      const d = back === 0 ? date : shiftIsoDate(date, -back);
      candidates.push({
        label: `${layer} ${d} ${width}px+base`,
        url: buildGibsWmsUrl(layer, d, width, height, true),
        date: d,
      });
    }
    // 2) lower-res / plain-layer retry for the requested date (covers size or underlay issues)
    candidates.push({
      label: `${layer} ${date} 2048px+base`,
      url: buildGibsWmsUrl(layer, date, 2048, 1024, true),
      date,
    });
    candidates.push({
      label: `${layer} ${date} 2048px plain`,
      url: buildGibsWmsUrl(layer, date, 2048, 1024, false),
      date,
    });
    // 3) Night lights: try the NOAA-20 sensor, then the static Black Marble composite
    if (layer === 'VIIRS_SNPP_DayNightBand_ENCC') {
      for (let back = 0; back <= 3; back++) {
        const d = back === 0 ? date : shiftIsoDate(date, -back);
        candidates.push({
          label: `NOAA20 night ${d}`,
          url: buildGibsRawUrl('VIIRS_NOAA20_DayNightBand_ENCC', d, 2048, 1024),
          date: d,
        });
      }
      candidates.push({
        label: 'Black Marble static',
        url: buildGibsRawUrl('VIIRS_Black_Marble', null, 3072, 1536),
        date: 'static-black-marble',
      });
    }

    let best: { type: string; buf: Buffer; date: string; lit: number } | null = null;
    let brightest: { type: string; buf: Buffer; date: string; lit: number } | null = null;
    for (const c of candidates) {
      const got = await tryFetch(c.label, c.url);
      if (!got) continue;
      if (got.buf.length > MAX_BYTES) {
        log.push({ label: c.label, note: 'too large, skipped' });
        continue;
      }
      const cand = { ...got, date: c.date };
      if (got.lit >= MIN_LIT_FRACTION) {
        best = cand;
        break;
      }
      if (!brightest || got.lit > brightest.lit) brightest = cand;
    }
    best = best ?? brightest;

    if (debug) {
      res.json({ layer, date, chosen: best ? { date: best.date, bytes: best.buf.length } : null, attempts: log });
      return;
    }
    if (!best) {
      res.status(502).json({ error: 'NASA GIBS did not return imagery for this layer/date. Try an earlier date.' });
      return;
    }

    res.setHeader('Content-Type', best.type);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('X-Gibs-Date', best.date);
    res.send(best.buf);
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

