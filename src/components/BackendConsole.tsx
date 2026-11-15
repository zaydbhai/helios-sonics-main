import React, { useEffect, useState } from 'react';
import {
  clearRuntimeNasaApiKey,
  connectNasaApiEndpoint,
  fetchBackendHealth,
  fetchDatasetById,
  fetchDatasets,
  fetchDonkiSpaceWeather,
  fetchGibsLayers,
  fetchIntegrationBlueprint,
  fetchNasaApiPresets,
  ingestCustomDataset,
  setupNasaApiKeyAndRun,
} from '../services/nasaApi';
import type {
  BackendHealthStatus,
  MissionDomain,
  NasaApiPreset,
  NasaDatasetRecord,
  VisualizationMode,
} from '../types/nasa';
import {
  Play,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  KeyRound,
  Eye,
  EyeOff,
  ChevronDown,
  Link2,
} from 'lucide-react';

interface BackendConsoleProps {
  onDatasetIngested: (
    dataset: NasaDatasetRecord,
    launchOptions?: { autoPlay?: boolean; visMode?: VisualizationMode }
  ) => void;
}

const PROJECTION_OPTIONS: Array<{ id: VisualizationMode; label: string }> = [
  { id: 'orbital', label: 'Orbital' },
  { id: 'globe3d', label: 'Globe 3D' },
  { id: 'spectrogram', label: 'Waterfall' },
  { id: 'oscilloscope', label: 'Scope' },
];

const DOMAIN_OPTIONS: MissionDomain[] = [
  'Heliophysics',
  'Planetary Science',
  'Astrophysics',
  'Deep Space Plasma',
];

export function BackendConsole({ onDatasetIngested }: BackendConsoleProps) {
  const [health, setHealth] = useState<BackendHealthStatus | null>(null);
  const [blueprint, setBlueprint] = useState<Record<string, unknown> | null>(null);
  const [presets, setPresets] = useState<NasaApiPreset[]>([]);
  const [keySource, setKeySource] = useState<'user-key' | 'env' | 'demo-key'>('demo-key');

  // Simple 1-step NASA API Key Setup
  const [nasaKeyInput, setNasaKeyInput] = useState('');
  const [showNasaKey, setShowNasaKey] = useState(false);
  const [autoRunningKey, setAutoRunningKey] = useState(false);
  const [projectionMode, setProjectionMode] = useState<VisualizationMode>('globe3d');

  const [loadingHealth, setLoadingHealth] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);
  const [ingestStatus, setIngestStatus] = useState<string | null>(null);
  const [connectingPresetId, setConnectingPresetId] = useState<string | null>(null);

  // Advanced Developer Tools State
  const [apiResponseText, setApiResponseText] = useState<string>(
    'Click any endpoint test action or connect a live NASA API to inspect normalized JSON output.'
  );
  const [apiUrl, setApiUrl] = useState(
    'https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=-77.03&latitude=38.9&start=20250401&end=20250403&format=JSON'
  );
  const [apiTitle, setApiTitle] = useState('');
  const [apiMission, setApiMission] = useState('');
  const [apiDomain, setApiDomain] = useState<MissionDomain>('Planetary Science');
  const [apiChannelName, setApiChannelName] = useState('');
  const [apiUnit, setApiUnit] = useState('');
  const [apiJsonPath, setApiJsonPath] = useState('auto');
  const [apiSecondaryJsonPath, setApiSecondaryJsonPath] = useState('');
  const [connectingCustom, setConnectingCustom] = useState(false);

  const [title, setTitle] = useState('Solar Flare X-Ray Burst Test');
  const [mission, setMission] = useState('GOES-18 / NASA DONKI');
  const [channelName, setChannelName] = useState('Long-Wavelength X-Ray Flux');
  const [unit, setUnit] = useState('W/m²');
  const [valuesInput, setValuesInput] = useState(
    '1.2, 2.4, 5.8, 19.0, 48.5, 84.0, 62.3, 41.0, 25.4, 14.8, 8.2, 4.9, 3.1, 2.0, 1.5, 1.3'
  );
  const [ingesting, setIngesting] = useState(false);

  const loadConsoleData = async () => {
    setLoadingHealth(true);
    setTestError(null);
    try {
      const [h, bp, presetResp] = await Promise.all([
        fetchBackendHealth(),
        fetchIntegrationBlueprint(),
        fetchNasaApiPresets(),
      ]);
      setHealth(h);
      setBlueprint(bp);
      setPresets(presetResp.presets);
      setKeySource(presetResp.keySource ?? h.keySource ?? (h.hasNasaApiKey ? 'env' : 'demo-key'));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Backend unreachable');
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    void loadConsoleData();
  }, []);

  const handleOneClickKeyConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    setAutoRunningKey(true);
    setTestError(null);
    setIngestStatus(null);
    try {
      const res = await setupNasaApiKeyAndRun({
        apiKey: nasaKeyInput.trim() || undefined,
      });
      setKeySource(res.keyStatus.source);
      setNasaKeyInput('');
      setApiResponseText(JSON.stringify(res, null, 2));
      setIngestStatus(res.notice);
      await loadConsoleData();
      onDatasetIngested(res.dataset, { autoPlay: true, visMode: projectionMode });
    } catch (err) {
      setTestError(
        err instanceof Error ? err.message : 'Could not connect to NASA API with that key.'
      );
    } finally {
      setAutoRunningKey(false);
    }
  };

  const handleResetSessionKey = async () => {
    setTestError(null);
    try {
      const res = await clearRuntimeNasaApiKey();
      setKeySource(res.keyStatus.source);
      setNasaKeyInput('');
      setIngestStatus('Session NASA API key cleared.');
      await loadConsoleData();
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Failed to reset key');
    }
  };

  const handleRunPresetProjection = async (preset: NasaApiPreset) => {
    setConnectingPresetId(preset.id);
    setTestError(null);
    setIngestStatus(null);
    try {
      const res = await setupNasaApiKeyAndRun({
        apiKey: nasaKeyInput.trim() || undefined,
        presetId: preset.id,
      });
      setKeySource(res.keyStatus.source);
      if (nasaKeyInput.trim()) setNasaKeyInput('');
      setApiResponseText(JSON.stringify(res, null, 2));
      await loadConsoleData();
      onDatasetIngested(res.dataset, { autoPlay: true, visMode: projectionMode });
    } catch (err) {
      setTestError(
        err instanceof Error ? err.message : `Failed to run "${preset.title}"`
      );
    } finally {
      setConnectingPresetId(null);
    }
  };

  const handleConnectCustomApi = async (launchProjection: boolean) => {
    const trimmedUrl = apiUrl.trim();
    if (!trimmedUrl) {
      setTestError('Enter a valid NASA or NOAA HTTPS JSON endpoint URL.');
      return;
    }

    setConnectingCustom(true);
    setTestError(null);
    setIngestStatus(null);
    try {
      const res = await connectNasaApiEndpoint({
        url: trimmedUrl,
        title: apiTitle.trim() || undefined,
        mission: apiMission.trim() || undefined,
        domain: apiDomain,
        channelName: apiChannelName.trim() || undefined,
        unit: apiUnit.trim() || undefined,
        jsonPath: apiJsonPath.trim() || 'auto',
        secondaryJsonPath: apiSecondaryJsonPath.trim() || undefined,
      });

      setApiResponseText(JSON.stringify(res, null, 2));
      setIngestStatus(
        `Connected ${res.upstreamHost} (${res.extractedCount} points via "${res.jsonPathUsed}").`
      );
      await loadConsoleData();

      if (launchProjection) {
        onDatasetIngested(res.dataset, { autoPlay: true, visMode: projectionMode });
      }
    } catch (err) {
      setTestError(
        err instanceof Error ? err.message : 'Unable to fetch NASA endpoint'
      );
    } finally {
      setConnectingCustom(false);
    }
  };

  const runEndpointTest = async (path: string) => {
    setTestError(null);
    try {
      let data: unknown;
      if (path === '/api/health') {
        data = await fetchBackendHealth();
      } else if (path === '/api/datasets') {
        data = await fetchDatasets();
      } else if (path === '/api/datasets/:id') {
        data = await fetchDatasetById('voyager-1-pws');
      } else if (path === '/api/nasa/presets') {
        data = await fetchNasaApiPresets();
      } else if (path === '/api/nasa/donki') {
        data = await fetchDonkiSpaceWeather('FLR', false);
      } else if (path === '/api/nasa/gibs/layers') {
        data = await fetchGibsLayers();
      } else if (path === '/api/nasa/gibs/image') {
        const res = await fetch('/api/nasa/gibs/image');
        data = {
          status: res.status,
          contentType: res.headers.get('content-type'),
          bytes: (await res.arrayBuffer()).byteLength,
          note: 'Binary JPEG stream ready for <canvas> ROI pixel analysis and Three.js Globe texture.',
        };
      } else {
        data = await fetchIntegrationBlueprint();
      }
      setApiResponseText(JSON.stringify(data, null, 2));
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Endpoint request failed');
    }
  };

  const handleIngestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIngestStatus(null);
    setTestError(null);

    const parsed = valuesInput
      .split(/[\s,;\n]+/)
      .map((s) => Number(s.trim()))
      .filter((n) => !Number.isNaN(n));

    if (parsed.length < 4) {
      setTestError('Please provide at least 4 comma-separated numeric samples.');
      return;
    }

    setIngesting(true);
    try {
      const created = await ingestCustomDataset({
        title,
        mission,
        primaryChannelName: channelName,
        primaryUnit: unit,
        domain: 'Heliophysics',
        values: parsed,
      });
      setIngestStatus(
        `Ingested "${created.title}" (${created.sampleCount} samples) into backend catalog.`
      );
      setApiResponseText(JSON.stringify(created, null, 2));
      await loadConsoleData();
      onDatasetIngested(created, { autoPlay: true, visMode: projectionMode });
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Failed to ingest dataset');
    } finally {
      setIngesting(false);
    }
  };

  const isBusy = autoRunningKey || connectingPresetId !== null || connectingCustom;

  const keyStatusLabel =
    keySource === 'user-key'
      ? 'Your NASA API key active'
      : keySource === 'env'
      ? 'Built-in server key active'
      : 'Public DEMO_KEY mode';

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-slate-800 pb-6">
        <div>
          <div className="text-xs font-mono text-cyan-400">
            Live NASA Connection · Zero-Config Setup
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-100 tracking-tight">
            Connect Your NASA API Key &amp; Run Live Projections
          </h1>
          <p className="mt-1.5 text-sm text-slate-400 max-w-2xl">
            Paste your NASA API key below (or click any feed directly) to pull live space and Earth
            measurements, convert them to sound, and launch your projection automatically.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadConsoleData()}
          disabled={loadingHealth}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#111827] border border-slate-700 text-slate-200 hover:border-cyan-500/60 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loadingHealth ? 'animate-spin' : ''}`} />
          Refresh Status
        </button>
      </div>

      {testError && (
        <div
          role="alert"
          className="flex items-center gap-2.5 border border-rose-500/40 bg-rose-950/30 px-4 py-3 text-sm text-rose-200"
        >
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <span>{testError}</span>
        </div>
      )}

      {ingestStatus && (
        <div
          role="status"
          className="flex items-center gap-2.5 border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm text-emerald-200"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{ingestStatus}</span>
        </div>
      )}

      {/* Step 1: Dead-Simple NASA API Key Box */}
      <section className="bg-[#0B0F19] border border-slate-800 p-6 space-y-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-100">
              <KeyRound className="w-4 h-4 text-cyan-400" />
              <span>Step 1 — Paste Your NASA API Key</span>
            </h2>
            <p className="mt-1 text-xs text-slate-400 max-w-2xl">
              Get a free instant key at{' '}
              <span className="font-mono text-slate-200">api.nasa.gov</span>, paste it here, and
              press <strong className="text-slate-200 font-medium">Save Key &amp; Launch Live Projection</strong>.
              Leave it empty if you just want to run NASA&apos;s open public feeds right away.
            </p>
          </div>

          <div className="shrink-0">
            <div className="text-[11px] font-mono text-slate-400 mb-1.5">
              Projection View
            </div>
            <div className="inline-flex bg-[#07090E] border border-slate-800 p-1 gap-1">
              {PROJECTION_OPTIONS.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setProjectionMode(mode.id)}
                  className={`px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    projectionMode === mode.id
                      ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form onSubmit={handleOneClickKeyConnect} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <input
              type={showNasaKey ? 'text' : 'password'}
              value={nasaKeyInput}
              onChange={(e) => setNasaKeyInput(e.target.value)}
              placeholder="Paste your NASA API key here (optional — leave blank for public feeds)"
              aria-label="NASA API Key"
              autoComplete="off"
              className="w-full bg-[#07090E] border border-slate-700 pl-3.5 pr-10 py-2.5 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-cyan-500"
            />
            <button
              type="button"
              onClick={() => setShowNasaKey((v) => !v)}
              aria-label={showNasaKey ? 'Hide NASA API key' : 'Show NASA API key'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-200 cursor-pointer"
            >
              {showNasaKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={isBusy}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            {autoRunningKey
              ? 'Connecting & Starting...'
              : nasaKeyInput.trim()
              ? 'Save Key & Launch Live Projection'
              : 'Auto-Launch Public NASA Feed'}
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-xs text-slate-400">
          <div className="flex flex-wrap items-center gap-3 font-mono text-[11px]">
            <span className={health?.status === 'operational' ? 'text-emerald-400' : 'text-amber-400'}>
              {health ? `● ${health.status}` : 'Checking server...'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="text-slate-300">{keyStatusLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums text-slate-400">
              {health?.datasetCount ?? '—'} feeds loaded
            </span>
          </div>

          {keySource === 'user-key' && (
            <button
              type="button"
              onClick={() => void handleResetSessionKey()}
              className="text-xs text-slate-400 hover:text-rose-300 underline underline-offset-4 cursor-pointer whitespace-nowrap"
            >
              Clear Session Key
            </button>
          )}
        </div>
      </section>

      {/* Step 2: 1-Click Live NASA Feeds */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-100">
              Step 2 — Or Pick Any Live NASA Feed (1 Click)
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Every URL, field parser, and audio mapping is pre-configured—just press Run Projection.
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {presets.length} feeds
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {presets.map((preset) => {
            const isRunningThis = connectingPresetId === preset.id;
            return (
              <div
                key={preset.id}
                className="bg-[#0B0F19] border border-slate-800 p-5 flex flex-col justify-between gap-4"
              >
                <div>
                  <div className="text-sm font-semibold text-slate-100">
                    {preset.title}
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-cyan-400/90">
                    {preset.mission} · {preset.domain} · {preset.unit}
                  </div>
                  <p className="mt-2 text-xs text-slate-400 leading-relaxed">
                    {preset.description}
                  </p>
                </div>

                <div className="pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => void handleRunPresetProjection(preset)}
                    disabled={isBusy}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-[#111827] border border-cyan-500/60 text-cyan-300 hover:bg-cyan-500 hover:text-slate-950 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5" />
                    {isRunningThis ? 'Loading Live NASA Data...' : 'Run Projection'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Step 3: Collapsed Advanced Developer Tools */}
      <details className="bg-[#0B0F19] border border-slate-800 group">
        <summary className="px-5 py-4 flex items-center justify-between gap-4 cursor-pointer select-none text-sm font-medium text-slate-300 hover:text-white">
          <span>Advanced Developer Tools (Custom NASA URLs, REST Endpoints &amp; Adapter Schema)</span>
          <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180 shrink-0" />
        </summary>

        <div className="px-5 pb-6 pt-2 border-t border-slate-800 space-y-6">
          {/* Custom NASA HTTPS API Connector */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleConnectCustomApi(true);
            }}
            className="bg-[#07090E] border border-slate-800 p-5 space-y-4"
          >
            <div>
              <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-amber-400" />
                <span>Custom NASA / NOAA HTTPS Endpoint (POST /api/nasa/connect)</span>
              </h3>
              <p className="mt-1 text-xs text-slate-400">
                For custom endpoints on <code className="font-mono text-slate-300">*.nasa.gov</code> or{' '}
                <code className="font-mono text-slate-300">*.noaa.gov</code>. Leave JSON Path as{' '}
                <code className="font-mono text-slate-300">auto</code> to auto-discover numeric values.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
              <label className="block lg:col-span-8">
                <span className="text-[11px] text-slate-400">HTTPS Endpoint URL</span>
                <input
                  type="url"
                  required
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block lg:col-span-4">
                <span className="text-[11px] text-slate-400">Dataset Title (Optional)</span>
                <input
                  type="text"
                  value={apiTitle}
                  onChange={(e) => setApiTitle(e.target.value)}
                  placeholder="Auto-named from upstream host"
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block sm:col-span-6 lg:col-span-3">
                <span className="text-[11px] text-slate-400">JSON Path</span>
                <input
                  type="text"
                  value={apiJsonPath}
                  onChange={(e) => setApiJsonPath(e.target.value)}
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block sm:col-span-6 lg:col-span-3">
                <span className="text-[11px] text-slate-400">Secondary Path</span>
                <input
                  type="text"
                  value={apiSecondaryJsonPath}
                  onChange={(e) => setApiSecondaryJsonPath(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 font-mono text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block sm:col-span-6 lg:col-span-2">
                <span className="text-[11px] text-slate-400">Domain</span>
                <select
                  value={apiDomain}
                  onChange={(e) => setApiDomain(e.target.value as MissionDomain)}
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                >
                  {DOMAIN_OPTIONS.map((dom) => (
                    <option key={dom} value={dom}>
                      {dom}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block sm:col-span-6 lg:col-span-2">
                <span className="text-[11px] text-slate-400">Channel Label</span>
                <input
                  type="text"
                  value={apiChannelName}
                  onChange={(e) => setApiChannelName(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>

              <label className="block sm:col-span-6 lg:col-span-2">
                <span className="text-[11px] text-slate-400">Unit</span>
                <input
                  type="text"
                  value={apiUnit}
                  onChange={(e) => setApiUnit(e.target.value)}
                  placeholder="Optional"
                  className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={isBusy}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                <Play className="w-3.5 h-3.5" />
                {connectingCustom ? 'Connecting...' : 'Connect & Run Projection'}
              </button>

              <button
                type="button"
                onClick={() => void handleConnectCustomApi(false)}
                disabled={isBusy}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#111827] border border-slate-700 text-slate-200 hover:border-cyan-500/60 hover:text-white disabled:opacity-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                Test Extract Only
              </button>
            </div>
          </form>

          {/* REST Endpoints + Manual Array Ingest | Live JSON + Schema */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-[#07090E] border border-slate-800 p-4">
                <h3 className="text-xs font-semibold text-slate-100">
                  REST API Endpoints
                </h3>
                <div className="mt-3 divide-y divide-slate-800/80 border border-slate-800">
                  {(health?.endpoints ?? []).map((ep) => (
                    <div
                      key={ep.path}
                      className="flex items-center justify-between gap-3 px-3 py-2 bg-[#0B0F19]"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-mono text-xs">
                          <span
                            className={
                              ep.method === 'POST' ? 'text-amber-400' : 'text-cyan-400'
                            }
                          >
                            {ep.method}
                          </span>
                          <span className="text-slate-200 truncate">{ep.path}</span>
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-400 truncate">
                          {ep.purpose}
                        </div>
                      </div>
                      {ep.method === 'GET' && (
                        <button
                          type="button"
                          onClick={() => void runEndpointTest(ep.path)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-mono bg-[#111827] border border-slate-700 text-slate-200 hover:border-cyan-500 hover:text-cyan-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          <Play className="w-3 h-3" />
                          Test
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <form
                onSubmit={handleIngestSubmit}
                className="bg-[#07090E] border border-slate-800 p-4 space-y-3"
              >
                <h3 className="text-xs font-semibold text-slate-100">
                  Manual Numeric Array Ingest (POST /api/datasets/ingest)
                </h3>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Title</span>
                    <input
                      type="text"
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Source</span>
                    <input
                      type="text"
                      value={mission}
                      onChange={(e) => setMission(e.target.value)}
                      className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Channel</span>
                    <input
                      type="text"
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                      className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-slate-400">Unit</span>
                    <input
                      type="text"
                      value={unit}
                      onChange={(e) => setUnit(e.target.value)}
                      className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="text-[11px] text-slate-400">Numeric Values</span>
                  <textarea
                    rows={2}
                    value={valuesInput}
                    onChange={(e) => setValuesInput(e.target.value)}
                    className="mt-1 w-full bg-[#0B0F19] border border-slate-700 px-2.5 py-1.5 font-mono text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  />
                </label>

                <button
                  type="submit"
                  disabled={ingesting}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Send className="w-3.5 h-3.5" />
                  {ingesting ? 'Normalizing...' : 'Ingest & Run Projection'}
                </button>
              </form>
            </div>

            <div className="lg:col-span-7 space-y-6">
              <div className="bg-[#07090E] border border-slate-800 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold text-slate-100">
                    Live Backend JSON Response
                  </h3>
                  <span className="font-mono text-[11px] text-slate-400">
                    application/json
                  </span>
                </div>
                <pre className="bg-[#0B0F19] border border-slate-800 p-3 font-mono text-[11px] leading-relaxed text-cyan-200/90 overflow-auto max-h-[260px]">
                  {apiResponseText}
                </pre>
              </div>

              <div className="bg-[#07090E] border border-slate-800 p-4">
                <h3 className="text-xs font-semibold text-slate-100">
                  NASA Dataset Adapter &amp; Schema Contract
                </h3>
                <pre className="mt-2 bg-[#0B0F19] border border-slate-800 p-3 font-mono text-[11px] leading-relaxed text-slate-300 overflow-auto max-h-[240px]">
                  {blueprint ? JSON.stringify(blueprint, null, 2) : 'Loading integration blueprint...'}
                </pre>
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}
