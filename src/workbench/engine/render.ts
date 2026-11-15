import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  WebMOutputFormat,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import { drawFrame } from './frame';
import { makeAudioBuffer, SR } from './audio';
import type { Scene, Theme } from './types';
import { H, W } from './types';

export interface RenderOpts {
  width: number;
  height: number;
  fps: number;
  bitrate: number;
  onProgress: (p: number, stage: string) => void;
  token: { cancelled: boolean };
}

export interface RenderResult {
  blob: Blob;
  ext: 'mp4' | 'webm';
  note: string;
}

const yieldUI = () =>
  new Promise<void>((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => resolve();
    ch.port2.postMessage(0);
  });

export function webCodecsAvailable() {
  return typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
}

export async function renderVideo(scene: Scene, theme: Theme, hook: string, o: RenderOpts): Promise<RenderResult> {
  o.onProgress(0, '合成音频');
  await yieldUI();
  const audio = makeAudioBuffer(scene.audio, scene.duration, scene.echo ?? true);
  if (webCodecsAvailable()) {
    try {
      return await encodeWebCodecs(scene, theme, hook, audio, o);
    } catch (e) {
      if ((e as Error).message === 'cancelled') throw e;
      console.warn('WebCodecs 失败，改用实时录制', e);
    }
  }
  return recordRealtime(scene, theme, hook, audio, o);
}

function makeCanvas(o: RenderOpts) {
  const canvas = document.createElement('canvas');
  canvas.width = o.width;
  canvas.height = o.height;
  const ctx = canvas.getContext('2d', { alpha: false })!;
  return { canvas, ctx };
}

async function encodeWebCodecs(scene: Scene, theme: Theme, hook: string, audio: AudioBuffer, o: RenderOpts): Promise<RenderResult> {
  const { canvas, ctx } = makeCanvas(o);
  const combos: { fmt: 'mp4' | 'webm'; v: string[]; a: string[] }[] = [
    { fmt: 'mp4', v: ['avc', 'vp9', 'av1', 'hevc'], a: ['aac', 'opus', 'mp3'] },
    { fmt: 'webm', v: ['vp9', 'vp8', 'av1'], a: ['opus', 'vorbis'] },
  ];
  let chosen: { fmt: 'mp4' | 'webm'; vc: string; ac: string } | null = null;
  for (const c of combos) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vc = await getFirstEncodableVideoCodec(c.v as any, { width: o.width, height: o.height, bitrate: o.bitrate });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ac = await getFirstEncodableAudioCodec(c.a as any, { numberOfChannels: 2, sampleRate: SR, bitrate: 128e3 });
    if (vc && ac) {
      chosen = { fmt: c.fmt, vc, ac };
      break;
    }
  }
  if (!chosen) throw new Error('no encodable codec');
  const output = new Output({
    format: chosen.fmt === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(),
    target: new BufferTarget(),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vs = new CanvasSource(canvas, { codec: chosen.vc as any, bitrate: o.bitrate, keyFrameInterval: 2 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const as = new AudioBufferSource({ codec: chosen.ac as any, bitrate: 128e3 });
  output.addVideoTrack(vs, { frameRate: o.fps });
  output.addAudioTrack(as);
  await output.start();
  o.onProgress(0.02, '编码音频');
  await as.add(audio);
  const total = Math.round(scene.duration * o.fps);
  ctx.setTransform(o.width / W, 0, 0, o.height / H, 0, 0);
  for (let i = 0; i < total; i++) {
    if (o.token.cancelled) {
      await output.cancel();
      throw new Error('cancelled');
    }
    ctx.save();
    drawFrame(ctx, scene, theme, hook, i / o.fps);
    ctx.restore();
    await vs.add(i / o.fps, 1 / o.fps);
    if (i % 5 === 0) {
      o.onProgress(0.05 + 0.93 * (i / total), '渲染画面');
      await yieldUI();
    }
  }
  o.onProgress(0.98, '封装文件');
  await output.finalize();
  const buf = output.target.buffer!;
  const ext = chosen.fmt;
  return {
    blob: new Blob([buf], { type: ext === 'mp4' ? 'video/mp4' : 'video/webm' }),
    ext,
    note: `${chosen.fmt.toUpperCase()} · ${chosen.vc}/${chosen.ac}`,
  };
}

async function recordRealtime(scene: Scene, theme: Theme, hook: string, audio: AudioBuffer, o: RenderOpts): Promise<RenderResult> {
  const { canvas, ctx } = makeCanvas(o);
  ctx.setTransform(o.width / W, 0, 0, o.height / H, 0, 0);
  const cands = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const mime = cands.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error('当前浏览器不支持视频导出，请使用最新版 Chrome / Edge');
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ac = new AC();
  await ac.resume();
  const dest = ac.createMediaStreamDestination();
  const src = ac.createBufferSource();
  src.buffer = audio;
  src.connect(dest);
  const stream = canvas.captureStream(o.fps);
  dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: o.bitrate, audioBitsPerSecond: 128000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((res) => (rec.onstop = () => res()));
  rec.start(500);
  const t0 = performance.now();
  src.start();
  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = (performance.now() - t0) / 1000;
      if (o.token.cancelled || t >= scene.duration) {
        resolve();
        return;
      }
      ctx.save();
      drawFrame(ctx, scene, theme, hook, t);
      ctx.restore();
      o.onProgress(t / scene.duration, '实时录制中（请保持页面在前台）');
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop();
  await done;
  ac.close();
  if (o.token.cancelled) throw new Error('cancelled');
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob: new Blob(chunks, { type: mime.split(';')[0] }), ext, note: `实时录制 ${mime.split(';')[0]}` };
}
