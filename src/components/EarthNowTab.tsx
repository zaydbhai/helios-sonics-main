import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Music,
  CloudRain,
  Eye,
  Volume2,
  VolumeX,
  ExternalLink,
  ListMusic,
  Headphones,
  BookOpen,
  Type,
  Sparkles,
  Globe,
  Map as MapIcon,
  Crop,
  Bell,
  Mic,
  Square,
  Share2,
  Check,
  Satellite,
  MessageSquare,
} from 'lucide-react';
import { EarthNowAudioEngine } from '../audio/EarthNowAudioEngine';
import { useFramePreloader } from '../hooks/useFramePreloader';
import {
  buildGibsImageProxyUrl,
  fetchGibsLayers,
} from '../services/nasaApi';
import type {
  EarthNowCatalog,
  EarthNowFrame,
  EarthNowTrack,
  MusicalScaleType,
  NormalizedRoiBox,
  SynthVoiceType,
} from '../types/earthNow';
import type { NasaGibsLayer } from '../types/nasa';
import {
  computePearsonCorrelation,
  detectSpikeFrames,
  ROI_PRESETS,
  sampleFramesForRoi,
} from '../utils/earthNowAnalysis';
import { EarthNowSpectrumStrip } from './EarthNowSpectrumStrip';
import { Globe3DView } from './Globe3DView';

export interface EarthNowTabHandle {
  togglePlayback: () => void;
  resetTimeline: () => void;
}

export interface GlobalA11yProps {
  reduceMotion: boolean;
  onToggleReduceMotion: () => void;
  largerText: boolean;
  onToggleLargerText: () => void;
  highContrast: boolean;
  onToggleHighContrast: () => void;
  spokenNarration: boolean;
  onToggleSpokenNarration: () => void;
  speakAnnouncement: (text: string) => void;
}

interface EarthNowTabProps {
  isMuted?: boolean;
  onToggleMute?: () => void;
  a11y?: GlobalA11yProps;
}

function getInitialParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

export const EarthNowTab = React.forwardRef<EarthNowTabHandle, EarthNowTabProps>(
  function EarthNowTab({ isMuted = false, onToggleMute, a11y }, ref) {
    const engine = useMemo(() => new EarthNowAudioEngine(), []);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const stageImgContainerRef = useRef<HTMLDivElement | null>(null);

    const [catalog, setCatalog] = useState<EarthNowCatalog | null>(null);
    const [selectedTrackId, setSelectedTrackId] = useState<string>(
      () => getInitialParam('track') || 'temperature'
    );
    const [frameIndex, setFrameIndex] = useState<number>(() => {
      const f = Number(getInitialParam('frame'));
      return Number.isFinite(f) && f >= 0 ? Math.floor(f) : 0;
    });
    const [prevImageUrl, setPrevImageUrl] = useState<string | null>(null);
    const [crossFadeActive, setCrossFadeActive] = useState<boolean>(false);

    const [currentNote, setCurrentNote] = useState<string>('C4');
    const [rightEarNote, setRightEarNote] = useState<string | null>(null);
    const [spikeAlertActive, setSpikeAlertActive] = useState<boolean>(false);

    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [playAllMode, setPlayAllMode] = useState<boolean>(false);
    const [dualStereoMode, setDualStereoMode] = useState<boolean>(
      () => getInitialParam('stereo') === '1'
    );
    const [cloudLayerEnabled, setCloudLayerEnabled] = useState<boolean>(
      () => getInitialParam('cloud') === '1'
    );
    const [volume, setVolume] = useState<number>(0.8);
    const [stepMs, setStepMs] = useState<number>(() => {
      const s = Number(getInitialParam('stepMs'));
      return s === 700 || s === 420 || s === 220 ? s : 420;
    });

    // Musical & Alert Settings
    const [scaleType, setScaleType] = useState<MusicalScaleType>(() => {
      const s = getInitialParam('scale');
      return s === 'dorian' || s === 'minor' ? s : 'pentatonic';
    });
    const [voiceType, setVoiceType] = useState<SynthVoiceType>(() => {
      const v = getInitialParam('voice');
      return v === 'marimba' || v === 'warm-pad' || v === 'plucked-sine'
        ? v
        : 'triangle';
    });
    const [spikeAlertsEnabled, setSpikeAlertsEnabled] = useState<boolean>(true);

    // Stage Mode (2D Map vs 3D Globe) + ROI Region Selection
    const [stageMode, setStageMode] = useState<'2d' | '3d'>(() =>
      getInitialParam('stage') === '3d' ? '3d' : '2d'
    );
    const [activeRoi, setActiveRoi] = useState<NormalizedRoiBox>(() => {
      const roiId = getInitialParam('roi');
      return ROI_PRESETS.find((r) => r.id === roiId) ?? ROI_PRESETS[0];
    });
    const [roiFrames, setRoiFrames] = useState<EarthNowFrame[] | null>(null);
    const [roiRightFrames, setRoiRightFrames] = useState<EarthNowFrame[] | null>(null);
    const [roiSampling, setRoiSampling] = useState<boolean>(false);
    const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
    const [dragRect, setDragRect] = useState<{ x: number; y: number; w: number; h: number } | null>(
      null
    );

    // NASA GIBS Live Daily Satellite Snapshot State
    const [gibsLayers, setGibsLayers] = useState<NasaGibsLayer[]>([]);
    const [selectedGibsLayer, setSelectedGibsLayer] = useState<string>(
      'MODIS_Terra_CorrectedReflectance_TrueColor'
    );
    const [gibsDate, setGibsDate] = useState<string>('');
    const [gibsSnapshotUrl, setGibsSnapshotUrl] = useState<string | null>(null);
    const [gibsLoading, setGibsLoading] = useState<boolean>(false);
    const [gibsStatus, setGibsStatus] = useState<string | null>(null);

    // Recording, Sharing & Spoken Narration
    const [isRecording, setIsRecording] = useState<boolean>(false);
    const [shareCopied, setShareCopied] = useState<boolean>(false);
    const [localSpokenNarration, setLocalSpokenNarration] = useState<boolean>(false);
    const spokenNarration = a11y ? a11y.spokenNarration : localSpokenNarration;
    const setSpokenNarration = (v: boolean | ((prev: boolean) => boolean)) => {
      if (a11y) { a11y.onToggleSpokenNarration(); } else { setLocalSpokenNarration(v); }
    };

    // Accessibility & Intro State
    const [localHighContrast, setLocalHighContrast] = useState<boolean>(false);
    const highContrast = a11y ? a11y.highContrast : localHighContrast;
    const setHighContrast = (v: boolean | ((prev: boolean) => boolean)) => {
      if (a11y) { a11y.onToggleHighContrast(); } else { setLocalHighContrast(v); }
    };
    const [localLargerText, setLocalLargerText] = useState<boolean>(false);
    const largerText = a11y ? a11y.largerText : localLargerText;
    const setLargerText = (v: boolean | ((prev: boolean) => boolean)) => {
      if (a11y) { a11y.onToggleLargerText(); } else { setLocalLargerText(v); }
    };
    const [localReduceMotion, setLocalReduceMotion] = useState<boolean>(() =>
      typeof window !== "undefined"
        ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
        : false
    );
    const reduceMotion = a11y ? a11y.reduceMotion : localReduceMotion;
    const setReduceMotion = (v: boolean | ((prev: boolean) => boolean)) => {
      if (a11y) { a11y.onToggleReduceMotion(); } else { setLocalReduceMotion(v); }
    };
    const [showIntro, setShowIntro] = useState<boolean>(true);
    const [hasPlayedOnce, setHasPlayedOnce] = useState<boolean>(false);

    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [singleNoteStatus, setSingleNoteStatus] = useState<string | null>(null);

    const lastImageUrlRef = useRef<string | null>(null);
    const pendingAutoPlayRef = useRef<boolean>(false);
    const initialFrameAppliedRef = useRef<boolean>(false);

    const speakAnnouncement = useCallback(
      (text: string) => {
        if (!spokenNarration || typeof window === 'undefined' || !('speechSynthesis' in window)) {
          return;
        }
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.rate = 1.08;
          utterance.pitch = 1.0;
          utterance.volume = isMuted ? 0 : Math.min(1, volume + 0.1);
          window.speechSynthesis.speak(utterance);
        } catch {
          // Ignore browser speech synthesis failures
        }
      },
      [spokenNarration, isMuted, volume]
    );

    useEffect(() => {
      if (!spokenNarration && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    }, [spokenNarration]);

    // Load Earth Now catalog & NASA GIBS layer metadata
    useEffect(() => {
      let cancelled = false;

      fetch('/earth-now/track.json')
        .then((res) => {
          if (!res.ok) throw new Error(`Failed to load track.json (${res.status})`);
          return res.json() as Promise<EarthNowCatalog>;
        })
        .then((data) => {
          if (cancelled) return;
          setCatalog(data);
          const urlTrack = getInitialParam('track');
          if (urlTrack && data.tracks.some((t) => t.id === urlTrack)) {
            setSelectedTrackId(urlTrack);
          } else if (data.tracks.length > 0) {
            setSelectedTrackId(data.tracks[0].id);
          }
          setLoading(false);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Unable to load Earth Now dataset');
          setLoading(false);
        });

      fetchGibsLayers()
        .then((res) => {
          if (cancelled) return;
          setGibsLayers(res.layers);
          setGibsDate(res.defaultDate);
          if (res.layers[0]) {
            setSelectedGibsLayer(res.layers[0].id);
          }
        })
        .catch(() => {
          // Optional live GIBS catalog
        });

      return () => {
        cancelled = true;
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
        engine.dispose();
      };
    }, [engine]);

    const activeTrack: EarthNowTrack | null = useMemo(() => {
      if (!catalog) return null;
      return catalog.tracks.find((t) => t.id === selectedTrackId) ?? catalog.tracks[0] ?? null;
    }, [catalog, selectedTrackId]);

    const tempTrack = useMemo(
      () => catalog?.tracks.find((t) => t.id === 'temperature') ?? catalog?.tracks[0] ?? null,
      [catalog]
    );
    const precipTrack = useMemo(
      () => catalog?.tracks.find((t) => t.id === 'precipitation') ?? catalog?.tracks[2] ?? null,
      [catalog]
    );

    const {
      srcMap,
      activeLoaded,
      activeTotal,
      isActiveReady,
    } = useFramePreloader(catalog, selectedTrackId);

    const getFrameSrc = useCallback(
      (url: string) => srcMap[url] ?? url,
      [srcMap]
    );

    // Recompute ROI brightness curve whenever ROI box or active track changes
    useEffect(() => {
      if (!activeTrack) return;
      if (
        activeRoi.id === 'global' &&
        activeRoi.x === 0 &&
        activeRoi.y === 0 &&
        activeRoi.w >= 0.99 &&
        activeRoi.h >= 0.99
      ) {
        setRoiFrames(null);
        setRoiRightFrames(null);
        return;
      }

      let cancelled = false;
      setRoiSampling(true);

      const primaryBase = dualStereoMode && tempTrack ? tempTrack.frames : activeTrack.frames;
      const run = async () => {
        const sampledLeft = await sampleFramesForRoi(primaryBase, srcMap, activeRoi);
        let sampledRight: EarthNowFrame[] | null = null;
        if (dualStereoMode && precipTrack) {
          sampledRight = await sampleFramesForRoi(precipTrack.frames, srcMap, activeRoi);
        }
        if (cancelled) return;
        setRoiFrames(sampledLeft);
        setRoiRightFrames(sampledRight);
        setRoiSampling(false);
        engine.updateFramesInPlace(sampledLeft, sampledRight ?? undefined);
      };

      void run();
      return () => {
        cancelled = true;
      };
    }, [activeTrack, tempTrack, precipTrack, dualStereoMode, activeRoi, srcMap, engine]);

    const effectiveFrames = useMemo(() => {
      if (roiFrames && roiFrames.length > 0) return roiFrames;
      if (dualStereoMode && tempTrack) return tempTrack.frames;
      return activeTrack?.frames ?? [];
    }, [roiFrames, dualStereoMode, tempTrack, activeTrack]);

    const effectiveRightFrames = useMemo(() => {
      if (roiRightFrames && roiRightFrames.length > 0) return roiRightFrames;
      return precipTrack?.frames ?? [];
    }, [roiRightFrames, precipTrack]);

    const spikeFrameIndices = useMemo(
      () => detectSpikeFrames(effectiveFrames),
      [effectiveFrames]
    );

    const stereoCorrelation = useMemo(() => {
      if (!dualStereoMode || effectiveFrames.length < 3 || effectiveRightFrames.length < 3) {
        return null;
      }
      const len = Math.min(effectiveFrames.length, effectiveRightFrames.length);
      const a = effectiveFrames.slice(0, len).map((f) => f.normalizedBrightness);
      const b = effectiveRightFrames.slice(0, len).map((f) => f.normalizedBrightness);
      const r = computePearsonCorrelation(a, b);
      if (r === null) return null;
      const label =
        r >= 0.35 ? 'In-phase correlation' : r <= -0.35 ? 'Inverse phase' : 'Weak / independent';
      return { r, label };
    }, [dualStereoMode, effectiveFrames, effectiveRightFrames]);

    const activeFrame = effectiveFrames[frameIndex] ?? effectiveFrames[0] ?? null;
    const rightFrame =
      dualStereoMode && effectiveRightFrames.length > 0
        ? effectiveRightFrames[frameIndex % effectiveRightFrames.length]
        : null;

    // Smooth cross-fade tracking between consecutive frames (only when both frames are decoded)
    useEffect(() => {
      if (!activeFrame || gibsSnapshotUrl) return;
      const nextUrl = activeFrame.imageUrl;
      const previousUrl = lastImageUrlRef.current;

      if (
        previousUrl &&
        previousUrl !== nextUrl &&
        !reduceMotion &&
        Boolean(srcMap[previousUrl]) &&
        Boolean(srcMap[nextUrl])
      ) {
        setPrevImageUrl(previousUrl);
        setCrossFadeActive(false);
        const raf = requestAnimationFrame(() => {
          setCrossFadeActive(true);
        });
        const timer = window.setTimeout(() => {
          setCrossFadeActive(false);
          setPrevImageUrl(null);
        }, 165);
        lastImageUrlRef.current = nextUrl;
        return () => {
          cancelAnimationFrame(raf);
          window.clearTimeout(timer);
        };
      }

      lastImageUrlRef.current = nextUrl;
      setCrossFadeActive(false);
      setPrevImageUrl(null);
    }, [activeFrame?.imageUrl, reduceMotion, srcMap, gibsSnapshotUrl]);

    // Connect UI frame updates to Tone.Transport loop
    useEffect(() => {
      const unsubscribe = engine.onFrameChange((idx, leftNote, rightNote, isSpike) => {
        setFrameIndex(idx);
        setCurrentNote(leftNote);
        setRightEarNote(rightNote);
        setSpikeAlertActive(isSpike && spikeAlertsEnabled);

        // Spoken milestone announcement every 6 frames (12 hours)
        if (spokenNarration && idx % 6 === 0 && effectiveFrames[idx]) {
          speakAnnouncement(
            `Frame ${idx + 1}, ${effectiveFrames[idx].timeLabel}, note ${leftNote}`
          );
        }
      });
      return unsubscribe;
    }, [engine, spikeAlertsEnabled, spokenNarration, speakAnnouncement, effectiveFrames]);

    // Auto-advance jukebox queue when Play All mode finishes a track
    useEffect(() => {
      const unsubscribe = engine.onTrackEnd(() => {
        if (!catalog || catalog.tracks.length < 2) return;
        const currentIdx = catalog.tracks.findIndex((t) => t.id === selectedTrackId);
        const nextTrack = catalog.tracks[(currentIdx + 1) % catalog.tracks.length];
        pendingAutoPlayRef.current = true;
        setSelectedTrackId(nextTrack.id);
        speakAnnouncement(`Now playing ${nextTrack.title}`);
      });
      return unsubscribe;
    }, [engine, catalog, selectedTrackId, speakAnnouncement]);

    // Sync active track frames (and dual stereo frames) into audio engine
    useEffect(() => {
      if (!activeTrack) return;

      const shouldAutoContinue = pendingAutoPlayRef.current;
      pendingAutoPlayRef.current = false;

      if (!shouldAutoContinue) {
        engine.pause();
        setIsPlaying(false);
      }

      const startIdx =
        !initialFrameAppliedRef.current && frameIndex > 0 && frameIndex < activeTrack.frames.length
          ? frameIndex
          : 0;
      initialFrameAppliedRef.current = true;

      if (dualStereoMode && tempTrack && precipTrack) {
        engine.setFrames(tempTrack.frames);
        engine.setDualTrack(true, precipTrack.frames);
        setFrameIndex(startIdx);
        if (tempTrack.frames[startIdx]) {
          setCurrentNote(engine.mapBrightnessToNote(tempTrack.frames[startIdx].normalizedBrightness));
        }
        if (precipTrack.frames[startIdx]) {
          setRightEarNote(
            engine.mapBrightnessToNote(precipTrack.frames[startIdx].normalizedBrightness)
          );
        }
      } else {
        engine.setFrames(activeTrack.frames);
        engine.setDualTrack(false, []);
        setFrameIndex(startIdx);
        setRightEarNote(null);
        if (activeTrack.frames[startIdx]) {
          setCurrentNote(
            engine.mapBrightnessToNote(activeTrack.frames[startIdx].normalizedBrightness)
          );
        }
      }

      if (shouldAutoContinue) {
        void engine.seek(0, false);
        void engine.play().then(() => setIsPlaying(true));
      } else if (startIdx > 0) {
        void engine.seek(startIdx, false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTrack, dualStereoMode, tempTrack, precipTrack, engine]);

    // Sync engine settings & Shareable Deep-Link URL params
    useEffect(() => {
      engine.setPlayAllMode(playAllMode);
    }, [engine, playAllMode]);

    useEffect(() => {
      engine.setMuted(isMuted);
    }, [engine, isMuted]);

    useEffect(() => {
      engine.setVolume(volume);
    }, [engine, volume]);

    useEffect(() => {
      engine.setScaleType(scaleType);
    }, [engine, scaleType]);

    useEffect(() => {
      engine.setVoiceType(voiceType);
    }, [engine, voiceType]);

    useEffect(() => {
      engine.setSpikeAlertsEnabled(spikeAlertsEnabled);
    }, [engine, spikeAlertsEnabled]);

    useEffect(() => {
      engine.setSecondLayerEnabled(cloudLayerEnabled);
    }, [engine, cloudLayerEnabled]);

    useEffect(() => {
      engine.setStepIntervalMs(stepMs);
    }, [engine, stepMs]);

    useEffect(() => {
      if (typeof window === 'undefined' || loading) return;
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'earth-now');
      url.searchParams.set('track', selectedTrackId);
      url.searchParams.set('frame', String(frameIndex));
      url.searchParams.set('scale', scaleType);
      url.searchParams.set('voice', voiceType);
      url.searchParams.set('stepMs', String(stepMs));
      url.searchParams.set('cloud', cloudLayerEnabled ? '1' : '0');
      url.searchParams.set('stereo', dualStereoMode ? '1' : '0');
      url.searchParams.set('stage', stageMode);
      url.searchParams.set('roi', activeRoi.id);
      window.history.replaceState({}, '', url.toString());
    }, [
      loading,
      selectedTrackId,
      frameIndex,
      scaleType,
      voiceType,
      stepMs,
      cloudLayerEnabled,
      dualStereoMode,
      stageMode,
      activeRoi.id,
    ]);

    const handleTogglePlay = useCallback(async () => {
      if (!activeTrack) return;
      if (!hasPlayedOnce) {
        setHasPlayedOnce(true);
        setShowIntro(false);
      }
      if (isPlaying) {
        engine.pause();
        setIsPlaying(false);
      } else {
        await engine.play();
        setIsPlaying(true);
      }
    }, [activeTrack, engine, isPlaying, hasPlayedOnce]);

    const handleSeek = useCallback(
      (idx: number) => {
        if (!activeTrack) return;
        const clamped = Math.max(0, Math.min(activeTrack.frames.length - 1, idx));
        void engine.seek(clamped, !isPlaying);
      },
      [activeTrack, engine, isPlaying]
    );

    const handleSelectTrack = (trackId: string) => {
      if (dualStereoMode) {
        setDualStereoMode(false);
      }
      setGibsSnapshotUrl(null);
      setGibsStatus(null);
      setSelectedTrackId(trackId);
    };

    const handleToggleDualStereo = () => {
      setDualStereoMode((prev) => {
        const next = !prev;
        if (next && tempTrack) {
          setSelectedTrackId(tempTrack.id);
          setPlayAllMode(false);
        }
        return next;
      });
    };

    const handleTestSingleNote = async () => {
      const val = activeFrame?.normalizedBrightness ?? 0.5;
      const note = await engine.playSingleNote(val);
      setSingleNoteStatus(`Played Tone.js ${scaleType} note ${note}`);
    };

    const handleToggleRecording = async () => {
      if (isRecording) {
        const blob = await engine.stopRecording();
        setIsRecording(false);
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `helios-${selectedTrackId}-${scaleType}.webm`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 4000);
        }
      } else {
        await engine.startRecording();
        setIsRecording(true);
      }
    };

    const handleCopyShareLink = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      } catch {
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    };

    const handleLoadGibsSnapshot = async () => {
      if (!selectedGibsLayer) return;
      setGibsLoading(true);
      setGibsStatus(null);
      const url = buildGibsImageProxyUrl(selectedGibsLayer, gibsDate);
      try {
        const res = await fetch(url);
        if (!res.ok) {
          const errJson = await res.json().catch(() => ({}));
          throw new Error(errJson.error || `GIBS proxy HTTP ${res.status}`);
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        setGibsSnapshotUrl((prev) => {
          if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
          return objUrl;
        });
        const usedDate = res.headers.get('X-Gibs-Date') || gibsDate;
        setGibsStatus(
          usedDate === gibsDate
            ? `Loaded live NASA GIBS ${selectedGibsLayer} (${usedDate})`
            : usedDate === 'static-black-marble'
            ? `No live night imagery for ${gibsDate}; showing NASA Black Marble static night-lights map`
            : `Loaded live NASA GIBS ${selectedGibsLayer} (${usedDate}; no usable data for ${gibsDate}, showing nearest earlier day)`
        );
      } catch (err) {
        setGibsStatus(
          err instanceof Error ? err.message : 'Unable to fetch NASA GIBS daily snapshot'
        );
      } finally {
        setGibsLoading(false);
      }
    };

    // Custom click-and-drag ROI rectangle handlers on the 2D stage
    const handleStagePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (stageMode !== '2d' || dualStereoMode || gibsSnapshotUrl) return;
      const el = stageImgContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setDragStart({ x, y });
      setDragRect({ x, y, w: 0, h: 0 });
    };

    const handleStagePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!dragStart) return;
      const el = stageImgContainerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const cx = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const cy = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
      setDragRect({
        x: Math.min(dragStart.x, cx),
        y: Math.min(dragStart.y, cy),
        w: Math.abs(cx - dragStart.x),
        h: Math.abs(cy - dragStart.y),
      });
    };

    const handleStagePointerUp = () => {
      if (!dragStart || !dragRect) {
        setDragStart(null);
        setDragRect(null);
        return;
      }
      if (dragRect.w >= 0.06 && dragRect.h >= 0.06) {
        setActiveRoi({
          id: 'custom',
          label: `Custom ROI (${Math.round(dragRect.w * 100)}% × ${Math.round(dragRect.h * 100)}%)`,
          x: Number(dragRect.x.toFixed(3)),
          y: Number(dragRect.y.toFixed(3)),
          w: Number(dragRect.w.toFixed(3)),
          h: Number(dragRect.h.toFixed(3)),
        });
      }
      setDragStart(null);
      setDragRect(null);
    };

    useImperativeHandle(
      ref,
      () => ({
        togglePlayback: () => {
          void handleTogglePlay();
        },
        resetTimeline: () => {
          handleSeek(0);
        },
      }),
      [handleTogglePlay, handleSeek]
    );

    // Local frame stepping with Arrow keys
    const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (e.code === 'ArrowRight' && activeTrack) {
        e.preventDefault();
        handleSeek((frameIndex + 1) % activeTrack.frames.length);
      } else if (e.code === 'ArrowLeft' && activeTrack) {
        e.preventDefault();
        handleSeek(
          (frameIndex - 1 + activeTrack.frames.length) % activeTrack.frames.length
        );
      }
    };

    const surfaceBg = highContrast ? 'bg-black' : 'bg-[#07090E]';
    const panelBg = highContrast ? 'bg-black border-white' : 'bg-[#0B0F19] border-slate-800';
    const textPrimary = highContrast ? 'text-white' : 'text-slate-100';
    const textMuted = highContrast ? 'text-slate-100' : 'text-slate-400';
    const accentText = highContrast ? 'text-yellow-300' : 'text-cyan-400';
    const focusRing = highContrast
      ? 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-300'
      : 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400';
    const accentBtn = highContrast
      ? `bg-yellow-300 text-black hover:bg-yellow-200 border border-white ${focusRing}`
      : `bg-cyan-500 text-slate-950 hover:bg-cyan-400 ${focusRing}`;

    const bodyScale = largerText ? 'text-sm' : 'text-xs';
    const headingScale = largerText ? 'text-2xl' : 'text-xl';
    const metricScale = largerText ? 'text-base sm:text-lg' : 'text-xs sm:text-sm';

    const displayMapUrl = gibsSnapshotUrl
      ? gibsSnapshotUrl
      : getFrameSrc(activeFrame?.imageUrl ?? '');

    if (loading) {
      return (
        <div className="mx-auto max-w-[1200px] px-6 py-12 text-sm font-mono text-slate-400">
          Loading NASA SVS Earth Now frames &amp; track.json...
        </div>
      );
    }

    if (error || !catalog || !activeTrack || !activeFrame) {
      return (
        <div className="mx-auto max-w-[1200px] px-6 py-12 text-sm text-rose-300">
          {error ?? 'No Earth Now tracks found in public/earth-now/track.json.'}
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label="NASA Earth Now Audio Frame Player"
        className={`relative min-h-[calc(100vh-3.5rem)] ${surfaceBg} ${textPrimary} px-6 py-6 focus:outline-none`}
      >
        <a
          href="#earth-now-controls"
          className={`sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-6 focus:z-50 px-4 py-2 text-xs font-semibold ${accentBtn}`}
        >
          Skip to controls
        </a>

        <div className="mx-auto max-w-[1280px] space-y-6">
          {/* Workspace Header + Action & Accessibility Toolbar */}
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 border-b border-slate-800 pb-4">
            <div>
              <div className={`text-xs font-mono ${accentText}`}>
                NASA SVS Earth Now Jukebox · SVS #{activeTrack.svsId}
              </div>
              <h1 className={`mt-1 ${headingScale} font-semibold tracking-tight`}>
                {dualStereoMode
                  ? 'Stereo Comparison: Temperature (L) + Precipitation (R)'
                  : activeTrack.title}
              </h1>
            </div>

            <div className="flex flex-nowrap md:flex-wrap items-center gap-2 overflow-x-auto md:overflow-visible pb-1 md:pb-0 [&>*]:shrink-0">
              <button
                type="button"
                onClick={() => setShowIntro((v) => !v)}
                aria-expanded={showIntro}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  showIntro
                    ? 'bg-[#111827] text-cyan-300 border-cyan-500/60'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" />
                Story
              </button>

              <button
                type="button"
                onClick={handleTestSingleNote}
                aria-label="Play a single test note with Tone.js"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  highContrast
                    ? 'bg-black text-yellow-300 border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-cyan-500'
                }`}
              >
                <Music className="w-3.5 h-3.5" />
                Test Note
              </button>

              <button
                type="button"
                onClick={() => void handleToggleRecording()}
                aria-pressed={isRecording}
                aria-label={isRecording ? 'Stop and download audio mix' : 'Record audio mix'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  isRecording
                    ? 'bg-rose-500 text-white border-rose-400'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-rose-400'
                }`}
              >
                {isRecording ? <Square className="w-3 h-3" /> : <Mic className="w-3.5 h-3.5" />}
                {isRecording ? 'Stop & Save Mix' : 'Record Mix'}
              </button>

              <button
                type="button"
                onClick={() => void handleCopyShareLink()}
                aria-label="Copy shareable link with current track, frame, and audio settings"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  shareCopied
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/60'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-cyan-500'
                }`}
              >
                {shareCopied ? <Check className="w-3.5 h-3.5" /> : <Share2 className="w-3.5 h-3.5" />}
                {shareCopied ? 'Link Copied' : 'Share Link'}
              </button>

              <button
                type="button"
                onClick={() => setSpokenNarration((v) => !v)}
                aria-pressed={spokenNarration}
                aria-label="Toggle spoken timestamp and track announcements"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  spokenNarration
                    ? 'bg-[#111827] text-cyan-300 border-cyan-500/70'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                Voice Over
              </button>

              {onToggleMute && (
                <button
                  type="button"
                  onClick={onToggleMute}
                  aria-pressed={isMuted}
                  aria-label={isMuted ? 'Unmute audio (M)' : 'Mute audio (M)'}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                    isMuted
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/60'
                      : highContrast
                      ? 'bg-black text-white border-white hover:bg-zinc-900'
                      : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                  }`}
                >
                  {isMuted ? (
                    <VolumeX className="w-3.5 h-3.5" />
                  ) : (
                    <Volume2 className="w-3.5 h-3.5" />
                  )}
                  {isMuted ? 'Muted' : 'Mute'}
                </button>
              )}

              <button
                type="button"
                onClick={() => setReduceMotion((v) => !v)}
                aria-pressed={reduceMotion}
                aria-label="Toggle reduce motion accessibility mode"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  reduceMotion
                    ? highContrast
                      ? 'bg-white text-black border-white'
                      : 'bg-[#111827] text-cyan-300 border-cyan-500/70'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Reduce Motion
              </button>

              <button
                type="button"
                onClick={() => setLargerText((v) => !v)}
                aria-pressed={largerText}
                aria-label="Toggle larger text accessibility mode"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  largerText
                    ? highContrast
                      ? 'bg-white text-black border-white'
                      : 'bg-[#111827] text-cyan-300 border-cyan-500/70'
                    : highContrast
                    ? 'bg-black text-white border-white hover:bg-zinc-900'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                <Type className="w-3.5 h-3.5" />
                Larger Text
              </button>

              <button
                type="button"
                onClick={() => setHighContrast((v) => !v)}
                aria-pressed={highContrast}
                aria-label="Toggle high contrast accessibility mode"
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                  highContrast
                    ? 'bg-white text-black border-white'
                    : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-slate-500'
                }`}
              >
                <Eye className="w-3.5 h-3.5" />
                High Contrast
              </button>
            </div>
          </div>

          {/* Intro / Story Panel */}
          {showIntro && (
            <section
              aria-label="What you are about to hear"
              className={`border ${panelBg} p-5 flex flex-col md:flex-row md:items-center justify-between gap-5`}
            >
              <div className="space-y-2 max-w-3xl">
                <div className={`font-mono text-xs ${accentText}`}>
                  What You&apos;re About to Hear
                </div>
                <h2 className={largerText ? 'text-lg font-semibold' : 'text-base font-semibold'}>
                  Listening to NASA&apos;s Earth Now Visualization Frames
                </h2>
                <p className={`${bodyScale} leading-relaxed ${textMuted}`}>
                  Each track turns 72 hours of NASA SVS Earth Now global map imagery into sound.
                  Our pipeline samples the average pixel brightness of every visualization frame (or
                  any custom latitudinal Region of Interest you drag across the map) and maps it onto
                  selectable Pentatonic, Dorian, or Minor scales, while an optional second atmospheric
                  noise layer responds to bright cloud and highlight coverage. Switch to{' '}
                  <strong className={textPrimary}>3D Globe</strong> to wrap frames around an
                  interactive Three.js Earth with an orbiting satellite, or load{' '}
                  <strong className={textPrimary}>Live NASA GIBS</strong> daily imagery directly.
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => void handleTogglePlay()}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold cursor-pointer whitespace-nowrap ${accentBtn}`}
                >
                  <Play className="w-3.5 h-3.5" />
                  Start Listening
                </button>
                <button
                  type="button"
                  onClick={() => setShowIntro(false)}
                  className={`px-3.5 py-2.5 text-xs border cursor-pointer whitespace-nowrap ${focusRing} ${
                    highContrast
                      ? 'border-white text-white hover:bg-zinc-900'
                      : 'border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}

          {/* Jukebox-Style Visual Track Selector Cards */}
          <section aria-label="Jukebox track selector" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ListMusic className={`w-4 h-4 ${accentText}`} />
                <h2 className={largerText ? 'text-base font-semibold' : 'text-sm font-semibold'}>
                  Earth Now Jukebox
                </h2>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    if (dualStereoMode) setDualStereoMode(false);
                    setPlayAllMode((v) => !v);
                  }}
                  aria-pressed={playAllMode}
                  aria-label="Toggle Play All jukebox queue mode"
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                    playAllMode
                      ? accentBtn
                      : highContrast
                      ? 'bg-black text-white border-white hover:bg-zinc-900'
                      : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-cyan-500'
                  }`}
                >
                  <ListMusic className="w-3.5 h-3.5" />
                  {playAllMode ? 'Play All Queue: On' : 'Play All Queue: Off'}
                </button>

                <button
                  type="button"
                  onClick={handleToggleDualStereo}
                  aria-pressed={dualStereoMode}
                  aria-label="Play Temperature in left ear and Precipitation in right ear simultaneously"
                  className={`inline-flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                    dualStereoMode
                      ? 'bg-amber-400 text-slate-950 border-amber-300 font-semibold'
                      : highContrast
                      ? 'bg-black text-white border-white hover:bg-zinc-900'
                      : 'bg-[#0B0F19] text-slate-200 border-slate-700 hover:border-amber-400'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  {dualStereoMode
                    ? 'Stereo Dual: Temp (L) + Precip (R)'
                    : 'Stereo Dual-Ear Mode'}
                </button>
              </div>
            </div>

            <div className="flex md:grid md:grid-cols-3 gap-3 md:gap-4 overflow-x-auto md:overflow-visible snap-x snap-mandatory md:snap-none pb-2 md:pb-0">
              {catalog.tracks.map((track, idx) => {
                const isSelected = !dualStereoMode && track.id === activeTrack.id;
                const isInStereo =
                  dualStereoMode &&
                  (track.id === 'temperature' || track.id === 'precipitation');
                const thumbUrl = track.frames[0]?.imageUrl;

                return (
                  <button
                    key={track.id}
                    type="button"
                    onClick={() => handleSelectTrack(track.id)}
                    aria-pressed={isSelected || isInStereo}
                    className={`group text-left border transition-colors cursor-pointer overflow-hidden flex flex-col shrink-0 w-[78%] sm:w-[46%] md:w-auto snap-start ${focusRing} ${
                      isSelected
                        ? highContrast
                          ? 'bg-black border-yellow-300 ring-1 ring-yellow-300'
                          : 'bg-[#111827] border-cyan-400'
                        : isInStereo
                        ? 'bg-[#111827] border-amber-400'
                        : highContrast
                        ? 'bg-black border-white hover:border-yellow-300'
                        : 'bg-[#0B0F19] border-slate-800 hover:border-slate-600'
                    }`}
                  >
                    <div className="relative aspect-[2/1] w-full bg-black overflow-hidden border-b border-slate-800">
                      {thumbUrl && (
                        <img
                          src={getFrameSrc(thumbUrl)}
                          alt={`${track.title} preview thumbnail`}
                          className="w-full h-full object-cover block"
                        />
                      )}
                    </div>
                    <div className="p-3.5 flex-1 flex flex-col justify-between gap-2">
                      <div>
                        <div className={`font-mono text-[11px] ${textMuted}`}>
                          Track 0{idx + 1} · SVS #{track.svsId}
                          {isInStereo && (
                            <span className="text-amber-400">
                              {' '}
                              · {track.id === 'temperature' ? 'LEFT EAR' : 'RIGHT EAR'}
                            </span>
                          )}
                        </div>
                        <div className={`mt-0.5 font-semibold ${largerText ? 'text-base' : 'text-sm'}`}>
                          {track.title}
                        </div>
                      </div>
                      <p className={`${bodyScale} leading-snug ${textMuted}`}>
                        {track.soundPreview ?? track.audioLegend}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Main Two-Column Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Left/Main: Stage + Spectrum Strip + Readout + Scrubber */}
            <div className="lg:col-span-8 space-y-4">
              <div className={`border ${panelBg} overflow-hidden`}>
                {/* Top Status & 2D/3D Stage Toggle Bar */}
                <div
                  className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] tabular-nums ${
                    highContrast ? 'border-white bg-black' : 'border-slate-800 bg-[#07090E]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActiveReady ? 'text-emerald-400' : accentText}>
                      {isActiveReady
                        ? `Frames Preloaded: ${activeLoaded}/${activeTotal}`
                        : `Preloading: ${activeLoaded}/${activeTotal}...`}
                    </span>
                    <span className={textMuted}>
                      Frame {String(frameIndex + 1).padStart(2, '0')}/{activeTrack.frameCount}
                    </span>
                    {spikeAlertActive && (
                      <span className="text-amber-400 font-semibold">
                        Δ Spike Alert
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStageMode('2d')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] border cursor-pointer whitespace-nowrap ${focusRing} ${
                        stageMode === '2d'
                          ? 'bg-[#111827] text-cyan-300 border-cyan-500/70'
                          : 'border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <MapIcon className="w-3 h-3" />
                      2D Frame
                    </button>
                    <button
                      type="button"
                      onClick={() => setStageMode('3d')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] border cursor-pointer whitespace-nowrap ${focusRing} ${
                        stageMode === '3d'
                          ? 'bg-[#111827] text-cyan-300 border-cyan-500/70'
                          : 'border-slate-700 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Globe className="w-3 h-3" />
                      3D Globe
                    </button>
                  </div>
                </div>

                {/* Region-of-Interest Preset Strip */}
                <div
                  className={`border-b px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs ${
                    highContrast ? 'border-white bg-black' : 'border-slate-800 bg-[#0B0F19]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-300">
                    <Crop className="w-3.5 h-3.5 text-amber-400" />
                    <span>Region of Interest:</span>
                    <span className={accentText}>{activeRoi.label}</span>
                    {roiSampling && <span className="text-amber-300">(sampling...)</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ROI_PRESETS.map((preset) => (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => setActiveRoi(preset)}
                        className={`px-2 py-0.5 text-[11px] font-mono border transition-colors cursor-pointer whitespace-nowrap ${focusRing} ${
                          activeRoi.id === preset.id
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/70'
                            : 'bg-[#07090E] text-slate-400 border-slate-800 hover:text-slate-200'
                        }`}
                      >
                        {preset.id === 'north-atlantic'
                          ? 'N. Atlantic'
                          : preset.id === 'tropics'
                          ? 'Tropics'
                          : preset.id === 'arctic'
                          ? 'Arctic'
                          : preset.id === 'pacific'
                          ? 'Pacific'
                          : 'Global'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Primary Viewport Stage */}
                {stageMode === '3d' ? (
                  <div className="aspect-[2/1] w-full bg-black">
                    <Globe3DView
                      mapImageUrl={displayMapUrl}
                      normalizedIntensity={activeFrame.normalizedBrightness}
                      cloudCoverNormalized={activeFrame.normalizedCloudCover}
                      isPlaying={isPlaying}
                      reduceMotion={reduceMotion}
                      roiBox={activeRoi}
                      getSpectrumBins={() => engine.getAnalyserData().fft}
                      label={gibsSnapshotUrl ? `NASA GIBS (${gibsDate})` : activeTrack.title}
                      sublabel={`${activeFrame.timeLabel} · ${currentNote}`}
                    />
                  </div>
                ) : dualStereoMode && tempTrack && precipTrack ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 bg-black divide-y sm:divide-y-0 sm:divide-x divide-slate-800">
                    <div className="relative aspect-[2/1] w-full">
                      <img
                        src={getFrameSrc(
                          tempTrack.frames[frameIndex % tempTrack.frames.length].imageUrl
                        )}
                        alt={`Left channel Temperature frame ${frameIndex + 1}`}
                        className="w-full h-full object-contain block"
                      />
                      <div className="absolute top-2 left-2 bg-black/85 border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-cyan-300">
                        L EAR · TEMPERATURE ({currentNote})
                      </div>
                    </div>
                    <div className="relative aspect-[2/1] w-full">
                      {rightFrame && (
                        <img
                          src={getFrameSrc(rightFrame.imageUrl)}
                          alt={`Right channel Precipitation frame ${frameIndex + 1}`}
                          className="w-full h-full object-contain block"
                        />
                      )}
                      <div className="absolute top-2 left-2 bg-black/85 border border-slate-700 px-2 py-0.5 font-mono text-[10px] text-amber-300">
                        R EAR · PRECIPITATION ({rightEarNote ?? '—'})
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    ref={stageImgContainerRef}
                    onPointerDown={handleStagePointerDown}
                    onPointerMove={handleStagePointerMove}
                    onPointerUp={handleStagePointerUp}
                    onPointerLeave={() => {
                      if (dragStart) handleStagePointerUp();
                    }}
                    className="relative aspect-[2/1] w-full bg-black overflow-hidden select-none cursor-crosshair"
                  >
                    <img
                      src={displayMapUrl}
                      alt={`${activeTrack.title} frame ${activeFrame.index + 1} at ${activeFrame.timeLabel}`}
                      draggable={false}
                      className="w-full h-full object-contain block pointer-events-none"
                    />
                    {prevImageUrl && !reduceMotion && !gibsSnapshotUrl && (
                      <img
                        src={getFrameSrc(prevImageUrl)}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className={`pointer-events-none absolute inset-0 w-full h-full object-contain block transition-opacity duration-150 ${
                          crossFadeActive ? 'opacity-0' : 'opacity-100'
                        }`}
                      />
                    )}

                    {/* Active ROI Box Overlay */}
                    {activeRoi.id !== 'global' && !gibsSnapshotUrl && (
                      <div
                        className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/10"
                        style={{
                          left: `${activeRoi.x * 100}%`,
                          top: `${activeRoi.y * 100}%`,
                          width: `${activeRoi.w * 100}%`,
                          height: `${activeRoi.h * 100}%`,
                        }}
                      >
                        <span className="absolute -top-5 left-0 bg-black/85 px-1.5 py-0.5 font-mono text-[10px] text-amber-300 whitespace-nowrap">
                          {activeRoi.label}
                        </span>
                      </div>
                    )}

                    {/* Live Dragging ROI Preview */}
                    {dragRect && (
                      <div
                        className="pointer-events-none absolute border-2 border-dashed border-cyan-300 bg-cyan-400/15"
                        style={{
                          left: `${dragRect.x * 100}%`,
                          top: `${dragRect.y * 100}%`,
                          width: `${dragRect.w * 100}%`,
                          height: `${dragRect.h * 100}%`,
                        }}
                      />
                    )}

                    {gibsSnapshotUrl && (
                      <div className="absolute top-2 left-2 flex items-center gap-2 bg-black/85 border border-cyan-500/60 px-2.5 py-1 font-mono text-[11px] text-cyan-200">
                        <span>NASA GIBS Live: {selectedGibsLayer} ({gibsDate})</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setGibsSnapshotUrl(null);
                          }}
                          className="text-amber-300 hover:underline cursor-pointer"
                        >
                          Return to SVS Loop
                        </button>
                      </div>
                    )}

                    {!gibsSnapshotUrl && activeRoi.id === 'global' && (
                      <div className="pointer-events-none absolute bottom-2 right-2 bg-black/75 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                        Tip: Drag any rectangle on the map to sonify a custom region
                      </div>
                    )}
                  </div>
                )}

                {/* Readout Directly Under Image */}
                <div
                  aria-live="polite"
                  className={`border-t px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-4 ${
                    highContrast ? 'border-white bg-black' : 'border-slate-800 bg-[#0B0F19]'
                  }`}
                >
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>Time Label</div>
                    <div className={`mt-0.5 font-mono ${metricScale} font-semibold tabular-nums`}>
                      {activeFrame.timeLabel}
                    </div>
                  </div>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>
                      {activeTrack.primaryMetricName}
                    </div>
                    <div className={`mt-0.5 font-mono ${metricScale} font-semibold tabular-nums ${accentText}`}>
                      {activeFrame.brightness.toFixed(2)}{' '}
                      <span className={`text-[11px] font-normal ${textMuted}`}>
                        {activeTrack.primaryUnit}
                      </span>
                    </div>
                  </div>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>
                      {dualStereoMode ? 'Stereo Notes (L / R)' : `Mapped Note (${scaleType})`}
                    </div>
                    <div className={`mt-0.5 font-mono ${metricScale} font-semibold text-amber-400 tabular-nums`}>
                      {dualStereoMode
                        ? `${currentNote} / ${rightEarNote ?? '—'}`
                        : currentNote}
                    </div>
                  </div>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>
                      {activeTrack.secondaryMetricName}
                    </div>
                    <div className={`mt-0.5 font-mono ${metricScale} font-semibold tabular-nums`}>
                      {activeFrame.cloudCover.toFixed(1)}%
                    </div>
                  </div>
                </div>

                {/* Live Tone.Analyser FFT & Waveform Strip */}
                <EarthNowSpectrumStrip
                  engine={engine}
                  isPlaying={isPlaying}
                  isMuted={isMuted}
                  reduceMotion={reduceMotion}
                  highContrast={highContrast}
                />
              </div>

              {/* Dual-Track Correlation Readout (when Stereo Mode is active) */}
              {dualStereoMode && stereoCorrelation && rightFrame && (
                <div className={`border ${panelBg} p-4 grid grid-cols-1 sm:grid-cols-3 gap-4`}>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>
                      Temperature vs Precipitation Pearson r
                    </div>
                    <div className={`mt-0.5 font-mono text-base font-semibold tabular-nums ${accentText}`}>
                      r = {stereoCorrelation.r >= 0 ? '+' : ''}
                      {stereoCorrelation.r.toFixed(3)}
                    </div>
                  </div>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>Relationship</div>
                    <div className="mt-0.5 font-mono text-sm font-medium text-slate-200">
                      {stereoCorrelation.label}
                    </div>
                  </div>
                  <div>
                    <div className={`text-[11px] ${textMuted}`}>Live L − R Brightness Delta</div>
                    <div className="mt-0.5 font-mono text-base font-semibold text-amber-400 tabular-nums">
                      {(activeFrame.brightness - rightFrame.brightness).toFixed(2)} luma
                    </div>
                  </div>
                </div>
              )}

              {/* Timeline Scrubber, Transport, Scale & Synth Voice Controls */}
              <div
                id="earth-now-controls"
                tabIndex={-1}
                className={`border ${panelBg} p-4 space-y-4 focus:outline-none`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label
                    htmlFor="earth-now-scrubber"
                    className={`${bodyScale} font-medium`}
                  >
                    Timeline Scrubber (Frame {frameIndex + 1} of {activeTrack.frameCount})
                  </label>
                  <span className={`font-mono text-[11px] ${textMuted}`}>
                    Space: Play/Pause · R: Reset · M: Mute · Arrows: Step
                  </span>
                </div>

                <input
                  id="earth-now-scrubber"
                  type="range"
                  aria-label="Timeline frame scrubber"
                  min={0}
                  max={activeTrack.frameCount - 1}
                  step={1}
                  value={frameIndex}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className={`w-full ${focusRing}`}
                />

                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        handleSeek(
                          (frameIndex - 1 + activeTrack.frameCount) % activeTrack.frameCount
                        )
                      }
                      aria-label="Previous frame"
                      className={`p-2.5 border transition-colors cursor-pointer ${focusRing} ${
                        highContrast
                          ? 'border-white bg-black text-white hover:bg-zinc-900'
                          : 'border-slate-700 bg-[#07090E] text-slate-200 hover:border-slate-500'
                      }`}
                    >
                      <SkipBack className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={handleTogglePlay}
                      aria-label={isPlaying ? 'Pause frame sonification' : 'Play frame sonification'}
                      className={`inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${accentBtn}`}
                    >
                      {isPlaying ? (
                        <>
                          <Pause className="w-4 h-4" />
                          Pause Sonification
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4" />
                          {playAllMode ? 'Play All Tracks' : 'Play All Frames'}
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => handleSeek((frameIndex + 1) % activeTrack.frameCount)}
                      aria-label="Next frame"
                      className={`p-2.5 border transition-colors cursor-pointer ${focusRing} ${
                        highContrast
                          ? 'border-white bg-black text-white hover:bg-zinc-900'
                          : 'border-slate-700 bg-[#07090E] text-slate-200 hover:border-slate-500'
                      }`}
                    >
                      <SkipForward className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Volume & Speed */}
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Volume2 className={`w-4 h-4 ${textMuted}`} />
                      <label htmlFor="earth-now-volume" className="sr-only">
                        Master volume
                      </label>
                      <input
                        id="earth-now-volume"
                        type="range"
                        aria-label="Master volume"
                        min={0}
                        max={1}
                        step={0.02}
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          if (isMuted && v > 0 && onToggleMute) {
                            onToggleMute();
                          }
                          setVolume(v);
                        }}
                        className={`w-24 ${focusRing}`}
                      />
                      <span className={`font-mono text-[11px] w-10 text-right tabular-nums ${textMuted}`}>
                        {isMuted ? 'MUTE' : `${Math.round(volume * 100)}%`}
                      </span>
                    </div>

                    <label className="flex items-center gap-2 text-xs">
                      <span className={textMuted}>Interval</span>
                      <select
                        aria-label="Frame playback interval"
                        value={stepMs}
                        onChange={(e) => setStepMs(Number(e.target.value))}
                        className={`px-2.5 py-1.5 font-mono text-xs border ${focusRing} ${
                          highContrast
                            ? 'bg-black text-white border-white'
                            : 'bg-[#07090E] text-slate-200 border-slate-700'
                        }`}
                      >
                        <option value={700}>700 ms</option>
                        <option value={420}>420 ms</option>
                        <option value={220}>220 ms</option>
                      </select>
                    </label>
                  </div>
                </div>

                {/* Scale, Instrument Voice & Spike Chime Row */}
                <div className="pt-3 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="block">
                    <span className={`text-[11px] ${textMuted}`}>Musical Scale</span>
                    <select
                      aria-label="Select musical scale"
                      value={scaleType}
                      onChange={(e) => setScaleType(e.target.value as MusicalScaleType)}
                      className={`mt-1 w-full px-2.5 py-1.5 font-mono text-xs border ${focusRing} ${
                        highContrast
                          ? 'bg-black text-white border-white'
                          : 'bg-[#07090E] text-slate-200 border-slate-700'
                      }`}
                    >
                      <option value="pentatonic">C Major Pentatonic</option>
                      <option value="dorian">C Dorian</option>
                      <option value="minor">C Natural Minor</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className={`text-[11px] ${textMuted}`}>Synth Voice</span>
                    <select
                      aria-label="Select synthesizer voice"
                      value={voiceType}
                      onChange={(e) => setVoiceType(e.target.value as SynthVoiceType)}
                      className={`mt-1 w-full px-2.5 py-1.5 font-mono text-xs border ${focusRing} ${
                        highContrast
                          ? 'bg-black text-white border-white'
                          : 'bg-[#07090E] text-slate-200 border-slate-700'
                      }`}
                    >
                      <option value="triangle">Triangle Lead</option>
                      <option value="marimba">Soft Marimba</option>
                      <option value="warm-pad">Warm Atmospheric Pad</option>
                      <option value="plucked-sine">Plucked Bell</option>
                    </select>
                  </label>

                  <div className="flex items-end">
                    <button
                      type="button"
                      onClick={() => setSpikeAlertsEnabled((v) => !v)}
                      aria-pressed={spikeAlertsEnabled}
                      className={`w-full inline-flex items-center justify-center gap-2 px-3 py-1.5 font-mono text-xs border cursor-pointer transition-colors ${focusRing} ${
                        spikeAlertsEnabled
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/60'
                          : 'bg-[#07090E] text-slate-400 border-slate-700'
                      }`}
                    >
                      <Bell className="w-3.5 h-3.5" />
                      Spike Chime: {spikeAlertsEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Sidebar: Legend + Layer 2 + Live NASA GIBS + Brightness Profile */}
            <aside className="lg:col-span-4 space-y-4">
              {/* Honest Audio Legend */}
              <div className={`border ${panelBg} p-5 space-y-3`}>
                <div className="flex items-center gap-2">
                  <Volume2 className={`w-4 h-4 ${accentText}`} />
                  <h2 className={largerText ? 'text-base font-semibold' : 'text-sm font-semibold'}>
                    Audio Legend
                  </h2>
                </div>
                <p className={`${bodyScale} leading-relaxed ${textMuted}`}>
                  {activeTrack.audioLegend}
                </p>

                <div className="pt-2 border-t border-slate-800 space-y-2 text-xs font-mono">
                  <div className="flex justify-between">
                    <span className={textMuted}>Scale &amp; Voice</span>
                    <span className={accentText}>
                      {scaleType} · {voiceType}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textMuted}>Sync Clock</span>
                    <span>Tone.Transport + Analyser</span>
                  </div>
                  <div className="flex justify-between">
                    <span className={textMuted}>Active Sampling Region</span>
                    <span className="text-amber-300 truncate max-w-[170px]">{activeRoi.label}</span>
                  </div>
                </div>

                {singleNoteStatus && (
                  <div className="border border-cyan-500/40 bg-cyan-950/30 px-3 py-2 font-mono text-[11px] text-cyan-200">
                    {singleNoteStatus}
                  </div>
                )}
              </div>

              {/* Layer 2: Highlight Cover Texture */}
              <div className={`border ${panelBg} p-5 space-y-3`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CloudRain className="w-4 h-4 text-amber-400" />
                    <h2 className={largerText ? 'text-base font-semibold' : 'text-sm font-semibold'}>
                      Layer 2: Highlight Cover Texture
                    </h2>
                  </div>
                  <input
                    id="cloud-layer-toggle"
                    type="checkbox"
                    aria-label="Enable second bright highlight cover sound layer"
                    checked={cloudLayerEnabled}
                    onChange={(e) => setCloudLayerEnabled(e.target.checked)}
                    className={`w-4 h-4 accent-cyan-500 cursor-pointer ${focusRing}`}
                  />
                </div>
                <label
                  htmlFor="cloud-layer-toggle"
                  className={`block ${bodyScale} leading-relaxed cursor-pointer ${textMuted}`}
                >
                  Adds a filtered pink-noise layer modulated by bright cloud and highlight coverage
                  in the active region ({activeFrame.cloudCover.toFixed(1)}% in current frame).
                </label>
              </div>

              {/* Live NASA GIBS Daily Satellite Snapshot Loader */}
              <div className={`border ${panelBg} p-5 space-y-3`}>
                <div className="flex items-center gap-2">
                  <Satellite className={`w-4 h-4 ${accentText}`} />
                  <h2 className={largerText ? 'text-base font-semibold' : 'text-sm font-semibold'}>
                    NASA GIBS Live Daily Map
                  </h2>
                </div>
                <p className={`${bodyScale} leading-relaxed ${textMuted}`}>
                  Fetch today&apos;s global satellite imagery via our Express{' '}
                  <code className="font-mono text-[11px]">/api/nasa/gibs/image</code> proxy and
                  wrap it onto the 3D Globe or 2D stage.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    aria-label="Select NASA GIBS layer"
                    value={selectedGibsLayer}
                    onChange={(e) => setSelectedGibsLayer(e.target.value)}
                    className={`px-2 py-1.5 font-mono text-[11px] border ${focusRing} ${
                      highContrast
                        ? 'bg-black text-white border-white'
                        : 'bg-[#07090E] text-slate-200 border-slate-700'
                    }`}
                  >
                    {gibsLayers.length > 0 ? (
                      gibsLayers.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.title}
                        </option>
                      ))
                    ) : (
                      <option value="MODIS_Terra_CorrectedReflectance_TrueColor">
                        MODIS Terra True Color
                      </option>
                    )}
                  </select>
                  <input
                    type="date"
                    aria-label="NASA GIBS imagery date"
                    value={gibsDate}
                    onChange={(e) => setGibsDate(e.target.value)}
                    className={`px-2 py-1.5 font-mono text-[11px] border ${focusRing} ${
                      highContrast
                        ? 'bg-black text-white border-white'
                        : 'bg-[#07090E] text-slate-200 border-slate-700'
                    }`}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleLoadGibsSnapshot()}
                  disabled={gibsLoading}
                  className={`w-full py-2 px-3 text-xs font-medium border transition-colors cursor-pointer ${focusRing} ${
                    highContrast
                      ? 'bg-yellow-300 text-black border-white'
                      : 'bg-[#111827] text-cyan-300 border-cyan-500/60 hover:bg-cyan-500/20'
                  }`}
                >
                  {gibsLoading ? 'Fetching Satellite Map...' : 'Load NASA GIBS Snapshot'}
                </button>
                {gibsStatus && (
                  <div className="font-mono text-[11px] text-emerald-300 leading-snug">
                    {gibsStatus}
                  </div>
                )}
              </div>

              {/* Brightness Curve Mini-Bar Preview with Spike Markers */}
              <div className={`border ${panelBg} p-5 space-y-3`}>
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold">Per-Frame Brightness &amp; Spikes</span>
                  <span className={`font-mono text-[11px] ${textMuted}`}>
                    {spikeFrameIndices.size} spikes · {activeRoi.id}
                  </span>
                </div>
                <div className="flex items-end gap-[2px] h-20 pt-2">
                  {effectiveFrames.map((f) => {
                    const isCurrent = f.index === frameIndex;
                    const hasSpike = spikeFrameIndices.has(f.index);
                    const heightPct = Math.max(12, Math.round(f.normalizedBrightness * 100));
                    return (
                      <button
                        key={f.index}
                        type="button"
                        onClick={() => handleSeek(f.index)}
                        aria-label={`Jump to frame ${f.index + 1}, brightness ${f.brightness}${
                          hasSpike ? ', rapid change spike' : ''
                        }`}
                        className={`relative flex-1 transition-opacity cursor-pointer ${focusRing} ${
                          isCurrent
                            ? 'bg-amber-400'
                            : hasSpike
                            ? 'bg-rose-400/80 hover:bg-rose-300'
                            : highContrast
                            ? 'bg-white/70 hover:bg-white'
                            : 'bg-cyan-500/50 hover:bg-cyan-400'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                    );
                  })}
                </div>
                <a
                  href={activeTrack.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={`inline-flex items-center gap-1.5 text-xs ${accentText} hover:underline ${focusRing}`}
                >
                  View NASA SVS #{activeTrack.svsId} Source
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </aside>
          </div>
        </div>
      </div>
    );
  }
);
