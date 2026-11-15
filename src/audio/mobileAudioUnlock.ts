/**
 * Mobile audio unlock + keep-alive.
 *
 * Must be imported FIRST in main.tsx so it can wrap window.AudioContext before
 * Tone.js / the engines create their contexts. It then:
 *  1. Tracks every AudioContext created anywhere in the app (Observatory, Missions, Earth Now/Tone).
 *  2. On every user gesture, resumes any context that is 'suspended' or 'interrupted'
 *     (iOS Safari puts contexts into 'interrupted' after tab switches / calls / backgrounding).
 *  3. Switches iOS to the "playback" audio session so the hardware silent switch does not mute Web Audio
 *     (navigator.audioSession on iOS 17+, plus a looping silent <audio> element for older iOS).
 *  4. Retries resume when the tab becomes visible again.
 */

const contexts = new Set<AudioContext>();

function patchAudioContext(): void {
  const w = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
    __helioPatched?: boolean;
  };
  if (w.__helioPatched) return;
  const Native = w.AudioContext || w.webkitAudioContext;
  if (!Native) return;

  class TrackedAudioContext extends Native {
    constructor(options?: AudioContextOptions) {
      super(options);
      contexts.add(this);
    }
  }
  w.AudioContext = TrackedAudioContext as unknown as typeof AudioContext;
  w.webkitAudioContext = TrackedAudioContext as unknown as typeof AudioContext;
  w.__helioPatched = true;
}

// 0.1 s of silence, 8 kHz mono 8-bit WAV
const SILENT_WAV =
  'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

let silentEl: HTMLAudioElement | null = null;

function startPlaybackSession(): void {
  try {
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
  } catch {
    /* unsupported */
  }
  try {
    if (!silentEl) {
      silentEl = document.createElement('audio');
      silentEl.src = SILENT_WAV;
      silentEl.loop = true;
      silentEl.setAttribute('playsinline', '');
      silentEl.setAttribute('aria-hidden', 'true');
      silentEl.style.display = 'none';
      document.body.appendChild(silentEl);
    }
    if (silentEl.paused) void silentEl.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

function resumeAll(): void {
  contexts.forEach((ctx) => {
    const state = ctx.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      void ctx.resume().catch(() => {});
    }
  });
}

function onGesture(): void {
  startPlaybackSession();
  resumeAll();
}

export function installMobileAudioUnlock(): void {
  if (typeof window === 'undefined') return;
  patchAudioContext();
  ['pointerdown', 'touchstart', 'touchend', 'click', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, onGesture, { capture: true, passive: true })
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeAll();
  });
  window.addEventListener('pageshow', resumeAll);
}

installMobileAudioUnlock();
