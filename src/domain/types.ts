export type HookStyle = 'prediction' | 'escalation' | 'mystery' | 'countdown' | 'contrast';
export type Emotion = 'satisfying' | 'curious' | 'tense' | 'funny' | 'awe';
export type TitlePattern = 'question' | 'number-contrast' | 'challenge' | 'statement' | 'ellipsis';
export type EndingType = 'loop' | 'reveal' | 'cut';
export type ReviewMode = 'L0' | 'L1' | 'L2';
export type NoveltyMode = 'warn' | 'block';
export type LicenseType = 'public-domain' | 'cc0' | 'original';

export type RejectionReasonTag =
  | 'hook_weak'
  | 'too_similar'
  | 'audio_bad'
  | 'visual_bad'
  | 'title_bad'
  | 'risky'
  | 'other';

export type SpecLifecycleStatus =
  | 'idea'
  | 'spec_ready'
  | 'queued'
  | 'rendering'
  | 'rendered'
  | 'qa_failed'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'scheduled'
  | 'published'
  | 'measured';

export interface VideoSpec {
  schema: 'videospec/1';
  spec_key: string;
  channel_slug: string;
  concept: {
    working_title: string;
    hook_line: string;
    hook_style: HookStyle;
    payoff: string;
    emotion: Emotion;
    series: {
      slug: string;
      episode: number;
      title: string;
    } | null;
    novelty_notes: string;
  };
  format: {
    aspect: '9:16' | '1:1';
    width: number;
    height: number;
    fps: number;
    duration_sec: number;
    loop: {
      enabled: boolean;
      mode: 'visual-return' | 'audio-return' | 'none';
    };
  };
  scene: {
    template: string;
    template_version: string;
    seed: number;
    style: {
      palette: {
        family: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
        colors: string[];
      };
      background?: {
        type: 'solid' | 'gradient' | 'grid';
        colors: string[];
      };
      trail?: {
        enabled: boolean;
        length_frames: number;
        fade: number;
      };
      camera?: {
        zoom_from: number;
        zoom_to: number;
        shake: number;
      };
    };
    params: Record<string, unknown>;
  };
  timeline: Array<
    | {
        t: number;
        dur: number;
        type: 'text';
        role: 'hook' | 'end_card' | 'caption';
        text: string;
        position: 'top-safe' | 'center' | 'bottom-safe';
        style?: string;
      }
    | {
        t: number;
        type: 'event';
        name: string;
        args?: Record<string, unknown>;
      }
    | {
        t: number;
        type: 'sfx';
        sound: string;
        gain_db?: number;
      }
  >;
  audio: {
    mode: 'sim-driven' | 'track' | 'none';
    music?: {
      melody_ref:
        | { source: 'library'; id: string }
        | { source: 'inline'; melody: MelodyEntry };
      transpose: number;
      tempo_bpm: number;
      instrument: string;
      note_mapping: 'per_collision' | 'per_beat' | 'per_event';
      wrap: 'loop' | 'clamp';
      reverb: number;
    };
    sfx?: Array<{ event: string; sound: string; gain_db: number }>;
    mix: {
      target_lufs: number;
      true_peak_db: number;
    };
  };
  publish: {
    title: string;
    description: string;
    tags: string[];
    category_id?: string;
    made_for_kids: boolean;
    contains_synthetic_media: boolean;
    default_language: string;
    first_comment?: string;
    schedule?: {
      mode: 'auto' | 'fixed';
      at?: string;
      window_local?: [string, string];
    };
  };
  axes: {
    mechanic: string;
    arena: string;
    rule: string;
    music_piece: string;
    hook_style: HookStyle;
    title_pattern: TitlePattern;
    ending: EndingType;
    palette_family?: string;
    instrument?: string;
  };
  provenance: {
    generator: {
      kind: 'llm' | 'human' | 'bot';
      model?: string;
      prompt_version?: string;
    };
    trend_refs?: Array<{ source: string; ref: string; note?: string }>;
    created_at: string;
  };
}

export interface SpecBatch {
  schema: 'specbatch/1';
  batch_id: string;
  generated_at: string;
  items: VideoSpec[];
}

export interface IdeaItem {
  idea_key: string;
  channel_slug: string;
  mechanic: string;
  arena: string;
  rule: string;
  music_piece: string;
  hook_style: HookStyle;
  hook_line: string;
  title_candidates: string[];
  payoff: string;
  series?: { slug: string; episode: number } | null;
  novelty_notes: string;
  source?: { kind: string; ref: string };
}

export interface IdeaBatch {
  schema: 'ideabatch/1';
  batch_id: string;
  items: IdeaItem[];
}

export interface MelodyNote {
  beat: number;
  pitch: number;
  dur: number;
  vel: number;
}

export interface MelodyEntry {
  schema: 'melody/1';
  id: string;
  channel_id?: string | null;
  title: string;
  composer: string;
  death_year?: number | null;
  source_url: string;
  license: LicenseType;
  key: string;
  tempo_bpm: number;
  time_signature: string;
  recognizability: number;
  tags: string[];
  tracks: Array<{
    name: string;
    notes: MelodyNote[];
  }>;
  loopable: boolean;
  last_used_at?: string | null;
}

export interface Channel {
  id: string;
  slug: string;
  yt_channel_id: string;
  title: string;
  status: 'connected' | 'paused' | 'reauth_required' | 'audit_pending';
  api_audit_verified: boolean;
  gcp_project_ref: string;
  oauth_connected?: boolean;
  oauth_connected_at?: string | null;
  oauth_refresh_token_enc?: string | null;
  token_scopes?: string[];
  last_synced_at?: string | null;
  created_at: string;
}

export interface ChannelProfile {
  channel_id: string;
  locale: string;
  niche: string;
  brand: {
    primary_color: string;
    palette_family: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
    tone_rules: string;
    forbidden_topics: string[];
  };
  allowed_templates: string[];
  review_mode: ReviewMode;
  trust_level: number;
  novelty_mode: NoveltyMode;
  daily_cap: number;
  is_new_channel: boolean;
  tz: string;
  posting_windows: Array<[string, string]>;
  ai_budget_monthly_usd: number;
}

export interface SpecRecord {
  id: string;
  channel_id: string;
  spec: VideoSpec;
  spec_hash: string;
  schema_version: string;
  status: SpecLifecycleStatus;
  series_id: string | null;
  episode: number | null;
  created_at: string;
  updated_at: string;
}

export interface SimEvent {
  t: number;
  type: 'wall_bounce' | 'ball_split' | 'bin_drop' | 'note_trigger' | 'gate_pass';
  x: number;
  y: number;
  intensity: number;
  midi?: number;
  color?: string;
}

export interface QACheckItem {
  name: string;
  passed: boolean;
  actual: string;
  expected: string;
  severity: 'error' | 'warn';
}

export interface NoveltyRuleViolation {
  rule: string;
  severity: 'warn' | 'block';
  message: string;
  related_spec_id?: string;
  suggested_axes?: string[];
}

export interface NoveltyReport {
  score: number;
  verdict: 'pass' | 'warn' | 'block';
  violations: NoveltyRuleViolation[];
  similarity: {
    visual_phash_distance: number;
    melody_similarity: number;
    text_jaccard: number;
  };
  suggested_changes: string[];
}

export interface VisualQAResult {
  model: string;
  passed: boolean;
  occlusion_risk: 'none' | 'low' | 'high';
  hook_readable: boolean;
  summary: string;
  issues: string[];
  checked_at: string;
}

export interface RenderRecord {
  id: string;
  channel_id: string;
  spec_id: string;
  template_version: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  worker: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number;
  sim_hash: string;
  file_sha256: string;
  events: SimEvent[];
  qa_checks: QACheckItem[];
  qa_passed: boolean;
  novelty: NoveltyReport;
  visual_qa?: VisualQAResult | null;
  remote_url?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

export interface ReviewRecord {
  id: string;
  channel_id: string;
  render_id: string;
  spec_id: string;
  mode: ReviewMode;
  decision: 'approved' | 'rejected';
  reason_tags: RejectionReasonTag[];
  note: string;
  decided_by: string;
  decided_at: string;
}

export interface VideoRecord {
  id: string;
  channel_id: string;
  spec_id: string;
  render_id: string;
  yt_video_id: string | null;
  idempotency_key: string;
  state: 'scheduled' | 'uploading' | 'semi_manual_pending' | 'published' | 'failed' | 'withdrawn';
  scheduled_at: string;
  published_at: string | null;
  privacy: 'private' | 'unlisted' | 'public';
  title: string;
  description: string;
  first_comment: string;
  first_comment_posted: boolean;
  quota_deferred: boolean;
  error_message?: string | null;
}

export interface RemoteVideo {
  id: string;
  channel_id: string;
  yt_video_id: string;
  title: string;
  published_at: string;
  privacy: 'public' | 'unlisted' | 'private';
  duration_sec: number;
  is_legacy: boolean;
  series_tag: string;
  views: number;
  engaged_views: number;
  avg_view_pct: number;
  avg_view_sec: number;
  stayed_to_watch_pct: number;
  stayed_is_estimated: boolean;
  likes: number;
  comments: number;
  shares: number;
  subs_gained: number;
  subs_lost: number;
  watch_hours: number;
  reward_score?: number;
  performance_tier?: 'breakout' | 'solid' | 'flop' | 'pending';
  retention_curve?: Array<{ ratio: number; watch_ratio: number }>;
  last_synced: string;
}

export interface QuotaLedgerEntry {
  id: string;
  project_ref: string;
  channel_id: string;
  date_pt: string;
  units: number;
  op:
    | 'videos.insert'
    | 'videos.update'
    | 'commentThreads.insert'
    | 'comments.insert'
    | 'comments.setModerationStatus'
    | 'commentThreads.list'
    | 'videos.delete'
    | 'videos.list'
    | 'playlistItems.list'
    | 'playlistItems.insert'
    | 'playlists.insert'
    | 'channels.list'
    | 'search.list';
  ref: string;
  created_at: string;
}

export interface AICallEntry {
  id: string;
  channel_id: string;
  purpose: 'specgen' | 'next_episode' | 'qa_vision' | 'comment_draft';
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  created_at: string;
}

export interface AuditLogEntry {
  id: string;
  channel_id: string;
  actor: string;
  action: string;
  entity: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface JobItem {
  id: string;
  channel_id: string;
  type: 'render' | 'upload' | 'sync_videos' | 'snapshot_metrics' | 'sync_comments' | 'cleanup' | 'replenish' | 'l1_auto_approve';
  payload: Record<string, unknown>;
  status: 'queued' | 'running' | 'completed' | 'failed';
  run_at: string;
  attempts: number;
  max_attempts: number;
  idempotency_key: string;
  error_code?: string | null;
  created_at: string;
  updated_at: string;
}

export interface IdeaRecord {
  id: string;
  channel_id: string;
  batch_id: string;
  idea: IdeaItem;
  status: 'pending' | 'expanded' | 'dismissed';
  spec_id?: string | null;
  created_at: string;
}

export interface CommentRecord {
  id: string;
  channel_id: string;
  yt_comment_id: string;
  yt_video_id: string;
  video_title: string;
  author: string;
  text: string;
  is_reply_to_first_comment: boolean;
  is_question: boolean;
  priority_score: number;
  status: 'inbox' | 'replied' | 'hidden' | 'ignored';
  ai_draft?: string | null;
  ai_suggested_action?: 'reply' | 'hide' | 'ignore' | null;
  reply_text?: string | null;
  replied_at?: string | null;
  created_at: string;
}

export interface ReferenceChannelRecord {
  id: string;
  channel_id: string;
  name: string;
  handle: string | null;
  yt_channel_id: string | null;
  tags: string[];
  note: string;
  last_polled_at: string | null;
}

export interface ReferenceVideoRecord {
  id: string;
  channel_id: string;
  ref_channel_id: string;
  ref_channel_name: string;
  yt_video_id: string;
  title: string;
  published_at: string;
  views: number;
  outlier_ratio: number;
  extracted_axes: {
    mechanic_guess: string;
    hook_guess: string;
    title_pattern: string;
  };
}

export interface TrendSignalRecord {
  id: string;
  channel_id: string;
  source: string;
  type: 'hashtag' | 'sound' | 'video' | 'topic' | 'search';
  name: string;
  rank: number;
  views: number;
  growth_pct: number;
  reference_only: boolean;
  note: string;
  captured_at: string;
}

export interface CompilationChapter {
  timecode: string;
  title: string;
  spec_id: string;
  render_id: string;
  duration_sec: number;
}

export interface CompilationRecord {
  id: string;
  channel_id: string;
  title: string;
  render_ids: string[];
  duration_sec: number;
  chapters: CompilationChapter[];
  description_text: string;
  remote_url?: string | null;
  created_at: string;
}

export interface ValidationIssue {
  index: number;
  spec_key?: string;
  path: string;
  code: string;
  level: 'error' | 'warn';
  message: string;
}

export type AiProviderType = 'gemini' | 'openai-compatible' | 'anthropic';
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'max';

export interface AiProviderConfig {
  provider: AiProviderType;
  base_url: string;
  model: string;
  thinking_level: ThinkingLevel;
  prompts: {
    specgen_system: string;
    next_episode: string;
    comment_reply: string;
  };
}

export type StorageDriver = 'local' | 's3' | 'webdav';
export type DbDriver = 'json-file' | 'postgresql-url';

export interface StorageConfig {
  driver: StorageDriver;
  local_dir: string;
  s3_endpoint: string;
  s3_region: string;
  s3_bucket: string;
  s3_prefix: string;
  s3_public_url: string;
  webdav_url: string;
  webdav_prefix: string;
  webdav_public_url: string;
  auto_cleanup_cache_hours: number;
  auto_cleanup_published_days: number;
  keep_local_cache_after_upload: boolean;
}

export interface DbAdapterConfig {
  driver: DbDriver;
  json_path: string;
  table_prefix: string;
}

export interface StorageArtifactFile {
  name: string;
  category: 'cache' | 'renders' | 'compilations';
  rel_path: string;
  size_bytes: number;
  modified_at: string;
}

export interface StorageStatusSummary {
  driver: StorageDriver;
  root_dir: string;
  db_path: string;
  db_size_bytes: number;
  total_bytes: number;
  cache_count: number;
  cache_bytes: number;
  renders_count: number;
  renders_bytes: number;
  compilations_count: number;
  compilations_bytes: number;
  files: StorageArtifactFile[];
}

export interface ServerEnvStatus {
  gemini_key: boolean;
  custom_ai_key: boolean;
  anthropic_key: boolean;
  youtube_api_key: boolean;
  google_client_id: boolean;
  google_client_secret: boolean;
  s3_credentials: boolean;
  webdav_credentials: boolean;
  database_url: boolean;
}

