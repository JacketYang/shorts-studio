import type { AudioEvent, Builder, Ctx } from '../engine/types';
import { TAU, ambient, ball, clamp, halo, hsl, lastLE, lerp, pentatonic, rrect, text } from '../engine/util';

const CX = 540;

/* ---------- Double pendulums with nearly identical starts ---------- */
export const buildDPend: Builder = (c, p) => {
  const N: number = p.n ?? 40;
  const dur: number = p.dur ?? 30;
  const mode: 'lines' | 'tips' = p.mode ?? 'lines';
  const eps: number = p.eps ?? 1e-5;
  const L = 235, PY = 790;
  const g = 9.81;
  const th1 = Array.from({ length: N }, (_, i) => 2.3 + i * eps);
  const th2 = Array.from({ length: N }, () => 2.5);
  const w1 = new Array(N).fill(0), w2 = new Array(N).fill(0);
  const acc = (a: number, b: number, o1: number, o2: number): [number, number] => {
    const d = a - b;
    const den = 3 - Math.cos(2 * d);
    const a1 = (-3 * g * Math.sin(a) - g * Math.sin(a - 2 * b) - 2 * Math.sin(d) * (o2 * o2 + o1 * o1 * Math.cos(d))) / den;
    const a2 = (2 * Math.sin(d) * (2 * o1 * o1 + 2 * g * Math.cos(a) + o2 * o2 * Math.cos(d))) / den;
    return [a1, a2];
  };
  const dt = 1 / 480;
  const frames: Float32Array[] = [];
  const steps = Math.floor(dur * 480);
  for (let s = 0; s <= steps; s++) {
    if (s % 8 === 0) {
      const f = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        const x1 = CX + L * Math.sin(th1[i]), y1 = PY + L * Math.cos(th1[i]);
        f[i * 4] = x1; f[i * 4 + 1] = y1;
        f[i * 4 + 2] = x1 + L * Math.sin(th2[i]); f[i * 4 + 3] = y1 + L * Math.cos(th2[i]);
      }
      frames.push(f);
    }
    for (let i = 0; i < N; i++) {
      const k1 = acc(th1[i], th2[i], w1[i], w2[i]);
      const a2 = th1[i] + 0.5 * dt * w1[i], b2 = th2[i] + 0.5 * dt * w2[i], o12 = w1[i] + 0.5 * dt * k1[0], o22 = w2[i] + 0.5 * dt * k1[1];
      const k2 = acc(a2, b2, o12, o22);
      const a3 = th1[i] + 0.5 * dt * o12, b3 = th2[i] + 0.5 * dt * o22, o13 = w1[i] + 0.5 * dt * k2[0], o23 = w2[i] + 0.5 * dt * k2[1];
      const k3 = acc(a3, b3, o13, o23);
      const a4 = th1[i] + dt * o13, b4 = th2[i] + dt * o23, o14 = w1[i] + dt * k3[0], o24 = w2[i] + dt * k3[1];
      const k4 = acc(a4, b4, o14, o24);
      th1[i] += (dt / 6) * (w1[i] + 2 * o12 + 2 * o13 + o14);
      th2[i] += (dt / 6) * (w2[i] + 2 * o22 + 2 * o23 + o24);
      w1[i] += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
      w2[i] += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    }
  }
  const audio = ambient(c.rng, dur + 1, 2.0, 220, 'bell');
  const deg = ((eps * 180) / Math.PI);
  return {
    duration: dur + 1,
    audio,
    draw(ctx, t) {
      const f = clamp(Math.floor(t * 60), 0, frames.length - 1);
      const cur = frames[f];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (mode === 'lines') {
        ctx.lineWidth = 4;
        for (let i = 0; i < N; i++) {
          ctx.strokeStyle = hsl((i / N) * 300, 90, 62, 0.4);
          ctx.beginPath();
          ctx.moveTo(CX, PY);
          ctx.lineTo(cur[i * 4], cur[i * 4 + 1]);
          ctx.lineTo(cur[i * 4 + 2], cur[i * 4 + 3]);
          ctx.stroke();
        }
      }
      const tl = mode === 'tips' ? 70 : 26;
      for (let i = 0; i < N; i++) {
        ctx.strokeStyle = hsl((i / N) * 300, 95, 65, mode === 'tips' ? 0.6 : 0.45);
        ctx.lineWidth = mode === 'tips' ? 4 : 3;
        ctx.beginPath();
        const f0 = Math.max(0, f - tl);
        for (let k = f0; k <= f; k++) {
          const x = frames[k][i * 4 + 2], y = frames[k][i * 4 + 3];
          if (k === f0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ball(ctx, cur[i * 4 + 2], cur[i * 4 + 3], mode === 'tips' ? 10 : 8, hsl((i / N) * 300, 90, 64), 1.5);
      }
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(CX, PY, 9, 0, TAU);
      ctx.fill();
      text(ctx, `${N} double pendulums`, 540, 1520, 66, '#ffffff');
      text(ctx, `start difference: ${deg < 0.001 ? deg.toExponential(1) : deg.toFixed(4)}° each`, 540, 1612, 40, '#ffd166', { weight: 600 });
      text(ctx, `${t.toFixed(1)} s`, 540, 1700, 56, '#ffffff', { alpha: 0.7 });
    },
  };
};

/* ---------- Lorenz attractor butterflies ---------- */
export const buildLorenz: Builder = (c, p) => {
  const N: number = p.n ?? 10;
  const dur: number = p.dur ?? 28;
  const sps = 240;
  const total = Math.floor(dur * sps) + 2;
  const sig = 10, rho = 28, beta = 8 / 3, dt = 0.005;
  const X: Float32Array[] = [], Y: Float32Array[] = [], Z: Float32Array[] = [];
  const f = (x: number, y: number, z: number): [number, number, number] => [sig * (y - x), x * (rho - z) - y, x * y - beta * z];
  const audio: AudioEvent[] = [];
  const sc = pentatonic(220, 15);
  for (let i = 0; i < N; i++) {
    let x = 1 + i * (p.eps ?? 2e-4), y = 1, z = 1;
    const xa = new Float32Array(total), ya = new Float32Array(total), za = new Float32Array(total);
    for (let s = 0; s < total; s++) {
      xa[s] = x; ya[s] = y; za[s] = z;
      const a = f(x, y, z);
      const b = f(x + 0.5 * dt * a[0], y + 0.5 * dt * a[1], z + 0.5 * dt * a[2]);
      const cc = f(x + 0.5 * dt * b[0], y + 0.5 * dt * b[1], z + 0.5 * dt * b[2]);
      const d = f(x + dt * cc[0], y + dt * cc[1], z + dt * cc[2]);
      x += (dt / 6) * (a[0] + 2 * b[0] + 2 * cc[0] + d[0]);
      y += (dt / 6) * (a[1] + 2 * b[1] + 2 * cc[1] + d[1]);
      z += (dt / 6) * (a[2] + 2 * b[2] + 2 * cc[2] + d[2]);
      if (i === 0 && s > 0 && Math.sign(xa[s]) !== Math.sign(xa[s - 1]))
        audio.push({ t: s / sps, f: sc[clamp(Math.floor(za[s] / 4), 0, 14)], voice: 'marimba', v: 0.8, pan: xa[s] / 40 });
    }
    X.push(xa); Y.push(ya); Z.push(za);
  }
  audio.push({ t: 0.1, f: 110, voice: 'pad', d: dur, v: 0.5 });
  void c;
  return {
    duration: dur,
    audio,
    draw(ctx, t) {
      const idx = clamp(Math.floor(t * sps), 0, total - 1);
      const ph = 0.22 * t;
      const cs = Math.cos(ph), sn = Math.sin(ph);
      const proj = (x: number, y: number, z: number): [number, number] => [CX + (x * cs - y * sn) * 19.5, 1420 - z * 18.5];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const tl = 420;
      for (let i = 0; i < N; i++) {
        const hue = (i / N) * 280 + 10;
        const s0 = Math.max(0, idx - tl);
        for (let seg = 0; seg < 6; seg++) {
          const a = s0 + Math.floor(((idx - s0) * seg) / 6), b = s0 + Math.floor(((idx - s0) * (seg + 1)) / 6);
          ctx.strokeStyle = hsl(hue, 92, 62, 0.12 + 0.75 * ((seg + 1) / 6));
          ctx.lineWidth = 2 + seg * 0.7;
          ctx.beginPath();
          for (let s = a; s <= b; s += 2) {
            const [px, py] = proj(X[i][s], Y[i][s], Z[i][s]);
            if (s === a) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        const [hx, hy] = proj(X[i][idx], Y[i][idx], Z[i][idx]);
        ball(ctx, hx, hy, 9, hsl(hue, 90, 66), 1.8);
      }
      text(ctx, `${N} copies · start apart by 0.0002`, 540, 1560, 48, '#ffffff');
      text(ctx, 'the Lorenz attractor · chaos', 540, 1650, 40, '#ffd166', { weight: 600 });
    },
  };
};

/* ---------- Galton board ---------- */
export const buildGalton: Builder = (c, p) => {
  const rows: number = p.rows ?? 12;
  const B: number = p.balls ?? 250;
  const rng = c.rng;
  const dx = 60, pegY0 = 520, rowH = 55, pr = 7, rad = 8, floorY = 1430, ballTau = 0.12;
  const pegX = (r: number, j: number) => CX + (j - r / 2) * dx;
  const pegY = (r: number) => pegY0 + r * rowH;
  const binX = (k: number) => CX + (k - rows / 2) * dx;
  const cnt = new Array(rows + 1).fill(0);
  const sc = pentatonic(392, 12);
  interface Ball { tRel: number; js: number[]; bin: number; tLand: number; ex: number; ey: number; hit0: number }
  const balls: Ball[] = [];
  const audio: AudioEvent[] = [];
  let tRel = 0.6;
  for (let i = 0; i < B; i++) {
    const js: number[] = [];
    let j = 0;
    for (let r = 0; r < rows; r++) {
      js.push(j);
      if (rng() < 0.5) j++;
    }
    const bin = j;
    const n = cnt[bin]++;
    const ex = binX(bin) + ((n % 3) - 1) * 17;
    const ey = floorY - rad - Math.floor(n / 3) * 15;
    const hit0 = tRel + 0.28;
    const lastHit = hit0 + (rows - 1) * ballTau;
    const lastY = pegY(rows - 1) - pr - rad;
    const tLand = lastHit + Math.sqrt((2 * Math.max(10, ey - lastY)) / 3500) + 0.04;
    balls.push({ tRel, js, bin, tLand, ex, ey, hit0 });
    for (let r = 0; r < rows; r += 2) audio.push({ t: hit0 + r * ballTau, f: sc[(js[r] + r) % 12], voice: 'tick', v: 0.1, pan: (pegX(r, js[r]) - CX) / 500 });
    audio.push({ t: tLand, f: 520 + bin * 40, voice: 'tick', v: 0.14 });
    tRel += Math.max(0.025, 0.35 * Math.pow(0.955, i));
  }
  const tEnd = Math.max(...balls.map((b) => b.tLand));
  audio.push({ t: 0.1, f: 98, voice: 'pad', d: tEnd + 3, v: 0.4 });
  const binom = (n: number, k: number) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
  const landedT = balls.map((b) => b.tLand).sort((a, b) => a - b);
  const hueOf = (k: number) => 10 + (k / rows) * 280;
  const pos = (b: Ball, t: number): [number, number] => {
    const topX = CX, topY = 430;
    const p0y = pegY(0) - pr - rad;
    if (t < b.hit0) { const s = clamp((t - b.tRel) / 0.28, 0, 1); return [topX, lerp(topY, p0y, s * s)]; }
    const r = Math.floor((t - b.hit0) / ballTau);
    if (r < rows - 1) {
      const s = (t - b.hit0 - r * ballTau) / ballTau;
      const ax = pegX(r, b.js[r]), ay = pegY(r) - pr - rad;
      const bx = pegX(r + 1, b.js[r + 1]), by = pegY(r + 1) - pr - rad;
      return [lerp(ax, bx, s), lerp(ay, by, s) - 14 * 4 * s * (1 - s)];
    }
    const lastHit = b.hit0 + (rows - 1) * ballTau;
    const ax = pegX(rows - 1, b.js[rows - 1]), ay = pegY(rows - 1) - pr - rad;
    const s = clamp((t - lastHit) / (b.tLand - lastHit), 0, 1);
    return [lerp(ax, b.ex, Math.min(1, s * 1.6)), lerp(ay, b.ey, s * s)];
  };
  return {
    duration: tEnd + 3.6,
    audio,
    echo: false,
    draw(ctx, t) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (let r = 0; r < rows; r++) for (let j = 0; j <= r; j++) { ctx.beginPath(); ctx.arc(pegX(r, j), pegY(r), pr, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)';
      ctx.lineWidth = 3;
      for (let k = 0; k <= rows + 1; k++) {
        const x = CX + (k - 0.5 - rows / 2) * dx;
        ctx.beginPath();
        ctx.moveTo(x, floorY - 330);
        ctx.lineTo(x, floorY);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(CX + (-0.5 - rows / 2) * dx, floorY);
      ctx.lineTo(CX + (rows + 0.5 - rows / 2) * dx, floorY);
      ctx.stroke();
      let released = 0;
      for (const b of balls) {
        if (t < b.tRel) continue;
        released++;
        const [x, y] = pos(b, t);
        ctx.fillStyle = hsl(hueOf(b.bin), 90, 62);
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, TAU);
        ctx.fill();
      }
      const a = clamp((t - (tEnd - 0.5)) / 1.5, 0, 1);
      if (a > 0) {
        ctx.setLineDash([14, 12]);
        ctx.strokeStyle = `rgba(255,255,255,${0.85 * a})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        for (let k = 0; k <= rows; k++) {
          const e = (B * binom(rows, k)) / Math.pow(2, rows);
          const h = (e / 3) * 15 + rad * 2;
          const x = binX(k), y = floorY - h;
          if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
      }
      const landed = lastLE(landedT, t) + 1;
      text(ctx, String(Math.min(released, B)), 540, 1560, 100, '#ffffff');
      text(ctx, a > 0.6 ? 'THE BELL CURVE EMERGES' : `${landed} landed · ${rows} rows of pegs`, 540, 1670, a > 0.6 ? 52 : 40, a > 0.6 ? '#7CFFB2' : '#ffd166');
    },
  };
};

/* ---------- Races: brachistochrone & tautochrone ---------- */
const CURVE_NAMES: Record<string, string> = { line: 'Straight line', cycloid: 'Cycloid', steep: 'Steep, then flat', sag: 'Flat, then steep', arc: 'Circular dip', parab: 'Parabola' };
const CURVE_COL: Record<string, string> = { line: '#ff6b6b', cycloid: '#ffd166', steep: '#06d6a0', sag: '#4cc9f0', arc: '#c77dff', parab: '#ff9e00' };

function solveCycloid(ratio: number) {
  let lo = 0.01, hi = TAU;
  for (let i = 0; i < 80; i++) {
    const m = (lo + hi) / 2;
    const f = (1 - Math.cos(m)) / (m - Math.sin(m));
    if (f > ratio) lo = m; else hi = m;
  }
  return (lo + hi) / 2;
}

function raceBrachi(c: { rng: () => number }, p: { curves: string[]; drop?: number; tCyc?: number }) {
  void c;
  const A: [number, number] = [130, 680];
  const dx = 820, dy = (p.drop ?? 0.45) * dx;
  const Bp: [number, number] = [A[0] + dx, A[1] + dy];
  const M = 600;
  const curves = p.curves;
  const thB = solveCycloid(dy / dx);
  const rC = dx / (thB - Math.sin(thB));
  const gen = (name: string, u: number): [number, number] => {
    switch (name) {
      case 'line': return [A[0] + dx * u, A[1] + dy * u];
      case 'cycloid': { const th = thB * u; return [A[0] + rC * (th - Math.sin(th)), A[1] + rC * (1 - Math.cos(th))]; }
      case 'steep': return [A[0] + dx * u, A[1] + dy * (1 - Math.pow(1 - u, 3))];
      case 'sag': return [A[0] + dx * u, A[1] + dy * Math.pow(u, 3)];
      case 'parab': return [A[0] + dx * u, A[1] + dy * (1 - Math.pow(1 - u, 2))];
      default: return [A[0] + dx * u, A[1] + dy * u + 150 * Math.sin(Math.PI * u)];
    }
  };
  const raw = curves.map((nm) => {
    const xs: number[] = [], ys: number[] = [], T: number[] = [0];
    for (let i = 0; i <= M; i++) { const [x, y] = gen(nm, i / M); xs.push(x); ys.push(y); }
    for (let i = 0; i < M; i++) {
      const ds = Math.hypot(xs[i + 1] - xs[i], ys[i + 1] - ys[i]);
      const ym = Math.max(0.5, (ys[i] + ys[i + 1]) / 2 - A[1]);
      T.push(T[i] + ds / Math.sqrt(2 * ym));
    }
    return { xs, ys, T };
  });
  const cyc = raw[curves.indexOf('cycloid')] ?? raw[0];
  const scale = (p.tCyc ?? 6.5) / cyc.T[M];
  raw.forEach((r) => { r.T = r.T.map((v) => v * scale); });
  const fin = raw.map((r) => r.T[M] + 1.0);
  const rank = fin.map((f, i) => fin.filter((g) => g < f).length + 0 * i);
  const audio: AudioEvent[] = [{ t: 0.9, f: 130, voice: 'thud', v: 0.8 }];
  const nt = [523.25, 440, 392, 329.63, 293.66, 261.63];
  fin.forEach((f, i) => audio.push({ t: f, f: nt[rank[i]] ?? 261.63, voice: 'bell', v: 0.8 }));
  const endT = Math.max(...fin) + 3;
  return {
    duration: endT,
    audio,
    draw(ctx: Ctx, t: number) {
      curves.forEach((nm, i) => {
        const r = raw[i];
        ctx.strokeStyle = CURVE_COL[nm] + '88';
        ctx.lineWidth = 7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        r.xs.forEach((x, k) => (k ? ctx.lineTo(x, r.ys[k]) : ctx.moveTo(x, r.ys[k])));
        ctx.stroke();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(Bp[0] + 36, Bp[1] - 90);
      ctx.lineTo(Bp[0] + 36, Bp[1] + 40);
      ctx.stroke();
      text(ctx, 'START', A[0], A[1] - 60, 30, '#ffffff', { alpha: 0.8 });
      text(ctx, 'FINISH', Bp[0] + 36, Bp[1] - 118, 30, '#ffffff', { alpha: 0.8 });
      const ts = t - 1.0;
      curves.forEach((nm, i) => {
        const r = raw[i];
        const k = ts <= 0 ? 0 : Math.min(M, lastLE(r.T, ts));
        const s = k >= M ? 0 : (ts - r.T[k]) / (r.T[k + 1] - r.T[k]);
        const x = lerp(r.xs[k], r.xs[Math.min(M, k + 1)], clamp(s, 0, 1));
        const y = lerp(r.ys[k], r.ys[Math.min(M, k + 1)], clamp(s, 0, 1));
        ball(ctx, x, y - 22, 22, CURVE_COL[nm], 2);
      });
      const order = curves.map((_, i) => i).sort((a, b) => fin[a] - fin[b]);
      order.forEach((i, row) => {
        const y = 1420 + row * 56;
        const done = t >= fin[i];
        ctx.fillStyle = CURVE_COL[curves[i]];
        ctx.beginPath();
        ctx.arc(190, y, 15, 0, TAU);
        ctx.fill();
        text(ctx, CURVE_NAMES[curves[i]], 225, y, 38, '#ffffff', { align: 'left', alpha: done ? 1 : 0.45, weight: 700 });
        text(ctx, done ? `#${rank[i] + 1}  ${(fin[i] - 1).toFixed(2)} s` : '…', 900, y, 38, done ? '#ffd166' : '#ffffff', { align: 'right', alpha: done ? 1 : 0.3 });
      });
    },
  };
}

function raceTauto(c: { rng: () => number }, p: { n?: number }) {
  void c;
  const N = p.n ?? 8;
  const Tp = 4.0;
  const t0 = 1.6;
  const rC = 140, topC = 520;
  const Lc = 600, arcCY = 680;
  const dur = t0 + Tp * 3 + 1.2;
  const fr = Array.from({ length: N }, (_, i) => ((i - (N - 1) / 2) / (N / 2)) * 0.9);
  const w0 = TAU / Tp;
  const phi0 = fr.map((f) => f * 0.78);
  const dt = 1 / 480;
  const arc: Float32Array[] = [];
  const th = phi0.slice();
  const om = new Array(N).fill(0);
  const steps = Math.floor((dur - t0) * 480);
  const accf = (a: number) => -w0 * w0 * Math.sin(a);
  for (let s = 0; s <= steps; s++) {
    if (s % 8 === 0) arc.push(Float32Array.from(th));
    for (let i = 0; i < N; i++) {
      const k1 = accf(th[i]), a2 = th[i] + 0.5 * dt * om[i], o2 = om[i] + 0.5 * dt * k1;
      const k2 = accf(a2), a3 = th[i] + 0.5 * dt * o2, o3 = om[i] + 0.5 * dt * k2;
      const k3 = accf(a3), a4 = th[i] + dt * o3, o4 = om[i] + dt * k3;
      const k4 = accf(a4);
      th[i] += (dt / 6) * (om[i] + 2 * o2 + 2 * o3 + o4);
      om[i] += (dt / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    }
  }
  const audio: AudioEvent[] = [];
  const sc = pentatonic(261.63, 5);
  for (let k = 0; k < 6; k++) {
    const t = t0 + Tp / 4 + k * (Tp / 2);
    sc.forEach((f, j) => audio.push({ t: t + j * 0.015, f: f * (j < 3 ? 1 : 0.5), voice: 'bell', v: 0.45, pan: (j - 2) / 4 }));
  }
  audio.push({ t: 0.1, f: 98, voice: 'pad', d: dur, v: 0.35 });
  const cycPos = (i: number, ts: number): [number, number] => {
    const s0 = fr[i] * 4 * rC * 0.99;
    const s = s0 * Math.cos(w0 * Math.max(0, ts));
    const th2 = 2 * Math.asin(clamp(s / (4 * rC), -1, 1));
    return [CX + rC * (th2 + Math.sin(th2)), topC + rC * (1 + Math.cos(th2))];
  };
  return {
    duration: dur,
    audio,
    draw(ctx: Ctx, t: number) {
      const ts = t - t0;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#ffd166aa';
      ctx.lineWidth = 8;
      ctx.beginPath();
      for (let i = -100; i <= 100; i++) {
        const th2 = (i / 100) * Math.PI;
        const x = CX + rC * (th2 + Math.sin(th2)), y = topC + rC * (1 + Math.cos(th2));
        if (i === -100) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#4cc9f0aa';
      ctx.beginPath();
      const pm = Math.asin(440 / Lc);
      for (let i = -100; i <= 100; i++) {
        const a = (i / 100) * pm;
        const x = CX + Lc * Math.sin(a), y = arcCY + Lc * Math.cos(a);
        if (i === -100) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      const flash = (kk: number) => clamp(1 - Math.abs(ts - (Tp / 4 + kk * (Tp / 2))) / 0.25, 0, 1);
      let fl = 0;
      for (let k = 0; k < 6; k++) fl = Math.max(fl, flash(k));
      if (fl > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * fl})`;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(CX, topC + 2 * rC + 30);
        ctx.lineTo(CX, topC - 30);
        ctx.stroke();
      }
      const af = clamp(Math.floor(Math.max(0, ts) * 60), 0, arc.length - 1);
      for (let i = 0; i < N; i++) {
        const hue = (i / (N - 1)) * 300;
        const [x, y] = cycPos(i, ts);
        ball(ctx, x, y - 20, 20, hsl(hue, 90, 62), 2);
        const a = ts <= 0 ? phi0[i] : arc[af][i];
        ball(ctx, CX + Lc * Math.sin(a), arcCY + Lc * Math.cos(a) - 20, 20, hsl(hue, 90, 62), 2);
      }
      text(ctx, 'CYCLOID BOWL · all arrive together', 540, 880, 40, '#ffd166');
      text(ctx, 'CIRCULAR BOWL · they drift apart', 540, 1385, 40, '#4cc9f0');
      text(ctx, ts < 0 ? 'release from different heights…' : 'same time, any height', 540, 1520, 52, '#ffffff', { alpha: 0.9 });
    },
  };
}

export const buildRace: Builder = (c, p) => (p.mode === 'tauto' ? raceTauto(c, p) : raceBrachi(c, p));

/* ---------- Sieve of Eratosthenes ---------- */
export const buildSieve: Builder = (_c, p) => {
  const N: number = p.n ?? 100;
  const cols: number = p.cols ?? 10;
  const rows = Math.ceil(N / cols);
  const cell = Math.min(96, 900 / rows, 960 / cols);
  const gx = 540 - (cols * cell) / 2, gy = 860 - (rows * cell) / 2;
  const crossedAt = new Array(N + 1).fill(Infinity);
  const crossBy = new Array(N + 1).fill(0);
  const comp = new Array(N + 1).fill(false);
  const audio: AudioEvent[] = [];
  const steps: { p: number; t: number; idx: number }[] = [];
  const primeList: number[] = [];
  for (let i = 2; i <= N; i++) { let ok = true; for (let d = 2; d * d <= i; d++) if (i % d === 0) { ok = false; break; } if (ok) primeList.push(i); }
  const sc = pentatonic(196, 40);
  let ops = 0;
  for (let q = 2; q * q <= N; q++) if (primeList.includes(q)) ops += Math.floor((N - q * q) / q) + 1;
  const dm = clamp(9 / ops, 0.04, 0.09);
  let t = 1.4;
  crossedAt[1] = 0.7;
  audio.push({ t: 0.7, f: 200, voice: 'thud', v: 0.5 });
  let pi = 0;
  for (let q = 2; q * q <= N; q++) {
    if (comp[q]) continue;
    steps.push({ p: q, t, idx: pi });
    audio.push({ t, f: sc[pi * 2 + 5], voice: 'bell', v: 0.9 });
    t += 0.55;
    for (let m = q * q; m <= N; m += q) {
      if (!comp[m]) { comp[m] = true; crossedAt[m] = t; crossBy[m] = pi; }
      audio.push({ t, f: sc[pi * 2 + 7 + ((m / q) % 3)], voice: 'blip', v: 0.35, pan: ((m % cols) / cols - 0.5) });
      t += dm;
    }
    t += 0.2;
    pi++;
  }
  const tReveal = t + 0.4;
  primeList.forEach((q, i) => audio.push({ t: tReveal + i * 0.075, f: sc[Math.min(39, i + 6)], voice: 'marimba', v: 0.7, pan: ((q % cols) / cols - 0.5) }));
  const tEnd = tReveal + primeList.length * 0.075 + 2.4;
  const stepT = steps.map((s) => s.t);
  const cellXY = (n: number): [number, number] => [gx + ((n - 1) % cols) * cell, gy + Math.floor((n - 1) / cols) * cell];
  return {
    duration: tEnd,
    audio,
    echo: true,
    draw(ctx, tm) {
      const sk = lastLE(stepT, tm);
      const cur = sk >= 0 && tm < tReveal ? steps[sk] : null;
      for (let n = 1; n <= N; n++) {
        const [x, y] = cellXY(n);
        const ca = crossedAt[n];
        const isCrossed = ca <= tm;
        const isPrime = n > 1 && !comp[n];
        const pop = isCrossed ? clamp((tm - ca) / 0.18, 0, 1) : 0;
        let fill = 'rgba(255,255,255,0.08)';
        let col = '#ffffff';
        let alpha = 1;
        if (isCrossed) {
          fill = hsl(n === 1 ? 0 : crossBy[n] * 67 + 10, 70, 45, 0.55 - 0.3 * pop);
          alpha = 1 - 0.65 * pop;
        }
        if (isPrime && tm >= tReveal) {
          const pr = primeList.indexOf(n);
          const k = clamp((tm - (tReveal + pr * 0.075)) / 0.3, 0, 1);
          if (k > 0) { fill = hsl(48, 100, 60, 0.9 * k); col = '#2b1b00'; }
        }
        if (cur && n === cur.p) { fill = hsl(cur.idx * 67 + 10, 95, 60, 1); col = '#111111'; }
        ctx.fillStyle = fill;
        rrect(ctx, x + 3, y + 3, cell - 6, cell - 6, 10);
        ctx.fill();
        text(ctx, String(n), x + cell / 2, y + cell / 2, cell * 0.38, col, { alpha });
        if (isCrossed && pop < 1 && n > 1) halo(ctx, x + cell / 2, y + cell / 2, cell * 0.9, '#ffffff', 0.5 * (1 - pop));
      }
      const label = tm >= tReveal ? `${primeList.length} PRIMES UNDER ${N}` : cur ? `cross out every multiple of ${cur.p}` : 'the sieve of Eratosthenes';
      text(ctx, label, 540, gy + rows * cell + 90, 54, tm >= tReveal ? '#ffd166' : '#ffffff');
    },
  };
};
