import React from 'react';
import {
  ArrowRight,
  Disc3,
  Globe,
  Headphones,
  KeyRound,
  Layers,
  Radio,
  Satellite,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';

export type HomeDestinationView = 'observatory' | 'earth-now' | 'missions' | 'backend';

interface HomeTabProps {
  onNavigate: (view: HomeDestinationView) => void;
}

export function HomeTab({ onNavigate }: HomeTabProps) {
  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      {/* Hero Section: NASA Space Apps · Earth Jukebox */}
      <section className="border border-slate-800 bg-[#0B0F19] p-6 md:p-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-8 space-y-4">
            <div className="inline-flex items-center gap-2 border border-cyan-500/40 bg-[#07090E] px-3 py-1 font-mono text-[11px] text-cyan-300">
              <Radio className="w-3.5 h-3.5" />
              NASA SPACE APPS CHALLENGE · EARTH JUKEBOX
            </div>

            <h1 className="text-2xl md:text-4xl font-semibold tracking-tight text-slate-100 leading-tight">
              Listen to Earth Breathe, Solar Flares Erupt, and Spacecraft Orbit in Real Time.
            </h1>

            <p className="text-sm text-slate-300 leading-relaxed max-w-3xl">
              <strong className="text-slate-100">Helios Sonics</strong> transforms satellite earth-observation imagery, planetary seismic telemetry, deep-space spectra, and live orbital feeds into calm, expressive music and 60fps scientific visualizations—built for the{' '}
              <span className="text-cyan-300 font-medium">NASA Space Apps &ldquo;Earth Jukebox&rdquo;</span> challenge.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onNavigate('earth-now')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold bg-cyan-500 text-slate-950 hover:bg-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Disc3 className="w-4 h-4" />
                Launch Earth Jukebox
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={() => onNavigate('missions')}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold border border-amber-500/60 bg-[#07090E] text-amber-300 hover:bg-amber-500/10 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Sparkles className="w-4 h-4" />
                Explore Mission Soundscapes
              </button>

              <button
                type="button"
                onClick={() => onNavigate('observatory')}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium border border-slate-700 bg-[#07090E] text-slate-200 hover:border-cyan-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Globe className="w-4 h-4 text-cyan-400" />
                Open Telemetry Observatory
              </button>

              <button
                type="button"
                onClick={() => onNavigate('backend')}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-medium border border-slate-700 bg-[#07090E] text-slate-200 hover:border-slate-500 transition-colors cursor-pointer whitespace-nowrap"
              >
                <KeyRound className="w-4 h-4 text-emerald-400" />
                Connect NASA API Key
              </button>
            </div>
          </div>

          {/* Right Concise Challenge Telemetry Card */}
          <div className="lg:col-span-4 border border-slate-800 bg-[#07090E] p-5 space-y-3">
            <div className="text-xs font-semibold text-slate-200 border-b border-slate-800 pb-2">
              Platform Architecture at a Glance
            </div>
            <div className="space-y-2.5 text-xs">
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Earth SVS Jukebox</span>
                <span className="font-mono text-cyan-300 text-right">36-Frame Tone.js + ROI</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Mission Presets</span>
                <span className="font-mono text-amber-300 text-right">Chandra · JWST · ISS</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Visual Stages</span>
                <span className="font-mono text-slate-200 text-right">Orbital · Scope · 3D Globe</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Live Space APIs</span>
                <span className="font-mono text-emerald-300 text-right">DONKI · GIBS · Open-ISS</span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span className="text-slate-400">Desktop Release</span>
                <span className="font-mono text-slate-200 text-right">Win · macOS · Linux</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Four Core Workspaces */}
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => onNavigate('earth-now')}
          className="text-left border border-slate-800 bg-[#0B0F19] hover:border-cyan-500/70 p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
              <Disc3 className="w-4 h-4" />
              1. Earth Now Jukebox
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Audition 36-frame NASA SVS global Temperature, Wind Speed, and Precipitation maps. Drag custom geographic ROIs or switch to Stereo Dual-Ear mode to hear planetary correlations.
            </p>
          </div>
          <span className="font-mono text-[11px] text-cyan-400 inline-flex items-center gap-1">
            Open Earth Now <ArrowRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('missions')}
          className="text-left border border-slate-800 bg-[#0B0F19] hover:border-amber-500/70 p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
              <Satellite className="w-4 h-4" />
              2. NASA Mission Soundscapes
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Scan Chandra X-Ray deep space plates left-to-right, sweep JWST exoplanet H₂O/CO₂ absorption dips, and track the ISS across live day/night terminators on our 3D Globe.
            </p>
          </div>
          <span className="font-mono text-[11px] text-amber-300 inline-flex items-center gap-1">
            Open Missions <ArrowRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('observatory')}
          className="text-left border border-slate-800 bg-[#0B0F19] hover:border-cyan-500/70 p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-100">
              <Layers className="w-4 h-4 text-cyan-400" />
              3. Telemetry Observatory
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Switch instantaneously between Voyager, Parker Solar Probe, InSight SEIS, and live Solar Flare feeds with auto-calibrated Ambient Space sound profiles and 60fps spectral displays.
            </p>
          </div>
          <span className="font-mono text-[11px] text-cyan-400 inline-flex items-center gap-1">
            Open Observatory <ArrowRight className="w-3 h-3" />
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('backend')}
          className="text-left border border-slate-800 bg-[#0B0F19] hover:border-emerald-500/70 p-5 transition-colors cursor-pointer flex flex-col justify-between gap-4"
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
              <KeyRound className="w-4 h-4" />
              4. One-Paste NASA Connector
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Paste your free NASA Open API key once—or launch any 1-click preset (POWER, NeoWs, EONET, GOES-18)—to fetch live telemetry and project it straight onto the audio-visual stage.
            </p>
          </div>
          <span className="font-mono text-[11px] text-emerald-300 inline-flex items-center gap-1">
            Connect Live Data <ArrowRight className="w-3 h-3" />
          </span>
        </button>
      </section>

      {/* Two-Column Story: Challenges We Faced + Impact We Can Create */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Challenges Overcome */}
        <div className="border border-slate-800 bg-[#0B0F19] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            Engineering Challenges We Faced &amp; Solved
          </div>

          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="font-semibold text-cyan-300 mb-1">
                1. Making Raw Telemetry Sound Musical Instead of Harsh Sirens
              </div>
              <p className="text-slate-400">
                Raw linear mappings from solar wind spikes or uncalibrated oscillators quickly sound fatiguing. We engineered a multi-voice Web Audio synthesizer with pentatonic/harmonic quantization, stereo hall reverb, dynamics compression, and dataset-aware <code className="font-mono text-slate-200">buildAutoCalibratedParams()</code> so every NASA dataset opens ready to listen to without manual tweaking.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="font-semibold text-cyan-300 mb-1">
                2. Frame-Accurate Audio &amp; 60fps WebGL Synchronization
              </div>
              <p className="text-slate-400">
                Browser <code className="font-mono text-slate-200">setInterval</code> drifts behind GPU canvas renders. We anchored playback to <code className="font-mono text-slate-200">Tone.Transport</code> lookahead clocks, decoded all 36 satellite frames into blob object URLs upfront, eliminated rAF teardown churn in the Observatory renderer, and added in-memory catalog caching for zero-lag dataset switching.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="font-semibold text-cyan-300 mb-1">
                3. Turning Complex APIs &amp; Tooling Into a Zero-Setup App
              </div>
              <p className="text-slate-400">
                Non-technical listeners shouldn&apos;t need JSONPath expressions, terminal commands, or API boilerplate. Our Express proxy automatically normalizes heterogeneous NASA/NOAA schemas behind a single API key paste, alongside native hardware-accelerated Electron releases for Linux, macOS, and Windows.
              </p>
            </div>
          </div>
        </div>

        {/* Real-World Impact */}
        <div className="border border-slate-800 bg-[#0B0F19] p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Volume2 className="w-4 h-4 text-emerald-400" />
            Real-World Scientific &amp; Accessibility Impact
          </div>

          <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="flex items-center gap-2 font-semibold text-emerald-300 mb-1">
                <Headphones className="w-3.5 h-3.5" />
                Accessible Earth &amp; Space Science for Blind &amp; Low-Vision Learners
              </div>
              <p className="text-slate-400">
                Visual weather maps and spectra often lock blind students and researchers out of primary discoveries. With spatial stereo dual-track panning, Chandra hue-to-instrument image scanning, Voice Over narration cues, High Contrast styling, and full keyboard transport shortcuts (<code className="font-mono text-slate-200">Space</code>, <code className="font-mono text-slate-200">R</code>, <code className="font-mono text-slate-200">M</code>), Earth&apos;s climate dynamics become genuinely audible and tactile.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="flex items-center gap-2 font-semibold text-emerald-300 mb-1">
                <ActivityPlaceholder />
                Multisensory Pattern Discovery Across Climate &amp; Space Weather
              </div>
              <p className="text-slate-400">
                Human hearing excels at detecting rhythmic shifts, subtle correlations, and sudden transients hidden in noisy time series. Stereo Pearson correlation in Earth Now lets anyone hear heat-vs-precipitation lag directly, while JWST harmonic dropouts highlight tiny parts-per-million atmospheric molecules at a glance—and by ear.
              </p>
            </div>

            <div className="border border-slate-800 bg-[#07090E] p-3.5">
              <div className="flex items-center gap-2 font-semibold text-emerald-300 mb-1">
                <Globe className="w-3.5 h-3.5" />
                Open Citizen-Science Outreach Instrument
              </div>
              <p className="text-slate-400">
                Educators, museums, and musicians can upload their own CSV/JSON datasets, scan custom telescope imagery, record uncompressed audio mixes (<code className="font-mono text-slate-200">.webm</code>), export calibration PNGs, or connect any live NASA Open API endpoint in seconds.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ActivityPlaceholder() {
  return <Sparkles className="w-3.5 h-3.5" />;
}
