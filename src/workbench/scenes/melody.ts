import type { AudioEvent, Builder, Ctx } from '../engine/types';
import { planNotes } from '../engine/music';
import type { Plan } from '../engine/music';
import { TAU, ball, clamp, easeOut, halo, hash, hsl, lastLE, lerp, rrect, text } from '../engine/util';

function ranks(plan: Plan) {
  const fs = [...new Set(plan.notes.map((n) => Math.round(n.f * 100)))].sort((a, b) => a - b);
  return { n: fs.length, rankOf: (f: number) => fs.indexOf(Math.round(f * 100)) };
}

function labels(ctx: Ctx, plan: Plan, name: string, t: number, tt: number[], accent: string) {
  text(ctx, '♪ ' + name, 540, 1650, 52, '#ffffff', { alpha: 0.85 });
  if (plan.rounds > 1 && plan.notes[plan.notes.length - 1].speed !== 1) {
    const k = Math.max(0, lastLE(tt, t));
    const nn = plan.notes[k];
    text(ctx, `ROUND ${nn.round + 1}/${plan.rounds}  ·  ${nn.speed.toFixed(1)}× SPEED`, 540, 1575, 44, accent);
  }
}

/* ---------- 1. Ball hops across xylophone bars ---------- */
export const buildHop: Builder = (_c, p) => {
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup });
  const { notes } = plan;
  const { n, rankOf } = ranks(plan);
  const R = p.ballR ?? 30;
  const layout = p.layout as 'flat' | 'stairs' | 'arc';
  interface Bar { x: number; y: number; a: number; len: number; w: number; hue: number; cx: number; cy: number }
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0.5;
    const hue = k * 300;
    let x = 0, y = 0, a = 0, len = 0, w = 0;
    if (layout === 'arc') {
      a = ((-72 + 144 * k) * Math.PI) / 180;
      x = 540 + 470 * Math.sin(a);
      y = 1250 - 470 * Math.cos(a);
      len = 300;
      w = Math.min(78, (2 * Math.PI * 470 * 0.4) / n - 8);
    } else {
      const sp = 920 / n;
      x = 80 + sp * (i + 0.5);
      w = Math.min(90, sp - 8);
      if (layout === 'flat') { y = 820; len = 640 - k * 400; }
      else { y = 1330 - k * 640; len = 1500 - y; }
    }
    bars.push({ x, y, a, len, w, hue, cx: x + Math.sin(a) * R, cy: y - Math.cos(a) * R });
  }
  const tt = notes.map((x) => x.t);
  const ctr = notes.map((x) => bars[rankOf(x.f)]);
  const ballAt = (t: number): [number, number] => {
    if (t <= tt[0]) { const s = t / tt[0]; return [ctr[0].cx, lerp(-80, ctr[0].cy, s * s)]; }
    const k = lastLE(tt, t);
    if (k >= notes.length - 1) return [ctr[k].cx, ctr[k].cy];
    const T = tt[k + 1] - tt[k];
    const s = (t - tt[k]) / T;
    const lift = clamp(70 + 520 * T, 70, 420);
    return [lerp(ctr[k].cx, ctr[k + 1].cx, s), lerp(ctr[k].cy, ctr[k + 1].cy, s) - lift * 4 * s * (1 - s)];
  };
  const audio: AudioEvent[] = notes.map((x) => ({ t: x.t, f: x.f, voice: 'marimba', v: 0.9, pan: (ctr[x.idx].x - 540) / 700 }));
  const duration = plan.end + 1.4;
  return {
    duration,
    audio,
    draw(ctx, t) {
      const k = lastLE(tt, t);
      const glow = new Float32Array(n);
      const dep = new Float32Array(n);
      for (let j = k; j >= 0 && j > k - 30; j--) {
        const dt = t - tt[j];
        if (dt > 0.7) break;
        const b = rankOf(notes[j].f);
        glow[b] = Math.max(glow[b], 1 - dt / 0.7);
        dep[b] = Math.max(dep[b], Math.max(0, 1 - dt / 0.15));
      }
      for (let i = 0; i < n; i++) {
        const b = bars[i];
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.a);
        ctx.translate(0, dep[i] * 12);
        if (glow[i] > 0.05) halo(ctx, 0, 20, b.w * 1.6, hsl(b.hue, 100, 65), glow[i] * 0.8);
        ctx.fillStyle = hsl(b.hue, 80, 42 + glow[i] * 26);
        rrect(ctx, -b.w / 2, 0, b.w, b.len, 14);
        ctx.fill();
        ctx.fillStyle = hsl(b.hue, 100, 78, 0.55 + glow[i] * 0.4);
        rrect(ctx, -b.w / 2 + 4, 4, b.w - 8, 12, 6);
        ctx.fill();
        ctx.restore();
      }
      for (let j = k; j >= 0 && j > k - 30; j--) {
        const dt = t - tt[j];
        if (dt > 0.6) break;
        const b = ctr[j];
        for (let s = 0; s < 7; s++) {
          const ang = -Math.PI / 2 + b.a + (hash(j, s) - 0.5) * 2.6;
          const d = easeOut(dt / 0.6) * (70 + hash(j, s + 9) * 90);
          const px = b.x + Math.cos(ang) * d;
          const py = b.y + Math.sin(ang) * d;
          ctx.fillStyle = hsl(b.hue, 100, 78, 1 - dt / 0.6);
          ctx.beginPath();
          ctx.arc(px, py, 6 * (1 - dt / 0.6) + 1, 0, TAU);
          ctx.fill();
        }
      }
      const hue = ctr[Math.max(0, k)].hue;
      for (let j = 10; j >= 1; j--) {
        const [x, y] = ballAt(Math.max(0, t - j * 0.022));
        ctx.fillStyle = hsl(hue, 90, 70, 0.32 * (1 - j / 11));
        ctx.beginPath();
        ctx.arc(x, y, R * (1 - j / 14), 0, TAU);
        ctx.fill();
      }
      const [bx, by] = ballAt(t);
      const sq = k >= 0 ? Math.max(0, 1 - (t - tt[k]) / 0.09) : 0;
      ctx.save();
      ctx.translate(bx, by + R * 0.2 * sq);
      ctx.scale(1 + 0.22 * sq, 1 - 0.22 * sq);
      ball(ctx, 0, 0, R, hsl(hue, 90, 72));
      ctx.restore();
      labels(ctx, plan, p.song.name, t, tt, '#ffd166');
    },
  };
};

/* ---------- 2. Rain of balls on piano-like keys ---------- */
export const buildRain: Builder = (_c, p) => {
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup });
  const { notes } = plan;
  const { n, rankOf } = ranks(plan);
  const sp = 920 / n;
  const kw = Math.min(80, sp - 6);
  const R = Math.min(28, kw / 2 - 2);
  const xs = Array.from({ length: n }, (_, i) => 80 + sp * (i + 0.5));
  const tt = notes.map((x) => x.t);
  const Tf = Math.min(p.fall ?? 0.9, 0.85);
  const hitY = 1240;
  const top = 340;
  const hueOf = (i: number) => (n > 1 ? (i / (n - 1)) * 300 : 150);
  const audio: AudioEvent[] = notes.map((x) => ({ t: x.t, f: x.f, voice: p.voice ?? 'bell', v: 0.85, pan: (xs[rankOf(x.f)] - 540) / 700 }));
  return {
    duration: plan.end + 1.4,
    audio,
    draw(ctx, t) {
      const k = lastLE(tt, t + Tf);
      const glow = new Float32Array(n);
      for (let j = k; j >= 0; j--) {
        const dt = t - tt[j];
        if (dt > 0.9) break;
        if (dt >= 0) glow[rankOf(notes[j].f)] = Math.max(glow[rankOf(notes[j].f)], 1 - dt / 0.6);
      }
      for (let i = 0; i < n; i++) {
        const g = ctx.createLinearGradient(0, top, 0, hitY);
        g.addColorStop(0, hsl(hueOf(i), 90, 60, 0));
        g.addColorStop(1, hsl(hueOf(i), 90, 60, 0.22));
        ctx.fillStyle = g;
        ctx.fillRect(xs[i] - kw / 2, top, kw, hitY - top);
        if (glow[i] > 0) halo(ctx, xs[i], hitY, kw * 1.4, hsl(hueOf(i), 100, 65), glow[i]);
        ctx.fillStyle = hsl(hueOf(i), 75, 38 + glow[i] * 32);
        rrect(ctx, xs[i] - kw / 2, hitY + 6, kw, 270 + glow[i] * 0, 16);
        ctx.fill();
        ctx.fillStyle = hsl(hueOf(i), 100, 85, 0.5 + glow[i] * 0.4);
        rrect(ctx, xs[i] - kw / 2 + 4, hitY + 10, kw - 8, 12, 6);
        ctx.fill();
      }
      for (let j = k; j >= 0; j--) {
        const dt = t - tt[j];
        if (dt > 0.85) break;
        const r = rankOf(notes[j].f);
        const col = hsl(hueOf(r), 95, 68);
        let y: number;
        let alpha = 1;
        if (dt < 0) {
          const s = (t - (tt[j] - Tf)) / Tf;
          y = lerp(top, hitY - R, s * s);
          const g = ctx.createLinearGradient(0, y - 120 * s, 0, y);
          g.addColorStop(0, hsl(hueOf(r), 95, 68, 0));
          g.addColorStop(1, hsl(hueOf(r), 95, 68, 0.5));
          ctx.fillStyle = g;
          ctx.fillRect(xs[r] - R * 0.7, y - 120 * s, R * 1.4, 120 * s);
        } else {
          const u = clamp(dt / 0.4, 0, 1);
          y = hitY - R - 4 * 55 * u * (1 - u);
          alpha = 1 - clamp((dt - 0.35) / 0.45, 0, 1);
        }
        ctx.globalAlpha = alpha;
        ball(ctx, xs[r], y, R, col, 2);
        ctx.globalAlpha = 1;
      }
      labels(ctx, plan, p.song.name, t, tt, '#ffd166');
    },
  };
};

/* ---------- 3. Ball inside a ring draws a star while playing ---------- */
export const buildRing: Builder = (_c, p) => {
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup });
  const { notes } = plan;
  const CX = 540, CY = 900, RR = 420;
  const step = (TAU * p.k) / p.m + (p.drift ?? 0);
  const tt = notes.map((x) => x.t);
  const P = notes.map((_, j) => {
    const a = -Math.PI / 2 + j * step;
    return { x: CX + RR * Math.cos(a), y: CY + RR * Math.sin(a), a };
  });
  const pos = (t: number): [number, number] => {
    if (t <= tt[0]) { const s = t / tt[0]; return [lerp(CX, P[0].x, s), lerp(CY, P[0].y, s)]; }
    const k = lastLE(tt, t);
    if (k >= notes.length - 1) return [P[k].x, P[k].y];
    const s = (t - tt[k]) / (tt[k + 1] - tt[k]);
    return [lerp(P[k].x, P[k + 1].x, s), lerp(P[k].y, P[k + 1].y, s)];
  };
  const audio: AudioEvent[] = notes.map((x, j) => ({ t: x.t, f: x.f, voice: p.voice ?? 'bell', v: 0.85, pan: (P[j].x - CX) / 600 }));
  return {
    duration: plan.end + 1.6,
    audio,
    draw(ctx, t) {
      const k = lastLE(tt, t);
      halo(ctx, CX, CY, RR * 1.15, '#ffffff', 0.05);
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.5;
      for (let j = 0; j < k; j++) {
        ctx.strokeStyle = hsl(j * 9, 90, 65, 0.5);
        ctx.beginPath();
        ctx.moveTo(P[j].x, P[j].y);
        ctx.lineTo(P[j + 1].x, P[j + 1].y);
        ctx.stroke();
      }
      const [bx, by] = pos(t);
      if (k >= 0) {
        ctx.strokeStyle = hsl(k * 9, 95, 72, 0.9);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(P[k].x, P[k].y);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(CX, CY, RR + 12, 0, TAU);
      ctx.stroke();
      for (let j = k; j >= 0 && j > k - 14; j--) {
        const dt = t - tt[j];
        if (dt > 0.55) break;
        const f = 1 - dt / 0.55;
        ctx.strokeStyle = hsl(j * 9, 100, 70, f);
        ctx.lineWidth = 8 + 16 * f;
        ctx.beginPath();
        ctx.arc(CX, CY, RR + 12, P[j].a - 0.13, P[j].a + 0.13);
        ctx.stroke();
        ctx.strokeStyle = hsl(j * 9, 100, 80, f * 0.7);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(P[j].x, P[j].y, 20 + 70 * easeOut(dt / 0.55), 0, TAU);
        ctx.stroke();
      }
      ball(ctx, bx, by, 26, hsl(Math.max(0, k) * 9, 90, 75));
      labels(ctx, plan, p.song.name, t, tt, '#ffd166');
    },
  };
};

/* ---------- 4. Every bounce adds a ball (and a note) ---------- */
export const buildMultiply: Builder = (c, p) => {
  const D: number = p.duration ?? 26;
  const cap: number = p.cap ?? 70;
  const g: number = p.gravity ?? 0;
  const R0 = 430, CX = 540, CY = 900;
  const br: number = p.ballR ?? 19;
  const speed: number = p.speed ?? 650;
  const plan = planNotes(p.song, { target: 26, rounds: 1 });
  const fs = plan.notes.map((n) => n.f);
  const rng = c.rng;
  const dt = 1 / 240;
  const steps = Math.floor(D * 240);
  const bx: number[] = [], by: number[] = [], vx: number[] = [], vy: number[] = [];
  const spawn = (x: number, y: number, a: number) => {
    bx.push(x); by.push(y); vx.push(Math.cos(a) * speed); vy.push(Math.sin(a) * speed);
  };
  spawn(CX, CY - 160, rng() * TAU);
  const frames: Float32Array[] = [];
  const hitsT: number[] = [];
  const hitsA: number[] = [];
  const audio: AudioEvent[] = [];
  const gap = (D * 0.8) / (cap - 1);
  let lastSpawn = -1, lastSound = -1, hi = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i * dt;
    if (i % 4 === 0) {
      const arr = new Float32Array(bx.length * 2);
      for (let b = 0; b < bx.length; b++) { arr[b * 2] = bx[b]; arr[b * 2 + 1] = by[b]; }
      frames.push(arr);
    }
    const nb = bx.length;
    for (let b = 0; b < nb; b++) {
      vy[b] += g * dt;
      bx[b] += vx[b] * dt;
      by[b] += vy[b] * dt;
      const dx = bx[b] - CX, dy = by[b] - CY;
      const d = Math.hypot(dx, dy);
      if (d > R0 - br) {
        const nx = dx / d, ny = dy / d;
        bx[b] = CX + nx * (R0 - br);
        by[b] = CY + ny * (R0 - br);
        const vn = vx[b] * nx + vy[b] * ny;
        if (vn > 0) {
          vx[b] -= 2 * vn * nx;
          vy[b] -= 2 * vn * ny;
          const rot = (rng() - 0.5) * 0.12;
          const cs = Math.cos(rot), sn = Math.sin(rot);
          const ux = vx[b] * cs - vy[b] * sn;
          vy[b] = vx[b] * sn + vy[b] * cs;
          vx[b] = ux;
          hitsT.push(t);
          hitsA.push(Math.atan2(ny, nx));
          if (t - lastSound >= 0.05) {
            audio.push({ t, f: fs[hi % fs.length], voice: 'marimba', v: 0.7, pan: nx * 0.6 });
            hi++;
            lastSound = t;
          }
          if (bx.length < cap && t - lastSpawn >= gap) {
            lastSpawn = t;
            spawn(bx[b], by[b], Math.atan2(-ny, -nx) + (rng() - 0.5) * 1.6);
          }
        }
      }
    }
  }
  return {
    duration: D + 1,
    audio,
    draw(ctx, t) {
      const f = clamp(Math.floor(t * 60), 0, frames.length - 1);
      const cur = frames[f];
      const count = cur.length / 2;
      const hk = lastLE(hitsT, t);
      ctx.lineWidth = 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(CX, CY, R0 + 8, 0, TAU);
      ctx.stroke();
      for (let j = hk; j >= 0 && j > hk - 80; j--) {
        const age = t - hitsT[j];
        if (age > 0.35) break;
        const fa = 1 - age / 0.35;
        ctx.strokeStyle = hsl(hitsA[j] * 57, 100, 70, fa);
        ctx.lineWidth = 6 + 12 * fa;
        ctx.beginPath();
        ctx.arc(CX, CY, R0 + 8, hitsA[j] - 0.06, hitsA[j] + 0.06);
        ctx.stroke();
      }
      ctx.lineCap = 'round';
      for (let tr = 1; tr <= 4; tr++) {
        const pf = frames[Math.max(0, f - tr)];
        ctx.lineWidth = br * 1.2 * (1 - tr / 5);
        for (let b = 0; b < Math.min(count, pf.length / 2); b++) {
          ctx.strokeStyle = hsl(b * 47, 90, 65, 0.16);
          ctx.beginPath();
          ctx.moveTo(pf[b * 2], pf[b * 2 + 1]);
          ctx.lineTo(cur[b * 2], cur[b * 2 + 1]);
          ctx.stroke();
        }
      }
      for (let b = 0; b < count; b++) ball(ctx, cur[b * 2], cur[b * 2 + 1], br, hsl(b * 47, 90, 66), 1.8);
      text(ctx, '×' + count, 540, 1470, 170, '#ffffff', { alpha: 0.95 });
      text(ctx, 'BALLS', 540, 1590, 48, '#ffd166');
      text(ctx, '♪ ' + p.song.name, 540, 1690, 44, '#ffffff', { alpha: 0.7 });
    },
  };
};
