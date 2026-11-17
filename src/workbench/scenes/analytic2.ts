import type { AudioEvent, Builder, Ctx, Theme } from '../engine/types';
import { TAU, ambient, ball, clamp, halo, hsl, pal, scaleFreqs, text } from '../engine/util';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const CX = 540, CY = 880;

function strokePath(
  ctx: Ctx,
  theme: Theme,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  upto: number,
  hue0: number,
  span: number,
  lw: number,
  chunk = 36
) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const M = xs.length;
  const sat = theme.isLight ? 74 : 88;
  const lig = theme.isLight ? 42 : 62;
  for (let s = 0; s < upto; s += chunk) {
    const e = Math.min(upto, s + chunk + 1);
    ctx.strokeStyle =
      theme.style === 'paper' || theme.style === 'bauhaus'
        ? pal(theme, Math.floor((s / Math.max(1, M)) * theme.accent.length))
        : hsl(hue0 + (s / M) * span, sat, lig);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(xs[s], ys[s]);
    for (let i = s + 1; i <= e && i < M; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
  }
}

function musicEvents(times: number[], voice: AudioEvent['voice'], root = 261.63, scaleIdx = 0): AudioEvent[] {
  const sc = scaleFreqs(scaleIdx, root, 10);
  const ev: AudioEvent[] = [];
  times.forEach((t, j) => {
    const m = j % 18;
    const idx = m < 10 ? m : 18 - m;
    ev.push({ t, f: sc[idx % sc.length], voice, v: 0.55, pan: ((j % 7) - 3) / 8 });
  });
  return ev;
}

/* ---------- Spirograph (hypotrochoid) & rose curves ---------- */
export const buildSpiro: Builder = (c, p) => {
  const theme = c.theme;
  const dur: number = p.dur ?? 24;
  const mode: 'hypo' | 'rose' = p.mode ?? 'hypo';
  const xs: number[] = [], ys: number[] = [];
  let deco: (ctx: Ctx, u: number) => void;
  const evT: number[] = [];
  let label = '';
  if (mode === 'hypo') {
    const R: number = p.R, r: number = p.r, dd: number = p.d * r;
    const g = gcd(R, r);
    const tEnd = (TAU * r) / g;
    const lobes = R / g;
    const sc = 420 / Math.max(R, R - r + dd);
    const M = clamp(Math.ceil(tEnd * (R / r) * 30), 1500, 9000);
    const pt = (t: number): [number, number] => [
      CX + sc * ((R - r) * Math.cos(t) + dd * Math.cos(((R - r) / r) * t)),
      CY + sc * ((R - r) * Math.sin(t) - dd * Math.sin(((R - r) / r) * t)),
    ];
    for (let i = 0; i <= M; i++) { const [x, y] = pt((i / M) * tEnd); xs.push(x); ys.push(y); }
    const sub = Math.max(1, Math.ceil(30 / lobes));
    for (let j = 0; j < lobes * sub; j++) evT.push(0.5 + (j / (lobes * sub)) * (dur - 0.5));
    label = `${lobes} petals`;
    deco = (ctx, u) => {
      const t = u * tEnd;
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(CX, CY, R * sc, 0, TAU);
      ctx.stroke();
      const gx = CX + sc * (R - r) * Math.cos(t), gy = CY + sc * (R - r) * Math.sin(t);
      ctx.save();
      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = theme.subInk;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(gx, gy, r * sc, 0, TAU);
      ctx.stroke();
      const [px, py] = pt(t);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
      ball(ctx, px, py, 13, theme.accentInk, 2.0, theme.isLight);
    };
  } else {
    const nn: number = p.n, d: number = p.dn;
    const k = nn / d;
    const thEnd = (nn * d) % 2 === 1 ? Math.PI * d : TAU * d;
    const petals = (nn * d) % 2 === 1 ? nn : 2 * nn;
    const M = clamp(Math.ceil(thEnd * 260), 2000, 9000);
    const pt = (th: number): [number, number] => { const rho = Math.cos(k * th); return [CX + 430 * rho * Math.cos(th), CY + 430 * rho * Math.sin(th)]; };
    for (let i = 0; i <= M; i++) { const [x, y] = pt((i / M) * thEnd); xs.push(x); ys.push(y); }
    const sub = Math.max(1, Math.ceil(30 / petals));
    for (let j = 0; j < petals * sub; j++) evT.push(0.5 + (j / (petals * sub)) * (dur - 0.5));
    label = `${petals} petals`;
    deco = (ctx, u) => {
      const [px, py] = pt(u * thEnd);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = theme.subInk;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
      ball(ctx, px, py, 13, theme.accentInk, 2.0, theme.isLight);
    };
  }
  const voice: AudioEvent['voice'] = p.voice ?? 'kalimba';
  const audio = [...musicEvents(evT, voice, 261.63, p.scale ?? 0), { t: 0.1, f: 98, voice: 'pad', d: dur + 2, v: 0.42 } as AudioEvent];
  return {
    duration: dur + 2.8,
    audio,
    draw(ctx, t) {
      const u = clamp(t / dur, 0, 1);
      const M = xs.length - 1;
      const upto = Math.floor(u * M);
      if (!theme.isLight) {
        ctx.globalAlpha = 0.2;
        strokePath(ctx, theme, xs, ys, upto, t * 14, 320, 22, 60);
        ctx.globalAlpha = 1;
      }
      strokePath(ctx, theme, xs, ys, upto, t * 14, 320, theme.isLight ? 8 : 10, 36);
      deco(ctx, u);
      if (u >= 1) text(ctx, label.toUpperCase(), 540, 1560, 86, theme.ink, { alpha: clamp((t - dur) / 0.6, 0, 1) });
      else text(ctx, mode === 'hypo' ? `R = ${p.R}   r = ${p.r}` : `r = cos(${p.n}/${p.dn} · θ)`, 540, 1560, 52, theme.accentInk);
    },
  };
};

/* ---------- Lissajous ---------- */
const INTERVALS: Record<string, string> = { '1:2': 'octave', '2:3': 'perfect fifth', '3:4': 'perfect fourth', '4:5': 'major third', '3:5': 'major sixth', '5:6': 'minor third', '5:8': 'minor sixth', '1:3': 'octave + fifth', '4:7': '', '2:5': 'major tenth' };

export const buildLissa: Builder = (c, p) => {
  const theme = c.theme;
  const a: number = p.a, b: number = p.b;
  const dur: number = p.dur ?? 24;
  const layers: number = p.layers ?? 2;
  const M = 700;
  const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
  const voice: AudioEvent['voice'] = p.voice ?? 'rhodes';
  const audio = [
    ...ambient(c.rng, dur + 2, 2.2, 261.63, voice, p.scale ?? 1),
    { t: 0.2, f: 55 * a, voice: 'pad', d: dur + 2, v: 0.45 } as AudioEvent,
    { t: 0.2, f: 55 * b, voice: 'pad', d: dur + 2, v: 0.45 } as AudioEvent,
  ];
  return {
    duration: dur + 1,
    audio,
    draw(ctx, t) {
      const delta = (TAU * t) / dur;
      for (let L = 0; L < layers; L++) {
        const xs: number[] = [], ys: number[] = [];
        for (let i = 0; i <= M; i++) {
          const th = (i / M) * TAU;
          xs.push(CX + 410 * Math.sin(a * th + delta + L * 0.35));
          ys.push(CY + 440 * Math.sin(b * th));
        }
        if (!theme.isLight) {
          ctx.globalAlpha = 0.16;
          strokePath(ctx, theme, xs, ys, M, t * 18 + L * 90, 200, 20, 100);
          ctx.globalAlpha = 1;
        }
        strokePath(ctx, theme, xs, ys, M, t * 18 + L * 90, 200, theme.isLight ? 5.5 : 6, 100);
      }
      text(ctx, `${a} : ${b}`, 540, 1560, 145, theme.ink, { alpha: 0.95 });
      text(ctx, INTERVALS[key] ? `frequency ratio = ${INTERVALS[key]}` : 'frequency ratio', 540, 1670, 40, theme.accentInk, { weight: 600 });
    },
  };
};

/* ---------- Epicycles drawing a shape (Fourier) ---------- */
type Shape = (u: number) => [number, number];
const SHAPES: Record<string, Shape> = {
  heart: (u) => { const t = TAU * u; return [16 * Math.pow(Math.sin(t), 3), -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]; },
  infinity: (u) => { const t = TAU * u; const d = 1 + Math.sin(t) ** 2; return [Math.cos(t) / d, (Math.sin(t) * Math.cos(t)) / d]; },
  star: (u) => {
    const s = u * 5, i = Math.floor(s) % 5, f = s - Math.floor(s);
    const v = (k: number): [number, number] => { const a = -Math.PI / 2 + ((k * 2) % 5) * (TAU / 5); return [Math.cos(a), Math.sin(a)]; };
    const A = v(i), B = v(i + 1);
    return [A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f];
  },
  trefoil: (u) => { const t = TAU * u; return [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t)]; },
  butterfly: (u) => { const th = 12 * Math.PI * u; const rho = Math.exp(Math.sin(th)) - 2 * Math.cos(4 * th) + Math.pow(Math.sin((2 * th - Math.PI) / 24), 5); return [rho * Math.sin(th), -rho * Math.cos(th)]; },
  clover: (u) => { const t = TAU * u; const r = Math.cos(2 * t); return [r * Math.cos(t), r * Math.sin(t)]; },
  wave: (u) => { const t = TAU * u; return [Math.cos(t) * (1 + 0.35 * Math.cos(7 * t)), Math.sin(t) * (1 + 0.35 * Math.cos(7 * t))]; },
};

export const buildEpicycle: Builder = (c, p) => {
  const theme = c.theme;
  const dur: number = p.dur ?? 26;
  const keep: number = p.terms ?? 70;
  const shape = SHAPES[p.shape];
  const M0 = 512;
  const pts: [number, number][] = [];
  for (let j = 0; j < M0; j++) pts.push(shape(j / M0));
  let cx = 0, cy = 0;
  pts.forEach(([x, y]) => { cx += x; cy += y; });
  cx /= M0; cy /= M0;
  let mx = 0;
  pts.forEach(([x, y]) => { mx = Math.max(mx, Math.abs(x - cx), Math.abs(y - cy)); });
  const sc = 400 / mx;
  const terms: { k: number; re: number; im: number; amp: number }[] = [];
  for (let k = -M0 / 2; k < M0 / 2; k++) {
    let re = 0, im = 0;
    for (let j = 0; j < M0; j++) {
      const ang = (-TAU * k * j) / M0;
      const zx = (pts[j][0] - cx) * sc, zy = (pts[j][1] - cy) * sc;
      re += zx * Math.cos(ang) - zy * Math.sin(ang);
      im += zx * Math.sin(ang) + zy * Math.cos(ang);
    }
    re /= M0; im /= M0;
    terms.push({ k, re, im, amp: Math.hypot(re, im) });
  }
  terms.sort((a, b) => b.amp - a.amp);
  const use = terms.slice(0, keep);
  const S = 1800;
  const xs: number[] = [], ys: number[] = [];
  const at = (tau: number, chain?: [number, number][]): [number, number] => {
    let x = CX, y = CY;
    for (const tm of use) {
      const a = TAU * tm.k * tau;
      x += tm.re * Math.cos(a) - tm.im * Math.sin(a);
      y += tm.re * Math.sin(a) + tm.im * Math.cos(a);
      chain?.push([x, y]);
    }
    return [x, y];
  };
  for (let s = 0; s <= S; s++) { const [x, y] = at(s / S); xs.push(x); ys.push(y); }
  const voice: AudioEvent['voice'] = p.voice ?? 'celesta';
  const audio = ambient(c.rng, dur + 2, 2.4, 261.63, voice, p.scale ?? 2);
  return {
    duration: dur + 3,
    audio,
    draw(ctx, t) {
      const u = clamp(t / dur, 0, 1);
      const upto = Math.floor(u * S);
      const hue = (p.hue ?? 330) as number;
      if (u >= 1) {
        ctx.globalAlpha = clamp((t - dur) / 1.2, 0, 1) * (theme.isLight ? 0.16 : 0.24);
        ctx.fillStyle = theme.accent[0];
        ctx.beginPath();
        xs.forEach((x, i) => (i ? ctx.lineTo(x, ys[i]) : ctx.moveTo(x, ys[i])));
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (!theme.isLight) {
        ctx.globalAlpha = 0.22;
        strokePath(ctx, theme, xs, ys, upto, hue, 80, 18, 60);
        ctx.globalAlpha = 1;
      }
      strokePath(ctx, theme, xs, ys, upto, hue, 80, 7, 36);
      if (u < 1) {
        const chain: [number, number][] = [];
        const [px, py] = at(u, chain);
        let prevX = CX, prevY = CY;
        ctx.lineWidth = 1.5;
        chain.forEach(([x, y], i) => {
          const r = Math.hypot(x - prevX, y - prevY);
          ctx.save();
          ctx.globalAlpha = i < 12 ? 0.45 : 0.2;
          ctx.strokeStyle = theme.subInk;
          if (r > 2) { ctx.beginPath(); ctx.arc(prevX, prevY, r, 0, TAU); ctx.stroke(); }
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
          ctx.restore();
          prevX = x; prevY = y;
        });
        ball(ctx, px, py, 12, theme.accentInk, 2.0, theme.isLight);
      } else if (!theme.isLight) {
        halo(ctx, CX, CY, 480, theme.accent[0], 0.1 * clamp((t - dur) / 1.2, 0, 1));
      }
      text(ctx, `${use.length} rotating circles`, 540, 1600, 54, theme.ink, { alpha: 0.9 });
      text(ctx, 'Fourier series reconstruction', 540, 1690, 36, theme.accentInk, { weight: 600 });
    },
  };
};

/* ---------- Times table on a circle (cardioid → nephroid → ...) ---------- */
export const buildTimes: Builder = (c, p) => {
  const theme = c.theme;
  const N: number = p.n ?? 200;
  const k0 = 2;
  const k1: number = p.k1 ?? 10;
  const dur: number = p.dur ?? 26;
  const R = 430;
  const P = (i: number): [number, number] => { const a = -Math.PI / 2 + (i / N) * TAU; return [CX + R * Math.cos(a), CY + R * Math.sin(a)]; };
  const audio: AudioEvent[] = [];
  const sc = scaleFreqs(p.scale ?? 0, 261.63, 12);
  const voice: AudioEvent['voice'] = p.voice ?? 'celesta';
  for (let k = 2; k <= k1; k++) audio.push({ t: ((k - k0) / (k1 - k0)) * dur + 0.1, f: sc[(k - 2) % sc.length], voice, v: 0.65 });
  audio.push({ t: 0.1, f: 98, voice: 'pad', d: dur + 2, v: 0.4 });
  audio.push({ t: 0.1, f: 147, voice: 'pad', d: dur + 2, v: 0.35 });
  for (let t = 0.5; t < dur; t += 0.5) audio.push({ t, f: sc[Math.floor(((t / dur) * 20 + (t * 3) % 3)) % sc.length] * 2, voice: 'blip', v: 0.15 });
  return {
    duration: dur + 1.5,
    audio,
    draw(ctx, t) {
      const k = k0 + (k1 - k0) * clamp(t / dur, 0, 1);
      ctx.lineWidth = 2.0;
      const usePal = theme.style === 'paper' || theme.style === 'bauhaus';
      for (let i = 0; i < N; i++) {
        const [x0, y0] = P(i);
        const [x1, y1] = P(((k * i) % N + N) % N);
        ctx.save();
        ctx.globalAlpha = theme.isLight ? 0.52 : 0.46;
        ctx.strokeStyle = usePal
          ? pal(theme, i)
          : hsl((i / N) * 320 + t * 12, theme.isLight ? 72 : 84, theme.isLight ? 42 : 62);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        ctx.restore();
      }
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(CX, CY, R, 0, TAU);
      ctx.stroke();
      const near = Math.abs(k - Math.round(k)) < 0.04;
      text(ctx, `× ${k.toFixed(2)}`, 540, 1520, 136, theme.ink);
      text(ctx, near ? (Math.round(k) === 2 ? 'CARDIOID' : Math.round(k) === 3 ? 'NEPHROID' : `${Math.round(k) - 1} CUSPS`) : `${N} points · i → k·i`, 540, 1650, 48, near ? theme.successInk : theme.accentInk);
    },
  };
};

/* ---------- Phyllotaxis / golden angle ---------- */
export const buildPhyllo: Builder = (c, p) => {
  const theme = c.theme;
  const N: number = p.n ?? 1400;
  const dur: number = p.dur ?? 24;
  const mode: 'grow' | 'sweep' = p.mode ?? 'grow';
  const a0: number = p.a0 ?? 137.3;
  const a1: number = p.a1 ?? 137.7;
  const GOLD = 137.50776405;
  const cr = 430 / Math.sqrt(N);
  const voice: AudioEvent['voice'] = p.voice ?? 'pizzicato';
  const audio = ambient(c.rng, dur + 2, 2.2, 261.63, voice, p.scale ?? 4);
  if (mode === 'grow') {
    let a = 1, b = 2;
    while (b < N) { audio.push({ t: 0.3 + (b / N) * dur, f: 523.25 * (1 + (b % 5) * 0.12), voice: 'celesta', v: 0.72 }); [a, b] = [b, a + b]; }
  }
  const usePal = theme.style === 'paper' || theme.style === 'bauhaus';
  return {
    duration: dur + 2.5,
    audio,
    draw(ctx, t) {
      const u = clamp(t / dur, 0, 1);
      const alpha = mode === 'grow' ? GOLD : a0 + (a1 - a0) * u;
      const nVis = mode === 'grow' ? Math.max(1, Math.floor(N * u)) : N;
      const ar = (alpha * Math.PI) / 180;
      for (let n = 1; n <= nVis; n++) {
        const r = cr * Math.sqrt(n);
        const th = n * ar;
        const rad = 2.2 + 5.5 * Math.sqrt(n / N);
        ctx.fillStyle = usePal
          ? pal(theme, Math.floor((n / 34) % theme.accent.length))
          : hsl(n * 0.28 + t * 18, theme.isLight ? 72 : 86, theme.isLight ? 42 : 60);
        ctx.beginPath();
        ctx.arc(CX + r * Math.cos(th), CY + r * Math.sin(th), rad, 0, TAU);
        ctx.fill();
      }
      if (mode === 'grow') {
        text(ctx, String(nVis), 540, 1520, 126, theme.ink);
        text(ctx, 'seeds · 137.508° golden step', 540, 1640, 44, theme.accentInk);
      } else {
        text(ctx, `${alpha.toFixed(3)}°`, 540, 1520, 126, theme.ink);
        text(ctx, Math.abs(alpha - GOLD) < 0.03 ? 'THE GOLDEN ANGLE' : 'angle between seeds', 540, 1640, 48, Math.abs(alpha - GOLD) < 0.03 ? theme.successInk : theme.accentInk);
      }
    },
  };
};
