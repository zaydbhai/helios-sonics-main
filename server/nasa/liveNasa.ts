import type {
  IssTelemetryResponse,
  IssTrackPoint,
  MissionDomain,
  NasaApiConnectResponse,
  NasaApiPreset,
  NasaDatasetRecord,
  NasaDonkiResponse,
  NasaGibsLayer,
} from '../../src/types/nasa.ts';
import { normalizeSeriesToSamples } from './adapter.ts';

export const SUPPORTED_GIBS_LAYERS: NasaGibsLayer[] = [
  {
    id: 'MODIS_Terra_CorrectedReflectance_TrueColor',
    title: 'MODIS Terra True Color',
    description: 'Daily global natural-color surface reflectance and cloud decks.',
    category: 'True Color Imagery',
    defaultDateOffsetDays: 2,
  },
  {
    id: 'MODIS_Terra_Aerosol',
    title: 'MODIS Aerosol Optical Depth',
    description: 'Atmospheric dust, smoke plumes, and aerosol concentration.',
    category: 'Atmospheric Chemistry',
    defaultDateOffsetDays: 2,
  },
  {
    id: 'GHRSST_L4_MUR_Sea_Surface_Temperature',
    title: 'MUR Sea Surface Temperature',
    description: 'High-resolution global ocean thermal surface map.',
    category: 'Ocean & Thermal',
    defaultDateOffsetDays: 3,
  },
  {
    id: 'VIIRS_SNPP_DayNightBand_ENCC',
    title: 'VIIRS Nighttime Lights & Clouds',
    description: 'Suomi NPP Day/Night band showing city lights, aurora, and moonlit clouds.',
    category: 'Day / Night Band',
    defaultDateOffsetDays: 2,
  },
];

const ALLOWED_GIBS_LAYER_IDS = new Set(SUPPORTED_GIBS_LAYERS.map((l) => l.id));

export function isValidIsoDate(dateStr: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`));
}

export function getDefaultGibsDate(offsetDays = 2): string {
  const target = new Date(Date.now() - offsetDays * 86_400_000);
  return target.toISOString().slice(0, 10);
}

const GIBS_BASE = 'BlueMarble_ShadedRelief_Bathymetry';

/**
 * Optional layers drawn underneath the data layer so no-data areas (swath gaps,
 * land under an ocean-only product) show terrain instead of flat black.
 * In WMS, the first listed layer is drawn first (bottom).
 */
const GIBS_UNDERLAYS: Record<string, string[]> = {
  MODIS_Terra_CorrectedReflectance_TrueColor: [GIBS_BASE, 'MODIS_Aqua_CorrectedReflectance_TrueColor'],
  MODIS_Terra_Aerosol: [GIBS_BASE],
  GHRSST_L4_MUR_Sea_Surface_Temperature: [GIBS_BASE],
};

export function buildGibsWmsUrl(
  layerId: string,
  dateStr: string,
  width = 3072,
  height = 1536,
  useUnderlays = true
): string {
  if (!ALLOWED_GIBS_LAYER_IDS.has(layerId)) {
    throw new Error(`Unsupported NASA GIBS layer '${layerId}'.`);
  }
  if (!isValidIsoDate(dateStr)) {
    throw new Error(`Invalid date '${dateStr}'. Expected YYYY-MM-DD.`);
  }
  const safeW = Math.min(4096, Math.max(256, Math.round(width)));
  const safeH = Math.min(2048, Math.max(128, Math.round(height)));
  const layers = [...(useUnderlays ? GIBS_UNDERLAYS[layerId] ?? [] : []), layerId];

  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layers.join(','),
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(safeW),
    HEIGHT: String(safeH),
    FORMAT: 'image/jpeg',
    TIME: dateStr,
  });

  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

/** Low-level WMS URL builder for internal fallback layers (no allow-list check). */
export function buildGibsRawUrl(
  layersCsv: string,
  dateStr: string | null,
  width: number,
  height: number
): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    REQUEST: 'GetMap',
    VERSION: '1.3.0',
    LAYERS: layersCsv,
    CRS: 'EPSG:4326',
    BBOX: '-90,-180,90,180',
    WIDTH: String(Math.min(4096, Math.max(256, Math.round(width)))),
    HEIGHT: String(Math.min(2048, Math.max(128, Math.round(height)))),
    FORMAT: 'image/jpeg',
  });
  if (dateStr) params.set('TIME', dateStr);
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}

export function shiftIsoDate(dateStr: string, deltaDays: number): string {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + deltaDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function parseGoesClassFlux(classType?: string): number {
  if (!classType || typeof classType !== 'string') return 1e-7;
  const trimmed = classType.trim().toUpperCase();
  const letter = trimmed[0];
  const magnitude = Number.parseFloat(trimmed.slice(1)) || 1.0;

  const baseMap: Record<string, number> = {
    A: 1e-8,
    B: 1e-7,
    C: 1e-6,
    M: 1e-5,
    X: 1e-4,
  };
  const base = baseMap[letter] ?? 1e-7;
  return base * magnitude;
}

interface DonkiFlareEvent {
  flrID?: string;
  beginTime?: string;
  peakTime?: string;
  classType?: string;
  sourceLocation?: string;
}

interface DonkiGstEvent {
  gstID?: string;
  startTime?: string;
  allKpIndex?: Array<{ kpIndex?: number; observedTime?: string }>;
}

let runtimeUserNasaApiKey: string | null = null;

export type NasaKeySource = 'user-key' | 'env' | 'demo-key';

export function getEffectiveNasaApiKey(): string {
  if (runtimeUserNasaApiKey) return runtimeUserNasaApiKey;
  const envKey = process.env.NASA_API_KEY?.trim();
  return envKey || 'DEMO_KEY';
}

export function getNasaKeyStatus(): {
  configured: boolean;
  source: NasaKeySource;
} {
  if (runtimeUserNasaApiKey) {
    return { configured: true, source: 'user-key' };
  }
  if (process.env.NASA_API_KEY?.trim()) {
    return { configured: true, source: 'env' };
  }
  return { configured: false, source: 'demo-key' };
}

export function setRuntimeNasaApiKey(key?: string | null): {
  configured: boolean;
  source: NasaKeySource;
} {
  const cleaned = typeof key === 'string' ? key.trim() : '';
  runtimeUserNasaApiKey = cleaned ? cleaned : null;
  return getNasaKeyStatus();
}

export async function fetchDonkiSpaceWeatherDataset(
  feedType: 'FLR' | 'GST' = 'FLR'
): Promise<NasaDonkiResponse> {
  const apiKey = getEffectiveNasaApiKey();
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const steps = 48;
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`);
  const spanMs = Math.max(1, endMs - startMs);

  const url = `https://api.nasa.gov/DONKI/${feedType}?startDate=${startDate}&endDate=${endDate}&api_key=${encodeURIComponent(
    apiKey
  )}`;

  let source: 'nasa-donki-live' | 'fallback-solar-cycle' = 'nasa-donki-live';
  let notice: string | undefined;
  let eventCount = 0;

  const primarySeries = new Array<number>(steps).fill(0);
  const secondarySeries = new Array<number>(steps).fill(0);
  let loadedFromDonki = false;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      const payload = (await response.json()) as unknown;
      const events = Array.isArray(payload) ? payload : [];
      eventCount = events.length;

      if (feedType === 'FLR') {
        primarySeries.fill(-6.8);
        secondarySeries.fill(0.1);

        for (const raw of events as DonkiFlareEvent[]) {
          const ts = Date.parse(raw.peakTime || raw.beginTime || '');
          if (Number.isNaN(ts)) continue;
          const bin = Math.min(
            steps - 1,
            Math.max(0, Math.floor(((ts - startMs) / spanMs) * (steps - 1)))
          );
          const flux = parseGoesClassFlux(raw.classType);
          const logFlux = Math.log10(Math.max(1e-8, flux));
          primarySeries[bin] = Math.max(primarySeries[bin], logFlux);
          secondarySeries[bin] += 1;
          if (bin + 1 < steps) {
            primarySeries[bin + 1] = Math.max(primarySeries[bin + 1], logFlux - 0.45);
          }
        }
      } else {
        primarySeries.fill(1.3);
        secondarySeries.fill(0.2);

        for (const raw of events as DonkiGstEvent[]) {
          const kpEntries = Array.isArray(raw.allKpIndex) ? raw.allKpIndex : [];
          for (const entry of kpEntries) {
            const ts = Date.parse(entry.observedTime || raw.startTime || '');
            const kp = Number(entry.kpIndex);
            if (Number.isNaN(ts) || !Number.isFinite(kp)) continue;
            const bin = Math.min(
              steps - 1,
              Math.max(0, Math.floor(((ts - startMs) / spanMs) * (steps - 1)))
            );
            primarySeries[bin] = Math.max(primarySeries[bin], kp);
            secondarySeries[bin] = Math.max(secondarySeries[bin], kp >= 5 ? kp - 4 : 0.25);
          }
        }
      }
      loadedFromDonki = true;
    }
  } catch {
    // Fall through to live NOAA/NASA GOES-18 & Kp satellite feed
  }

  if (!loadedFromDonki) {
    try {
      const swpcUrl =
        feedType === 'FLR'
          ? 'https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json'
          : 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const swpcRes = await fetch(swpcUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!swpcRes.ok) {
        throw new Error(`SWPC HTTP ${swpcRes.status}`);
      }

      const swpcData = (await swpcRes.json()) as Array<Record<string, unknown>>;
      if (feedType === 'FLR') {
        const longBand = swpcData.filter(
          (row) => row.energy === '0.1-0.8nm' && Number.isFinite(Number(row.flux))
        );
        const stepSize = Math.max(1, Math.floor(longBand.length / steps));
        for (let i = 0; i < steps; i++) {
          const row = longBand[Math.min(longBand.length - 1, i * stepSize)];
          const flux = Math.max(1e-8, Number(row?.flux || 1e-7));
          const obsFlux = Math.max(1e-8, Number(row?.observed_flux || flux));
          primarySeries[i] = Number(Math.log10(flux).toFixed(3));
          secondarySeries[i] = Number(Math.log10(obsFlux).toFixed(3));
        }
        eventCount = longBand.length;
        notice = `Live NASA/NOAA GOES-18 X-Ray feed (${eventCount} real-time telemetry points; api.nasa.gov DONKI gateway fallback active).`;
      } else {
        const kpRows = swpcData.filter((row) => Number.isFinite(Number(row.Kp ?? row[1])));
        const slice = kpRows.slice(-steps);
        for (let i = 0; i < steps; i++) {
          const row = slice[Math.min(slice.length - 1, Math.floor((i / steps) * slice.length))];
          const kp = Number(row?.Kp ?? row?.[1] ?? 1.5);
          const aRun = Number(row?.a_running ?? kp * 4);
          primarySeries[i] = Number(kp.toFixed(2));
          secondarySeries[i] = Number(aRun.toFixed(2));
        }
        eventCount = kpRows.length;
        notice = `Live NOAA/NASA Planetary Kp Geomagnetic feed (${eventCount} real-time readings).`;
      }
      source = 'nasa-donki-live';
      loadedFromDonki = true;
    } catch (err) {
      source = 'fallback-solar-cycle';
      notice = `Using calibrated space-weather baseline (${
        err instanceof Error ? err.message : 'network unavailable'
      }).`;

      for (let i = 0; i < steps; i++) {
        if (feedType === 'FLR') {
          const spike = i === 14 ? 2.1 : i === 29 ? 2.8 : i === 30 ? 1.9 : 0;
          primarySeries[i] = Number((-6.7 + Math.sin(i * 0.35) * 0.25 + spike).toFixed(3));
          secondarySeries[i] = spike > 0 ? Math.round(spike) : 0;
        } else {
          const storm = i >= 18 && i <= 24 ? 5.6 - Math.abs(i - 21) * 0.65 : 0;
          primarySeries[i] = Number((1.4 + Math.sin(i * 0.4) * 0.5 + storm).toFixed(2));
          secondarySeries[i] = primarySeries[i] >= 4.5 ? Number((primarySeries[i] - 4).toFixed(2)) : 0.2;
        }
      }
      eventCount = feedType === 'FLR' ? 3 : 2;
    }
  }

  const samples = normalizeSeriesToSamples(primarySeries, secondarySeries).map((s, idx) => {
    const tMs = startMs + (idx / Math.max(1, steps - 1)) * spanMs;
    return {
      ...s,
      timestamp: new Date(tMs).toISOString(),
    };
  });

  const isFlare = feedType === 'FLR';
  const dataset: NasaDatasetRecord = {
    id: `nasa-donki-${feedType.toLowerCase()}-live`,
    title: isFlare
      ? 'NASA DONKI Solar Flares (30-Day Live Log)'
      : 'NASA DONKI Geomagnetic Storms (Kp Index)',
    mission: 'NASA DONKI / GOES-SWPC',
    instrument: isFlare ? 'GOES XRS Flare Log (log10 W/m²)' : 'Planetary K-Index Network',
    domain: 'Heliophysics',
    sourceType: source === 'nasa-donki-live' ? 'nasa-api-live' : 'test-catalog',
    epochStart: samples[0].timestamp,
    epochEnd: samples[samples.length - 1].timestamp,
    cadenceLabel: '15-hour bins (30d)',
    primaryUnit: isFlare ? 'log₁₀ W/m²' : 'Kp',
    secondaryUnit: isFlare ? 'events' : 'storm index',
    primaryChannelName: isFlare ? 'Peak Solar X-Ray Log Flux' : 'Planetary Geomagnetic Kp',
    secondaryChannelName: isFlare ? 'Flare Event Density' : 'G-Scale Storm Excess',
    sampleCount: samples.length,
    description: isFlare
      ? `30-day Space Weather Database of Notifications, Knowledge, Information (DONKI) solar flare flux binned from ${eventCount} recorded events.`
      : `30-day DONKI geomagnetic storm Kp measurements aggregated across ${eventCount} storm intervals.`,
    accentColor: isFlare ? '#F59E0B' : '#06B6D4',
    sonification: {
      baseFrequencyHz: isFlare ? 130.81 : 87.31,
      harmonicSpread: 1.5,
      filterCutoffHz: isFlare ? 2100 : 1650,
      filterQ: 1.8,
      waveform: 'triangle',
      modulationDepth: isFlare ? 0.28 : 0.22,
      recommendedScale: 'pentatonic',
    },
    samples,
    integrationNotes: {
      targetNasaArchive: `NASA Open API DONKI (${feedType})`,
      expectedEndpoint: `GET /api/nasa/donki?type=${feedType}`,
      physicalCoordinateFrame: isFlare ? 'Heliographic GOES XRS Band' : 'Geocentric Kp Magnetosphere',
    },
  };

  return {
    source,
    feedType,
    eventCount,
    windowStart: startDate,
    windowEnd: endDate,
    notice,
    dataset,
  };
}

export function getNasaApiPresets(): NasaApiPreset[] {
  const end = new Date(Date.now() - 3 * 86_400_000);
  const start = new Date(end.getTime() - 30 * 86_400_000);
  const fmtBasic = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');
  const fmtIso = (d: Date) => d.toISOString().slice(0, 10);
  const neoStart = new Date(Date.now() - 6 * 86_400_000);
  const neoEnd = new Date();

  return [
    {
      id: 'nasa-power-solar',
      title: 'NASA POWER Surface Solar Radiance (30-Day)',
      mission: 'NASA Langley POWER',
      domain: 'Heliophysics',
      url: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=-77.0369&latitude=38.9072&start=${fmtBasic(
        start
      )}&end=${fmtBasic(end)}&format=JSON`,
      jsonPath: 'properties.parameter.ALLSKY_SFC_SW_DWN',
      secondaryJsonPath: 'properties.parameter.T2M',
      channelName: 'All-Sky Surface Shortwave Downward Irradiance',
      unit: 'kWh/m²/day',
      description:
        'Live daily satellite solar irradiance and 2-meter air temperature from NASA POWER (zero API key required).',
    },
    {
      id: 'nasa-neows-asteroids',
      title: 'NASA JPL Asteroids NeoWs Close Approaches',
      mission: 'NASA JPL CNEOS / NeoWs',
      domain: 'Astrophysics',
      url: `https://api.nasa.gov/neo/rest/v1/feed?start_date=${fmtIso(neoStart)}&end_date=${fmtIso(
        neoEnd
      )}`,
      jsonPath: 'near_earth_objects.*.*.close_approach_data.0.miss_distance.kilometers',
      secondaryJsonPath:
        'near_earth_objects.*.*.close_approach_data.0.relative_velocity.kilometers_per_hour',
      channelName: 'Lunar/Earth Miss Distance',
      unit: 'km',
      description:
        'Near-Earth Object close-approach distances & velocities from NASA JPL NeoWs (server injects NASA_API_KEY or DEMO_KEY).',
    },
    {
      id: 'nasa-eonet-events',
      title: 'NASA EONET Global Natural Events',
      mission: 'NASA EONET v3 Observatory',
      domain: 'Planetary Science',
      url: 'https://eonet.gsfc.nasa.gov/api/v3/events?limit=40&status=open',
      jsonPath: 'events.*.geometry.0.coordinates.1',
      secondaryJsonPath: 'events.*.geometry.0.coordinates.0',
      channelName: 'Active Event Latitude',
      unit: 'deg lat',
      description:
        'Live Earth Observatory Natural Event Tracker latitudes & longitudes for active storms, wildfires, and volcanoes.',
    },
    {
      id: 'noaa-goes-xray',
      title: 'NASA/NOAA GOES-18 Real-Time Solar X-Ray Flux',
      mission: 'GOES-18 EXIS / SWPC',
      domain: 'Heliophysics',
      url: 'https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json',
      jsonPath: '*.flux',
      secondaryJsonPath: '*.observed_flux',
      channelName: 'Solar X-Ray Flux',
      unit: 'W/m²',
      description:
        'Continuous high-cadence GOES-18 satellite X-ray flux telemetry over the past 72 hours.',
    },
  ];
}

const TRUSTED_NASA_HOST_SUFFIXES = [
  '.nasa.gov',
  '.noaa.gov',
  '.usgs.gov',
  '.iris.edu',
  '.caltech.edu',
];

function isTrustedScientificHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return TRUSTED_NASA_HOST_SUFFIXES.some(
    (suffix) => lower === suffix.slice(1) || lower.endsWith(suffix)
  );
}

function toFiniteMeasurement(raw: unknown): number | null {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw <= -990) return null;
    return raw;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= -990) return null;
    return parsed;
  }
  return null;
}

function resolvePathValues(root: unknown, dotPath: string): number[] {
  const tokens = dotPath
    .split('.')
    .map((t) => t.trim())
    .filter(Boolean);

  let current: unknown[] = [root];
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const item of current) {
      if (item === null || item === undefined) continue;
      if (token === '*') {
        if (Array.isArray(item)) {
          next.push(...item);
        } else if (typeof item === 'object') {
          const obj = item as Record<string, unknown>;
          for (const key of Object.keys(obj).sort()) {
            next.push(obj[key]);
          }
        }
      } else if (Array.isArray(item)) {
        const idx = Number(token);
        if (Number.isInteger(idx) && idx >= 0 && idx < item.length) {
          next.push(item[idx]);
        }
      } else if (typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        if (token in obj) {
          next.push(obj[token]);
        }
      }
    }
    current = next;
  }

  // If final node is a dictionary (e.g. NASA POWER {"20261015": 4.2, ...}), extract sorted key values
  if (
    current.length === 1 &&
    current[0] !== null &&
    typeof current[0] === 'object' &&
    !Array.isArray(current[0])
  ) {
    const mapObj = current[0] as Record<string, unknown>;
    const vals: number[] = [];
    for (const k of Object.keys(mapObj).sort()) {
      const n = toFiniteMeasurement(mapObj[k]);
      if (n !== null) vals.push(n);
    }
    return vals;
  }

  const out: number[] = [];
  for (const item of current) {
    const n = toFiniteMeasurement(item);
    if (n !== null) out.push(n);
  }
  return out;
}

function autoDiscoverNumericSeries(root: unknown): {
  pathUsed: string;
  values: number[];
} {
  const candidates = new Map<string, number[]>();

  const visit = (node: unknown, pathLabel: string, depth: number) => {
    if (depth > 6 || node === null || node === undefined) return;
    const direct = toFiniteMeasurement(node);
    if (direct !== null) {
      const list = candidates.get(pathLabel) ?? [];
      list.push(direct);
      candidates.set(pathLabel, list);
      return;
    }

    if (Array.isArray(node)) {
      const maxScan = Math.min(node.length, 240);
      for (let i = 0; i < maxScan; i++) {
        visit(node[i], pathLabel ? `${pathLabel}.*` : '*', depth + 1);
      }
      return;
    }

    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      const keys = Object.keys(obj);
      // Detect time-keyed numeric map like {"20261001": 3.4, "20261002": 4.1}
      if (keys.length >= 4 && keys.every((k) => /^\d{6,14}$/.test(k))) {
        const series: number[] = [];
        for (const k of keys.sort()) {
          const n = toFiniteMeasurement(obj[k]);
          if (n !== null) series.push(n);
        }
        if (series.length >= 4) {
          candidates.set(pathLabel || 'series', series);
          return;
        }
      }
      for (const k of keys.slice(0, 60)) {
        const nextPath = pathLabel ? `${pathLabel}.${k}` : k;
        visit(obj[k], nextPath, depth + 1);
      }
    }
  };

  visit(root, '', 0);

  let bestPath = 'auto';
  let bestValues: number[] = [];
  let bestScore = -1;

  for (const [p, arr] of candidates.entries()) {
    if (arr.length < 4) continue;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (max - min <= 1e-9) continue; // skip constant IDs / flags
    // Prefer measurement paths over bare timestamp/id fields
    const lower = p.toLowerCase();
    const penalty =
      lower.includes('id') || lower.includes('epoch') || lower.includes('status') ? 0.4 : 1;
    const score = Math.min(arr.length, 240) * penalty;
    if (score > bestScore) {
      bestScore = score;
      bestPath = p;
      bestValues = arr;
    }
  }

  return { pathUsed: bestPath, values: bestValues };
}

export interface ConnectNasaApiInput {
  url: string;
  title?: string;
  mission?: string;
  domain?: MissionDomain;
  channelName?: string;
  unit?: string;
  jsonPath?: string;
  secondaryJsonPath?: string;
}

export async function connectCustomNasaApi(
  input: ConnectNasaApiInput
): Promise<NasaApiConnectResponse> {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input.url.trim());
  } catch {
    throw new Error('Please enter a valid HTTPS NASA or scientific API URL.');
  }

  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Only HTTPS endpoints are permitted.');
  }

  if (!isTrustedScientificHost(parsedUrl.hostname)) {
    throw new Error(
      `Host "${parsedUrl.hostname}" is not a recognized NASA / NOAA / USGS / IRIS / Caltech scientific domain.`
    );
  }

  // Automatically attach NASA_API_KEY (user session key, .env, or DEMO_KEY) for api.nasa.gov URLs
  if (
    parsedUrl.hostname.toLowerCase() === 'api.nasa.gov' &&
    !parsedUrl.searchParams.has('api_key')
  ) {
    parsedUrl.searchParams.set('api_key', getEffectiveNasaApiKey());
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12000);
  const res = await fetch(parsedUrl.toString(), { signal: controller.signal });
  clearTimeout(timeoutId);

  if (!res.ok) {
    if (res.status === 403 && parsedUrl.hostname.toLowerCase() === 'api.nasa.gov') {
      throw new Error(
        'NASA API key was rejected (HTTP 403). Double-check the key from api.nasa.gov or clear it to use public feeds.'
      );
    }
    throw new Error(`Upstream NASA endpoint returned HTTP ${res.status}`);
  }

  const json = (await res.json()) as unknown;

  let jsonPathUsed = input.jsonPath?.trim() || 'auto';
  let primaryValues: number[] = [];

  if (jsonPathUsed !== 'auto') {
    primaryValues = resolvePathValues(json, jsonPathUsed);
  }
  if (primaryValues.length < 4) {
    const discovered = autoDiscoverNumericSeries(json);
    primaryValues = discovered.values;
    jsonPathUsed = discovered.pathUsed;
  }

  if (primaryValues.length < 4) {
    throw new Error(
      'Could not extract at least 4 finite numeric values from that endpoint response. Try specifying a JSON path (e.g. properties.parameter.ALLSKY_SFC_SW_DWN).'
    );
  }

  // Cap huge feeds cleanly at 240 samples for musical sonification responsiveness
  if (primaryValues.length > 240) {
    const stride = primaryValues.length / 240;
    const downsampled: number[] = [];
    for (let i = 0; i < 240; i++) {
      downsampled.push(primaryValues[Math.floor(i * stride)]);
    }
    primaryValues = downsampled;
  }

  let secondaryValues: number[] | undefined;
  if (input.secondaryJsonPath?.trim()) {
    const sec = resolvePathValues(json, input.secondaryJsonPath.trim());
    if (sec.length >= primaryValues.length) {
      secondaryValues = sec.slice(0, primaryValues.length);
    }
  }

  const samples = normalizeSeriesToSamples(primaryValues, secondaryValues);
  const safeSlug = (input.title?.trim() || parsedUrl.hostname)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28);

  const dataset: NasaDatasetRecord = {
    id: `nasa-live-${safeSlug}-${Date.now().toString(36)}`,
    title: input.title?.trim() || `NASA Live Feed (${parsedUrl.hostname})`,
    mission: input.mission?.trim() || parsedUrl.hostname,
    instrument: `Live JSON Connector (${jsonPathUsed})`,
    domain: input.domain || 'Heliophysics',
    sourceType: 'nasa-api-live',
    epochStart: samples[0].timestamp,
    epochEnd: samples[samples.length - 1].timestamp,
    cadenceLabel: `${samples.length} live points`,
    primaryUnit: input.unit?.trim() || 'units',
    secondaryUnit: secondaryValues ? 'secondary' : 'Δ/step',
    primaryChannelName: input.channelName?.trim() || jsonPathUsed,
    secondaryChannelName: secondaryValues
      ? input.secondaryJsonPath?.trim() || 'Secondary Stream'
      : 'Derived Rate of Change',
    sampleCount: samples.length,
    description: `Live telemetry ingested directly from ${parsedUrl.hostname}${parsedUrl.pathname} via Express /api/nasa/connect.`,
    accentColor: '#06B6D4',
    sonification: {
      baseFrequencyHz: 98.0,
      harmonicSpread: 1.5,
      filterCutoffHz: 1850,
      filterQ: 1.7,
      waveform: 'triangle',
      modulationDepth: 0.24,
      recommendedScale: 'pentatonic',
    },
    samples,
    integrationNotes: {
      targetNasaArchive: parsedUrl.hostname,
      expectedEndpoint: `${parsedUrl.origin}${parsedUrl.pathname}`,
      physicalCoordinateFrame: 'Normalized [0..1] Live API Projection',
    },
  };

  return {
    upstreamHost: parsedUrl.hostname,
    jsonPathUsed,
    extractedCount: samples.length,
    dataset,
  };
}

export async function autoSetupAndFetchNasaProjection(options?: {
  apiKey?: string;
  presetId?: string;
}): Promise<{
  keyStatus: { configured: boolean; source: NasaKeySource };
  presetUsed: NasaApiPreset;
  dataset: NasaDatasetRecord;
  notice: string;
}> {
  const previousKey = runtimeUserNasaApiKey;
  const trimmedKey = typeof options?.apiKey === 'string' ? options.apiKey.trim() : undefined;

  if (trimmedKey !== undefined) {
    if (trimmedKey && !/^[A-Za-z0-9_-]{12,128}$/.test(trimmedKey)) {
      throw new Error(
        'That does not look like a valid NASA API key (expected alphanumeric key from api.nasa.gov).'
      );
    }
    setRuntimeNasaApiKey(trimmedKey || null);
  }

  const presets = getNasaApiPresets();
  const preferredId =
    options?.presetId ||
    (trimmedKey ? 'nasa-neows-asteroids' : 'nasa-power-solar');
  const primaryPreset =
    presets.find((p) => p.id === preferredId) ?? presets[0];

  try {
    const result = await connectCustomNasaApi({
      url: primaryPreset.url,
      title: primaryPreset.title,
      mission: primaryPreset.mission,
      domain: primaryPreset.domain,
      channelName: primaryPreset.channelName,
      unit: primaryPreset.unit,
      jsonPath: primaryPreset.jsonPath,
      secondaryJsonPath: primaryPreset.secondaryJsonPath,
    });
    const keyStatus = getNasaKeyStatus();
    return {
      keyStatus,
      presetUsed: primaryPreset,
      dataset: result.dataset,
      notice:
        keyStatus.source === 'user-key'
          ? `NASA API key saved & verified — streaming live "${primaryPreset.title}" (${result.dataset.sampleCount} samples).`
          : `Connected live "${primaryPreset.title}" (${result.dataset.sampleCount} samples).`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Connection failed';
    // If the user just submitted a custom key and api.nasa.gov rejected it (403), revert & surface cleanly
    if (trimmedKey && msg.includes('403')) {
      runtimeUserNasaApiKey = previousKey;
      throw err;
    }

    // Otherwise fall back to the reliable keyless GOES-18 / EONET live feed
    const fallbackPreset =
      presets.find((p) => p.id === 'noaa-goes-xray') ?? presets[presets.length - 1];
    const fallbackResult = await connectCustomNasaApi({
      url: fallbackPreset.url,
      title: fallbackPreset.title,
      mission: fallbackPreset.mission,
      domain: fallbackPreset.domain,
      channelName: fallbackPreset.channelName,
      unit: fallbackPreset.unit,
      jsonPath: fallbackPreset.jsonPath,
      secondaryJsonPath: fallbackPreset.secondaryJsonPath,
    });
    const keyStatus = getNasaKeyStatus();
    return {
      keyStatus,
      presetUsed: fallbackPreset,
      dataset: fallbackResult.dataset,
      notice: `Loaded live "${fallbackPreset.title}" (${fallbackResult.dataset.sampleCount} samples).`,
    };
  }
}

function computeSolarElevationDeg(
  satLatDeg: number,
  satLonDeg: number,
  solarLatDeg: number,
  solarLonDeg: number
): number {
  const rad = Math.PI / 180;
  const lat1 = satLatDeg * rad;
  const lat2 = solarLatDeg * rad;
  const dLon = (satLonDeg - solarLonDeg) * rad;
  const sinElev =
    Math.sin(lat1) * Math.sin(lat2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.asin(Math.max(-1, Math.min(1, sinElev))) * 180) / Math.PI;
}

export async function fetchLiveIssTelemetry(): Promise<IssTelemetryResponse> {
  const nowSec = Math.floor(Date.now() / 1000);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const currentRes = await fetch('https://api.wheretheiss.at/v1/satellites/25544', {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!currentRes.ok) {
      throw new Error(`WhereTheISS returned HTTP ${currentRes.status}`);
    }

    const raw = (await currentRes.json()) as {
      name?: string;
      id?: number;
      latitude: number;
      longitude: number;
      altitude: number;
      velocity: number;
      visibility: string;
      footprint: number;
      timestamp: number;
      solar_lat: number;
      solar_lon: number;
    };

    // Fetch orbital ground track (-25 min to +45 min every ~5 min = 15 points)
    const trackTimestamps: number[] = [];
    for (let offsetMin = -25; offsetMin <= 45; offsetMin += 5) {
      trackTimestamps.push((raw.timestamp || nowSec) + offsetMin * 60);
    }

    let track: IssTrackPoint[] = [];
    try {
      const trackCtrl = new AbortController();
      const trackTimer = setTimeout(() => trackCtrl.abort(), 4000);
      const trackRes = await fetch(
        `https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${trackTimestamps.join(
          ','
        )}`,
        { signal: trackCtrl.signal }
      );
      clearTimeout(trackTimer);
      if (trackRes.ok) {
        const arr = (await trackRes.json()) as Array<{
          latitude: number;
          longitude: number;
          timestamp: number;
          visibility: string;
        }>;
        if (Array.isArray(arr)) {
          track = arr.map((pt) => ({
            latitude: Number(pt.latitude.toFixed(4)),
            longitude: Number(pt.longitude.toFixed(4)),
            timestamp: pt.timestamp,
            visibility: pt.visibility === 'eclipsed' ? 'eclipsed' : 'daylight',
          }));
        }
      }
    } catch {
      // Fallback track generated from live heading if batch endpoint times out
    }

    const solarElevationDeg = Number(
      computeSolarElevationDeg(
        raw.latitude,
        raw.longitude,
        raw.solar_lat,
        raw.solar_lon
      ).toFixed(2)
    );
    const visibility = raw.visibility === 'eclipsed' ? 'eclipsed' : 'daylight';
    // ISS enters orbital sunlight even slightly below 0 deg due to ~420 km altitude (-19 deg horizon dip)
    const daylightFactor = Math.max(
      0,
      Math.min(1, (solarElevationDeg + 20) / 55)
    );

    if (track.length === 0) {
      for (let i = -5; i <= 9; i++) {
        const dtSec = i * 300;
        const phase = ((raw.timestamp + dtSec) / 5574) * Math.PI * 2;
        const lat = Number((51.64 * Math.sin(phase)).toFixed(4));
        const lon = Number(
          ((((raw.longitude + (dtSec / 5574) * 337) + 540) % 360) - 180).toFixed(4)
        );
        const elev = computeSolarElevationDeg(lat, lon, raw.solar_lat, raw.solar_lon);
        track.push({
          latitude: lat,
          longitude: lon,
          timestamp: (raw.timestamp || nowSec) + dtSec,
          visibility: elev > -19 ? 'daylight' : 'eclipsed',
        });
      }
    }

    return {
      source: 'wheretheiss-live',
      name: raw.name || 'iss',
      id: raw.id || 25544,
      latitude: Number(raw.latitude.toFixed(4)),
      longitude: Number(raw.longitude.toFixed(4)),
      altitudeKm: Number(raw.altitude.toFixed(2)),
      velocityKmh: Number(raw.velocity.toFixed(1)),
      visibility,
      footprintKm: Number((raw.footprint || 4500).toFixed(1)),
      solarLat: Number((raw.solar_lat || 0).toFixed(2)),
      solarLon: Number((raw.solar_lon || 0).toFixed(2)),
      solarElevationDeg,
      daylightFactor: Number(daylightFactor.toFixed(3)),
      timestamp: new Date((raw.timestamp || nowSec) * 1000).toISOString(),
      track,
    };
  } catch {
    // Calibrated Keplerian orbital fallback (92.9-min period, 51.64 deg inclination)
    const periodSec = 5574;
    const phase = (nowSec / periodSec) * Math.PI * 2;
    const latitude = Number((51.64 * Math.sin(phase)).toFixed(4));
    const longitude = Number(
      (((((nowSec / 86400) * 360 * 15.5) + 180) % 360) - 180).toFixed(4)
    );
    const solarLon = Number((((-(nowSec % 86400) / 86400) * 360 + 180)).toFixed(2));
    const solarLat = -18.2;
    const solarElevationDeg = Number(
      computeSolarElevationDeg(latitude, longitude, solarLat, solarLon).toFixed(2)
    );
    const visibility = solarElevationDeg > -19 ? 'daylight' : 'eclipsed';
    const daylightFactor = Math.max(
      0,
      Math.min(1, (solarElevationDeg + 20) / 55)
    );

    const track: IssTrackPoint[] = [];
    for (let i = -5; i <= 9; i++) {
      const ts = nowSec + i * 300;
      const p = (ts / periodSec) * Math.PI * 2;
      const lat = Number((51.64 * Math.sin(p)).toFixed(4));
      const lon = Number((((((ts / 86400) * 360 * 15.5) + 180) % 360) - 180).toFixed(4));
      const elev = computeSolarElevationDeg(lat, lon, solarLat, solarLon);
      track.push({
        latitude: lat,
        longitude: lon,
        timestamp: ts,
        visibility: elev > -19 ? 'daylight' : 'eclipsed',
      });
    }

    return {
      source: 'kepler-fallback',
      name: 'iss',
      id: 25544,
      latitude,
      longitude,
      altitudeKm: 418.4,
      velocityKmh: 27584.2,
      visibility,
      footprintKm: 4512.0,
      solarLat,
      solarLon,
      solarElevationDeg,
      daylightFactor: Number(daylightFactor.toFixed(3)),
      timestamp: new Date(nowSec * 1000).toISOString(),
      track,
    };
  }
}


