import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Mic,
  Radio,
  Download,
  Sliders,
  Layers,
  Upload,
  Accessibility,
} from 'lucide-react';
import {
  buildAutoCalibratedParams,
  SonificationEngine,
  type LiveAudioMetrics,
  type SoundProfile,
  type SynthParams,
} from './audio/SonificationEngine';
import {
  VisualizationStage,
  type VisualizationStageHandle,
} from './components/VisualizationStage';
import { TelemetryTray } from './components/TelemetryTray';
import { BackendConsole } from './components/BackendConsole';
import { EarthNowTab, type EarthNowTabHandle, type GlobalA11yProps } from './components/EarthNowTab';
import { HomeTab } from './components/HomeTab';
import { MissionsTab, type MissionsTabHandle } from './components/MissionsTab';
import { UploadModal } from './components/UploadModal';
import { fetchDatasetById, fetchDatasets, fetchDonkiSpaceWeather } from './services/nasaApi';
import type {
  AudioInputSource,
  NasaDatasetRecord,
  NasaDatasetSummary,
  VisualizationMode,
} from './types/nasa';

type ActiveView = 'home' | 'observatory' | 'earth-now' | 'missions' | 'backend';

interface GlobalKeyboardShortcutsOptions {
  enabled: boolean;
  onTogglePlayback: () => void;
  onResetTimeline: () => void;
  onToggleMute: () => void;
}

/**
 * Registers global window keyboard shortcuts (Space, R, M) accessible across all views,
 * while ignoring keystrokes inside editable inputs and avoiding double-firing on focused buttons.
 */
function useGlobalKeyboardShortcuts({
  enabled,
  onTogglePlayback,
  onResetTimeline,
  onToggleMute,
}: GlobalKeyboardShortcutsOptions) {
  const callbacksRef = useRef({
    onTogglePlayback,
    onResetTimeline,
    onToggleMute,
  });

  useEffect(() => {
    callbacksRef.current = {
      onTogglePlayback,
      onResetTimeline,
      onToggleMute,
    };
  }, [onTogglePlayback, onResetTimeline, onToggleMute]);

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
        // Let focused buttons/links handle Space natively without double-toggling
        if ((tag === 'BUTTON' || tag === 'A') && event.code === 'Space') {
          return;
        }
      }

      if (event.code === 'Space') {
        event.preventDefault();
        callbacksRef.current.onTogglePlayback();
      } else if (event.code === 'KeyR') {
        event.preventDefault();
        callbacksRef.current.onResetTimeline();
      } else if (event.code === 'KeyM') {
        event.preventDefault();
        callbacksRef.current.onToggleMute();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enabled]);
}

export default function App() {
  const engine = useMemo(() => new SonificationEngine(), []);
  const stageRef = useRef<VisualizationStageHandle | null>(null);
  const earthNowRef = useRef<EarthNowTabHandle | null>(null);
  const missionsRef = useRef<MissionsTabHandle | null>(null);
  const datasetCacheRef = useRef<Map<string, NasaDatasetRecord>>(new Map());

  const [activeView, setActiveView] = useState<ActiveView>(() => {
    if (typeof window === 'undefined') return 'home';
    const v = new URLSearchParams(window.location.search).get('view');
    if (
      v === 'home' ||
      v === 'observatory' ||
      v === 'earth-now' ||
      v === 'missions' ||
      v === 'backend'
    ) {
      return v;
    }
    if (v === 'schema') return 'backend';
    return 'home';
  });
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  // Global Accessibility State
  const [a11yMenuOpen, setA11yMenuOpen] = useState(false);
  const [largerText, setLargerText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  const [spokenNarration, setSpokenNarration] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("a11y-large-text", largerText);
    root.classList.toggle("a11y-high-contrast", highContrast);
    root.classList.toggle("a11y-reduce-motion", reduceMotion);
  }, [largerText, highContrast, reduceMotion]);
  const [donkiLoading, setDonkiLoading] = useState<'FLR' | 'GST' | null>(null);
  const [donkiNotice, setDonkiNotice] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || activeView === 'earth-now') return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', activeView);
    window.history.replaceState({}, '', url.toString());
  }, [activeView]);

  // Dataset State
  const [summaries, setSummaries] = useState<NasaDatasetSummary[]>([]);
  const [domainFilter, setDomainFilter] = useState<string>('All');
  const [activeDataset, setActiveDataset] = useState<NasaDatasetRecord | null>(null);
  const [loadingDataset, setLoadingDataset] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio & Playback State
  const [inputSource, setInputSource] = useState<AudioInputSource>('nasa-synth');
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSampleIndex, setCurrentSampleIndex] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

  // Synth Parameters & Auto-Calibrated Sound Profile
  const [soundProfile, setSoundProfile] = useState<SoundProfile>('ambient-space');
  const [synthParams, setSynthParams] = useState<SynthParams>({
    baseFrequencyHz: 98,
    harmonicSpread: 1.5,
    filterCutoffHz: 1650,
    filterQ: 1.6,
    waveform: 'triangle',
    modulationDepth: 0.22,
    volume: 0.65,
    scaleMode: 'pentatonic',
    soundProfile: 'ambient-space',
  });

  // Visualizer Controls
  const [visMode, setVisMode] = useState<VisualizationMode>('orbital');
  const [showTelemetryOverlay, setShowTelemetryOverlay] = useState(true);
  const [showHarmonicGrid, setShowHarmonicGrid] = useState(true);
  const [showPeakHold, setShowPeakHold] = useState(true);

  const [metrics, setMetrics] = useState<LiveAudioMetrics>({
    peakFrequencyHz: 0,
    rmsDb: -72,
    spectralCentroidHz: 0,
    peakBinNormalized: 0,
  });

  // Keep latest soundProfile in a ref so loadDatasetById remains identity-stable
  const soundProfileRef = useRef<SoundProfile>(soundProfile);
  soundProfileRef.current = soundProfile;

  const applyProfileToDataset = useCallback(
    (record: NasaDatasetRecord, profile: SoundProfile, currentVolume: number): SynthParams => {
      return buildAutoCalibratedParams(record, profile, currentVolume);
    },
    []
  );

  const loadDatasetById = useCallback(async (id: string) => {
    setErrorMsg(null);
    const cached = datasetCacheRef.current.get(id);
    if (cached) {
      setActiveDataset(cached);
      setCurrentSampleIndex(0);
      setLoadingDataset(false);
      setSynthParams((prev) =>
        buildAutoCalibratedParams(cached, soundProfileRef.current, prev.volume)
      );
      return;
    }

    setLoadingDataset(true);
    try {
      const record = await fetchDatasetById(id);
      datasetCacheRef.current.set(id, record);
      setActiveDataset(record);
      setCurrentSampleIndex(0);
      setSynthParams((prev) =>
        buildAutoCalibratedParams(record, soundProfileRef.current, prev.volume)
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load NASA dataset');
    } finally {
      setLoadingDataset(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDatasets()
      .then((res) => {
        if (cancelled) return;
        setSummaries(res.datasets);
        if (res.datasets.length > 0) {
          void loadDatasetById(res.datasets[0].id).then(() => {
            if (cancelled) return;
            // Background prefetch remaining catalog entries for instantaneous 0ms switching
            for (const ds of res.datasets.slice(1)) {
              if (!datasetCacheRef.current.has(ds.id)) {
                fetchDatasetById(ds.id)
                  .then((rec) => {
                    if (!cancelled) {
                      datasetCacheRef.current.set(ds.id, rec);
                    }
                  })
                  .catch(() => {});
              }
            }
          });
        } else {
          setLoadingDataset(false);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : 'Backend connection failed');
        setLoadingDataset(false);
      });

    return () => {
      cancelled = true;
      engine.stopAll();
    };
  }, [engine, loadDatasetById]);

  const effectiveSynthParams = useMemo(
    () => ({
      ...synthParams,
      volume: isMuted ? 0 : synthParams.volume,
    }),
    [synthParams, isMuted]
  );

  // Telemetry playback clock driving Web Audio synth updates
  useEffect(() => {
    if (!isPlaying || !activeDataset || activeDataset.samples.length === 0) return;

    const samples = activeDataset.samples;
    let lastTime = performance.now();
    let rafId = 0;

    const tick = (now: number) => {
      const dtSec = (now - lastTime) / 1000;
      lastTime = now;

      setCurrentSampleIndex((prev) => {
        const next = (prev + dtSec * 8 * playbackSpeed) % samples.length;
        const sample = samples[Math.floor(next)];
        if (sample && inputSource === 'nasa-synth') {
          engine.updateFromTelemetry(sample, effectiveSynthParams);
        }
        return next;
      });

      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [isPlaying, activeDataset, playbackSpeed, inputSource, effectiveSynthParams, engine]);

  const handleTogglePlayback = useCallback(async () => {
    setErrorMsg(null);
    if (isPlaying) {
      engine.pause();
      setIsPlaying(false);
      return;
    }

    try {
      if (inputSource === 'nasa-synth') {
        await engine.startSynth(effectiveSynthParams);
      } else if (inputSource === 'audio-file') {
        engine.toggleAudioFilePlayback(true);
      } else if (inputSource === 'microphone') {
        await engine.startMicrophone();
      }
      setIsPlaying(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Browser blocked audio startup. Click Play again to allow audio.'
      );
    }
  }, [isPlaying, engine, inputSource, effectiveSynthParams]);

  const handleReset = useCallback(() => {
    setCurrentSampleIndex(0);
    if (activeDataset && inputSource === 'nasa-synth' && isPlaying) {
      engine.updateFromTelemetry(activeDataset.samples[0], effectiveSynthParams);
    }
  }, [activeDataset, inputSource, isPlaying, engine, effectiveSynthParams]);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      engine.setVolume(next ? 0 : synthParams.volume);
      return next;
    });
  }, [engine, synthParams.volume]);

  useGlobalKeyboardShortcuts({
    enabled: !uploadModalOpen,
    onTogglePlayback: () => {
      if (activeView === 'earth-now') {
        earthNowRef.current?.togglePlayback();
      } else if (activeView === 'missions') {
        missionsRef.current?.togglePlayback();
      } else if (activeView === 'observatory') {
        void handleTogglePlayback();
      }
    },
    onResetTimeline: () => {
      if (activeView === 'earth-now') {
        earthNowRef.current?.resetTimeline();
      } else if (activeView === 'missions') {
        missionsRef.current?.resetTimeline();
      } else if (activeView === 'observatory') {
        handleReset();
      }
    },
    onToggleMute: handleToggleMute,
  });

  const handleEnableMic = async () => {
    setErrorMsg(null);
    try {
      await engine.startMicrophone();
      setInputSource('microphone');
      setIsPlaying(true);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Microphone permission denied or unavailable.'
      );
    }
  };

  const handleSwitchToSynth = async () => {
    setInputSource('nasa-synth');
    if (isPlaying) {
      await engine.startSynth(effectiveSynthParams);
    } else {
      engine.pause();
    }
  };

  const handleAudioFileSelected = async (file: File) => {
    setErrorMsg(null);
    try {
      await engine.loadAudioFile(file, isMuted ? 0 : synthParams.volume);
      setInputSource('audio-file');
      setUploadedFileName(file.name);
      setIsPlaying(true);
      setActiveView('observatory');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to decode audio file.');
    }
  };

  const handleTelemetryIngested = async (
    dataset: NasaDatasetRecord,
    launchOptions?: { autoPlay?: boolean; visMode?: VisualizationMode }
  ) => {
    datasetCacheRef.current.set(dataset.id, dataset);
    const res = await fetchDatasets();
    setSummaries(res.datasets);
    setActiveDataset(dataset);
    setCurrentSampleIndex(0);
    setInputSource('nasa-synth');

    const nextSynthParams = applyProfileToDataset(
      dataset,
      soundProfile,
      synthParams.volume
    );
    setSynthParams(nextSynthParams);

    if (launchOptions?.visMode) {
      setVisMode(launchOptions.visMode);
    }
    setActiveView('observatory');

    if (launchOptions?.autoPlay) {
      try {
        await engine.startSynth({
          ...nextSynthParams,
          volume: isMuted ? 0 : nextSynthParams.volume,
        });
        setIsPlaying(true);
      } catch {
        // User can press Space or Play if browser blocked audio
      }
    }
  };

  const handleLoadDonki = async (feedType: 'FLR' | 'GST') => {
    setDonkiLoading(feedType);
    setErrorMsg(null);
    setDonkiNotice(null);
    try {
      const resp = await fetchDonkiSpaceWeather(feedType, true);
      datasetCacheRef.current.set(resp.dataset.id, resp.dataset);
      const res = await fetchDatasets();
      setSummaries(res.datasets);
      setActiveDataset(resp.dataset);
      setCurrentSampleIndex(0);
      setInputSource('nasa-synth');
      setSynthParams((prev) =>
        applyProfileToDataset(resp.dataset, soundProfile, prev.volume)
      );
      setDonkiNotice(
        resp.notice ??
          `Loaded ${resp.eventCount} live NASA DONKI ${feedType} events (${resp.windowStart} to ${resp.windowEnd}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch NASA DONKI feed');
    } finally {
      setDonkiLoading(null);
    }
  };

  const filteredSummaries = useMemo(() => {
    if (domainFilter === 'All') return summaries;
    return summaries.filter((s) => s.domain === domainFilter);
  }, [summaries, domainFilter]);

  const speakAnnouncement = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
      const clean = text.replace(/\s+/g, " ").trim();
      if (!clean) return;
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(clean.slice(0, 180));
        u.rate = 1.08;
        u.volume = isMuted ? 0 : 0.9;
        window.speechSynthesis.speak(u);
      } catch {
        // Ignore browser speech synthesis failures
      }
    },
    [isMuted]
  );

  useEffect(() => {
    if (!spokenNarration) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }

    const describeEl = (el: HTMLElement | null): string => {
      if (!el) return "";
      const target = el.closest("button, a, select, input, [role='button'], [tabindex]") as HTMLElement | null;
      if (!target) return "";
      const label =
        target.getAttribute("aria-label") ||
        target.getAttribute("title") ||
        (target instanceof HTMLInputElement && target.type === "range"
          ? `${target.getAttribute("aria-label") || "Slider"} ${target.value}`
          : "") ||
        target.textContent ||
        "";
      return label.replace(/\s+/g, " ").trim();
    };

    const onFocus = (e: FocusEvent) => {
      const text = describeEl(e.target as HTMLElement | null);
      if (text) speakAnnouncement(text);
    };
    const onClick = (e: MouseEvent) => {
      const text = describeEl(e.target as HTMLElement | null);
      if (text) speakAnnouncement(text);
    };

    document.addEventListener("focusin", onFocus);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("click", onClick);
    };
  }, [spokenNarration, speakAnnouncement]);

  const globalA11y: GlobalA11yProps = useMemo(
    () => ({
      reduceMotion,
      onToggleReduceMotion: () => setReduceMotion((v) => !v),
      largerText,
      onToggleLargerText: () => setLargerText((v) => !v),
      highContrast,
      onToggleHighContrast: () => setHighContrast((v) => !v),
      spokenNarration,
      onToggleSpokenNarration: () =>
        setSpokenNarration((v) => {
          const next = !v;
          if (next) speakAnnouncement("Voice over enabled");
          return next;
        }),
      speakAnnouncement,
    }),
    [reduceMotion, largerText, highContrast, spokenNarration, speakAnnouncement]
  );

  const navigateToView = useCallback(
    (nextView: ActiveView) => {
      if (nextView !== 'observatory' && isPlaying) {
        engine.pause();
        setIsPlaying(false);
      }
      setActiveView(nextView);
      if (spokenNarration) speakAnnouncement(`Opened ${nextView.replace("-", " ")} view`);
    },
    [engine, isPlaying, spokenNarration, speakAnnouncement]
  );

  return (
    <div className="min-h-screen flex flex-col bg-[#07090E] text-slate-100 pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
      {/* Top Bar Contract: 3 zones separated by gap-8 */}
      <header className="h-14 border-b border-slate-800 bg-[#0B0F19] px-3 sm:px-6 flex items-center justify-between gap-3 md:gap-8 shrink-0 sticky top-0 z-40 md:static">
        {/* Zone 1: Single-element brand wordmark */}
        <button
          type="button"
          onClick={() => navigateToView('home')}
          className="text-base font-semibold tracking-tight text-slate-100 whitespace-nowrap shrink-0 cursor-pointer"
        >
          Helios Sonics
        </button>

        {/* Zone 2: Clean single-line text navigation links */}
        <nav aria-label="Primary navigation" className="fixed bottom-0 inset-x-0 z-50 grid grid-cols-5 bg-[#0B0F19] border-t border-slate-800 pb-[env(safe-area-inset-bottom)] md:static md:z-auto md:flex md:items-center md:gap-6 md:overflow-x-auto md:border-0 md:bg-transparent md:pb-0">
          {(
            [
              { id: 'home', label: 'Home' },
              { id: 'observatory', label: 'Observatory' },
              { id: 'earth-now', label: 'Earth Now' },
              { id: 'missions', label: 'Missions' },
              { id: 'backend', label: 'Backend API' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigateToView(item.id)}
              className={`text-[11px] md:text-sm font-medium py-3.5 md:py-0 md:pb-0.5 border-t-2 md:border-t-0 md:border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeView === item.id
                  ? 'border-cyan-400 text-slate-100 bg-slate-900/60 md:bg-transparent'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: Accessibility + Primary CTA */}
        <div className="relative flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setA11yMenuOpen((v) => !v)}
            aria-expanded={a11yMenuOpen}
            aria-label="Global Accessibility Settings"
            className={`inline-flex items-center gap-1.5 px-2.5 py-2 text-xs font-medium border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              largerText || highContrast || reduceMotion || spokenNarration
                ? "border-cyan-400 bg-[#111827] text-cyan-300"
                : "border-slate-700 bg-[#07090E] text-slate-300 hover:border-slate-500"
            }`}
          >
            <Accessibility className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Accessibility</span>
          </button>

          {a11yMenuOpen && (
            <div
              role="region"
              aria-label="Global Accessibility Controls"
              className="absolute right-0 top-12 z-50 w-64 border border-slate-700 bg-[#0B0F19] p-3 shadow-xl space-y-2 text-xs"
            >
              <div className="font-semibold text-slate-100 pb-1 border-b border-slate-800">
                Global Accessibility
              </div>
              <button
                type="button"
                onClick={globalA11y.onToggleLargerText}
                aria-pressed={largerText}
                className={`w-full flex items-center justify-between px-2.5 py-2 border cursor-pointer ${
                  largerText ? "border-cyan-400 bg-[#111827] text-cyan-300" : "border-slate-800 bg-[#07090E] text-slate-300"
                }`}
              >
                <span>Larger Text</span>
                <span className="font-mono">{largerText ? "ON" : "OFF"}</span>
              </button>
              <button
                type="button"
                onClick={globalA11y.onToggleHighContrast}
                aria-pressed={highContrast}
                className={`w-full flex items-center justify-between px-2.5 py-2 border cursor-pointer ${
                  highContrast ? "border-cyan-400 bg-[#111827] text-cyan-300" : "border-slate-800 bg-[#07090E] text-slate-300"
                }`}
              >
                <span>High Contrast</span>
                <span className="font-mono">{highContrast ? "ON" : "OFF"}</span>
              </button>
              <button
                type="button"
                onClick={globalA11y.onToggleReduceMotion}
                aria-pressed={reduceMotion}
                className={`w-full flex items-center justify-between px-2.5 py-2 border cursor-pointer ${
                  reduceMotion ? "border-cyan-400 bg-[#111827] text-cyan-300" : "border-slate-800 bg-[#07090E] text-slate-300"
                }`}
              >
                <span>Reduce Motion</span>
                <span className="font-mono">{reduceMotion ? "ON" : "OFF"}</span>
              </button>
              <button
                type="button"
                onClick={globalA11y.onToggleSpokenNarration}
                aria-pressed={spokenNarration}
                className={`w-full flex items-center justify-between px-2.5 py-2 border cursor-pointer ${
                  spokenNarration ? "border-cyan-400 bg-[#111827] text-cyan-300" : "border-slate-800 bg-[#07090E] text-slate-300"
                }`}
              >
                <span>Voice Over</span>
                <span className="font-mono">{spokenNarration ? "ON" : "OFF"}</span>
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setUploadModalOpen(true)}
            className="inline-flex items-center gap-2 px-3 md:px-4 py-2 text-xs font-medium bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Load Audio / CSV</span>
            <span className="sm:hidden">Load</span>
          </button>
        </div>
      </header>

      {activeView === 'home' ? (
        <main className="flex-1 overflow-y-auto">
          <HomeTab onNavigate={navigateToView} />
        </main>
      ) : activeView === 'earth-now' ? (
        <main className="flex-1 overflow-y-auto">
          <EarthNowTab
            ref={earthNowRef}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
            a11y={globalA11y}
          />
        </main>
      ) : activeView === 'missions' ? (
        <main className="flex-1 overflow-y-auto">
          <MissionsTab
            ref={missionsRef}
            isMuted={isMuted}
            onToggleMute={handleToggleMute}
          />
        </main>
      ) : activeView === 'backend' ? (
        <main className="flex-1 overflow-y-auto">
          <BackendConsole onDatasetIngested={handleTelemetryIngested} />
        </main>
      ) : (
        <>
          {/* Telemetry Ribbon (40px) */}
          <div className="min-h-10 border-b border-slate-800 bg-[#07090E] px-5 py-2 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex flex-wrap items-center gap-2.5 text-slate-400 min-w-0">
              <span className="font-medium text-slate-100 truncate max-w-[340px]">
                {activeDataset ? activeDataset.title : 'Loading NASA Telemetry...'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] whitespace-nowrap">
                {activeDataset?.instrument ?? '—'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] whitespace-nowrap">
                {activeDataset?.cadenceLabel ?? '—'}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-[11px] whitespace-nowrap tabular-nums">
                {activeDataset ? `${activeDataset.sampleCount} samples` : '—'}
              </span>
            </div>

            <div className="flex items-center gap-4 shrink-0">
              <span className="hidden xl:inline font-mono text-[11px] text-slate-500 whitespace-nowrap">
                Space: Play/Pause · R: Reset · M: Mute
              </span>
              <span
                className={`font-mono text-[11px] whitespace-nowrap ${
                  isMuted
                    ? 'text-amber-400'
                    : isPlaying
                    ? 'text-emerald-400'
                    : 'text-slate-400'
                }`}
              >
                {isMuted
                  ? '● Muted'
                  : isPlaying
                  ? inputSource === 'microphone'
                    ? '● Live Mic Stream'
                    : inputSource === 'audio-file'
                    ? `● Track: ${uploadedFileName ?? 'Audio'}`
                    : '● Sonification Streaming'
                  : '○ Engine Idle'}
              </span>

              <button
                type="button"
                onClick={() => stageRef.current?.exportPng()}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-[11px] font-mono bg-[#0B0F19] border border-slate-700 text-slate-200 hover:border-cyan-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                Export PNG
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="border-b border-rose-500/40 bg-rose-950/30 px-5 py-2 text-xs text-rose-200">
              {errorMsg}
            </div>
          )}

          {/* Mobile-only floating Play/Pause (controls column sits below the visual on phones) */}
          <button
            type="button"
            onClick={handleTogglePlayback}
            aria-label={isPlaying ? 'Pause audio' : 'Play sonification'}
            className="lg:hidden fixed right-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 inline-flex items-center gap-2 px-4 py-3 text-sm font-semibold bg-cyan-500 text-slate-950 shadow-lg shadow-black/50 active:bg-cyan-400"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>

          {/* Asymmetric Split Console */}
          <div className="flex-1 flex flex-col lg:flex-row min-h-0">
            {/* Left Control & Parameter Column (340px on desktop) */}
            <aside className="order-2 lg:order-1 w-full lg:w-[340px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800 bg-[#0B0F19] flex flex-col justify-between overflow-y-auto">
              <div className="p-4 space-y-6">
                {/* 1. Audio Input Source Selector */}
                <div>
                  <div className="text-xs font-medium text-slate-300 mb-2">
                    Signal Source
                  </div>
                  <div className="grid grid-cols-3 gap-1 bg-[#07090E] p-1 border border-slate-800">
                    <button
                      type="button"
                      onClick={handleSwitchToSynth}
                      className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        inputSource === 'nasa-synth'
                          ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Radio className="w-3 h-3" />
                      NASA Synth
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadModalOpen(true)}
                      className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        inputSource === 'audio-file'
                          ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Upload className="w-3 h-3" />
                      Audio
                    </button>
                    <button
                      type="button"
                      onClick={handleEnableMic}
                      className={`inline-flex items-center justify-center gap-1.5 py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        inputSource === 'microphone'
                          ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Mic className="w-3 h-3" />
                      Mic
                    </button>
                  </div>
                </div>

                {/* 2. NASA Test Dataset Catalog */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-slate-300">
                      NASA Telemetry Catalog
                    </span>
                    <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                      {filteredSummaries.length} feeds
                    </span>
                  </div>

                  {/* Domain filter */}
                  <select
                    aria-label="Filter NASA datasets by science domain"
                    value={domainFilter}
                    onChange={(e) => setDomainFilter(e.target.value)}
                    className="mb-2.5 w-full bg-[#07090E] border border-slate-800 px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
                  >
                    <option value="All">All Science Domains</option>
                    <option value="Deep Space Plasma">Deep Space Plasma</option>
                    <option value="Heliophysics">Heliophysics</option>
                    <option value="Planetary Science">Planetary Science</option>
                    <option value="Astrophysics">Astrophysics</option>
                  </select>

                  <div className="space-y-1.5 max-h-[210px] overflow-y-auto pr-0.5">
                    {filteredSummaries.map((ds) => {
                      const isSelected = activeDataset?.id === ds.id;
                      return (
                        <button
                          key={ds.id}
                          type="button"
                          onClick={() => loadDatasetById(ds.id)}
                          className={`w-full text-left p-2.5 border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-[#111827] border-cyan-500/70'
                              : 'bg-[#07090E] border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <div className="text-xs font-medium text-slate-100 truncate">
                            {ds.title}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-slate-400 truncate">
                            <span>{ds.mission}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ds.primaryUnit}</span>
                            <span aria-hidden="true">·</span>
                            <span>{ds.domain}</span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-2.5 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleLoadDonki('FLR')}
                      disabled={donkiLoading !== null}
                      className="flex-1 py-1.5 px-2 text-[11px] font-mono border border-slate-700 bg-[#07090E] text-amber-300 hover:border-amber-400 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {donkiLoading === 'FLR' ? 'Fetching FLR...' : '+ Live DONKI Flares'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLoadDonki('GST')}
                      disabled={donkiLoading !== null}
                      className="flex-1 py-1.5 px-2 text-[11px] font-mono border border-slate-700 bg-[#07090E] text-cyan-300 hover:border-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      {donkiLoading === 'GST' ? 'Fetching GST...' : '+ Live DONKI Storms'}
                    </button>
                  </div>
                  {donkiNotice && (
                    <div className="mt-2 text-[11px] font-mono text-emerald-300 leading-snug">
                      {donkiNotice}
                    </div>
                  )}
                </div>

                {/* 3. Visualization Renderer Mode */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300 mb-2">
                    <Layers className="w-3.5 h-3.5 text-cyan-400" />
                    Visualization Mode
                  </div>
                  <div className="grid grid-cols-4 gap-1 bg-[#07090E] p-1 border border-slate-800">
                    {(
                      [
                        { id: 'orbital', label: 'Orbital' },
                        { id: 'spectrogram', label: 'Waterfall' },
                        { id: 'oscilloscope', label: 'Scope' },
                        { id: 'globe3d', label: 'Globe 3D' },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setVisMode(m.id)}
                        className={`py-1.5 px-1.5 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          visMode === m.id
                            ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-300">
                    <label className="flex items-center justify-between py-1 cursor-pointer">
                      <span>Harmonic Coordinate Grid</span>
                      <input
                        type="checkbox"
                        checked={showHarmonicGrid}
                        onChange={(e) => setShowHarmonicGrid(e.target.checked)}
                        className="accent-cyan-500"
                      />
                    </label>
                    <label className="flex items-center justify-between py-1 cursor-pointer">
                      <span>Telemetry Orbit Overlay</span>
                      <input
                        type="checkbox"
                        checked={showTelemetryOverlay}
                        onChange={(e) => setShowTelemetryOverlay(e.target.checked)}
                        className="accent-cyan-500"
                      />
                    </label>
                    <label className="flex items-center justify-between py-1 cursor-pointer">
                      <span>Peak Hold Markers</span>
                      <input
                        type="checkbox"
                        checked={showPeakHold}
                        onChange={(e) => setShowPeakHold(e.target.checked)}
                        className="accent-cyan-500"
                      />
                    </label>
                  </div>
                </div>

                {/* 4. Auto-Calibrated Sound Profile & Optional Fine-Tuning */}
                <div className="space-y-3 pt-2 border-t border-slate-800">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <Sliders className="w-3.5 h-3.5 text-amber-400" />
                      Sound Profile (Auto-Tuned)
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-1 bg-[#07090E] p-1 border border-slate-800">
                    {(
                      [
                        { id: 'ambient-space', label: 'Ambient Space' },
                        { id: 'crystal-harp', label: 'Crystal Harp' },
                        { id: 'deep-cosmos', label: 'Deep Cosmos' },
                        { id: 'raw-telemetry', label: 'Raw Telemetry' },
                      ] as const
                    ).map((prof) => (
                      <button
                        key={prof.id}
                        type="button"
                        onClick={() => {
                          setSoundProfile(prof.id);
                          if (activeDataset) {
                            setSynthParams((prev) =>
                              applyProfileToDataset(activeDataset, prof.id, prev.volume)
                            );
                          } else {
                            setSynthParams((prev) => ({
                              ...prev,
                              soundProfile: prof.id,
                            }));
                          }
                        }}
                        className={`py-1.5 px-2 text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                          soundProfile === prof.id
                            ? 'bg-[#111827] text-cyan-400 border border-slate-700'
                            : 'text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        {prof.label}
                      </button>
                    ))}
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-mono mb-1 tabular-nums">
                      <span className="text-slate-400">Telemetry Speed</span>
                      <span className="text-slate-200">{playbackSpeed.toFixed(1)}x</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={4}
                      step={0.5}
                      value={playbackSpeed}
                      onChange={(e) => setPlaybackSpeed(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>

                  <details className="border border-slate-800 bg-[#07090E]">
                    <summary className="px-2.5 py-2 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer select-none">
                      Manual Synth Fine-Tuning
                    </summary>
                    <div className="px-2.5 pb-3 pt-2 space-y-2.5 border-t border-slate-800">
                      <div>
                        <div className="flex justify-between text-[11px] font-mono mb-1 tabular-nums">
                          <span className="text-slate-400">Base Carrier</span>
                          <span className="text-cyan-400">
                            {synthParams.baseFrequencyHz.toFixed(0)} Hz
                          </span>
                        </div>
                        <input
                          type="range"
                          min={40}
                          max={330}
                          step={1}
                          value={synthParams.baseFrequencyHz}
                          onChange={(e) =>
                            setSynthParams((p) => ({
                              ...p,
                              baseFrequencyHz: Number(e.target.value),
                            }))
                          }
                          className="w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono mb-1 tabular-nums">
                          <span className="text-slate-400">Lowpass Cutoff</span>
                          <span className="text-cyan-400">
                            {synthParams.filterCutoffHz} Hz
                          </span>
                        </div>
                        <input
                          type="range"
                          min={250}
                          max={4600}
                          step={50}
                          value={synthParams.filterCutoffHz}
                          onChange={(e) =>
                            setSynthParams((p) => ({
                              ...p,
                              filterCutoffHz: Number(e.target.value),
                            }))
                          }
                          className="w-full"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between text-[11px] font-mono mb-1 tabular-nums">
                          <span className="text-slate-400">Vibrato Depth</span>
                          <span className="text-amber-400">
                            {Math.round(synthParams.modulationDepth * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={1}
                          step={0.02}
                          value={synthParams.modulationDepth}
                          onChange={(e) =>
                            setSynthParams((p) => ({
                              ...p,
                              modulationDepth: Number(e.target.value),
                            }))
                          }
                          className="w-full"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <label className="block">
                          <span className="text-[10px] text-slate-400">Waveform</span>
                          <select
                            value={synthParams.waveform}
                            onChange={(e) =>
                              setSynthParams((p) => ({
                                ...p,
                                waveform: e.target.value as OscillatorType,
                              }))
                            }
                            className="mt-1 w-full bg-[#0B0F19] border border-slate-800 px-2 py-1 text-[11px] font-mono text-slate-200"
                          >
                            <option value="sine">sine</option>
                            <option value="triangle">triangle</option>
                            <option value="sawtooth">sawtooth</option>
                            <option value="square">square</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-[10px] text-slate-400">Pitch Scale</span>
                          <select
                            value={synthParams.scaleMode}
                            onChange={(e) =>
                              setSynthParams((p) => ({
                                ...p,
                                scaleMode: e.target.value as SynthParams['scaleMode'],
                              }))
                            }
                            className="mt-1 w-full bg-[#0B0F19] border border-slate-800 px-2 py-1 text-[11px] font-mono text-slate-200"
                          >
                            <option value="pentatonic">pentatonic</option>
                            <option value="harmonic">harmonic</option>
                            <option value="microtonal">microtonal</option>
                            <option value="chromatic">chromatic</option>
                          </select>
                        </label>
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              {/* Anchored Transport Execution Bar */}
              <div className="border-t border-slate-800 bg-[#07090E] p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleTogglePlayback}
                    disabled={loadingDataset}
                    className={`flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      isPlaying
                        ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                        : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
                    }`}
                  >
                    {isPlaying ? (
                      <>
                        <Pause className="w-3.5 h-3.5" />
                        Pause Audio
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5" />
                        Play Sonification
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleReset}
                    aria-label="Reset playback to sample 0"
                    className="p-2.5 border border-slate-700 bg-[#0B0F19] text-slate-300 hover:text-white hover:border-slate-500 transition-colors cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleToggleMute}
                    aria-pressed={isMuted}
                    aria-label={isMuted ? 'Unmute audio (M)' : 'Mute audio (M)'}
                    className={`p-1 border transition-colors cursor-pointer shrink-0 ${
                      isMuted
                        ? 'border-amber-500/60 text-amber-400 bg-amber-500/10'
                        : 'border-transparent text-slate-400 hover:text-slate-100'
                    }`}
                  >
                    {isMuted ? (
                      <VolumeX className="w-3.5 h-3.5" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <input
                    type="range"
                    aria-label="Master output volume"
                    min={0}
                    max={1}
                    step={0.02}
                    value={isMuted ? 0 : synthParams.volume}
                    onChange={(e) => {
                      const vol = Number(e.target.value);
                      if (isMuted && vol > 0) setIsMuted(false);
                      setSynthParams((p) => ({ ...p, volume: vol }));
                      engine.setVolume(vol);
                    }}
                    className="flex-1"
                  />
                  <span className="font-mono text-[11px] text-slate-400 w-10 text-right tabular-nums">
                    {isMuted ? 'MUTE' : `${Math.round(synthParams.volume * 100)}%`}
                  </span>
                </div>
              </div>
            </aside>

            {/* Right Primary Canvas + Bottom Telemetry Tray */}
            <main className="order-1 lg:order-2 flex-1 flex flex-col min-w-0 min-h-0">
              <VisualizationStage
                ref={stageRef}
                engine={engine}
                dataset={activeDataset}
                currentSampleIndex={currentSampleIndex}
                isPlaying={isPlaying}
                mode={visMode}
                showTelemetryOverlay={showTelemetryOverlay}
                showHarmonicGrid={showHarmonicGrid}
                showPeakHold={showPeakHold}
                onMetricsUpdate={setMetrics}
              />

              <TelemetryTray
                dataset={activeDataset}
                currentSampleIndex={currentSampleIndex}
                metrics={metrics}
                onSeek={(idx) => {
                  setCurrentSampleIndex(idx);
                  if (activeDataset && inputSource === 'nasa-synth' && isPlaying) {
                    engine.updateFromTelemetry(
                      activeDataset.samples[idx],
                      effectiveSynthParams
                    );
                  }
                }}
              />
            </main>
          </div>
        </>
      )}

      <UploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onAudioFileSelected={handleAudioFileSelected}
        onTelemetryIngested={handleTelemetryIngested}
      />
    </div>
  );
}
