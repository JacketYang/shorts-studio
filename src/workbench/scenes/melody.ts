import type { AudioEvent, Builder, Ctx, Theme } from '../engine/types';
import { planNotes } from '../engine/music';
import type { Plan } from '../engine/music';
import { TAU, ball, clamp, easeOut, halo, hash, hsl, lastLE, lerp, pal, rrect, text } from '../engine/util';

function ranks(plan: Plan) {
  const fs = [...new Set(plan.notes.map((n) => Math.round(n.f * 100)))].sort((a, b) => a - b);
  return { n: fs.length, rankOf: (f: number) => fs.indexOf(Math.round(f * 100)) };
}

function noteColor(theme: Theme, i: number, total: number, glow = 0): string {
  if (theme.style === 'bauhaus' || theme.style === 'paper') {
    return pal(theme, i);
  }
  const k = total > 1 ? i / (total - 1) : 0.5;
  const hue = (k * 290 + (theme.style === 'blueprint' ? 165 : theme.style === 'oscilloscope' ? 115 : 0)) % 360;
  return hsl(hue, theme.isLight ? 74 : 82, theme.isLight ? 44 + glow * 12 : 48 + glow * 22);
}

function labels(ctx: Ctx, plan: Plan, name: string, t: number, tt: number[], theme: Theme) {
  text(ctx, '♪ ' + name, 540, 1650, 50, theme.ink, { alpha: 0.88, weight: 700 });
  if (plan.rounds > 1 && plan.notes[plan.notes.length - 1].speed !== 1) {
    const k = Math.max(0, lastLE(tt, t));
    const nn = plan.notes[k];
    text(ctx, `ROUND ${nn.round + 1}/${plan.rounds}  ·  ${nn.speed.toFixed(1)}× SPEED`, 540, 1575, 42, theme.accentInk);
  }
}

/* ---------- 1. Ball hops across xylophone bars ---------- */
export const buildHop: Builder = (c, p) => {
  const theme = c.theme;
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup, transpose: p.transpose ?? 0 });
  const { notes } = plan;
  const { n, rankOf } = ranks(plan);
  const R = p.ballR ?? 30;
  const layout = (p.layout ?? 'flat') as 'flat' | 'stairs' | 'arc' | 'wave';
  interface Bar { x: number; y: number; a: number; len: number; w: number; col: string; cx: number; cy: number }
  const bars: Bar[] = [];
  for (let i = 0; i < n; i++) {
    const k = n > 1 ? i / (n - 1) : 0.5;
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
      else if (layout === 'wave') { y = 960 - Math.sin(k * Math.PI * 1.8) * 260; len = 1480 - y; }
      else { y = 1330 - k * 640; len = 1500 - y; }
    }
    bars.push({ x, y, a, len, w, col: noteColor(theme, i, n), cx: x + Math.sin(a) * R, cy: y - Math.cos(a) * R });
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
  const voice = p.voice ?? 'marimba';
  const audio: AudioEvent[] = notes.map((x) => ({ t: x.t, f: x.f, voice, v: 0.9, pan: (ctr[x.idx].x - 540) / 700 }));
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
        if (!theme.isLight && glow[i] > 0.05) halo(ctx, 0, 20, b.w * 1.4, b.col, glow[i] * 0.45);
        ctx.fillStyle = glow[i] > 0.1 ? noteColor(theme, i, n, glow[i]) : b.col;
        rrect(ctx, -b.w / 2, 0, b.w, b.len, 14);
        ctx.fill();
        if (theme.isLight) {
          ctx.strokeStyle = theme.muted;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = theme.isLight ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.32)';
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
          ctx.save();
          ctx.globalAlpha = 1 - dt / 0.6;
          ctx.fillStyle = b.col;
          ctx.beginPath();
          ctx.arc(px, py, 5 * (1 - dt / 0.6) + 1.5, 0, TAU);
          ctx.fill();
          ctx.restore();
        }
      }
      const ballCol = ctr[Math.max(0, k)].col;
      for (let j = 9; j >= 1; j--) {
        const [x, y] = ballAt(Math.max(0, t - j * 0.022));
        ctx.save();
        ctx.globalAlpha = (theme.isLight ? 0.18 : 0.28) * (1 - j / 10);
        ctx.fillStyle = ballCol;
        ctx.beginPath();
        ctx.arc(x, y, R * (1 - j / 14), 0, TAU);
        ctx.fill();
        ctx.restore();
      }
      const [bx, by] = ballAt(t);
      const sq = k >= 0 ? Math.max(0, 1 - (t - tt[k]) / 0.09) : 0;
      ctx.save();
      ctx.translate(bx, by + R * 0.2 * sq);
      ctx.scale(1 + 0.22 * sq, 1 - 0.22 * sq);
      ball(ctx, 0, 0, R, ballCol, 1.8, theme.isLight);
      ctx.restore();
      labels(ctx, plan, p.song.name, t, tt, theme);
    },
  };
};

/* ---------- 2. Rain of balls on piano-like keys ---------- */
export const buildRain: Builder = (c, p) => {
  const theme = c.theme;
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup, transpose: p.transpose ?? 0 });
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
  const voice = p.voice ?? 'celesta';
  const audio: AudioEvent[] = notes.map((x) => ({ t: x.t, f: x.f, voice, v: 0.85, pan: (xs[rankOf(x.f)] - 540) / 700 }));
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
        const baseCol = noteColor(theme, i, n, glow[i]);
        ctx.save();
        ctx.globalAlpha = theme.isLight ? 0.08 : 0.14;
        ctx.fillStyle = baseCol;
        ctx.fillRect(xs[i] - kw / 2, top, kw, hitY - top);
        ctx.restore();

        if (!theme.isLight && glow[i] > 0) halo(ctx, xs[i], hitY, kw * 1.2, baseCol, glow[i] * 0.6);
        ctx.fillStyle = baseCol;
        rrect(ctx, xs[i] - kw / 2, hitY + 6, kw, 270, 16);
        ctx.fill();
        if (theme.isLight) {
          ctx.strokeStyle = theme.muted;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,0.42)';
        rrect(ctx, xs[i] - kw / 2 + 4, hitY + 10, kw - 8, 12, 6);
        ctx.fill();
      }
      for (let j = k; j >= 0; j--) {
        const dt = t - tt[j];
        if (dt > 0.85) break;
        const r = rankOf(notes[j].f);
        const col = noteColor(theme, r, n);
        let y: number;
        let alpha = 1;
        if (dt < 0) {
          const s = (t - (tt[j] - Tf)) / Tf;
          y = lerp(top, hitY - R, s * s);
          ctx.save();
          ctx.globalAlpha = theme.isLight ? 0.16 : 0.28;
          ctx.fillStyle = col;
          ctx.fillRect(xs[r] - R * 0.55, y - 110 * s, R * 1.1, 110 * s);
          ctx.restore();
        } else {
          const u = clamp(dt / 0.4, 0, 1);
          y = hitY - R - 4 * 55 * u * (1 - u);
          alpha = 1 - clamp((dt - 0.35) / 0.45, 0, 1);
        }
        ctx.globalAlpha = alpha;
        ball(ctx, xs[r], y, R, col, 1.8, theme.isLight);
        ctx.globalAlpha = 1;
      }
      labels(ctx, plan, p.song.name, t, tt, theme);
    },
  };
};

/* ---------- 3. Ball inside a ring draws a star while playing ---------- */
export const buildRing: Builder = (c, p) => {
  const theme = c.theme;
  const plan = planNotes(p.song, { target: p.target ?? 26, rounds: p.rounds, speedup: p.speedup, transpose: p.transpose ?? 0 });
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
  const voice = p.voice ?? 'kalimba';
  const audio: AudioEvent[] = notes.map((x, j) => ({ t: x.t, f: x.f, voice, v: 0.85, pan: (P[j].x - CX) / 600 }));
  return {
    duration: plan.end + 1.6,
    audio,
    draw(ctx, t) {
      const k = lastLE(tt, t);
      if (!theme.isLight) halo(ctx, CX, CY, RR * 1.1, theme.ink, 0.04);
      ctx.lineCap = 'round';
      ctx.lineWidth = 3.5;
      for (let j = 0; j < k; j++) {
        ctx.save();
        ctx.globalAlpha = theme.isLight ? 0.6 : 0.5;
        ctx.strokeStyle = noteColor(theme, j, Math.max(12, notes.length % 24 || 12));
        ctx.beginPath();
        ctx.moveTo(P[j].x, P[j].y);
        ctx.lineTo(P[j + 1].x, P[j + 1].y);
        ctx.stroke();
        ctx.restore();
      }
      const [bx, by] = pos(t);
      if (k >= 0) {
        ctx.strokeStyle = noteColor(theme, k, 12);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(P[k].x, P[k].y);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(CX, CY, RR + 12, 0, TAU);
      ctx.stroke();
      for (let j = k; j >= 0 && j > k - 14; j--) {
        const dt = t - tt[j];
        if (dt > 0.55) break;
        const f = 1 - dt / 0.55;
        const col = noteColor(theme, j, 12);
        ctx.save();
        ctx.globalAlpha = f;
        ctx.strokeStyle = col;
        ctx.lineWidth = 8 + 14 * f;
        ctx.beginPath();
        ctx.arc(CX, CY, RR + 12, P[j].a - 0.13, P[j].a + 0.13);
        ctx.stroke();
        ctx.globalAlpha = f * 0.65;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(P[j].x, P[j].y, 20 + 68 * easeOut(dt / 0.55), 0, TAU);
        ctx.stroke();
        ctx.restore();
      }
      ball(ctx, bx, by, 26, noteColor(theme, Math.max(0, k), 12), 1.8, theme.isLight);
      labels(ctx, plan, p.song.name, t, tt, theme);
    },
  };
};

/* ---------- 4. Every bounce adds a ball (and a note) ---------- */
export const buildMultiply: Builder = (c, p) => {
  const theme = c.theme;
  const D: number = p.duration ?? 26;
  const cap: number = p.cap ?? 70;
  const g: number = p.gravity ?? 0;
  const R0 = 430, CX = 540, CY = 900;
  const br: number = p.ballR ?? 19;
  const speed: number = p.speed ?? 650;
  const plan = planNotes(p.song, { target: 26, rounds: 1, transpose: p.transpose ?? 0 });
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
  const voice = p.voice ?? 'rhodes';
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
            audio.push({ t, f: fs[hi % fs.length], voice, v: 0.72, pan: nx * 0.6 });
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
      ctx.strokeStyle = theme.muted;
      ctx.beginPath();
      ctx.arc(CX, CY, R0 + 8, 0, TAU);
      ctx.stroke();
      for (let j = hk; j >= 0 && j > hk - 80; j--) {
        const age = t - hitsT[j];
        if (age > 0.35) break;
        const fa = 1 - age / 0.35;
        ctx.save();
        ctx.globalAlpha = fa;
        ctx.strokeStyle = noteColor(theme, Math.round((hitsA[j] + Math.PI) * 3), 12);
        ctx.lineWidth = 6 + 10 * fa;
        ctx.beginPath();
        ctx.arc(CX, CY, R0 + 8, hitsA[j] - 0.06, hitsA[j] + 0.06);
        ctx.stroke();
        ctx.restore();
      }
      ctx.lineCap = 'round';
      for (let tr = 1; tr <= 4; tr++) {
        const pf = frames[Math.max(0, f - tr)];
        ctx.lineWidth = br * 1.15 * (1 - tr / 5);
        for (let b = 0; b < Math.min(count, pf.length / 2); b++) {
          ctx.save();
          ctx.globalAlpha = theme.isLight ? 0.14 : 0.2;
          ctx.strokeStyle = noteColor(theme, b, 12);
          ctx.beginPath();
          ctx.moveTo(pf[b * 2], pf[b * 2 + 1]);
          ctx.lineTo(cur[b * 2], cur[b * 2 + 1]);
          ctx.stroke();
          ctx.restore();
        }
      }
      for (let b = 0; b < count; b++) ball(ctx, cur[b * 2], cur[b * 2 + 1], br, noteColor(theme, b, 12), 1.6, theme.isLight);
      text(ctx, '×' + count, 540, 1470, 165, theme.ink, { alpha: 0.95 });
      text(ctx, 'BALLS', 540, 1590, 44, theme.accentInk);
      text(ctx, '♪ ' + p.song.name, 540, 1690, 42, theme.subInk, { weight: 600 });
    },
  };
};
