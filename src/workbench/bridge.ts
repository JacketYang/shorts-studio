import type {
  EndingType,
  HookStyle,
  RenderRecord,
  SpecRecord,
  TitlePattern,
  VideoRecord,
  VideoSpec,
  WorkbenchRecipeMeta,
} from '../domain/types.ts';
import type { VideoSpec as WorkbenchSpec } from './engine/types.ts';
import { THEMES } from './engine/util.ts';

export interface WorkbenchEnqueueItem {
  id: string;
  baseId: string;
  engine: string;
  params: unknown;
  seed: number;
  theme: number;
  category: string;
  catLabel: string;
  title: string;
  hook: string;
  description: string;
  tags: string[];
  filename: string;
  durationSec: number;
}

export interface WorkbenchChannelStatus {
  inChannel: boolean;
  status: 'available' | 'in_review' | 'scheduled' | 'published';
  specId: string | null;
  renderId: string | null;
  videoId: string | null;
  scheduledAt: string | null;
  mediaReady: boolean;
  mediaExt: 'mp4' | 'webm' | null;
  mediaBytes: number | null;
}

const ENGINE_TO_TEMPLATE: Record<string, string> = {
  hop: 'melody-bounce',
  rain: 'melody-bounce',
  ring: 'melody-bounce',
  multiply: 'melody-bounce',
  plinko: 'ball-sort',
  sorting: 'ball-sort',
  pendwave: 'pendulum-wave',
  orbits: 'orbit-sync',
};

const DEFAULT_ENGINE_VOICE: Record<string, string> = {
  hop: 'marimba',
  rain: 'celesta',
  ring: 'kalimba',
  multiply: 'rhodes',
  plinko: 'marimba',
  sorting: 'blip',
  pendwave: 'kalimba',
  orbits: 'celesta',
  pi: 'click',
  spiro: 'kalimba',
  lissa: 'rhodes',
  epicycle: 'celesta',
  times: 'celesta',
  phyllo: 'pizzicato',
  dpend: 'rhodes',
  lorenz: 'kalimba',
  galton: 'tick',
  race: 'celesta',
  sieve: 'marimba',
};

const CANONICAL_SONG_ID: Record<string, string> = {
  canon: 'pd:canon-in-d',
  ode: 'pd:ode-to-joy',
  elise: 'pd:fur-elise',
};

function asObj(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' ? (val as Record<string, unknown>) : {};
}

function resolvePaletteFamily(
  themeIdx: number,
  explicit?: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool'
): 'neon' | 'pastel' | 'mono' | 'warm' | 'cool' {
  if (explicit) return explicit;
  const th = THEMES[((themeIdx % THEMES.length) + THEMES.length) % THEMES.length];
  if (th.style === 'paper' || th.style === 'bauhaus') return 'pastel';
  if (th.style === 'blueprint' || th.style === 'oscilloscope') return 'cool';
  if (th.style === 'editorial') return 'warm';
  return 'neon';
}

export function extractInstrument(item: WorkbenchEnqueueItem): string {
  const p = asObj(item.params);
  if (typeof p.voice === 'string' && p.voice.trim()) return p.voice.trim();
  return DEFAULT_ENGINE_VOICE[item.engine] ?? 'marimba';
}

export function extractMusicPiece(item: WorkbenchEnqueueItem): string {
  const p = asObj(item.params);
  const song = asObj(p.song);
  const transpose = typeof p.transpose === 'number' && p.transpose !== 0 ? `:t${p.transpose}` : '';
  if (typeof song.id === 'string' && song.id.trim()) {
    const rawId = song.id.trim();
    const base = CANONICAL_SONG_ID[rawId] ?? `wb:song:${rawId}`;
    return `${base}${transpose}`;
  }
  const scaleIdx = typeof p.scale === 'number' ? p.scale : 0;
  const voice = extractInstrument(item);
  return `wb:scale-${scaleIdx}-${voice}`;
}

function extractArena(item: WorkbenchEnqueueItem): string {
  const p = asObj(item.params);
  const th = THEMES[((item.theme % THEMES.length) + THEMES.length) % THEMES.length];
  let layout = item.category;
  if (item.engine === 'hop' && typeof p.layout === 'string') layout = p.layout;
  else if (item.engine === 'plinko' && typeof p.pegLayout === 'string') layout = p.pegLayout;
  else if ((item.engine === 'sorting' || item.engine === 'pendwave') && typeof p.view === 'string') layout = p.view;
  else if (item.engine === 'ring') layout = `k${p.k ?? 3}m${p.m ?? 7}`;
  else if (item.engine === 'multiply') layout = Number(p.gravity ?? 0) > 0 ? 'gravity' : 'zero-g';
  else if ((item.engine === 'spiro' || item.engine === 'phyllo' || item.engine === 'race' || item.engine === 'dpend') && typeof p.mode === 'string') layout = p.mode;
  else if (item.engine === 'epicycle' && typeof p.shape === 'string') layout = p.shape;
  return `${layout}@${th.style}-${th.isLight ? 'light' : 'dark'}`;
}

function extractRule(item: WorkbenchEnqueueItem): string {
  const p = asObj(item.params);
  switch (item.engine) {
    case 'hop':
      return p.rounds ? `speedup-${p.rounds}r-t${p.target ?? 32}` : `hop-${String(p.layout ?? 'flat')}`;
    case 'rain':
      return `rain-t${p.transpose ?? 0}`;
    case 'ring':
      return `star-${p.k ?? 3}-${p.m ?? 7}-d${Math.round(Number(p.drift ?? 0) * 1000)}`;
    case 'multiply':
      return `g${p.gravity ?? 0}-cap${p.cap ?? 70}`;
    case 'plinko':
      return `bins${p.bins ?? 4}-b${p.balls ?? 16}-${String(p.pegLayout ?? 'stagger')}`;
    case 'sorting':
      return `${String(p.algo ?? 'quick')}-${String(p.view ?? 'bars')}-n${p.n ?? 64}`;
    case 'pendwave':
      return `n${p.n ?? 20}-T${p.T ?? 22}-K${p.K ?? 15}-${String(p.view ?? 'rails')}`;
    case 'orbits':
      return `n${p.n ?? 14}-T${p.T ?? 30}-K${p.K ?? 3}-${p.connect ? 'link' : 'free'}`;
    case 'pi':
      return `digits-${p.digits ?? 2}`;
    case 'spiro':
      return p.mode === 'rose' ? `rose-${p.n ?? 3}-${p.dn ?? 1}` : `hypo-${p.R ?? 7}-${p.r ?? 2}`;
    case 'lissa':
      return `ratio-${p.a ?? 3}-${p.b ?? 2}-L${p.layers ?? 2}`;
    case 'epicycle':
      return `shape-${String(p.shape ?? 'heart')}-t${p.terms ?? 70}`;
    case 'times':
      return `n${p.n ?? 200}-k${p.k1 ?? 10}`;
    case 'phyllo':
      return `${String(p.mode ?? 'grow')}-n${p.n ?? 1400}`;
    case 'dpend':
      return `n${p.n ?? 40}-${String(p.mode ?? 'lines')}`;
    case 'lorenz':
      return `n${p.n ?? 10}-s${item.seed % 97}`;
    case 'galton':
      return `r${p.rows ?? 12}-b${p.balls ?? 250}`;
    case 'race':
      return `${String(p.mode ?? 'brachi')}-n${p.n ?? (Array.isArray(p.curves) ? p.curves.length : 4)}`;
    case 'sieve':
      return `n${p.n ?? 100}-c${p.cols ?? 10}`;
    default:
      return `seed-${item.seed}`;
  }
}

function inferTitlePattern(title: string): TitlePattern {
  const t = title.trim();
  if (t.endsWith('?') || t.includes('? ') || /^(?:how|why|can|what|which|when)\b/i.test(t)) return 'question';
  if (/^[\d]+|\b\d+\s+(?:marbles|spheres|pendulums|orbits|rotating|ramps|trials|points|tempo|release)/i.test(t)) {
    return 'number-contrast';
  }
  if (/test|compare|guess|race|count|spot/i.test(t)) return 'challenge';
  if (t.includes('…') || t.includes('...')) return 'ellipsis';
  return 'statement';
}

function inferHookStyle(item: WorkbenchEnqueueItem): HookStyle {
  const text = `${item.title} ${item.hook}`.toLowerCase();
  if (item.engine === 'pendwave' || item.engine === 'orbits' || /\bt\s*=|\d+s\b|seconds/.test(text)) {
    return 'countdown';
  }
  if (item.engine === 'multiply' || /speedup|acceleration|compress|climb|cascade|4×/.test(text)) {
    return 'escalation';
  }
  if (item.engine === 'race' || item.engine === 'pi' || /beats|wins|zero|errors|tie/.test(text)) {
    return 'contrast';
  }
  if (text.includes('?') || /predict|guess|pick|ratio/.test(text)) {
    return 'prediction';
  }
  return 'mystery';
}

function inferEnding(engine: string): EndingType {
  if (['pi', 'plinko', 'sorting', 'race', 'sieve', 'galton', 'epicycle'].includes(engine)) return 'reveal';
  if (['dpend', 'lorenz'].includes(engine)) return 'cut';
  return 'loop';
}

function buildFirstComment(item: WorkbenchEnqueueItem): string {
  switch (item.category) {
    case 'music':
      return `Arranged for ${extractInstrument(item)}. Which classical motif or interval should we pair with this physics setup next?`;
    case 'sort':
      return 'Each peg collision triggers a scale degree as trajectories converge. Which peg geometry produces the cleanest cascade?';
    case 'algo':
      return 'Listen for how comparisons vs swaps change the acoustic rhythm before the final verification sweep.';
    case 'math':
      return 'Computed directly from the governing parametric equations at 60 steps/s — what parameter variation would you test next?';
    default:
      return 'Notice how periodic alignment or phase divergence emerges without manual keyframes — headphones highlight stereo panning.';
  }
}

export function toWorkbenchEnqueueItem(spec: WorkbenchSpec, durationSec: number): WorkbenchEnqueueItem {
  return {
    id: spec.id,
    baseId: spec.id.split('~')[0],
    engine: spec.engine,
    params: spec.params,
    seed: spec.seed,
    theme: spec.theme,
    category: spec.category,
    catLabel: spec.catLabel,
    title: spec.title,
    hook: spec.hook,
    description: spec.description,
    tags: spec.tags,
    filename: spec.filename,
    durationSec: Math.max(5, Math.min(180, Math.round(durationSec) || 25)),
  };
}

export function workbenchItemToStudioSpec(
  item: WorkbenchEnqueueItem,
  channelSlug: string,
  paletteFamily?: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool'
): VideoSpec {
  const safeKey = `wb-${item.id.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 72);
  const template = ENGINE_TO_TEMPLATE[item.engine] ?? 'melody-bounce';
  const duration = Math.max(10, Math.min(60, Math.round(item.durationSec) || 25));
  const cleanTitle = item.title.replace(/#\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || `Workbench ${item.engine} Simulation`;
  const cleanHook = (item.hook || cleanTitle).trim().slice(0, 80);

  const th = THEMES[((item.theme % THEMES.length) + THEMES.length) % THEMES.length];
  const resolvedPalette = resolvePaletteFamily(item.theme, paletteFamily);
  const instrument = extractInstrument(item);
  const musicPiece = extractMusicPiece(item);
  const arena = extractArena(item);
  const rule = extractRule(item);
  const hookStyle = inferHookStyle(item);
  const titlePattern = inferTitlePattern(cleanTitle);
  const ending = inferEnding(item.engine);
  const p = asObj(item.params);
  const transpose = typeof p.transpose === 'number' ? p.transpose : 0;
  const tempoScale = typeof p.tempoScale === 'number' && Number.isFinite(p.tempoScale) ? Math.max(0.5, Math.min(2.5, p.tempoScale)) : 1;
  const effectiveTempoBpm = Math.max(40, Math.min(240, Math.round(108 * tempoScale)));

  return {
    schema: 'videospec/1',
    spec_key: safeKey,
    channel_slug: channelSlug,
    concept: {
      working_title: cleanTitle,
      hook_line: cleanHook,
      hook_style: hookStyle,
      payoff: `${item.catLabel} (${item.engine} / ${th.name}) acoustic-visual simulation`,
      emotion: hookStyle === 'contrast' || hookStyle === 'prediction' ? 'curious' : 'awe',
      series: null,
      novelty_notes: `Workbench ${item.engine} on ${th.name} (${arena}) with ${instrument} (${musicPiece})`,
      twist: `${rule} progression voiced by ${instrument}`,
    },
    format: {
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      duration_sec: duration,
      loop: { enabled: ending === 'loop', mode: 'audio-return' },
    },
    scene: {
      template,
      template_version: '^1.0',
      seed: item.seed,
      style: {
        palette: {
          family: resolvedPalette,
          colors: th.accent.slice(0, 4),
        },
        background: { type: 'gradient', colors: th.bg },
        trail: { enabled: true, length_frames: 16, fade: 0.85 },
        fx: { level: th.isLight ? 1 : 2 },
      },
      arc: {
        preset: 'ramp',
        climax_at: 0.85,
        hook_peek: true,
      },
      params: {
        workbench_engine: item.engine,
        workbench_params: item.params,
      },
    },
    timeline: [
      {
        t: 0,
        dur: 2.0,
        type: 'text',
        role: 'hook',
        text: cleanHook,
        position: 'top-safe',
        style: th.isLight ? 'clean-dark-ink' : 'bold-white-shadow',
      },
    ],
    audio: {
      mode: 'sim-driven',
      music: {
        melody_ref: { source: 'library', id: musicPiece },
        transpose,
        tempo_bpm: effectiveTempoBpm,
        instrument,
        note_mapping: 'per_collision',
        wrap: 'loop',
        reverb: p.echo === false ? 0 : 0.12,
      },
      mix: { target_lufs: -14, true_peak_db: -1 },
    },
    publish: {
      title: cleanTitle,
      description: item.description,
      tags: item.tags.slice(0, 15),
      category_id: '28',
      made_for_kids: false,
      contains_synthetic_media: false,
      default_language: 'en',
      first_comment: buildFirstComment(item),
      schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
    },
    axes: {
      mechanic: item.engine,
      arena,
      rule,
      music_piece: musicPiece,
      hook_style: hookStyle,
      title_pattern: titlePattern,
      ending,
      palette_family: resolvedPalette,
      instrument,
    },
    provenance: {
      generator: {
        kind: 'bot',
        model: `workbench:${item.engine}`,
        prompt_version: 'video-workbench-2',
      },
      created_at: new Date().toISOString(),
    },
  };
}

export function matchWorkbenchChannelStatus(
  workbenchId: string,
  baseId: string,
  specs: SpecRecord[],
  renders: RenderRecord[],
  videos: VideoRecord[]
): WorkbenchChannelStatus {
  const exactKey = `wb-${workbenchId.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 72);
  const spec =
    specs.find((s) => s.workbench_id === workbenchId || s.spec.spec_key === exactKey) ??
    specs.find((s) => s.workbench_id?.split('~')[0] === baseId);

  if (!spec) {
    return {
      inChannel: false,
      status: 'available',
      specId: null,
      renderId: null,
      videoId: null,
      scheduledAt: null,
      mediaReady: false,
      mediaExt: null,
      mediaBytes: null,
    };
  }

  const render = renders.find((r) => r.spec_id === spec.id) ?? null;
  const video = videos.find((v) => v.spec_id === spec.id && v.state !== 'withdrawn') ?? null;

  let status: WorkbenchChannelStatus['status'] = 'in_review';
  if (video?.state === 'published' || spec.status === 'published') {
    status = 'published';
  } else if (video) {
    status = 'scheduled';
  }

  return {
    inChannel: true,
    status,
    specId: spec.id,
    renderId: render?.id ?? null,
    videoId: video?.id ?? null,
    scheduledAt: video?.scheduled_at ?? null,
    mediaReady: Boolean(render?.media_ready),
    mediaExt: render?.media_ext ?? null,
    mediaBytes: render?.media_bytes ?? null,
  };
}

export const WORKBENCH_ENGINE_LABELS: Record<string, string> = {
  hop: '旋律跳跃球 (Hop)',
  rain: '音符雨阵琴键 (Rain)',
  ring: '圆环弹奏多边形 (Ring)',
  multiply: '裂变共振琴球 (Multiply)',
  plinko: '高尔顿彩色分拣机 (Plinko)',
  sorting: '排序算法可视化之声 (Sorting)',
  pendwave: '谐波钟摆共振波 (Pendulum Wave)',
  orbits: '行星轨道相位合奏 (Orbits)',
  pi: '弹性碰撞计算圆周率 (Pi)',
  spiro: '万花尺几何繁花 (Spirograph)',
  lissa: '利萨如和谐波曲线 (Lissajous)',
  epicycle: '傅里叶本轮叠画 (Epicycle)',
  times: '模乘心形丝网表 (Times Table)',
  phyllo: '黄金角向日葵螺旋 (Phyllotaxis)',
  dpend: '双摆混沌轨迹光影 (Double Pendulum)',
  lorenz: '洛伦兹奇异吸引子 (Lorenz)',
  galton: '高尔顿钉板正态分布 (Galton)',
  race: '随机物理赛道竞速 (Race)',
  sieve: '埃拉托色尼质数筛音画 (Prime Sieve)',
};

export function workbenchMetaToWorkbenchSpec(
  meta: WorkbenchRecipeMeta,
  title: string,
  description: string,
  tags: string[]
): WorkbenchSpec {
  return {
    id: meta.id,
    engine: meta.engine,
    params: meta.params,
    seed: meta.seed,
    theme: meta.theme,
    category: meta.category,
    catLabel: meta.cat_label,
    title,
    hook: meta.hook,
    description,
    tags,
    filename: meta.filename,
  };
}

export function extractWorkbenchMetaFromSpec(spec: VideoSpec): WorkbenchRecipeMeta | null {
  const params = spec.scene.params as Record<string, unknown> | undefined;
  const engine = typeof params?.workbench_engine === 'string' ? params.workbench_engine : null;
  if (!engine) return null;
  return {
    id: spec.spec_key,
    base_id: spec.spec_key,
    engine,
    params: params?.workbench_params ?? {},
    seed: spec.scene.seed,
    theme: 0,
    category: spec.axes.arena || 'music',
    cat_label: WORKBENCH_ENGINE_LABELS[engine] ?? engine,
    hook: spec.concept.hook_line || spec.publish.title,
    filename: spec.spec_key,
    duration_sec: spec.format.duration_sec,
  };
}
