# Helios Sonics

**Helios Sonics** is an interactive NASA telemetry sonification and audio visualization web application. It transforms space and Earth observation datasets into real-time synthesized sound, 60fps spectral visualizations, and an interactive Three.js 3D orbital globe, paired with a separate Express REST backend connected to live NASA Open APIs (DONKI Space Weather & GIBS Worldview satellite imagery).

---

## Features

### 1. Observatory (Web Audio API + HTML5 Canvas + Three.js 3D)
- **Telemetry-Driven Synthesizer (`src/audio/SonificationEngine.ts`)**: Converts normalized NASA telemetry channels into real-time polyphonic FM/harmonic audio (`OscillatorNode`, resonant `BiquadFilterNode`, `StereoPannerNode`, `AnalyserNode`).
- **Multiple Signal Inputs**: Switch between the NASA telemetry synthesizer, local audio file uploads (`.mp3`, `.wav`, `.ogg`, `.flac`), or live microphone input.
- **Four Visualization Modes (`src/components/VisualizationStage.tsx` & `src/components/Globe3DView.tsx`)**:
  - **Orbital**: Polar FFT frequency ring with harmonic dB calibration rings, peak-hold markers, and overlaid dataset orbit curves.
  - **Waterfall**: Scrolling time-frequency spectrogram with a calibrated scientific color ramp and cursor frequency/dB probe.
  - **Scope**: Dual-trace time-domain oscilloscope paired with an X-Y quadrature phase Lissajous figure.
  - **Globe 3D (Three.js)**: Interactive WebGL planetary sphere with an orbiting 6-part observation satellite assembly and 64 equatorial audio-reactive FFT spectrum bars.
- **Live NASA DONKI Ingestion**: Fetch 30-day real-time Solar Flares (`FLR`) and Geomagnetic Storms (`GST`) directly from NASA DONKI (`+ Live DONKI Flares` / `+ Live DONKI Storms`) and sonify them immediately.
- **Synchronized Telemetry Tray (`src/components/TelemetryTray.tsx`)**: Interactive click-to-seek dual-channel SVG envelope with live peak frequency, spectral centroid, RMS dBFS, and physical unit readouts.
- **Snapshot Export**: Export any active 2D or 3D canvas frame as a PNG image.

### 2. Earth Now (NASA SVS Jukebox + Tone.js Frame Player + 3D Globe)
- Built from real **NASA Scientific Visualization Studio (SVS) Earth Now Dashboard** datasets (`GEOS-FP Near-Surface Temperature` `#5147`, `Near-Surface Wind Speed` `#5148`, and `Precipitation & Clouds` `#5149`).
- **Frame Extraction Pipeline (`scripts/extract_earth_now.py`)**: Extracts 36 JPEG frames per track with `ffmpeg` into `public/earth-now/` and measures per-frame average image brightness and bright highlight/cloud cover into `public/earth-now/track.json`.
- **2D Map & 3D Globe Views**: Toggle between the flat equirectangular SVS map frames and an interactive Three.js **3D Globe** wrapping the live frame textures and ROI highlights.
- **Region-of-Interest (ROI) / Latitudinal Band Listening (`src/utils/earthNowAnalysis.ts`)**: Choose presets (*Global*, *Arctic*, *Tropics*, *N. Atlantic*, *Pacific*) or **drag any custom rectangle directly on the map** to compute local brightness and cloud cover across all 36 frames via offscreen canvas pixel sampling.
- **Live NASA GIBS Daily Satellite Maps**: Load recent global MODIS Terra / VIIRS / MUR Sea Surface Temperature snapshots via the Express `/api/nasa/gibs/image` proxy onto the 2D stage or 3D Globe.
- **Jukebox Track Cards & "Play All" Queue**: Visual track cards with thumbnails and sound descriptions, plus a **Play All Queue** mode that automatically advances through all three datasets in sequence.
- **Stereo Dual-Ear Mode & Correlation Readout**: Pans **Temperature** to the left ear (`-0.85`) and **Precipitation** to the right ear (`+0.85`) simultaneously, displaying live **Pearson $r$ correlation** and L−R brightness delta.
- **Musical Scale, Synth Voice & Spike Alerts**: Pick between *Pentatonic*, *Dorian*, and *Natural Minor* scales, choose *Triangle Lead*, *Soft Marimba*, *Warm Pad*, or *Plucked Bell* voices, and trigger a harmonic alert chime on sharp frame-to-frame jumps (marked on the brightness profile bars).
- **Live Spectrum Strip & Audio Mix Export**: Real-time `Tone.Analyser` FFT/waveform strip beneath the stage plus a **Record Mix** button (`Tone.Recorder`) to save your sonification as `.webm`.
- **Shareable Deep Links & Voice Over**: Syncs active track, frame, scale, voice, interval, cloud layer, stereo mode, stage view, and ROI into URL query parameters (`Share Link`), with an optional **Voice Over** toggle (`window.speechSynthesis`) for track switches and 12-hour timestamp milestones.
- **Instant Memory Preloading (`src/hooks/useFramePreloader.ts`)**: Pre-fetches and decodes all 36 track frames into memory-backed `blob:` URLs (`img.decode()`).
- **Accessibility**: **Skip to controls** link, **Reduce Motion** toggle (respecting `prefers-reduced-motion`), **Larger Text** toggle, **High Contrast** mode, explicit ARIA labels, `aria-live` readouts, and `focus-visible` keyboard outlines.

### 3. Real NASA Mission Soundscapes (`src/components/MissionsTab.tsx` & `src/audio/MissionSoundscapeEngine.ts`)
- **Chandra Deep Space Image Scan**: Left-to-right scanning sonification across *Cassiopeia A*, *Eagle Nebula Pillars of Creation*, *Galactic Center Sgr A**, or any user-uploaded deep space image, mapping brightness → amplitude, RGB wavelength hue → instrument waveform (X-Ray cyan sine bells / Optical gold triangle strings / Infrared crimson sub-octave warmth), and vertical Y energy centroid → musical octave.
- **JWST / Hubble Exoplanet Transmission Spectra**: Wavelength sweep ($0.6\text{–}5.3\,\mu\text{m}$) across *WASP-39 b*, *WASP-96 b*, and *TRAPPIST-1 e* mapping infrared absorption dips ($\text{H}_2\text{O}$, $\text{CO}_2$, $\text{SO}_2$, $\text{CH}_4$) to harmonic filter dropouts and crystalline molecular chimes.
- **ISS Live Orbit Tracker**: Polls live orbital telemetry via `GET /api/nasa/iss` (`api.wheretheiss.at` with Keplerian propagation fallback), renders the ISS beacon, nadir footprint, and orbital ground track onto the interactive 3D Globe, and shifts synth pitch smoothly across day/night terminators (with an on-demand **Terminator Sweep Preview**).

### 4. Home & NASA Space Apps Overview (`src/components/HomeTab.tsx`)
- Explains the **NASA Space Apps "Earth Jukebox"** challenge, the audio-visual synchronization and synthesis engineering challenges solved, global scientific/accessibility impact, and 1-click launch cards into every workspace.

### 5. Separate Express Backend (`server.ts` & `server/`)
- Ships with 5 normalized NASA test telemetry datasets (*Voyager 1 PWS*, *Parker Solar Probe FIELDS*, *Mars InSight SEIS*, *Chandra Cas A*, and *Juno Waves*), instant in-memory catalog caching/prefetching in the Observatory, plus live **NASA DONKI**, **NASA GIBS**, **Live ISS Orbit**, and **universal NASA/NOAA HTTPS API connector** endpoints (`server/nasa/liveNasa.ts`).
- Exposes a clean adapter interface (`server/nasa/adapter.ts`) and a unified **Backend API** tab where new users can paste their NASA API key once or launch **1-click live NASA API presets** (*NASA POWER*, *NASA NeoWs*, *NASA EONET*, *GOES-18 X-Ray*), fetch any custom `*.nasa.gov` / `*.noaa.gov` HTTPS JSON URL to auto-extract telemetry and start projections (`Orbital`, `Globe 3D`, `Waterfall`, `Scope`), inspect schemas, and test REST routes.
- Automatically injects `NASA_API_KEY` from `.env` or runtime UI setup server-side on `api.nasa.gov` requests (with zero-setup `DEMO_KEY` fallback).

---

## Project Structure

```text
├── server.ts                       # Express server entry point (API + Vite dev / static prod)
├── server/
│   ├── nasa/
│   │   ├── adapter.ts              # Pluggable NASA dataset provider & normalization helpers
│   │   ├── datasets.ts             # Built-in NASA test telemetry catalog (240 samples/feed)
│   │   └── liveNasa.ts             # Live NASA DONKI (FLR/GST) & GIBS WMS image proxy helpers
│   └── routes/
│       └── nasaRoutes.ts           # /api/* REST endpoints
├── scripts/
│   └── extract_earth_now.py        # ffmpeg frame extractor & luminance analyzer -> track.json
├── public/
│   └── earth-now/                  # Extracted Earth Now JPEG frames & track.json
└── src/
    ├── App.tsx                     # Root layout, transport controls & global keyboard shortcuts
    ├── audio/
    │   ├── SonificationEngine.ts   # Native Web Audio API synthesizer & FFT analyzer
    │   ├── EarthNowAudioEngine.ts  # Tone.js multi-scale/voice, spike chime, analyser & recorder engine
    │   └── MissionSoundscapeEngine.ts # Chandra column scan, JWST spectral dropout & ISS terminator audio
    ├── components/
    │   ├── HomeTab.tsx             # NASA Space Apps & Earth Jukebox landing showcase
    │   ├── MissionsTab.tsx         # Chandra Scan, JWST Exoplanet Spectra & ISS Live Orbit views
    │   ├── VisualizationStage.tsx  # 60fps Orbital, Waterfall, Scope & 3D Globe stage controller
    │   ├── Globe3DView.tsx         # Three.js interactive 3D Earth, ISS overlay, satellite & FFT ring
    │   ├── EarthNowSpectrumStrip.tsx # Live Tone.Analyser FFT & waveform canvas strip
    │   ├── TelemetryTray.tsx       # Click-to-seek SVG telemetry curve & live metrics
    │   ├── EarthNowTab.tsx         # NASA SVS Earth Now Jukebox & ROI frame player UI
    │   ├── BackendConsole.tsx      # 1-paste NASA API setup, REST API tester & custom ingest form
    │   └── UploadModal.tsx         # Local audio file & CSV/JSON upload modal
    ├── hooks/
    │   └── useFramePreloader.ts    # Preloads & decodes Earth Now frames into blob URLs
    ├── utils/
    │   └── earthNowAnalysis.ts     # Offscreen canvas ROI pixel sampler, spike detection & Pearson r
    ├── services/nasaApi.ts         # Typed frontend API client
    └── types/                      # Shared TypeScript interfaces
```

---

## Prerequisites

- **Node.js** `v20+` (tested on `v22.23.2`)
- **npm**
- **Python 3** + **ffmpeg** *(only required if you want to re-run `scripts/extract_earth_now.py` to regenerate or download new NASA SVS video frames; pre-generated frames and `track.json` are already included in `public/earth-now/`)*

---

## Local Setup & Running

### 1. Clone and install dependencies
```bash
git clone https://github.com/zaydbhai/helios-sonics
cd /helios-sonics
npm install
```

### 2. Configure environment variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Optional NASA configuration variables in `.env`:
- `NASA_API_KEY` — Key from [api.nasa.gov](https://api.nasa.gov/) used by `/api/nasa/donki` (falls back cleanly to `DEMO_KEY` or baseline data if unset).
- `NASA_DATASET_SOURCE` — `"test-catalog"` (default) or `"live-nasa-api"`.
- `PORT` — Server port (defaults to `3000`).

### 3. Start the development server
```bash
npm run dev
```
This runs `tsx server.ts`, starting both the Express backend (`/api/*`) and the Vite React frontend on **`http://localhost:3000`**.

### 4. Type-check and build for production
```bash
npm run lint
npm run build
NODE_ENV=production npm start
```

---

## Cross-Platform Desktop Releases (Windows, macOS & Linux)

Helios Sonics ships with an **Electron desktop wrapper** (`electron/main.ts` + `electron-builder.yml`) configured with hardware GPU/WebGL acceleration, unthrottled background audio timers, and the Express NASA API server bundled directly inside the app on a conflict-free local port.

### Automated GitHub Releases (`.github/workflows/release.yml`)
1. Push a version tag to trigger builds for **Windows (`.exe` installer + portable)**, **macOS (`.dmg` + `.zip` for Apple Silicon & Intel)**, and **Linux (`.AppImage` + `.deb`)**:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
2. Or open the **Actions** tab in your GitHub repository (`zaydbhai/helios-sonics`) and click **Run workflow** on **Build Cross-Platform Desktop Releases**.

### Building Desktop Installers Locally
```bash
# Run the desktop app locally in one command
npm run desktop:dev

# Package installers for your current OS into ./release/
npm run desktop:dist
```

---

## Backend API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Returns backend health, active adapter mode, and dataset count |
| `GET` | `/api/datasets` | Lists available NASA datasets (supports `?domain=` filter) |
| `GET` | `/api/datasets/:id` | Returns full normalized telemetry samples & sonification defaults |
| `POST` | `/api/datasets/ingest` | Normalizes and registers a custom numeric JSON/CSV telemetry series |
| `GET` | `/api/nasa/presets` | Lists 1-click live NASA & NOAA API presets ready for immediate projection |
| `POST` | `/api/nasa/connect` | Fetches any NASA/NOAA HTTPS JSON endpoint, extracts numeric series, normalizes, and registers it |
| `GET` | `/api/nasa/donki` | Fetches live NASA DONKI Solar Flares (`?type=FLR`) or Geomagnetic Storms (`?type=GST`) |
| `GET` | `/api/nasa/gibs/layers` | Lists supported NASA GIBS / Worldview daily global imagery layers |
| `GET` | `/api/nasa/gibs/image` | Same-origin CORS-safe proxy for daily NASA GIBS global equirectangular snapshots |
| `GET` | `/api/nasa/iss` | Live ISS coordinates, orbital ground track & day/night terminator elevation |
| `GET` | `/api/nasa/integration-blueprint` | Returns the adapter schema for NASA API integrations |

---

## Keyboard Shortcuts

Global shortcuts work across all views (outside text inputs, dropdowns, and open modals):

| Key | Action |
| :--- | :--- |
| `Space` | Play / Pause active audio engine |
| `R` | Reset timeline to the beginning (sample/frame `0`) |
| `M` | Mute / Unmute audio globally |
| `←` / `→` | Step backward / forward one frame *(Earth Now tab)* |

