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
  RotateCcw,
  Sparkles,
  Satellite,
  Activity,
  Upload,
  Volume2,
  VolumeX,
  RefreshCw,
} from 'lucide-react';
import { MissionSoundscapeEngine } from '../audio/MissionSoundscapeEngine';
import { fetchLiveIssTelemetry } from '../services/nasaApi';
import type { IssTelemetryResponse } from '../types/nasa';
import { Globe3DView } from './Globe3DView';

export type MissionPresetTab = 'chandra' | 'jwst' | 'iss';

export interface MissionsTabHandle {
  togglePlayback: () => void;
  resetTimeline: () => void;
}

interface MissionsTabProps {
  isMuted?: boolean;
  onToggleMute?: () => void;
}

interface ChandraSceneSpec {
  id: 'cas-a' | 'pillars' | 'sgr-a';
  title: string;
  target: string;
  observatories: string;
  distance: string;
  description: string;
}

const CHANDRA_SCENES: ChandraSceneSpec[] = [
  {
    id: 'cas-a',
    title: 'Cassiopeia A Supernova Remnant',
    target: 'Cas A · 3C 461',
    observatories: 'Chandra X-Ray · Hubble Optical · Spitzer IR',
    distance: '11,000 ly',
    description:
      'High-energy cyan X-ray shockwave shells surround golden silicon filaments and deep crimson infrared debris around a central neutron star.',
  },
  {
    id: 'pillars',
    title: 'Eagle Nebula · Pillars of Creation',
    target: 'M16 · NGC 6611',
    observatories: 'Chandra X-Ray · JWST NIRCam / MIRI',
    distance: '6,500 ly',
    description:
      'Three towering gas columns shimmer in amber/crimson dust while piercing blue X-ray point sources crown the newborn star nurseries at their tips.',
  },
  {
    id: 'sgr-a',
    title: 'Galactic Center · Sagittarius A*',
    target: 'Sgr A* · Galactic Plane',
    observatories: 'Chandra X-Ray · Hubble · Spitzer',
    distance: '26,670 ly',
    description:
      'Diagonal Milky Way stellar plane crossed by relativistic X-ray jets, superheated plasma knots, and diffuse infrared dust lanes.',
  },
];

interface AbsorptionBand {
  molecule: string;
  centerUm: number;
  widthUm: number;
  depth: number; // 0.1..0.85
  color: string;
}

interface JwstTargetSpec {
  id: 'wasp-39b' | 'wasp-96b' | 'trappist-1e';
  title: string;
  instrument: string;
  planetClass: string;
  summary: string;
  bands: AbsorptionBand[];
}

const JWST_TARGETS: JwstTargetSpec[] = [
  {
    id: 'wasp-39b',
    title: 'WASP-39 b · First Exoplanet SO₂ & CO₂ Detection',
    instrument: 'JWST NIRSpec PRISM (0.6 – 5.3 μm)',
    planetClass: 'Hot Saturn · 700 ly (Virgo)',
    summary:
      'Clear H₂O vapor valleys paired with a landmark photochemical SO₂ dip at 4.05 μm and a towering CO₂ absorption trench at 4.35 μm.',
    bands: [
      { molecule: 'H₂O', centerUm: 1.4, widthUm: 0.22, depth: 0.48, color: '#38BDF8' },
      { molecule: 'H₂O', centerUm: 1.9, widthUm: 0.26, depth: 0.54, color: '#38BDF8' },
      { molecule: 'H₂O', centerUm: 2.85, widthUm: 0.34, depth: 0.62, color: '#38BDF8' },
      { molecule: 'SO₂', centerUm: 4.05, widthUm: 0.16, depth: 0.44, color: '#F59E0B' },
      { molecule: 'CO₂', centerUm: 4.38, widthUm: 0.24, depth: 0.84, color: '#F43F5E' },
    ],
  },
  {
    id: 'wasp-96b',
    title: 'WASP-96 b · Steam Atmosphere Water Signature',
    instrument: 'JWST NIRISS SOSS (0.6 – 4.8 μm)',
    planetClass: 'Hot Gas Giant · 1,150 ly (Phoenix)',
    summary:
      'Strong multi-harmonic water vapor absorption peaks prove clouds do not block deep infrared light escaping from this scorching gas giant.',
    bands: [
      { molecule: 'K / Haze', centerUm: 0.82, widthUm: 0.18, depth: 0.26, color: '#A855F7' },
      { molecule: 'H₂O', centerUm: 1.15, widthUm: 0.20, depth: 0.42, color: '#38BDF8' },
      { molecule: 'H₂O', centerUm: 1.42, widthUm: 0.24, depth: 0.68, color: '#38BDF8' },
      { molecule: 'H₂O', centerUm: 1.92, widthUm: 0.26, depth: 0.72, color: '#38BDF8' },
      { molecule: 'H₂O / CO', centerUm: 2.8, widthUm: 0.36, depth: 0.64, color: '#38BDF8' },
    ],
  },
  {
    id: 'trappist-1e',
    title: 'TRAPPIST-1 e · Habitable-Zone Terrestrial Model',
    instrument: 'JWST NIRSpec G395H Reference (0.8 – 5.2 μm)',
    planetClass: 'Temperate Earth-Sized World · 40.7 ly',
    summary:
      'Synthesized terrestrial-atmosphere benchmark showing sharp methane (CH₄), water vapor (H₂O), and carbon dioxide (CO₂) harmonic dropouts.',
    bands: [
      { molecule: 'O₂ / H₂O', centerUm: 1.38, widthUm: 0.2, depth: 0.34, color: '#38BDF8' },
      { molecule: 'H₂O', centerUm: 2.68, widthUm: 0.28, depth: 0.56, color: '#38BDF8' },
      { molecule: 'CH₄', centerUm: 3.32, widthUm: 0.22, depth: 0.66, color: '#10B981' },
      { molecule: 'CO₂', centerUm: 4.30, widthUm: 0.25, depth: 0.82, color: '#F43F5E' },
    ],
  },
];

function paintChandraDeepSpaceScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  sceneId: ChandraSceneSpec['id']
): void {
  ctx.fillStyle = '#03060C';
  ctx.fillRect(0, 0, w, h);

  // Subtle multi-color field stars
  for (let i = 0; i < 160; i++) {
    const sx = ((i * 197 + 31) % 997) / 997 * w;
    const sy = ((i * 313 + 73) % 991) / 991 * h;
    const radius = i % 9 === 0 ? 1.8 : 0.9;
    ctx.fillStyle =
      i % 5 === 0
        ? 'rgba(103, 232, 249, 0.85)'
        : i % 4 === 0
        ? 'rgba(251, 191, 36, 0.8)'
        : 'rgba(226, 232, 240, 0.65)';
    ctx.beginPath();
    ctx.arc(sx, sy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  const cx = w * 0.5;
  const cy = h * 0.5;

  if (sceneId === 'cas-a') {
    // Infrared crimson & warm dust torus
    const irGrad = ctx.createRadialGradient(cx, cy, w * 0.04, cx, cy, h * 0.42);
    irGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    irGrad.addColorStop(0.18, 'rgba(245, 158, 11, 0.72)');
    irGrad.addColorStop(0.45, 'rgba(225, 29, 72, 0.58)');
    irGrad.addColorStop(0.75, 'rgba(14, 165, 233, 0.38)');
    irGrad.addColorStop(1, 'rgba(3, 6, 12, 0)');
    ctx.fillStyle = irGrad;
    ctx.fillRect(0, 0, w, h);

    // X-ray cyan shockwave filaments (Chandra outer rim)
    ctx.lineWidth = 3;
    for (let k = 0; k < 26; k++) {
      const ang = (k / 26) * Math.PI * 2;
      const r1 = h * (0.18 + (k % 3) * 0.05);
      const r2 = h * (0.34 + (k % 4) * 0.03);
      ctx.strokeStyle =
        k % 3 === 0
          ? 'rgba(34, 211, 238, 0.75)'
          : k % 3 === 1
          ? 'rgba(251, 191, 36, 0.72)'
          : 'rgba(244, 63, 94, 0.68)';
      ctx.beginPath();
      ctx.arc(cx, cy, (r1 + r2) * 0.5, ang, ang + 0.35);
      ctx.stroke();
    }

    // Relativistic jets + bright central neutron star
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.65)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.18, h * 0.74);
    ctx.lineTo(w * 0.82, h * 0.26);
    ctx.stroke();

    ctx.fillStyle = '#E0F2FE';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (sceneId === 'pillars') {
    // Diffuse nebula glow (gold optical + teal upper ionization rim)
    const bgGlow = ctx.createLinearGradient(0, 0, w, h);
    bgGlow.addColorStop(0, 'rgba(6, 182, 212, 0.25)');
    bgGlow.addColorStop(0.5, 'rgba(217, 119, 6, 0.22)');
    bgGlow.addColorStop(1, 'rgba(153, 27, 27, 0.24)');
    ctx.fillStyle = bgGlow;
    ctx.fillRect(0, 0, w, h);

    const pillars = [
      { x: w * 0.28, topY: h * 0.16, baseW: 54 },
      { x: w * 0.50, topY: h * 0.28, baseW: 44 },
      { x: w * 0.72, topY: h * 0.42, baseW: 38 },
    ];
    for (const p of pillars) {
      const colGrad = ctx.createLinearGradient(p.x, p.topY, p.x, h);
      colGrad.addColorStop(0, 'rgba(56, 189, 248, 0.92)');
      colGrad.addColorStop(0.22, 'rgba(251, 191, 36, 0.85)');
      colGrad.addColorStop(0.65, 'rgba(220, 38, 38, 0.68)');
      colGrad.addColorStop(1, 'rgba(69, 10, 10, 0.5)');
      ctx.fillStyle = colGrad;
      ctx.beginPath();
      ctx.moveTo(p.x - p.baseW * 0.35, p.topY);
      ctx.quadraticCurveTo(p.x + p.baseW * 0.25, (p.topY + h) * 0.5, p.x + p.baseW, h);
      ctx.lineTo(p.x - p.baseW * 0.9, h);
      ctx.quadraticCurveTo(p.x - p.baseW * 0.55, (p.topY + h) * 0.5, p.x - p.baseW * 0.35, p.topY);
      ctx.fill();

      // Bright X-ray protostar bursts near pillar tips
      const starGlow = ctx.createRadialGradient(p.x, p.topY, 1, p.x, p.topY, 26);
      starGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
      starGlow.addColorStop(0.35, 'rgba(34, 211, 238, 0.85)');
      starGlow.addColorStop(1, 'rgba(34, 211, 238, 0)');
      ctx.fillStyle = starGlow;
      ctx.beginPath();
      ctx.arc(p.x, p.topY, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  // Sgr A* Galactic Center
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-0.34);
  const planeGrad = ctx.createLinearGradient(0, -h * 0.28, 0, h * 0.28);
  planeGrad.addColorStop(0, 'rgba(14, 165, 233, 0)');
  planeGrad.addColorStop(0.28, 'rgba(225, 29, 72, 0.45)');
  planeGrad.addColorStop(0.5, 'rgba(251, 191, 36, 0.86)');
  planeGrad.addColorStop(0.72, 'rgba(225, 29, 72, 0.45)');
  planeGrad.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = planeGrad;
  ctx.fillRect(-w, -h * 0.28, w * 2, h * 0.56);
  ctx.restore();

  const coreGrad = ctx.createRadialGradient(cx, cy, 4, cx, cy, h * 0.34);
  coreGrad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  coreGrad.addColorStop(0.2, 'rgba(56, 189, 248, 0.82)');
  coreGrad.addColorStop(0.55, 'rgba(245, 158, 11, 0.4)');
  coreGrad.addColorStop(1, 'rgba(3, 6, 12, 0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, w, h);
}

function evaluateSpectrumAtWavelength(
  target: JwstTargetSpec,
  wavelengthUm: number
): { fluxNorm: number; dipDepth: number; activeMolecule: string | null } {
  // Subtle physical transit depth baseline ~0.88 - 0.94
  const continuum = 0.88 - 0.04 * Math.sin(wavelengthUm * 0.9);
  let totalDip = 0;
  let strongBand: AbsorptionBand | null = null;
  let strongWeight = 0;

  for (const band of target.bands) {
    const dist = (wavelengthUm - band.centerUm) / band.widthUm;
    const gauss = Math.exp(-0.5 * dist * dist);
    const contrib = gauss * band.depth;
    totalDip += contrib;
    if (gauss > 0.55 && contrib > strongWeight) {
      strongWeight = contrib;
      strongBand = band;
    }
  }

  const dipDepth = Math.max(0, Math.min(0.92, totalDip));
  const fluxNorm = Math.max(0.06, Math.min(1, continuum - dipDepth * 0.78));
  return {
    fluxNorm,
    dipDepth,
    activeMolecule: strongBand ? strongBand.molecule : null,
  };
}

export const MissionsTab = React.forwardRef<MissionsTabHandle, MissionsTabProps>(
  function MissionsTab({ isMuted = false, onToggleMute }, ref) {
    const engine = useMemo(() => new MissionSoundscapeEngine(), []);
    const [activePreset, setActivePreset] = useState<MissionPresetTab>('chandra');
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.72);

    // -----------------------------------------------------------------------
    // 1. Chandra Deep Space Scan state
    // -----------------------------------------------------------------------
    const chandraCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const chandraSourceImageRef = useRef<HTMLImageElement | null>(null);
    const [chandraSceneId, setChandraSceneId] = useState<ChandraSceneSpec['id']>('cas-a');
    const [customImageLabel, setCustomImageLabel] = useState<string | null>(null);
    const [chandraXNorm, setChandraXNorm] = useState(0);
    const [chandraSpeed, setChandraSpeed] = useState(0.14); // screens/sec
    const [chandraReadout, setChandraReadout] = useState({
      yNorm: 0.5,
      brightness: 0,
      xrayRatio: 0.33,
      opticalRatio: 0.33,
      irRatio: 0.34,
    });

    // -----------------------------------------------------------------------
    // 2. JWST Exoplanet Spectra state
    // -----------------------------------------------------------------------
    const jwstCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const [jwstTargetId, setJwstTargetId] = useState<JwstTargetSpec['id']>('wasp-39b');
    const [jwstWavelengthUm, setJwstWavelengthUm] = useState(0.6);

    const activeJwstTarget = useMemo(
      () => JWST_TARGETS.find((t) => t.id === jwstTargetId) ?? JWST_TARGETS[0],
      [jwstTargetId]
    );

    const jwstPoint = useMemo(
      () => evaluateSpectrumAtWavelength(activeJwstTarget, jwstWavelengthUm),
      [activeJwstTarget, jwstWavelengthUm]
    );

    // -----------------------------------------------------------------------
    // 3. ISS Live Orbit Tracker state
    // -----------------------------------------------------------------------
    const [issLive, setIssLive] = useState<IssTelemetryResponse | null>(null);
    const [issError, setIssError] = useState<string | null>(null);
    const [terminatorPreviewMode, setTerminatorPreviewMode] = useState(false);
    const [terminatorPreviewDaylight, setTerminatorPreviewDaylight] = useState(0.85);
    const [terminatorAutoSweep, setTerminatorAutoSweep] = useState(true);

    const effectiveIss = useMemo<IssTelemetryResponse | null>(() => {
      if (!issLive) return null;
      if (!terminatorPreviewMode) return issLive;
      const day = Math.max(0, Math.min(1, terminatorPreviewDaylight));
      return {
        ...issLive,
        daylightFactor: day,
        solarElevationDeg: Number(((day - 0.5) * 140).toFixed(1)),
        visibility: day >= 0.45 ? 'daylight' : 'eclipsed',
      };
    }, [issLive, terminatorPreviewMode, terminatorPreviewDaylight]);

    // Sync volume / mute into engine
    useEffect(() => {
      engine.setVolume(volume);
    }, [engine, volume]);

    useEffect(() => {
      engine.setMuted(isMuted);
    }, [engine, isMuted]);

    // Clean disposal
    useEffect(() => {
      return () => {
        engine.dispose();
      };
    }, [engine]);

    // Stop playback cleanly when switching between Chandra / JWST / ISS sub-tabs
    const handleSwitchPreset = useCallback(
      (next: MissionPresetTab) => {
        setIsPlaying(false);
        engine.stopAll();
        setActivePreset(next);
      },
      [engine]
    );

    const handleTogglePlayback = useCallback(async () => {
      if (isPlaying) {
        engine.stopAll();
        setIsPlaying(false);
        return;
      }

      if (activePreset === 'chandra') {
        await engine.startChandraScan();
      } else if (activePreset === 'jwst') {
        await engine.startJwstBed();
      } else {
        await engine.startIssOrbit();
        if (effectiveIss) {
          engine.updateIssTerminator({
            daylightFactor: effectiveIss.daylightFactor,
            velocityKmh: effectiveIss.velocityKmh,
            altitudeKm: effectiveIss.altitudeKm,
            solarElevationDeg: effectiveIss.solarElevationDeg,
          });
        }
      }
      setIsPlaying(true);
    }, [isPlaying, activePreset, engine, effectiveIss]);

    const handleResetTimeline = useCallback(() => {
      if (activePreset === 'chandra') {
        setChandraXNorm(0);
      } else if (activePreset === 'jwst') {
        setJwstWavelengthUm(0.6);
      } else if (terminatorPreviewMode) {
        setTerminatorPreviewDaylight(1.0);
      }
    }, [activePreset, terminatorPreviewMode]);

    useImperativeHandle(
      ref,
      () => ({
        togglePlayback: () => void handleTogglePlayback(),
        resetTimeline: handleResetTimeline,
      }),
      [handleTogglePlayback, handleResetTimeline]
    );

    // -----------------------------------------------------------------------
    // Sample Chandra canvas column RGBA & render scanline
    // -----------------------------------------------------------------------
    const sampleChandraColumn = useCallback(
      (xNorm: number, triggerSound: boolean) => {
        const canvas = chandraCanvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const w = canvas.width;
        const h = canvas.height;
        const colX = Math.max(0, Math.min(w - 1, Math.floor(xNorm * (w - 1))));
        const colData = ctx.getImageData(colX, 0, 1, h).data;

        let lumSum = 0;
        let weightedYSum = 0;
        let rSum = 0;
        let gSum = 0;
        let bSum = 0;

        for (let y = 0; y < h; y++) {
          const offset = y * 4;
          const r = colData[offset] / 255;
          const g = colData[offset + 1] / 255;
          const b = colData[offset + 2] / 255;
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          const verticalY = 1 - y / (h - 1); // Top of image = higher pitch/octave
          lumSum += lum;
          weightedYSum += lum * verticalY;
          rSum += r;
          gSum += g;
          bSum += b;
        }

        const avgBrightness = Math.min(1, (lumSum / h) * 2.8);
        const yNorm = lumSum > 0.01 ? weightedYSum / lumSum : 0.5;
        const rgbTotal = Math.max(0.001, rSum + gSum + bSum);
        const irRatio = rSum / rgbTotal;
        const opticalRatio = gSum / rgbTotal;
        const xrayRatio = bSum / rgbTotal;

        setChandraReadout({
          yNorm,
          brightness: avgBrightness,
          xrayRatio,
          opticalRatio,
          irRatio,
        });

        if (triggerSound) {
          engine.triggerChandraScanColumn({
            xNorm,
            yNorm,
            totalBrightness: avgBrightness,
            xrayRatio,
            opticalRatio,
            irRatio,
          });
        }
      },
      [engine]
    );

    // Draw Chandra base plate whenever scene changes
    useEffect(() => {
      if (activePreset !== 'chandra') return;
      const canvas = chandraCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      if (customImageLabel && chandraSourceImageRef.current) {
        ctx.fillStyle = "#03060C";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(chandraSourceImageRef.current, 0, 0, canvas.width, canvas.height);
        sampleChandraColumn(chandraXNorm, false);
        return;
      }
      let cancelled = false;
      const proxyUrl =
        chandraSceneId === "cas-a"
          ? "/api/nasa/image-proxy?nasa_id=GSFC_20171208_Archive_e002183"
          : chandraSceneId === "pillars"
          ? "/api/nasa/image-proxy?q=Pillars+of+Creation+Webb"
          : "/api/nasa/image-proxy?q=Sagittarius+A+Chandra";
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (cancelled) return;
        ctx.fillStyle = "#03060C";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        sampleChandraColumn(chandraXNorm, false);
      };
      img.src = proxyUrl;
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activePreset, chandraSceneId, customImageLabel]);

    // Chandra rAF scan loop
    useEffect(() => {
      if (!isPlaying || activePreset !== 'chandra') return;
      let rafId = 0;
      let lastTime = performance.now();
      let lastColumnPingMs = 0;

      const step = (now: number) => {
        const dt = Math.min(0.08, (now - lastTime) / 1000);
        lastTime = now;

        setChandraXNorm((prev) => {
          const next = (prev + dt * chandraSpeed) % 1;
          if (now - lastColumnPingMs >= 90) {
            lastColumnPingMs = now;
            sampleChandraColumn(next, true);
          }
          return next;
        });

        rafId = requestAnimationFrame(step);
      };

      rafId = requestAnimationFrame(step);
      return () => cancelAnimationFrame(rafId);
    }, [isPlaying, activePreset, chandraSpeed, sampleChandraColumn]);

    // Draw JWST Transmission Spectrum canvas
    useEffect(() => {
      if (activePreset !== 'jwst') return;
      const canvas = jwstCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;
      const padL = 48;
      const padR = 24;
      const padT = 34;
      const padB = 34;
      const plotW = w - padL - padR;
      const plotH = h - padT - padB;

      ctx.fillStyle = '#07090E';
      ctx.fillRect(0, 0, w, h);

      // Subtle scientific grid
      ctx.strokeStyle = 'rgba(30, 41, 59, 0.85)';
      ctx.lineWidth = 1;
      for (let gy = 0; gy <= 4; gy++) {
        const y = padT + (gy / 4) * plotH;
        ctx.beginPath();
        ctx.moveTo(padL, y);
        ctx.lineTo(padL + plotW, y);
        ctx.stroke();
      }
      for (let um = 1; um <= 5; um++) {
        const x = padL + ((um - 0.6) / 4.7) * plotW;
        ctx.beginPath();
        ctx.moveTo(x, padT);
        ctx.lineTo(x, padT + plotH);
        ctx.stroke();
        ctx.fillStyle = '#64748B';
        ctx.font = '11px monospace';
        ctx.fillText(`${um}.0 μm`, x - 18, h - 10);
      }

      // Highlight annotated molecular absorption bands
      for (const band of activeJwstTarget.bands) {
        const x1 = padL + ((band.centerUm - band.widthUm - 0.6) / 4.7) * plotW;
        const x2 = padL + ((band.centerUm + band.widthUm - 0.6) / 4.7) * plotW;
        ctx.fillStyle = `${band.color}1E`;
        ctx.fillRect(Math.max(padL, x1), padT, Math.max(8, x2 - x1), plotH);

        const cxBand = padL + ((band.centerUm - 0.6) / 4.7) * plotW;
        ctx.fillStyle = band.color;
        ctx.font = 'bold 11px monospace';
        ctx.fillText(band.molecule, cxBand - 12, padT + 16);
      }

      // Transmission spectrum curve (high transmission top, infrared absorption dip down)
      ctx.beginPath();
      const steps = 220;
      for (let i = 0; i <= steps; i++) {
        const norm = i / steps;
        const um = 0.6 + norm * 4.7;
        const pt = evaluateSpectrumAtWavelength(activeJwstTarget, um);
        const px = padL + norm * plotW;
        const py = padT + (1 - pt.fluxNorm) * plotH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = '#22D3EE';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // Subtle fill under curve
      ctx.lineTo(padL + plotW, padT + plotH);
      ctx.lineTo(padL, padT + plotH);
      ctx.closePath();
      ctx.fillStyle = 'rgba(6, 182, 212, 0.10)';
      ctx.fill();

      // Active cursor wavelength scanline
      const cursorNorm = (jwstWavelengthUm - 0.6) / 4.7;
      const cxCursor = padL + cursorNorm * plotW;
      const cyCursor = padT + (1 - jwstPoint.fluxNorm) * plotH;

      ctx.strokeStyle = jwstPoint.activeMolecule ? '#F59E0B' : '#E2E8F0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cxCursor, padT);
      ctx.lineTo(cxCursor, padT + plotH);
      ctx.stroke();

      ctx.fillStyle = jwstPoint.activeMolecule ? '#F59E0B' : '#22D3EE';
      ctx.beginPath();
      ctx.arc(cxCursor, cyCursor, 5.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#94A3B8';
      ctx.font = '10px monospace';
      ctx.fillText('Continuum', 6, padT + 8);
      ctx.fillText('Absorption', 6, padT + plotH - 4);
    }, [activePreset, activeJwstTarget, jwstWavelengthUm, jwstPoint]);

    // JWST rAF scan loop
    useEffect(() => {
      if (!isPlaying || activePreset !== 'jwst') return;
      let rafId = 0;
      let lastTime = performance.now();

      const tick = (now: number) => {
        const dt = Math.min(0.08, (now - lastTime) / 1000);
        lastTime = now;

        setJwstWavelengthUm((prev) => {
          const next = prev + dt * 0.42;
          return next > 5.3 ? 0.6 : next;
        });

        rafId = requestAnimationFrame(tick);
      };

      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }, [isPlaying, activePreset]);

    // Update JWST audio bed synchronously whenever wavelength advances during playback
    useEffect(() => {
      if (!isPlaying || activePreset !== 'jwst') return;
      engine.updateJwstSpectrum({
        wavelengthUm: jwstWavelengthUm,
        fluxNorm: jwstPoint.fluxNorm,
        dipDepth: jwstPoint.dipDepth,
        activeMolecule: jwstPoint.activeMolecule,
      });
    }, [isPlaying, activePreset, jwstWavelengthUm, jwstPoint, engine]);

    // -----------------------------------------------------------------------
    // Poll Live ISS Telemetry when ISS tab is active
    // -----------------------------------------------------------------------
    const refreshIss = useCallback(async () => {
      try {
        const data = await fetchLiveIssTelemetry();
        setIssLive(data);
        setIssError(null);
      } catch (err) {
        setIssError(err instanceof Error ? err.message : 'Unable to reach ISS tracker');
      }
    }, []);

    useEffect(() => {
      if (activePreset !== 'iss') return;
      void refreshIss();
      const timer = window.setInterval(() => {
        void refreshIss();
      }, 4000);
      return () => window.clearInterval(timer);
    }, [activePreset, refreshIss]);

    // Optional Terminator Auto-Sweep inside Preview mode
    useEffect(() => {
      if (!isPlaying || activePreset !== 'iss' || !terminatorPreviewMode || !terminatorAutoSweep) {
        return;
      }
      let rafId = 0;
      const start = performance.now();
      const sweep = (now: number) => {
        const t = (now - start) / 1000;
        const nextDaylight = 0.5 + 0.5 * Math.sin(t * 0.7);
        setTerminatorPreviewDaylight(nextDaylight);
        rafId = requestAnimationFrame(sweep);
      };
      rafId = requestAnimationFrame(sweep);
      return () => cancelAnimationFrame(rafId);
    }, [isPlaying, activePreset, terminatorPreviewMode, terminatorAutoSweep]);

    // Push ISS telemetry + terminator shift to Web Audio engine
    useEffect(() => {
      if (!isPlaying || activePreset !== 'iss' || !effectiveIss) return;
      engine.updateIssTerminator({
        daylightFactor: effectiveIss.daylightFactor,
        velocityKmh: effectiveIss.velocityKmh,
        altitudeKm: effectiveIss.altitudeKm,
        solarElevationDeg: effectiveIss.solarElevationDeg,
      });
    }, [isPlaying, activePreset, effectiveIss, engine]);

    const handleUploadChandraImage = (file: File | undefined) => {
      if (!file) return;
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        chandraSourceImageRef.current = img;
        setCustomImageLabel(file.name);
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };

    const currentChandraScene =
      CHANDRA_SCENES.find((s) => s.id === chandraSceneId) ?? CHANDRA_SCENES[0];

    return (
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        {/* Top Mission Header + Preset Switcher */}
        <div className="border border-slate-800 bg-[#0B0F19] p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-100">
              Real NASA Mission Soundscapes
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Synchronized multi-wavelength sonification presets modeled on Chandra X-Ray scans, JWST exoplanet spectra, and live ISS orbital crossings.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void handleTogglePlayback()}
              className={`inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                isPlaying
                  ? 'bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'bg-cyan-500 text-slate-950 hover:bg-cyan-400'
              }`}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              {isPlaying ? 'Pause Soundscape' : 'Play Soundscape'}
            </button>

            <button
              type="button"
              onClick={handleResetTimeline}
              aria-label="Reset mission scan timeline"
              className="p-2 border border-slate-700 bg-[#07090E] text-slate-300 hover:text-white hover:border-slate-500 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={onToggleMute}
              aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
              className={`p-2 border cursor-pointer ${
                isMuted
                  ? 'border-amber-500/60 text-amber-400 bg-amber-500/10'
                  : 'border-slate-700 bg-[#07090E] text-slate-300 hover:text-white'
              }`}
            >
              {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>

            <input
              type="range"
              aria-label="Missions master volume"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              className="w-24"
            />
          </div>
        </div>

        {/* Mission Selector Strip */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <button
            type="button"
            onClick={() => handleSwitchPreset('chandra')}
            className={`text-left p-4 border transition-colors cursor-pointer ${
              activePreset === 'chandra'
                ? 'border-cyan-500 bg-[#0F172A]'
                : 'border-slate-800 bg-[#0B0F19] hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Sparkles className="w-4 h-4" />
              Chandra Deep Space Scan
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Left-to-right image sonification: brightness → amplitude, hue → instrument, Y → octave.
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchPreset('jwst')}
            className={`text-left p-4 border transition-colors cursor-pointer ${
              activePreset === 'jwst'
                ? 'border-cyan-500 bg-[#0F172A]'
                : 'border-slate-800 bg-[#0B0F19] hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Activity className="w-4 h-4" />
              JWST Exoplanet Spectra
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Transmission wavelength sweep mapping H₂O, SO₂, CH₄ & CO₂ dips to harmonic dropouts.
            </div>
          </button>

          <button
            type="button"
            onClick={() => handleSwitchPreset('iss')}
            className={`text-left p-4 border transition-colors cursor-pointer ${
              activePreset === 'iss'
                ? 'border-cyan-500 bg-[#0F172A]'
                : 'border-slate-800 bg-[#0B0F19] hover:border-slate-700'
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <Satellite className="w-4 h-4" />
              ISS Live Orbit Tracker
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Real-time ISS projection onto the 3D Globe with pitch shifting over day/night terminators.
            </div>
          </button>
        </div>

        {/* =================================================================== */}
        {/* PRESET 1: CHANDRA DEEP SPACE LEFT-TO-RIGHT SCAN                     */}
        {/* =================================================================== */}
        {activePreset === 'chandra' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 space-y-4">
              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-200">
                  Deep Space Target Plate
                </div>
                <div className="space-y-2">
                  {CHANDRA_SCENES.map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => {
                        setCustomImageLabel(null);
                        setChandraSceneId(sc.id);
                      }}
                      className={`w-full text-left p-3 border transition-colors cursor-pointer ${
                        !customImageLabel && chandraSceneId === sc.id
                          ? 'border-cyan-500 bg-[#111827]'
                          : 'border-slate-800 bg-[#07090E] hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-medium text-slate-100">{sc.title}</div>
                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">
                        {sc.target} · {sc.distance}
                      </div>
                    </button>
                  ))}
                </div>

                <label className="block pt-2 border-t border-slate-800">
                  <span className="inline-flex items-center gap-2 px-3 py-2 text-xs font-mono border border-slate-700 bg-[#07090E] text-slate-200 hover:border-cyan-400 cursor-pointer w-full justify-center">
                    <Upload className="w-3.5 h-3.5 text-cyan-400" />
                    {customImageLabel ? `Loaded: ${customImageLabel}` : 'Scan Custom Astronomy Image'}
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleUploadChandraImage(e.target.files?.[0])}
                  />
                </label>
              </div>

              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-200">
                  Wavelength → Instrument Mix
                </div>
                <div className="space-y-2 text-[11px] font-mono tabular-nums">
                  <div>
                    <div className="flex justify-between text-cyan-300">
                      <span>X-Ray (Cyan Sine Bells)</span>
                      <span>{Math.round(chandraReadout.xrayRatio * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-[#07090E] border border-slate-800 mt-1">
                      <div
                        className="h-full bg-cyan-400"
                        style={{ width: `${Math.round(chandraReadout.xrayRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-amber-300">
                      <span>Optical (Gold Triangle Strings)</span>
                      <span>{Math.round(chandraReadout.opticalRatio * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-[#07090E] border border-slate-800 mt-1">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${Math.round(chandraReadout.opticalRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-rose-300">
                      <span>Infrared (Red Sub-Octave Warmth)</span>
                      <span>{Math.round(chandraReadout.irRatio * 100)}%</span>
                    </div>
                    <div className="h-1.5 bg-[#07090E] border border-slate-800 mt-1">
                      <div
                        className="h-full bg-rose-400"
                        style={{ width: `${Math.round(chandraReadout.irRatio * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-800">
                  <div className="flex justify-between text-[11px] font-mono text-slate-400 mb-1 tabular-nums">
                    <span>Scan Speed</span>
                    <span className="text-slate-200">{chandraSpeed.toFixed(2)} pass/s</span>
                  </div>
                  <input
                    type="range"
                    min={0.06}
                    max={0.35}
                    step={0.02}
                    value={chandraSpeed}
                    onChange={(e) => setChandraSpeed(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-8 border border-slate-800 bg-[#0B0F19] p-4 flex flex-col gap-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-100">
                    {customImageLabel ?? currentChandraScene.title}
                  </span>
                  <span className="ml-2 font-mono text-[11px] text-cyan-400">
                    {currentChandraScene.observatories}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-slate-400 tabular-nums">
                  X: {Math.round(chandraXNorm * 100)}% · Centroid Y:{' '}
                  {Math.round(chandraReadout.yNorm * 100)}%
                </span>
              </div>

              <div
                className="relative border border-slate-800 bg-[#03060C] overflow-hidden cursor-crosshair"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  setChandraXNorm(norm);
                  sampleChandraColumn(norm, true);
                }}
              >
                <canvas
                  ref={chandraCanvasRef}
                  width={760}
                  height={400}
                  className="w-full h-[340px] sm:h-[400px] block object-cover"
                />
                {/* Active vertical left-to-right scanline */}
                <div
                  className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.9)]"
                  style={{ left: `${chandraXNorm * 100}%` }}
                />
                {/* Energy Centroid Y Octave Marker */}
                <div
                  className="pointer-events-none absolute w-3 h-3 -ml-1.5 -mt-1.5 border border-amber-300 bg-amber-400/30"
                  style={{
                    left: `${chandraXNorm * 100}%`,
                    top: `${(1 - chandraReadout.yNorm) * 100}%`,
                  }}
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
                <p className="max-w-2xl leading-relaxed">
                  {currentChandraScene.description}
                </p>
                <span className="font-mono text-[11px] text-amber-300 whitespace-nowrap">
                  Click anywhere on plate to audition column
                </span>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* PRESET 2: JWST EXOPLANET TRANSMISSION SPECTRA                       */}
        {/* =================================================================== */}
        {activePreset === 'jwst' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 space-y-4">
              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-2.5">
                <div className="text-xs font-semibold text-slate-200">
                  Exoplanet Spectroscopy Target
                </div>
                {JWST_TARGETS.map((target) => (
                  <button
                    key={target.id}
                    type="button"
                    onClick={() => {
                      setJwstTargetId(target.id);
                      setJwstWavelengthUm(0.6);
                    }}
                    className={`w-full text-left p-3 border transition-colors cursor-pointer ${
                      jwstTargetId === target.id
                        ? 'border-cyan-500 bg-[#111827]'
                        : 'border-slate-800 bg-[#07090E] hover:border-slate-700'
                    }`}
                  >
                    <div className="text-xs font-medium text-slate-100">{target.title}</div>
                    <div className="font-mono text-[10px] text-amber-300 mt-0.5">
                      {target.instrument}
                    </div>
                  </button>
                ))}
              </div>

              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-3 text-xs">
                <div className="font-semibold text-slate-200">
                  Live Atmospheric Readout
                </div>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-slate-500 text-[10px]">Wavelength</div>
                    <div className="text-cyan-300 text-sm font-semibold mt-0.5">
                      {jwstWavelengthUm.toFixed(2)} μm
                    </div>
                  </div>
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-slate-500 text-[10px]">Harmonic Dropout</div>
                    <div className="text-amber-300 text-sm font-semibold mt-0.5">
                      {Math.round(jwstPoint.dipDepth * 100)}%
                    </div>
                  </div>
                </div>
                <div className="border border-slate-800 bg-[#07090E] p-3 font-mono text-[11px]">
                  <span className="text-slate-400">Active Absorption Band: </span>
                  <span className={jwstPoint.activeMolecule ? 'text-amber-300 font-semibold' : 'text-cyan-300'}>
                    {jwstPoint.activeMolecule ?? 'Clear Continuum Starlight'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {activeJwstTarget.summary}
                </p>
              </div>
            </div>

            <div className="lg:col-span-8 border border-slate-800 bg-[#0B0F19] p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div>
                  <span className="font-semibold text-slate-100">{activeJwstTarget.title}</span>
                  <span className="ml-2 font-mono text-[11px] text-slate-400">
                    {activeJwstTarget.planetClass}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-cyan-300 tabular-nums">
                  Transit Flux: {(jwstPoint.fluxNorm * 100).toFixed(1)}%
                </span>
              </div>

              <div
                className="border border-slate-800 bg-[#07090E] cursor-crosshair"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const padRatioL = 48 / 760;
                  const padRatioR = 24 / 760;
                  const raw = (e.clientX - rect.left) / rect.width;
                  const plotNorm = Math.max(
                    0,
                    Math.min(1, (raw - padRatioL) / (1 - padRatioL - padRatioR))
                  );
                  setJwstWavelengthUm(0.6 + plotNorm * 4.7);
                }}
              >
                <canvas
                  ref={jwstCanvasRef}
                  width={760}
                  height={370}
                  className="w-full h-[330px] sm:h-[370px] block"
                />
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
                  0.6 μm
                </span>
                <input
                  type="range"
                  aria-label="JWST wavelength scrubber"
                  min={0.6}
                  max={5.3}
                  step={0.02}
                  value={jwstWavelengthUm}
                  onChange={(e) => setJwstWavelengthUm(Number(e.target.value))}
                  className="flex-1"
                />
                <span className="font-mono text-[11px] text-slate-400 whitespace-nowrap">
                  5.3 μm
                </span>
              </div>
            </div>
          </div>
        )}

        {/* =================================================================== */}
        {/* PRESET 3: ISS LIVE ORBIT TRACKER + TERMINATOR PITCH SHIFTING        */}
        {/* =================================================================== */}
        {activePreset === 'iss' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div className="lg:col-span-4 space-y-4">
              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-200">
                    ISS (ZARYA · NORAD 25544)
                  </span>
                  <button
                    type="button"
                    onClick={() => void refreshIss()}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-mono border border-slate-700 bg-[#07090E] text-cyan-300 hover:border-cyan-400 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Sync
                  </button>
                </div>

                {issError && (
                  <div className="p-2 border border-amber-500/40 bg-amber-950/30 text-[11px] text-amber-200">
                    {issError}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 font-mono text-[11px] tabular-nums">
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-[10px] text-slate-500">Latitude</div>
                    <div className="text-slate-100 mt-0.5">
                      {effectiveIss ? `${effectiveIss.latitude.toFixed(3)}°` : '—'}
                    </div>
                  </div>
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-[10px] text-slate-500">Longitude</div>
                    <div className="text-slate-100 mt-0.5">
                      {effectiveIss ? `${effectiveIss.longitude.toFixed(3)}°` : '—'}
                    </div>
                  </div>
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-[10px] text-slate-500">Altitude</div>
                    <div className="text-cyan-300 mt-0.5">
                      {effectiveIss ? `${effectiveIss.altitudeKm.toFixed(1)} km` : '—'}
                    </div>
                  </div>
                  <div className="border border-slate-800 bg-[#07090E] p-2.5">
                    <div className="text-[10px] text-slate-500">Orbital Velocity</div>
                    <div className="text-cyan-300 mt-0.5">
                      {effectiveIss ? `${Math.round(effectiveIss.velocityKmh).toLocaleString()} km/h` : '—'}
                    </div>
                  </div>
                </div>

                <div className="border border-slate-800 bg-[#07090E] p-3 font-mono text-[11px] space-y-1 tabular-nums">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Orbital Phase</span>
                    <span
                      className={
                        effectiveIss?.visibility === 'daylight'
                          ? 'text-amber-300 font-semibold'
                          : 'text-sky-300 font-semibold'
                      }
                    >
                      {effectiveIss ? effectiveIss.visibility.toUpperCase() : 'SYNCING'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Solar Elevation</span>
                    <span className="text-slate-200">
                      {effectiveIss ? `${effectiveIss.solarElevationDeg.toFixed(1)}°` : '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Feed Source</span>
                    <span className="text-emerald-300">
                      {effectiveIss?.source === 'wheretheiss-live'
                        ? 'wheretheiss.at live'
                        : 'Keplerian orbital propagate'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Day / Night Terminator Pitch-Shift Audition Control */}
              <div className="border border-slate-800 bg-[#0B0F19] p-4 space-y-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">
                    Terminator Pitch Shift Test
                  </span>
                  <button
                    type="button"
                    onClick={() => setTerminatorPreviewMode((v) => !v)}
                    className={`px-2.5 py-1 text-[10px] font-mono border cursor-pointer ${
                      terminatorPreviewMode
                        ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                        : 'border-slate-700 bg-[#07090E] text-slate-300'
                    }`}
                  >
                    {terminatorPreviewMode ? 'Preview Sweep Active' : 'Using Live Orbit'}
                  </button>
                </div>

                <p className="text-[11px] text-slate-400 leading-relaxed">
                  Since an orbital sunset happens once every ~45 minutes, toggle Preview Sweep to hear the ISS telemetry shift smoothly across Earth&apos;s day/night terminator right away.
                </p>

                {terminatorPreviewMode && (
                  <div className="space-y-2.5 pt-1">
                    <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
                      <span>Auto-sweep orbital terminator</span>
                      <input
                        type="checkbox"
                        checked={terminatorAutoSweep}
                        onChange={(e) => setTerminatorAutoSweep(e.target.checked)}
                        className="accent-amber-400"
                      />
                    </label>

                    <div>
                      <div className="flex justify-between font-mono text-[10px] text-slate-400 mb-1 tabular-nums">
                        <span>Eclipse (0%)</span>
                        <span className="text-amber-300">
                          {Math.round(terminatorPreviewDaylight * 100)}% Sunlight
                        </span>
                        <span>Daylight (100%)</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={terminatorPreviewDaylight}
                        onChange={(e) => {
                          setTerminatorAutoSweep(false);
                          setTerminatorPreviewDaylight(Number(e.target.value));
                        }}
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="lg:col-span-8 border border-slate-800 bg-[#07090E] min-h-[460px] flex flex-col">
              <Globe3DView
                normalizedIntensity={effectiveIss ? effectiveIss.daylightFactor * 0.7 + 0.2 : 0.45}
                cloudCoverNormalized={0.35}
                isPlaying={isPlaying}
                issTelemetry={effectiveIss}
                getSpectrumBins={() => (isPlaying ? engine.getSpectrumBins() : null)}
                label={
                  effectiveIss
                    ? `ISS ${effectiveIss.latitude.toFixed(2)}°, ${effectiveIss.longitude.toFixed(2)}°`
                    : 'ISS Live Orbit'
                }
                sublabel={
                  effectiveIss
                    ? `${effectiveIss.visibility.toUpperCase()} · ${Math.round(effectiveIss.velocityKmh).toLocaleString()} km/h`
                    : 'Fetching orbital state...'
                }
                className="flex-1 min-h-[460px]"
              />
            </div>
          </div>
        )}
      </div>
    );
  }
);
