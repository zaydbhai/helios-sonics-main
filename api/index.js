// api-src/handler.ts
import express from "express";

// server/routes/nasaRoutes.ts
import { Router } from "express";
import jpeg from "jpeg-js";

// server/nasa/liveNasa.ts
var SUPPORTED_GIBS_LAYERS = [
  {
    id: "MODIS_Terra_CorrectedReflectance_TrueColor",
    title: "MODIS Terra True Color",
    description: "Daily global natural-color surface reflectance and cloud decks.",
    category: "True Color Imagery",
    defaultDateOffsetDays: 2
  },
  {
    id: "MODIS_Terra_Aerosol",
    title: "MODIS Aerosol Optical Depth",
    description: "Atmospheric dust, smoke plumes, and aerosol concentration.",
    category: "Atmospheric Chemistry",
    defaultDateOffsetDays: 2
  },
  {
    id: "GHRSST_L4_MUR_Sea_Surface_Temperature",
    title: "MUR Sea Surface Temperature",
    description: "High-resolution global ocean thermal surface map.",
    category: "Ocean & Thermal",
    defaultDateOffsetDays: 3
  },
  {
    id: "VIIRS_SNPP_DayNightBand_ENCC",
    title: "VIIRS Nighttime Lights & Clouds",
    description: "Suomi NPP Day/Night band showing city lights, aurora, and moonlit clouds.",
    category: "Day / Night Band",
    defaultDateOffsetDays: 2
  }
];
var ALLOWED_GIBS_LAYER_IDS = new Set(SUPPORTED_GIBS_LAYERS.map((l) => l.id));
function isValidIsoDate(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(Date.parse(`${dateStr}T00:00:00Z`));
}
function getDefaultGibsDate(offsetDays = 2) {
  const target = new Date(Date.now() - offsetDays * 864e5);
  return target.toISOString().slice(0, 10);
}
var GIBS_BASE = "BlueMarble_ShadedRelief_Bathymetry";
var GIBS_UNDERLAYS = {
  MODIS_Terra_CorrectedReflectance_TrueColor: [GIBS_BASE, "MODIS_Aqua_CorrectedReflectance_TrueColor"],
  MODIS_Terra_Aerosol: [GIBS_BASE],
  GHRSST_L4_MUR_Sea_Surface_Temperature: [GIBS_BASE]
};
function buildGibsWmsUrl(layerId, dateStr, width = 3072, height = 1536, useUnderlays = true) {
  if (!ALLOWED_GIBS_LAYER_IDS.has(layerId)) {
    throw new Error(`Unsupported NASA GIBS layer '${layerId}'.`);
  }
  if (!isValidIsoDate(dateStr)) {
    throw new Error(`Invalid date '${dateStr}'. Expected YYYY-MM-DD.`);
  }
  const safeW = Math.min(4096, Math.max(256, Math.round(width)));
  const safeH = Math.min(2048, Math.max(128, Math.round(height)));
  const layers = [...useUnderlays ? GIBS_UNDERLAYS[layerId] ?? [] : [], layerId];
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layers.join(","),
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: String(safeW),
    HEIGHT: String(safeH),
    FORMAT: "image/jpeg",
    TIME: dateStr
  });
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}
function buildGibsRawUrl(layersCsv, dateStr, width, height) {
  const params = new URLSearchParams({
    SERVICE: "WMS",
    REQUEST: "GetMap",
    VERSION: "1.3.0",
    LAYERS: layersCsv,
    CRS: "EPSG:4326",
    BBOX: "-90,-180,90,180",
    WIDTH: String(Math.min(4096, Math.max(256, Math.round(width)))),
    HEIGHT: String(Math.min(2048, Math.max(128, Math.round(height)))),
    FORMAT: "image/jpeg"
  });
  if (dateStr) params.set("TIME", dateStr);
  return `https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?${params.toString()}`;
}
function shiftIsoDate(dateStr, deltaDays) {
  return new Date(Date.parse(`${dateStr}T00:00:00Z`) + deltaDays * 864e5).toISOString().slice(0, 10);
}
function parseGoesClassFlux(classType) {
  if (!classType || typeof classType !== "string") return 1e-7;
  const trimmed = classType.trim().toUpperCase();
  const letter = trimmed[0];
  const magnitude = Number.parseFloat(trimmed.slice(1)) || 1;
  const baseMap = {
    A: 1e-8,
    B: 1e-7,
    C: 1e-6,
    M: 1e-5,
    X: 1e-4
  };
  const base = baseMap[letter] ?? 1e-7;
  return base * magnitude;
}
var runtimeUserNasaApiKey = null;
function getEffectiveNasaApiKey() {
  if (runtimeUserNasaApiKey) return runtimeUserNasaApiKey;
  const envKey = process.env.NASA_API_KEY?.trim();
  return envKey || "DEMO_KEY";
}
function getNasaKeyStatus() {
  if (runtimeUserNasaApiKey) {
    return { configured: true, source: "user-key" };
  }
  if (process.env.NASA_API_KEY?.trim()) {
    return { configured: true, source: "env" };
  }
  return { configured: false, source: "demo-key" };
}
function setRuntimeNasaApiKey(key) {
  const cleaned = typeof key === "string" ? key.trim() : "";
  runtimeUserNasaApiKey = cleaned ? cleaned : null;
  return getNasaKeyStatus();
}
async function fetchDonkiSpaceWeatherDataset(feedType = "FLR") {
  const apiKey = getEffectiveNasaApiKey();
  const endDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  const steps = 48;
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T23:59:59Z`);
  const spanMs = Math.max(1, endMs - startMs);
  const url = `https://api.nasa.gov/DONKI/${feedType}?startDate=${startDate}&endDate=${endDate}&api_key=${encodeURIComponent(
    apiKey
  )}`;
  let source = "nasa-donki-live";
  let notice;
  let eventCount = 0;
  const primarySeries = new Array(steps).fill(0);
  const secondarySeries = new Array(steps).fill(0);
  let loadedFromDonki = false;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4e3);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    if (response.ok) {
      const payload = await response.json();
      const events = Array.isArray(payload) ? payload : [];
      eventCount = events.length;
      if (feedType === "FLR") {
        primarySeries.fill(-6.8);
        secondarySeries.fill(0.1);
        for (const raw of events) {
          const ts = Date.parse(raw.peakTime || raw.beginTime || "");
          if (Number.isNaN(ts)) continue;
          const bin = Math.min(
            steps - 1,
            Math.max(0, Math.floor((ts - startMs) / spanMs * (steps - 1)))
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
        for (const raw of events) {
          const kpEntries = Array.isArray(raw.allKpIndex) ? raw.allKpIndex : [];
          for (const entry of kpEntries) {
            const ts = Date.parse(entry.observedTime || raw.startTime || "");
            const kp = Number(entry.kpIndex);
            if (Number.isNaN(ts) || !Number.isFinite(kp)) continue;
            const bin = Math.min(
              steps - 1,
              Math.max(0, Math.floor((ts - startMs) / spanMs * (steps - 1)))
            );
            primarySeries[bin] = Math.max(primarySeries[bin], kp);
            secondarySeries[bin] = Math.max(secondarySeries[bin], kp >= 5 ? kp - 4 : 0.25);
          }
        }
      }
      loadedFromDonki = true;
    }
  } catch {
  }
  if (!loadedFromDonki) {
    try {
      const swpcUrl = feedType === "FLR" ? "https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json" : "https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5e3);
      const swpcRes = await fetch(swpcUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!swpcRes.ok) {
        throw new Error(`SWPC HTTP ${swpcRes.status}`);
      }
      const swpcData = await swpcRes.json();
      if (feedType === "FLR") {
        const longBand = swpcData.filter(
          (row) => row.energy === "0.1-0.8nm" && Number.isFinite(Number(row.flux))
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
          const row = slice[Math.min(slice.length - 1, Math.floor(i / steps * slice.length))];
          const kp = Number(row?.Kp ?? row?.[1] ?? 1.5);
          const aRun = Number(row?.a_running ?? kp * 4);
          primarySeries[i] = Number(kp.toFixed(2));
          secondarySeries[i] = Number(aRun.toFixed(2));
        }
        eventCount = kpRows.length;
        notice = `Live NOAA/NASA Planetary Kp Geomagnetic feed (${eventCount} real-time readings).`;
      }
      source = "nasa-donki-live";
      loadedFromDonki = true;
    } catch (err) {
      throw new Error(`Live DONKI & SWPC feeds unavailable: ${err instanceof Error ? err.message : "network error"}`);
    }
  }
  const samples = normalizeSeriesToSamples(primarySeries, secondarySeries).map((s, idx) => {
    const tMs = startMs + idx / Math.max(1, steps - 1) * spanMs;
    return {
      ...s,
      timestamp: new Date(tMs).toISOString()
    };
  });
  const isFlare = feedType === "FLR";
  const dataset = {
    id: `nasa-donki-${feedType.toLowerCase()}-live`,
    title: isFlare ? "NASA DONKI Solar Flares (30-Day Live Log)" : "NASA DONKI Geomagnetic Storms (Kp Index)",
    mission: "NASA DONKI / GOES-SWPC",
    instrument: isFlare ? "GOES XRS Flare Log (log10 W/m\xB2)" : "Planetary K-Index Network",
    domain: "Heliophysics",
    sourceType: source === "nasa-donki-live" ? "nasa-api-live" : "test-catalog",
    epochStart: samples[0].timestamp,
    epochEnd: samples[samples.length - 1].timestamp,
    cadenceLabel: "15-hour bins (30d)",
    primaryUnit: isFlare ? "log\u2081\u2080 W/m\xB2" : "Kp",
    secondaryUnit: isFlare ? "events" : "storm index",
    primaryChannelName: isFlare ? "Peak Solar X-Ray Log Flux" : "Planetary Geomagnetic Kp",
    secondaryChannelName: isFlare ? "Flare Event Density" : "G-Scale Storm Excess",
    sampleCount: samples.length,
    description: isFlare ? `30-day Space Weather Database of Notifications, Knowledge, Information (DONKI) solar flare flux binned from ${eventCount} recorded events.` : `30-day DONKI geomagnetic storm Kp measurements aggregated across ${eventCount} storm intervals.`,
    accentColor: isFlare ? "#F59E0B" : "#06B6D4",
    sonification: {
      baseFrequencyHz: isFlare ? 130.81 : 87.31,
      harmonicSpread: 1.5,
      filterCutoffHz: isFlare ? 2100 : 1650,
      filterQ: 1.8,
      waveform: "triangle",
      modulationDepth: isFlare ? 0.28 : 0.22,
      recommendedScale: "pentatonic"
    },
    samples,
    integrationNotes: {
      targetNasaArchive: `NASA Open API DONKI (${feedType})`,
      expectedEndpoint: `GET /api/nasa/donki?type=${feedType}`,
      physicalCoordinateFrame: isFlare ? "Heliographic GOES XRS Band" : "Geocentric Kp Magnetosphere"
    }
  };
  return {
    source,
    feedType,
    eventCount,
    windowStart: startDate,
    windowEnd: endDate,
    notice,
    dataset
  };
}
function getNasaApiPresets() {
  const end = new Date(Date.now() - 3 * 864e5);
  const start = new Date(end.getTime() - 30 * 864e5);
  const fmtBasic = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const fmtIso = (d) => d.toISOString().slice(0, 10);
  const neoStart = new Date(Date.now() - 6 * 864e5);
  const neoEnd = /* @__PURE__ */ new Date();
  return [
    {
      id: "nasa-power-solar",
      title: "NASA POWER Surface Solar Radiance (30-Day)",
      mission: "NASA Langley POWER",
      domain: "Heliophysics",
      url: `https://power.larc.nasa.gov/api/temporal/daily/point?parameters=ALLSKY_SFC_SW_DWN,T2M&community=RE&longitude=-77.0369&latitude=38.9072&start=${fmtBasic(
        start
      )}&end=${fmtBasic(end)}&format=JSON`,
      jsonPath: "properties.parameter.ALLSKY_SFC_SW_DWN",
      secondaryJsonPath: "properties.parameter.T2M",
      channelName: "All-Sky Surface Shortwave Downward Irradiance",
      unit: "kWh/m\xB2/day",
      description: "Live daily satellite solar irradiance and 2-meter air temperature from NASA POWER (zero API key required)."
    },
    {
      id: "nasa-neows-asteroids",
      title: "NASA JPL Asteroids NeoWs Close Approaches",
      mission: "NASA JPL CNEOS / NeoWs",
      domain: "Astrophysics",
      url: `https://api.nasa.gov/neo/rest/v1/feed?start_date=${fmtIso(neoStart)}&end_date=${fmtIso(
        neoEnd
      )}`,
      jsonPath: "near_earth_objects.*.*.close_approach_data.0.miss_distance.kilometers",
      secondaryJsonPath: "near_earth_objects.*.*.close_approach_data.0.relative_velocity.kilometers_per_hour",
      channelName: "Lunar/Earth Miss Distance",
      unit: "km",
      description: "Near-Earth Object close-approach distances & velocities from NASA JPL NeoWs (server injects NASA_API_KEY or DEMO_KEY)."
    },
    {
      id: "nasa-eonet-events",
      title: "NASA EONET Global Natural Events",
      mission: "NASA EONET v3 Observatory",
      domain: "Planetary Science",
      url: "https://eonet.gsfc.nasa.gov/api/v3/events?limit=40&status=open",
      jsonPath: "events.*.geometry.0.coordinates.1",
      secondaryJsonPath: "events.*.geometry.0.coordinates.0",
      channelName: "Active Event Latitude",
      unit: "deg lat",
      description: "Live Earth Observatory Natural Event Tracker latitudes & longitudes for active storms, wildfires, and volcanoes."
    },
    {
      id: "noaa-goes-xray",
      title: "NASA/NOAA GOES-18 Real-Time Solar X-Ray Flux",
      mission: "GOES-18 EXIS / SWPC",
      domain: "Heliophysics",
      url: "https://services.swpc.noaa.gov/json/goes/primary/xrays-3-day.json",
      jsonPath: "*.flux",
      secondaryJsonPath: "*.observed_flux",
      channelName: "Solar X-Ray Flux",
      unit: "W/m\xB2",
      description: "Continuous high-cadence GOES-18 satellite X-ray flux telemetry over the past 72 hours."
    }
  ];
}
var TRUSTED_NASA_HOST_SUFFIXES = [
  ".nasa.gov",
  ".noaa.gov",
  ".usgs.gov",
  ".iris.edu",
  ".caltech.edu"
];
function isTrustedScientificHost(hostname) {
  const lower = hostname.toLowerCase();
  return TRUSTED_NASA_HOST_SUFFIXES.some(
    (suffix) => lower === suffix.slice(1) || lower.endsWith(suffix)
  );
}
function toFiniteMeasurement(raw) {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || raw <= -990) return null;
    return raw;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= -990) return null;
    return parsed;
  }
  return null;
}
function resolvePathValues(root, dotPath) {
  const tokens = dotPath.split(".").map((t) => t.trim()).filter(Boolean);
  let current = [root];
  for (const token of tokens) {
    const next = [];
    for (const item of current) {
      if (item === null || item === void 0) continue;
      if (token === "*") {
        if (Array.isArray(item)) {
          next.push(...item);
        } else if (typeof item === "object") {
          const obj = item;
          for (const key of Object.keys(obj).sort()) {
            next.push(obj[key]);
          }
        }
      } else if (Array.isArray(item)) {
        const idx = Number(token);
        if (Number.isInteger(idx) && idx >= 0 && idx < item.length) {
          next.push(item[idx]);
        }
      } else if (typeof item === "object") {
        const obj = item;
        if (token in obj) {
          next.push(obj[token]);
        }
      }
    }
    current = next;
  }
  if (current.length === 1 && current[0] !== null && typeof current[0] === "object" && !Array.isArray(current[0])) {
    const mapObj = current[0];
    const vals = [];
    for (const k of Object.keys(mapObj).sort()) {
      const n = toFiniteMeasurement(mapObj[k]);
      if (n !== null) vals.push(n);
    }
    return vals;
  }
  const out = [];
  for (const item of current) {
    const n = toFiniteMeasurement(item);
    if (n !== null) out.push(n);
  }
  return out;
}
function autoDiscoverNumericSeries(root) {
  const candidates = /* @__PURE__ */ new Map();
  const visit = (node, pathLabel, depth) => {
    if (depth > 6 || node === null || node === void 0) return;
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
        visit(node[i], pathLabel ? `${pathLabel}.*` : "*", depth + 1);
      }
      return;
    }
    if (typeof node === "object") {
      const obj = node;
      const keys = Object.keys(obj);
      if (keys.length >= 4 && keys.every((k) => /^\d{6,14}$/.test(k))) {
        const series = [];
        for (const k of keys.sort()) {
          const n = toFiniteMeasurement(obj[k]);
          if (n !== null) series.push(n);
        }
        if (series.length >= 4) {
          candidates.set(pathLabel || "series", series);
          return;
        }
      }
      for (const k of keys.slice(0, 60)) {
        const nextPath = pathLabel ? `${pathLabel}.${k}` : k;
        visit(obj[k], nextPath, depth + 1);
      }
    }
  };
  visit(root, "", 0);
  let bestPath = "auto";
  let bestValues = [];
  let bestScore = -1;
  for (const [p, arr] of candidates.entries()) {
    if (arr.length < 4) continue;
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    if (max - min <= 1e-9) continue;
    const lower = p.toLowerCase();
    const penalty = lower.includes("id") || lower.includes("epoch") || lower.includes("status") ? 0.4 : 1;
    const score = Math.min(arr.length, 240) * penalty;
    if (score > bestScore) {
      bestScore = score;
      bestPath = p;
      bestValues = arr;
    }
  }
  return { pathUsed: bestPath, values: bestValues };
}
async function connectCustomNasaApi(input) {
  let parsedUrl;
  try {
    parsedUrl = new URL(input.url.trim());
  } catch {
    throw new Error("Please enter a valid HTTPS NASA or scientific API URL.");
  }
  if (parsedUrl.protocol !== "https:") {
    throw new Error("Only HTTPS endpoints are permitted.");
  }
  if (!isTrustedScientificHost(parsedUrl.hostname)) {
    throw new Error(
      `Host "${parsedUrl.hostname}" is not a recognized NASA / NOAA / USGS / IRIS / Caltech scientific domain.`
    );
  }
  if (parsedUrl.hostname.toLowerCase() === "api.nasa.gov" && !parsedUrl.searchParams.has("api_key")) {
    parsedUrl.searchParams.set("api_key", getEffectiveNasaApiKey());
  }
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12e3);
  const res = await fetch(parsedUrl.toString(), { signal: controller.signal });
  clearTimeout(timeoutId);
  if (!res.ok) {
    if (res.status === 403 && parsedUrl.hostname.toLowerCase() === "api.nasa.gov") {
      throw new Error(
        "NASA API key was rejected (HTTP 403). Double-check the key from api.nasa.gov or clear it to use public feeds."
      );
    }
    throw new Error(`Upstream NASA endpoint returned HTTP ${res.status}`);
  }
  const json = await res.json();
  let jsonPathUsed = input.jsonPath?.trim() || "auto";
  let primaryValues = [];
  if (jsonPathUsed !== "auto") {
    primaryValues = resolvePathValues(json, jsonPathUsed);
  }
  if (primaryValues.length < 4) {
    const discovered = autoDiscoverNumericSeries(json);
    primaryValues = discovered.values;
    jsonPathUsed = discovered.pathUsed;
  }
  if (primaryValues.length < 4) {
    throw new Error(
      "Could not extract at least 4 finite numeric values from that endpoint response. Try specifying a JSON path (e.g. properties.parameter.ALLSKY_SFC_SW_DWN)."
    );
  }
  if (primaryValues.length > 240) {
    const stride = primaryValues.length / 240;
    const downsampled = [];
    for (let i = 0; i < 240; i++) {
      downsampled.push(primaryValues[Math.floor(i * stride)]);
    }
    primaryValues = downsampled;
  }
  let secondaryValues;
  if (input.secondaryJsonPath?.trim()) {
    const sec = resolvePathValues(json, input.secondaryJsonPath.trim());
    if (sec.length >= primaryValues.length) {
      secondaryValues = sec.slice(0, primaryValues.length);
    }
  }
  const samples = normalizeSeriesToSamples(primaryValues, secondaryValues);
  const safeSlug = (input.title?.trim() || parsedUrl.hostname).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28);
  const dataset = {
    id: `nasa-live-${safeSlug}-${Date.now().toString(36)}`,
    title: input.title?.trim() || `NASA Live Feed (${parsedUrl.hostname})`,
    mission: input.mission?.trim() || parsedUrl.hostname,
    instrument: `Live JSON Connector (${jsonPathUsed})`,
    domain: input.domain || "Heliophysics",
    sourceType: "nasa-api-live",
    epochStart: samples[0].timestamp,
    epochEnd: samples[samples.length - 1].timestamp,
    cadenceLabel: `${samples.length} live points`,
    primaryUnit: input.unit?.trim() || "units",
    secondaryUnit: secondaryValues ? "secondary" : "\u0394/step",
    primaryChannelName: input.channelName?.trim() || jsonPathUsed,
    secondaryChannelName: secondaryValues ? input.secondaryJsonPath?.trim() || "Secondary Stream" : "Derived Rate of Change",
    sampleCount: samples.length,
    description: `Live telemetry ingested directly from ${parsedUrl.hostname}${parsedUrl.pathname} via Express /api/nasa/connect.`,
    accentColor: "#06B6D4",
    sonification: {
      baseFrequencyHz: 98,
      harmonicSpread: 1.5,
      filterCutoffHz: 1850,
      filterQ: 1.7,
      waveform: "triangle",
      modulationDepth: 0.24,
      recommendedScale: "pentatonic"
    },
    samples,
    integrationNotes: {
      targetNasaArchive: parsedUrl.hostname,
      expectedEndpoint: `${parsedUrl.origin}${parsedUrl.pathname}`,
      physicalCoordinateFrame: "Normalized [0..1] Live API Projection"
    }
  };
  return {
    upstreamHost: parsedUrl.hostname,
    jsonPathUsed,
    extractedCount: samples.length,
    dataset
  };
}
async function autoSetupAndFetchNasaProjection(options) {
  const previousKey = runtimeUserNasaApiKey;
  const trimmedKey = typeof options?.apiKey === "string" ? options.apiKey.trim() : void 0;
  if (trimmedKey !== void 0) {
    if (trimmedKey && !/^[A-Za-z0-9_-]{12,128}$/.test(trimmedKey)) {
      throw new Error(
        "That does not look like a valid NASA API key (expected alphanumeric key from api.nasa.gov)."
      );
    }
    setRuntimeNasaApiKey(trimmedKey || null);
  }
  const presets = getNasaApiPresets();
  const preferredId = options?.presetId || (trimmedKey ? "nasa-neows-asteroids" : "nasa-power-solar");
  const primaryPreset = presets.find((p) => p.id === preferredId) ?? presets[0];
  try {
    const result = await connectCustomNasaApi({
      url: primaryPreset.url,
      title: primaryPreset.title,
      mission: primaryPreset.mission,
      domain: primaryPreset.domain,
      channelName: primaryPreset.channelName,
      unit: primaryPreset.unit,
      jsonPath: primaryPreset.jsonPath,
      secondaryJsonPath: primaryPreset.secondaryJsonPath
    });
    const keyStatus = getNasaKeyStatus();
    return {
      keyStatus,
      presetUsed: primaryPreset,
      dataset: result.dataset,
      notice: keyStatus.source === "user-key" ? `NASA API key saved & verified \u2014 streaming live "${primaryPreset.title}" (${result.dataset.sampleCount} samples).` : `Connected live "${primaryPreset.title}" (${result.dataset.sampleCount} samples).`
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Connection failed";
    if (trimmedKey && msg.includes("403")) {
      runtimeUserNasaApiKey = previousKey;
      throw err;
    }
    const fallbackPreset = presets.find((p) => p.id === "noaa-goes-xray") ?? presets[presets.length - 1];
    const fallbackResult = await connectCustomNasaApi({
      url: fallbackPreset.url,
      title: fallbackPreset.title,
      mission: fallbackPreset.mission,
      domain: fallbackPreset.domain,
      channelName: fallbackPreset.channelName,
      unit: fallbackPreset.unit,
      jsonPath: fallbackPreset.jsonPath,
      secondaryJsonPath: fallbackPreset.secondaryJsonPath
    });
    const keyStatus = getNasaKeyStatus();
    return {
      keyStatus,
      presetUsed: fallbackPreset,
      dataset: fallbackResult.dataset,
      notice: `Loaded live "${fallbackPreset.title}" (${fallbackResult.dataset.sampleCount} samples).`
    };
  }
}
function computeSolarElevationDeg(satLatDeg, satLonDeg, solarLatDeg, solarLonDeg) {
  const rad = Math.PI / 180;
  const lat1 = satLatDeg * rad;
  const lat2 = solarLatDeg * rad;
  const dLon = (satLonDeg - solarLonDeg) * rad;
  const sinElev = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.asin(Math.max(-1, Math.min(1, sinElev))) * 180 / Math.PI;
}
async function fetchLiveIssTelemetry() {
  const nowSec = Math.floor(Date.now() / 1e3);
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4500);
    const currentRes = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!currentRes.ok) {
      throw new Error(`WhereTheISS returned HTTP ${currentRes.status}`);
    }
    const raw = await currentRes.json();
    const trackTimestamps = [];
    for (let offsetMin = -25; offsetMin <= 45; offsetMin += 5) {
      trackTimestamps.push((raw.timestamp || nowSec) + offsetMin * 60);
    }
    let track = [];
    try {
      const trackCtrl = new AbortController();
      const trackTimer = setTimeout(() => trackCtrl.abort(), 4e3);
      const trackRes = await fetch(
        `https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=${trackTimestamps.join(
          ","
        )}`,
        { signal: trackCtrl.signal }
      );
      clearTimeout(trackTimer);
      if (trackRes.ok) {
        const arr = await trackRes.json();
        if (Array.isArray(arr)) {
          track = arr.map((pt) => ({
            latitude: Number(pt.latitude.toFixed(4)),
            longitude: Number(pt.longitude.toFixed(4)),
            timestamp: pt.timestamp,
            visibility: pt.visibility === "eclipsed" ? "eclipsed" : "daylight"
          }));
        }
      }
    } catch {
    }
    const solarElevationDeg = Number(
      computeSolarElevationDeg(
        raw.latitude,
        raw.longitude,
        raw.solar_lat,
        raw.solar_lon
      ).toFixed(2)
    );
    const visibility = raw.visibility === "eclipsed" ? "eclipsed" : "daylight";
    const daylightFactor = Math.max(
      0,
      Math.min(1, (solarElevationDeg + 20) / 55)
    );
    if (track.length === 0) {
      for (let i = -5; i <= 9; i++) {
        const dtSec = i * 300;
        const phase = (raw.timestamp + dtSec) / 5574 * Math.PI * 2;
        const lat = Number((51.64 * Math.sin(phase)).toFixed(4));
        const lon = Number(
          ((raw.longitude + dtSec / 5574 * 337 + 540) % 360 - 180).toFixed(4)
        );
        const elev = computeSolarElevationDeg(lat, lon, raw.solar_lat, raw.solar_lon);
        track.push({
          latitude: lat,
          longitude: lon,
          timestamp: (raw.timestamp || nowSec) + dtSec,
          visibility: elev > -19 ? "daylight" : "eclipsed"
        });
      }
    }
    return {
      source: "wheretheiss-live",
      name: raw.name || "iss",
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
      timestamp: new Date((raw.timestamp || nowSec) * 1e3).toISOString(),
      track
    };
  } catch (err) {
    throw new Error(`Live ISS telemetry unavailable: ${err instanceof Error ? err.message : "network error"}`);
  }
}
async function fetchNasaImageBinary(params) {
  const searchUrl = params.nasaId ? `https://images-api.nasa.gov/search?nasa_id=${encodeURIComponent(params.nasaId)}&media_type=image` : `https://images-api.nasa.gov/search?q=${encodeURIComponent(params.query || "Cassiopeia A Chandra")}&media_type=image`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) throw new Error(`NASA Images API returned HTTP ${searchRes.status}`);
  const json = await searchRes.json();
  const item = json.collection?.items?.[0];
  const imgHref = item?.links?.find((l) => l.href)?.href;
  if (!imgHref) throw new Error("No NASA image asset found for query.");
  const imgRes = await fetch(imgHref);
  if (!imgRes.ok) throw new Error(`NASA Image asset returned HTTP ${imgRes.status}`);
  return {
    contentType: imgRes.headers.get("content-type") || "image/jpeg",
    buffer: Buffer.from(await imgRes.arrayBuffer()),
    title: item?.data?.[0]?.title || "NASA Observatory Image",
    nasaId: item?.data?.[0]?.nasa_id || params.nasaId || ""
  };
}
async function fetchNasaExoplanetParameters(planetName) {
  const safeName = planetName.replace(/[^a-zA-Z0-9\s\-+]/g, "").trim();
  const sql = `select pl_name,pl_rade,pl_bmasse,pl_eqt,pl_orbper,sy_dist,discoverymethod from pscomppars where pl_name='${safeName}'`;
  const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(sql)}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`NASA Exoplanet Archive TAP returned HTTP ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

// server/nasa/datasets.ts
async function loadInitialRealNasaDatasets() {
  const results = [];
  const tasks = [
    connectCustomNasaApi({
      url: "https://cdaweb.gsfc.nasa.gov/hapi/data?id=OMNI_HRO2_1MIN&parameters=F,flow_speed&time.min=2024-05-10T00:00:00Z&time.max=2024-05-10T04:00:00Z&format=json",
      title: "NASA CDAWeb OMNI Solar Wind & |B| (HAPI)",
      mission: "NASA SPDF CDAWeb (OMNI_HRO2_1MIN)",
      domain: "Heliophysics",
      channelName: "Interplanetary Magnetic Field |B|",
      unit: "nT",
      jsonPath: "data.*.1",
      secondaryJsonPath: "data.*.2"
    }).then((r) => ({ ...r.dataset, id: "nasa-cdaweb-omni-hapi" })).catch(() => null),
    fetchDonkiSpaceWeatherDataset("FLR").then((r) => r.dataset).catch(() => null),
    fetchDonkiSpaceWeatherDataset("GST").then((r) => r.dataset).catch(() => null),
    ...getNasaApiPresets().map(
      (preset) => connectCustomNasaApi({
        url: preset.url,
        title: preset.title,
        mission: preset.mission,
        domain: preset.domain,
        channelName: preset.channelName,
        unit: preset.unit,
        jsonPath: preset.jsonPath,
        secondaryJsonPath: preset.secondaryJsonPath
      }).then((r) => ({ ...r.dataset, id: preset.id })).catch(() => null)
    )
  ];
  const settled = await Promise.all(tasks);
  for (const item of settled) {
    if (item) results.push(item);
  }
  return results;
}

// server/nasa/adapter.ts
function toSummary(record) {
  const {
    id,
    title,
    mission,
    instrument,
    domain,
    sourceType,
    epochStart,
    epochEnd,
    cadenceLabel,
    primaryUnit,
    secondaryUnit,
    primaryChannelName,
    secondaryChannelName,
    sampleCount,
    description,
    accentColor
  } = record;
  return {
    id,
    title,
    mission,
    instrument,
    domain,
    sourceType,
    epochStart,
    epochEnd,
    cadenceLabel,
    primaryUnit,
    secondaryUnit,
    primaryChannelName,
    secondaryChannelName,
    sampleCount,
    description,
    accentColor
  };
}
function normalizeSeriesToSamples(primaryValues, secondaryValues) {
  const cleanPrimary = primaryValues.filter((v) => Number.isFinite(v));
  if (cleanPrimary.length < 4) {
    throw new Error("Dataset must contain at least 4 finite numeric samples.");
  }
  const minP = Math.min(...cleanPrimary);
  const maxP = Math.max(...cleanPrimary);
  const spanP = maxP - minP || 1;
  const cleanSecondary = secondaryValues && secondaryValues.length === cleanPrimary.length ? secondaryValues.map((v) => Number.isFinite(v) ? v : 0) : cleanPrimary.map((v, i, arr) => i === 0 ? 0 : Math.abs(v - arr[i - 1]));
  const minS = Math.min(...cleanSecondary);
  const maxS = Math.max(...cleanSecondary);
  const spanS = maxS - minS || 1;
  const nowMs = Date.now();
  return cleanPrimary.map((val, idx) => {
    const normalized = Math.max(0, Math.min(1, (val - minP) / spanP));
    const secVal = cleanSecondary[idx];
    const secondaryNormalized = Math.max(0, Math.min(1, (secVal - minS) / spanS));
    const prevNorm = idx > 0 ? Math.max(0, Math.min(1, (cleanPrimary[idx - 1] - minP) / spanP)) : normalized;
    const spectralFlux = Math.max(
      0,
      Math.min(1, Math.abs(normalized - prevNorm) * 3.5 + secondaryNormalized * 0.25)
    );
    return {
      t: idx,
      timestamp: new Date(nowMs + idx * 1e3).toISOString(),
      primaryValue: Number(val.toFixed(4)),
      normalized,
      secondaryValue: Number(secVal.toFixed(4)),
      secondaryNormalized,
      spectralFlux
    };
  });
}
var LiveNasaCatalogProvider = class {
  constructor() {
    this.mode = "live-nasa-api";
    this.store = /* @__PURE__ */ new Map();
    this.hydrationPromise = null;
  }
  async ensureHydrated() {
    if (this.store.size > 0) return;
    if (!this.hydrationPromise) {
      this.hydrationPromise = loadInitialRealNasaDatasets().then((records) => {
        for (const rec of records) {
          this.store.set(rec.id, rec);
        }
      }).finally(() => {
        this.hydrationPromise = null;
      });
    }
    await this.hydrationPromise;
  }
  async listDatasets(domain) {
    await this.ensureHydrated();
    const all = Array.from(this.store.values());
    const filtered = domain && domain !== "All" ? all.filter((d) => d.domain.toLowerCase() === domain.toLowerCase()) : all;
    return filtered.map(toSummary);
  }
  async getDatasetById(id) {
    await this.ensureHydrated();
    return this.store.get(id) ?? null;
  }
  async ingestDataset(input) {
    const samples = normalizeSeriesToSamples(input.values, input.secondaryValues);
    const slugBase = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
    const id = input.id?.trim() || `custom-${slugBase || "telemetry"}-${Date.now().toString(36)}`;
    const record = {
      id,
      title: input.title.trim(),
      mission: input.mission?.trim() || "Custom NASA Feed",
      instrument: input.instrument?.trim() || "User Ingested Telemetry",
      domain: input.domain || "Heliophysics",
      sourceType: "ingested-custom",
      epochStart: samples[0].timestamp,
      epochEnd: samples[samples.length - 1].timestamp,
      cadenceLabel: input.cadenceLabel?.trim() || "Normalized step",
      primaryUnit: input.primaryUnit?.trim() || "units",
      secondaryUnit: input.secondaryUnit?.trim() || "\u0394/step",
      primaryChannelName: input.primaryChannelName?.trim() || "Primary Telemetry Channel",
      secondaryChannelName: input.secondaryChannelName?.trim() || "Derived Derivative Flux",
      sampleCount: samples.length,
      description: input.description?.trim() || "Custom telemetry series normalized by the Express backend.",
      accentColor: "#06B6D4",
      sonification: {
        baseFrequencyHz: input.baseFrequencyHz && input.baseFrequencyHz >= 30 ? input.baseFrequencyHz : 98,
        harmonicSpread: 1.5,
        filterCutoffHz: 1850,
        filterQ: 1.7,
        waveform: "triangle",
        modulationDepth: 0.24,
        recommendedScale: "pentatonic"
      },
      samples,
      integrationNotes: {
        targetNasaArchive: "Custom Ingested Payload (/api/datasets/ingest)",
        expectedEndpoint: "POST /api/datasets/ingest",
        physicalCoordinateFrame: "Normalized [0..1] Audio Scalar"
      }
    };
    this.store.set(record.id, record);
    return record;
  }
  async registerDataset(record) {
    this.store.set(record.id, record);
    return record;
  }
};
var nasaProvider = new LiveNasaCatalogProvider();

// server/routes/nasaRoutes.ts
var nasaRouter = Router();
nasaRouter.get("/health", async (_req, res) => {
  try {
    const datasets = await nasaProvider.listDatasets();
    const keyStatus = getNasaKeyStatus();
    res.json({
      status: "operational",
      activeAdapter: nasaProvider.mode,
      hasNasaApiKey: keyStatus.configured,
      keySource: keyStatus.source,
      datasetCount: datasets.length,
      serverTimeUtc: (/* @__PURE__ */ new Date()).toISOString(),
      endpoints: [
        { method: "GET", path: "/api/health", purpose: "Backend adapter & telemetry catalog health" },
        { method: "GET", path: "/api/datasets", purpose: "List available NASA test & ingested datasets" },
        { method: "GET", path: "/api/datasets/:id", purpose: "Fetch full normalized samples & sonification defaults" },
        { method: "POST", path: "/api/datasets/ingest", purpose: "Normalize and register a new NASA JSON/CSV telemetry array" },
        { method: "GET", path: "/api/nasa/presets", purpose: "List 1-click live NASA Open API preset endpoints" },
        { method: "POST", path: "/api/nasa/setup-key", purpose: "Save session NASA API key (optional) and auto-launch a live NASA projection" },
        { method: "POST", path: "/api/nasa/connect", purpose: "Fetch any NASA/NOAA HTTPS JSON endpoint, normalize series, and register for projection" },
        { method: "GET", path: "/api/nasa/donki", purpose: "Fetch live NASA DONKI / GOES-18 Solar Flares (FLR) & Kp Storms (GST)" },
        { method: "GET", path: "/api/nasa/gibs/layers", purpose: "List supported NASA GIBS / Worldview daily satellite imagery layers" },
        { method: "GET", path: "/api/nasa/gibs/image", purpose: "Same-origin proxy for daily NASA GIBS global equirectangular snapshots" },
        { method: "GET", path: "/api/nasa/iss", purpose: "Live ISS latitude, longitude, orbital track, and day/night terminator telemetry" },
        { method: "GET", path: "/api/nasa/integration-blueprint", purpose: "Contract & adapter guide for live NASA APIs" }
      ]
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to inspect backend health"
    });
  }
});
nasaRouter.get("/datasets", async (req, res) => {
  try {
    const domain = typeof req.query.domain === "string" ? req.query.domain : void 0;
    const datasets = await nasaProvider.listDatasets(domain);
    res.json({
      sourceMode: nasaProvider.mode,
      count: datasets.length,
      datasets
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list datasets"
    });
  }
});
nasaRouter.get("/datasets/:id", async (req, res) => {
  try {
    const record = await nasaProvider.getDatasetById(req.params.id);
    if (!record) {
      res.status(404).json({ error: `Dataset '${req.params.id}' not found.` });
      return;
    }
    res.json(record);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load dataset"
    });
  }
});
nasaRouter.post("/datasets/ingest", async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body.title !== "string" || !body.title.trim()) {
      res.status(400).json({ error: 'Request body must include a non-empty string "title".' });
      return;
    }
    if (!Array.isArray(body.values) || body.values.length < 4) {
      res.status(400).json({
        error: 'Request body must include "values" with at least 4 numeric samples.'
      });
      return;
    }
    const numericValues = body.values.map((v) => Number(v));
    if (numericValues.some((v) => !Number.isFinite(v))) {
      res.status(400).json({ error: 'All entries in "values" must be finite numbers.' });
      return;
    }
    const secondaryValues = Array.isArray(body.secondaryValues) ? body.secondaryValues.map((v) => Number(v)) : void 0;
    const created = await nasaProvider.ingestDataset({
      ...body,
      title: body.title,
      values: numericValues,
      secondaryValues
    });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Invalid ingest payload"
    });
  }
});
nasaRouter.get("/nasa/presets", (_req, res) => {
  const keyStatus = getNasaKeyStatus();
  res.json({
    hasServerNasaApiKey: keyStatus.configured,
    keySource: keyStatus.source,
    presets: getNasaApiPresets()
  });
});
nasaRouter.post("/nasa/setup-key", async (req, res) => {
  try {
    const body = req.body ?? {};
    const result = await autoSetupAndFetchNasaProjection({
      apiKey: typeof body.apiKey === "string" ? body.apiKey : void 0,
      presetId: typeof body.presetId === "string" ? body.presetId : void 0
    });
    await nasaProvider.registerDataset(result.dataset);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Unable to connect with that NASA API key"
    });
  }
});
nasaRouter.delete("/nasa/setup-key", (_req, res) => {
  const keyStatus = setRuntimeNasaApiKey(null);
  res.json({ keyStatus });
});
nasaRouter.post("/nasa/connect", async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body.url !== "string" || !body.url.trim()) {
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
      secondaryJsonPath: body.secondaryJsonPath
    });
    await nasaProvider.registerDataset(result.dataset);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to connect NASA API endpoint"
    });
  }
});
nasaRouter.get("/nasa/donki", async (req, res) => {
  try {
    const rawType = typeof req.query.type === "string" ? req.query.type.toUpperCase() : "FLR";
    const feedType = rawType === "GST" ? "GST" : "FLR";
    const shouldRegister = req.query.register !== "false";
    const result = await fetchDonkiSpaceWeatherDataset(feedType);
    if (shouldRegister) {
      await nasaProvider.registerDataset(result.dataset);
    }
    res.json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch NASA DONKI feed"
    });
  }
});
nasaRouter.get("/nasa/gibs/layers", (_req, res) => {
  res.json({
    defaultDate: getDefaultGibsDate(2),
    layers: SUPPORTED_GIBS_LAYERS
  });
});
function nonBlackFraction(buf) {
  try {
    const img = jpeg.decode(buf, { useTArray: true, maxMemoryUsageInMB: 512 });
    const { data, width, height } = img;
    const step = Math.max(1, Math.floor(Math.sqrt(width * height / 6e4)));
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
    return 1;
  }
}
nasaRouter.get("/nasa/gibs/image", async (req, res) => {
  try {
    const layer = typeof req.query.layer === "string" && req.query.layer.trim() ? req.query.layer.trim() : SUPPORTED_GIBS_LAYERS[0].id;
    const date = typeof req.query.date === "string" && req.query.date.trim() ? req.query.date.trim() : getDefaultGibsDate(2);
    const width = typeof req.query.width === "string" ? Number(req.query.width) : 3072;
    const height = typeof req.query.height === "string" ? Number(req.query.height) : 1536;
    const debug = req.query.debug === "1";
    const MAX_BYTES = 4e6;
    const MIN_LIT_FRACTION = 0.01;
    const deadline = Date.now() + 24e3;
    const log = [];
    const tryFetch = async (label, url) => {
      const remaining = deadline - Date.now();
      if (remaining < 1500) {
        log.push({ label, skipped: "time budget exhausted" });
        return null;
      }
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), Math.min(12e3, remaining));
      try {
        const upstream = await fetch(url, { signal: controller.signal });
        const type = upstream.headers.get("content-type") || "";
        if (!upstream.ok || !type.startsWith("image/")) {
          const text = type.startsWith("image/") ? "" : (await upstream.text()).slice(0, 200);
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
    const candidates = [];
    for (let back = 0; back <= 5; back++) {
      const d = back === 0 ? date : shiftIsoDate(date, -back);
      candidates.push({
        label: `${layer} ${d} ${width}px+base`,
        url: buildGibsWmsUrl(layer, d, width, height, true),
        date: d
      });
    }
    candidates.push({
      label: `${layer} ${date} 2048px+base`,
      url: buildGibsWmsUrl(layer, date, 2048, 1024, true),
      date
    });
    candidates.push({
      label: `${layer} ${date} 2048px plain`,
      url: buildGibsWmsUrl(layer, date, 2048, 1024, false),
      date
    });
    if (layer === "VIIRS_SNPP_DayNightBand_ENCC") {
      for (let back = 0; back <= 3; back++) {
        const d = back === 0 ? date : shiftIsoDate(date, -back);
        candidates.push({
          label: `NOAA20 night ${d}`,
          url: buildGibsRawUrl("VIIRS_NOAA20_DayNightBand_ENCC", d, 2048, 1024),
          date: d
        });
      }
      candidates.push({
        label: "Black Marble static",
        url: buildGibsRawUrl("VIIRS_Black_Marble", null, 3072, 1536),
        date: "static-black-marble"
      });
    }
    let best = null;
    let brightest = null;
    for (const c of candidates) {
      const got = await tryFetch(c.label, c.url);
      if (!got) continue;
      if (got.buf.length > MAX_BYTES) {
        log.push({ label: c.label, note: "too large, skipped" });
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
      res.status(502).json({ error: "NASA GIBS did not return imagery for this layer/date. Try an earlier date." });
      return;
    }
    res.setHeader("Content-Type", best.type);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("X-Gibs-Date", best.date);
    res.send(best.buf);
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to proxy NASA GIBS snapshot"
    });
  }
});
nasaRouter.get("/nasa/iss", async (_req, res) => {
  try {
    const data = await fetchLiveIssTelemetry();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to fetch ISS telemetry"
    });
  }
});
nasaRouter.get("/nasa/integration-blueprint", (_req, res) => {
  res.json({
    architecture: "Separate Express REST Adapter -> Normalized Telemetry Schema -> Web Audio Synth Frontend",
    adapterFile: "server/nasa/adapter.ts",
    liveNasaFile: "server/nasa/liveNasa.ts",
    routeFile: "server/routes/nasaRoutes.ts",
    environmentVariables: {
      NASA_API_KEY: "Set in AI Studio Secrets or .env for NASA Open APIs / DONKI / APOD / NEO",
      NASA_DATASET_SOURCE: '"test-catalog" (active fallback) or "live-nasa-api"'
    },
    activeLiveIntegrations: [
      {
        name: "NASA DONKI (Space Weather FLR & GST)",
        endpoint: "/api/nasa/donki?type=FLR|GST",
        mapping: "Maps GOES X-Ray Flare classes & Kp storm index into normalized [0..1] amplitude + spectralFlux."
      },
      {
        name: "NASA GIBS / Worldview Daily Satellite Proxy",
        endpoint: "/api/nasa/gibs/image?layer=MODIS_Terra_CorrectedReflectance_TrueColor&date=YYYY-MM-DD",
        mapping: "Serves CORS-safe daily Plate Carree satellite imagery for <canvas> ROI luminance & Three.js Globe."
      }
    ],
    sampleIngestPayload: {
      title: "Solar Flare X-Ray Burst Test",
      mission: "GOES-16 / DONKI",
      instrument: "EXIS XRS-B",
      domain: "Heliophysics",
      primaryChannelName: "Long-Wavelength X-Ray Flux",
      primaryUnit: "W/m\xB2",
      values: [12e-7, 45e-7, 19e-6, 84e-6, 42e-6, 15e-6, 6e-6, 21e-7]
    }
  });
});
nasaRouter.get("/nasa/image-proxy", async (req, res) => {
  try {
    const nasaId = typeof req.query.nasa_id === "string" ? req.query.nasa_id : void 0;
    const query = typeof req.query.q === "string" ? req.query.q : void 0;
    const asset = await fetchNasaImageBinary({ nasaId, query });
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(asset.buffer);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to fetch NASA image" });
  }
});
nasaRouter.get("/nasa/exoplanet", async (req, res) => {
  try {
    const planet = typeof req.query.name === "string" ? req.query.name : "WASP-39 b";
    const data = await fetchNasaExoplanetParameters(planet);
    if (!data) {
      res.status(404).json({ error: `Exoplanet "${planet}" not found.` });
      return;
    }
    res.json(data);
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Exoplanet TAP query failed" });
  }
});

// api-src/handler.ts
var app = express();
app.use(express.json({ limit: "4mb" }));
app.use("/api", nasaRouter);
app.use("/", nasaRouter);
var handler_default = app;
export {
  handler_default as default
};
