import type { Builder, Scene, VideoSpec } from '../engine/types';
import { THEMES, mulberry32 } from '../engine/util';
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
  return THEMES[spec.theme % THEMES.length];
}

export function buildScene(spec: VideoSpec): Scene {
  const b = BUILDERS[spec.engine];
  if (!b) throw new Error('unknown engine ' + spec.engine);
  return b({ rng: mulberry32(spec.seed), theme: themeOf(spec), seed: spec.seed }, spec.params);
}
