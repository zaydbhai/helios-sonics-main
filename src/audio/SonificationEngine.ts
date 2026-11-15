import type { AudioInputSource, NasaDatasetRecord, TelemetrySample } from '../types/nasa';

export type SoundProfile =
  | 'ambient-space'
  | 'crystal-harp'
  | 'deep-cosmos'
  | 'raw-telemetry';

export interface SynthParams {
  baseFrequencyHz: number;
  harmonicSpread: number;
  filterCutoffHz: number;
  filterQ: number;
  waveform: OscillatorType;
  modulationDepth: number;
  volume: number;
  scaleMode: 'harmonic' | 'pentatonic' | 'microtonal' | 'chromatic';
  soundProfile?: SoundProfile;
}

export interface LiveAudioMetrics {
  peakFrequencyHz: number;
  rmsDb: number;
  spectralCentroidHz: number;
  peakBinNormalized: number;
}

// Musical intervals in Hz ratios across 2.5 octaves (consonant & non-fatiguing)
const PENTATONIC_RATIOS = [
  1, 9 / 8, 5 / 4, 3 / 2, 5 / 3,
  2, 9 / 4, 5 / 2, 3, 10 / 3, 4,
];
const HARMONIC_RATIOS = [
  1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8,
  2, 9 / 4, 5 / 2, 3, 4,
];

// Consonant musical root keys (C2, D2, F2, G2, A2, C3, D3)
const MUSICAL_ROOT_KEYS_HZ = [65.41, 73.42, 87.31, 98.0, 110.0, 130.81, 146.83];

function snapToMusicalRoot(hz: number): number {
  let closest = MUSICAL_ROOT_KEYS_HZ[0];
  let bestDist = Math.abs(hz - closest);
  for (const root of MUSICAL_ROOT_KEYS_HZ) {
    const d = Math.abs(hz - root);
    if (d < bestDist) {
      bestDist = d;
      closest = root;
    }
  }
  return closest;
}

/**
 * Automatically derives polished, domain-aware sonification defaults for any NASA dataset
 * based on its statistical dynamics (jitter, flux, domain) and active sound profile.
 */
export function buildAutoCalibratedParams(
  dataset: NasaDatasetRecord,
  profile: SoundProfile = 'ambient-space',
  currentVolume = 0.65
): SynthParams {
  const samples = dataset.samples;
  let avgDiff = 0.08;
  let meanNorm = 0.5;
  if (samples.length > 1) {
    let diffSum = 0;
    let normSum = 0;
    for (let i = 0; i < samples.length; i++) {
      normSum += samples[i].normalized;
      if (i > 0) {
        diffSum += Math.abs(samples[i].normalized - samples[i - 1].normalized);
      }
    }
    avgDiff = diffSum / (samples.length - 1);
    meanNorm = normSum / samples.length;
  }

  const isSpiky = avgDiff > 0.14;
  const domain = dataset.domain;

  let rootHz = snapToMusicalRoot(dataset.sonification.baseFrequencyHz || 110);
  if (domain === 'Planetary Science' && rootHz > 110) rootHz = 73.42; // D2 warm seismic/planetary
  if (domain === 'Astrophysics' && rootHz < 98) rootHz = 130.81; // C3 crystalline X-ray
  if (domain === 'Heliophysics' && meanNorm > 0.55) rootHz = 98.0; // G2 solar warmth

  if (profile === 'deep-cosmos') {
    return {
      baseFrequencyHz: Math.max(55, rootHz * 0.75),
      harmonicSpread: 1.5,
      filterCutoffHz: 950,
      filterQ: 1.4,
      waveform: 'triangle',
      modulationDepth: 0.18,
      volume: currentVolume,
      scaleMode: 'pentatonic',
      soundProfile: profile,
    };
  }

  if (profile === 'crystal-harp') {
    return {
      baseFrequencyHz: Math.min(164.81, rootHz * 1.5),
      harmonicSpread: 2.0,
      filterCutoffHz: 2600,
      filterQ: 1.5,
      waveform: 'sine',
      modulationDepth: 0.14,
      volume: currentVolume,
      scaleMode: 'pentatonic',
      soundProfile: profile,
    };
  }

  if (profile === 'raw-telemetry') {
    return {
      baseFrequencyHz: rootHz,
      harmonicSpread: 1.5,
      filterCutoffHz: isSpiky ? 1900 : 2400,
      filterQ: 2.6,
      waveform: dataset.sonification.waveform === 'square' ? 'sawtooth' : dataset.sonification.waveform,
      modulationDepth: 0.34,
      volume: currentVolume,
      scaleMode: dataset.sonification.recommendedScale === 'microtonal' ? 'harmonic' : dataset.sonification.recommendedScale,
      soundProfile: profile,
    };
  }

  // Default: 'ambient-space' — warm, lush, zero-fatigue cosmic observatory mix
  return {
    baseFrequencyHz: rootHz,
    harmonicSpread: 1.5,
    filterCutoffHz: isSpiky ? 1450 : 1850,
    filterQ: 1.6,
    waveform: 'triangle',
    modulationDepth: 0.22,
    volume: currentVolume,
    scaleMode: domain === 'Astrophysics' ? 'harmonic' : 'pentatonic',
    soundProfile: 'ambient-space',
  };
}

export class SonificationEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private warmthShelf: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;

  // Spatial stereo convolver reverb + dry/wet routing
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;

  // Multi-voice synth nodes
  private fundamentalOsc: OscillatorNode | null = null;
  private fundamentalGain: GainNode | null = null;
  private carrierOsc: OscillatorNode | null = null;
  private chorusOsc: OscillatorNode | null = null;
  private timbreGain: GainNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private subGain: GainNode | null = null;
  private overtoneOsc: OscillatorNode | null = null;
  private overtoneGain: GainNode | null = null;
  private modulatorOsc: OscillatorNode | null = null;
  private modulatorGain: GainNode | null = null;
  private synthEnvelopeGain: GainNode | null = null;

  // Gentle melodic pluck chime for step transients
  private lastPluckMs = 0;
  private lastQuantizedHz = 0;

  // External file / mic nodes
  private audioElement: HTMLAudioElement | null = null;
  private mediaElementSource: MediaElementAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private micSource: MediaStreamAudioSourceNode | null = null;

  private freqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(1024));
  private timeBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(2048));
  private activeSource: AudioInputSource = 'nasa-synth';
  private isRunning = false;

  public get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  public get fftSize(): number {
    return this.analyser?.fftSize ?? 2048;
  }

  public get source(): AudioInputSource {
    return this.activeSource;
  }

  /**
   * Generates a lush stereo warm-hall impulse response mathematically in memory
   * (zero external audio file dependency).
   */
  private createReverbImpulse(ctx: AudioContext, durationSec = 2.4, decay = 2.8): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);

    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        // Gentle early fade-in to avoid pre-delay metallic clicks
        const fadeIn = Math.min(1, i / (ctx.sampleRate * 0.025));
        const white = Math.random() * 2 - 1;
        // One-pole lowpass damping (~2.4 kHz air absorption)
        lp = lp * 0.72 + white * 0.28;
        data[i] = lp * env * fadeIn * 0.55;
      }
    }
    return impulse;
  }

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.82;
      this.analyser.minDecibels = -90;
      this.analyser.maxDecibels = -10;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;
      this.compressor.attack.value = 0.008;
      this.compressor.release.value = 0.22;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.65;

      // Smooth 12dB/oct lowpass + gentle high-frequency rolloff shelf to tame harsh harmonics
      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 1650;
      this.filter.Q.value = 1.6;

      this.warmthShelf = this.ctx.createBiquadFilter();
      this.warmthShelf.type = 'highshelf';
      this.warmthShelf.frequency.value = 3400;
      this.warmthShelf.gain.value = -4.5;

      this.panner = this.ctx.createStereoPanner();
      this.panner.pan.value = 0;

      // Parallel Dry + Stereo Convolver Reverb bus
      this.dryGain = this.ctx.createGain();
      this.dryGain.gain.value = 0.74;

      this.wetGain = this.ctx.createGain();
      this.wetGain.gain.value = 0.36;

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.createReverbImpulse(this.ctx, 2.4, 2.8);

      this.filter.connect(this.warmthShelf);
      this.warmthShelf.connect(this.panner);

      this.panner.connect(this.dryGain);
      this.panner.connect(this.convolver);
      this.convolver.connect(this.wetGain);

      this.dryGain.connect(this.compressor);
      this.wetGain.connect(this.compressor);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
      this.timeBuffer = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    }
    return this.ctx;
  }

  private quantizePitch(
    baseHz: number,
    normalized: number,
    mode: SynthParams['scaleMode']
  ): number {
    const clamped = Math.max(0, Math.min(1, normalized));
    if (mode === 'microtonal') {
      return baseHz * Math.pow(2, clamped * 1.5);
    }
    if (mode === 'chromatic') {
      const semitones = Math.round(clamped * 19);
      return baseHz * Math.pow(2, semitones / 12);
    }
    const table = mode === 'pentatonic' ? PENTATONIC_RATIOS : HARMONIC_RATIOS;
    const idx = Math.min(table.length - 1, Math.floor(clamped * table.length));
    return baseHz * table[idx];
  }

  private triggerCrystalPluck(freqHz: number, gainPeak: number, panValue: number): void {
    if (!this.ctx || !this.filter || !this.panner) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    const pan = this.ctx.createStereoPanner();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freqHz * 2, now);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(Math.min(0.16, gainPeak), now + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

    pan.pan.value = Math.max(-0.7, Math.min(0.7, -panValue * 0.6));

    osc.connect(env);
    env.connect(pan);
    if (this.convolver && this.dryGain) {
      pan.connect(this.dryGain);
      pan.connect(this.convolver);
    }
    osc.start(now);
    osc.stop(now + 0.6);
  }

  public async startSynth(params: SynthParams): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopExternalStreams();
    this.activeSource = 'nasa-synth';

    const profile = params.soundProfile ?? 'ambient-space';

    if (!this.carrierOsc) {
      this.synthEnvelopeGain = ctx.createGain();
      this.synthEnvelopeGain.gain.value = 0.0001;

      // Pure sine core keeps any waveform warm & grounded
      this.fundamentalOsc = ctx.createOscillator();
      this.fundamentalOsc.type = 'sine';
      this.fundamentalOsc.frequency.value = params.baseFrequencyHz;

      this.fundamentalGain = ctx.createGain();
      this.fundamentalGain.gain.value = 0.42;

      // Dual-detuned timbre oscillators for lush stereo chorus richness
      this.carrierOsc = ctx.createOscillator();
      this.carrierOsc.type = params.waveform;
      this.carrierOsc.frequency.value = params.baseFrequencyHz;
      this.carrierOsc.detune.value = -5;

      this.chorusOsc = ctx.createOscillator();
      this.chorusOsc.type = params.waveform;
      this.chorusOsc.frequency.value = params.baseFrequencyHz;
      this.chorusOsc.detune.value = 5;

      this.timbreGain = ctx.createGain();
      this.timbreGain.gain.value =
        params.waveform === 'square' || params.waveform === 'sawtooth' ? 0.16 : 0.24;

      // Soft sub-harmonic root pad anchoring the key
      this.subOsc = ctx.createOscillator();
      this.subOsc.type = 'sine';
      this.subOsc.frequency.value = Math.max(42, params.baseFrequencyHz * 0.5);

      this.subGain = ctx.createGain();
      this.subGain.gain.value = profile === 'deep-cosmos' ? 0.28 : 0.18;

      // Consonant fifth / octave harmonic shimmer oscillator
      this.overtoneOsc = ctx.createOscillator();
      this.overtoneOsc.type = 'sine';
      this.overtoneOsc.frequency.value = params.baseFrequencyHz * 1.5;

      this.overtoneGain = ctx.createGain();
      this.overtoneGain.gain.value = 0.12;

      // Expressive musical vibrato LFO (3.2–5.8 Hz, gentle ±Hz swing, NOT 30 Hz sirens)
      this.modulatorOsc = ctx.createOscillator();
      this.modulatorOsc.type = 'sine';
      this.modulatorOsc.frequency.value = 3.8;

      this.modulatorGain = ctx.createGain();
      this.modulatorGain.gain.value = Math.min(8, params.modulationDepth * 10);

      this.modulatorOsc.connect(this.modulatorGain);
      this.modulatorGain.connect(this.carrierOsc.frequency);
      this.modulatorGain.connect(this.chorusOsc.frequency);

      this.fundamentalOsc.connect(this.fundamentalGain);
      this.fundamentalGain.connect(this.synthEnvelopeGain);

      this.carrierOsc.connect(this.timbreGain);
      this.chorusOsc.connect(this.timbreGain);
      this.timbreGain.connect(this.synthEnvelopeGain);

      this.subOsc.connect(this.subGain);
      this.subGain.connect(this.synthEnvelopeGain);

      this.overtoneOsc.connect(this.overtoneGain);
      this.overtoneGain.connect(this.synthEnvelopeGain);

      if (this.filter) {
        this.synthEnvelopeGain.connect(this.filter);
      }

      this.fundamentalOsc.start();
      this.carrierOsc.start();
      this.chorusOsc.start();
      this.subOsc.start();
      this.overtoneOsc.start();
      this.modulatorOsc.start();
    }

    // Configure dry/wet reverb balance per profile
    if (this.dryGain && this.wetGain) {
      const wetMap: Record<SoundProfile, number> = {
        'ambient-space': 0.38,
        'crystal-harp': 0.32,
        'deep-cosmos': 0.46,
        'raw-telemetry': 0.16,
      };
      const wet = wetMap[profile];
      this.dryGain.gain.setTargetAtTime(1 - wet * 0.45, ctx.currentTime, 0.06);
      this.wetGain.gain.setTargetAtTime(wet, ctx.currentTime, 0.06);
    }

    if (this.masterGain && this.compressor && this.analyser) {
      this.masterGain.gain.setTargetAtTime(params.volume, ctx.currentTime, 0.04);
      try {
        this.compressor.disconnect();
        this.masterGain.disconnect();
      } catch {
        // Ignore if not yet connected
      }
      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }

    if (this.synthEnvelopeGain) {
      this.synthEnvelopeGain.gain.setTargetAtTime(0.38, ctx.currentTime, 0.09);
    }

    this.lastQuantizedHz = 0;
    this.isRunning = true;
  }

  public updateFromTelemetry(sample: TelemetrySample, params: SynthParams): void {
    if (!this.ctx || !this.isRunning || this.activeSource !== 'nasa-synth') return;
    const now = this.ctx.currentTime;
    const profile = params.soundProfile ?? 'ambient-space';

    const glideSec =
      profile === 'deep-cosmos'
        ? 0.12
        : profile === 'raw-telemetry'
        ? 0.035
        : 0.075;

    const carrierHz = this.quantizePitch(
      params.baseFrequencyHz,
      sample.normalized,
      params.scaleMode
    );

    // Lock overtone to consonant fifth (1.5x), octave (2x), or twelfth (3x)
    const consonantMult =
      sample.secondaryNormalized > 0.68
        ? 2.0
        : sample.secondaryNormalized > 0.34
        ? 1.5
        : 1.25;
    const overtoneHz = carrierHz * consonantMult;

    if (this.fundamentalOsc && this.fundamentalGain) {
      this.fundamentalOsc.frequency.setTargetAtTime(carrierHz, now, glideSec);
      this.fundamentalGain.gain.setTargetAtTime(
        profile === 'crystal-harp' ? 0.28 : 0.44,
        now,
        0.06
      );
    }

    if (this.carrierOsc && this.chorusOsc && this.timbreGain) {
      if (this.carrierOsc.type !== params.waveform) {
        this.carrierOsc.type = params.waveform;
        this.chorusOsc.type = params.waveform;
      }
      this.carrierOsc.frequency.setTargetAtTime(carrierHz, now, glideSec);
      this.chorusOsc.frequency.setTargetAtTime(carrierHz, now, glideSec);

      // Automatically tame harsh saw/square energy so no dataset ever screeches
      const rawCap =
        params.waveform === 'square'
          ? 0.09
          : params.waveform === 'sawtooth'
          ? 0.14
          : 0.24;
      const profileScale = profile === 'crystal-harp' ? 0.55 : profile === 'deep-cosmos' ? 0.75 : 1.0;
      this.timbreGain.gain.setTargetAtTime(rawCap * profileScale, now, 0.06);
    }

    if (this.subOsc && this.subGain) {
      const subHz = Math.max(42, params.baseFrequencyHz * 0.5);
      this.subOsc.frequency.setTargetAtTime(subHz, now, 0.12);
      this.subGain.gain.setTargetAtTime(
        profile === 'deep-cosmos'
          ? 0.30
          : profile === 'crystal-harp'
          ? 0.11
          : 0.18,
        now,
        0.08
      );
    }

    if (this.overtoneOsc && this.overtoneGain) {
      this.overtoneOsc.frequency.setTargetAtTime(overtoneHz, now, glideSec * 1.15);
      const baseOvertone = profile === 'crystal-harp' ? 0.18 : 0.09;
      this.overtoneGain.gain.setTargetAtTime(
        baseOvertone + sample.secondaryNormalized * 0.14,
        now,
        0.07
      );
    }

    if (this.modulatorOsc && this.modulatorGain) {
      // Gentle vibrato (2.4 - 6.2 Hz), scaled softly to pitch so low notes never wobble out of tune
      const vibratoRate = 2.4 + sample.spectralFlux * 3.8;
      const maxSwingHz = Math.min(12, carrierHz * 0.025);
      this.modulatorOsc.frequency.setTargetAtTime(vibratoRate, now, 0.08);
      this.modulatorGain.gain.setTargetAtTime(
        params.modulationDepth * maxSwingHz,
        now,
        0.07
      );
    }

    if (this.filter) {
      // Spectral flux opens the filter smoothly for warm expressive swells
      const cutoff = Math.max(
        220,
        Math.min(4600, params.filterCutoffHz * (0.45 + sample.normalized * 0.65 + sample.spectralFlux * 0.35))
      );
      const safeQ = Math.max(0.7, Math.min(3.4, params.filterQ));
      this.filter.frequency.setTargetAtTime(cutoff, now, 0.06);
      this.filter.Q.setTargetAtTime(safeQ, now, 0.06);
    }

    const panVal = (sample.secondaryNormalized - 0.5) * 0.85;
    if (this.panner) {
      this.panner.pan.setTargetAtTime(panVal, now, 0.08);
    }

    if (this.dryGain && this.wetGain) {
      const wetMap: Record<SoundProfile, number> = {
        'ambient-space': 0.38,
        'crystal-harp': 0.32,
        'deep-cosmos': 0.46,
        'raw-telemetry': 0.16,
      };
      const wet = wetMap[profile];
      this.dryGain.gain.setTargetAtTime(1 - wet * 0.45, now, 0.08);
      this.wetGain.gain.setTargetAtTime(wet, now, 0.08);
    }

    if (this.synthEnvelopeGain) {
      const baseEnv = profile === 'crystal-harp' ? 0.16 : 0.24;
      this.synthEnvelopeGain.gain.setTargetAtTime(
        baseEnv + sample.normalized * 0.24,
        now,
        0.06
      );
    }

    if (this.masterGain) {
      this.masterGain.gain.setTargetAtTime(params.volume, now, 0.04);
    }

    // Trigger subtle harmonic bell accents when telemetry transitions to a new musical note
    const nowPerf = performance.now();
    const minPluckInterval = profile === 'crystal-harp' ? 160 : 320;
    if (
      profile !== 'raw-telemetry' &&
      Math.abs(carrierHz - this.lastQuantizedHz) > 2 &&
      nowPerf - this.lastPluckMs >= minPluckInterval &&
      params.volume > 0.02
    ) {
      this.lastPluckMs = nowPerf;
      this.lastQuantizedHz = carrierHz;
      const bellGain =
        profile === 'crystal-harp'
          ? 0.12 + sample.spectralFlux * 0.04
          : 0.045 + sample.spectralFlux * 0.04;
      this.triggerCrystalPluck(carrierHz, bellGain, panVal);
    } else if (this.lastQuantizedHz === 0) {
      this.lastQuantizedHz = carrierHz;
    }
  }

  public setVolume(volume: number): void {
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.03);
    }
    if (this.audioElement) {
      this.audioElement.volume = Math.max(0, Math.min(1, volume));
    }
  }

  public async loadAudioFile(file: File, volume: number): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopSynthNodes();
    this.stopExternalStreams();
    this.activeSource = 'audio-file';

    const objectUrl = URL.createObjectURL(file);
    const audio = new Audio(objectUrl);
    audio.crossOrigin = 'anonymous';
    audio.loop = true;
    audio.volume = Math.max(0, Math.min(1, volume));

    this.audioElement = audio;
    this.mediaElementSource = ctx.createMediaElementSource(audio);
    if (this.analyser) {
      this.mediaElementSource.connect(this.analyser);
      this.analyser.connect(ctx.destination);
    }

    await audio.play();
    this.isRunning = true;
  }

  public toggleAudioFilePlayback(shouldPlay: boolean): void {
    if (!this.audioElement) return;
    if (shouldPlay) {
      this.ctx?.resume();
      this.audioElement.play().catch(() => {});
      this.isRunning = true;
    } else {
      this.audioElement.pause();
      this.isRunning = false;
    }
  }

  public async startMicrophone(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopSynthNodes();
    this.stopExternalStreams();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micStream = stream;
    this.activeSource = 'microphone';
    this.micSource = ctx.createMediaStreamSource(stream);
    if (this.analyser) {
      try {
        this.analyser.disconnect(ctx.destination);
      } catch {
        // Ignore if not connected
      }
      this.micSource.connect(this.analyser);
    }
    this.isRunning = true;
  }

  public pause(): void {
    if (this.ctx && this.synthEnvelopeGain && this.activeSource === 'nasa-synth') {
      this.synthEnvelopeGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
    }
    if (this.audioElement && this.activeSource === 'audio-file') {
      this.audioElement.pause();
    }
    this.isRunning = false;
  }

  public stopAll(): void {
    this.pause();
    this.stopSynthNodes();
    this.stopExternalStreams();
    this.isRunning = false;
  }

  private stopSynthNodes(): void {
    const oscs = [
      this.fundamentalOsc,
      this.carrierOsc,
      this.chorusOsc,
      this.subOsc,
      this.overtoneOsc,
      this.modulatorOsc,
    ];
    for (const osc of oscs) {
      if (osc) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Already stopped
        }
      }
    }
    this.fundamentalOsc = null;
    this.fundamentalGain = null;
    this.carrierOsc = null;
    this.chorusOsc = null;
    this.timbreGain = null;
    this.subOsc = null;
    this.subGain = null;
    this.overtoneOsc = null;
    this.overtoneGain = null;
    this.modulatorOsc = null;
    this.modulatorGain = null;
    this.synthEnvelopeGain = null;
  }

  private stopExternalStreams(): void {
    if (this.audioElement) {
      this.audioElement.pause();
      if (this.audioElement.src.startsWith('blob:')) {
        URL.revokeObjectURL(this.audioElement.src);
      }
      this.audioElement = null;
    }
    if (this.mediaElementSource) {
      try {
        this.mediaElementSource.disconnect();
      } catch {
        // Ignore
      }
      this.mediaElementSource = null;
    }
    if (this.micStream) {
      for (const track of this.micStream.getTracks()) {
        track.stop();
      }
      this.micStream = null;
    }
    if (this.micSource) {
      try {
        this.micSource.disconnect();
      } catch {
        // Ignore
      }
      this.micSource = null;
    }
  }

  public getSpectrumData(fallbackSample?: TelemetrySample, isPlaying?: boolean): {
    freq: Uint8Array;
    time: Uint8Array;
    metrics: LiveAudioMetrics;
  } {
    if (this.analyser && this.isRunning) {
      this.analyser.getByteFrequencyData(this.freqBuffer);
      this.analyser.getByteTimeDomainData(this.timeBuffer);
    } else if (fallbackSample && isPlaying) {
      const len = this.freqBuffer.length;
      for (let i = 0; i < len; i++) {
        const binNorm = i / len;
        const fundamental = Math.exp(-Math.pow((binNorm - (0.04 + fallbackSample.normalized * 0.14)) * 26, 2));
        const harmonic = Math.exp(-Math.pow((binNorm - (0.12 + fallbackSample.secondaryNormalized * 0.25)) * 18, 2));
        const noise = fallbackSample.spectralFlux * 38 * Math.abs(Math.sin(i * 0.4 + fallbackSample.t));
        this.freqBuffer[i] = Math.min(255, Math.floor((fundamental * 215 + harmonic * 135) + noise));
      }
      for (let i = 0; i < this.timeBuffer.length; i++) {
        const phase = (i / this.timeBuffer.length) * Math.PI * (6 + fallbackSample.normalized * 12);
        const val = 128 + Math.sin(phase + fallbackSample.t) * (35 + fallbackSample.normalized * 75);
        this.timeBuffer[i] = Math.max(0, Math.min(255, Math.floor(val)));
      }
    } else {
      this.freqBuffer.fill(0);
      this.timeBuffer.fill(128);
    }

    let maxVal = 0;
    let maxIdx = 0;
    let weightedSum = 0;
    let magSum = 0;
    const nyquist = this.sampleRate / 2;
    const binCount = this.freqBuffer.length;

    for (let i = 0; i < binCount; i++) {
      const v = this.freqBuffer[i];
      if (v > maxVal) {
        maxVal = v;
        maxIdx = i;
      }
      const binHz = (i / binCount) * nyquist;
      weightedSum += binHz * v;
      magSum += v;
    }

    let rmsAcc = 0;
    for (let i = 0; i < this.timeBuffer.length; i++) {
      const centered = (this.timeBuffer[i] - 128) / 128;
      rmsAcc += centered * centered;
    }
    const rms = Math.sqrt(rmsAcc / this.timeBuffer.length);
    const rmsDb = rms > 0.0001 ? Math.max(-72, 20 * Math.log10(rms)) : -72;

    return {
      freq: this.freqBuffer,
      time: this.timeBuffer,
      metrics: {
        peakFrequencyHz: Math.round((maxIdx / binCount) * nyquist),
        rmsDb: Number(rmsDb.toFixed(1)),
        spectralCentroidHz: magSum > 0 ? Math.round(weightedSum / magSum) : 0,
        peakBinNormalized: maxVal / 255,
      },
    };
  }
}
