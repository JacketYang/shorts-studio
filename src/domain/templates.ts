import { z } from 'zod';
import type { VideoSpec } from './types.ts';

export const MelodyBounceParamsSchema = z.object({
  arena: z.object({
    shape: z.enum(['circle', 'hexagon', 'triangle', 'ellipse', 'polygon']),
    size: z.number().min(0.4).max(0.95),
    wall_thickness: z.number().min(0.004).max(0.05),
    rotation_deg_per_s: z.number().min(-90).max(90),
  }),
  balls: z.object({
    count_start: z.number().int().min(1).max(16),
    radius: z.number().min(0.01).max(0.08),
    speed: z.number().min(0.1).max(2.0),
    restitution: z.number().min(0.7).max(1.15),
    gravity: z.number().min(-1.0).max(2.0),
    max_count: z.number().int().min(1).max(128),
  }),
  rule: z.object({
    type: z.enum(['split_on_bounce', 'grow_on_bounce', 'speed_up', 'shrink_wall', 'gravity_flip']),
    every_n_bounces: z.number().int().min(1).max(20).optional(),
    inherit_color: z.boolean().optional(),
    scale_factor: z.number().min(1.01).max(1.25).optional(),
  }),
  note_trigger: z.object({
    on: z.enum(['ball_wall_collision', 'ball_ball_collision', 'beat']),
    velocity_from: z.enum(['impact', 'fixed']),
  }),
});

export const BallSortParamsSchema = z.object({
  balls: z.object({
    count: z.number().int().min(4).max(64),
    colors: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).min(2).max(6),
  }),
  bins: z.object({
    count: z.number().int().min(2).max(6),
    layout: z.enum(['under-funnel', 'stepped', 'split-chute']),
  }),
  mechanism: z.object({
    pegs: z.object({
      rows: z.number().int().min(3).max(12),
      jitter: z.number().min(0).max(0.5),
    }),
    gates: z.array(
      z.object({
        type: z.enum(['moving', 'color-filter', 'spinner']),
        period_s: z.number().min(0.5).max(10).optional(),
        color_index: z.number().int().min(0).max(5).optional(),
      })
    ),
    spiral: z.object({
      enabled: z.boolean(),
    }),
  }),
  goal: z.object({
    type: z.enum(['sorted_by_color', 'race_to_fill']),
    celebrate: z.enum(['confetti-light', 'flash-ring', 'none']),
  }),
});

export const PendulumWaveParamsSchema = z.object({
  pendulum: z.object({
    count: z.number().int().min(6).max(24),
    length_min: z.number().min(0.2).max(0.55),
    length_step: z.number().min(0.01).max(0.06),
    max_angle_deg: z.number().min(20).max(75),
    damping: z.number().min(0).max(0.05),
  }),
  rule: z.object({
    type: z.enum(['harmonic_sweep', 'phase_flip', 'gravity_pulse']),
    cycle_sec: z.number().min(8).max(45),
  }),
  note_trigger: z.object({
    on: z.enum(['center_crossing', 'peak_reversal']),
    velocity_from: z.enum(['phase', 'fixed']),
  }),
});

export const OrbitSyncParamsSchema = z.object({
  orbits: z.object({
    count: z.number().int().min(4).max(18),
    base_radius: z.number().min(0.1).max(0.28),
    radius_step: z.number().min(0.015).max(0.06),
    base_omega: z.number().min(0.3).max(2.5),
    resonance_ratio: z.number().min(0.05).max(0.5),
  }),
  rule: z.object({
    type: z.enum(['harmonic_align', 'reverse_outer', 'pulse_rings']),
    trigger_angle_deg: z.number().min(-180).max(180),
  }),
  note_trigger: z.object({
    on: z.enum(['beam_crossing', 'planet_alignment']),
    velocity_from: z.enum(['orbit_index', 'fixed']),
  }),
});

export interface TemplateDefinition {
  key: string;
  version: string;
  name: string;
  description: string;
  status: 'active' | 'beta';
  paramsSchema: z.ZodTypeAny;
  events: string[];
  allowedAxes: {
    arena: string[];
    rule: string[];
    ending: Array<'loop' | 'reveal' | 'cut'>;
  };
  estimateCostSec: (spec: VideoSpec) => number;
  jsonSchema: Record<string, unknown>;
}

export const FIXTURE_MELODY_BOUNCE: VideoSpec = {
  schema: 'videospec/1',
  spec_key: 'mb-canon-hexagon-split-0001',
  channel_slug: 'physics-music',
  concept: {
    working_title: 'Canon in D by splitting balls in a hexagon',
    hook_line: 'Can you name this song?',
    hook_style: 'mystery',
    payoff: 'One ball becomes 64 and the melody becomes unmistakable, then it collapses back to one.',
    emotion: 'satisfying',
    series: { slug: 'name-that-tune', episode: 1, title: 'Name That Tune' },
    novelty_notes:
      'First episode of the series: hexagon arena with split-on-bounce; previous melody videos used a circle arena with growth rule.',
  },
  format: {
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration_sec: 28,
    loop: { enabled: true, mode: 'audio-return' },
  },
  scene: {
    template: 'melody-bounce',
    template_version: '^1.0',
    seed: 884102,
    style: {
      palette: { family: 'neon', colors: ['#00F5D4', '#F15BB5', '#FEE440', '#9B5DE5'] },
      background: { type: 'gradient', colors: ['#05060F', '#101437'] },
      trail: { enabled: true, length_frames: 18, fade: 0.85 },
      camera: { zoom_from: 1.0, zoom_to: 1.15, shake: 0.0 },
    },
    params: {
      arena: { shape: 'hexagon', size: 0.78, wall_thickness: 0.012, rotation_deg_per_s: 6 },
      balls: { count_start: 1, radius: 0.028, speed: 0.55, restitution: 1.0, gravity: 0.0, max_count: 64 },
      rule: { type: 'split_on_bounce', every_n_bounces: 3, inherit_color: false },
      note_trigger: { on: 'ball_wall_collision', velocity_from: 'impact' },
    },
  },
  timeline: [
    {
      t: 0.0,
      dur: 1.6,
      type: 'text',
      role: 'hook',
      text: 'Can you name this song?',
      position: 'top-safe',
      style: 'bold-white-shadow',
    },
    {
      t: -2.0,
      dur: 2.0,
      type: 'text',
      role: 'end_card',
      text: 'Name That Tune • Part 1',
      position: 'bottom-safe',
      style: 'small-white',
    },
  ],
  audio: {
    mode: 'sim-driven',
    music: {
      melody_ref: { source: 'library', id: 'pd:canon-in-d' },
      transpose: 0,
      tempo_bpm: 96,
      instrument: 'marimba',
      note_mapping: 'per_collision',
      wrap: 'loop',
      reverb: 0.12,
    },
    sfx: [{ event: 'ball_split', sound: 'soft-pop', gain_db: -14 }],
    mix: { target_lufs: -14, true_peak_db: -1 },
  },
  publish: {
    title: 'Can You Name This Song? 64 Balls Play It 🎵',
    description:
      'Every bounce plays the next note. One ball becomes 64.\n\nName That Tune • Part 1\n#Shorts #satisfying #physics #music',
    tags: ['satisfying', 'physics simulation', 'bouncing ball music', 'name that tune'],
    category_id: '24',
    made_for_kids: false,
    contains_synthetic_media: false,
    default_language: 'en',
    first_comment: 'Did you guess it before the 10th note? 👇',
    schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
  },
  axes: {
    mechanic: 'melody-bounce',
    arena: 'hexagon',
    rule: 'split-on-bounce',
    music_piece: 'pd:canon-in-d',
    hook_style: 'mystery',
    title_pattern: 'question',
    ending: 'loop',
    palette_family: 'neon',
    instrument: 'marimba',
  },
  provenance: {
    generator: { kind: 'human', model: 'fixture', prompt_version: 'specgen-v1' },
    trend_refs: [{ source: 'reference_video', ref: 'yt:JTrpkr4ZGCo', note: 'own best performer: Canon in D xylophone' }],
    created_at: '2026-11-15T08:00:00Z',
  },
};

export const FIXTURE_BALL_SORT: VideoSpec = {
  schema: 'videospec/1',
  spec_key: 'bs-funnel-color-filter-0002',
  channel_slug: 'physics-music',
  concept: {
    working_title: '24 Balls through color-filter gate into 4 bins',
    hook_line: 'Which bin fills first?',
    hook_style: 'prediction',
    payoff: 'Moving gate + color filter sorts 24 balls cleanly into 4 matching bins.',
    emotion: 'tense',
    series: null,
    novelty_notes:
      'Uses funnel + moving color-filter gate instead of static spiral chute; paired with procedural pentatonic scale.',
  },
  format: {
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration_sec: 22,
    loop: { enabled: false, mode: 'none' },
  },
  scene: {
    template: 'ball-sort',
    template_version: '^1.0',
    seed: 120455,
    style: {
      palette: { family: 'warm', colors: ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4'] },
      background: { type: 'grid', colors: ['#0B1020', '#162038'] },
      trail: { enabled: true, length_frames: 10, fade: 0.78 },
      camera: { zoom_from: 1.0, zoom_to: 1.04, shake: 0.0 },
    },
    params: {
      balls: { count: 24, colors: ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4'] },
      bins: { count: 4, layout: 'under-funnel' },
      mechanism: {
        pegs: { rows: 7, jitter: 0.25 },
        gates: [
          { type: 'moving', period_s: 2.4 },
          { type: 'color-filter', color_index: 2 },
        ],
        spiral: { enabled: false },
      },
      goal: { type: 'sorted_by_color', celebrate: 'confetti-light' },
    },
  },
  timeline: [
    {
      t: 0.0,
      dur: 1.5,
      type: 'text',
      role: 'hook',
      text: 'Which bin fills first?',
      position: 'top-safe',
      style: 'bold-white-shadow',
    },
    {
      t: -2.0,
      dur: 2.0,
      type: 'text',
      role: 'end_card',
      text: 'Comment your pick before 0:15',
      position: 'bottom-safe',
      style: 'small-white',
    },
  ],
  audio: {
    mode: 'sim-driven',
    music: {
      melody_ref: { source: 'library', id: 'gen:pentatonic-5521' },
      transpose: 0,
      tempo_bpm: 112,
      instrument: 'kalimba',
      note_mapping: 'per_collision',
      wrap: 'loop',
      reverb: 0.08,
    },
    sfx: [{ event: 'bin_drop', sound: 'wood-tick', gain_db: -10 }],
    mix: { target_lufs: -14, true_peak_db: -1 },
  },
  publish: {
    title: 'Color Filter Gate vs 24 Racing Balls 🎯',
    description:
      'Which bin fills first? Watch the moving color filter sort all 24 balls.\n#Shorts #satisfying #ballsort',
    tags: ['satisfying', 'ball sort', 'physics', 'color filter'],
    category_id: '24',
    made_for_kids: false,
    contains_synthetic_media: false,
    default_language: 'en',
    first_comment: 'Did your color win? Drop your pick below 👇',
    schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
  },
  axes: {
    mechanic: 'ball-sort',
    arena: 'funnel',
    rule: 'color-filter-gate',
    music_piece: 'gen:pentatonic-5521',
    hook_style: 'prediction',
    title_pattern: 'challenge',
    ending: 'reveal',
    palette_family: 'warm',
    instrument: 'kalimba',
  },
  provenance: {
    generator: { kind: 'human', model: 'fixture', prompt_version: 'specgen-v1' },
    trend_refs: [],
    created_at: '2026-11-15T08:05:00Z',
  },
};

export const FIXTURE_PENDULUM_WAVE: VideoSpec = {
  schema: 'videospec/1',
  spec_key: 'pw-harmonic-15-wave-0003',
  channel_slug: 'physics-music',
  concept: {
    working_title: '15 Harmonic Pendulums Syncing Into Pure Phase Waves',
    hook_line: 'Wait for them to align',
    hook_style: 'countdown',
    payoff: '15 pendulums drift from double-helix chaos back into a single unified wave.',
    emotion: 'awe',
    series: { slug: 'harmonic-waves', episode: 1, title: 'Harmonic Waves' },
    novelty_notes:
      'Introduces pendulum-wave harmonic sweep mechanic with center-crossing chime triggers instead of bouncing balls.',
  },
  format: {
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration_sec: 24,
    loop: { enabled: true, mode: 'visual-return' },
  },
  scene: {
    template: 'pendulum-wave',
    template_version: '^1.0',
    seed: 551029,
    style: {
      palette: { family: 'cool', colors: ['#38BDF8', '#818CF8', '#2DD4BF', '#C084FC'] },
      background: { type: 'gradient', colors: ['#040814', '#0F172A'] },
      trail: { enabled: true, length_frames: 14, fade: 0.8 },
    },
    params: {
      pendulum: { count: 15, length_min: 0.24, length_step: 0.022, max_angle_deg: 52, damping: 0.0 },
      rule: { type: 'harmonic_sweep', cycle_sec: 24 },
      note_trigger: { on: 'center_crossing', velocity_from: 'phase' },
    },
  },
  timeline: [
    {
      t: 0.0,
      dur: 1.8,
      type: 'text',
      role: 'hook',
      text: 'Wait for them to align',
      position: 'top-safe',
      style: 'bold-white-shadow',
    },
    {
      t: -2.0,
      dur: 2.0,
      type: 'text',
      role: 'end_card',
      text: 'Harmonic Waves • Ep 1',
      position: 'bottom-safe',
      style: 'small-white',
    },
  ],
  audio: {
    mode: 'sim-driven',
    music: {
      melody_ref: { source: 'library', id: 'gen:lydian-3141' },
      transpose: 0,
      tempo_bpm: 108,
      instrument: 'celesta',
      note_mapping: 'per_event',
      wrap: 'loop',
      reverb: 0.18,
    },
    mix: { target_lufs: -14, true_peak_db: -1 },
  },
  publish: {
    title: '15 Pendulums Drift Into Chaos Then Snap Into Alignment',
    description:
      'Every center crossing plays the next harmonic note until all 15 pendulums lock back in sync.\n#Shorts #pendulumwave #physics',
    tags: ['pendulum wave', 'physics simulation', 'satisfying', 'harmonic resonance'],
    category_id: '24',
    made_for_kids: false,
    contains_synthetic_media: false,
    default_language: 'en',
    first_comment: 'Which second did the double-helix wave snap into sync for you? 👇',
    schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
  },
  axes: {
    mechanic: 'pendulum-wave',
    arena: 'wave-beam',
    rule: 'harmonic-sweep',
    music_piece: 'gen:lydian-3141',
    hook_style: 'countdown',
    title_pattern: 'statement',
    ending: 'loop',
    palette_family: 'cool',
    instrument: 'celesta',
  },
  provenance: {
    generator: { kind: 'human', model: 'fixture', prompt_version: 'specgen-v1' },
    created_at: '2026-11-15T08:10:00Z',
  },
};

export const FIXTURE_ORBIT_SYNC: VideoSpec = {
  schema: 'videospec/1',
  spec_key: 'os-10-planets-resonance-0004',
  channel_slug: 'physics-music',
  concept: {
    working_title: '10 Orbits Aligning in Harmonic Resonance',
    hook_line: 'Watch the 12-oclock beam',
    hook_style: 'contrast',
    payoff: '10 planetary rings sweep past the trigger beam playing an ascending polyrhythm.',
    emotion: 'awe',
    series: null,
    novelty_notes:
      'Concentric orbit-sync mechanic with beam-crossing polyrhythm triggers instead of polygon bounce or sorting.',
  },
  format: {
    aspect: '9:16',
    width: 1080,
    height: 1920,
    fps: 30,
    duration_sec: 24,
    loop: { enabled: true, mode: 'visual-return' },
  },
  scene: {
    template: 'orbit-sync',
    template_version: '^1.0',
    seed: 774310,
    style: {
      palette: { family: 'pastel', colors: ['#F472B6', '#FB923C', '#FACC15', '#34D399', '#38BDF8'] },
      background: { type: 'solid', colors: ['#060714'] },
      trail: { enabled: true, length_frames: 20, fade: 0.85 },
    },
    params: {
      orbits: { count: 10, base_radius: 0.11, radius_step: 0.032, base_omega: 1.05, resonance_ratio: 0.14 },
      rule: { type: 'harmonic_align', trigger_angle_deg: -90 },
      note_trigger: { on: 'beam_crossing', velocity_from: 'orbit_index' },
    },
  },
  timeline: [
    {
      t: 0.0,
      dur: 1.7,
      type: 'text',
      role: 'hook',
      text: 'Watch the 12-oclock beam',
      position: 'top-safe',
      style: 'bold-white-shadow',
    },
    {
      t: -2.0,
      dur: 2.0,
      type: 'text',
      role: 'end_card',
      text: 'Full orbital alignment at 0:24',
      position: 'bottom-safe',
      style: 'small-white',
    },
  ],
  audio: {
    mode: 'sim-driven',
    music: {
      melody_ref: { source: 'library', id: 'gen:pentatonic-5521' },
      transpose: 2,
      tempo_bpm: 110,
      instrument: 'harp',
      note_mapping: 'per_event',
      wrap: 'loop',
      reverb: 0.22,
    },
    mix: { target_lufs: -14, true_peak_db: -1 },
  },
  publish: {
    title: '10 Planetary Orbits Playing Polyrhythm Harmonies',
    description:
      'Every time an orbit crosses the top laser beam it triggers a harmonic note.\n#Shorts #orbits #polyrhythm #satisfying',
    tags: ['orbit sync', 'polyrhythm', 'physics music', 'satisfying'],
    category_id: '24',
    made_for_kids: false,
    contains_synthetic_media: false,
    default_language: 'en',
    first_comment: 'Outer fast rings or inner slow rings — which harmony hits hardest? 👇',
    schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
  },
  axes: {
    mechanic: 'orbit-sync',
    arena: 'concentric-rings',
    rule: 'harmonic-align',
    music_piece: 'gen:pentatonic-5521',
    hook_style: 'contrast',
    title_pattern: 'number-contrast',
    ending: 'loop',
    palette_family: 'pastel',
    instrument: 'harp',
  },
  provenance: {
    generator: { kind: 'human', model: 'fixture', prompt_version: 'specgen-v1' },
    created_at: '2026-11-15T08:15:00Z',
  },
};

export const TEMPLATE_REGISTRY: Record<string, TemplateDefinition> = {
  'melody-bounce': {
    key: 'melody-bounce',
    version: '1.0.0',
    name: '旋律弹跳 (Melody Bounce)',
    description: '小球在多边形/圆环场地内弹跳，每次碰撞触发旋律下一个音符并触发升级规则。',
    status: 'active',
    paramsSchema: MelodyBounceParamsSchema,
    events: ['ball_wall_collision', 'ball_split', 'split_rate_increase', 'wall_shrink'],
    allowedAxes: {
      arena: ['circle', 'hexagon', 'triangle', 'ellipse', 'polygon'],
      rule: ['split-on-bounce', 'grow-on-bounce', 'speed-up', 'shrink-wall', 'gravity-flip'],
      ending: ['loop', 'reveal', 'cut'],
    },
    estimateCostSec: (spec) => Math.round(spec.format.duration_sec * 1.4 + 25),
    jsonSchema: {
      type: 'object',
      required: ['arena', 'balls', 'rule', 'note_trigger'],
      properties: {
        arena: { type: 'object', required: ['shape', 'size', 'wall_thickness', 'rotation_deg_per_s'] },
        balls: { type: 'object', required: ['count_start', 'radius', 'speed', 'restitution', 'gravity', 'max_count'] },
        rule: { type: 'object', required: ['type'] },
        note_trigger: { type: 'object', required: ['on', 'velocity_from'] },
      },
    },
  },
  'ball-sort': {
    key: 'ball-sort',
    version: '1.0.0',
    name: '物理分拣 (Ball Sort)',
    description: '多色小球穿过钉板与动态滤色机关落入对应容器，按碰撞触发音阶节奏。',
    status: 'active',
    paramsSchema: BallSortParamsSchema,
    events: ['peg_hit', 'gate_pass', 'bin_drop', 'goal_complete'],
    allowedAxes: {
      arena: ['funnel', 'stairs', 'open-field', 'spiral'],
      rule: ['color-filter-gate', 'moving-gate', 'spinner-split', 'gravity-surge'],
      ending: ['reveal', 'loop', 'cut'],
    },
    estimateCostSec: (spec) => Math.round(spec.format.duration_sec * 1.2 + 20),
    jsonSchema: {
      type: 'object',
      required: ['balls', 'bins', 'mechanism', 'goal'],
      properties: {
        balls: { type: 'object', required: ['count', 'colors'] },
        bins: { type: 'object', required: ['count', 'layout'] },
        mechanism: { type: 'object', required: ['pegs', 'gates', 'spiral'] },
        goal: { type: 'object', required: ['type', 'celebrate'] },
      },
    },
  },
  'pendulum-wave': {
    key: 'pendulum-wave',
    version: '1.0.0',
    name: '谐波钟摆 (Pendulum Wave)',
    description: '多根不同摆长的钟摆随周期错相形成双螺旋波浪，并在每次穿过中心共振线时触发旋律音符。',
    status: 'active',
    paramsSchema: PendulumWaveParamsSchema,
    events: ['note_trigger', 'gate_pass'],
    allowedAxes: {
      arena: ['wave-beam', 'arch-rack'],
      rule: ['harmonic-sweep', 'phase-flip', 'gravity-pulse'],
      ending: ['loop', 'reveal', 'cut'],
    },
    estimateCostSec: (spec) => Math.round(spec.format.duration_sec * 1.0 + 18),
    jsonSchema: {
      type: 'object',
      required: ['pendulum', 'rule', 'note_trigger'],
      properties: {
        pendulum: { type: 'object', required: ['count', 'length_min', 'length_step', 'max_angle_deg', 'damping'] },
        rule: { type: 'object', required: ['type', 'cycle_sec'] },
        note_trigger: { type: 'object', required: ['on', 'velocity_from'] },
      },
    },
  },
  'orbit-sync': {
    key: 'orbit-sync',
    version: '1.0.0',
    name: '轨道共振 (Orbit Sync)',
    description: '同心多行星按共振角速度旋转，每次掠过顶部 12 点相位射线时触发多声部复调和弦。',
    status: 'active',
    paramsSchema: OrbitSyncParamsSchema,
    events: ['note_trigger', 'gate_pass'],
    allowedAxes: {
      arena: ['concentric-rings', 'spiral-rings'],
      rule: ['harmonic-align', 'reverse-outer', 'pulse-rings'],
      ending: ['loop', 'reveal', 'cut'],
    },
    estimateCostSec: (spec) => Math.round(spec.format.duration_sec * 1.0 + 18),
    jsonSchema: {
      type: 'object',
      required: ['orbits', 'rule', 'note_trigger'],
      properties: {
        orbits: { type: 'object', required: ['count', 'base_radius', 'radius_step', 'base_omega', 'resonance_ratio'] },
        rule: { type: 'object', required: ['type', 'trigger_angle_deg'] },
        note_trigger: { type: 'object', required: ['on', 'velocity_from'] },
      },
    },
  },
};

export function semverSatisfies(installedVersion: string, requestedRange: string): boolean {
  const cleanInstalled = installedVersion.replace(/^v/, '');
  const [iMaj] = cleanInstalled.split('.').map(Number);
  const req = requestedRange.trim();
  if (req.startsWith('^')) {
    const [rMaj] = req.slice(1).split('.').map(Number);
    return iMaj === rMaj;
  }
  if (req.startsWith('~')) {
    const [rMaj, rMin] = req.slice(1).split('.').map(Number);
    const [, iMin] = cleanInstalled.split('.').map(Number);
    return iMaj === rMaj && iMin === (rMin ?? 0);
  }
  return cleanInstalled === req || req === '*';
}

export interface CustomVideoSpecInput {
  channelSlug: string;
  template: 'melody-bounce' | 'ball-sort' | 'pendulum-wave' | 'orbit-sync';
  arena: string;
  rule: string;
  melodyId: string;
  instrument: string;
  tempoBpm: number;
  durationSec: number;
  seed: number;
  paletteFamily: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
  hookStyle: VideoSpec['axes']['hook_style'];
  hookLine: string;
  title: string;
  firstComment: string;
  loopEnabled: boolean;
}

const PALETTE_SWATCHES: Record<CustomVideoSpecInput['paletteFamily'], { colors: string[]; bg: string[] }> = {
  neon: { colors: ['#00F5D4', '#F15BB5', '#FEE440', '#9B5DE5'], bg: ['#05060F', '#101437'] },
  pastel: { colors: ['#F472B6', '#FB923C', '#FACC15', '#34D399'], bg: ['#060714', '#13162D'] },
  cool: { colors: ['#38BDF8', '#818CF8', '#2DD4BF', '#C084FC'], bg: ['#040814', '#0F172A'] },
  warm: { colors: ['#FF595E', '#FFCA3A', '#FB923C', '#F43F5E'], bg: ['#110B14', '#221426'] },
  mono: { colors: ['#F8FAFC', '#CBD5E1', '#94A3B8', '#64748B'], bg: ['#05070B', '#111827'] },
};

export function buildCustomVideoSpec(input: CustomVideoSpecInput): VideoSpec {
  const dur = Math.min(180, Math.max(8, Math.round(input.durationSec || 26)));
  const bpm = Math.min(240, Math.max(40, Math.round(input.tempoBpm || 108)));
  const seed = Math.max(1, Math.round(input.seed || 100001));
  const title = (input.title.trim() || `${input.template} ${input.arena} simulation`).slice(0, 100);
  const hookLine = (input.hookLine.trim() || 'Wait for the alignment').slice(0, 80);
  const palette = PALETTE_SWATCHES[input.paletteFamily] ?? PALETTE_SWATCHES.neon;
  const specKey = `custom-${input.template.slice(0, 2)}-${input.arena.replace(/[^a-z0-9]/g, '').slice(0, 6)}-${seed
    .toString()
    .slice(-5)}-${Date.now().toString(36).slice(-4)}`.slice(0, 72);

  let params: Record<string, unknown>;
  if (input.template === 'pendulum-wave') {
    const ruleType =
      input.rule === 'phase-flip'
        ? 'phase_flip'
        : input.rule === 'gravity-pulse'
          ? 'gravity_pulse'
          : 'harmonic_sweep';
    params = {
      pendulum: { count: 15, length_min: 0.24, length_step: 0.022, max_angle_deg: 52, damping: 0.0 },
      rule: { type: ruleType, cycle_sec: Math.min(45, Math.max(8, dur)) },
      note_trigger: { on: 'center_crossing', velocity_from: 'phase' },
    };
  } else if (input.template === 'orbit-sync') {
    const ruleType =
      input.rule === 'reverse-outer'
        ? 'reverse_outer'
        : input.rule === 'pulse-rings'
          ? 'pulse_rings'
          : 'harmonic_align';
    params = {
      orbits: { count: 10, base_radius: 0.11, radius_step: 0.032, base_omega: 1.05, resonance_ratio: 0.14 },
      rule: { type: ruleType, trigger_angle_deg: -90 },
      note_trigger: { on: 'beam_crossing', velocity_from: 'orbit_index' },
    };
  } else if (input.template === 'ball-sort') {
    params = {
      balls: { count: 24, colors: palette.colors.slice(0, 4) },
      bins: { count: 4, layout: input.arena === 'stairs' ? 'stepped' : 'under-funnel' },
      mechanism: {
        pegs: { rows: 7, jitter: 0.24 },
        gates: [
          {
            type: input.rule === 'color-filter-gate' ? 'color-filter' : input.rule === 'spinner-split' ? 'spinner' : 'moving',
            period_s: 2.2,
          },
        ],
        spiral: { enabled: input.arena === 'spiral' },
      },
      goal: { type: 'sorted_by_color', celebrate: 'confetti-light' },
    };
  } else {
    const shape = ['circle', 'hexagon', 'triangle', 'ellipse', 'polygon'].includes(input.arena)
      ? input.arena
      : 'hexagon';
    const ruleType =
      input.rule === 'grow-on-bounce'
        ? 'grow_on_bounce'
        : input.rule === 'speed-up'
          ? 'speed_up'
          : input.rule === 'shrink-wall'
            ? 'shrink_wall'
            : input.rule === 'gravity-flip'
              ? 'gravity_flip'
              : 'split_on_bounce';
    params = {
      arena: { shape, size: 0.78, wall_thickness: 0.012, rotation_deg_per_s: 7 },
      balls: { count_start: 1, radius: 0.026, speed: 0.56, restitution: 1.0, gravity: 0.08, max_count: 56 },
      rule: { type: ruleType, every_n_bounces: 3, scale_factor: 1.03 },
      note_trigger: { on: 'ball_wall_collision', velocity_from: 'impact' },
    };
  }

  return {
    schema: 'videospec/1',
    spec_key: specKey,
    channel_slug: input.channelSlug,
    concept: {
      working_title: title,
      hook_line: hookLine,
      hook_style: input.hookStyle,
      payoff: `Custom ${input.template} simulation (${input.arena} + ${input.rule}) paired with ${input.melodyId}.`,
      emotion: 'satisfying',
      series: null,
      novelty_notes: `Custom creator build: ${input.template} in ${input.arena} with ${input.rule} rule and ${input.melodyId} (${input.instrument}).`,
    },
    format: {
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      duration_sec: dur,
      loop: { enabled: input.loopEnabled, mode: input.loopEnabled ? 'audio-return' : 'none' },
    },
    scene: {
      template: input.template,
      template_version: '^1.0',
      seed,
      style: {
        palette: { family: input.paletteFamily, colors: palette.colors },
        background: { type: 'gradient', colors: palette.bg },
        trail: { enabled: true, length_frames: 16, fade: 0.85 },
      },
      params,
    },
    timeline: [
      { t: 0, dur: 1.7, type: 'text', role: 'hook', text: hookLine, position: 'top-safe', style: 'bold-white-shadow' },
      {
        t: -2.0,
        dur: 2.0,
        type: 'text',
        role: 'end_card',
        text: input.loopEnabled ? 'Loops seamlessly' : 'Follow for more',
        position: 'bottom-safe',
        style: 'small-white',
      },
    ],
    audio: {
      mode: 'sim-driven',
      music: {
        melody_ref: { source: 'library', id: input.melodyId },
        transpose: 0,
        tempo_bpm: bpm,
        instrument: input.instrument || 'marimba',
        note_mapping: input.template === 'pendulum-wave' || input.template === 'orbit-sync' ? 'per_event' : 'per_collision',
        wrap: 'loop',
        reverb: 0.14,
      },
      mix: { target_lufs: -14, true_peak_db: -1 },
    },
    publish: {
      title,
      description: `${hookLine}\n\n${input.template} • ${input.arena} • ${input.rule}\n#Shorts #satisfying #physics`,
      tags: ['satisfying', 'physics simulation', input.template, input.arena],
      category_id: '24',
      made_for_kids: false,
      contains_synthetic_media: false,
      default_language: 'en',
      first_comment: (input.firstComment.trim() || 'Did you spot the pattern before the midpoint? 👇').slice(0, 200),
      schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
    },
    axes: {
      mechanic: input.template,
      arena: input.arena,
      rule: input.rule,
      music_piece: input.melodyId,
      hook_style: input.hookStyle,
      title_pattern: title.includes('?') ? 'question' : 'statement',
      ending: input.loopEnabled ? 'loop' : 'reveal',
      palette_family: input.paletteFamily,
      instrument: input.instrument || 'marimba',
    },
    provenance: {
      generator: { kind: 'human', prompt_version: 'custom-builder-v1' },
      created_at: new Date().toISOString(),
    },
  };
}

