import type { TrustEvaluationResult, WeeklyScoreboardSummary } from '../domain/bandit';
import type { QuotaSummary } from '../domain/quota';
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
} from '../domain/types';

export interface TemplateSummary {
  key: string;
  version: string;
  name: string;
  description: string;
  status: 'active' | 'beta';
  events: string[];
  allowedAxes: {
    arena: string[];
    rule: string[];
    ending: Array<'loop' | 'reveal' | 'cut'>;
  };
  jsonSchema: Record<string, unknown>;
}

export interface SafeChannelView
  extends Pick<
    Channel,
    'id' | 'slug' | 'yt_channel_id' | 'title' | 'status' | 'api_audit_verified' | 'gcp_project_ref' | 'created_at'
  > {
  oauth_connected: boolean;
  oauth_connected_at: string | null;
  token_scopes: string[];
  last_synced_at: string | null;
}

export interface SecretItem {
  key: string;
  env_name: string;
  label: string;
  hint: string;
  configured: boolean;
  source: 'db' | 'env' | null;
  tail: string | null;
}

export interface StudioState {
  channel: SafeChannelView;
  profile: ChannelProfile;
  channels: SafeChannelView[];
  templates: TemplateSummary[];
  /** 凭据脱敏摘要（绝不包含明文） */
  secrets?: SecretItem[];
  melodies: MelodyEntry[];
  specs: SpecRecord[];
  renders: RenderRecord[];
  reviews: ReviewRecord[];
  videos: VideoRecord[];
  remote_videos: RemoteVideo[];
  ideas: IdeaRecord[];
  comments: CommentRecord[];
  reference_channels: ReferenceChannelRecord[];
  reference_videos: ReferenceVideoRecord[];
  trend_signals: TrendSignalRecord[];
  scoreboard: WeeklyScoreboardSummary;
  trust_evaluation: TrustEvaluationResult;
  oauth_config: {
    oauth_configured: boolean;
    api_key_configured: boolean;
    redirect_uri: string;
    app_url: string;
  };
  ai_config: AiProviderConfig;
  default_ai_config: AiProviderConfig;
  storage_config: StorageConfig;
  default_storage_config: StorageConfig;
  db_config: DbAdapterConfig;
  env_status: ServerEnvStatus;
  compilations: CompilationRecord[];
  quota: QuotaSummary;
  quota_ledger: QuotaLedgerEntry[];
  ai_calls: AICallEntry[];
  audit_log: AuditLogEntry[];
  jobs: JobItem[];
}

