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
  { name: 'Neon Night', bg: ['#0a0a1f', '#2a0f4d'], ink: '#ffffff', accent: ['#ff4d6d', '#ffb703', '#fee440', '#80ed99', '#4cc9f0', '#4895ef', '#b5179e', '#f15bb5'] },
  { name: 'Deep Ocean', bg: ['#021a2e', '#06506f'], ink: '#e8fbff', accent: ['#ff6b6b', '#ffd166', '#06d6a0', '#118ab2', '#8ecae6', '#ef476f', '#c77dff', '#9bf6ff'] },
  { name: 'Sunset', bg: ['#2b0f3a', '#8a2250'], ink: '#fff4e6', accent: ['#ffbe0b', '#fb5607', '#ff006e', '#8338ec', '#3a86ff', '#ff9e00', '#ffd6a5', '#f72585'] },
  { name: 'Emerald', bg: ['#04180f', '#0f4a35'], ink: '#eafff4', accent: ['#b7e4c7', '#74c69d', '#52b788', '#ffd166', '#ef476f', '#90e0ef', '#f4a261', '#caffbf'] },
  { name: 'Black Gold', bg: ['#0a0a0a', '#2b2006'], ink: '#fff7d6', accent: ['#ffd60a', '#ffc300', '#ffb703', '#fb8500', '#ffe066', '#f4a261', '#e9c46a', '#fff3b0'] },
  { name: 'Candy', bg: ['#1b0c33', '#4a1d6e'], ink: '#fff0fb', accent: ['#ff99c8', '#fcf6bd', '#d0f4de', '#a9def9', '#e4c1f9', '#ffb5a7', '#c3f0ca', '#ffd6e0'] },
  { name: 'Cyber', bg: ['#040714', '#073a52'], ink: '#e6fffb', accent: ['#00f5d4', '#00bbf9', '#9b5de5', '#f15bb5', '#fee440', '#ff595e', '#8ac926', '#1982c4'] },
  { name: 'Slate', bg: ['#0e141b', '#2c3a4a'], ink: '#f1f5f9', accent: ['#f87171', '#fbbf24', '#34d399', '#60a5fa', '#a78bfa', '#f472b6', '#fb923c', '#2dd4bf'] },
];

export const pal = (th: Theme, i: number) => th.accent[((i % th.accent.length) + th.accent.length) % th.accent.length];

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

export function ball(ctx: Ctx, x: number, y: number, r: number, color: string, haloR = 2.6) {
  if (haloR > 0) halo(ctx, x, y, r * haloR, color, 0.45);
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.35, color);
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

export function pentatonic(root: number, count: number): number[] {
  const iv = [0, 2, 4, 7, 9];
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(root * Math.pow(2, (iv[i % 5] + 12 * Math.floor(i / 5)) / 12));
  return out;
}

export function ambient(rng: () => number, dur: number, rate: number, root = 261.63, voice: AudioEvent['voice'] = 'bell'): AudioEvent[] {
  const sc = pentatonic(root / 2, 15);
  const ev: AudioEvent[] = [];
  let idx = 7;
  for (let t = 0.4; t < dur - 1; t += 1 / rate) {
    idx = clamp(idx + Math.floor(rng() * 5) - 2, 0, 14);
    ev.push({ t: t + rng() * 0.05, f: sc[idx], voice, v: 0.5, pan: rng() - 0.5 });
  }
  ev.push({ t: 0.1, f: root / 4, voice: 'pad', d: Math.max(2, dur - 0.5), v: 0.5 });
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
