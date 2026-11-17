import type { AudioEvent } from './types';
import { clamp } from './util';

export const SR = 44100;

export function synth(events: AudioEvent[], duration: number, echo = true) {
  const n = Math.ceil(duration * SR);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const TWO_PI = Math.PI * 2;
  for (const e of events) {
    const v = e.v ?? 1;
    const pan = clamp(e.pan ?? 0, -1, 1);
    const gl = Math.cos(((pan + 1) * Math.PI) / 4);
    const gr = Math.sin(((pan + 1) * Math.PI) / 4);
    const start = Math.floor(e.t * SR);
    if (start < 0 || start >= n || !(e.f > 0)) continue;
    const w = (TWO_PI * e.f) / SR;
    let len = 0.5;
    switch (e.voice) {
      case 'marimba': len = 0.9; break;
      case 'bell': len = 1.6; break;
      case 'pluck': len = 0.8; break;
      case 'kalimba': len = 1.05; break;
      case 'celesta': len = 1.45; break;
      case 'rhodes': len = 1.3; break;
      case 'pizzicato': len = 0.65; break;
      case 'click': len = 0.05; break;
      case 'blip': len = 0.2; break;
      case 'thud': len = 0.45; break;
      case 'pad': len = e.d ?? 3; break;
      case 'tick': len = 0.04; break;
    }
    const cnt = Math.min(Math.floor(len * SR), n - start);
    const d = e.d ?? 3;
    for (let i = 0; i < cnt; i++) {
      const tt = i / SR;
      let s = 0;
      switch (e.voice) {
        case 'marimba':
          s = (Math.sin(w * i) * Math.exp(-5 * tt) + 0.35 * Math.sin(w * 3.93 * i) * Math.exp(-24 * tt) + 0.12 * Math.sin(w * 9.1 * i) * Math.exp(-60 * tt)) * 0.6 * Math.min(1, tt * 800);
          break;
        case 'bell':
          s = (Math.sin(w * i) * Math.exp(-3 * tt) + 0.35 * Math.sin(w * 2.01 * i) * Math.exp(-5 * tt) + 0.18 * Math.sin(w * 4.2 * i) * Math.exp(-9 * tt)) * 0.5 * Math.min(1, tt * 800);
          break;
        case 'pluck':
          s = (Math.sin(w * i) * Math.exp(-6 * tt) + 0.45 * Math.sin(w * 2 * i) * Math.exp(-9 * tt) + 0.25 * Math.sin(w * 3 * i) * Math.exp(-12 * tt) + 0.1 * Math.sin(w * 4 * i) * Math.exp(-16 * tt)) * 0.6 * Math.min(1, tt * 800);
          break;
        case 'kalimba':
          s = (Math.sin(w * i) * Math.exp(-4.2 * tt) + 0.28 * Math.sin(w * 2.76 * i) * Math.exp(-18 * tt) + 0.08 * Math.sin(w * 5.4 * i) * Math.exp(-42 * tt)) * 0.68 * Math.min(1, tt * 650);
          break;
        case 'celesta':
          s = (Math.sin(w * i) * Math.exp(-3.4 * tt) + 0.42 * Math.sin(w * 2.0 * i) * Math.exp(-5.8 * tt) + 0.14 * Math.sin(w * 3.98 * i) * Math.exp(-14 * tt)) * 0.52 * Math.min(1, tt * 950);
          break;
        case 'rhodes': {
          const trem = 1 + 0.08 * Math.sin(TWO_PI * 4.2 * tt);
          s = (Math.sin(w * i) * Math.exp(-2.8 * tt) + 0.24 * Math.sin(w * 2 * i) * Math.exp(-5.5 * tt) + 0.3 * Math.sin(w * 4.0 * i) * Math.exp(-22 * tt)) * trem * 0.54 * Math.min(1, tt * 500);
          break;
        }
        case 'pizzicato':
          s = (Math.sin(w * i) * Math.exp(-8.5 * tt) + 0.48 * Math.sin(w * 2.0 * i) * Math.exp(-14 * tt) + 0.22 * Math.sin(w * 3.0 * i) * Math.exp(-24 * tt) + rnd() * Math.exp(-tt * 380) * 0.25) * 0.64 * Math.min(1, tt * 1000);
          break;
        case 'click':
          s = (Math.sin(w * i) * Math.exp(-tt * 350) * 0.7 + rnd() * Math.exp(-tt * 900) * 0.5);
          break;
        case 'blip':
          s = (Math.sin(w * i) * 0.6 + 0.2 * Math.sin(2 * w * i)) * Math.exp(-tt * 16) * Math.min(1, tt * 400);
          break;
        case 'thud':
          s = Math.sin((TWO_PI * e.f * (1 - Math.exp(-4 * tt))) / 4 + 0.5) * Math.exp(-tt * 12) * 0.9;
          break;
        case 'pad': {
          const env = Math.max(0, Math.min(1, tt / 0.5, (d - tt) / 0.8));
          s = (Math.sin(w * i) + 0.5 * Math.sin(w * 2.003 * i) + 0.25 * Math.sin(w * 3.01 * i)) * env * 0.22;
          break;
        }
        case 'tick':
          s = rnd() * Math.exp(-tt * 500) * 0.4 + Math.sin(w * i) * Math.exp(-tt * 150) * 0.4;
          break;
      }
      L[start + i] += s * v * gl;
      R[start + i] += s * v * gr;
    }
  }
  if (echo) {
    const dl = Math.floor(0.21 * SR);
    const dr = Math.floor(0.27 * SR);
    for (let i = dl; i < n; i++) L[i] += 0.16 * L[i - dl];
    for (let i = dr; i < n; i++) R[i] += 0.16 * R[i - dr];
  }
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const k = peak > 0 ? 0.85 / peak : 1;
  const fade = Math.floor(0.3 * SR);
  for (let i = 0; i < n; i++) {
    const f = i > n - fade ? (n - i) / fade : 1;
    L[i] *= k * f;
    R[i] *= k * f;
  }
  return { L, R };
}

export function makeAudioBuffer(events: AudioEvent[], duration: number, echo = true): AudioBuffer {
  const { L, R } = synth(events, duration, echo);
  const ab = new AudioBuffer({ numberOfChannels: 2, length: L.length, sampleRate: SR });
  ab.copyToChannel(L, 0);
  ab.copyToChannel(R, 1);
  return ab;
}
