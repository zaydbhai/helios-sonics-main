import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { LiveAudioMetrics, SonificationEngine } from '../audio/SonificationEngine';
import type { NasaDatasetRecord, TelemetrySample, VisualizationMode } from '../types/nasa';
import { Globe3DView } from './Globe3DView';

export interface VisualizationStageHandle {
  exportPng: () => void;
}

interface VisualizationStageProps {
  engine: SonificationEngine;
  dataset: NasaDatasetRecord | null;
  currentSampleIndex: number;
  isPlaying: boolean;
  mode: VisualizationMode;
  showTelemetryOverlay: boolean;
  showHarmonicGrid: boolean;
  showPeakHold: boolean;
  onMetricsUpdate: (metrics: LiveAudioMetrics) => void;
}

function scientificColorRamp(value01: number): [number, number, number] {
  // Deep Obsidian -> Cobalt -> Laser Cyan -> Telemetry Amber -> White
  const v = Math.max(0, Math.min(1, value01));
  if (v < 0.25) {
    const t = v / 0.25;
    return [
      Math.round(7 + t * 18),
      Math.round(9 + t * 48),
      Math.round(14 + t * 120),
    ];
  }
  if (v < 0.55) {
    const t = (v - 0.25) / 0.3;
    return [
      Math.round(25 - t * 19),
      Math.round(57 + t * 125),
      Math.round(134 + t * 78),
    ];
  }
  if (v < 0.85) {
    const t = (v - 0.55) / 0.3;
    return [
      Math.round(6 + t * 239),
      Math.round(182 - t * 24),
      Math.round(212 - t * 201),
    ];
  }
  const t = (v - 0.85) / 0.15;
  return [
    Math.round(245 + t * 10),
    Math.round(158 + t * 92),
    Math.round(11 + t * 230),
  ];
}

export const VisualizationStage = React.forwardRef<
  VisualizationStageHandle,
  VisualizationStageProps
>(function VisualizationStage(
  {
    engine,
    dataset,
    currentSampleIndex,
    isPlaying,
    mode,
    showTelemetryOverlay,
    showHarmonicGrid,
    showPeakHold,
    onMetricsUpdate,
  },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const waterfallCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const peakHoldRef = useRef<Float32Array>(new Float32Array(128));
  const rotationRef = useRef<number>(0);
  const lastMetricPushRef = useRef<number>(0);

  const [cursorProbe, setCursorProbe] = useState<{
    x: number;
    y: number;
    freqHz: number;
    magnitudeDb: number;
  } | null>(null);

  const renderStateRef = useRef({
    dataset,
    currentSampleIndex,
    isPlaying,
    mode,
    showTelemetryOverlay,
    showHarmonicGrid,
    showPeakHold,
    onMetricsUpdate,
  });

  renderStateRef.current = {
    dataset,
    currentSampleIndex,
    isPlaying,
    mode,
    showTelemetryOverlay,
    showHarmonicGrid,
    showPeakHold,
    onMetricsUpdate,
  };

  useImperativeHandle(ref, () => ({
    exportPng: () => {
      const targetCanvas =
        mode === 'globe3d'
          ? containerRef.current?.querySelector('canvas')
          : canvasRef.current;
      if (!targetCanvas) return;
      const url = targetCanvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url;
      a.download = `${dataset?.id ?? 'helios-sonics'}-${mode}.png`;
      a.click();
    },
  }));

  useEffect(() => {
    if (mode === 'globe3d') return;
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(320, Math.floor(rect.width * dpr));
      canvas.height = Math.max(280, Math.floor(rect.height * dpr));

      if (!waterfallCanvasRef.current) {
        waterfallCanvasRef.current = document.createElement('canvas');
      }
      const wf = waterfallCanvasRef.current;
      if (wf.width !== Math.floor(rect.width) || wf.height !== Math.floor(rect.height)) {
        wf.width = Math.max(320, Math.floor(rect.width));
        wf.height = Math.max(280, Math.floor(rect.height));
        const wfCtx = wf.getContext('2d');
        if (wfCtx) {
          wfCtx.fillStyle = '#07090E';
          wfCtx.fillRect(0, 0, wf.width, wf.height);
        }
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    return () => observer.disconnect();
  }, [mode]);

  useEffect(() => {
    if (mode === 'globe3d') return;
    let rafId = 0;

    const renderFrame = (timestamp: number) => {
      const state = renderStateRef.current;
      const samples = state.dataset?.samples ?? [];
      const activeSample: TelemetrySample | undefined =
        samples[Math.min(samples.length - 1, Math.max(0, Math.floor(state.currentSampleIndex)))];

      const { freq, time, metrics } = engine.getSpectrumData(activeSample, state.isPlaying);

      if (timestamp - lastMetricPushRef.current > 85) {
        lastMetricPushRef.current = timestamp;
        state.onMetricsUpdate(metrics);
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const width = canvas.width / dpr;
          const height = canvas.height / dpr;

          ctx.save();
          ctx.scale(dpr, dpr);

          // Clear stage
          ctx.fillStyle = '#07090E';
          ctx.fillRect(0, 0, width, height);

          if (state.mode === 'orbital') {
            drawOrbitalSpectrum(
              ctx,
              width,
              height,
              freq,
              time,
              samples,
              state.currentSampleIndex,
              activeSample,
              state.isPlaying,
              state.showHarmonicGrid,
              state.showTelemetryOverlay,
              state.showPeakHold,
              peakHoldRef.current,
              rotationRef
            );
          } else if (state.mode === 'spectrogram') {
            drawSpectrogramWaterfall(
              ctx,
              waterfallCanvasRef.current,
              width,
              height,
              freq,
              engine.sampleRate,
              state.isPlaying,
              state.showHarmonicGrid
            );
          } else {
            drawOscilloscopeAndLissajous(
              ctx,
              width,
              height,
              time,
              freq,
              activeSample,
              state.showHarmonicGrid,
              state.showTelemetryOverlay
            );
          }

          ctx.restore();
        }
      }

      rafId = requestAnimationFrame(renderFrame);
    };

    rafId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(rafId);
  }, [engine, mode]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const nyquist = engine.sampleRate / 2;
    let freqHz = 0;
    let magnitudeDb = -72;

    if (mode === 'spectrogram') {
      const yRatio = 1 - Math.max(0, Math.min(1, y / rect.height));
      freqHz = Math.round(yRatio * Math.min(10000, nyquist));
      magnitudeDb = Number((-80 + yRatio * 70).toFixed(1));
    } else if (mode === 'orbital') {
      const cx = rect.width / 2;
      const cy = rect.height / 2;
      const dist = Math.hypot(x - cx, y - cy);
      const maxR = Math.min(rect.width, rect.height) * 0.42;
      const norm = Math.max(0, Math.min(1, dist / maxR));
      freqHz = Math.round(norm * 6000);
      magnitudeDb = Number((-78 + norm * 72).toFixed(1));
    } else {
      freqHz = Math.round((x / rect.width) * 4000);
      magnitudeDb = Number((-60 + (1 - y / rect.height) * 60).toFixed(1));
    }

    setCursorProbe({ x: Math.round(x), y: Math.round(y), freqHz, magnitudeDb });
  };

  const samples = dataset?.samples ?? [];
  const activeSample: TelemetrySample | undefined =
    samples[Math.min(samples.length - 1, Math.max(0, Math.floor(currentSampleIndex)))];

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-[380px] bg-[#07090E] overflow-hidden select-none"
    >
      {mode === 'globe3d' ? (
        <Globe3DView
          normalizedIntensity={activeSample?.normalized ?? 0.35}
          cloudCoverNormalized={activeSample?.spectralFlux ?? 0.25}
          isPlaying={isPlaying}
          accentColor={dataset?.accentColor ?? '#06B6D4'}
          getSpectrumBins={() => engine.getSpectrumData(activeSample, isPlaying).freq}
          label="3D Orbital Satellite & Telemetry Sphere"
          sublabel={dataset?.mission}
        />
      ) : (
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setCursorProbe(null)}
          className="block w-full h-full cursor-crosshair"
        />
      )}

      {/* Minimal Corner Axis & Probe HUD */}
      {mode !== 'globe3d' && (
        <div className="pointer-events-none absolute top-3 left-4 flex items-center gap-3 font-mono text-[11px] text-slate-400 tabular-nums">
          <span className="text-slate-200 font-medium">
            {mode === 'orbital'
              ? 'Polar Harmonic Field'
              : mode === 'spectrogram'
              ? 'Time-Frequency Waterfall'
              : 'Dual-Trace Phase Scope'}
          </span>
          <span aria-hidden="true">·</span>
          <span>FFT 2048</span>
          <span aria-hidden="true">·</span>
          <span>{(engine.sampleRate / 1000).toFixed(1)} kHz</span>
        </div>
      )}

      {cursorProbe && mode !== 'globe3d' && (
        <div className="pointer-events-none absolute bottom-3 right-4 bg-[#0B0F19]/90 border border-slate-800 px-3 py-1.5 font-mono text-[11px] text-slate-300 tabular-nums">
          <span>X {cursorProbe.x}px</span>
          <span className="mx-2 text-slate-600">/</span>
          <span>Y {cursorProbe.y}px</span>
          <span className="mx-2 text-slate-600">/</span>
          <span className="text-cyan-400">{cursorProbe.freqHz} Hz</span>
          <span className="mx-2 text-slate-600">/</span>
          <span className="text-amber-400">{cursorProbe.magnitudeDb} dB</span>
        </div>
      )}

      {mode === 'spectrogram' && (
        <div className="pointer-events-none absolute top-3 right-4 flex items-center gap-2 bg-[#0B0F19]/90 border border-slate-800 px-2.5 py-1 font-mono text-[10px] text-slate-400 tabular-nums">
          <span>-80 dB</span>
          <div
            className="w-24 h-2"
            style={{
              background:
                'linear-gradient(90deg, #07090E 0%, #193986 25%, #06B6D4 55%, #F59E0B 85%, #FFF8EE 100%)',
            }}
          />
          <span>-10 dB</span>
        </div>
      )}
    </div>
  );
});

function drawOrbitalSpectrum(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  freq: Uint8Array,
  time: Uint8Array,
  samples: TelemetrySample[],
  currentSampleIndex: number,
  activeSample: TelemetrySample | undefined,
  isPlaying: boolean,
  showHarmonicGrid: boolean,
  showTelemetryOverlay: boolean,
  showPeakHold: boolean,
  peakHold: Float32Array,
  rotationRef: React.MutableRefObject<number>
) {
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);
  const innerRadius = minDim * 0.16;
  const maxRadius = minDim * 0.41;

  if (isPlaying) {
    rotationRef.current += 0.0022;
  }

  // Background coordinate grid
  if (showHarmonicGrid) {
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.7)';
    ctx.lineWidth = 1;
    const rings = [0.25, 0.5, 0.75, 1.0];
    const dbLabels = ['-60 dB', '-40 dB', '-20 dB', '0 dB'];

    rings.forEach((ratio, idx) => {
      const r = innerRadius + (maxRadius - innerRadius) * ratio;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = 'rgba(148, 163, 184, 0.55)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(dbLabels[idx], cx + 6, cy - r + 11);
    });

    // Azimuth radial lines every 30 degrees
    for (let deg = 0; deg < 360; deg += 30) {
      const rad = (deg * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * innerRadius * 0.6, cy + Math.sin(rad) * innerRadius * 0.6);
      ctx.lineTo(cx + Math.cos(rad) * maxRadius * 1.06, cy + Math.sin(rad) * maxRadius * 1.06);
      ctx.strokeStyle = deg % 90 === 0 ? 'rgba(51, 65, 85, 0.75)' : 'rgba(30, 41, 59, 0.45)';
      ctx.stroke();
    }
  }

  // NASA Telemetry Orbit Ring (maps full dataset curve around the circle)
  if (showTelemetryOverlay && samples.length > 2) {
    ctx.beginPath();
    for (let i = 0; i <= samples.length; i++) {
      const sample = samples[i % samples.length];
      const angle = (i / samples.length) * Math.PI * 2 - Math.PI / 2;
      const r = innerRadius * 0.72 + sample.normalized * (innerRadius * 0.42);
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Active mission sample marker on orbit
    const activeAngle =
      (currentSampleIndex / Math.max(1, samples.length)) * Math.PI * 2 - Math.PI / 2;
    const activeR =
      innerRadius * 0.72 + (activeSample?.normalized ?? 0) * (innerRadius * 0.42);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(activeAngle) * activeR, cy + Math.sin(activeAngle) * activeR, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#F59E0B';
    ctx.fill();
  }

  // Radial FFT Spectrum Bars (128 logarithmic-weighted bins)
  const barCount = 128;
  const usableBins = Math.floor(freq.length * 0.52);

  for (let i = 0; i < barCount; i++) {
    const logIndex = Math.floor(Math.pow(i / barCount, 1.5) * usableBins);
    const mag = freq[Math.min(usableBins - 1, logIndex)] / 255;

    if (mag > peakHold[i]) {
      peakHold[i] = mag;
    } else {
      peakHold[i] = Math.max(0, peakHold[i] - 0.008);
    }

    const angle = (i / barCount) * Math.PI * 2 - Math.PI / 2 + rotationRef.current;
    const barLen = mag * (maxRadius - innerRadius);
    const x1 = cx + Math.cos(angle) * innerRadius;
    const y1 = cy + Math.sin(angle) * innerRadius;
    const x2 = cx + Math.cos(angle) * (innerRadius + barLen);
    const y2 = cy + Math.sin(angle) * (innerRadius + barLen);

    const [r, g, b] = scientificColorRamp(0.25 + mag * 0.75);
    ctx.strokeStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (showPeakHold && peakHold[i] > 0.04) {
      const pr = innerRadius + peakHold[i] * (maxRadius - innerRadius) + 3;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
      ctx.fillRect(cx + Math.cos(angle) * pr - 1, cy + Math.sin(angle) * pr - 1, 2, 2);
    }
  }

  // Inner Time-Domain Waveform Loop
  ctx.beginPath();
  const wavePoints = 180;
  for (let i = 0; i <= wavePoints; i++) {
    const idx = Math.floor(((i % wavePoints) / wavePoints) * time.length);
    const amp = (time[idx] - 128) / 128;
    const angle = (i / wavePoints) * Math.PI * 2 - Math.PI / 2;
    const r = innerRadius * 0.56 + amp * 18;
    const px = cx + Math.cos(angle) * r;
    const py = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = '#06B6D4';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Center core readout
  ctx.fillStyle = '#E2E8F0';
  ctx.font = '600 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText(
    activeSample ? `${activeSample.primaryValue}` : '0.00',
    cx,
    cy + 3
  );
  ctx.fillStyle = '#64748B';
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillText(isPlaying ? 'ACTIVE' : 'IDLE', cx, cy + 18);
  ctx.textAlign = 'left';
}

function drawSpectrogramWaterfall(
  ctx: CanvasRenderingContext2D,
  waterfallCanvas: HTMLCanvasElement | null,
  width: number,
  height: number,
  freq: Uint8Array,
  sampleRate: number,
  isPlaying: boolean,
  showHarmonicGrid: boolean
) {
  if (!waterfallCanvas) return;
  const wfCtx = waterfallCanvas.getContext('2d');
  if (!wfCtx) return;

  const wfW = waterfallCanvas.width;
  const wfH = waterfallCanvas.height;

  if (isPlaying) {
    // Shift existing waterfall 2px to the left
    const imageData = wfCtx.getImageData(2, 0, wfW - 2, wfH);
    wfCtx.putImageData(imageData, 0, 0);

    // Draw new 2px frequency slice on the right edge (0 Hz at bottom -> 10 kHz at top)
    const maxDisplayHz = Math.min(10000, sampleRate / 2);
    const nyquist = sampleRate / 2;

    for (let y = 0; y < wfH; y++) {
      const freqRatio = 1 - y / wfH;
      const targetHz = freqRatio * maxDisplayHz;
      const binIndex = Math.min(
        freq.length - 1,
        Math.max(0, Math.floor((targetHz / nyquist) * freq.length))
      );
      const val = freq[binIndex] / 255;
      const [r, g, b] = scientificColorRamp(val);
      wfCtx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      wfCtx.fillRect(wfW - 2, y, 2, 1);
    }
  }

  ctx.drawImage(waterfallCanvas, 0, 0, width, height);

  if (showHarmonicGrid) {
    const maxDisplayHz = Math.min(10000, sampleRate / 2);
    const markers = [500, 1000, 2000, 4000, 6000, 8000];
    ctx.font = '10px "JetBrains Mono", monospace';

    for (const hz of markers) {
      if (hz >= maxDisplayHz) continue;
      const y = Math.round((1 - hz / maxDisplayHz) * height);
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(226, 232, 240, 0.65)';
      ctx.fillText(hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`, 12, y - 4);
    }
  }
}

function drawOscilloscopeAndLissajous(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: Uint8Array,
  freq: Uint8Array,
  activeSample: TelemetrySample | undefined,
  showHarmonicGrid: boolean,
  showTelemetryOverlay: boolean
) {
  const splitX = width * 0.64;

  // Grid
  if (showHarmonicGrid) {
    ctx.strokeStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 48) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  // Divider between Scope and Lissajous
  ctx.strokeStyle = '#1E293B';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(splitX, 16);
  ctx.lineTo(splitX, height - 16);
  ctx.stroke();

  // Left: Time-Domain Oscilloscope
  const midY = height / 2;
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
  ctx.beginPath();
  ctx.moveTo(16, midY);
  ctx.lineTo(splitX - 16, midY);
  ctx.stroke();

  ctx.beginPath();
  const scopeW = splitX - 32;
  for (let i = 0; i < time.length; i++) {
    const x = 16 + (i / (time.length - 1)) * scopeW;
    const v = (time[i] - 128) / 128;
    const y = midY + v * (height * 0.34);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#06B6D4';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Bottom miniature spectrum bars in left pane
  if (showTelemetryOverlay) {
    const barCount = 48;
    const barW = scopeW / barCount;
    for (let i = 0; i < barCount; i++) {
      const val = freq[i * 3] / 255;
      const barH = val * (height * 0.16);
      ctx.fillStyle = 'rgba(245, 158, 11, 0.45)';
      ctx.fillRect(16 + i * barW, height - 16 - barH, Math.max(1, barW - 2), barH);
    }
  }

  // Right: Quadrature Phase Lissajous Figure
  const lcx = splitX + (width - splitX) / 2;
  const lcy = height / 2;
  const radius = Math.min(width - splitX, height) * 0.36;

  ctx.strokeStyle = 'rgba(51, 65, 85, 0.6)';
  ctx.beginPath();
  ctx.arc(lcx, lcy, radius, 0, Math.PI * 2);
  ctx.stroke();

  const phaseOffset = Math.floor(time.length * 0.08);
  ctx.beginPath();
  for (let i = 0; i < time.length - phaseOffset; i += 2) {
    const vx = (time[i] - 128) / 128;
    const vy = (time[i + phaseOffset] - 128) / 128;
    const px = lcx + vx * radius * (0.9 + (activeSample?.normalized ?? 0) * 0.35);
    const py = lcy + vy * radius * (0.9 + (activeSample?.secondaryNormalized ?? 0) * 0.35);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = '#F59E0B';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = '#94A3B8';
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillText('CH-A / CH-B PHASE', splitX + 18, height - 20);
}
