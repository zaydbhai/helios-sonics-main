export interface ChandraScanColumnInput {
  xNorm: number; // 0 (left) -> 1 (right)
  yNorm: number; // 0 (bottom) -> 1 (top, bright energy centroid)
  totalBrightness: number; // 0..1
  xrayRatio: number; // Blue / Cyan dominance 0..1
  opticalRatio: number; // Green / Gold dominance 0..1
  irRatio: number; // Red / Amber dominance 0..1
}

export interface JwstSpectrumInput {
  wavelengthUm: number;
  fluxNorm: number; // 0..1 normalized continuum transmission (1 = bright continuum, 0 = deep absorption dip)
  dipDepth: number; // 0..1 strength of atmospheric absorption
  activeMolecule: string | null;
}

export interface IssTerminatorInput {
  daylightFactor: number; // 0 (deep eclipse) .. 0.5 (terminator) .. 1 (full sunlight)
  velocityKmh: number;
  altitudeKm: number;
  solarElevationDeg: number;
}

// 3 octaves of C major pentatonic (consonant for vertical Y mapping)
const CHANDRA_PENTATONIC_HZ = [
  130.81, 146.83, 164.81, 196.0, 220.0,
  261.63, 293.66, 329.63, 392.0, 440.0,
  523.25, 587.33, 659.25, 783.99, 880.0,
  1046.5,
];

export class MissionSoundscapeEngine {
  private ctx: AudioContext | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private masterGain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private convolver: ConvolverNode | null = null;
  private wetBus: GainNode | null = null;
  private dryBus: GainNode | null = null;

  // JWST continuous harmonic bed nodes
  private jwstRootOsc: OscillatorNode | null = null;
  private jwstFifthOsc: OscillatorNode | null = null;
  private jwstOctaveOsc: OscillatorNode | null = null;
  private jwstFilter: BiquadFilterNode | null = null;
  private jwstBedGain: GainNode | null = null;
  private lastJwstMolecule: string | null = null;
  private lastMoleculePingMs = 0;

  // ISS orbital terminator drone nodes
  private issSubOsc: OscillatorNode | null = null;
  private issLeadOsc: OscillatorNode | null = null;
  private issHarmonyOsc: OscillatorNode | null = null;
  private issFilter: BiquadFilterNode | null = null;
  private issBedGain: GainNode | null = null;
  private lastIssPulseMs = 0;

  private chandraBedOsc: OscillatorNode | null = null;
  private chandraBedGain: GainNode | null = null;

  private freqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));
  private volume = 0.72;
  private muted = false;

  private createReverbImpulse(ctx: AudioContext, durationSec = 2.6, decay = 2.6): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const env = Math.pow(1 - i / length, decay);
        const fadeIn = Math.min(1, i / (ctx.sampleRate * 0.025));
        const white = Math.random() * 2 - 1;
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

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -16;
      this.compressor.knee.value = 18;
      this.compressor.ratio.value = 4;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;

      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.82;
      this.freqBuffer = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));

      this.dryBus = this.ctx.createGain();
      this.dryBus.gain.value = 0.74;

      this.wetBus = this.ctx.createGain();
      this.wetBus.gain.value = 0.44;

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.createReverbImpulse(this.ctx, 2.6, 2.6);

      this.dryBus.connect(this.compressor);
      this.convolver.connect(this.wetBus);
      this.wetBus.connect(this.compressor);

      this.compressor.connect(this.masterGain);
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  public async resume(): Promise<void> {
    const ctx = this.ensureContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
  }

  public setVolume(vol: number): void {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        this.muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.ctx && this.masterGain) {
      this.masterGain.gain.setTargetAtTime(
        muted ? 0 : this.volume,
        this.ctx.currentTime,
        0.04
      );
    }
  }

  public getSpectrumBins(): Uint8Array | null {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.freqBuffer);
    return this.freqBuffer;
  }

  // =========================================================================
  // 1. CHANDRA DEEP SPACE LEFT-TO-RIGHT IMAGE SCAN SONIFICATION
  // =========================================================================

  public async startChandraScan(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopJwstBed();
    this.stopIssOrbit();

    if (!this.chandraBedOsc && this.dryBus && this.convolver) {
      this.chandraBedOsc = ctx.createOscillator();
      this.chandraBedOsc.type = 'sine';
      this.chandraBedOsc.frequency.value = 65.41; // C2 deep space anchor

      this.chandraBedGain = ctx.createGain();
      this.chandraBedGain.gain.value = 0.0001;

      this.chandraBedOsc.connect(this.chandraBedGain);
      this.chandraBedGain.connect(this.dryBus);
      this.chandraBedGain.connect(this.convolver);
      this.chandraBedOsc.start();
    }

    if (this.chandraBedGain) {
      this.chandraBedGain.gain.setTargetAtTime(0.08, ctx.currentTime, 0.12);
    }
  }

  public triggerChandraScanColumn(input: ChandraScanColumnInput): void {
    if (!this.ctx || !this.dryBus || !this.convolver) return;
    const now = this.ctx.currentTime;
    const brightness = Math.max(0.02, Math.min(1, input.totalBrightness));

    if (this.chandraBedGain) {
      this.chandraBedGain.gain.setTargetAtTime(0.04 + brightness * 0.08, now, 0.12);
    }

    if (brightness < 0.05) return;

    const noteIdx = Math.min(
      CHANDRA_PENTATONIC_HZ.length - 1,
      Math.max(0, Math.floor(Math.max(0, Math.min(0.999, input.yNorm)) * CHANDRA_PENTATONIC_HZ.length))
    );
    const baseHz = CHANDRA_PENTATONIC_HZ[noteIdx];
    const panVal = Math.max(-0.85, Math.min(0.85, (input.xNorm - 0.5) * 1.7));

    const panner = this.ctx.createStereoPanner();
    panner.pan.value = panVal;
    panner.connect(this.dryBus);
    panner.connect(this.convolver);

    const spawnVoice = (
      waveform: OscillatorType,
      freqHz: number,
      peakGain: number,
      durationSec: number
    ) => {
      if (!this.ctx || peakGain < 0.01) return;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = waveform;
      osc.frequency.setValueAtTime(freqHz, now);

      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(peakGain, now + 0.018);
      env.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      osc.connect(env);
      env.connect(panner);
      osc.start(now);
      osc.stop(now + durationSec + 0.04);
    };

    // Hue -> Instrument/Waveform mapping:
    // X-Ray (Blue/Cyan) -> Crystalline sine bell + octave shimmer
    if (input.xrayRatio > 0.12) {
      spawnVoice('sine', baseHz * 2, brightness * input.xrayRatio * 0.18, 0.42);
    }
    // Optical (Gold/Green) -> Expressive triangle strings
    if (input.opticalRatio > 0.12) {
      spawnVoice('triangle', baseHz, brightness * input.opticalRatio * 0.22, 0.36);
    }
    // Infrared (Red/Amber) -> Warm sub-octave cello/pad resonance
    if (input.irRatio > 0.12) {
      spawnVoice('sine', Math.max(55, baseHz * 0.5), brightness * input.irRatio * 0.24, 0.52);
    }
  }

  public stopChandraScan(): void {
    if (this.chandraBedGain && this.ctx) {
      this.chandraBedGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    }
  }

  // =========================================================================
  // 2. JWST EXOPLANET TRANSMISSION SPECTRA (HARMONIC DROPOUTS)
  // =========================================================================

  public async startJwstBed(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopChandraScan();
    this.stopIssOrbit();

    if (!this.jwstRootOsc && this.dryBus && this.convolver) {
      this.jwstFilter = ctx.createBiquadFilter();
      this.jwstFilter.type = 'lowpass';
      this.jwstFilter.frequency.value = 2200;
      this.jwstFilter.Q.value = 1.4;

      this.jwstBedGain = ctx.createGain();
      this.jwstBedGain.gain.value = 0.0001;

      this.jwstRootOsc = ctx.createOscillator();
      this.jwstRootOsc.type = 'triangle';
      this.jwstRootOsc.frequency.value = 130.81; // C3

      this.jwstFifthOsc = ctx.createOscillator();
      this.jwstFifthOsc.type = 'sine';
      this.jwstFifthOsc.frequency.value = 196.0; // G3

      this.jwstOctaveOsc = ctx.createOscillator();
      this.jwstOctaveOsc.type = 'sine';
      this.jwstOctaveOsc.frequency.value = 261.63; // C4

      const octGain = ctx.createGain();
      octGain.gain.value = 0.45;

      this.jwstRootOsc.connect(this.jwstFilter);
      this.jwstFifthOsc.connect(this.jwstFilter);
      this.jwstOctaveOsc.connect(octGain);
      octGain.connect(this.jwstFilter);

      this.jwstFilter.connect(this.jwstBedGain);
      this.jwstBedGain.connect(this.dryBus);
      this.jwstBedGain.connect(this.convolver);

      this.jwstRootOsc.start();
      this.jwstFifthOsc.start();
      this.jwstOctaveOsc.start();
    }

    if (this.jwstBedGain) {
      this.jwstBedGain.gain.setTargetAtTime(0.24, ctx.currentTime, 0.1);
    }
    this.lastJwstMolecule = null;
  }

  public updateJwstSpectrum(input: JwstSpectrumInput): void {
    if (!this.ctx || !this.jwstFilter || !this.jwstBedGain) return;
    const now = this.ctx.currentTime;

    // Continuum sweeps gently upward with wavelength (0.6um..5.3um)
    const wavelengthNorm = Math.max(0, Math.min(1, (input.wavelengthUm - 0.6) / 4.7));
    const rootHz = 110 * Math.pow(2, wavelengthNorm * 0.75);

    this.jwstRootOsc?.frequency.setTargetAtTime(rootHz, now, 0.08);
    this.jwstFifthOsc?.frequency.setTargetAtTime(rootHz * 1.5, now, 0.08);
    // Upper harmonic drops out cleanly when inside an infrared absorption dip
    this.jwstOctaveOsc?.frequency.setTargetAtTime(
      rootHz * (input.dipDepth > 0.35 ? 1.0 : 2.0),
      now,
      0.06
    );

    // Harmonic dropout: filter notch closes & continuum dims during molecular absorption
    const dropoutCutoff = Math.max(240, 2900 * (1 - input.dipDepth * 0.86));
    const dropoutGain = Math.max(0.06, 0.28 * (1 - input.dipDepth * 0.68));
    this.jwstFilter.frequency.setTargetAtTime(dropoutCutoff, now, 0.05);
    this.jwstBedGain.gain.setTargetAtTime(dropoutGain, now, 0.05);

    // Trigger soft molecular chime when entering an annotated absorption band (H2O, CO2, SO2, CH4)
    const nowMs = performance.now();
    if (
      input.activeMolecule &&
      input.activeMolecule !== this.lastJwstMolecule &&
      nowMs - this.lastMoleculePingMs > 380 &&
      this.dryBus &&
      this.convolver
    ) {
      this.lastJwstMolecule = input.activeMolecule;
      this.lastMoleculePingMs = nowMs;

      const chime = this.ctx.createOscillator();
      const chimeGain = this.ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(rootHz * 3, now);
      chimeGain.gain.setValueAtTime(0.0001, now);
      chimeGain.gain.linearRampToValueAtTime(0.14, now + 0.015);
      chimeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.75);

      chime.connect(chimeGain);
      chimeGain.connect(this.dryBus);
      chimeGain.connect(this.convolver);
      chime.start(now);
      chime.stop(now + 0.8);
    } else if (!input.activeMolecule) {
      this.lastJwstMolecule = null;
    }
  }

  public stopJwstBed(): void {
    if (this.jwstBedGain && this.ctx) {
      this.jwstBedGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    }
  }

  // =========================================================================
  // 3. ISS LIVE ORBIT & TERMINATOR PITCH SHIFTING
  // =========================================================================

  public async startIssOrbit(): Promise<void> {
    const ctx = this.ensureContext();
    await ctx.resume();
    this.stopChandraScan();
    this.stopJwstBed();

    if (!this.issSubOsc && this.dryBus && this.convolver) {
      this.issFilter = ctx.createBiquadFilter();
      this.issFilter.type = 'lowpass';
      this.issFilter.frequency.value = 1400;
      this.issFilter.Q.value = 1.3;

      this.issBedGain = ctx.createGain();
      this.issBedGain.gain.value = 0.0001;

      this.issSubOsc = ctx.createOscillator();
      this.issSubOsc.type = 'sine';
      this.issSubOsc.frequency.value = 65.41;

      this.issLeadOsc = ctx.createOscillator();
      this.issLeadOsc.type = 'triangle';
      this.issLeadOsc.frequency.value = 130.81;

      this.issHarmonyOsc = ctx.createOscillator();
      this.issHarmonyOsc.type = 'sine';
      this.issHarmonyOsc.frequency.value = 196.0;

      const leadScale = ctx.createGain();
      leadScale.gain.value = 0.55;
      const harmScale = ctx.createGain();
      harmScale.gain.value = 0.4;

      this.issSubOsc.connect(this.issFilter);
      this.issLeadOsc.connect(leadScale);
      leadScale.connect(this.issFilter);
      this.issHarmonyOsc.connect(harmScale);
      harmScale.connect(this.issFilter);

      this.issFilter.connect(this.issBedGain);
      this.issBedGain.connect(this.dryBus);
      this.issBedGain.connect(this.convolver);

      this.issSubOsc.start();
      this.issLeadOsc.start();
      this.issHarmonyOsc.start();
    }

    if (this.issBedGain) {
      this.issBedGain.gain.setTargetAtTime(0.24, ctx.currentTime, 0.14);
    }
  }

  public updateIssTerminator(input: IssTerminatorInput): void {
    if (!this.ctx || !this.issSubOsc || !this.issLeadOsc || !this.issHarmonyOsc || !this.issFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    const day = Math.max(0, Math.min(1, input.daylightFactor));

    // Smoothly pitch-shift across day/night terminators:
    // Eclipse (0.0) -> warm low C2 (65.4Hz) minor-sixth twilight timbre
    // Terminator (0.5) -> glides upward across fifth
    // Orbital Daylight (1.0) -> bright solar G2/C3 fifth shimmer (+7 semitones shift)
    const rootHz = 65.41 * Math.pow(2, (day * 7) / 12);
    const harmonyRatio = day > 0.48 ? 1.5 : 1.1892; // Major/Fifth in sunlight -> warm minor 3rd in Earth shadow

    this.issSubOsc.frequency.setTargetAtTime(rootHz, now, 0.16);
    this.issLeadOsc.frequency.setTargetAtTime(rootHz * 2, now, 0.16);
    this.issHarmonyOsc.frequency.setTargetAtTime(rootHz * 2 * harmonyRatio, now, 0.18);

    const cutoffHz = 420 + day * 2200;
    this.issFilter.frequency.setTargetAtTime(cutoffHz, now, 0.14);

    if (this.issBedGain) {
      this.issBedGain.gain.setTargetAtTime(0.18 + day * 0.09, now, 0.14);
    }

    // Gentle orbital telemetry beacon pulse every 1.4s
    const nowMs = performance.now();
    if (nowMs - this.lastIssPulseMs > 1400 && this.dryBus && this.convolver) {
      this.lastIssPulseMs = nowMs;
      const pulse = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      pulse.type = 'sine';
      pulse.frequency.setValueAtTime(rootHz * 4, now);
      env.gain.setValueAtTime(0.0001, now);
      env.gain.linearRampToValueAtTime(0.065 + day * 0.04, now + 0.02);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

      pulse.connect(env);
      env.connect(this.dryBus);
      env.connect(this.convolver);
      pulse.start(now);
      pulse.stop(now + 0.6);
    }
  }

  public stopIssOrbit(): void {
    if (this.issBedGain && this.ctx) {
      this.issBedGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    }
  }

  public stopAll(): void {
    this.stopChandraScan();
    this.stopJwstBed();
    this.stopIssOrbit();
  }

  public dispose(): void {
    this.stopAll();
    const oscs = [
      this.chandraBedOsc,
      this.jwstRootOsc,
      this.jwstFifthOsc,
      this.jwstOctaveOsc,
      this.issSubOsc,
      this.issLeadOsc,
      this.issHarmonyOsc,
    ];
    for (const osc of oscs) {
      if (osc) {
        try {
          osc.stop();
          osc.disconnect();
        } catch {
          // Ignore already stopped
        }
      }
    }
    this.chandraBedOsc = null;
    this.jwstRootOsc = null;
    this.jwstFifthOsc = null;
    this.jwstOctaveOsc = null;
    this.issSubOsc = null;
    this.issLeadOsc = null;
    this.issHarmonyOsc = null;

    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
    }
  }
}
