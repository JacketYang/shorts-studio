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

export function drawFrame(ctx: Ctx, scene: Scene, theme: Theme, hook: string, t: number) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  const rg = ctx.createRadialGradient(W / 2, 900, 100, W / 2, 900, 1100);
  rg.addColorStop(0, 'rgba(255,255,255,0.07)');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  scene.draw(ctx, t);
  ctx.restore();
  if (hook) {
    ctx.save();
    ctx.font = `900 70px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let lines = wrap(ctx, hook, 930);
    if (lines.length > 2) {
      ctx.font = `900 58px ${FONT}`;
      lines = wrap(ctx, hook, 950);
    }
    const a = clamp(t / 0.5, 0, 1);
    ctx.globalAlpha = a;
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 18;
    ctx.fillStyle = theme.ink;
    const lh = 82;
    const y0 = 190 - ((lines.length - 1) * lh) / 2 + (1 - a) * -20;
    lines.slice(0, 3).forEach((l, i) => ctx.fillText(l, W / 2, y0 + i * lh));
    ctx.restore();
  }
}
