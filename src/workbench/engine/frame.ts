import { FONT, clamp } from './util';
import type { Ctx, Scene, Theme } from './types';
import { H, W } from './types';

function wrap(ctx: Ctx, s: string, maxW: number): string[] {
  const words = s.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? cur + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawStageBackground(ctx: Ctx, theme: Theme) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (theme.style === 'paper') {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    for (let x = 60; x < W; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 60; y < H; y += 60) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // Minimal Swiss corner registration ticks
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 2.5;
    for (const [cx, cy, dx, dy] of [
      [36, 36, 26, 26],
      [W - 36, 36, -26, 26],
      [36, H - 36, 26, -26],
      [W - 36, H - 36, -26, -26],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + dy);
      ctx.stroke();
    }
  } else if (theme.style === 'blueprint') {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1;
    for (let x = 45; x < W; x += 45) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    for (let y = 45; y < H; y += 45) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 2;
    ctx.strokeRect(28, 28, W - 56, H - 56);
  } else if (theme.style === 'oscilloscope') {
    ctx.strokeStyle = theme.grid;
    ctx.lineWidth = 1.5;
    for (let x = 90; x < W; x += 90) {
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, H - 60);
      ctx.stroke();
    }
    for (let y = 90; y < H; y += 90) {
      ctx.beginPath();
      ctx.moveTo(40, y);
      ctx.lineTo(W - 40, y);
      ctx.stroke();
    }
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(W / 2, 80);
    ctx.lineTo(W / 2, H - 80);
    ctx.moveTo(60, 900);
    ctx.lineTo(W - 60, 900);
    ctx.stroke();
  } else if (theme.style === 'bauhaus') {
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(64, 92);
    ctx.lineTo(W - 64, 92);
    ctx.moveTo(64, H - 96);
    ctx.lineTo(W - 64, H - 96);
    ctx.stroke();
  } else {
    const rg = ctx.createRadialGradient(W / 2, 900, 140, W / 2, 900, 1050);
    rg.addColorStop(0, 'rgba(255,255,255,0.045)');
    rg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(36, 36, W - 72, H - 72);
  }
}

export function drawFrame(ctx: Ctx, scene: Scene, theme: Theme, hook: string, t: number) {
  drawStageBackground(ctx, theme);
  ctx.save();
  scene.draw(ctx, t);
  ctx.restore();
  if (hook) {
    ctx.save();
    ctx.font = `800 66px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lines = wrap(ctx, hook, 920);
    if (lines.length > 2) {
      ctx.font = `800 54px ${FONT}`;
      lines = wrap(ctx, hook, 940);
    }
    const a = clamp(t / 0.45, 0, 1);
    ctx.globalAlpha = a;
    if (!theme.isLight) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 8;
    }
    ctx.fillStyle = theme.ink;
    const lh = 76;
    const y0 = 192 - ((lines.length - 1) * lh) / 2 + (1 - a) * -14;
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    ctx.restore();
  }
}
