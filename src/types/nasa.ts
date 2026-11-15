export type MissionDomain =
  | 'Heliophysics'
  | 'Planetary Science'
  | 'Astrophysics'
  | 'Deep Space Plasma';

export interface TelemetrySample {
  /** Sample index or offset in seconds from epoch */
  t: number;
  /** ISO-8601 UTC timestamp for display */
  timestamp: string;
  /** Primary physical measurement (normalized 0..1 for audio synthesis + raw physical value) */
  primaryValue: number;
  /** Normalized intensity [0..1] mapped to oscillator gain & filter cutoff */
  normalized: number;
  /** Secondary channel value (e.g., magnetic Bz, vertical velocity, X-ray hardness) */
  secondaryValue: number;
  /** Normalized secondary channel [0..1] mapped to harmonic detune / stereo pan */
  secondaryNormalized: number;
  /** Tertiary spectral flux indicator [0..1] mapped to FM modulation index */
  spectralFlux: number;
}

export interface SonificationDefaults {
  baseFrequencyHz: number;
  harmonicSpread: number;
  filterCutoffHz: number;
  filterQ: number;
  waveform: OscillatorType;
  modulationDepth: number;
  recommendedScale: 'harmonic' | 'pentatonic' | 'microtonal' | 'chromatic';
}

export interface NasaDatasetSummary {
  id: string;
  title: string;
  mission: string;
  instrument: string;
  domain: MissionDomain;
  sourceType: 'test-catalog' | 'ingested-custom' | 'nasa-api-live';
  epochStart: string;
  epochEnd: string;
  cadenceLabel: string;
  primaryUnit: string;
  secondaryUnit: string;
  primaryChannelName: string;
  secondaryChannelName: string;
  sampleCount: number;
  description: string;
  accentColor: string;
}

export interface NasaDatasetRecord extends NasaDatasetSummary {
  sonification: SonificationDefaults;
  samples: TelemetrySample[];
  integrationNotes: {
    targetNasaArchive: string;
    expectedEndpoint: string;
    physicalCoordinateFrame: string;
  };
}

export type VisualizationMode = 'orbital' | 'spectrogram' | 'oscilloscope' | 'globe3d';

export type AudioInputSource = 'nasa-synth' | 'audio-file' | 'microphone';

export interface BackendHealthStatus {
  status: 'operational' | 'degraded';
  activeAdapter: 'test-catalog' | 'live-nasa-api';
  hasNasaApiKey: boolean;
  keySource?: 'user-key' | 'env' | 'demo-key';
  datasetCount: number;
  serverTimeUtc: string;
  endpoints: Array<{
    method: 'GET' | 'POST';
    path: string;
    purpose: string;
  }>;
}

export interface NasaGibsLayer {
  id: string;
  title: string;
  description: string;
  category: string;
  defaultDateOffsetDays: number;
}

export interface NasaDonkiResponse {
  source: 'nasa-donki-live' | 'fallback-solar-cycle';
  feedType: 'FLR' | 'GST';
  eventCount: number;
  windowStart: string;
  windowEnd: string;
  notice?: string;
  dataset: NasaDatasetRecord;
}

export interface NasaApiPreset {
  id: string;
  title: string;
  mission: string;
  domain: MissionDomain;
  url: string;
  jsonPath: string;
  secondaryJsonPath?: string;
  channelName: string;
  unit: string;
  description: string;
}

export interface NasaApiConnectResponse {
  upstreamHost: string;
  jsonPathUsed: string;
  extractedCount: number;
  dataset: NasaDatasetRecord;
}

export interface NasaKeySetupResponse {
  keyStatus: {
    configured: boolean;
    source: 'user-key' | 'env' | 'demo-key';
  };
  presetUsed: NasaApiPreset;
  dataset: NasaDatasetRecord;
  notice: string;
}

export interface IssTrackPoint {
  latitude: number;
  longitude: number;
  timestamp: number;
  visibility: 'daylight' | 'eclipsed';
}

export interface IssTelemetryResponse {
  source: 'wheretheiss-live' | 'kepler-fallback';
  name: string;
  id: number;
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKmh: number;
  visibility: 'daylight' | 'eclipsed';
  footprintKm: number;
  solarLat: number;
  solarLon: number;
  solarElevationDeg: number;
  daylightFactor: number;
  timestamp: string;
  track: IssTrackPoint[];
}


