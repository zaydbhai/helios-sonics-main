import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { NormalizedRoiBox } from '../types/earthNow';
import type { IssTelemetryResponse } from '../types/nasa';

interface Globe3DViewProps {
  mapImageUrl?: string;
  normalizedIntensity: number;
  cloudCoverNormalized: number;
  isPlaying: boolean;
  reduceMotion?: boolean;
  roiBox?: NormalizedRoiBox | null;
  issTelemetry?: IssTelemetryResponse | null;
  getSpectrumBins?: () => Float32Array | Uint8Array | null;
  accentColor?: string;
  label?: string;
  sublabel?: string;
  className?: string;
}

function latLonToVector3(latDeg: number, lonDeg: number, radius: number): THREE.Vector3 {
  const phi = (90 - latDeg) * (Math.PI / 180);
  const theta = (lonDeg + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function detectSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const rendererStr = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software|Mesa/i.test(rendererStr);
  } catch {
    return false;
  }
}

function paintProceduralPlanetTexture(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accentHex: string
): void {
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#0F1F3A');
  grad.addColorStop(0.25, '#092442');
  grad.addColorStop(0.5, '#073554');
  grad.addColorStop(0.75, '#092442');
  grad.addColorStop(1, '#10243E');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Subtle continental & band telemetry pattern
  ctx.fillStyle = accentHex;
  ctx.globalAlpha = 0.14;
  for (let i = 0; i < 18; i++) {
    const cx = ((i * 137) % w);
    const cy = h * 0.2 + ((i * 79) % (h * 0.6));
    const rx = 24 + (i % 5) * 18;
    const ry = 14 + (i % 4) * 10;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, (i * 0.4) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Lat/Lon Graticule
  ctx.strokeStyle = 'rgba(103, 232, 249, 0.22)';
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += w / 12) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += h / 6) {
    ctx.beginPath();
    ctx.moveTo(0, gy);
    ctx.lineTo(w, gy);
    ctx.stroke();
  }
}

export function Globe3DView({
  mapImageUrl,
  normalizedIntensity,
  cloudCoverNormalized,
  isPlaying,
  reduceMotion = false,
  roiBox = null,
  issTelemetry = null,
  getSpectrumBins,
  accentColor = '#06B6D4',
  label,
  sublabel,
  className = '',
}: Globe3DViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  // Mutable live refs read inside the rAF loop without recreating the WebGL context
  const liveStateRef = useRef({
    normalizedIntensity,
    cloudCoverNormalized,
    isPlaying,
    reduceMotion,
    roiBox,
    issTelemetry,
    accentColor,
    getSpectrumBins,
  });

  liveStateRef.current = {
    normalizedIntensity,
    cloudCoverNormalized,
    isPlaying,
    reduceMotion,
    roiBox,
    issTelemetry,
    accentColor,
    getSpectrumBins,
  };

  const textureUpdaterRef = useRef<((url: string) => void) | null>(null);

  useEffect(() => {
    if (mapImageUrl && textureUpdaterRef.current) {
      textureUpdaterRef.current(mapImageUrl);
    }
  }, [mapImageUrl]);

  useEffect(() => {
    const container = hostRef.current;
    if (!container) return;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(260, container.clientHeight);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
      alpha: false,
      preserveDrawingBuffer: true,
    });

    const isSoftwareGl = detectSoftwareGl(renderer.getContext());
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#07090E');

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0, 2.2, 6.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minDistance = 3.6;
    controls.maxDistance = 10.5;
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;

    // Realistic reflections for metallic satellite and gimbal assemblies
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();

    // Solar key & cool earthshine fill lights
    const ambientLight = new THREE.AmbientLight('#1E293B', 0.85);
    scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight('#FFF5E0', 2.4);
    sunLight.position.set(6, 3.5, 5);
    scene.add(sunLight);

    const rimLight = new THREE.DirectionalLight('#38BDF8', 0.9);
    rimLight.position.set(-5, -2, -4);
    scene.add(rimLight);

    // Subtle procedural starfield (using simple points, zero external textures)
    const starCount = isSoftwareGl ? 240 : 600;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 18 + (i % 15) * 1.1;
      const theta = ((i * 137.5) % 360) * (Math.PI / 180);
      const phi = Math.acos(1 - (2 * (i + 0.5)) / starCount);
      starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.cos(phi);
      starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: '#94A3B8',
      size: 0.08,
      transparent: true,
      opacity: 0.65,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // Root Globe Assembly
    const globeGroup = new THREE.Group();
    scene.add(globeGroup);

    // Offscreen CanvasTexture for Earth surface (updated cleanly from frame URLs or procedural fallback)
    const texCanvas = document.createElement('canvas');
    const maxTex = renderer.capabilities.maxTextureSize || 2048;
    const texW = isSoftwareGl ? 1024 : maxTex >= 4096 ? 4096 : 2048;
    texCanvas.width = texW;
    texCanvas.height = texW / 2;
    const texCtx = texCanvas.getContext('2d');
    if (texCtx) {
      texCtx.fillStyle = "#07090E"; texCtx.fillRect(0, 0, texCanvas.width, texCanvas.height);
    }
    const earthTexture = new THREE.CanvasTexture(texCanvas);
    earthTexture.colorSpace = THREE.SRGBColorSpace;
    earthTexture.anisotropy = isSoftwareGl ? 1 : Math.min(16, renderer.capabilities.getMaxAnisotropy());

    const earthGeo = new THREE.SphereGeometry(2.0, 96, 64);
    const earthMat = new THREE.MeshStandardMaterial({
      map: earthTexture,
      roughness: 0.72,
      metalness: 0.08,
      emissive: new THREE.Color('#041624'),
      emissiveIntensity: 0.25,
    });
    const earthMesh = new THREE.Mesh(earthGeo, earthMat);
    globeGroup.add(earthMesh);

    // Atmospheric Cloud / Telemetry Shell (depthWrite: false to avoid sorting artifacts)
    const atmoGeo = new THREE.SphereGeometry(2.055, 48, 32);
    const atmoMat = new THREE.MeshStandardMaterial({
      color: '#38BDF8',
      transparent: true,
      opacity: 0.16,
      roughness: 0.9,
      metalness: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
    globeGroup.add(atmoMesh);

    // ROI Latitude/Longitude Band Highlight Overlay
    const roiOverlayGeo = new THREE.SphereGeometry(2.03, 36, 24);
    const roiOverlayMat = new THREE.MeshBasicMaterial({
      color: '#F59E0B',
      wireframe: true,
      transparent: true,
      opacity: 0.0,
    });
    const roiOverlayMesh = new THREE.Mesh(roiOverlayGeo, roiOverlayMat);
    globeGroup.add(roiOverlayMesh);

    // Live ISS Beacon & Ground Track Overlay attached to Earth surface frame
    const issMarkerGroup = new THREE.Group();
    issMarkerGroup.visible = false;
    globeGroup.add(issMarkerGroup);

    const issBeaconGeo = new THREE.SphereGeometry(0.065, 16, 16);
    const issBeaconMat = new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      emissive: '#F59E0B',
      emissiveIntensity: 1.4,
      roughness: 0.2,
    });
    const issBeaconMesh = new THREE.Mesh(issBeaconGeo, issBeaconMat);
    issMarkerGroup.add(issBeaconMesh);

    const issFootprintGeo = new THREE.RingGeometry(0.11, 0.14, 32);
    const issFootprintMat = new THREE.MeshBasicMaterial({
      color: '#22D3EE',
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.75,
    });
    const issFootprintMesh = new THREE.Mesh(issFootprintGeo, issFootprintMat);
    issMarkerGroup.add(issFootprintMesh);

    const issTrackGeo = new THREE.BufferGeometry();
    const issTrackMat = new THREE.LineBasicMaterial({
      color: '#38BDF8',
      transparent: true,
      opacity: 0.82,
    });
    const issTrackLine = new THREE.Line(issTrackGeo, issTrackMat);
    issTrackLine.visible = false;
    globeGroup.add(issTrackLine);

    // Precision Equatorial & Polar Orbital Gimbal Rings
    const eqRingGeo = new THREE.TorusGeometry(2.48, 0.012, 12, 96);
    const eqRingMat = new THREE.MeshStandardMaterial({
      color: '#06B6D4',
      roughness: 0.35,
      metalness: 0.78,
      emissive: '#083344',
      emissiveIntensity: 0.4,
    });
    const eqRing = new THREE.Mesh(eqRingGeo, eqRingMat);
    eqRing.rotation.x = Math.PI / 2;
    scene.add(eqRing);

    const polarRingGeo = new THREE.TorusGeometry(2.68, 0.009, 12, 96);
    const polarRingMat = new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      roughness: 0.38,
      metalness: 0.82,
    });
    const polarRing = new THREE.Mesh(polarRingGeo, polarRingMat);
    polarRing.rotation.y = Math.PI / 5;
    polarRing.rotation.x = Math.PI / 12;
    scene.add(polarRing);

    // 64 Audio-Reactive Equatorial Spectrum Bars
    const specBarCount = 64;
    const specGroup = new THREE.Group();
    scene.add(specGroup);
    const specBarGeo = new THREE.BoxGeometry(0.032, 0.25, 0.032);
    specBarGeo.translate(0, 0.125, 0);
    const specBarMat = new THREE.MeshStandardMaterial({
      color: '#22D3EE',
      emissive: '#06B6D4',
      emissiveIntensity: 0.75,
      roughness: 0.3,
      metalness: 0.5,
    });
    const specInstanced = new THREE.InstancedMesh(specBarGeo, specBarMat, specBarCount);
    specGroup.add(specInstanced);

    // Composite 6-Part Earth Observation Satellite Group
    const satOrbitPivot = new THREE.Group();
    satOrbitPivot.rotation.z = 0.42;
    scene.add(satOrbitPivot);

    const satelliteGroup = new THREE.Group();
    satelliteGroup.position.set(2.68, 0, 0);
    satOrbitPivot.add(satelliteGroup);

    const foilMat = new THREE.MeshStandardMaterial({
      color: '#F59E0B',
      roughness: 0.28,
      metalness: 0.88,
    });
    const titaniumMat = new THREE.MeshStandardMaterial({
      color: '#CBD5E1',
      roughness: 0.35,
      metalness: 0.85,
    });
    const solarMat = new THREE.MeshStandardMaterial({
      color: '#1D4ED8',
      emissive: '#0F172A',
      roughness: 0.22,
      metalness: 0.65,
    });

    // Part 1: Spacecraft main hexagonal/octagonal bus
    const busGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8);
    const busMesh = new THREE.Mesh(busGeo, foilMat);
    satelliteGroup.add(busMesh);

    // Part 2: Nadir radiometer optical barrel pointing inward toward globe center
    const barrelGeo = new THREE.CylinderGeometry(0.035, 0.045, 0.11, 12);
    const barrelMesh = new THREE.Mesh(barrelGeo, titaniumMat);
    barrelMesh.rotation.z = Math.PI / 2;
    barrelMesh.position.set(-0.09, 0, 0);
    satelliteGroup.add(barrelMesh);

    // Part 3: Solar array central boom truss
    const boomGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.86, 8);
    const boomMesh = new THREE.Mesh(boomGeo, titaniumMat);
    satelliteGroup.add(boomMesh);

    // Part 4 & 5: Upper and lower photovoltaic solar wings
    const wingGeo = new THREE.BoxGeometry(0.014, 0.3, 0.13);
    const upperWing = new THREE.Mesh(wingGeo, solarMat);
    upperWing.position.set(0, 0.27, 0);
    satelliteGroup.add(upperWing);

    const lowerWing = new THREE.Mesh(wingGeo, solarMat);
    lowerWing.position.set(0, -0.27, 0);
    satelliteGroup.add(lowerWing);

    // Part 6: High-gain communications dish
    const dishGeo = new THREE.ConeGeometry(0.075, 0.04, 16, 1, true);
    const dishMesh = new THREE.Mesh(dishGeo, titaniumMat);
    dishMesh.rotation.z = -Math.PI / 2;
    dishMesh.position.set(0.09, 0.03, 0);
    satelliteGroup.add(dishMesh);

    // Image loader for updating Earth texture cleanly when mapImageUrl changes
    let activeImgRequest = 0;
    const drawImageToEarthTexture = (url: string) => {
      const reqId = ++activeImgRequest;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (reqId !== activeImgRequest || !texCtx) return;
        texCtx.imageSmoothingEnabled = true;
        texCtx.imageSmoothingQuality = 'high';
        texCtx.drawImage(img, 0, 0, texCanvas.width, texCanvas.height);
        earthTexture.needsUpdate = true;
      };
      img.src = url;
    };
    textureUpdaterRef.current = drawImageToEarthTexture;
    drawImageToEarthTexture(mapImageUrl || "/api/nasa/gibs/image?layer=MODIS_Terra_CorrectedReflectance_TrueColor");

    // ResizeObserver for crisp responsive viewport updates
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width));
        const h = Math.max(260, Math.floor(entry.contentRect.height));
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      }
    });
    resizeObserver.observe(container);

    // Pre-allocated scratch math objects (zero allocations inside rAF)
    const scratchDummy = new THREE.Object3D();
    const scratchColor = new THREE.Color();
    let rafId = 0;
    let lastTime = performance.now();
    let lastDrawTime = 0;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);

      // Gentle frame pacing for software GL contexts
      if (isSoftwareGl && now - lastDrawTime < 33) {
        return;
      }
      lastDrawTime = now;

      const dt = Math.min(0.1, (now - lastTime) / 1000);
      lastTime = now;

      const state = liveStateRef.current;

      if (!state.reduceMotion && !document.documentElement.classList.contains("a11y-reduce-motion")) {
        const spinSpeed = state.isPlaying ? 0.16 : 0.045;
        globeGroup.rotation.y += dt * spinSpeed;
        satOrbitPivot.rotation.y += dt * (state.isPlaying ? 0.48 : 0.14);
        stars.rotation.y += dt * 0.008;
      }

      // Reactive material intensity from telemetry / image brightness
      const intensity = Math.max(0, Math.min(1, state.normalizedIntensity));
      const cloudNorm = Math.max(0, Math.min(1, state.cloudCoverNormalized));
      earthMat.emissiveIntensity = 0.15 + intensity * 0.35;
      atmoMat.opacity = 0.08 + cloudNorm * 0.24;

      if (state.roiBox && state.roiBox.id !== 'global') {
        roiOverlayMat.opacity = 0.24 + intensity * 0.18;
        const centerLatNorm = 0.5 - (state.roiBox.y + state.roiBox.h * 0.5);
        roiOverlayMesh.position.y = centerLatNorm * 0.35;
        roiOverlayMesh.scale.set(1.01, Math.max(0.28, state.roiBox.h * 1.15), 1.01);
      } else {
        roiOverlayMat.opacity = 0;
      }

      if (state.issTelemetry) {
        const iss = state.issTelemetry;
        issMarkerGroup.visible = true;
        const pos = latLonToVector3(iss.latitude, iss.longitude, 2.18);
        issBeaconMesh.position.copy(pos);

        const surfacePos = latLonToVector3(iss.latitude, iss.longitude, 2.04);
        issFootprintMesh.position.copy(surfacePos);
        issFootprintMesh.lookAt(surfacePos.clone().multiplyScalar(2));

        const isDay = iss.visibility === 'daylight';
        issBeaconMat.color.set(isDay ? '#F59E0B' : '#38BDF8');
        issBeaconMat.emissive.set(isDay ? '#F59E0B' : '#0284C7');
        issFootprintMat.color.set(isDay ? '#FBBF24' : '#38BDF8');

        if (iss.track.length >= 2) {
          const pts = iss.track.map((pt) => latLonToVector3(pt.latitude, pt.longitude, 2.14));
          issTrackGeo.setFromPoints(pts);
          issTrackLine.visible = true;
          issTrackMat.color.set(isDay ? '#F59E0B' : '#38BDF8');
        }
      } else {
        issMarkerGroup.visible = false;
        issTrackLine.visible = false;
      }

      // Update 64 equatorial audio spectrum bars
      const bins = state.getSpectrumBins ? state.getSpectrumBins() : null;
      const eqRadius = 2.48;
      for (let i = 0; i < specBarCount; i++) {
        const angle = (i / specBarCount) * Math.PI * 2;
        let energy = intensity * 0.35;
        if (bins && bins.length > 0) {
          const binIdx = Math.min(bins.length - 1, Math.floor((i / specBarCount) * bins.length * 0.7));
          const raw = bins[binIdx];
          // Support both Float32Array (dB -100..0 from Tone.Analyser) and Uint8Array (0..255 from WebAudio)
          energy =
            bins instanceof Float32Array
              ? Math.max(0.05, Math.min(1, (raw + 96) / 72))
              : Math.max(0.05, Math.min(1, raw / 255));
        } else if (state.isPlaying) {
          energy = 0.15 + 0.55 * Math.abs(Math.sin(now * 0.004 + i * 0.35)) * (0.4 + intensity * 0.6);
        }

        const scaleY = 0.18 + energy * 1.65;
        scratchDummy.position.set(
          Math.cos(angle) * eqRadius,
          0,
          Math.sin(angle) * eqRadius
        );
        scratchDummy.rotation.set(0, -angle, -Math.PI / 2);
        scratchDummy.scale.set(1, scaleY, 1);
        scratchDummy.updateMatrix();
        specInstanced.setMatrixAt(i, scratchDummy.matrix);

        scratchColor.setHSL(0.52 - energy * 0.42, 0.9, 0.48 + energy * 0.22);
        specInstanced.setColorAt(i, scratchColor);
      }
      specInstanced.instanceMatrix.needsUpdate = true;
      if (specInstanced.instanceColor) {
        specInstanced.instanceColor.needsUpdate = true;
      }

      if (controls.enableDamping) {
        controls.update();
      }

      renderer.render(scene, camera);
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      controls.dispose();

      // Dispose all GPU geometries, materials & textures
      earthGeo.dispose();
      earthMat.dispose();
      earthTexture.dispose();
      atmoGeo.dispose();
      atmoMat.dispose();
      roiOverlayGeo.dispose();
      roiOverlayMat.dispose();
      eqRingGeo.dispose();
      eqRingMat.dispose();
      polarRingGeo.dispose();
      polarRingMat.dispose();
      issBeaconGeo.dispose();
      issBeaconMat.dispose();
      issFootprintGeo.dispose();
      issFootprintMat.dispose();
      issTrackGeo.dispose();
      issTrackMat.dispose();
      specBarGeo.dispose();
      specBarMat.dispose();
      busGeo.dispose();
      barrelGeo.dispose();
      boomGeo.dispose();
      wingGeo.dispose();
      dishGeo.dispose();
      foilMat.dispose();
      titaniumMat.dispose();
      solarMat.dispose();
      starGeo.dispose();
      starMat.dispose();

      envTarget.dispose();
      pmremGenerator.dispose();
      renderer.dispose();

      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      textureUpdaterRef.current = null;
    };
  }, []);

  return (
    <div
      ref={hostRef}
      className={`relative w-full h-full min-h-[320px] bg-[#07090E] overflow-hidden ${className}`}
    >
      {(label || sublabel) && (
        <div className="pointer-events-none absolute top-3 left-3 bg-[#0B0F19]/90 border border-slate-800 px-3 py-1.5 font-mono text-[11px] text-slate-200">
          {label && <span className="font-semibold text-cyan-300">{label}</span>}
          {sublabel && <span className="ml-2 text-slate-400">{sublabel}</span>}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 left-3 bg-[#0B0F19]/90 border border-slate-800 px-2.5 py-1 font-mono text-[10px] text-slate-400">
        Drag to orbit · Scroll to zoom
      </div>
    </div>
  );
}
