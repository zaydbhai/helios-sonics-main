import type { EarthNowFrame, NormalizedRoiBox } from '../types/earthNow';

export const ROI_PRESETS: NormalizedRoiBox[] = [
  { id: 'global', label: 'Global (Full Map)', x: 0, y: 0, w: 1, h: 1 },
  { id: 'arctic', label: 'Arctic Band (60°N–90°N)', x: 0, y: 0, w: 1, h: 0.22 },
  { id: 'tropics', label: 'Tropics / Equator', x: 0, y: 0.36, w: 1, h: 0.28 },
  { id: 'north-atlantic', label: 'North Atlantic', x: 0.28, y: 0.16, w: 0.24, h: 0.26 },
  { id: 'pacific', label: 'Western Pacific', x: 0.56, y: 0.26, w: 0.34, h: 0.34 },
];

let sharedCanvas: HTMLCanvasElement | null = null;
let sharedCtx: CanvasRenderingContext2D | null = null;
const loadedImgCache = new Map<string, HTMLImageElement>();

function getSamplerCtx(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  if (typeof document === 'undefined') return null;
  if (!sharedCanvas) {
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = 160;
    sharedCanvas.height = 80;
    sharedCtx = sharedCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!sharedCtx) return null;
  return { canvas: sharedCanvas, ctx: sharedCtx };
}

function loadCachedImage(url: string): Promise<HTMLImageElement | null> {
  const existing = loadedImgCache.get(url);
  if (existing && existing.complete && existing.naturalWidth > 0) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      loadedImgCache.set(url, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Measures average luminance (Rec. 601) and bright highlight/cloud cover percentage
 * inside a normalized [0..1] ROI box across preloaded frames using an offscreen canvas.
 */
export async function sampleFramesForRoi(
  frames: EarthNowFrame[],
  srcMap: Record<string, string>,
  roi: NormalizedRoiBox
): Promise<EarthNowFrame[]> {
  if (
    frames.length === 0 ||
    (roi.id === 'global' && roi.x === 0 && roi.y === 0 && roi.w >= 0.99 && roi.h >= 0.99)
  ) {
    return frames;
  }

  const sampler = getSamplerCtx();
  if (!sampler) return frames;
  const { canvas, ctx } = sampler;

  const sx = Math.max(0, Math.min(0.95, roi.x));
  const sy = Math.max(0, Math.min(0.95, roi.y));
  const sw = Math.max(0.05, Math.min(1 - sx, roi.w));
  const sh = Math.max(0.05, Math.min(1 - sy, roi.h));

  const rawStats: Array<{ brightness: number; cloudCover: number }> = [];

  for (const frame of frames) {
    const resolvedUrl = srcMap[frame.imageUrl] ?? frame.imageUrl;
    const img = await loadCachedImage(resolvedUrl);
    if (!img) {
      rawStats.push({ brightness: frame.brightness, cloudCover: frame.cloudCover });
      continue;
    }

    const cropX = Math.floor(sx * img.naturalWidth);
    const cropY = Math.floor(sy * img.naturalHeight);
    const cropW = Math.max(4, Math.floor(sw * img.naturalWidth));
    const cropH = Math.max(4, Math.floor(sh * img.naturalHeight));

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const totalPixels = canvas.width * canvas.height;
    let sumLuma = 0;
    let brightCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      sumLuma += luma;
      if (luma > 185) {
        brightCount++;
      }
    }

    rawStats.push({
      brightness: Number((sumLuma / totalPixels).toFixed(2)),
      cloudCover: Number(((brightCount / totalPixels) * 100).toFixed(2)),
    });
  }

  const bVals = rawStats.map((s) => s.brightness);
  const cVals = rawStats.map((s) => s.cloudCover);
  const bMin = Math.min(...bVals);
  const bSpan = Math.max(0.01, Math.max(...bVals) - bMin);
  const cMin = Math.min(...cVals);
  const cSpan = Math.max(0.01, Math.max(...cVals) - cMin);

  return frames.map((frame, i) => ({
    ...frame,
    brightness: rawStats[i].brightness,
    normalizedBrightness: Number(
      Math.max(0, Math.min(1, (rawStats[i].brightness - bMin) / bSpan)).toFixed(4)
    ),
    cloudCover: rawStats[i].cloudCover,
    normalizedCloudCover: Number(
      Math.max(0, Math.min(1, (rawStats[i].cloudCover - cMin) / cSpan)).toFixed(4)
    ),
  }));
}

export function detectSpikeFrames(frames: EarthNowFrame[]): Set<number> {
  const spikes = new Set<number>();
  for (let i = 1; i < frames.length; i++) {
    const db = Math.abs(frames[i].normalizedBrightness - frames[i - 1].normalizedBrightness);
    const dc = Math.abs(frames[i].normalizedCloudCover - frames[i - 1].normalizedCloudCover);
    if (db >= 0.18 || dc >= 0.24) {
      spikes.add(i);
    }
  }
  return spikes;
}

export function computePearsonCorrelation(seriesA: number[], seriesB: number[]): number | null {
  const n = Math.min(seriesA.length, seriesB.length);
  if (n < 3) return null;

  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += seriesA[i];
    sumB += seriesB[i];
  }
  const meanA = sumA / n;
  const meanB = sumB / n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = seriesA[i] - meanA;
    const db = seriesB[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const denom = Math.sqrt(denA * denB);
  if (denom < 1e-9) return 0;
  return Math.max(-1, Math.min(1, num / denom));
}
