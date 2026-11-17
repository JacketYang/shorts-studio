import type { VideoSpec, Voice } from '../engine/types';
import { SONGS } from './songs';
import { ALGOS } from '../scenes/sorting';

export interface Recipe {
  id: string;
  category: string;
  catLabel: string;
  engine: string;
  spec: (v: number) => VideoSpec;
}

export const CATEGORIES: { id: string; label: string }[] = [
  { id: 'music', label: '🎵 旋律·球体奏乐' },
  { id: 'sort', label: '🌈 小球分拣' },
  { id: 'algo', label: '🔊 排序算法之声' },
  { id: 'phys', label: '⚛️ 物理现象' },
  { id: 'math', label: '📐 数学图形' },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
const pick = <T,>(a: readonly T[], v: number): T => a[((v % a.length) + a.length) % a.length];
const fill = (s: string, m: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k) => String(m[k] ?? ''));
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Def {
  id: string;
  engine: string;
  cat: string;
  params: (v: number) => unknown;
  vars?: Record<string, string | number>;
  titles: string[];
  hooks: string[];
  intro: string[];
  detail: string;
  extra?: string;
  tags: string[];
  hash: string;
  theme?: number;
}

const VOICES: readonly Voice[] = ['marimba', 'kalimba', 'celesta', 'rhodes', 'bell', 'pizzicato', 'pluck'];
const TRANSPOSES: readonly number[] = [0, 2, -2, 5, -5, 7, -3, 4];
const LAYOUTS = ['flat', 'stairs', 'arc', 'wave'] as const;
const PEG_LAYOUTS = ['grid', 'stagger', 'funnel', 'diamond'] as const;

const VOICE_LABELS: Record<Voice, string> = {
  marimba: 'wooden marimba',
  kalimba: 'thumb kalimba',
  celesta: 'glass celesta',
  rhodes: 'electric Rhodes piano',
  bell: 'tubular chime bell',
  pizzicato: 'plucked string pizzicato',
  pluck: 'warm acoustic pluck',
  click: 'crisp percussive click',
  blip: 'clean sine pulse',
  thud: 'low resonant strike',
  pad: 'warm harmonic pad',
  tick: 'chronometer tick',
};

const SCALE_LABELS = [
  'C major pentatonic',
  'Dorian mode',
  'Lydian bright mode',
  'Natural minor',
  'Whole-tone harmonic',
  'Hirajoshi Japanese pentatonic',
  'Mixolydian mode',
  'Blues hexatonic',
] as const;

const BASE_TAGS = ['simulation', 'physics engine', 'synthesized audio', 'procedural art'];

const FOOTERS = [
  'Motion is integrated in real time at 60 steps/s using deterministic kinematics and synthesized WebAudio voices.',
  'Built from differential physics and exact frequency tuning — headphones highlight the stereo panning.',
  'Every collision, curve, and harmonic overtone is computed directly from the governing equations.',
  'Acoustic timbres are synthesized per contact event with zero external audio samples.',
];

function def(d: Def): Recipe {
  const label = CATEGORIES.find((c) => c.id === d.cat)!.label;
  const salt = hashStr(d.id);
  return {
    id: d.id,
    category: d.cat,
    catLabel: label,
    engine: d.engine,
    spec(v: number): VideoSpec {
      const pObj = d.params(v) as Record<string, unknown>;
      const voice = (typeof pObj?.voice === 'string' ? pObj.voice : 'marimba') as Voice;
      const scaleIdx = typeof pObj?.scale === 'number' ? pObj.scale : 0;
      const vars: Record<string, string | number> = {
        ...(d.vars ?? {}),
        voice: VOICE_LABELS[voice] ?? voice,
        scale: SCALE_LABELS[scaleIdx % SCALE_LABELS.length],
      };

      let title = fill(pick(d.titles, v + salt), vars).replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
      if (title.length > 96) title = title.slice(0, 95).trimEnd();
      const hook = fill(pick(d.hooks, v + (salt >> 3)), vars).replace(/#\S+/g, '').replace(/\s+/g, ' ').trim();
      const footer = FOOTERS[(salt + v) % FOOTERS.length];

      const desc = [
        fill(pick(d.intro, v + (salt >> 6)), vars),
        '',
        fill(d.detail, vars),
        d.extra ? fill(d.extra, vars) : '',
        footer,
        '',
        d.hash,
      ]
        .filter((l, i, a) => !(l === '' && a[i - 1] === ''))
        .join('\n');

      return {
        id: v === 0 ? d.id : `${d.id}~${v}`,
        engine: d.engine,
        params: pObj,
        seed: (salt + v * 7919) >>> 0,
        theme: ((d.theme ?? salt % 8) + v * 3) % 8,
        category: d.cat,
        catLabel: label,
        title,
        hook,
        description: desc,
        tags: [...new Set([...d.tags, voice, ...BASE_TAGS])],
        filename: slug(d.id) + (v ? `-v${v + 1}` : ''),
      };
    },
  };
}

const RING_SHAPES: [number, number][] = [
  [2, 5],
  [3, 7],
  [2, 7],
  [3, 8],
  [5, 12],
  [4, 9],
  [2, 9],
  [3, 10],
  [5, 11],
  [7, 16],
];

function musicRecipes(): Recipe[] {
  const out: Recipe[] = [];
  SONGS.forEach((song, i) => {
    const s = song.name;
    const vars = { s };
    const mel = `Piece: ${s} (public-domain score arranged for {voice}).`;
    const tagsM = ['melody', 'bouncing ball', 'classical music', s.toLowerCase()];

    out.push(
      def({
        id: `hop-${song.id}`,
        engine: 'hop',
        cat: 'music',
        vars,
        theme: i,
        params: (v) => ({
          song,
          layout: LAYOUTS[(i + v) % 4],
          voice: VOICES[(i + v) % VOICES.length],
          transpose: v === 0 && i % 5 === 0 ? 0 : TRANSPOSES[(i + v) % TRANSPOSES.length],
        }),
        titles: [
          'How Gravity Times Every Note of {s} ({voice})',
          'Ballistic Trajectory Playing {s} Across Tuned Bars',
          '{s} Reimagined as Parabolic Jumps on {voice}',
          'Can Ballistic Physics Keep Exact Tempo on {s}?',
          'Parabolic Bounce Sequence: {s} on {voice} 🎶',
          'Stepwise Kinetic Performance of {s}',
        ],
        hooks: [
          'Gravity sets the tempo',
          'Parabolic arc hits {s}',
          'Every impact tunes {voice}',
          'Exact beat from freefall',
        ],
        intro: [
          'A projectile traces ballistic parabolas between tuned plates, voicing {s} on a {voice}.',
          'Each flight duration matches the musical interval in {s} so landings lock onto the beat.',
          'Arranged for {voice}: kinetic arcs turn height differences into the phrasing of {s}.',
        ],
        detail:
          'Vertical gravity pulls the striker onto each pitch bar at exact beat timestamps derived from the score.',
        extra: mel,
        tags: [...tagsM, 'xylophone'],
        hash: '#kineticmusic #acoustics #sounddesign',
      })
    );

    out.push(
      def({
        id: `rain-${song.id}`,
        engine: 'rain',
        cat: 'music',
        vars,
        theme: i + 2,
        params: (v) => ({
          song,
          voice: VOICES[(i + 2 + v) % VOICES.length],
          transpose: TRANSPOSES[(i + 1 + v) % TRANSPOSES.length],
        }),
        titles: [
          'Vertical Drop Timing Voices {s} on {voice}',
          'Choreographed Freefall: {s} Across a Tuned Keyboard 🎹',
          'When Falling Spheres Strike Every Chord of {s}',
          'How {s} Sounds Through Timed Impact Resonance ({voice})',
          'Chromatic Rain Partitioning {s} Into Clean Beats',
          'Acoustic Raindrop Score: {s} Performed by Gravity',
        ],
        hooks: [
          'Freefall strikes each chord',
          'Timed drops play {s}',
          'Gravity meets {voice}',
          'Polyphonic rain in sync',
        ],
        intro: [
          'Spheres released from calculated altitudes strike the keyboard simultaneously with {s} on {voice}.',
          'Each drop height compensates for chord timing so harmony resolves cleanly under gravity.',
          'Polyphonic phrasing of {s} emerges from parallel freefall kinematics.',
        ],
        detail:
          'Release altitudes are back-solved from each note timestamp so strikes align without quantized drift.',
        extra: mel,
        tags: [...tagsM, 'keyboard', 'falling spheres'],
        hash: '#polyphony #gravitymusic #synthesizer',
      })
    );

    if (i % 2 === 0) {
      const [k, m] = RING_SHAPES[(i >> 1) % RING_SHAPES.length];
      out.push(
        def({
          id: `ring-${song.id}`,
          engine: 'ring',
          cat: 'music',
          vars: { s, k, m },
          theme: i + 4,
          params: (v) => ({
            song,
            k,
            m,
            drift: [0, 0.015, 0.028, 0.04][(v + i) % 4],
            voice: VOICES[(i + 3 + v) % VOICES.length],
            transpose: TRANSPOSES[(i + 2 + v) % TRANSPOSES.length],
          }),
          titles: [
            '{k}/{m} Star Polygon Emerges While Voicing {s}',
            'Circular Boundary Reflections Trace {k}/{m} Geometry ({s})',
            'Rotating Chord Geometry Powered by {s} on {voice}',
            'Inside a Circular Acoustic Cavity: {s} Meets {k}/{m} Symmetry',
            'Angular Reflection Turns {s} Into a {k}-Point Star ✨',
          ],
          hooks: [
            '{k}/{m} resonance geometry',
            'Chords trace {k}-star',
            'Acoustic reflection path',
            'Symmetry drives {s}',
          ],
          intro: [
            'Constant chord reflections inside a circle weave a {k}/{m} star while stepping through {s} on {voice}.',
            'Geometric reflections convert the rhythm of {s} into rotating star-polygon envelopes.',
          ],
          detail: `Fixed angular deflection of 2π·${k}/${m} forms closed star envelopes synchronized with the melody.`,
          extra: mel,
          tags: [...tagsM, 'geometry', 'polygon'],
          hash: '#geometricart #acoustics #harmonicmotion',
        })
      );
    } else {
      out.push(
        def({
          id: `accel-${song.id}`,
          engine: 'hop',
          cat: 'music',
          vars: { s, n: 4 },
          theme: i + 5,
          params: (v) => ({
            song,
            layout: LAYOUTS[(i + v + 1) % 4],
            rounds: 4,
            speedup: 0.78,
            target: 32,
            voice: VOICES[(i + 4 + v) % VOICES.length],
            transpose: TRANSPOSES[(i + 3 + v) % TRANSPOSES.length],
          }),
          titles: [
            '4 Tempo Compressions of {s} Down to 78% Per Pass ⚡',
            'How {s} Transforms Under 4× Exponential Acceleration',
            'Exponential Speedup: {n} Passes Through {s} ({voice})',
            'Tempo Compression Experiment: {s} Across {n} Cycles',
            'From Measured Adagio to Blurring Rhythm: {s} in {n} Passes',
          ],
          hooks: [
            '4 exponential speedups',
            '78% duration each pass',
            'Rhythm compresses live',
            'Tempo climbs 4 rounds',
          ],
          intro: [
            'The harmonic structure of {s} repeats across {n} passes, scaling step interval by 0.78 each round.',
            'Played on {voice}: steady meter progressively compresses into rapid percussive phrasing.',
          ],
          detail:
            'Geometric time scaling preserves relative rhythmic ratios across all four accelerating cycles.',
          extra: mel,
          tags: [...tagsM, 'tempo', 'acceleration'],
          hash: '#tempocompression #rhythm #kineticmusic',
        })
      );
    }

    if (i % 2 === 1 || i % 3 === 0) {
      out.push(
        def({
          id: `multiply-${song.id}`,
          engine: 'multiply',
          cat: 'music',
          vars,
          theme: i + 6,
          params: (v) => ({
            song,
            gravity: (i + v) % 2 ? 0 : 1250,
            cap: [64, 72, 56, 84][(i + v) % 4],
            duration: 26,
            voice: VOICES[(i + 5 + v) % VOICES.length],
            transpose: TRANSPOSES[(i + 4 + v) % TRANSPOSES.length],
          }),
          titles: [
            'Particle Duplication Cascade Voicing {s} ({voice})',
            '1 Seed Emitter Expands Into Polyphonic {s}',
            'Boundary-Triggered Cloning Plays {s} as Density Climbs',
            'From Solo Pulse to Multi-Body Choir on {s}',
            'Exponential Collision Density Driven by {s} 🎶',
          ],
          hooks: [
            '1 emitter splits polyphonic',
            'Collisions spawn notes',
            'Density builds {s}',
            'Boundary hits multiply',
          ],
          intro: [
            'Each wall impact spawns a sibling trajectory, building {s} from a solo line to dense {voice} texture.',
            'Collisions double system density while advancing note by note through {s}.',
          ],
          detail:
            'New voices inherit mirrored velocity vectors so rhythmic accents cluster into shimmering chords.',
          extra: mel,
          tags: [...tagsM, 'particle cascade', 'polyphony'],
          hash: '#particlephysics #polyphony #sounddesign',
        })
      );
    }
  });
  return out;
}

function sortRecipes(): Recipe[] {
  const cfg: [number, number, number][] = [
    [16, 4, 0.42],
    [12, 3, 0.45],
    [20, 5, 0.34],
    [24, 4, 0.3],
    [18, 3, 0.36],
    [15, 5, 0.4],
    [20, 4, 0.34],
    [10, 5, 0.5],
    [30, 5, 0.24],
  ];
  return cfg.map(([n, b, gap], i) =>
    def({
      id: `sort-${n}b${b}`,
      engine: 'plinko',
      cat: 'sort',
      vars: { n, b },
      theme: i + 1,
      params: (v) => ({
        balls: n,
        bins: b,
        gap: gap * (v % 2 ? 0.86 : 1),
        rows: 7,
        pegLayout: PEG_LAYOUTS[(i + v) % 4],
        scale: (i + v) % 8,
        voice: VOICES[(i + 1 + v) % VOICES.length],
      }),
      titles: [
        'Calibrated Peg Matrix Routes {n} Marbles Into {b} Color Bins',
        '{n} Rigid Spheres Guided Through 7 Peg Rows Into {b} Columns',
        'Deterministic Plinko: {n} Trajectories Converging on {b} Targets',
        'How {b} Target Bins Collect {n} Mixed Spheres Without Collision Error',
        'Peg Geometry Separation: {n} Balls Sorted Into {b} Channels ({scale})',
        '7-Row Obstacle Array Partitioning {n} Spheres Across {b} Lanes 🎯',
      ],
      hooks: [
        '{n} spheres, {b} target lanes',
        'Calibrated peg deflections',
        'Zero cross-bin errors',
        'Tuned in {scale}',
      ],
      intro: [
        '{n} mixed spheres weave through a 7-row peg lattice and settle cleanly into {b} chromatic columns.',
        'Each peg strike chimes in {scale} on {voice} as trajectories resolve into {b} sorted stacks.',
      ],
      detail:
        'Elastic collisions with fixed pins steer every sphere from a mixed central hopper to its matching bin.',
      tags: ['ball sort', 'plinko', 'pegboard', 'kinematics', 'probability'],
      hash: '#plinko #kinematics #colorsort',
    })
  );
}

const ALGO_CFG: { algo: string; n: [number, number]; views: [string, string]; tag: string; blurb: string }[] = [
  { algo: 'bubble', n: [48, 60], views: ['bars', 'dots'], tag: 'Adjacent Swap', blurb: 'Bubble sort compares neighbours and swaps them, sweeping large values monotonically to the tail.' },
  { algo: 'insertion', n: [64, 56], views: ['pyramid', 'dots'], tag: 'Prefix Shift', blurb: 'Insertion sort slides each new element leftward across the already-sorted prefix.' },
  { algo: 'selection', n: [56, 64], views: ['bars', 'circle'], tag: 'Min Scan', blurb: 'Selection sort scans the remaining suffix for its minimum and locks it into position.' },
  { algo: 'quick', n: [128, 100], views: ['circle', 'bars'], tag: 'Pivot Split', blurb: 'Quick sort partitions values around a chosen pivot and recurses on both subarrays.' },
  { algo: 'merge', n: [128, 96], views: ['pyramid', 'dots'], tag: 'Divide & Merge', blurb: 'Merge sort recursively splits ranges in half and interleaves sorted runs in linear time.' },
  { algo: 'heap', n: [100, 80], views: ['circle', 'pyramid'], tag: 'Binary Heap', blurb: 'Heap sort constructs a max-heap tree and extracts peak elements back into the sorted tail.' },
  { algo: 'shell', n: [100, 120], views: ['bars', 'circle'], tag: 'Shrinking Gap', blurb: 'Shell sort runs gapped passes with diminishing step sizes before a fast final sweep.' },
  { algo: 'comb', n: [100, 128], views: ['dots', 'bars'], tag: '1.3 Shrink', blurb: 'Comb sort eliminates small trailing inversions using a 1.3 gap-shrink factor.' },
  { algo: 'cocktail', n: [48, 40], views: ['bars', 'pyramid'], tag: 'Bidirectional', blurb: 'Cocktail shaker sort alternates ascending and descending neighbor sweeps each pass.' },
  { algo: 'radix', n: [128, 100], views: ['circle', 'dots'], tag: 'Base-10 Buckets', blurb: 'Radix sort distributes keys digit by digit through stable buckets without element comparisons.' },
  { algo: 'oddeven', n: [40, 48], views: ['pyramid', 'bars'], tag: 'Brick Parallel', blurb: 'Odd-even sort alternates disjoint odd and even neighbor pairs suited for parallel hardware.' },
];

function algoRecipes(): Recipe[] {
  const out: Recipe[] = [];
  ALGO_CFG.forEach((a, ai) => {
    const info = ALGOS[a.algo];
    [0, 1].forEach((k) => {
      out.push(
        def({
          id: `algo-${a.algo}-${a.views[k]}`,
          engine: 'sorting',
          cat: 'algo',
          vars: { a: info.label, big: info.big, n: a.n[k], tag: a.tag },
          theme: ai + k,
          params: (v) => ({
            algo: a.algo,
            n: a.n[k],
            view: v % 2 ? ['bars', 'circle', 'dots', 'pyramid'][(ai + v) % 4] : a.views[k],
            start: 'random',
            scale: (ai + k + v) % 8,
            voice: VOICES[(ai + k + v) % VOICES.length],
          }),
          titles: [
            'Auditory Signature of {a} ({big}) on {n} Elements',
            '{a} Sonified in {scale}: {tag} Over {n} Items',
            'How {a} Organizes {n} Scrambled Values ({voice}) 🔊',
            'Spectral Footprint of {a}: {n} Keys Sorted in {big}',
            '{tag} Geometry: Hearing {a} Converge Across {n} Bars',
          ],
          hooks: [
            '{a} · {big}',
            'Hear {tag} at work',
            '{n} keys in {scale}',
            'Audio trace of {a}',
          ],
          intro: [
            '{n} scrambled values sorted by {a} ({big}), mapping each array access to {voice} in {scale}.',
            'Hear the structural difference of {tag}: {a} organizing {n} unsorted keys.',
          ],
          detail: a.blurb,
          tags: ['sorting algorithm', 'sonification', info.label.toLowerCase(), 'computer science'],
          hash: `#computerscience #algorithms #${a.algo}sort`,
        })
      );
    });
  });
  return out;
}

function physRecipes(): Recipe[] {
  const out: Recipe[] = [];
  const pw: [number, number, number, 'rails' | 'wave'][] = [
    [15, 20, 12, 'rails'],
    [20, 22, 15, 'wave'],
    [24, 25, 15, 'rails'],
    [30, 30, 20, 'wave'],
    [18, 18, 12, 'wave'],
    [12, 16, 10, 'rails'],
    [32, 32, 20, 'rails'],
    [25, 24, 18, 'wave'],
  ];
  pw.forEach(([n, T, K, view], i) =>
    out.push(
      def({
        id: `pendwave-${n}-${T}`,
        engine: 'pendwave',
        cat: 'phys',
        vars: { n, T, K },
        theme: i + 3,
        params: (v) => ({
          n,
          T,
          K,
          view: v % 2 ? (view === 'rails' ? 'wave' : 'rails') : view,
          scale: (i + v) % 8,
          voice: VOICES[(i + v) % VOICES.length],
        }),
        titles: [
          'Phase Resonance of {n} Uncoupled Pendulums Over {T}s 🌊',
          'Standing & Traveling Waves From {n} Harmonic Oscillators ({T}s Period)',
          'Why {n} Slightly Detuned Pendulums Realign at {T}.0 Seconds',
          '{n} Pendulums Complete K+k Swings Before Reuniting at t={T}s',
          'Harmonic Alienation & Return: {n} Pendulums Over {T} Seconds',
        ],
        hooks: [
          'Realigns at t = {T}s',
          '{n} harmonic periods',
          'Phase waves emerge',
          'Full reunion at {T}s',
        ],
        intro: [
          '{n} pendulums complete integer cycle counts (K+k) in {T} seconds, sweeping through helical waves before realigning.',
          'Each phase crossing sounds {voice} in {scale} across the {T}-second harmonic period.',
        ],
        detail:
          'Pendulum k finishes (K+k) oscillations in {T}s, yielding double-spiral and standing-wave phases at rational fractions of T.',
        tags: ['pendulum wave', 'harmonic motion', 'waves', 'phase resonance'],
        hash: '#pendulumwave #physics #harmonicmotion',
      })
    )
  );

  [0, 1, 2, 3].forEach((d) => {
    const N = ['3', '31', '314', '3,141'][d];
    const mass = ['1 kg', '100 kg', '10,000 kg', '1,000,000 kg'][d];
    out.push(
      def({
        id: `pi-${d}`,
        engine: 'pi',
        cat: 'phys',
        vars: { N, mass, d, pi: ['3', '3.1', '3.14', '3.141'][d] },
        theme: d + 1,
        params: (v) => ({
          digits: d,
          scale: (d + v) % 8,
          voice: VOICES[(d + 2 + v) % VOICES.length],
        }),
        titles: [
          'Galperin Billiard Proof: {mass} vs 1 kg Yields {N} Hits (π ≈ {pi})',
          'Elastic Block Impacts Compute {N} = Digits of π ({mass} Ratio)',
          'Why Two Frictionless Blocks Count Exactly {N} Collisions',
          'Conservation of Momentum Encodes π = {pi} in {N} Wall Bounces',
        ],
        hooks: [
          '1 kg vs {mass}',
          '{N} exact collisions',
          'Momentum encodes π',
          'Galperin proof live',
        ],
        intro: [
          'A {mass} mass strikes a 1 kg block near a rigid wall, producing {N} elastic collisions — exact leading digits of π.',
          'Phase-space conservation turns mass ratio 100^{d} into a geometric counter for π = {pi}…',
        ],
        detail:
          'Gregory Galperin (1995) showed total elastic impacts equal floor(π · 10^d) when energy conservation maps onto circle geometry.',
        tags: ['pi', 'galperin theorem', 'elastic collision', 'phase space'],
        hash: '#galperin #piphysics #mechanics',
      })
    );
  });

  const orb: [number, number, number, boolean][] = [
    [14, 30, 3, false],
    [10, 24, 4, true],
    [20, 40, 2, false],
    [8, 20, 5, true],
    [16, 32, 3, true],
    [12, 36, 2, false],
    [24, 36, 2, true],
    [6, 15, 6, false],
  ];
  orb.forEach(([n, T, K, connect], i) =>
    out.push(
      def({
        id: `orbits-${n}-${T}`,
        engine: 'orbits',
        cat: 'phys',
        vars: { n, T, K },
        theme: i + 5,
        params: (v) => ({
          n,
          T,
          K,
          connect: v % 2 ? !connect : connect,
          scale: (i + 2 + v) % 8,
          voice: VOICES[(i + 3 + v) % VOICES.length],
        }),
        titles: [
          '{n} Resonant Orbits Converge on Zero Phase Every {T} Seconds 🪐',
          'Orbital Polyrhythm: {n} Concentric Bodies Sync at {T}s ({scale})',
          'When {n} Integer-Ratio Orbits Form Revolving Mandala Chords',
          'Zero-Phase Alignment After {T}s Across {n} Concentric Rings',
        ],
        hooks: [
          '{n} concentric orbits',
          'Zero-phase sync at {T}s',
          'Orbital polyrhythm',
          '{voice} transit chimes',
        ],
        intro: [
          '{n} concentric bodies orbit with arithmetic frequency steps, aligning along the meridian every {T} seconds.',
          'Meridian crossings trigger {voice} intervals in {scale}, revealing visual and harmonic beat frequencies.',
        ],
        detail:
          'Each ring completes an integer number of revolutions in {T}s, producing transient star-polygons at T/2 and T/3.',
        tags: ['orbital resonance', 'polyrhythm', 'astronomy', 'phase'],
        hash: '#orbitalresonance #polyrhythm #physics',
      })
    )
  );

  const dp: [number, number, 'lines' | 'tips', number][] = [
    [40, 30, 'lines', 1e-5],
    [60, 32, 'tips', 1e-5],
    [30, 28, 'lines', 1e-4],
    [80, 34, 'tips', 1e-6],
    [25, 28, 'lines', 3e-5],
    [50, 30, 'tips', 2e-5],
  ];
  dp.forEach(([n, dur, mode, eps], i) =>
    out.push(
      def({
        id: `dpend-${n}-${mode}`,
        engine: 'dpend',
        cat: 'phys',
        vars: { n, dur },
        theme: i + 2,
        params: (v) => ({
          n,
          dur,
          mode: v % 2 ? (mode === 'lines' ? 'tips' : 'lines') : mode,
          eps,
          scale: (i + 3 + v) % 8,
          voice: VOICES[(i + 4 + v) % VOICES.length],
        }),
        titles: [
          '{n} Coupled Double Pendulums Diverge From 10⁻⁵ Radian Offset',
          'Lyapunov Divergence Mapped Across {n} Double Pendulums ({dur}s)',
          'Deterministic Chaos: Tracking {n} Identical-Looking Starts',
          'Sensitivity to Initial Conditions Across {n} Articulated Arms',
        ],
        hooks: [
          '10⁻⁵ rad initial offset',
          '{n} chaotic trajectories',
          'Lyapunov time horizon',
          'Synchrony breaks live',
        ],
        intro: [
          '{n} double pendulums begin separated by microscopic angle increments before nonlinear coupling tears synchrony apart.',
          'Integrated via RK4 over {dur} seconds to reveal exponential phase-space divergence.',
        ],
        detail:
          'Despite zero randomness, small angular perturbations grow exponentially across the system Lyapunov timescale.',
        tags: ['double pendulum', 'chaos theory', 'lyapunov exponent', 'rk4'],
        hash: '#chaostheory #doublependulum #physics',
      })
    )
  );

  const gb: [number, number][] = [
    [12, 250],
    [10, 200],
    [14, 400],
    [8, 150],
    [12, 350],
  ];
  gb.forEach(([rows, B], i) =>
    out.push(
      def({
        id: `galton-${rows}-${B}`,
        engine: 'galton',
        cat: 'phys',
        vars: { B, rows },
        theme: i + 1,
        params: (v) => ({
          rows,
          balls: B,
          scale: (i + 4 + v) % 8,
          voice: VOICES[(i + 1 + v) % VOICES.length],
        }),
        titles: [
          '{B} Independent Coin-Flip Drops Build a {rows}-Row Binomial Curve',
          'Central Limit Theorem Live: {B} Marbles Across {rows} Peg Tiers 🔔',
          'How {B} 50/50 Peg Deflections Converge on the Normal Distribution',
          'Galton Quincunx: {rows} Binary Choices Per Sphere ({B} Trials)',
        ],
        hooks: [
          '{B} binomial trials',
          '{rows} rows form bell curve',
          'Central limit theorem',
          'Pure 50/50 statistics',
        ],
        intro: [
          '{B} balls navigate {rows} binary peg decisions, piling smoothly underneath the theoretical normal envelope.',
          'Each column height visualizes binomial coefficients C({rows}, k) emerging from independent trials.',
        ],
        detail:
          'Summing {rows} independent Bernoulli bounces converges smoothly onto the Gaussian bell profile.',
        tags: ['galton board', 'normal distribution', 'statistics', 'probability'],
        hash: '#statistics #galtonboard #probability',
      })
    )
  );

  const rc: { id: string; mode: string; curves?: string[]; drop?: number; n?: number; titles: string[]; detail: string }[] = [
    {
      id: 'brachi-a',
      mode: 'brachi',
      curves: ['line', 'cycloid', 'steep', 'arc'],
      drop: 0.45,
      titles: ['4 Gravity Profiles Compared: Why the Cycloid Beats the Straight Line 🏁', 'Brachistochrone Test: Straight vs Steep vs Arc vs Cycloid'],
      detail: 'The inverted cycloid minimizes travel time under uniform gravity via calculus of variations.',
    },
    {
      id: 'brachi-b',
      mode: 'brachi',
      curves: ['line', 'cycloid', 'parab', 'arc', 'steep'],
      drop: 0.35,
      titles: ['5-Track Descent Experiment: Longer Arc Outruns Shortest Path', 'Calculus of Variations Race: Comparing 5 Inclined Slides 🏁'],
      detail: 'Early gravitational acceleration along the cycloid outweighs its slightly longer arc length.',
    },
    {
      id: 'brachi-c',
      mode: 'brachi',
      curves: ['line', 'cycloid', 'parab'],
      drop: 0.55,
      titles: ['Johann Bernoulli’s 1696 Puzzle: Straight vs Parabola vs Cycloid', 'Fastest Descent Under Gravity: 3 Analytical Tracks Tested'],
      detail: 'Posed by Bernoulli in 1696 and solved by Newton, Leibniz, and l’Hôpital using variational methods.',
    },
    {
      id: 'brachi-d',
      mode: 'brachi',
      curves: ['line', 'cycloid', 'steep', 'parab', 'arc'],
      drop: 0.4,
      titles: ['Why Steep-First Curves Beat Direct Slopes Downhill 🏁', 'Comparing 5 Brachistochrone Approximations in Real Gravity'],
      detail: 'Matching Snell’s optical refraction law through layered gravitational speed yields the optimal cycloid.',
    },
    {
      id: 'tauto-8',
      mode: 'tauto',
      n: 8,
      titles: ['8 Release Heights Tie Exactly Inside Huygens’ Cycloid Bowl 🥣', 'Isochronous Descent: 8 Balls Converge Despite Unequal Distance'],
      detail: 'On a tautochrone cycloid, restoring acceleration scales linearly with arc distance — making period amplitude-independent.',
    },
    {
      id: 'tauto-6',
      mode: 'tauto',
      n: 6,
      titles: ['Cycloid vs Circular Arc: Only 1 Curve Equalizes All 6 Drop Times', 'Why a Circular Bowl Fails the Isochronous Timing Test'],
      detail: 'Christiaan Huygens proved in 1659 that circular pendulums drift with amplitude while cycloids stay exact.',
    },
  ];
  rc.forEach((r, i) =>
    out.push(
      def({
        id: `race-${r.id}`,
        engine: 'race',
        cat: 'phys',
        vars: { n: r.n ?? r.curves?.length ?? 4 },
        theme: i + 2,
        params: (v) => ({
          mode: r.mode,
          curves: r.curves,
          drop: r.drop,
          n: r.n,
          scale: (i + 5 + v) % 8,
          voice: VOICES[(i + 2 + v) % VOICES.length],
        }),
        titles: r.titles,
        hooks: [
          'Gravity time-of-descent',
          'Variational mechanics',
          'Track timing comparison',
          'Cycloid vs straight arc',
        ],
        intro: [
          'Classical mechanics timing comparison rendered by integrating arc-length acceleration along each track.',
          'Each track plays a {voice} chime upon crossing the finish threshold.',
        ],
        detail: r.detail,
        tags: ['brachistochrone', 'tautochrone', 'cycloid', 'classical mechanics'],
        hash: '#classicalmechanics #cycloid #physics',
      })
    )
  );
  return out;
}

function mathRecipes(): Recipe[] {
  const out: Recipe[] = [];
  const hy: [number, number, number][] = [
    [7, 2, 0.9],
    [8, 3, 0.8],
    [9, 4, 0.85],
    [11, 4, 0.8],
    [13, 5, 0.75],
    [5, 3, 0.8],
    [10, 3, 0.9],
    [12, 5, 0.8],
  ];
  hy.forEach(([R, r, d], i) =>
    out.push(
      def({
        id: `spiro-${R}-${r}`,
        engine: 'spiro',
        cat: 'math',
        vars: { n: R / gcd(R, r), R, r },
        theme: i + 4,
        params: (v) => ({
          mode: 'hypo',
          R,
          r,
          d: d + (v % 3) * 0.05,
          dur: 24,
          scale: (i + v) % 8,
          voice: VOICES[(i + v) % VOICES.length],
        }),
        titles: [
          'Gear Ratio {R}:{r} Plots a {n}-Lobe Hypotrochoid 🌸',
          'Closed Rolling Kinematics: R={R}, r={r} Generates {n} Symmetries',
          'Why R={R} Rolling Inside r={r} Closes After {n} Cusps',
          'Parametric Epitrochoid Geometry: {n}-Petal Lace From {R}:{r} Gears',
        ],
        hooks: [
          'Gear ratio {R} : {r}',
          '{n}-fold rotational symmetry',
          'Hypotrochoid closure',
          'Trigonometric locus',
        ],
        intro: [
          'An inner gear of radius r={r} rolling inside R={R} closes cleanly after tracing {n} symmetric cusps.',
          'Paired with {scale} intervals on {voice} as the pen sweeps out its polar envelope.',
        ],
        detail: 'Hypotrochoid curve: x = (R−r)cos t + d·cos((R−r)t/r), y = (R−r)sin t − d·sin((R−r)t/r).',
        tags: ['hypotrochoid', 'spirograph', 'geometry', 'parametric curve'],
        hash: '#geometry #hypotrochoid #mathart',
      })
    )
  );

  const rose: [number, number][] = [
    [3, 1],
    [5, 2],
    [7, 3],
    [4, 3],
    [9, 4],
    [6, 5],
  ];
  rose.forEach(([n, d], i) =>
    out.push(
      def({
        id: `rose-${n}-${d}`,
        engine: 'spiro',
        cat: 'math',
        vars: { n, d, k: `${n}/${d}`, petals: (n * d) % 2 === 1 ? n : 2 * n },
        theme: i + 1,
        params: (v) => ({
          mode: 'rose',
          n,
          dn: d,
          dur: 24,
          scale: (i + 1 + v) % 8,
          voice: VOICES[(i + 2 + v) % VOICES.length],
        }),
        titles: [
          'Polar Equation r = cos({k}θ) Generates {petals} Petals 🌹',
          'Why Rational k = {k} Produces Exactly {petals} Rose Loops',
          'Grandi Rose Symmetry: {petals} Interlocking Arcs From cos({k}θ)',
        ],
        hooks: [
          'r = cos({k}θ)',
          '{petals} polar petals',
          'Rational angle closure',
        ],
        intro: [
          'Evaluating r = cos({k}θ) in polar coordinates traces a closed {petals}-petal rose curve.',
          'Rational frequency k={k} determines whether loops double to 2n or close cleanly in n lobes.',
        ],
        detail: 'Luigi Guido Grandi studied polar curves r = cos(kθ) whose parity depends on n·d mod 2.',
        tags: ['rose curve', 'polar coordinates', 'mathematics', 'trigonometry'],
        hash: '#polarcoordinates #rosecurve #mathematics',
      })
    )
  );

  const ls: [number, number][] = [
    [3, 2],
    [5, 4],
    [3, 4],
    [1, 2],
    [2, 3],
    [3, 5],
    [4, 5],
    [5, 6],
  ];
  ls.forEach(([a, b], i) =>
    out.push(
      def({
        id: `lissa-${a}-${b}`,
        engine: 'lissa',
        cat: 'math',
        vars: { a, b },
        theme: i + 6,
        params: (v) => ({
          a,
          b,
          layers: 1 + (v % 3),
          dur: 24,
          scale: (i + 2 + v) % 8,
          voice: VOICES[(i + 3 + v) % VOICES.length],
        }),
        titles: [
          'Lissajous {a}:{b} Ratio — Orthogonal Harmonic Phase Drift 🎻',
          'How a {a}:{b} Acoustic Interval Looks on an X-Y Oscilloscope',
          'Rotating Phase δ Reveals Every Tangency of {a}:{b} Harmonics',
          'Perpendicular Sine Waves at {a}:{b} Ratio Trace Acoustic Knots ✨',
        ],
        hooks: [
          'Interval ratio {a} : {b}',
          'X-Y oscilloscope trace',
          'Continuous phase δ',
          'Harmonic knot lobes',
        ],
        intro: [
          'Perpendicular sine waves in rational {a}:{b} frequency ratio weave a shifting oscilloscope figure as phase advances.',
          'Harmonic tuning {a}/{b} plays alongside the X-Y phase sweep.',
        ],
        detail: 'Jules Antoine Lissajous mapped optical vibrations using x = sin(a·t + δ), y = sin(b·t).',
        tags: ['lissajous', 'oscilloscope', 'frequency ratio', 'acoustics'],
        hash: '#lissajous #oscilloscope #acoustics',
      })
    )
  );

  const ep: { id: string; shape: string; name: string; hue: number }[] = [
    { id: 'heart', shape: 'heart', name: 'Cardioid Heart', hue: 340 },
    { id: 'infinity', shape: 'infinity', name: 'Lemniscate Infinity', hue: 190 },
    { id: 'star', shape: 'star', name: 'Five-Point Star', hue: 50 },
    { id: 'trefoil', shape: 'trefoil', name: 'Trefoil Knot', hue: 270 },
    { id: 'butterfly', shape: 'butterfly', name: 'Butterfly Curve', hue: 20 },
    { id: 'clover', shape: 'clover', name: 'Four-Leaf Clover', hue: 130 },
    { id: 'wave', shape: 'wave', name: 'Harmonic Blossom', hue: 300 },
  ];
  ep.forEach((e, i) =>
    out.push(
      def({
        id: `epicycle-${e.id}`,
        engine: 'epicycle',
        cat: 'math',
        vars: { name: e.name },
        theme: i,
        params: (v) => ({
          shape: e.shape,
          hue: e.hue,
          terms: 70,
          dur: 26,
          scale: (i + 3 + v) % 8,
          voice: VOICES[(i + 4 + v) % VOICES.length],
        }),
        titles: [
          '70 Fourier Epicycles Reconstruct a {name} From Pure Rotation 🔄',
          'Discrete Fourier Decomposition: Stacking 70 Vectors Into {name}',
          'Tip-to-Tail Rotating Phasors Synthesize a {name} Outline',
          'How Complex Harmonics Trace {name} Without Straight Lines',
        ],
        hooks: [
          '70 rotating phasors',
          'Fourier series live',
          'Epicycles draw {name}',
          'Complex plane harmonics',
        ],
        intro: [
          '70 rotating phasors sorted by amplitude sum tip-to-tail to reconstruct a closed {name}.',
          'Complex Discrete Fourier coefficients decompose the silhouette into pure circular frequencies.',
        ],
        detail:
          'Every periodic complex path decomposes into ∑ c_k e^{ikωt} vectors rotating at integer harmonics.',
        tags: ['fourier transform', 'epicycles', 'phasors', 'complex analysis'],
        hash: '#fourier #epicycles #mathart',
      })
    )
  );

  const tm: [number, number, number][] = [
    [200, 10, 26],
    [300, 20, 30],
    [180, 8, 22],
    [240, 34, 34],
    [360, 12, 26],
    [150, 6, 20],
  ];
  tm.forEach(([n, k1, dur], i) =>
    out.push(
      def({
        id: `times-${n}-${k1}`,
        engine: 'times',
        cat: 'math',
        vars: { n, k1 },
        theme: i + 2,
        params: (v) => ({
          n: n + (v % 2) * 40,
          k1,
          dur,
          scale: (i + 4 + v) % 8,
          voice: VOICES[(i + 1 + v) % VOICES.length],
        }),
        titles: [
          'Modular Chords on {n} Circle Points Sweep k=2 → {k1} ❤️',
          'Caustic Envelopes Emerge From i → k·i mod {n} Multiplication',
          'From Cardioid to Nephroid: {n} Straight Lines Build Smooth Curves',
          'Arithmetic Multiplication Table Mod {n} Up to Factor {k1}',
        ],
        hooks: [
          'i → k·i mod {n}',
          'k climbs from 2 to {k1}',
          'Cardioid caustic curve',
          '{n} modular chords',
        ],
        intro: [
          'Joining point i to k·i mod {n} as multiplier k sweeps smoothly toward {k1} reveals sharp optical caustics.',
          'Straight chords weave integer-lobed cardioid, nephroid, and higher epicycloid envelopes.',
        ],
        detail: 'At multiplier k, the envelope of chords is an epicycloid with (k−1) cusps.',
        tags: ['modular arithmetic', 'cardioid', 'caustics', 'times table'],
        hash: '#modularmath #cardioid #geometry',
      })
    )
  );

  const ph: { id: string; mode: 'grow' | 'sweep'; n: number; a0?: number; a1?: number; title: string[] }[] = [
    {
      id: 'grow-1400',
      mode: 'grow',
      n: 1400,
      title: ['Phyllotaxis Packing: 1,400 Seeds Arranged by the 137.508° Golden Angle 🌻', 'Why 1,400 Florets Diverge at Exactly 2π/φ² Radians'],
    },
    {
      id: 'grow-2200',
      mode: 'grow',
      n: 2200,
      title: ['2,200 Fibonacci Spirals Packed Under Vogel’s Polar Law 🌻', 'Golden Angle Packing Across 2,200 Radial Coordinates'],
    },
    {
      id: 'sweep-a',
      mode: 'sweep',
      n: 1400,
      a0: 137.3,
      a1: 137.7,
      title: ['Sweeping ±0.2° Around 137.5° Destroys Fibonacci Parastichy Spirals 🌻', 'Narrow Angle Sweep 137.3°–137.7° Over 1,400 Seeds'],
    },
    {
      id: 'sweep-b',
      mode: 'sweep',
      n: 1800,
      a0: 136.8,
      a1: 138.2,
      title: ['Why Irrational Divergence Angle 137.508° Eliminates Radial Gaps 🌻', 'Angle Sensitivity Test: 136.8° to 138.2° Across 1,800 Florets'],
    },
    {
      id: 'sweep-c',
      mode: 'sweep',
      n: 1200,
      a0: 137.0,
      a1: 138.0,
      title: ['How 0.5° Drift Collapses Sunflower Lattice Into Spokes 🌻', 'Sweeping Divergence From 137° to 138° on 1,200 Nodes'],
    },
  ];
  ph.forEach((e, i) =>
    out.push(
      def({
        id: `phyllo-${e.id}`,
        engine: 'phyllo',
        cat: 'math',
        vars: { n: e.n },
        theme: i + 3,
        params: (v) => ({
          mode: e.mode,
          n: e.n,
          a0: e.a0,
          a1: e.a1,
          dur: 24,
          scale: (i + 5 + v) % 8,
          voice: VOICES[(i + 2 + v) % VOICES.length],
        }),
        titles: e.title,
        hooks: [
          '137.508° golden angle',
          'Vogel phyllotaxis model',
          '{n} radial florets',
          'Fibonacci spirals emerge',
        ],
        intro: [
          'Placing {n} points by r = c√k and θ = k·137.508° maximizes packing density with zero spoke alignment.',
          'Helmut Vogel’s 1979 phyllotaxis model reveals opposing Fibonacci parastichy spirals.',
        ],
        detail:
          'Because φ = (1+√5)/2 has the slowest rational convergents, 360°/φ² prevents overlapping rays.',
        tags: ['phyllotaxis', 'golden angle', 'fibonacci', 'botanical math'],
        hash: '#phyllotaxis #goldenratio #fibonacci',
      })
    )
  );

  const sv: [number, number][] = [
    [100, 10],
    [150, 10],
    [120, 10],
    [60, 10],
  ];
  sv.forEach(([n, cols], i) =>
    out.push(
      def({
        id: `sieve-${n}`,
        engine: 'sieve',
        cat: 'math',
        vars: { n },
        theme: i + 7,
        params: (v) => ({
          n,
          cols,
          scale: (i + 6 + v) % 8,
          voice: VOICES[(i + 3 + v) % VOICES.length],
        }),
        titles: [
          'Sieve of Eratosthenes Isolates Every Prime Below {n} 🔢',
          'Crossing Off Multiples Up to √{n} Reveals Prime Distribution',
          'Ancient Greek Prime Filter Running Across {n} Integers',
        ],
        hooks: [
          'Sieve up to {n}',
          'Strike composite multiples',
          'Primes remain highlighted',
        ],
        intro: [
          'Iteratively striking multiples of 2, 3, 5… leaves only the prime integers up to {n}.',
          'Each elimination plays a pitch as composite diagonals slice across the {n}-cell table.',
        ],
        detail:
          'Only primes up to √{n} need to be sieved before every remaining unmarked cell is certified prime.',
        tags: ['sieve of eratosthenes', 'prime numbers', 'number theory', 'algorithm'],
        hash: '#primenumbers #numbertheory #eratosthenes',
      })
    )
  );

  const lz: [number, number][] = [
    [8, 2e-4],
    [12, 1e-4],
    [6, 5e-4],
    [16, 1e-4],
  ];
  lz.forEach(([n, eps], i) =>
    out.push(
      def({
        id: `lorenz-${n}`,
        engine: 'lorenz',
        cat: 'math',
        vars: { n },
        theme: i + 6,
        params: (v) => ({
          n,
          eps,
          dur: 28,
          scale: (i + 7 + v) % 8,
          voice: VOICES[(i + 4 + v) % VOICES.length],
        }),
        titles: [
          '{n} Trajectories Inside Lorenz’s Strange Attractor (σ=10, ρ=28) 🦋',
          'Lobe Switching Dynamics Across {n} Perturbed Lorenz Paths',
          '3D Phase Projection of {n} Chaotic Convection Loops',
          'How {n} Nearly Identical Weather States Split Around Two Attractor Wings',
        ],
        hooks: [
          'σ=10, ρ=28, β=8/3',
          '{n} perturbed orbits',
          'Strange attractor lobes',
          'Convection chaos 3D',
        ],
        intro: [
          '{n} trajectories launched 10⁻⁴ apart orbit the two wings of Edward Lorenz’s 1963 attractor before switching lobes unpredictably.',
          'Real-time 3D rotation projects the dual-lobe fractal manifold onto 9:16 vertical space.',
        ],
        detail:
          'Integrated from dx/dt = σ(y−x), dy/dt = x(ρ−z)−y, dz/dt = xy−βz with σ=10, ρ=28, β=8/3.',
        tags: ['lorenz attractor', 'chaos theory', 'differential equations', 'dynamical systems'],
        hash: '#lorenzattractor #chaostheory #dynamicalsystems',
      })
    )
  );

  return out;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

export function buildCatalog(): Recipe[] {
  // 交错排列，让浏览时类型不重复
  const groups = [musicRecipes(), sortRecipes(), algoRecipes(), physRecipes(), mathRecipes()];
  const out: Recipe[] = [];
  const max = Math.max(...groups.map((g) => g.length));
  const ratio = groups.map((g) => g.length / max);
  const acc = groups.map(() => 0);
  const idx = groups.map(() => 0);
  for (let step = 0; step < max; step++) {
    groups.forEach((g, gi) => {
      acc[gi] += ratio[gi];
      while (acc[gi] >= 1 && idx[gi] < g.length) {
        out.push(g[idx[gi]++]);
        acc[gi] -= 1;
      }
    });
  }
  groups.forEach((g, gi) => {
    while (idx[gi] < g.length) out.push(g[idx[gi]++]);
  });
  return out;
}
