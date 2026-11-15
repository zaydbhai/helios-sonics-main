import React, { useState } from 'react';
import { X, Music, FileSpreadsheet, Upload } from 'lucide-react';
import { ingestCustomDataset } from '../services/nasaApi';
import type { NasaDatasetRecord } from '../types/nasa';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAudioFileSelected: (file: File) => void;
  onTelemetryIngested: (dataset: NasaDatasetRecord) => void;
}

export function UploadModal({
  isOpen,
  onClose,
  onAudioFileSelected,
  onTelemetryIngested,
}: UploadModalProps) {
  const [tab, setTab] = useState<'audio' | 'csv'>('audio');
  const [csvTitle, setCsvTitle] = useState('Uploaded NASA Telemetry CSV');
  const [csvUnit, setCsvUnit] = useState('nT');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleAudioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onAudioFileSelected(file);
    onClose();
  };

  const handleCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSubmitting(true);

    try {
      const text = await file.text();
      let values: number[] = [];

      if (file.name.endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
          values = parsed
            .map((item) => (typeof item === 'number' ? item : Number(item?.value ?? item?.primaryValue)))
            .filter((n) => Number.isFinite(n));
        } else if (Array.isArray(parsed?.values)) {
          values = parsed.values.map(Number).filter((n: number) => Number.isFinite(n));
        }
      } else {
        // Parse CSV/TSV first numeric column per row
        const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          const cells = line.split(/[,;\t]/);
          for (const cell of cells) {
            const num = Number(cell.trim());
            if (Number.isFinite(num)) {
              values.push(num);
              break;
            }
          }
        }
      }

      if (values.length < 4) {
        throw new Error('Could not extract at least 4 finite numeric samples from file.');
      }

      const record = await ingestCustomDataset({
        title: csvTitle.trim() || file.name,
        mission: 'Local Dataset Upload',
        primaryUnit: csvUnit.trim() || 'units',
        values: values.slice(0, 1000),
      });
      onTelemetryIngested(record);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse telemetry file.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Load Audio or NASA Telemetry File"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="w-full max-w-lg bg-[#0B0F19] border border-slate-700 p-6">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <h2 className="text-base font-semibold text-slate-100">
            Load Audio Track or Telemetry File
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-100 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-4 flex gap-1 bg-[#07090E] p-1 border border-slate-800">
          <button
            type="button"
            onClick={() => {
              setTab('audio');
              setError(null);
            }}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'audio'
                ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            Audio File (.mp3 / .wav)
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('csv');
              setError(null);
            }}
            className={`flex-1 inline-flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
              tab === 'csv'
                ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            NASA CSV / JSON
          </button>
        </div>

        {error && (
          <div className="mt-4 border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {tab === 'audio' ? (
          <div className="mt-5 space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Route any local audio file directly through the Web Audio FFT analyzer to test the Orbital, Spectrogram Waterfall, and Phase Lissajous visualizers.
            </p>
            <label className="flex flex-col items-center justify-center border border-dashed border-slate-700 bg-[#07090E] p-8 hover:border-cyan-500/60 transition-colors cursor-pointer">
              <Upload className="w-6 h-6 text-cyan-400 mb-2" />
              <span className="text-sm font-medium text-slate-200">
                Select Audio File
              </span>
              <span className="mt-1 text-xs text-slate-400">
                MP3, WAV, OGG, FLAC, or M4A
              </span>
              <input
                type="file"
                accept="audio/*"
                onChange={handleAudioChange}
                className="hidden"
              />
            </label>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <p className="text-xs text-slate-400 leading-relaxed">
              Upload a CSV or JSON telemetry export. The Express backend normalizes the first numeric column into a playable NASA sonification dataset.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-slate-400">Dataset Name</span>
                <input
                  type="text"
                  value={csvTitle}
                  onChange={(e) => setCsvTitle(e.target.value)}
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-slate-400">Physical Unit</span>
                <input
                  type="text"
                  value={csvUnit}
                  onChange={(e) => setCsvUnit(e.target.value)}
                  className="mt-1 w-full bg-[#07090E] border border-slate-700 px-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:border-cyan-500"
                />
              </label>
            </div>
            <label className="flex flex-col items-center justify-center border border-dashed border-slate-700 bg-[#07090E] p-8 hover:border-cyan-500/60 transition-colors cursor-pointer">
              <FileSpreadsheet className="w-6 h-6 text-amber-400 mb-2" />
              <span className="text-sm font-medium text-slate-200">
                {submitting ? 'Ingesting into Backend...' : 'Select CSV or JSON Telemetry'}
              </span>
              <span className="mt-1 text-xs text-slate-400">
                Up to 1,000 samples per series
              </span>
              <input
                type="file"
                accept=".csv,.txt,.json"
                onChange={handleCsvChange}
                disabled={submitting}
                className="hidden"
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
