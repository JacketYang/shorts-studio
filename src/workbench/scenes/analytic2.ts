import type { AudioEvent, Builder, Ctx } from '../engine/types';
import { TAU, ambient, ball, clamp, halo, hsl, pentatonic, text } from '../engine/util';

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const CX = 540, CY = 880;

function strokePath(ctx: Ctx, xs: ArrayLike<number>, ys: ArrayLike<number>, upto: number, hue0: number, span: number, lw: number, chunk = 36) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const M = xs.length;
  for (let s = 0; s < upto; s += chunk) {
    const e = Math.min(upto, s + chunk + 1);
    ctx.strokeStyle = hsl(hue0 + (s / M) * span, 92, 63);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(xs[s], ys[s]);
    for (let i = s + 1; i <= e && i < M; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
  }
}

function musicEvents(times: number[], voice: AudioEvent['voice'], root = 261.63): AudioEvent[] {
  const sc = pentatonic(root, 10);
  const ev: AudioEvent[] = [];
  times.forEach((t, j) => {
    const m = j % 18;
    const idx = m < 10 ? m : 18 - m;
    ev.push({ t, f: sc[idx], voice, v: 0.55, pan: ((j % 7) - 3) / 8 });
  });
  return ev;
}

/* ---------- Spirograph (hypotrochoid) & rose curves ---------- */
export const buildSpiro: Builder = (c, p) => {
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
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(CX, CY, R * sc, 0, TAU);
      ctx.stroke();
      const gx = CX + sc * (R - r) * Math.cos(t), gy = CY + sc * (R - r) * Math.sin(t);
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(gx, gy, r * sc, 0, TAU);
      ctx.stroke();
      const [px, py] = pt(t);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(px, py);
      ctx.stroke();
      ball(ctx, px, py, 13, '#ffffff', 2.4);
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
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(px, py);
      ctx.stroke();
      ball(ctx, px, py, 13, '#ffffff', 2.4);
    };
  }
  const audio = [...musicEvents(evT, 'marimba', 261.63), { t: 0.1, f: 98, voice: 'pad', d: dur + 2, v: 0.5 } as AudioEvent];
  void c;
  return {
    duration: dur + 2.8,
    audio,
    draw(ctx, t) {
      const u = clamp(t / dur, 0, 1);
      const M = xs.length - 1;
      const upto = Math.floor(u * M);
      strokePath(ctx, xs, ys, upto, t * 14, 420, 11, 36);
      ctx.globalAlpha = 0.25;
      strokePath(ctx, xs, ys, upto, t * 14, 420, 26, 60);
      ctx.globalAlpha = 1;
      deco(ctx, u);
      if (u >= 1) text(ctx, label.toUpperCase(), 540, 1560, 90, '#ffffff', { alpha: clamp((t - dur) / 0.6, 0, 1) });
      else text(ctx, mode === 'hypo' ? `R = ${p.R}   r = ${p.r}` : `r = cos(${p.n}/${p.dn} · θ)`, 540, 1560, 56, '#ffd166');
    },
  };
};

/* ---------- Lissajous ---------- */
const INTERVALS: Record<string, string> = { '1:2': 'octave', '2:3': 'perfect fifth', '3:4': 'perfect fourth', '4:5': 'major third', '3:5': 'major sixth', '5:6': 'minor third', '5:8': 'minor sixth', '1:3': 'octave + fifth', '4:7': '', '2:5': 'major tenth' };

export const buildLissa: Builder = (c, p) => {
  const a: number = p.a, b: number = p.b;
  const dur: number = p.dur ?? 24;
  const layers: number = p.layers ?? 2;
  const M = 700;
  const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
  const audio = [
    ...ambient(c.rng, dur + 2, 2.2, 261.63, 'pluck'),
    { t: 0.2, f: 55 * a, voice: 'pad', d: dur + 2, v: 0.6 } as AudioEvent,
    { t: 0.2, f: 55 * b, voice: 'pad', d: dur + 2, v: 0.6 } as AudioEvent,
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
          ys.push(CY + 440 * Math.sin(b * th + L * 0.0));
        }
        ctx.globalAlpha = 0.18;
        strokePath(ctx, xs, ys, M, t * 18 + L * 90, 200, 24, 100);
        ctx.globalAlpha = 1;
        strokePath(ctx, xs, ys, M, t * 18 + L * 90, 200, 6, 100);
      }
      text(ctx, `${a} : ${b}`, 540, 1560, 150, '#ffffff', { alpha: 0.95 });
      text(ctx, INTERVALS[key] ? `frequency ratio = ${INTERVALS[key]}` : 'frequency ratio', 540, 1670, 42, '#ffd166', { weight: 600 });
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
  const audio = ambient(c.rng, dur + 2, 2.4, 261.63, 'bell');
  return {
    duration: dur + 3,
    audio,
    draw(ctx, t) {
      const u = clamp(t / dur, 0, 1);
      const upto = Math.floor(u * S);
      const hue = (p.hue ?? 330) as number;
      if (u >= 1) {
        ctx.globalAlpha = clamp((t - dur) / 1.2, 0, 1) * 0.28;
        ctx.fillStyle = hsl(hue, 90, 60);
        ctx.beginPath();
        xs.forEach((x, i) => (i ? ctx.lineTo(x, ys[i]) : ctx.moveTo(x, ys[i])));
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.globalAlpha = 0.25;
      strokePath(ctx, xs, ys, upto, hue, 80, 22, 60);
      ctx.globalAlpha = 1;
      strokePath(ctx, xs, ys, upto, hue, 80, 7, 36);
      if (u < 1) {
        const chain: [number, number][] = [];
        const [px, py] = at(u, chain);
        let prevX = CX, prevY = CY;
        ctx.lineWidth = 1.5;
        chain.forEach(([x, y], i) => {
          const r = Math.hypot(x - prevX, y - prevY);
          ctx.strokeStyle = `rgba(255,255,255,${i < 12 ? 0.35 : 0.16})`;
          if (r > 2) { ctx.beginPath(); ctx.arc(prevX, prevY, r, 0, TAU); ctx.stroke(); }
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(x, y);
          ctx.stroke();
          prevX = x; prevY = y;
        });
        ball(ctx, px, py, 12, '#ffffff', 2.5);
      } else halo(ctx, CX, CY, 520, hsl(hue, 90, 60), 0.12 * clamp((t - dur) / 1.2, 0, 1));
      text(ctx, `${use.length} rotating circles`, 540, 1600, 58, '#ffffff', { alpha: 0.9 });
      text(ctx, 'every curve is just circles', 540, 1690, 38, '#ffd166', { weight: 600 });
    },
  };
};

/* ---------- Times table on a circle (cardioid → nephroid → ...) ---------- */
export const buildTimes: Builder = (_c, p) => {
  const N: number = p.n ?? 200;
  const k0 = 2;
  const k1: number = p.k1 ?? 10;
  const dur: number = p.dur ?? 26;
  const R = 430;
  const P = (i: number): [number, number] => { const a = -Math.PI / 2 + (i / N) * TAU; return [CX + R * Math.cos(a), CY + R * Math.sin(a)]; };
  const audio: AudioEvent[] = [];
  const sc = pentatonic(261.63, 12);
  for (let k = 2; k <= k1; k++) audio.push({ t: ((k - k0) / (k1 - k0)) * dur + 0.1, f: sc[(k - 2) % 12], voice: 'bell', v: 0.7 });
  audio.push({ t: 0.1, f: 98, voice: 'pad', d: dur + 2, v: 0.5 });
  audio.push({ t: 0.1, f: 147, voice: 'pad', d: dur + 2, v: 0.4 });
  for (let t = 0.5; t < dur; t += 0.5) audio.push({ t, f: sc[Math.floor(((t / dur) * 20 + (t * 3) % 3)) % 12] * 2, voice: 'blip', v: 0.15 });
  return {
    duration: dur + 1.5,
    audio,
    draw(ctx, t) {
      const k = k0 + (k1 - k0) * clamp(t / dur, 0, 1);
      ctx.lineWidth = 2.2;
      for (let i = 0; i < N; i++) {
        const [x0, y0] = P(i);
        const [x1, y1] = P(((k * i) % N + N) % N);
        ctx.strokeStyle = hsl((i / N) * 360 + t * 12, 90, 62, 0.5);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(CX, CY, R, 0, TAU);
      ctx.stroke();
      const near = Math.abs(k - Math.round(k)) < 0.04;
      text(ctx, `× ${k.toFixed(2)}`, 540, 1520, 140, '#ffffff');
      text(ctx, near ? (Math.round(k) === 2 ? 'CARDIOID' : Math.round(k) === 3 ? 'NEPHROID' : `${Math.round(k) - 1} CUSPS`) : `${N} points · each i → k·i`, 540, 1650, 50, near ? '#7CFFB2' : '#ffd166');
    },
  };
};

/* ---------- Phyllotaxis / golden angle ---------- */
export const buildPhyllo: Builder = (c, p) => {
  const N: number = p.n ?? 1400;
  const dur: number = p.dur ?? 24;
  const mode: 'grow' | 'sweep' = p.mode ?? 'grow';
  const a0: number = p.a0 ?? 137.3;
  const a1: number = p.a1 ?? 137.7;
  const GOLD = 137.50776405;
  const cr = 430 / Math.sqrt(N);
  const audio = ambient(c.rng, dur + 2, 2.2, 261.63, 'pluck');
  if (mode === 'grow') {
    let a = 1, b = 2;
    while (b < N) { audio.push({ t: 0.3 + (b / N) * dur, f: 523.25 * (1 + (b % 5) * 0.12), voice: 'bell', v: 0.8 }); [a, b] = [b, a + b]; }
  }
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
        ctx.fillStyle = hsl(n * 0.28 + t * 18, 90, 60);
        ctx.beginPath();
        ctx.arc(CX + r * Math.cos(th), CY + r * Math.sin(th), rad, 0, TAU);
        ctx.fill();
      }
      if (mode === 'grow') {
        text(ctx, String(nVis), 540, 1520, 130, '#ffffff');
        text(ctx, 'seeds · each turned 137.508°', 540, 1640, 46, '#ffd166');
      } else {
        text(ctx, `${alpha.toFixed(3)}°`, 540, 1520, 130, '#ffffff');
        text(ctx, Math.abs(alpha - GOLD) < 0.03 ? 'THE GOLDEN ANGLE' : 'angle between seeds', 540, 1640, 50, Math.abs(alpha - GOLD) < 0.03 ? '#7CFFB2' : '#ffd166');
      }
    },
  };
};
