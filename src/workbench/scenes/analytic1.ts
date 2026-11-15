import type { AudioEvent, Builder } from '../engine/types';
import { TAU, ball, clamp, fmtInt, halo, hsl, pentatonic, rrect, text } from '../engine/util';

/* ---------- Pendulum wave ---------- */
export const buildPendWave: Builder = (_c, p) => {
  const N: number = p.n ?? 20;
  const T: number = p.T ?? 22;
  const K: number = p.K ?? 15;
  const view: 'rails' | 'wave' = p.view ?? 'rails';
  const f = Array.from({ length: N }, (_, i) => (K + i) / T);
  const sc = pentatonic(440, N);
  const audio: AudioEvent[] = [];
  const dur = T + 2.2;
  for (let i = 0; i < N; i++) {
    for (let k = 0; ; k++) {
      const t = (0.25 + 0.5 * k) / f[i];
      if (t > dur - 0.6) break;
      audio.push({ t: t + 0.05, f: sc[i], voice: 'blip', v: 0.22, pan: (i / (N - 1) - 0.5) * 1.2 });
    }
  }
  const pos = (i: number, t: number) => Math.sin(TAU * f[i] * t);
  const sp = (view === 'rails' ? 1050 : 880) / (N - 1);
  const r = clamp(sp * 0.38, 6, 20);
  const xy = (i: number, t: number): [number, number] => {
    const s = pos(i, t);
    return view === 'rails' ? [540 + 420 * s, 420 + i * sp] : [100 + i * sp, 900 + 470 * s];
  };
  return {
    duration: dur,
    audio,
    echo: true,
    draw(ctx, t) {
      ctx.lineCap = 'round';
      for (let i = 0; i < N; i++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (view === 'rails') { ctx.moveTo(120, 420 + i * sp); ctx.lineTo(960, 420 + i * sp); }
        else { ctx.moveTo(100 + i * sp, 430); ctx.lineTo(100 + i * sp, 1370); }
        ctx.stroke();
      }
      if (view === 'wave') {
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 4;
        ctx.beginPath();
        for (let i = 0; i < N; i++) { const [x, y] = xy(i, t); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      for (let i = 0; i < N; i++) {
        const hue = (i / N) * 300;
        for (let j = 7; j >= 1; j--) {
          const [x, y] = xy(i, Math.max(0, t - j * 0.035));
          ctx.fillStyle = hsl(hue, 90, 65, 0.28 * (1 - j / 8));
          ctx.beginPath();
          ctx.arc(x, y, r * (1 - j / 12), 0, TAU);
          ctx.fill();
        }
        const k = Math.floor((f[i] * t - 0.25) / 0.5);
        const fl = k >= 0 ? Math.max(0, 1 - (t - (0.25 + 0.5 * k) / f[i]) / 0.2) : 0;
        const [x, y] = xy(i, t);
        if (fl > 0) halo(ctx, x, y, r * 3.2, hsl(hue, 100, 70), fl);
        ball(ctx, x, y, r * (1 + 0.25 * fl), hsl(hue, 90, 62), 1.6);
      }
      const a = clamp(1 - Math.abs(t - T) / 0.7, 0, 1);
      if (a > 0) text(ctx, 'ALIGNED!', 540, view === 'rails' ? 1520 : 1470, 90, '#7CFFB2', { alpha: a });
      text(ctx, `${Math.min(t, T).toFixed(1)} s`, 540, 1600, 110, '#ffffff', { alpha: 0.95 });
      text(ctx, `${N} pendulums · realign every ${T} s`, 540, 1700, 40, '#ffd166', { weight: 600 });
    },
  };
};

/* ---------- Orbits that realign ---------- */
export const buildOrbits: Builder = (_c, p) => {
  const N: number = p.n ?? 14;
  const T: number = p.T ?? 30;
  const K: number = p.K ?? 3;
  const connect: boolean = p.connect ?? false;
  const CX = 540, CY = 880;
  const rad = (i: number) => 110 + (i * 330) / (N - 1);
  const revs = (i: number) => K + (N - 1 - i);
  const sc = pentatonic(330, N);
  const audio: AudioEvent[] = [];
  const dur = T + 3;
  for (let i = 0; i < N; i++)
    for (let k = 0; ; k++) {
      const t = (k * T) / revs(i);
      if (t > dur - 1) break;
      audio.push({ t: t + 0.05, f: sc[N - 1 - i], voice: 'bell', v: 0.5, pan: (i / (N - 1) - 0.5) * 0.7 });
    }
  const ang = (i: number, t: number) => -Math.PI / 2 + (TAU * revs(i) * t) / T;
  return {
    duration: dur,
    audio,
    draw(ctx, t) {
      const flashT = clamp(1 - Math.abs(t - T) / 0.8, 0, 1);
      ctx.lineWidth = 2;
      for (let i = 0; i < N; i++) {
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.beginPath();
        ctx.arc(CX, CY, rad(i), 0, TAU);
        ctx.stroke();
      }
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + 0.75 * flashT})`;
      ctx.lineWidth = 3 + 6 * flashT;
      ctx.beginPath();
      ctx.moveTo(CX, CY);
      ctx.lineTo(CX, CY - rad(N - 1) - 24);
      ctx.stroke();
      if (connect) {
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const a = ang(i, t);
          const x = CX + rad(i) * Math.cos(a), y = CY + rad(i) * Math.sin(a);
          if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      for (let i = 0; i < N; i++) {
        const hue = (i / N) * 300;
        const a = ang(i, t);
        const w = (TAU * revs(i)) / T;
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        const seg = 14;
        const len = Math.min(0.9, 0.35 * w * 0.5 + 0.2);
        for (let s = 0; s < seg; s++) {
          ctx.strokeStyle = hsl(hue, 90, 65, 0.5 * (1 - s / seg));
          ctx.beginPath();
          ctx.arc(CX, CY, rad(i), a - (len * (s + 1)) / seg, a - (len * s) / seg);
          ctx.stroke();
        }
        const x = CX + rad(i) * Math.cos(a), y = CY + rad(i) * Math.sin(a);
        const k = Math.floor(((revs(i) * t) / T) );
        const fl = Math.max(0, 1 - (t - (k * T) / revs(i)) / 0.25);
        ball(ctx, x, y, 11 + 4 * fl, hsl(hue, 90, 62), 1.8 + fl);
      }
      text(ctx, `${Math.min(t, T).toFixed(1)} s`, 540, 1480, 130, '#ffffff', { alpha: 0.95 });
      text(ctx, flashT > 0.4 ? 'ALL ALIGNED!' : `${N} orbits · realign at ${T} s`, 540, 1600, flashT > 0.4 ? 78 : 46, flashT > 0.4 ? '#7CFFB2' : '#ffd166');
    },
  };
};

/* ---------- Pi hidden in colliding blocks ---------- */
interface PiRes { x1: Float64Array; x2: Float64Array; wall: Uint8Array; n: number; v1: number; v2: number }

export function simPi(d: number, h1: number, h2: number, x1i: number, x2i: number): PiRes {
  const m1 = 1, m2 = Math.pow(100, d);
  let x1 = x1i, x2 = x2i, v1 = 0, v2 = -1;
  const X1 = [x1], X2 = [x2], W: number[] = [0];
  for (let guard = 0; guard < 20000; guard++) {
    if (v1 >= 0 && v2 >= v1) break;
    const tw = v1 < 0 ? (x1 - h1) / -v1 : Infinity;
    const gap = Math.max(0, x2 - h2 - (x1 + h1));
    const tb = v1 > v2 ? gap / (v1 - v2) : Infinity;
    const dt = Math.min(tw, tb);
    if (!isFinite(dt)) break;
    x1 += v1 * dt;
    x2 += v2 * dt;
    if (tw <= tb) { v1 = -v1; W.push(1); }
    else {
      const u1 = ((m1 - m2) * v1 + 2 * m2 * v2) / (m1 + m2);
      const u2 = ((m2 - m1) * v2 + 2 * m1 * v1) / (m1 + m2);
      v1 = u1; v2 = u2; W.push(0);
    }
    X1.push(x1); X2.push(x2);
  }
  return { x1: Float64Array.from(X1), x2: Float64Array.from(X2), wall: Uint8Array.from(W), n: X1.length - 1, v1, v2 };
}

export const buildPi: Builder = (_c, p) => {
  const d: number = p.digits;
  const h1 = 45;
  const h2 = 55 + d * 22;
  const res = simPi(d, h1, h2, h1 + 120, h1 + 120 + h1 + h2 + 340);
  const N = res.n;
  const intro = 2.2;
  const slot = N <= 5 ? 1.7 : clamp(22 / N, 0.0066, 0.2);
  const tN = intro + (N - 1) * slot;
  const dur = tN + (N <= 5 ? 4.2 : 3.2);
  const PXS = 170;
  const piStr = ['3', '3.1', '3.14', '3.141'][d];
  const audio: AudioEvent[] = [];
  for (let k = 1; k <= N; k++) {
    const t = intro + (k - 1) * slot;
    if (res.wall[k]) audio.push({ t, f: 240, voice: 'click', v: 0.8, pan: -0.3 });
    else audio.push({ t, f: 800 + (k / N) * 700, voice: 'click', v: 0.6, pan: 0.2 });
  }
  audio.push({ t: tN + 0.6, f: 523.25, voice: 'bell', v: 0.8 });
  audio.push({ t: tN + 0.75, f: 659.25, voice: 'bell', v: 0.8 });
  audio.push({ t: tN + 0.9, f: 783.99, voice: 'bell', v: 0.8 });
  const mass = fmtInt(Math.pow(100, d));
  const state = (t: number): { k: number; a: number; b: number } => {
    if (t <= 0) return { k: 0, a: res.x1[0], b: res.x2[0] };
    if (t < intro) { const s = t / intro; return { k: 0, a: res.x1[0] + (res.x1[1] - res.x1[0]) * s, b: res.x2[0] + (res.x2[1] - res.x2[0]) * s }; }
    if (t >= tN) { const e = t - tN; return { k: N, a: res.x1[N] + res.v1 * PXS * e, b: res.x2[N] + res.v2 * PXS * e }; }
    const kk = Math.floor((t - intro) / slot) + 1;
    const k = clamp(kk, 1, N - 1);
    const s = clamp((t - (intro + (k - 1) * slot)) / slot, 0, 1);
    return { k, a: res.x1[k] + (res.x1[k + 1] - res.x1[k]) * s, b: res.x2[k] + (res.x2[k + 1] - res.x2[k]) * s };
  };
  return {
    duration: dur,
    audio,
    echo: false,
    draw(ctx, t) {
      const st = state(t);
      const WX = 110, FY = 1050;
      const k = st.k;
      const sinceHit = k >= 1 && t < tN ? (t - (intro + (k - 1) * slot)) : 1;
      const flash = clamp(1 - sinceHit / 0.15, 0, 1);
      const z = 1 + 0.9 * clamp((t - intro + 0.3) / 1.6, 0, 1);
      ctx.save();
      ctx.translate(WX, FY);
      ctx.scale(z, z);
      ctx.translate(-WX, -FY);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(WX - 24, FY - 330, 24, 330);
      if (flash > 0 && res.wall[k]) halo(ctx, WX, FY - 120, 160, '#ffffff', flash);
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.fillRect(WX - 24, FY, 960, 8);
      const bx = WX + st.b, ax = WX + st.a;
      // small
      ctx.fillStyle = '#ffd166';
      rrect(ctx, ax - h1, FY - 2 * h1, 2 * h1, 2 * h1, 12);
      ctx.fill();
      text(ctx, '1 kg', ax, FY - h1, 30, '#2b1b00');
      ctx.fillStyle = '#4cc9f0';
      rrect(ctx, bx - h2, FY - 2 * h2, 2 * h2, 2 * h2, 16);
      ctx.fill();
      text(ctx, mass + ' kg', bx, FY - h2, d >= 3 ? 30 : 36, '#012a38');
      if (flash > 0 && !res.wall[k]) halo(ctx, bx - h2, FY - h2, 130, '#ffffff', flash * 0.9);
      ctx.restore();
      text(ctx, fmtInt(k), 540, 1260, k > 999 ? 230 : 280, '#ffffff');
      text(ctx, 'COLLISIONS', 540, 1410, 52, '#ffd166');
      const show = t >= tN + 0.2;
      text(ctx, show ? `π ≈ ${piStr}` : `1 kg  vs  ${mass} kg`, 540, 1550, show ? 120 : 52, show ? '#7CFFB2' : '#ffffff', { alpha: show ? clamp((t - tN - 0.2) / 0.4, 0, 1) : 0.7 });
      if (show) text(ctx, `mass ratio 100^${d} → ${N} collisions`, 540, 1660, 40, '#ffffff', { alpha: 0.7, weight: 600 });
    },
  };
};
