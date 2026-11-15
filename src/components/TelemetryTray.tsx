import React, { useMemo, useRef, useState } from 'react';
import type { LiveAudioMetrics } from '../audio/SonificationEngine';
import type { NasaDatasetRecord } from '../types/nasa';

interface TelemetryTrayProps {
  dataset: NasaDatasetRecord | null;
  currentSampleIndex: number;
  metrics: LiveAudioMetrics;
  onSeek: (sampleIndex: number) => void;
}

export function TelemetryTray({
  dataset,
  currentSampleIndex,
  metrics,
  onSeek,
}: TelemetryTrayProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const samples = dataset?.samples ?? [];
  const activeIdx = Math.min(
    Math.max(0, Math.floor(currentSampleIndex)),
    Math.max(0, samples.length - 1)
  );
  const activeSample = samples[activeIdx];
  const inspectedSample = hoverIndex !== null ? samples[hoverIndex] : activeSample;

  const { primaryPath, secondaryPath, areaPath } = useMemo(() => {
    if (samples.length < 2) {
      return { primaryPath: '', secondaryPath: '', areaPath: '' };
    }
    const w = 1000;
    const h = 110;
    const padY = 8;
    const usableH = h - padY * 2;

    const pPoints = samples.map((s, idx) => {
      const x = (idx / (samples.length - 1)) * w;
      const y = h - padY - s.normalized * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    const sPoints = samples.map((s, idx) => {
      const x = (idx / (samples.length - 1)) * w;
      const y = h - padY - s.secondaryNormalized * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });

    return {
      primaryPath: `M ${pPoints.join(' L ')}`,
      secondaryPath: `M ${sPoints.join(' L ')}`,
      areaPath: `M 0,${h} L ${pPoints.join(' L ')} L ${w},${h} Z`,
    };
  }, [samples]);

  const handlePointer = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || samples.length === 0) return;
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(ratio * (samples.length - 1));
  };

  const playheadPct =
    samples.length > 1 ? (currentSampleIndex / (samples.length - 1)) * 100 : 0;

  return (
    <section
      aria-label="Synchronized NASA telemetry and audio metrics"
      className="border-t border-slate-800 bg-[#0B0F19] px-5 py-3"
    >
      {/* Top Row: Live Tabular Telemetry Readouts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 pb-3 border-b border-slate-800/80">
        <div>
          <div className="text-[11px] font-medium text-slate-400">
            {dataset?.primaryChannelName ?? 'Primary Channel'}
          </div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {inspectedSample ? inspectedSample.primaryValue : '—'}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">
              {dataset?.primaryUnit ?? ''}
            </span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-slate-400">
            {dataset?.secondaryChannelName ?? 'Secondary Channel'}
          </div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-lg font-semibold text-amber-400 tabular-nums">
              {inspectedSample ? inspectedSample.secondaryValue : '—'}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">
              {dataset?.secondaryUnit ?? ''}
            </span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-slate-400">Peak Audio Frequency</div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-lg font-semibold text-cyan-400 tabular-nums">
              {metrics.peakFrequencyHz}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">Hz</span>
          </div>
        </div>

        <div>
          <div className="text-[11px] font-medium text-slate-400">Spectral Centroid</div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {metrics.spectralCentroidHz}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">Hz</span>
          </div>
        </div>

        <div className="col-span-2 sm:col-span-1">
          <div className="text-[11px] font-medium text-slate-400">Signal RMS Level</div>
          <div className="mt-0.5 flex items-baseline">
            <span className="font-mono text-lg font-semibold text-slate-100 tabular-nums">
              {metrics.rmsDb.toFixed(1)}
            </span>
            <span className="ml-1.5 font-mono text-[11px] text-slate-400">dBFS</span>
          </div>
        </div>
      </div>

      {/* Bottom Row: Interactive Time-Series Scrubber */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mb-1.5 tabular-nums">
          <div className="flex items-center gap-3">
            <span className="text-slate-200">Time-Series Telemetry Envelope</span>
            <span aria-hidden="true">·</span>
            <span className="text-cyan-400">Solid: {dataset?.primaryChannelName ?? 'Primary'}</span>
            <span aria-hidden="true">·</span>
            <span className="text-amber-400">Dashed: {dataset?.secondaryChannelName ?? 'Secondary'}</span>
          </div>
          <div>
            <span>
              Sample {activeIdx + 1} / {samples.length}
            </span>
            {inspectedSample && (
              <>
                <span className="mx-2 text-slate-600">·</span>
                <span>{inspectedSample.timestamp.replace('T', ' ').replace('Z', ' UTC')}</span>
              </>
            )}
          </div>
        </div>

        <div className="relative h-[106px] w-full bg-[#07090E] border border-slate-800">
          <svg
            ref={svgRef}
            viewBox="0 0 1000 110"
            preserveAspectRatio="none"
            onClick={(e) => {
              const idx = handlePointer(e.clientX);
              if (idx !== undefined) onSeek(idx);
            }}
            onMouseMove={(e) => {
              const idx = handlePointer(e.clientX);
              if (idx !== undefined) setHoverIndex(idx);
            }}
            onMouseLeave={() => setHoverIndex(null)}
            className="w-full h-full cursor-crosshair block"
          >
            <defs>
              <linearGradient id="cyanAreaFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#06B6D4" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#06B6D4" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            {/* Horizontal reference ticks */}
            <line x1="0" y1="28" x2="1000" y2="28" stroke="#1E293B" strokeWidth="1" />
            <line x1="0" y1="55" x2="1000" y2="55" stroke="#1E293B" strokeWidth="1" />
            <line x1="0" y1="82" x2="1000" y2="82" stroke="#1E293B" strokeWidth="1" />

            {areaPath && <path d={areaPath} fill="url(#cyanAreaFill)" />}
            {secondaryPath && (
              <path
                d={secondaryPath}
                fill="none"
                stroke="#F59E0B"
                strokeWidth="1.4"
                strokeDasharray="4 4"
                opacity="0.75"
              />
            )}
            {primaryPath && (
              <path
                d={primaryPath}
                fill="none"
                stroke="#06B6D4"
                strokeWidth="1.8"
              />
            )}

            {/* Hover crosshair */}
            {hoverIndex !== null && samples.length > 1 && (
              <line
                x1={(hoverIndex / (samples.length - 1)) * 1000}
                y1="0"
                x2={(hoverIndex / (samples.length - 1)) * 1000}
                y2="110"
                stroke="#94A3B8"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
            )}
          </svg>

          {/* Active Playhead Line */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 w-[2px] bg-amber-400"
            style={{ left: `${playheadPct}%` }}
          />
        </div>
      </div>
    </section>
  );
}
