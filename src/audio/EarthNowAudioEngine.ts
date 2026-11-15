import * as Tone from 'tone';
import type {
  EarthNowFrame,
  MusicalScaleType,
  SynthVoiceType,
} from '../types/earthNow';

const SCALE_NOTES: Record<MusicalScaleType, readonly string[]> = {
  pentatonic: [
    'C3', 'D3', 'E3', 'G3', 'A3',
    'C4', 'D4', 'E4', 'G4', 'A4',
    'C5', 'D5', 'E5', 'G5', 'A5',
  ],
  dorian: [
    'C3', 'D3', 'Eb3', 'F3', 'G3', 'A3', 'Bb3',
    'C4', 'D4', 'Eb4', 'F4', 'G4', 'A4', 'Bb4',
    'C5',
  ],
  minor: [
    'C3', 'D3', 'Eb3', 'F3', 'G3', 'Ab3', 'Bb3',
    'C4', 'D4', 'Eb4', 'F4', 'G4', 'Ab4', 'Bb4',
    'C5',
  ],
};

interface VoicePreset {
  oscillatorType: 'triangle' | 'sine' | 'sawtooth';
  attack: number;
  decay: number;
  sustain: number;
  release: number;
  filterHz: number;
}

const VOICE_PRESETS: Record<SynthVoiceType, VoicePreset> = {
  triangle: {
    oscillatorType: 'triangle',
    attack: 0.035,
    decay: 0.22,
    sustain: 0.38,
    release: 0.62,
    filterHz: 1950,
  },
  marimba: {
    oscillatorType: 'sine',
    attack: 0.008,
    decay: 0.24,
    sustain: 0.04,
    release: 0.36,
    filterHz: 2600,
  },
  'warm-pad': {
    oscillatorType: 'triangle',
    attack: 0.09,
    decay: 0.34,
    sustain: 0.58,
    release: 0.92,
    filterHz: 1150,
  },
  'plucked-sine': {
    oscillatorType: 'sine',
    attack: 0.006,
    decay: 0.28,
    sustain: 0.10,
    release: 0.48,
    filterHz: 2300,
  },
};

export type FrameChangeCallback = (
  frameIndex: number,
  leftNote: string,
  rightNote: string | null,
  isSpike: boolean
) => void;

export type TrackEndCallback = () => void;

export class EarthNowAudioEngine {
  private masterGain: Tone.Gain | null = null;
  private limiter: Tone.Limiter | null = null;
  private chorus: Tone.Chorus | null = null;
  private reverb: Tone.Reverb | null = null;
  private padSynth: Tone.PolySynth | null = null;

  // Analysers & Recorder
  private fftAnalyser: Tone.Analyser | null = null;
  private waveAnalyser: Tone.Analyser | null = null;
  private recorder: Tone.Recorder | null = null;

  // Primary / Left-ear synth channel
  private leftPanner: Tone.Panner | null = null;
  private leftFilter: Tone.Filter | null = null;
  private leftSynth: Tone.Synth | null = null;

  // Secondary / Right-ear synth channel (used in Stereo Dual-Track mode)
  private rightPanner: Tone.Panner | null = null;
  private rightFilter: Tone.Filter | null = null;
  private rightSynth: Tone.Synth | null = null;

  // Rapid-change harmonic alert bell
  private spikeSynth: Tone.Synth | null = null;

  // Atmospheric Layer 2 (pink noise modulated by bright cloud/highlight cover)
  private cloudNoise: Tone.Noise | null = null;
  private cloudFilter: Tone.Filter | null = null;
  private cloudGain: Tone.Gain | null = null;

  // Tone.Transport + Tone.Loop timing state
  private loop: Tone.Loop | null = null;
  private frames: EarthNowFrame[] = [];
  private rightFrames: EarthNowFrame[] = [];
  private dualTrackEnabled = false;
  private playAllMode = false;

  private scaleType: MusicalScaleType = 'pentatonic';
  private voiceType: SynthVoiceType = 'triangle';
  private spikeAlertsEnabled = true;

  private currentIndex = 0;
  private isPlaying = false;
  private waitingForTrackSwitch = false;
  private isMuted = false;
  private volume = 0.8;
  private secondLayerEnabled = false;
  private stepMs = 420;
  private lastScrubSoundMs = 0;

  private frameListeners = new Set<FrameChangeCallback>();
  private trackEndListeners = new Set<TrackEndCallback>();
  private pendingUiTimers = new Set<number>();
  private initialized = false;
  private isRecording = false;

  public mapBrightnessToNote(normalizedBrightness: number): string {
    const notes = SCALE_NOTES[this.scaleType];
    const clamped = Math.max(0, Math.min(1, normalizedBrightness));
    const idx = Math.min(notes.length - 1, Math.floor(clamped * notes.length));
    return notes[idx];
  }

  private applyVoicePreset(preset: VoicePreset): void {
    if (this.leftSynth) {
      this.leftSynth.set({
        oscillator: { type: preset.oscillatorType },
        envelope: {
          attack: preset.attack,
          decay: preset.decay,
          sustain: preset.sustain,
          release: preset.release,
        },
      });
    }
    if (this.leftFilter) {
      this.leftFilter.frequency.rampTo(preset.filterHz, 0.08);
    }
  }

  private async ensureAudioReady(): Promise<void> {
    await Tone.start();
    const ctx = Tone.getContext();
    if (ctx.state !== 'running') {
      await ctx.resume();
    }
    if (this.initialized) return;

    this.masterGain = new Tone.Gain(this.isMuted ? 0 : this.volume).toDestination();
    this.fftAnalyser = new Tone.Analyser('fft', 128);
    this.waveAnalyser = new Tone.Analyser('waveform', 256);
    this.masterGain.connect(this.fftAnalyser);
    this.masterGain.connect(this.waveAnalyser);

    this.recorder = new Tone.Recorder();
    this.masterGain.connect(this.recorder);

    this.limiter = new Tone.Limiter(-2).connect(this.masterGain);
    this.reverb = new Tone.Reverb({ decay: 2.6, wet: 0.30 }).connect(this.limiter);
    await this.reverb.ready;

    this.chorus = new Tone.Chorus({
      frequency: 1.1,
      delayTime: 3.5,
      depth: 0.35,
      wet: 0.28,
    })
      .connect(this.reverb)
      .start();

    this.padSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.45,
        decay: 0.6,
        sustain: 0.55,
        release: 1.4,
      },
    }).connect(this.reverb);
    this.padSynth.volume.value = -23;

    const preset = VOICE_PRESETS[this.voiceType];

    // Primary / Left channel
    this.leftPanner = new Tone.Panner(this.dualTrackEnabled ? -0.85 : 0).connect(
      this.chorus
    );
    this.leftFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: preset.filterHz,
      rolloff: -12,
    }).connect(this.leftPanner);
    this.leftSynth = new Tone.Synth({
      oscillator: { type: preset.oscillatorType },
      envelope: {
        attack: preset.attack,
        decay: preset.decay,
        sustain: preset.sustain,
        release: preset.release,
      },
    }).connect(this.leftFilter);
    this.leftSynth.volume.value = -7;

    // Right channel (distinct soft sine voice for Stereo Dual-Track comparison)
    this.rightPanner = new Tone.Panner(0.85).connect(this.chorus);
    this.rightFilter = new Tone.Filter({
      type: 'lowpass',
      frequency: 2200,
      rolloff: -12,
    }).connect(this.rightPanner);
    this.rightSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.025,
        decay: 0.2,
        sustain: 0.34,
        release: 0.55,
      },
    }).connect(this.rightFilter);
    this.rightSynth.volume.value = -7;

    // Spike alert harmonic bell
    this.spikeSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: {
        attack: 0.004,
        decay: 0.28,
        sustain: 0.02,
        release: 0.45,
      },
    }).connect(this.reverb);
    this.spikeSynth.volume.value = -13;

    // Layer 2: filtered pink noise modulated by bright highlight/cloud cover
    this.cloudGain = new Tone.Gain(0).connect(this.reverb);
    this.cloudFilter = new Tone.Filter({
      type: 'bandpass',
      frequency: 600,
      Q: 1.4,
    }).connect(this.cloudGain);
    this.cloudNoise = new Tone.Noise('pink').connect(this.cloudFilter);
    this.cloudNoise.start();

    this.initialized = true;
  }

  public setFrames(frames: EarthNowFrame[]): void {
    this.frames = frames;
    if (this.currentIndex >= frames.length) {
      this.currentIndex = 0;
    }
  }

  /**
   * Updates frames without resetting playback cursor or pausing audio (used for live ROI changes).
   */
  public updateFramesInPlace(
    frames: EarthNowFrame[],
    rightFrames?: EarthNowFrame[]
  ): void {
    this.frames = frames;
    if (rightFrames) {
      this.rightFrames = rightFrames;
    }
    if (this.currentIndex >= frames.length) {
      this.currentIndex = 0;
    }
  }

  public setDualTrack(enabled: boolean, rightFrames: EarthNowFrame[] = []): void {
    this.dualTrackEnabled = enabled;
    this.rightFrames = rightFrames;
    if (this.leftPanner) {
      this.leftPanner.pan.rampTo(enabled ? -0.85 : 0, 0.08);
    }
  }

  public setPlayAllMode(enabled: boolean): void {
    this.playAllMode = enabled;
  }

  public setScaleType(scale: MusicalScaleType): void {
    this.scaleType = scale;
  }

  public setVoiceType(voice: SynthVoiceType): void {
    this.voiceType = voice;
    if (this.initialized) {
      this.applyVoicePreset(VOICE_PRESETS[voice]);
    }
  }

  public setSpikeAlertsEnabled(enabled: boolean): void {
    this.spikeAlertsEnabled = enabled;
  }

  public getAnalyserData(): { fft: Float32Array; waveform: Float32Array } {
    if (!this.fftAnalyser || !this.waveAnalyser) {
      return { fft: new Float32Array(0), waveform: new Float32Array(0) };
    }
    const fft = this.fftAnalyser.getValue();
    const waveform = this.waveAnalyser.getValue();
    return {
      fft: fft instanceof Float32Array ? fft : new Float32Array(0),
      waveform: waveform instanceof Float32Array ? waveform : new Float32Array(0),
    };
  }

  public async startRecording(): Promise<void> {
    await this.ensureAudioReady();
    if (!this.recorder || this.isRecording) return;
    this.recorder.start();
    this.isRecording = true;
  }

  public async stopRecording(): Promise<Blob | null> {
    if (!this.recorder || !this.isRecording) return null;
    this.isRecording = false;
    try {
      const recording = await this.recorder.stop();
      return recording;
    } catch {
      return null;
    }
  }

  public onFrameChange(cb: FrameChangeCallback): () => void {
    this.frameListeners.add(cb);
    return () => {
      this.frameListeners.delete(cb);
    };
  }

  public onTrackEnd(cb: TrackEndCallback): () => void {
    this.trackEndListeners.add(cb);
    return () => {
      this.trackEndListeners.delete(cb);
    };
  }

  private emitFrame(
    index: number,
    leftNote: string,
    rightNote: string | null,
    isSpike: boolean
  ): void {
    for (const cb of this.frameListeners) {
      cb(index, leftNote, rightNote, isSpike);
    }
  }

  private emitTrackEnd(): void {
    for (const cb of this.trackEndListeners) {
      cb();
    }
  }

  public async playSingleNote(normalizedBrightness = 0.5): Promise<string> {
    await this.ensureAudioReady();
    const note = this.mapBrightnessToNote(normalizedBrightness);
    this.leftSynth?.triggerAttackRelease(note, '8n');
    return note;
  }

  private isSpikeFrame(index: number): boolean {
    if (index <= 0 || index >= this.frames.length) return false;
    const curr = this.frames[index];
    const prev = this.frames[index - 1];
    const db = Math.abs(curr.normalizedBrightness - prev.normalizedBrightness);
    const dc = Math.abs(curr.normalizedCloudCover - prev.normalizedCloudCover);
    return db >= 0.18 || dc >= 0.24;
  }

  private scheduleFrameAudio(
    index: number,
    time?: number
  ): { leftNote: string; rightNote: string | null; isSpike: boolean } {
    const frame = this.frames[index];
    const leftNote = this.mapBrightnessToNote(frame.normalizedBrightness);
    const noteDur = Math.max(0.18, (this.stepMs / 1000) * 0.92);
    const velocity = 0.42 + frame.normalizedBrightness * 0.45;
    const isSpike = this.isSpikeFrame(index);

    if (this.leftSynth) {
      if (time !== undefined) {
        this.leftSynth.triggerAttackRelease(leftNote, noteDur, time, velocity);
      } else {
        this.leftSynth.triggerAttackRelease(leftNote, noteDur, undefined, velocity);
      }
    }

    if (this.padSynth && index % 4 === 0) {
      const padChord =
        this.scaleType === 'pentatonic' ? ['C2', 'G2', 'D3'] : ['C2', 'G2', 'Bb2'];
      const padDur = Math.max(0.8, (this.stepMs / 1000) * 3.8);
      if (time !== undefined) {
        this.padSynth.triggerAttackRelease(padChord, padDur, time, 0.35);
      }
    }

    if (isSpike && this.spikeAlertsEnabled && this.spikeSynth) {
      const bellNote = frame.normalizedBrightness > 0.5 ? 'E5' : 'C5';
      if (time !== undefined) {
        this.spikeSynth.triggerAttackRelease(bellNote, 0.18, time, 0.42);
      } else {
        this.spikeSynth.triggerAttackRelease(bellNote, 0.18, undefined, 0.42);
      }
    }

    let rightNote: string | null = null;
    if (this.dualTrackEnabled && this.rightFrames.length > 0 && this.rightSynth) {
      const rFrame = this.rightFrames[index % this.rightFrames.length];
      rightNote = this.mapBrightnessToNote(rFrame.normalizedBrightness);
      const rVelocity = 0.4 + rFrame.normalizedBrightness * 0.45;
      if (time !== undefined) {
        this.rightSynth.triggerAttackRelease(rightNote, noteDur, time, rVelocity);
      } else {
        this.rightSynth.triggerAttackRelease(rightNote, noteDur, undefined, rVelocity);
      }
    }

    if (this.cloudGain && this.cloudFilter) {
      const targetGain = this.secondLayerEnabled
        ? 0.03 + frame.normalizedCloudCover * 0.22
        : 0;
      const targetFreq = 320 + frame.normalizedCloudCover * 1900;
      this.cloudGain.gain.rampTo(targetGain, 0.14);
      this.cloudFilter.frequency.rampTo(targetFreq, 0.14);
    }

    return { leftNote, rightNote, isSpike };
  }

  private clearPendingUiTimers(): void {
    for (const tid of this.pendingUiTimers) {
      window.clearTimeout(tid);
    }
    this.pendingUiTimers.clear();
  }

  private startTransportLoop(): void {
    this.disposeLoop();
    this.clearPendingUiTimers();

    const transport = Tone.getTransport();
    const intervalSec = this.stepMs / 1000;

    this.waitingForTrackSwitch = false;

    this.loop = new Tone.Loop((time) => {
      if (!this.isPlaying || this.waitingForTrackSwitch || this.frames.length === 0) return;

      const idx = this.currentIndex;
      const { leftNote, rightNote, isSpike } = this.scheduleFrameAudio(idx, time);

      const reachedEnd = idx >= this.frames.length - 1;
      if (reachedEnd && this.playAllMode && !this.dualTrackEnabled) {
        this.waitingForTrackSwitch = true;
      } else {
        this.currentIndex = (idx + 1) % this.frames.length;
      }

      const delayMs = Math.max(0, (time - Tone.getContext().currentTime) * 1000);
      const timerId = window.setTimeout(() => {
        this.pendingUiTimers.delete(timerId);
        if (!this.isPlaying) return;
        this.emitFrame(idx, leftNote, rightNote, isSpike);
        if (reachedEnd && this.playAllMode && !this.dualTrackEnabled) {
          this.isPlaying = false;
          this.disposeLoop();
          transport.stop();
          this.emitTrackEnd();
        }
      }, delayMs);
      this.pendingUiTimers.add(timerId);
    }, intervalSec);

    transport.stop();
    transport.cancel(0);
    transport.position = 0;
    this.loop.start(0);
    transport.start();
  }

  private disposeLoop(): void {
    if (this.loop) {
      this.loop.stop();
      this.loop.dispose();
      this.loop = null;
    }
  }

  public async play(): Promise<void> {
    if (this.frames.length === 0) return;
    await this.ensureAudioReady();
    if (this.isPlaying) return;

    this.isPlaying = true;
    this.startTransportLoop();
  }

  public pause(): void {
    this.isPlaying = false;
    this.waitingForTrackSwitch = false;
    this.clearPendingUiTimers();
    this.disposeLoop();
    Tone.getTransport().stop();
    if (this.cloudGain) {
      this.cloudGain.gain.rampTo(0, 0.12);
    }
  }

  public async seek(index: number, playPreviewNote = false): Promise<string> {
    if (this.frames.length === 0) return 'C4';
    const safeIdx = Math.max(0, Math.min(this.frames.length - 1, Math.round(index)));
    this.currentIndex = safeIdx;

    const frame = this.frames[safeIdx];
    const leftNote = this.mapBrightnessToNote(frame.normalizedBrightness);
    const rightNote =
      this.dualTrackEnabled && this.rightFrames.length > 0
        ? this.mapBrightnessToNote(
            this.rightFrames[safeIdx % this.rightFrames.length].normalizedBrightness
          )
        : null;
    const isSpike = this.isSpikeFrame(safeIdx);

    this.emitFrame(safeIdx, leftNote, rightNote, isSpike);

    if (!this.isPlaying && playPreviewNote) {
      const now = performance.now();
      if (now - this.lastScrubSoundMs > 110) {
        this.lastScrubSoundMs = now;
        await this.ensureAudioReady();
        this.scheduleFrameAudio(safeIdx);
      }
    }

    return leftNote;
  }

  public setStepIntervalMs(ms: number): void {
    this.stepMs = Math.max(150, Math.min(1200, ms));
    if (this.isPlaying) {
      this.startTransportLoop();
    }
  }

  public setSecondLayerEnabled(enabled: boolean): void {
    this.secondLayerEnabled = enabled;
    if (!enabled && this.cloudGain) {
      this.cloudGain.gain.rampTo(0, 0.12);
    } else if (enabled && this.isPlaying && this.frames[this.currentIndex]) {
      const frame = this.frames[this.currentIndex];
      this.cloudGain?.gain.rampTo(0.03 + frame.normalizedCloudCover * 0.22, 0.14);
    }
  }

  public setVolume(volume01: number): void {
    this.volume = Math.max(0, Math.min(1, volume01));
    if (this.masterGain) {
      this.masterGain.gain.rampTo(this.isMuted ? 0 : this.volume, 0.04);
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain) {
      this.masterGain.gain.rampTo(muted ? 0 : this.volume, 0.04);
    }
  }

  public dispose(): void {
    this.pause();
    if (this.isRecording) {
      void this.stopRecording();
    }
    this.leftSynth?.dispose();
    this.leftFilter?.dispose();
    this.leftPanner?.dispose();
    this.rightSynth?.dispose();
    this.rightFilter?.dispose();
    this.rightPanner?.dispose();
    this.spikeSynth?.dispose();
    this.padSynth?.dispose();
    this.chorus?.dispose();
    this.reverb?.dispose();
    this.limiter?.dispose();
    this.cloudNoise?.dispose();
    this.cloudFilter?.dispose();
    this.cloudGain?.dispose();
    this.fftAnalyser?.dispose();
    this.waveAnalyser?.dispose();
    this.recorder?.dispose();
    this.masterGain?.dispose();
    this.initialized = false;
  }
}
