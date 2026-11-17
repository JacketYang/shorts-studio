import type { AudioEvent, Ctx, Theme } from './types';

export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const TAU = Math.PI * 2;

export function mulberry32(a: number) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash(a: number, b = 0) {
  let h = Math.imul(a + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return ((h >>> 0) % 100000) / 100000;
}

export const hsl = (h: number, s: number, l: number, a = 1) =>
  `hsla(${((h % 360) + 360) % 360},${s}%,${l}%,${a})`;

export const THEMES: Theme[] = [
  {
    name: 'Drafting Paper',
    labelZh: '制图纸白',
    style: 'paper',
    isLight: true,
    bg: ['#F7F4EC', '#EFE9DA'],
    ink: '#1A1917',
    subInk: '#5C564D',
    accentInk: '#B44318',
    muted: 'rgba(26,25,23,0.18)',
    grid: 'rgba(26,25,23,0.055)',
    successInk: '#15803D',
    accent: ['#C2410C', '#1D4ED8', '#0F766E', '#B45309', '#6D28D9', '#BE123C', '#047857', '#374151'],
  },
  {
    name: 'MIT Blueprint',
    labelZh: '工程蓝图',
    style: 'blueprint',
    isLight: false,
    bg: ['#0A192F', '#112240'],
    ink: '#F0F6FF',
    subInk: '#93B4D4',
    accentInk: '#64FFDA',
    muted: 'rgba(147,180,212,0.22)',
    grid: 'rgba(100,255,218,0.065)',
    successInk: '#64FFDA',
    accent: ['#64FFDA', '#38BDF8', '#FBBF24', '#FB7185', '#A78BFA', '#34D399', '#F97316', '#E2E8F0'],
  },
  {
    name: 'Swiss Bauhaus',
    labelZh: '包豪斯',
    style: 'bauhaus',
    isLight: true,
    bg: ['#FAF8F4', '#F1EDE3'],
    ink: '#121212',
    subInk: '#525252',
    accentInk: '#D62828',
    muted: 'rgba(18,18,18,0.17)',
    grid: 'rgba(18,18,18,0.045)',
    successInk: '#166534',
    accent: ['#D62828', '#003049', '#F77F00', '#2A9D8F', '#E09F3E', '#4361EE', '#111111', '#9E2A2B'],
  },
  {
    name: 'Phosphor Scope',
    labelZh: '示波器绿',
    style: 'oscilloscope',
    isLight: false,
    bg: ['#04110B', '#082016'],
    ink: '#DCFCE7',
    subInk: '#86EFAC',
    accentInk: '#4ADE80',
    muted: 'rgba(134,239,172,0.2)',
    grid: 'rgba(74,222,128,0.075)',
    successInk: '#34D399',
    accent: ['#4ADE80', '#22D3EE', '#FACC15', '#A3E635', '#2DD4BF', '#FB923C', '#38BDF8', '#E879F9'],
  },
  {
    name: 'Warm Obsidian',
    labelZh: '暖曜黑金',
    style: 'editorial',
    isLight: false,
    bg: ['#121214', '#1D1B20'],
    ink: '#F5F3EE',
    subInk: '#A8A29E',
    accentInk: '#E5A93C',
    muted: 'rgba(245,243,238,0.18)',
    grid: 'rgba(229,169,60,0.05)',
    successInk: '#6EE7B7',
    accent: ['#E5A93C', '#E07A5F', '#81B29A', '#60A5FA', '#F2CC8F', '#C084FC', '#F472B6', '#38BDF8'],
  },
  {
    name: 'Nordic Slate',
    labelZh: '北欧极简灰',
    style: 'paper',
    isLight: true,
    bg: ['#F1F5F9', '#E2E8F0'],
    ink: '#0F172A',
    subInk: '#475569',
    accentInk: '#0369A1',
    muted: 'rgba(15,23,42,0.18)',
    grid: 'rgba(15,23,42,0.055)',
    successInk: '#15803D',
    accent: ['#0284C7', '#E11D48', '#0D9488', '#D97706', '#4F46E5', '#1E293B', '#059669', '#9333EA'],
  },
  {
    name: 'Botanical Studio',
    labelZh: '博物植物志',
    style: 'bauhaus',
    isLight: true,
    bg: ['#F3F6F0', '#E6ECE1'],
    ink: '#1B2A21',
    subInk: '#4A6052',
    accentInk: '#B45309',
    muted: 'rgba(27,42,33,0.18)',
    grid: 'rgba(27,42,33,0.05)',
    successInk: '#15803D',
    accent: ['#2D6A4F', '#C85A32', '#D97706', '#2B5B84', '#7F4F24', '#6D28D9', '#40916C', '#BC4749'],
  },
  {
    name: 'Concert Velvet',
    labelZh: '音乐厅丝绒',
    style: 'concert',
    isLight: false,
    bg: ['#160E24', '#26173D'],
    ink: '#FAF5FF',
    subInk: '#C4B5FD',
    accentInk: '#FBBF24',
    muted: 'rgba(250,245,255,0.2)',
    grid: 'rgba(251,191,36,0.045)',
    successInk: '#6EE7B7',
    accent: ['#FBBF24', '#F472B6', '#38BDF8', '#34D399', '#A78BFA', '#FB7185', '#2DD4BF', '#FDE68A'],
  },
];

export const pal = (th: Theme, i: number) => th.accent[((i % th.accent.length) + th.accent.length) % th.accent.length];

export function seriesColor(th: Theme, i: number, total: number, preferPalette = false): string {
  if (preferPalette || th.style === 'bauhaus' || th.style === 'paper') {
    return pal(th, i);
  }
  const frac = total > 1 ? i / total : 0.5;
  const hue = (frac * 290 + (th.style === 'blueprint' ? 165 : th.style === 'oscilloscope' ? 115 : 0)) % 360;
  return hsl(hue, th.isLight ? 72 : 82, th.isLight ? 42 : 62);
}

export function halo(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 0.5) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = a;
}

export function ball(ctx: Ctx, x: number, y: number, r: number, color: string, haloR = 2.6, isLight = false) {
  if (isLight) {
    ctx.save();
    ctx.fillStyle = 'rgba(15,23,42,0.14)';
    ctx.beginPath();
    ctx.arc(x + r * 0.14, y + r * 0.18, r * 1.02, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.32, y - r * 0.35, r * 0.08, x, y, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.28, color);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(18,18,18,0.28)';
    ctx.lineWidth = Math.max(1.2, r * 0.1);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (haloR > 0) halo(ctx, x, y, r * Math.min(haloR, 2.0), color, 0.26);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.32, color);
  g.addColorStop(1, color);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

export function rrect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export const FONT = '"Inter","Segoe UI","Helvetica Neue",Arial,"PingFang SC","Microsoft YaHei",sans-serif';

export function text(ctx: Ctx, s: string, x: number, y: number, size: number, color: string, opts: { align?: CanvasTextAlign; weight?: number; alpha?: number } = {}) {
  ctx.save();
  ctx.font = `${opts.weight ?? 800} ${size}px ${FONT}`;
  ctx.textAlign = opts.align ?? 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha *= opts.alpha ?? 1;
  ctx.fillStyle = color;
  ctx.fillText(s, x, y);
  ctx.restore();
}

export const SCALES: { name: string; intervals: number[] }[] = [
  { name: 'Pentatonic', intervals: [0, 2, 4, 7, 9] },
  { name: 'Dorian', intervals: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'Lydian', intervals: [0, 2, 4, 6, 7, 9, 11] },
  { name: 'Natural Minor', intervals: [0, 2, 3, 5, 7, 8, 10] },
  { name: 'Hirajoshi', intervals: [0, 2, 3, 7, 8] },
  { name: 'Mixolydian', intervals: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'Harmonic Minor', intervals: [0, 2, 3, 5, 7, 8, 11] },
  { name: 'Insen', intervals: [0, 1, 5, 7, 10] },
];

export function scaleFreqs(scaleIdx: number, root: number, count: number): number[] {
  const iv = SCALES[((scaleIdx % SCALES.length) + SCALES.length) % SCALES.length].intervals;
  const len = iv.length;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(root * Math.pow(2, (iv[i % len] + 12 * Math.floor(i / len)) / 12));
  }
  return out;
}

export function pentatonic(root: number, count: number): number[] {
  return scaleFreqs(0, root, count);
}

export function ambient(
  rng: () => number,
  dur: number,
  rate: number,
  root = 261.63,
  voice: AudioEvent['voice'] = 'bell',
  scaleIdx = 0
): AudioEvent[] {
  const sc = scaleFreqs(scaleIdx, root / 2, 16);
  const ev: AudioEvent[] = [];
  let idx = 7;
  for (let t = 0.4; t < dur - 1; t += 1 / rate) {
    idx = clamp(idx + Math.floor(rng() * 5) - 2, 0, sc.length - 1);
    ev.push({ t: t + rng() * 0.05, f: sc[idx], voice, v: 0.48, pan: rng() - 0.5 });
  }
  ev.push({ t: 0.1, f: root / 4, voice: 'pad', d: Math.max(2, dur - 0.5), v: 0.42 });
  return ev;
}

/** Binary search: last index i such that arr[i] <= x, -1 if none */
export function lastLE(arr: ArrayLike<number>, x: number) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= x) { ans = m; lo = m + 1; } else hi = m - 1;
  }
  return ans;
}

export const fmtInt = (n: number) => Math.round(n).toLocaleString('en-US');
