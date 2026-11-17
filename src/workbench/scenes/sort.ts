import type { AudioEvent, BuildCtx, Builder, Scene } from '../engine/types';
import { TAU, ball, clamp, halo, lastLE, mulberry32, pal, rrect, scaleFreqs, text } from '../engine/util';

type PegLayout = 'grid' | 'stagger' | 'funnel' | 'diamond';

/* Plinko-style ball sorter with real peg physics + colour-guided beams */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function plinkoOnce(c: BuildCtx, p: any): { scene: Scene; ok: boolean } {
  const theme = c.theme;
  const n: number = p.balls ?? 16;
  const nb: number = p.bins ?? 4;
  const rng = c.rng;
  const R = clamp(880 / n / 2 - 1, 14, 26);
  const pr = 9;
  const G = 2000;
  const gap: number = p.gap ?? 0.42;
  const bTop = 1300, floorY = 1500, bw = 880 / nb;
  const pegs: [number, number][] = [];
  const rows = p.rows ?? 7;
  const pegLayout = (p.pegLayout ?? 'stagger') as PegLayout;

  for (let r = 0; r < rows; r++) {
    const y = 560 + r * 90;
    if (pegLayout === 'grid') {
      for (let x = 115; x <= 965; x += 110) pegs.push([x, y]);
    } else if (pegLayout === 'funnel') {
      const margin = Math.abs(r - (rows - 1) / 2) * 58;
      for (let x = 90 + margin; x <= 990 - margin; x += 110) pegs.push([x, y]);
    } else if (pegLayout === 'diamond') {
      const halfSpan = 160 + (rows / 2 - Math.abs(r - (rows - 1) / 2)) * 92;
      for (let x = Math.max(95, 540 - halfSpan); x <= Math.min(985, 540 + halfSpan); x += 108) pegs.push([x, y]);
    } else {
      const off = r % 2 ? 55 : 0;
      for (let x = 90 + off; x <= 990; x += 110) pegs.push([x, y]);
    }
  }

  const binCols = Array.from({ length: nb }, (_, b) => pal(theme, b));
  const colors = Array.from({ length: n }, (_, i) => i % nb);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [colors[i], colors[j]] = [colors[j], colors[i]]; }
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const tr = order.map((o) => 0.9 + o * gap);
  const keys = colors.map((cl) => cl + (rng() - 0.5) * nb * 1.1);
  const slotOrder = keys.map((_, i) => i).sort((a, b) => keys[a] - keys[b]);
  const slotOf = new Array(n).fill(0);
  slotOrder.forEach((bIdx, k) => { slotOf[bIdx] = k; });
  const x = Array.from({ length: n }, (_, i) => 90 + (slotOf[i] + 0.5) * (900 / n));
  const y = new Array(n).fill(420);
  const vx = new Array(n).fill(0), vy = new Array(n).fill(0);
  const landed = new Array(n).fill(false);
  const scaleIdx: number = p.scale ?? 0;
  const voice: AudioEvent['voice'] = p.voice ?? 'marimba';
  const scale = scaleFreqs(scaleIdx, 293.66, 14);
  const audio: AudioEvent[] = [];
  const frames: Float32Array[] = [];
  const landedAt: number[] = [];
  const total = 0.9 + n * gap + 5.5;
  const dt = 1 / 240;
  const lastHit = new Array(n).fill(-1);
  let tAll = -1;
  let cnt = 0;
  const binX = (b: number) => 100 + (b + 0.5) * bw;
  for (let s = 0; s <= total * 240; s++) {
    const t = s * dt;
    if (s % 4 === 0) {
      const arr = new Float32Array(n * 2 + 1);
      for (let i = 0; i < n; i++) { arr[i * 2] = x[i]; arr[i * 2 + 1] = y[i]; }
      arr[n * 2] = cnt;
      frames.push(arr);
    }
    for (let i = 0; i < n; i++) {
      if (t < tr[i]) continue;
      vy[i] += G * dt;
      if (y[i] > 560 && !landed[i]) {
        const w = clamp((y[i] - 560) / 200, 0, 1) * (y[i] > bTop ? 0.6 : 1);
        const des = clamp((binX(colors[i]) - x[i]) * 7, -1100, 1100);
        vx[i] += (des - vx[i]) * Math.min(1, w * 14 * dt);
      }
      if (y[i] < bTop && Math.abs(vx[i]) + Math.abs(vy[i]) < 30 && t > tr[i] + 0.4) vx[i] += (rng() - 0.5) * 400;
      x[i] += vx[i] * dt;
      y[i] += vy[i] * dt;
      for (const [px, py] of pegs) {
        const dy = y[i] - py;
        if (dy > R + pr || dy < -(R + pr)) continue;
        const dx = x[i] - px;
        const d = Math.hypot(dx, dy);
        if (d < R + pr && d > 0) {
          const nx = dx / d, ny = dy / d;
          x[i] = px + nx * (R + pr);
          y[i] = py + ny * (R + pr);
          const vn = vx[i] * nx + vy[i] * ny;
          if (vn < 0) {
            vx[i] -= 1.55 * vn * nx;
            vy[i] -= 1.55 * vn * ny;
            vx[i] += (rng() - 0.5) * 50;
            if (-vn > 140 && t - lastHit[i] > 0.04) {
              lastHit[i] = t;
              const col = Math.round((px - 90) / 55);
              audio.push({ t, f: scale[clamp(col, 0, scale.length - 1)], voice, v: clamp(-vn / 900, 0.12, 0.6), pan: (px - 540) / 600 });
            }
          }
        }
      }
      if (x[i] < 70 + R) { x[i] = 70 + R; vx[i] = Math.abs(vx[i]) * 0.5; }
      if (x[i] > 1010 - R) { x[i] = 1010 - R; vx[i] = -Math.abs(vx[i]) * 0.5; }
      if (y[i] > bTop - R) {
        for (let k = 0; k <= nb; k++) {
          const xd = 100 + k * bw;
          const cy = clamp(y[i], bTop, floorY);
          const dx = x[i] - xd, dy = y[i] - cy;
          const d = Math.hypot(dx, dy);
          if (d < R + 4 && d > 0) {
            const nx = dx / d, ny = dy / d;
            x[i] = xd + nx * (R + 4);
            y[i] = cy + ny * (R + 4);
            const vn = vx[i] * nx + vy[i] * ny;
            if (vn < 0) { vx[i] -= 1.3 * vn * nx; vy[i] -= 1.3 * vn * ny; }
          }
        }
      }
      if (y[i] > floorY - R) {
        y[i] = floorY - R;
        vy[i] = Math.abs(vy[i]) < 80 ? 0 : -vy[i] * 0.25;
        vx[i] *= 0.88;
      }
      if (!landed[i] && y[i] > 1390) {
        landed[i] = true;
        cnt++;
        landedAt.push(t);
        audio.push({ t, f: scale[colors[i] * 2 + 2], voice: 'celesta', v: 0.7, pan: (x[i] - 540) / 600 });
        audio.push({ t, f: 110, voice: 'thud', v: 0.45 });
        if (cnt === n) tAll = t;
      }
    }
    for (let i = 0; i < n; i++) {
      if (t < tr[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (t < tr[j]) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i];
        const d = Math.hypot(dx, dy);
        if (d < 2 * R && d > 0) {
          const nx = dx / d, ny = dy / d;
          const o = (2 * R - d) / 2;
          x[i] -= nx * o; y[i] -= ny * o; x[j] += nx * o; y[j] += ny * o;
          const vn = (vx[i] - vx[j]) * nx + (vy[i] - vy[j]) * ny;
          if (vn > 0) {
            const imp = (1.4 * vn) / 2;
            vx[i] -= imp * nx; vy[i] -= imp * ny; vx[j] += imp * nx; vy[j] += imp * ny;
          }
        }
      }
    }
  }
  const ok = cnt === n && colors.every((cl, i) => Math.floor((x[i] - 100) / bw) === cl && y[i] > 1300);
  const duration = tAll > 0 ? Math.min(total, tAll + 2.4) : total;
  const chord = [0, 2, 4, 6].map((k) => scale[k + 2] * 2);
  chord.forEach((f, k) => audio.push({ t: (tAll > 0 ? tAll : total - 2) + 0.6 + k * 0.08, f, voice: 'celesta', v: 0.55 }));
  const scene: Scene = {
    duration,
    audio,
    draw(ctx, t) {
      const f = clamp(Math.floor(t * 60), 0, frames.length - 1);
      const cur = frames[f];
      for (let b = 0; b < nb; b++) {
        ctx.save();
        ctx.globalAlpha = theme.isLight ? 0.14 : 0.2;
        ctx.strokeStyle = binCols[b];
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.moveTo(540, 640);
        ctx.bezierCurveTo(540, 1000, binX(b), 1000, binX(b), bTop);
        ctx.stroke();
        ctx.restore();
      }
      ctx.fillStyle = theme.ink;
      ctx.save();
      ctx.globalAlpha = theme.isLight ? 0.72 : 0.8;
      for (const [px, py] of pegs) { ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill(); }
      ctx.restore();
      ctx.fillStyle = theme.muted;
      rrect(ctx, 70, 420 + R + 4, 940, 10, 5);
      ctx.fill();
      for (let b = 0; b < nb; b++) {
        ctx.save();
        ctx.globalAlpha = theme.isLight ? 0.12 : 0.18;
        ctx.fillStyle = binCols[b];
        rrect(ctx, 100 + b * bw + 6, bTop, bw - 12, floorY - bTop + 6, 14);
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = binCols[b];
        ctx.lineWidth = 5;
        rrect(ctx, 100 + b * bw + 6, bTop, bw - 12, floorY - bTop + 6, 14);
        ctx.stroke();
      }
      const lk = lastLE(landedAt, t);
      if (!theme.isLight && lk >= 0 && t - landedAt[lk] < 0.4) {
        halo(ctx, 540, 1400, 460, theme.ink, 0.1 * (1 - (t - landedAt[lk]) / 0.4));
      }
      for (let i = 0; i < n; i++) ball(ctx, cur[i * 2], cur[i * 2 + 1], R, binCols[colors[i]], 1.4, theme.isLight);
      const done = cur[n * 2];
      const allDone = done === n && tAll > 0 && t > tAll + 0.5;
      text(ctx, allDone ? '✓ ALL SORTED' : `${done} / ${n} SORTED`, 540, 1620, 62, allDone ? theme.successInk : theme.ink);
      text(ctx, `${n} spheres · ${nb} bins · ${pegLayout} matrix`, 540, 1700, 36, theme.subInk, { weight: 600 });
    },
  };
  return { scene, ok };
}

export const buildPlinko: Builder = (c, p) => {
  let last = plinkoOnce(c, p);
  for (let a = 1; a < 10 && !last.ok; a++) last = plinkoOnce({ ...c, rng: mulberry32(c.seed * 131 + a * 7919) }, p);
  return last.scene;
};
