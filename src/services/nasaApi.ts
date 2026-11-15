import type {
  BackendHealthStatus,
  IssTelemetryResponse,
  MissionDomain,
  NasaApiConnectResponse,
  NasaApiPreset,
  NasaDatasetRecord,
  NasaDatasetSummary,
  NasaDonkiResponse,
  NasaGibsLayer,
  NasaKeySetupResponse,
} from '../types/nasa';

export interface IngestPayloadRequest {
  title: string;
  mission?: string;
  instrument?: string;
  domain?: MissionDomain;
  primaryChannelName?: string;
  primaryUnit?: string;
  secondaryChannelName?: string;
  secondaryUnit?: string;
  cadenceLabel?: string;
  description?: string;
  values: number[];
  secondaryValues?: number[];
  baseFrequencyHz?: number;
}

export interface ConnectNasaApiRequest {
  url: string;
  title?: string;
  mission?: string;
  domain?: MissionDomain;
  channelName?: string;
  unit?: string;
  jsonPath?: string;
  secondaryJsonPath?: string;
}

export async function fetchBackendHealth(): Promise<BackendHealthStatus> {
  const res = await fetch('/api/health');
  if (!res.ok) {
    throw new Error(`Health check failed (${res.status})`);
  }
  return res.json();
}

export async function fetchDatasets(domain?: string): Promise<{
  sourceMode: string;
  count: number;
  datasets: NasaDatasetSummary[];
}> {
  const query = domain && domain !== 'All' ? `?domain=${encodeURIComponent(domain)}` : '';
  const res = await fetch(`/api/datasets${query}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch datasets (${res.status})`);
  }
  return res.json();
}

export async function fetchDatasetById(id: string): Promise<NasaDatasetRecord> {
  const res = await fetch(`/api/datasets/${encodeURIComponent(id)}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch dataset '${id}' (${res.status})`);
  }
  return res.json();
}

export async function ingestCustomDataset(
  payload: IngestPayloadRequest
): Promise<NasaDatasetRecord> {
  const res = await fetch('/api/datasets/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Ingest failed (${res.status})`);
  }
  return data;
}

export async function fetchNasaApiPresets(): Promise<{
  hasServerNasaApiKey: boolean;
  keySource?: 'user-key' | 'env' | 'demo-key';
  presets: NasaApiPreset[];
}> {
  const res = await fetch('/api/nasa/presets');
  if (!res.ok) {
    throw new Error(`Failed to load NASA API presets (${res.status})`);
  }
  return res.json();
}

export async function setupNasaApiKeyAndRun(options?: {
  apiKey?: string;
  presetId?: string;
}): Promise<NasaKeySetupResponse> {
  const res = await fetch('/api/nasa/setup-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options ?? {}),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `NASA key setup failed (${res.status})`);
  }
  return data;
}

export async function clearRuntimeNasaApiKey(): Promise<{
  keyStatus: { configured: boolean; source: 'user-key' | 'env' | 'demo-key' };
}> {
  const res = await fetch('/api/nasa/setup-key', { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`Failed to reset NASA API key (${res.status})`);
  }
  return res.json();
}

export async function connectNasaApiEndpoint(
  payload: ConnectNasaApiRequest
): Promise<NasaApiConnectResponse> {
  const res = await fetch('/api/nasa/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `NASA API connection failed (${res.status})`);
  }
  return data;
}

export async function fetchDonkiSpaceWeather(
  type: 'FLR' | 'GST' = 'FLR',
  register = true
): Promise<NasaDonkiResponse> {
  const res = await fetch(
    `/api/nasa/donki?type=${encodeURIComponent(type)}&register=${register ? 'true' : 'false'}`
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Failed to fetch DONKI ${type} (${res.status})`);
  }
  return data;
}

export async function fetchGibsLayers(): Promise<{
  defaultDate: string;
  layers: NasaGibsLayer[];
}> {
  const res = await fetch('/api/nasa/gibs/layers');
  if (!res.ok) {
    throw new Error(`Failed to fetch NASA GIBS layers (${res.status})`);
  }
  return res.json();
}

export function buildGibsImageProxyUrl(layer: string, date: string): string {
  return `/api/nasa/gibs/image?layer=${encodeURIComponent(layer)}&date=${encodeURIComponent(date)}`;
}

export async function fetchIntegrationBlueprint(): Promise<Record<string, unknown>> {
  const res = await fetch('/api/nasa/integration-blueprint');
  if (!res.ok) {
    throw new Error(`Failed to fetch blueprint (${res.status})`);
  }
  return res.json();
}

export async function fetchLiveIssTelemetry(): Promise<IssTelemetryResponse> {
  const res = await fetch('/api/nasa/iss');
  if (!res.ok) {
    throw new Error(`Failed to fetch ISS telemetry (${res.status})`);
  }
  return res.json();
}


