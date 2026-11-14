import fs from 'node:fs';
import path from 'node:path';
import {
  computeScoreboardAndMix,
  evaluateChannelTrustLevel,
  findL1AutoApproveCandidates,
} from '../domain/bandit.ts';
import { scoreChannelVideos } from '../domain/analytics.ts';
import { sha256Hex } from '../domain/hash.ts';
import { INITIAL_MELODIES } from '../domain/melodies.ts';
import { evaluateNovelty } from '../domain/novelty.ts';
import {
  canConsumeQuota,
  computeQuotaSummary,
  findNextPublishSlot,
  getPacificDateString,
  YOUTUBE_QUOTA_COSTS,
} from '../domain/quota.ts';
import { runDeterministicSimulation } from '../domain/simulation.ts';
import { FIXTURE_BALL_SORT, FIXTURE_MELODY_BOUNCE, FIXTURE_ORBIT_SYNC, FIXTURE_PENDULUM_WAVE, TEMPLATE_REGISTRY } from '../domain/templates.ts';
import type {
  AICallEntry,
  AiProviderConfig,
  AuditLogEntry,
  Channel,
  ChannelProfile,
  CommentRecord,
  CompilationRecord,
  DbAdapterConfig,
  IdeaRecord,
  JobItem,
  MelodyEntry,
  QuotaLedgerEntry,
  ReferenceChannelRecord,
  ReferenceVideoRecord,
  RemoteVideo,
  RenderRecord,
  ReviewRecord,
  ServerEnvStatus,
  SpecRecord,
  StorageConfig,
  TrendSignalRecord,
  VideoRecord,
  VideoSpec,
} from '../domain/types.ts';
import { computeSpecHash } from '../domain/videospec.ts';
import {
  cleanupChannelMediaFiles,
  DEFAULT_DB_CONFIG,
  DEFAULT_STORAGE_CONFIG,
  normalizeDbConfig,
  normalizeStorageConfig,
} from './storage.ts';
import { getAppBaseUrl, getYoutubeRedirectUri, isYoutubeApiKeyConfigured, isYoutubeOAuthConfigured } from './youtube.ts';
import {
  bindSecretsSource,
  describeSecret,
  isSecretConfigured,
  SECRET_ENV_MAP,
  SECRET_LABELS,
  type AppSecrets,
} from './secrets.ts';

export const DEFAULT_AI_CONFIG: AiProviderConfig = {
  provider: 'gemini',
  base_url: '',
  model: 'gemini-4-hydrogen',
  thinking_level: 'max',
  prompts: {
    specgen_system: `You are a creative producer for a YouTube Shorts channel publishing original code-rendered physics/music simulations.
Write creative metadata and valid template params for each assigned structural axis combination, tuned strictly to this channel's real YouTube Studio performance data.
Rules:
1. Keep the exact assigned mechanic, arena, rule, music_piece, hook_style, title_pattern, ending.
2. hook_line must be <= 6 words and deliver instant visual+audio payoff at t=0.2s (NO slow science-lecture setups).
3. title must be <= 100 chars, no hashtags in title, max 1 emoji, and must NOT reuse any recent or fatigued title skeleton.
4. novelty_notes must be >= 25 characters explaining the concrete structural/audio difference (not color).
5. first_comment must be a concise question <= 140 chars inviting viewers to guess or comment.
6. Duration guidance: use 24-38s for melody-bounce, pendulum-wave, and orbit-sync (drives watch hours & subscriber conversion), and 16-24s for tight high-loop ball-sort.`,
    next_episode:
      'You are a YouTube Shorts sequel producer. Keep hook_line <= 6 words, title <= 100 chars without hashtags, novelty_notes >= 25 chars explaining structural differences.',
    comment_reply:
      'Write a concise, friendly reply (max 200 chars, max 1 emoji). If spam, scam, links, or abuse, set action="hide" and text="".',
  },
};

export function normalizeAiConfig(raw?: Partial<AiProviderConfig> | null): AiProviderConfig {
  const provider =
    raw?.provider === 'openai-compatible' || raw?.provider === 'anthropic' ? raw.provider : 'gemini';
  const thinking_level =
    raw?.thinking_level === 'off' ||
    raw?.thinking_level === 'low' ||
    raw?.thinking_level === 'medium' ||
    raw?.thinking_level === 'high' ||
    raw?.thinking_level === 'max'
      ? raw.thinking_level
      : 'max';
  return {
    provider,
    base_url: typeof raw?.base_url === 'string' ? raw.base_url.trim() : '',
    model: typeof raw?.model === 'string' && raw.model.trim() ? raw.model.trim() : DEFAULT_AI_CONFIG.model,
    thinking_level,
    prompts: {
      specgen_system:
        typeof raw?.prompts?.specgen_system === 'string' && raw.prompts.specgen_system.trim()
          ? raw.prompts.specgen_system
          : DEFAULT_AI_CONFIG.prompts.specgen_system,
      next_episode:
        typeof raw?.prompts?.next_episode === 'string' && raw.prompts.next_episode.trim()
          ? raw.prompts.next_episode
          : DEFAULT_AI_CONFIG.prompts.next_episode,
      comment_reply:
        typeof raw?.prompts?.comment_reply === 'string' && raw.prompts.comment_reply.trim()
          ? raw.prompts.comment_reply
          : DEFAULT_AI_CONFIG.prompts.comment_reply,
    },
  };
}

export function getServerEnvStatus(): ServerEnvStatus {
  const isSet = (val: string | undefined, placeholders: string[] = []) => {
    if (!val) return false;
    const trimmed = val.trim();
    if (!trimmed) return false;
    return !placeholders.some((p) => trimmed.startsWith(p));
  };
  return {
    gemini_key: isSecretConfigured('gemini_api_key'),
    custom_ai_key: isSecretConfigured('custom_ai_api_key'),
    anthropic_key: isSecretConfigured('anthropic_api_key'),
    youtube_api_key: isYoutubeApiKeyConfigured(),
    google_client_id: isSecretConfigured('google_client_id'),
    google_client_secret: isSecretConfigured('google_client_secret'),
    s3_credentials:
      isSecretConfigured('storage_access_key_id') && isSecretConfigured('storage_secret_access_key'),
    webdav_credentials:
      isSecretConfigured('webdav_username') && isSecretConfigured('webdav_password'),
    database_url: isSet(process.env.DATABASE_URL, ['MY_', 'postgres://user:pass']),
  };
}

export interface StudioDatabase {
  channels: Channel[];
  profiles: ChannelProfile[];
  ai_config: AiProviderConfig;
  storage_config: StorageConfig;
  db_config: DbAdapterConfig;
  melodies: MelodyEntry[];
  specs: SpecRecord[];
  renders: RenderRecord[];
  reviews: ReviewRecord[];
  videos: VideoRecord[];
  remote_videos: RemoteVideo[];
  compilations: CompilationRecord[];
  quota_ledger: QuotaLedgerEntry[];
  ai_calls: AICallEntry[];
  audit_log: AuditLogEntry[];
  jobs: JobItem[];
  ideas: IdeaRecord[];
  comments: CommentRecord[];
  reference_channels: ReferenceChannelRecord[];
  reference_videos: ReferenceVideoRecord[];
  trend_signals: TrendSignalRecord[];
  /** 后台表单保存的凭据；留空则回退到环境变量 */
  secrets?: Partial<AppSecrets>;
}

export function resolveDbPath(overridePath?: string): string {
  const raw = overridePath?.trim() || process.env.STORAGE_DB_PATH?.trim() || './data/studio-db.json';
  return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

const DB_PATH = resolveDbPath();

function createSeedDatabase(): StudioDatabase {
  const now = '2026-11-13T08:00:00.000Z';
  const channels: Channel[] = [
    {
      id: 'ch-physics-music',
      slug: 'physics-music',
      yt_channel_id: 'UC_PHYSICS_MUSIC_01',
      title: 'Physics & Music Shorts',
      status: 'audit_pending',
      api_audit_verified: false,
      gcp_project_ref: 'proj-shorts-studio',
      created_at: '2026-10-26T00:00:00.000Z',
    },
    {
      id: 'ch-algo-sounds',
      slug: 'algo-sounds',
      yt_channel_id: 'UC_ALGO_SOUNDS_02',
      title: 'Algorithm & Math Acoustics',
      status: 'connected',
      api_audit_verified: false,
      gcp_project_ref: 'proj-shorts-studio',
      created_at: '2026-11-01T00:00:00.000Z',
    },
  ];

  const profiles: ChannelProfile[] = [
    {
      channel_id: 'ch-physics-music',
      locale: 'en-US',
      niche: 'melody-physics-simulations',
      brand: {
        primary_color: '#0F172A',
        palette_family: 'neon',
        tone_rules: 'Concise, curious, invite viewers to guess the melody or winning bin',
        forbidden_topics: ['clickbait', 'copyrighted pop songs', 'politics'],
      },
      allowed_templates: ['melody-bounce', 'ball-sort', 'pendulum-wave', 'orbit-sync'],
      review_mode: 'L0',
      trust_level: 0,
      novelty_mode: 'warn',
      daily_cap: 3,
      is_new_channel: false,
      tz: 'America/New_York',
      posting_windows: [
        ['17:00', '22:00'],
        ['12:00', '14:00'],
      ],
      ai_budget_monthly_usd: 5,
    },
    {
      channel_id: 'ch-algo-sounds',
      locale: 'en-US',
      niche: 'sorting-algorithms-and-math-sonification',
      brand: {
        primary_color: '#1E293B',
        palette_family: 'mono',
        tone_rules: 'Minimalist, analytical, pure acoustic math tone',
        forbidden_topics: ['hyperbolic claims', 'pop music'],
      },
      allowed_templates: ['ball-sort', 'melody-bounce', 'pendulum-wave', 'orbit-sync'],
      review_mode: 'L0',
      trust_level: 0,
      novelty_mode: 'block',
      daily_cap: 2,
      is_new_channel: true,
      tz: 'America/New_York',
      posting_windows: [['18:00', '21:00']],
      ai_budget_monthly_usd: 5,
    },
  ];

  const spec1: VideoSpec = structuredClone(FIXTURE_MELODY_BOUNCE);
  const spec2: VideoSpec = structuredClone(FIXTURE_BALL_SORT);
  const spec3: VideoSpec = {
    ...structuredClone(FIXTURE_MELODY_BOUNCE),
    spec_key: 'mb-ode-to-joy-triangle-grow-0003',
    concept: {
      working_title: 'Ode to Joy with growing ball in rotating triangle',
      hook_line: 'Wait for the final bounce',
      hook_style: 'escalation',
      payoff: 'Ball grows 3% on each bounce inside a spinning triangle until it fills the frame.',
      emotion: 'satisfying',
      series: { slug: 'name-that-tune', episode: 2, title: 'Name That Tune' },
      novelty_notes:
        'Episode 2 switches to a rotating triangle arena with grow-on-bounce rule and Ode to Joy melody instead of Canon in D.',
    },
    scene: {
      ...structuredClone(FIXTURE_MELODY_BOUNCE.scene),
      seed: 441209,
      params: {
        arena: { shape: 'triangle', size: 0.8, wall_thickness: 0.012, rotation_deg_per_s: 12 },
        balls: { count_start: 1, radius: 0.022, speed: 0.58, restitution: 1.01, gravity: 0.15, max_count: 1 },
        rule: { type: 'grow_on_bounce', scale_factor: 1.035 },
        note_trigger: { on: 'ball_wall_collision', velocity_from: 'impact' },
      },
    },
    timeline: [
      { t: 0, dur: 1.5, type: 'text', role: 'hook', text: 'Wait for the final bounce', position: 'top-safe' },
      { t: -2, dur: 2, type: 'text', role: 'end_card', text: 'Name That Tune • Part 2', position: 'bottom-safe' },
    ],
    audio: {
      ...structuredClone(FIXTURE_MELODY_BOUNCE.audio),
      music: {
        melody_ref: { source: 'library', id: 'pd:ode-to-joy' },
        transpose: 0,
        tempo_bpm: 112,
        instrument: 'glockenspiel',
        note_mapping: 'per_collision',
        wrap: 'loop',
        reverb: 0.1,
      },
    },
    publish: {
      ...structuredClone(FIXTURE_MELODY_BOUNCE.publish),
      title: '1 Ball Grows Every Bounce Until It Fills the Triangle',
      first_comment: 'Recognize this Beethoven melody? Comment below 👇',
    },
    axes: {
      mechanic: 'melody-bounce',
      arena: 'triangle',
      rule: 'grow-on-bounce',
      music_piece: 'pd:ode-to-joy',
      hook_style: 'escalation',
      title_pattern: 'statement',
      ending: 'loop',
      palette_family: 'neon',
      instrument: 'glockenspiel',
    },
  };

  // Channel 2 isolated spec
  const specCh2: VideoSpec = {
    ...structuredClone(FIXTURE_BALL_SORT),
    spec_key: 'bs-algo-quicksort-mono-0001',
    channel_slug: 'algo-sounds',
    concept: {
      working_title: 'Monochrome Peg Array Acoustic Sort',
      hook_line: 'Can 32 spheres self-sort?',
      hook_style: 'countdown',
      payoff: 'Monochrome spheres cascade through staggered pegs into 4 harmonic bins.',
      emotion: 'curious',
      series: null,
      novelty_notes: 'Channel B monochrome aesthetic with 32 balls and stepped bins.',
    },
    axes: {
      mechanic: 'ball-sort',
      arena: 'stairs',
      rule: 'moving-gate',
      music_piece: 'gen:lydian-3141',
      hook_style: 'countdown',
      title_pattern: 'question',
      ending: 'reveal',
      palette_family: 'mono',
      instrument: 'pluck',
    },
    publish: {
      ...structuredClone(FIXTURE_BALL_SORT.publish),
      title: '32 Spheres Sort Into Harmonic Bins in 22s',
      first_comment: 'Which frequency sounded cleanest to you?',
    },
  };

  const specs: SpecRecord[] = [
    {
      id: 'spec-1',
      channel_id: 'ch-physics-music',
      spec: spec1,
      spec_hash: computeSpecHash(spec1),
      schema_version: 'videospec/1',
      status: 'in_review',
      series_id: 'name-that-tune',
      episode: 1,
      created_at: '2026-11-12T10:00:00.000Z',
      updated_at: now,
    },
    {
      id: 'spec-2',
      channel_id: 'ch-physics-music',
      spec: spec2,
      spec_hash: computeSpecHash(spec2),
      schema_version: 'videospec/1',
      status: 'spec_ready',
      series_id: null,
      episode: null,
      created_at: '2026-11-12T12:00:00.000Z',
      updated_at: now,
    },
    {
      id: 'spec-3',
      channel_id: 'ch-physics-music',
      spec: spec3,
      spec_hash: computeSpecHash(spec3),
      schema_version: 'videospec/1',
      status: 'scheduled',
      series_id: 'name-that-tune',
      episode: 2,
      created_at: '2026-11-11T09:00:00.000Z',
      updated_at: now,
    },
    {
      id: 'spec-ch2-1',
      channel_id: 'ch-algo-sounds',
      spec: specCh2,
      spec_hash: computeSpecHash(specCh2),
      schema_version: 'videospec/1',
      status: 'spec_ready',
      series_id: null,
      episode: null,
      created_at: '2026-11-12T14:00:00.000Z',
      updated_at: now,
    },
    {
      id: 'spec-4',
      channel_id: 'ch-physics-music',
      spec: structuredClone(FIXTURE_PENDULUM_WAVE),
      spec_hash: computeSpecHash(FIXTURE_PENDULUM_WAVE),
      schema_version: 'videospec/1',
      status: 'spec_ready',
      series_id: 'harmonic-waves',
      episode: 1,
      created_at: '2026-11-12T15:00:00.000Z',
      updated_at: now,
    },
    {
      id: 'spec-5',
      channel_id: 'ch-physics-music',
      spec: structuredClone(FIXTURE_ORBIT_SYNC),
      spec_hash: computeSpecHash(FIXTURE_ORBIT_SYNC),
      schema_version: 'videospec/1',
      status: 'spec_ready',
      series_id: null,
      episode: null,
      created_at: '2026-11-12T15:10:00.000Z',
      updated_at: now,
    },
  ];

  // Render spec1 and spec3 deterministically
  const mel1 = INITIAL_MELODIES.find((m) => m.id === 'pd:canon-in-d');
  const sim1 = runDeterministicSimulation(spec1, mel1);
  const nov1 = evaluateNovelty(spec1, {
    channelProfile: profiles[0],
    channelHistory: [{ spec_id: 'spec-3', spec: spec3, created_at: '2026-11-11T09:00:00.000Z' }],
    crossChannelSpecs: [{ channel_id: 'ch-algo-sounds', spec: specCh2 }],
    now: new Date(now),
  });

  const mel3 = INITIAL_MELODIES.find((m) => m.id === 'pd:ode-to-joy');
  const sim3 = runDeterministicSimulation(spec3, mel3);
  const nov3 = evaluateNovelty(spec3, {
    channelProfile: profiles[0],
    channelHistory: [],
    crossChannelSpecs: [{ channel_id: 'ch-algo-sounds', spec: specCh2 }],
    now: new Date(now),
  });

  const renders: RenderRecord[] = [
    {
      id: 'rnd-1',
      channel_id: 'ch-physics-music',
      spec_id: 'spec-1',
      template_version: '1.0.0',
      status: 'completed',
      worker: 'local-deterministic-worker',
      started_at: '2026-11-12T10:05:00.000Z',
      ended_at: '2026-11-12T10:05:18.000Z',
      duration_ms: 18240,
      sim_hash: sim1.sim_hash,
      file_sha256: sha256Hex(`mp4:${sim1.sim_hash}`),
      events: sim1.events.slice(0, 120),
      qa_checks: sim1.qa_checks,
      qa_passed: sim1.qa_passed,
      novelty: nov1,
    },
    {
      id: 'rnd-3',
      channel_id: 'ch-physics-music',
      spec_id: 'spec-3',
      template_version: '1.0.0',
      status: 'completed',
      worker: 'github-actions-ubuntu',
      started_at: '2026-11-11T09:10:00.000Z',
      ended_at: '2026-11-11T09:12:40.000Z',
      duration_ms: 160000,
      sim_hash: sim3.sim_hash,
      file_sha256: sha256Hex(`mp4:${sim3.sim_hash}`),
      events: sim3.events.slice(0, 120),
      qa_checks: sim3.qa_checks,
      qa_passed: sim3.qa_passed,
      novelty: nov3,
    },
  ];

  const reviews: ReviewRecord[] = [
    {
      id: 'rev-3',
      channel_id: 'ch-physics-music',
      render_id: 'rnd-3',
      spec_id: 'spec-3',
      mode: 'L0',
      decision: 'approved',
      reason_tags: [],
      note: '第一秒起音明显，三角形旋转缩放清晰',
      decided_by: 'operator@shorts-studio',
      decided_at: '2026-11-11T10:00:00.000Z',
    },
  ];

  const videos: VideoRecord[] = [
    {
      id: 'vid-3',
      channel_id: 'ch-physics-music',
      spec_id: 'spec-3',
      render_id: 'rnd-3',
      yt_video_id: null,
      idempotency_key: 'upload:vid-3',
      state: 'semi_manual_pending',
      scheduled_at: '2026-11-14T22:00:00.000Z',
      published_at: null,
      privacy: 'private',
      title: spec3.publish.title,
      description: spec3.publish.description,
      first_comment: spec3.publish.first_comment ?? '',
      first_comment_posted: false,
      quota_deferred: false,
    },
  ];

  // Grounded in 01-channel-diagnosis.md real metrics snapshot
  const rawRemoteVideos: RemoteVideo[] = [
    {
      id: 'rv-1',
      channel_id: 'ch-physics-music',
      yt_video_id: 'JTrpkr4ZGCo',
      title: 'Canon in D on a Bouncing Ball Xylophone',
      published_at: '2026-11-08T17:00:00Z',
      privacy: 'public',
      duration_sec: 26,
      is_legacy: false,
      series_tag: 'melody-bounce',
      views: 1871,
      engaged_views: 923,
      avg_view_pct: 94.2,
      avg_view_sec: 24,
      stayed_to_watch_pct: 49.3,
      stayed_is_estimated: false,
      likes: 41,
      comments: 2,
      shares: 2,
      subs_gained: 4,
      subs_lost: 0,
      watch_hours: 12.5,
      retention_curve: [
        { ratio: 0.0, watch_ratio: 1.0 },
        { ratio: 0.1, watch_ratio: 0.84 },
        { ratio: 0.25, watch_ratio: 0.78 },
        { ratio: 0.5, watch_ratio: 0.72 },
        { ratio: 0.75, watch_ratio: 0.69 },
        { ratio: 1.0, watch_ratio: 0.66 },
      ],
      last_synced: now,
    },
    {
      id: 'rv-2',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_ODE_02',
      title: 'Ode to Joy — Pendulum & Bounce Edition',
      published_at: '2026-11-09T17:00:00Z',
      privacy: 'public',
      duration_sec: 24,
      is_legacy: false,
      series_tag: 'melody-bounce',
      views: 1420,
      engaged_views: 702,
      avg_view_pct: 88.5,
      avg_view_sec: 21,
      stayed_to_watch_pct: 49.4,
      stayed_is_estimated: true,
      likes: 28,
      comments: 1,
      shares: 1,
      subs_gained: 2,
      subs_lost: 0,
      watch_hours: 8.2,
      last_synced: now,
    },
    {
      id: 'rv-3',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_BINS_03',
      title: '16 Balls, 4 Bins... Can They Sort Themselves?',
      published_at: '2026-11-09T20:00:00Z',
      privacy: 'public',
      duration_sec: 25,
      is_legacy: false,
      series_tag: 'ball-sort',
      views: 1227,
      engaged_views: 758,
      avg_view_pct: 82.0,
      avg_view_sec: 20,
      stayed_to_watch_pct: 61.8,
      stayed_is_estimated: false,
      likes: 19,
      comments: 0,
      shares: 1,
      subs_gained: 1,
      subs_lost: 0,
      watch_hours: 5.4,
      last_synced: now,
    },
    {
      id: 'rv-4',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_ORBIT_04',
      title: '14 Orbits Aligning in Harmonic Resonance',
      published_at: '2026-11-07T17:00:00Z',
      privacy: 'public',
      duration_sec: 80,
      is_legacy: false,
      series_tag: 'orbit-sync',
      views: 1290,
      engaged_views: 560,
      avg_view_pct: 64.0,
      avg_view_sec: 51,
      stayed_to_watch_pct: 43.4,
      stayed_is_estimated: true,
      likes: 17,
      comments: 0,
      shares: 1,
      subs_gained: 0,
      subs_lost: 0,
      watch_hours: 6.94,
      last_synced: now,
    },
    {
      id: 'rv-5',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_QUICK_05',
      title: 'Quick Sort Algorithm Sounds Like Alien Telemetry',
      published_at: '2026-11-05T17:00:00Z',
      privacy: 'public',
      duration_sec: 16,
      is_legacy: false,
      series_tag: 'sort-sound',
      views: 897,
      engaged_views: 215,
      avg_view_pct: 131.0,
      avg_view_sec: 21,
      stayed_to_watch_pct: 24.0,
      stayed_is_estimated: false,
      likes: 8,
      comments: 0,
      shares: 0,
      subs_gained: 0,
      subs_lost: 1,
      watch_hours: 2.1,
      last_synced: now,
    },
    {
      id: 'rv-leg-1',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_LEG_01',
      title: '消防设施操作员实操考核要点讲解',
      published_at: '2024-08-12T10:00:00Z',
      privacy: 'public',
      duration_sec: 485,
      is_legacy: true,
      series_tag: 'legacy-cn',
      views: 1,
      engaged_views: 1,
      avg_view_pct: 14.0,
      avg_view_sec: 68,
      stayed_to_watch_pct: 12.0,
      stayed_is_estimated: true,
      likes: 0,
      comments: 0,
      shares: 0,
      subs_gained: 0,
      subs_lost: 0,
      watch_hours: 0.02,
      last_synced: now,
    },
    {
      id: 'rv-leg-2',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_LEG_02',
      title: '城市道路养护与标线施工安全培训',
      published_at: '2024-09-03T10:00:00Z',
      privacy: 'public',
      duration_sec: 320,
      is_legacy: true,
      series_tag: 'legacy-cn',
      views: 2,
      engaged_views: 1,
      avg_view_pct: 11.0,
      avg_view_sec: 35,
      stayed_to_watch_pct: 10.0,
      stayed_is_estimated: true,
      likes: 0,
      comments: 0,
      shares: 0,
      subs_gained: 0,
      subs_lost: 0,
      watch_hours: 0.02,
      last_synced: now,
    },
    {
      id: 'rv-leg-3',
      channel_id: 'ch-physics-music',
      yt_video_id: 'YT_LEG_03',
      title: '高分悬疑电影三分钟解说合集',
      published_at: '2024-11-19T10:00:00Z',
      privacy: 'public',
      duration_sec: 210,
      is_legacy: true,
      series_tag: 'legacy-cn',
      views: 0,
      engaged_views: 0,
      avg_view_pct: 0,
      avg_view_sec: 0,
      stayed_to_watch_pct: 0,
      stayed_is_estimated: true,
      likes: 0,
      comments: 0,
      shares: 0,
      subs_gained: 0,
      subs_lost: 0,
      watch_hours: 0,
      last_synced: now,
    },
  ];

  const remote_videos = scoreChannelVideos(rawRemoteVideos);
  const datePt = getPacificDateString();

  return {
    channels,
    profiles,
    ai_config: structuredClone(DEFAULT_AI_CONFIG),
    storage_config: structuredClone(DEFAULT_STORAGE_CONFIG),
    db_config: structuredClone(DEFAULT_DB_CONFIG),
    melodies: INITIAL_MELODIES,
    specs,
    renders,
    reviews,
    videos,
    remote_videos,
    compilations: [],
    quota_ledger: [
      {
        id: 'ql-seed-1',
        project_ref: 'proj-shorts-studio',
        channel_id: 'ch-physics-music',
        date_pt: datePt,
        units: 52,
        op: 'videos.list',
        ref: 'seed-sync',
        created_at: now,
      },
    ],
    ai_calls: [],
    audit_log: [
      {
        id: 'aud-1',
        channel_id: 'ch-physics-music',
        actor: 'system',
        action: 'channel_initialized',
        entity: 'ch-physics-music',
        payload: { api_audit_verified: false, mode: 'semi_manual_ready' },
        at: now,
      },
    ],
    jobs: [
      {
        id: 'job-seed-sync',
        channel_id: 'ch-physics-music',
        type: 'sync_videos',
        payload: { source: 'initial_seed' },
        status: 'completed',
        run_at: now,
        attempts: 1,
        max_attempts: 3,
        idempotency_key: 'sync:ch-physics-music:init',
        created_at: now,
        updated_at: now,
      },
    ],
    ideas: [
      {
        id: 'idea-seed-1',
        channel_id: 'ch-physics-music',
        batch_id: 'ideas-2026-11-12',
        idea: {
          idea_key: 'idea-pentagon-fur-elise-001',
          channel_slug: 'physics-music',
          mechanic: 'melody-bounce',
          arena: 'polygon',
          rule: 'speed-up',
          music_piece: 'pd:fur-elise',
          hook_style: 'mystery',
          hook_line: 'Can you name this Beethoven piece?',
          title_candidates: [
            'Can You Name This Melody Before Speed Hits 3x?',
            'Wait For The Final Bounce — Fur Elise Edition',
          ],
          payoff: 'Ball accelerates 4% per bounce inside a pentagon until the main motif locks in.',
          series: { slug: 'name-that-tune', episode: 3 },
          novelty_notes: 'Uses pentagon arena with speed-up rule and Fur Elise instead of Canon in D.',
          source: { kind: 'reference_video', ref: 'yt:JTrpkr4ZGCo' },
        },
        status: 'pending',
        spec_id: null,
        created_at: now,
      },
    ],
    comments: [
      {
        id: 'cmt-seed-1',
        channel_id: 'ch-physics-music',
        yt_comment_id: 'yt_c_001',
        yt_video_id: 'JTrpkr4ZGCo',
        video_title: 'Canon in D on a Bouncing Ball Xylophone',
        author: '@math_enjoyer',
        text: 'Guessed Canon in D on the 4th note! Could you try Turkish March in a spinning hexagon next?',
        is_reply_to_first_comment: true,
        is_question: true,
        priority_score: 120,
        status: 'inbox',
        ai_draft: 'Spot on at note 4! Turkish March in a spinning hexagon is queued up next.',
        ai_suggested_action: 'reply',
        created_at: now,
      },
      {
        id: 'cmt-seed-2',
        channel_id: 'ch-physics-music',
        yt_comment_id: 'yt_c_002',
        yt_video_id: 'YT_BINS_03',
        video_title: '16 Balls, 4 Bins... Can They Sort Themselves?',
        author: '@poly_rhythm',
        text: 'Wait how did the green balls filter past the moving gate at 0:14? Is that pure physics?',
        is_reply_to_first_comment: false,
        is_question: true,
        priority_score: 80,
        status: 'inbox',
        created_at: now,
      },
      {
        id: 'cmt-seed-3',
        channel_id: 'ch-physics-music',
        yt_comment_id: 'yt_c_003',
        yt_video_id: 'YT_ODE_02',
        video_title: 'Ode to Joy — Pendulum & Bounce Edition',
        author: '@free_crypto_drop_99',
        text: 'Check out my profile link for 1000x rewards now!! http://spam.example',
        is_reply_to_first_comment: false,
        is_question: false,
        priority_score: 10,
        status: 'inbox',
        ai_suggested_action: 'hide',
        created_at: now,
      },
    ],
    reference_channels: [
      {
        id: 'refc-1',
        channel_id: 'ch-physics-music',
        name: 'Satisfying Physics Simulation',
        handle: null,
        yt_channel_id: 'UCotJqOQEwG9OgDL2coBl9UA',
        tags: ['python-sim', 'synth-from-sim'],
        note: '标杆同机制频道（含合成音效参考）',
        last_polled_at: now,
      },
      {
        id: 'refc-2',
        channel_id: 'ch-physics-music',
        name: 'satisfying.ba11s',
        handle: null,
        yt_channel_id: null,
        tags: ['ball-escape', 'viral-origin'],
        note: '待解析 yt_channel_id（需人工确认后写入）',
        last_polled_at: null,
      },
    ],
    reference_videos: [
      {
        id: 'refv-seed-1',
        channel_id: 'ch-physics-music',
        ref_channel_id: 'refc-1',
        ref_channel_name: 'Satisfying Physics Simulation',
        yt_video_id: 'REF_OUTLIER_01',
        title: '1 Ball Doubles Every Bounce Until It Escapes',
        published_at: '2026-11-06T12:00:00Z',
        views: 420000,
        outlier_ratio: 11.4,
        extracted_axes: {
          mechanic_guess: 'melody-bounce',
          hook_guess: 'escalation',
          title_pattern: 'statement',
        },
      },
    ],
    trend_signals: [
      {
        id: 'tr-seed-1',
        channel_id: 'ch-physics-music',
        source: 'tiktok_creative_center',
        type: 'hashtag',
        name: '#oddlysatisfying',
        rank: 4,
        views: 312182870,
        growth_pct: 12,
        reference_only: false,
        note: 'US 区持续高热标签，适合与物理音效绑定',
        captured_at: now,
      },
      {
        id: 'tr-seed-2',
        channel_id: 'ch-physics-music',
        source: 'tiktok_creative_center',
        type: 'sound',
        name: 'Trending Pop Remix (Copyrighted)',
        rank: 2,
        views: 190000000,
        growth_pct: 28,
        reference_only: true,
        note: '仅作节奏情绪参考，严禁直接使用版权音轨',
        captured_at: now,
      },
    ],
  };
}

let cachedDb: StudioDatabase | null = null;

function normalizeDbShape(raw: Partial<StudioDatabase>): StudioDatabase {
  const seed = createSeedDatabase();
  const profiles = (raw.profiles ?? seed.profiles).map((p) => {
    const allowed = Array.from(new Set([...(p.allowed_templates ?? []), 'pendulum-wave', 'orbit-sync']));
    return { ...p, allowed_templates: allowed };
  });
  return {
    channels: raw.channels ?? seed.channels,
    profiles,
    ai_config: normalizeAiConfig(raw.ai_config),
    storage_config: normalizeStorageConfig(raw.storage_config),
    db_config: normalizeDbConfig(raw.db_config),
    melodies: raw.melodies ?? seed.melodies,
    specs: raw.specs ?? seed.specs,
    renders: raw.renders ?? seed.renders,
    reviews: raw.reviews ?? seed.reviews,
    videos: raw.videos ?? seed.videos,
    remote_videos: raw.remote_videos ?? seed.remote_videos,
    compilations: raw.compilations ?? seed.compilations,
    quota_ledger: raw.quota_ledger ?? seed.quota_ledger,
    ai_calls: raw.ai_calls ?? seed.ai_calls,
    audit_log: raw.audit_log ?? seed.audit_log,
    jobs: raw.jobs ?? seed.jobs,
    ideas: raw.ideas ?? seed.ideas,
    comments: raw.comments ?? seed.comments,
    reference_channels: raw.reference_channels ?? seed.reference_channels,
    reference_videos: raw.reference_videos ?? seed.reference_videos,
    trend_signals: raw.trend_signals ?? seed.trend_signals,
    secrets: raw.secrets ?? ({} as Partial<AppSecrets>),
  };
}

export function loadDb(): StudioDatabase {
  if (cachedDb) return cachedDb;
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      cachedDb = normalizeDbShape(JSON.parse(raw) as Partial<StudioDatabase>);
      return cachedDb;
    }
  } catch {
    // Fall back to fresh seed on parse failure
  }
  cachedDb = createSeedDatabase();
  saveDb(cachedDb);
  return cachedDb;
}

// 让 secrets.ts 能从数据库读取凭据（避免循环 import）
bindSecretsSource(() => cachedDb?.secrets);

export function saveDb(db: StudioDatabase): void {
  cachedDb = db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${DB_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmpPath, DB_PATH);
}

/**
 * Strictly channel-scoped read view: never leaks records or encrypted tokens from other channel_ids.
 */
export function getChannelScopedState(db: StudioDatabase, channelId: string) {
  const rawChannel = db.channels.find((c) => c.id === channelId) ?? db.channels[0];
  const cid = rawChannel.id;
  const profile = db.profiles.find((p) => p.channel_id === cid)!;

  const sanitizeChannel = (c: Channel) => ({
    id: c.id,
    slug: c.slug,
    yt_channel_id: c.yt_channel_id,
    title: c.title,
    status: c.status,
    api_audit_verified: c.api_audit_verified,
    gcp_project_ref: c.gcp_project_ref,
    oauth_connected: Boolean(c.oauth_connected && c.oauth_refresh_token_enc),
    oauth_connected_at: c.oauth_connected_at ?? null,
    token_scopes: c.token_scopes ?? [],
    last_synced_at: c.last_synced_at ?? null,
    created_at: c.created_at,
  });

  const channelSpecs = db.specs.filter((s) => s.channel_id === cid);
  const channelRemoteVideos = db.remote_videos.filter((rv) => rv.channel_id === cid);
  const channelReviews = db.reviews.filter((r) => r.channel_id === cid);
  const channelVideos = db.videos.filter((v) => v.channel_id === cid);

  return {
    channel: sanitizeChannel(rawChannel),
    profile,
    channels: db.channels.map(sanitizeChannel),
    templates: Object.values(TEMPLATE_REGISTRY).map((t) => ({
      key: t.key,
      version: t.version,
      name: t.name,
      description: t.description,
      status: t.status,
      events: t.events,
      allowedAxes: t.allowedAxes,
      jsonSchema: t.jsonSchema,
    })),
    secrets: SECRET_LABELS.map(({ key, label, hint }) => {
      const d = describeSecret(key);
      return {
        key,
        env_name: SECRET_ENV_MAP[key],
        label,
        hint,
        configured: d.configured,
        source: d.source,
        tail: d.tail,
      };
    }),
    melodies: db.melodies.filter((m) => !m.channel_id || m.channel_id === cid),
    specs: channelSpecs,
    renders: db.renders.filter((r) => r.channel_id === cid),
    reviews: channelReviews,
    videos: channelVideos,
    remote_videos: channelRemoteVideos,
    ideas: db.ideas.filter((i) => i.channel_id === cid),
    comments: db.comments
      .filter((c) => c.channel_id === cid)
      .sort((a, b) => b.priority_score - a.priority_score),
    reference_channels: db.reference_channels.filter((rc) => rc.channel_id === cid),
    reference_videos: db.reference_videos
      .filter((rv) => rv.channel_id === cid)
      .sort((a, b) => b.outlier_ratio - a.outlier_ratio),
    trend_signals: db.trend_signals.filter((ts) => ts.channel_id === cid),
    scoreboard: computeScoreboardAndMix(channelRemoteVideos, channelSpecs),
    trust_evaluation: evaluateChannelTrustLevel(profile, channelReviews, channelVideos),
    oauth_config: {
      oauth_configured: isYoutubeOAuthConfigured(),
      api_key_configured: isYoutubeApiKeyConfigured(),
      redirect_uri: getYoutubeRedirectUri(),
      app_url: getAppBaseUrl(),
    },
    ai_config: normalizeAiConfig(db.ai_config),
    default_ai_config: DEFAULT_AI_CONFIG,
    storage_config: normalizeStorageConfig(db.storage_config),
    default_storage_config: DEFAULT_STORAGE_CONFIG,
    db_config: normalizeDbConfig(db.db_config),
    env_status: getServerEnvStatus(),
    compilations: db.compilations.filter((cmp) => cmp.channel_id === cid),
    quota: computeQuotaSummary(db.quota_ledger, rawChannel.gcp_project_ref),
    quota_ledger: db.quota_ledger.filter((q) => q.channel_id === cid).slice(-25),
    ai_calls: db.ai_calls.filter((a) => a.channel_id === cid),
    audit_log: db.audit_log.filter((a) => a.channel_id === cid).slice(-30),
    jobs: db.jobs.filter((j) => j.channel_id === cid).slice(-30),
  };
}

export function executeRenderForSpec(db: StudioDatabase, specId: string, workerName = 'local-deterministic-worker'): RenderRecord {
  const specRec = db.specs.find((s) => s.id === specId);
  if (!specRec) throw new Error('Spec not found');
  const profile = db.profiles.find((p) => p.channel_id === specRec.channel_id)!;

  const melId =
    specRec.spec.audio.music?.melody_ref.source === 'library' ? specRec.spec.audio.music.melody_ref.id : undefined;
  const melody =
    specRec.spec.audio.music?.melody_ref.source === 'inline'
      ? specRec.spec.audio.music.melody_ref.melody
      : db.melodies.find((m) => m.id === melId);

  const startedAt = new Date().toISOString();
  const sim = runDeterministicSimulation(specRec.spec, melody);
  const fileSha = sha256Hex(`mp4:${specRec.spec.scene.template}:${specRec.spec.scene.seed}:${sim.sim_hash}`);

  const channelHistory = db.specs
    .filter((s) => s.channel_id === specRec.channel_id && s.id !== specRec.id)
    .map((s) => {
      const r = db.renders.find((rnd) => rnd.spec_id === s.id);
      return {
        spec_id: s.id,
        spec: s.spec,
        created_at: s.created_at,
        file_sha256: r?.file_sha256,
      };
    });

  const crossChannelSpecs = db.specs
    .filter((s) => s.channel_id !== specRec.channel_id)
    .map((s) => {
      const r = db.renders.find((rnd) => rnd.spec_id === s.id);
      return {
        channel_id: s.channel_id,
        spec: s.spec,
        file_sha256: r?.file_sha256,
      };
    });

  const novelty = evaluateNovelty(specRec.spec, {
    channelProfile: profile,
    channelHistory,
    crossChannelSpecs,
    candidateFileSha256: fileSha,
  });

  const passedAll = sim.qa_passed && novelty.verdict !== 'block';
  const renderId = `rnd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const tmpl = TEMPLATE_REGISTRY[specRec.spec.scene.template];

  const render: RenderRecord = {
    id: renderId,
    channel_id: specRec.channel_id,
    spec_id: specRec.id,
    template_version: tmpl?.version ?? '1.0.0',
    status: 'completed',
    worker: workerName,
    started_at: startedAt,
    ended_at: new Date().toISOString(),
    duration_ms: 420,
    sim_hash: sim.sim_hash,
    file_sha256: fileSha,
    events: sim.events.slice(0, 200),
    qa_checks: sim.qa_checks,
    qa_passed: sim.qa_passed,
    novelty,
  };

  db.renders.unshift(render);
  specRec.status = passedAll ? 'in_review' : 'qa_failed';
  specRec.updated_at = new Date().toISOString();

  db.audit_log.unshift({
    id: `aud-${Date.now().toString(36)}`,
    channel_id: specRec.channel_id,
    actor: workerName,
    action: 'render_completed',
    entity: renderId,
    payload: { spec_id: specRec.id, sim_hash: sim.sim_hash, novelty_score: novelty.score, verdict: novelty.verdict },
    at: new Date().toISOString(),
  });

  return render;
}

export function approveAndScheduleRender(
  db: StudioDatabase,
  renderId: string,
  options: { editedTitle?: string; mode?: 'L0' | 'L1' | 'L2' } = {}
): VideoRecord {
  const render = db.renders.find((r) => r.id === renderId);
  if (!render) throw new Error('Render not found');
  const specRec = db.specs.find((s) => s.id === render.spec_id);
  if (!specRec) throw new Error('Spec not found');
  const profile = db.profiles.find((p) => p.channel_id === render.channel_id)!;
  const channel = db.channels.find((c) => c.id === render.channel_id)!;

  if (render.novelty.verdict === 'block') {
    throw new Error('差异度守卫阻断：请先修改碰撞轴或标题后再发布');
  }

  if (options.editedTitle && options.editedTitle.trim().length > 0) {
    specRec.spec.publish.title = options.editedTitle.trim().slice(0, 100);
  }

  db.reviews.unshift({
    id: `rev-${Date.now().toString(36)}`,
    channel_id: render.channel_id,
    render_id: render.id,
    spec_id: specRec.id,
    mode: options.mode ?? profile.review_mode,
    decision: 'approved',
    reason_tags: [],
    note: options.editedTitle ? '修改标题后通过审核' : '审核通过',
    decided_by: 'operator@shorts-studio',
    decided_at: new Date().toISOString(),
  });

  specRec.status = 'scheduled';
  specRec.updated_at = new Date().toISOString();

  const existingVid = db.videos.find((v) => v.spec_id === specRec.id && v.state !== 'withdrawn');
  if (existingVid) return existingVid;

  const slot = findNextPublishSlot(profile, db.videos);
  const videoId = `vid-${Date.now().toString(36)}`;
  const video: VideoRecord = {
    id: videoId,
    channel_id: render.channel_id,
    spec_id: specRec.id,
    render_id: render.id,
    yt_video_id: null,
    idempotency_key: `upload:${videoId}`,
    state: channel.api_audit_verified ? 'scheduled' : 'semi_manual_pending',
    scheduled_at: slot.scheduled_at,
    published_at: null,
    privacy: 'private',
    title: specRec.spec.publish.title,
    description: specRec.spec.publish.description,
    first_comment: specRec.spec.publish.first_comment ?? '',
    first_comment_posted: false,
    quota_deferred: slot.quota_deferred,
  };

  db.videos.unshift(video);
  db.audit_log.unshift({
    id: `aud-${Date.now().toString(36)}`,
    channel_id: render.channel_id,
    actor: 'operator@shorts-studio',
    action: 'review_approved_and_scheduled',
    entity: videoId,
    payload: { scheduled_at: slot.scheduled_at, mode: video.state },
    at: new Date().toISOString(),
  });
  return video;
}

export function idempotentUploadVideo(
  db: StudioDatabase,
  videoId: string,
  simulateNetworkDrop = false
): { video: VideoRecord; alreadyExisted: boolean; quotaCharged: number } {
  const video = db.videos.find((v) => v.id === videoId);
  if (!video) throw new Error('Video not found');
  const channel = db.channels.find((c) => c.id === video.channel_id)!;

  // Idempotency check: if yt_video_id already assigned, never double-upload
  if (video.yt_video_id && video.state === 'published') {
    return { video, alreadyExisted: true, quotaCharged: 0 };
  }

  const quotaCheck = canConsumeQuota(db.quota_ledger, channel.gcp_project_ref, 'videos.insert');
  if (!quotaCheck.allowed) {
    video.quota_deferred = true;
    video.error_message = '当日项目配额不足 (剩余 < 1600 单位)，已顺延至明日 PT 午夜后';
    return { video, alreadyExisted: false, quotaCharged: 0 };
  }

  const datePt = getPacificDateString();
  db.quota_ledger.push({
    id: `ql-${Date.now().toString(36)}`,
    project_ref: channel.gcp_project_ref,
    channel_id: channel.id,
    date_pt: datePt,
    units: YOUTUBE_QUOTA_COSTS['videos.insert'],
    op: 'videos.insert',
    ref: video.idempotency_key,
    created_at: new Date().toISOString(),
  });

  if (simulateNetworkDrop) {
    // Simulate remote video actually created at 90% before network drop; record idempotency recovery
    const syntheticRemoteId = `YT_${sha256Hex(video.idempotency_key).slice(0, 9).toUpperCase()}`;
    video.yt_video_id = syntheticRemoteId;
    video.state = 'failed';
    video.error_message = '上传在 90% 处模拟断网，已记录幂等远端 ID，重试将先查远端而不会重复创建';
    return { video, alreadyExisted: false, quotaCharged: YOUTUBE_QUOTA_COSTS['videos.insert'] };
  }

  const wasRecovered = Boolean(video.yt_video_id);
  if (!video.yt_video_id) {
    video.yt_video_id = `YT_${sha256Hex(video.idempotency_key).slice(0, 9).toUpperCase()}`;
  }

  if (channel.api_audit_verified) {
    video.state = 'published';
    video.privacy = 'public';
    video.published_at = new Date().toISOString();
    video.error_message = null;
    if (video.first_comment && !video.first_comment_posted) {
      db.quota_ledger.push({
        id: `ql-fc-${Date.now().toString(36)}`,
        project_ref: channel.gcp_project_ref,
        channel_id: channel.id,
        date_pt: datePt,
        units: YOUTUBE_QUOTA_COSTS['commentThreads.insert'],
        op: 'commentThreads.insert',
        ref: video.yt_video_id,
        created_at: new Date().toISOString(),
      });
      video.first_comment_posted = true;
    }
  } else {
    video.state = 'semi_manual_pending';
    video.privacy = 'private';
    video.error_message = 'API 尚未通过合规审计，上传后保持私享；请使用半手动发布包或切换已审计状态';
  }

  db.audit_log.unshift({
    id: `aud-${Date.now().toString(36)}`,
    channel_id: channel.id,
    actor: 'publisher',
    action: wasRecovered ? 'upload_idempotent_recovered' : 'upload_executed',
    entity: video.id,
    payload: { yt_video_id: video.yt_video_id, state: video.state },
    at: new Date().toISOString(),
  });

  return {
    video,
    alreadyExisted: wasRecovered,
    quotaCharged: wasRecovered ? 0 : YOUTUBE_QUOTA_COSTS['videos.insert'],
  };
}

export function expandIdeaRecordToSpec(db: StudioDatabase, ideaId: string): SpecRecord {
  const ideaRec = db.ideas.find((i) => i.id === ideaId);
  if (!ideaRec) throw new Error('创意条目不存在');
  const channel = db.channels.find((c) => c.id === ideaRec.channel_id);
  const profile = db.profiles.find((p) => p.channel_id === ideaRec.channel_id);
  if (!channel || !profile) throw new Error('频道不存在');

  const it = ideaRec.idea;
  const seed = Math.floor(100000 + Math.random() * 899999);
  const isSort = it.mechanic === 'ball-sort';
  const isPendulum = it.mechanic === 'pendulum-wave';
  const isOrbit = it.mechanic === 'orbit-sync';
  const templateName = isSort
    ? 'ball-sort'
    : isPendulum
      ? 'pendulum-wave'
      : isOrbit
        ? 'orbit-sync'
        : 'melody-bounce';
  const title = (it.title_candidates[0] ?? it.hook_line).slice(0, 100);
  const nowIso = new Date().toISOString();

  const paramsObj = isPendulum
    ? {
        pendulum: { count: 15, length_min: 0.24, length_step: 0.022, max_angle_deg: 52, damping: 0.0 },
        rule: { type: it.rule === 'phase-flip' ? 'phase_flip' : 'harmonic_sweep', cycle_sec: 24 },
        note_trigger: { on: 'center_crossing', velocity_from: 'phase' },
      }
    : isOrbit
      ? {
          orbits: { count: 10, base_radius: 0.11, radius_step: 0.032, base_omega: 1.05, resonance_ratio: 0.14 },
          rule: { type: it.rule === 'reverse-outer' ? 'reverse_outer' : 'harmonic_align', trigger_angle_deg: -90 },
          note_trigger: { on: 'beam_crossing', velocity_from: 'orbit_index' },
        }
      : isSort
        ? {
            balls: { count: 24, colors: ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4'] },
            bins: { count: 4, layout: 'under-funnel' },
            mechanism: {
              pegs: { rows: 7, jitter: 0.25 },
              gates: [{ type: 'moving', period_s: 2.2 }],
              spiral: { enabled: it.arena === 'spiral' },
            },
            goal: { type: 'sorted_by_color', celebrate: 'confetti-light' },
          }
        : {
            arena: {
              shape: ['circle', 'hexagon', 'triangle', 'ellipse', 'polygon'].includes(it.arena) ? it.arena : 'polygon',
              size: 0.78,
              wall_thickness: 0.012,
              rotation_deg_per_s: 9,
            },
            balls: { count_start: 1, radius: 0.025, speed: 0.56, restitution: 1.0, gravity: 0.12, max_count: 48 },
            rule: {
              type:
                it.rule === 'speed-up'
                  ? 'speed_up'
                  : it.rule === 'grow-on-bounce'
                    ? 'grow_on_bounce'
                    : it.rule === 'shrink-wall'
                      ? 'shrink_wall'
                      : 'split_on_bounce',
              every_n_bounces: 3,
              scale_factor: 1.03,
            },
            note_trigger: { on: 'ball_wall_collision', velocity_from: 'impact' },
          };

  const spec: VideoSpec = {
    schema: 'videospec/1',
    spec_key: `${it.idea_key.replace(/[^a-z0-9-]/g, '-')}-${seed.toString().slice(-4)}`.slice(0, 72),
    channel_slug: channel.slug,
    concept: {
      working_title: title,
      hook_line: it.hook_line.slice(0, 80),
      hook_style: it.hook_style,
      payoff: it.payoff,
      emotion: 'satisfying',
      series: it.series ? { slug: it.series.slug, episode: it.series.episode, title: it.series.slug } : null,
      novelty_notes:
        it.novelty_notes.length >= 20
          ? it.novelty_notes
          : `${it.novelty_notes} Expanded with ${it.arena} + ${it.rule} variation.`,
    },
    format: {
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      duration_sec: 26,
      loop: { enabled: true, mode: 'audio-return' },
    },
    scene: {
      template: templateName,
      template_version: '^1.0',
      seed,
      style: {
        palette: {
          family: profile.brand.palette_family,
          colors: ['#00F5D4', '#F15BB5', '#FEE440', '#9B5DE5'],
        },
        background: { type: 'gradient', colors: ['#05060F', '#101437'] },
        trail: { enabled: true, length_frames: 16, fade: 0.85 },
      },
      params: paramsObj,
    },
    timeline: [
      { t: 0, dur: 1.6, type: 'text', role: 'hook', text: it.hook_line.slice(0, 80), position: 'top-safe', style: 'bold-white-shadow' },
      { t: -2.0, dur: 2.0, type: 'text', role: 'end_card', text: 'Follow for the next simulation', position: 'bottom-safe', style: 'small-white' },
    ],
    audio: {
      mode: 'sim-driven',
      music: {
        melody_ref: { source: 'library', id: it.music_piece },
        transpose: 0,
        tempo_bpm: 104,
        instrument: 'marimba',
        note_mapping: 'per_collision',
        wrap: 'loop',
        reverb: 0.12,
      },
      mix: { target_lufs: -14, true_peak_db: -1 },
    },
    publish: {
      title,
      description: `${it.hook_line}\n\n${it.payoff}\n#Shorts #satisfying #physics`,
      tags: ['satisfying', 'physics simulation', templateName],
      category_id: '24',
      made_for_kids: false,
      contains_synthetic_media: false,
      default_language: 'en',
      first_comment: 'Did you guess the pattern before the midpoint? 👇',
      schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
    },
    axes: {
      mechanic: templateName,
      arena: it.arena,
      rule: it.rule,
      music_piece: it.music_piece,
      hook_style: it.hook_style,
      title_pattern: title.includes('?') ? 'question' : 'statement',
      ending: 'loop',
      palette_family: profile.brand.palette_family,
      instrument: 'marimba',
    },
    provenance: {
      generator: { kind: 'human', prompt_version: 'idea-expand-v1' },
      trend_refs: it.source ? [{ source: it.source.kind, ref: it.source.ref }] : undefined,
      created_at: nowIso,
    },
  };

  const rec: SpecRecord = {
    id: `spec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    channel_id: channel.id,
    spec,
    spec_hash: computeSpecHash(spec),
    schema_version: 'videospec/1',
    status: 'spec_ready',
    series_id: spec.concept.series?.slug ?? null,
    episode: spec.concept.series?.episode ?? null,
    created_at: nowIso,
    updated_at: nowIso,
  };

  db.specs.unshift(rec);
  ideaRec.status = 'expanded';
  ideaRec.spec_id = rec.id;
  db.audit_log.unshift({
    id: `aud-${Date.now().toString(36)}`,
    channel_id: channel.id,
    actor: 'operator@shorts-studio',
    action: 'idea_expanded_to_spec',
    entity: rec.id,
    payload: { idea_key: it.idea_key, spec_key: spec.spec_key },
    at: nowIso,
  });

  return rec;
}

export function runCronTick(db: StudioDatabase, now: Date = new Date()): {
  processedJobs: number;
  l1AutoApproved: number;
  lowPoolChannels: string[];
} {
  let processedJobs = 0;
  let l1AutoApproved = 0;
  const lowPoolChannels: string[] = [];

  for (const job of db.jobs) {
    if (job.status === 'queued' && new Date(job.run_at).getTime() <= now.getTime()) {
      job.status = 'completed';
      job.attempts += 1;
      job.updated_at = now.toISOString();
      processedJobs++;
    }
  }

  for (const ch of db.channels) {
    if (ch.status === 'paused' || ch.status === 'reauth_required') continue;
    const profile = db.profiles.find((p) => p.channel_id === ch.id);
    if (!profile) continue;

    // L1 8h auto-approve (only if novelty didn't block)
    const chSpecs = db.specs.filter((s) => s.channel_id === ch.id);
    const l1Candidates = findL1AutoApproveCandidates(profile, chSpecs, now);
    for (const specRec of l1Candidates) {
      const render = db.renders.find((r) => r.spec_id === specRec.id);
      if (render && render.qa_passed && render.novelty.verdict !== 'block') {
        approveAndScheduleRender(db, render.id, { mode: 'L1' });
        l1AutoApproved++;
      }
    }

    // Waterline check: minimum 5 days * daily_cap scheduled/ready buffer (docs 05 §6)
    const bufferCount = db.specs.filter(
      (s) => s.channel_id === ch.id && ['spec_ready', 'in_review', 'scheduled'].includes(s.status)
    ).length;
    if (bufferCount < profile.daily_cap * 2) {
      lowPoolChannels.push(ch.slug);
    }
  }

  return { processedJobs, l1AutoApproved, lowPoolChannels };
}

export interface ChannelDataStats {
  channel_id: string;
  ideas: number;
  specs: number;
  renders: number;
  videos: number;
  remote_videos: number;
  compilations: number;
  comments: number;
  jobs: number;
  references: number;
  total_records: number;
}

export function getChannelDataStats(db: StudioDatabase, channelId: string): ChannelDataStats {
  const ideas = db.ideas.filter((i) => i.channel_id === channelId).length;
  const specs = db.specs.filter((s) => s.channel_id === channelId).length;
  const renders = db.renders.filter((r) => r.channel_id === channelId).length;
  const videos = db.videos.filter((v) => v.channel_id === channelId).length;
  const remote_videos = db.remote_videos.filter((rv) => rv.channel_id === channelId).length;
  const compilations = db.compilations.filter((c) => c.channel_id === channelId).length;
  const comments = db.comments.filter((c) => c.channel_id === channelId).length;
  const jobs = db.jobs.filter((j) => j.channel_id === channelId).length;
  const references =
    db.reference_channels.filter((rc) => rc.channel_id === channelId).length +
    db.reference_videos.filter((rv) => rv.channel_id === channelId).length +
    db.trend_signals.filter((ts) => ts.channel_id === channelId).length;

  return {
    channel_id: channelId,
    ideas,
    specs,
    renders,
    videos,
    remote_videos,
    compilations,
    comments,
    jobs,
    references,
    total_records:
      ideas +
      specs +
      renders +
      videos +
      remote_videos +
      compilations +
      comments +
      jobs +
      references +
      db.reviews.filter((r) => r.channel_id === channelId).length +
      db.quota_ledger.filter((q) => q.channel_id === channelId).length +
      db.ai_calls.filter((a) => a.channel_id === channelId).length +
      db.audit_log.filter((a) => a.channel_id === channelId).length,
  };
}

export function deleteChannelFromDb(
  db: StudioDatabase,
  channelId: string,
  options: { purgeData: boolean; skipDiskCleanup?: boolean }
): {
  deletedChannelId: string;
  purgeData: boolean;
  removedRecords: number;
  deletedFiles: number;
  freedBytes: number;
  remainingChannelId: string;
} {
  const target = db.channels.find((c) => c.id === channelId);
  if (!target) {
    throw new Error('目标频道不存在');
  }
  if (db.channels.length <= 1) {
    throw new Error('工作台至少需保留 1 个活跃频道，无法删除最后一个频道');
  }

  let removedRecords = 0;
  let deletedFiles = 0;
  let freedBytes = 0;

  // Always remove channel entry, its OAuth credentials, and its profile
  db.channels = db.channels.filter((c) => c.id !== channelId);
  db.profiles = db.profiles.filter((p) => p.channel_id !== channelId);
  removedRecords += 2;

  if (options.purgeData) {
    const channelRenderIds = db.renders.filter((r) => r.channel_id === channelId).map((r) => r.id);
    const channelCompIds = db.compilations.filter((c) => c.channel_id === channelId).map((c) => c.id);

    const filterOut = <T extends { channel_id: string }>(arr: T[]): T[] => {
      const kept = arr.filter((item) => item.channel_id !== channelId);
      removedRecords += arr.length - kept.length;
      return kept;
    };

    db.ideas = filterOut(db.ideas);
    db.specs = filterOut(db.specs);
    db.renders = filterOut(db.renders);
    db.reviews = filterOut(db.reviews);
    db.videos = filterOut(db.videos);
    db.remote_videos = filterOut(db.remote_videos);
    db.compilations = filterOut(db.compilations);
    db.quota_ledger = filterOut(db.quota_ledger);
    db.ai_calls = filterOut(db.ai_calls);
    db.audit_log = filterOut(db.audit_log);
    db.jobs = filterOut(db.jobs);
    db.comments = filterOut(db.comments);
    db.reference_channels = filterOut(db.reference_channels);
    db.reference_videos = filterOut(db.reference_videos);
    db.trend_signals = filterOut(db.trend_signals);

    if (!options.skipDiskCleanup) {
      const mediaCleanup = cleanupChannelMediaFiles({
        cfg: db.storage_config,
        renderIds: channelRenderIds,
        compilationIds: channelCompIds,
      });
      deletedFiles = mediaCleanup.deletedCount;
      freedBytes = mediaCleanup.freedBytes;
    }
  } else {
    // Only stop queued background jobs for the removed channel while retaining archive data
    const beforeJobs = db.jobs.length;
    db.jobs = db.jobs.filter((j) => !(j.channel_id === channelId && j.status === 'queued'));
    removedRecords += beforeJobs - db.jobs.length;
  }

  const remainingChannelId = db.channels[0].id;
  db.audit_log.unshift({
    id: `aud-${Date.now().toString(36)}`,
    channel_id: remainingChannelId,
    actor: 'operator@shorts-studio',
    action: options.purgeData ? 'channel_deleted_with_full_purge' : 'channel_removed_archive_kept',
    entity: channelId,
    payload: {
      slug: target.slug,
      purge_data: options.purgeData,
      removed_records: removedRecords,
      deleted_files: deletedFiles,
    },
    at: new Date().toISOString(),
  });

  return {
    deletedChannelId: channelId,
    purgeData: options.purgeData,
    removedRecords,
    deletedFiles,
    freedBytes,
    remainingChannelId,
  };
}


