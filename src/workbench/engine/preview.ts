import { drawFrame } from './frame';
import { makeAudioBuffer } from './audio';
import type { Scene, Theme } from './types';
import { H, W } from './types';

export interface PreviewHandle {
  stop: () => void;
}

/** 在 canvas 上循环预览（带声音） */
export function startPreview(canvas: HTMLCanvasElement, scene: Scene, theme: Theme, hook: string, withSound: boolean): PreviewHandle {
  const ctx = canvas.getContext('2d')!;
  let stopped = false;
  let ac: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;
  let t0 = performance.now();
  let buf: AudioBuffer | null = null;
  const startAudio = () => {
    if (!withSound || !buf) return;
    try {
      src?.stop();
    } catch { /* noop */ }
    ac = ac ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    ac.resume();
    src = ac.createBufferSource();
    src.buffer = buf;
    src.connect(ac.destination);
    src.start();
  };
  if (withSound) {
    buf = makeAudioBuffer(scene.audio, scene.duration, scene.echo ?? true);
    startAudio();
  }
  t0 = performance.now();
  const loop = () => {
    if (stopped) return;
    let t = (performance.now() - t0) / 1000;
    if (t > scene.duration + 0.6) {
      t0 = performance.now();
      t = 0;
      startAudio();
    }
    ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
    ctx.save();
    drawFrame(ctx, scene, theme, hook, Math.min(t, scene.duration));
    ctx.restore();
    requestAnimationFrame(loop);
  };
  loop();
  return {
    stop() {
      stopped = true;
      try {
        src?.stop();
      } catch { /* noop */ }
      ac?.close();
    },
  };
}

export function drawStill(canvas: HTMLCanvasElement, scene: Scene, theme: Theme, hook: string, t: number) {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  ctx.save();
  drawFrame(ctx, scene, theme, hook, t);
  ctx.restore();
}
