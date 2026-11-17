import type { Voice } from './types.ts';

export const MELODY_ENGINES = new Set(['hop', 'rain', 'ring', 'multiply']);

export const TEMPO_SCALE_PRESETS: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75];

export const VOICE_OPTIONS: ReadonlyArray<{ id: Voice; labelZh: string }> = [
  { id: 'marimba', labelZh: '马林巴木琴 (Marimba)' },
  { id: 'kalimba', labelZh: '拇指琴 (Kalimba)' },
  { id: 'celesta', labelZh: '玻璃钢片琴 (Celesta)' },
  { id: 'rhodes', labelZh: '温暖电钢 (Rhodes)' },
  { id: 'bell', labelZh: '教堂管钟 (Bell)' },
  { id: 'pizzicato', labelZh: '弦乐拨奏 (Pizzicato)' },
  { id: 'pluck', labelZh: '原声拨弦 (Pluck)' },
  { id: 'click', labelZh: '清脆木击 (Click)' },
  { id: 'blip', labelZh: '合成脉冲 (Blip)' },
  { id: 'thud', labelZh: '低频共振鼓 (Thud)' },
  { id: 'pad', labelZh: '空间铺底音 (Pad)' },
  { id: 'tick', labelZh: '精密滴答 (Tick)' },
];

export const SCALE_OPTIONS: ReadonlyArray<{ id: number; labelZh: string }> = [
  { id: 0, labelZh: 'C 大调五声音阶 (Pentatonic)' },
  { id: 1, labelZh: '多利亚调式 (Dorian)' },
  { id: 2, labelZh: '利底亚明亮调式 (Lydian)' },
  { id: 3, labelZh: '自然小调 (Natural Minor)' },
  { id: 4, labelZh: '日本平调子五声 (Hirajoshi)' },
  { id: 5, labelZh: '混合利底亚 (Mixolydian)' },
  { id: 6, labelZh: '和声小调 (Harmonic Minor)' },
  { id: 7, labelZh: '阴旋五声 (Insen)' },
];

export function clampTempoScale(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1;
  return Math.round(Math.max(0.5, Math.min(2.5, value)) * 100) / 100;
}
