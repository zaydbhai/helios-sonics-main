import React, { useEffect, useRef } from 'react';
import type { EarthNowAudioEngine } from '../audio/EarthNowAudioEngine';

interface EarthNowSpectrumStripProps {
  engine: EarthNowAudioEngine;
  isPlaying: boolean;
  isMuted: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
}

export function EarthNowSpectrumStrip({
  engine,
  isPlaying,
  isMuted,
  reduceMotion,
  highContrast,
}: EarthNowSpectrumStripProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let rafId = 0;

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetW = Math.max(200, Math.floor(rect.width * dpr));
      const targetH = Math.max(48, Math.floor(rect.height * dpr));
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const w = canvas.width / dpr;
      const h = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.fillStyle = highContrast ? '#000000' : '#07090E';
      ctx.fillRect(0, 0, w, h);

      // Center baseline
      ctx.strokeStyle = highContrast ? 'rgba(255,255,255,0.2)' : 'rgba(30,41,59,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      const { fft, waveform } = engine.getAnalyserData();

      // Draw FFT frequency bars
      if (fft.length > 0 && !isMuted) {
        const usable = Math.min(64, fft.length);
        const barW = w / usable;
        for (let i = 0; i < usable; i++) {
          const norm = Math.max(0, Math.min(1, (fft[i] + 96) / 72));
          const barH = norm * (h - 6);
          ctx.fillStyle = highContrast
            ? 'rgba(253, 224, 71, 0.35)'
            : 'rgba(6, 182, 212, 0.28)';
          ctx.fillRect(i * barW, h - barH, Math.max(1, barW - 1.5), barH);
        }
      }

      // Draw crisp time-domain waveform
      if (waveform.length > 1 && !isMuted) {
        ctx.beginPath();
        for (let i = 0; i < waveform.length; i++) {
          const x = (i / (waveform.length - 1)) * w;
          const v = Math.max(-1, Math.min(1, waveform[i]));
          const y = h / 2 + v * (h * 0.42);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = highContrast ? '#FDE047' : '#22D3EE';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.restore();

      if (!reduceMotion || isPlaying) {
        rafId = requestAnimationFrame(draw);
      }
    };

    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [engine, isPlaying, isMuted, reduceMotion, highContrast]);

  return (
    <div
      className={`border-t ${
        highContrast ? 'border-white bg-black' : 'border-slate-800 bg-[#07090E]'
      }`}
    >
      <div className="flex items-center justify-between px-4 py-1 text-[10px] font-mono text-slate-400">
        <span>Live Tone.Analyser Spectrum &amp; Waveform</span>
        <span>{isMuted ? 'Muted' : isPlaying ? 'Streaming' : 'Standby'}</span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Live audio spectrum and waveform visualizer"
        className="block w-full h-12"
      />
    </div>
  );
}
