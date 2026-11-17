import type { Builder, Scene, VideoSpec } from '../engine/types';
import { clampTempoScale, MELODY_ENGINES } from '../engine/presets';
import { THEMES, mulberry32 } from '../engine/util';
import { songById } from '../catalog/songs';
import { buildHop, buildMultiply, buildRain, buildRing } from './melody';
import { buildPlinko } from './sort';
import { buildSorting } from './sorting';
import { buildOrbits, buildPendWave, buildPi } from './analytic1';
import { buildEpicycle, buildLissa, buildPhyllo, buildSpiro, buildTimes } from './analytic2';
import { buildDPend, buildGalton, buildLorenz, buildRace, buildSieve } from './sim';

export const BUILDERS: Record<string, Builder> = {
  hop: buildHop,
  rain: buildRain,
  ring: buildRing,
  multiply: buildMultiply,
  plinko: buildPlinko,
  sorting: buildSorting,
  pendwave: buildPendWave,
  orbits: buildOrbits,
  pi: buildPi,
  spiro: buildSpiro,
  lissa: buildLissa,
  epicycle: buildEpicycle,
  times: buildTimes,
  phyllo: buildPhyllo,
  dpend: buildDPend,
  lorenz: buildLorenz,
  galton: buildGalton,
  race: buildRace,
  sieve: buildSieve,
};

export function themeOf(spec: VideoSpec) {
  return THEMES[((spec.theme % THEMES.length) + THEMES.length) % THEMES.length];
}

function normalizeParams(engine: string, rawParams: unknown): Record<string, unknown> {
  const p = rawParams && typeof rawParams === 'object' ? { ...(rawParams as Record<string, unknown>) } : {};
  if (MELODY_ENGINES.has(engine)) {
    const curSong = p.song as { id?: string; name?: string; notes?: string } | string | undefined;
    if (typeof curSong === 'string') {
      p.song = songById(curSong);
    } else if (curSong && typeof curSong === 'object' && (!curSong.notes || !curSong.name) && curSong.id) {
      p.song = songById(curSong.id);
    } else if (!curSong) {
      p.song = songById('canon');
    }
  }
  return p;
}

export function buildScene(spec: VideoSpec): Scene {
  const b = BUILDERS[spec.engine];
  if (!b) throw new Error('unknown engine ' + spec.engine);
  const p = normalizeParams(spec.engine, spec.params);
  const raw = b({ rng: mulberry32(spec.seed), theme: themeOf(spec), seed: spec.seed }, p);

  const tempoScale = clampTempoScale(p.tempoScale);
  const echo = typeof p.echo === 'boolean' ? p.echo : raw.echo;
  const transpose = typeof p.transpose === 'number' && Number.isFinite(p.transpose) ? p.transpose : 0;
  const applyExtraTranspose = !MELODY_ENGINES.has(spec.engine) && transpose !== 0;

  if (Math.abs(tempoScale - 1) < 0.001 && echo === raw.echo && !applyExtraTranspose) {
    return raw;
  }

  const pitchMul = applyExtraTranspose ? Math.pow(2, transpose / 12) : 1;
  const duration = Math.max(4, raw.duration / tempoScale);
  const audio = raw.audio.map((ev) => ({
    ...ev,
    t: ev.t / tempoScale,
    f: applyExtraTranspose ? ev.f * pitchMul : ev.f,
    d: typeof ev.d === 'number' ? ev.d / tempoScale : undefined,
  }));

  return {
    duration,
    audio,
    echo,
    draw(ctx, t) {
      raw.draw(ctx, Math.min(raw.duration, Math.max(0, t * tempoScale)));
    },
  };
}
