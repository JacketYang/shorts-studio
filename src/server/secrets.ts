/**
 * 服务端密钥解析：优先读数据库（后台表单保存），环境变量兜底。
 *
 * 这样运维不必再 SSH 上去改 .env —— 所有凭据都能在「频道与设置」页面直接填写保存。
 * 唯一留在 .env 的是「不可能存进数据库的东西」：
 *   - TOKEN_ENC_KEY   加密密钥本身，与密文同库等于没加密
 *   - STORAGE_DB_PATH 数据库位置，启动前就要知道
 *   - PORT / NODE_ENV 进程参数
 */

export interface AppSecrets {
  gemini_api_key: string;
  custom_ai_api_key: string;
  anthropic_api_key: string;
  youtube_api_key: string;
  google_client_id: string;
  google_client_secret: string;
  storage_access_key_id: string;
  storage_secret_access_key: string;
  webdav_username: string;
  webdav_password: string;
}

export type SecretKey = keyof AppSecrets;

/** 数据库字段 → 环境变量名 */
export const SECRET_ENV_MAP: Record<SecretKey, string> = {
  gemini_api_key: 'GEMINI_API_KEY',
  custom_ai_api_key: 'CUSTOM_AI_API_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  youtube_api_key: 'YOUTUBE_API_KEY',
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
  storage_access_key_id: 'STORAGE_ACCESS_KEY_ID',
  storage_secret_access_key: 'STORAGE_SECRET_ACCESS_KEY',
  webdav_username: 'WEBDAV_USERNAME',
  webdav_password: 'WEBDAV_PASSWORD',
};

/** 页面展示用的中文标签，Order 决定表单顺序 */
export const SECRET_LABELS: Array<{ key: SecretKey; label: string; hint: string }> = [
  { key: 'gemini_api_key', label: 'Gemini API Key', hint: 'Gemini 原生协议' },
  { key: 'custom_ai_api_key', label: 'OpenAI 兼容 Key', hint: 'DeepSeek / OpenRouter / OneAPI' },
  { key: 'anthropic_api_key', label: 'Anthropic Key', hint: 'Claude /v1/messages 协议' },
  { key: 'youtube_api_key', label: 'YouTube Data API Key', hint: '公开数据与参考频道查询' },
  { key: 'google_client_id', label: 'Google OAuth Client ID', hint: '全频道共用 1 套 GCP 应用' },
  { key: 'google_client_secret', label: 'Google OAuth Client Secret', hint: '同上' },
  { key: 'storage_access_key_id', label: 'S3/R2 Access Key ID', hint: '仅切到 s3 驱动时需要' },
  { key: 'storage_secret_access_key', label: 'S3/R2 Secret Access Key', hint: '仅切到 s3 驱动时需要' },
  { key: 'webdav_username', label: 'WebDAV 用户名', hint: '仅切到 webdav 驱动时需要' },
  { key: 'webdav_password', label: 'WebDAV 密码', hint: '仅切到 webdav 驱动时需要' },
];

/** 占位符前缀：出现这些值视为未配置（与 .env.example 对齐） */
const PLACEHOLDER_PREFIXES = ['MY_', 'REPLACE_WITH', 'postgres://user:pass'];

function isUsable(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const t = raw.trim();
  if (!t) return false;
  return !PLACEHOLDER_PREFIXES.some((p) => t.startsWith(p));
}

/** 由 store.ts 在模块加载后注入，避免循环依赖 */
let dbSecretsGetter: (() => Partial<AppSecrets> | undefined) | null = null;

export function bindSecretsSource(getter: () => Partial<AppSecrets> | undefined): void {
  dbSecretsGetter = getter;
}

/**
 * 解析一个密钥。优先级：数据库（后台填写） > 环境变量 > null
 */
export function resolveSecret(key: SecretKey): string | null {
  try {
    const fromDb = dbSecretsGetter?.()?.[key];
    if (isUsable(fromDb)) return String(fromDb).trim();
  } catch {
    // 数据库尚未就绪（启动早期），退到环境变量
  }
  const envName = SECRET_ENV_MAP[key];
  const fromEnv = process.env[envName];
  if (isUsable(fromEnv)) return String(fromEnv).trim();
  return null;
}

/** 是否已配置（给前端徽章用，永不返回值本身） */
export function isSecretConfigured(key: SecretKey): boolean {
  return resolveSecret(key) !== null;
}

/**
 * 给前端看的脱敏摘要：只暴露「已配置」与末 4 位，绝不回显完整明文。
 */
export function describeSecret(key: SecretKey): { configured: boolean; source: 'db' | 'env' | null; tail: string | null } {
  let fromDb: string | null = null;
  try {
    const v = dbSecretsGetter?.()?.[key];
    if (isUsable(v)) fromDb = String(v).trim();
  } catch {
    /* ignore */
  }
  const envVal = isUsable(process.env[SECRET_ENV_MAP[key]]) ? String(process.env[SECRET_ENV_MAP[key]]).trim() : null;
  const value = fromDb ?? envVal;
  if (!value) return { configured: false, source: null, tail: null };
  return {
    configured: true,
    source: fromDb ? 'db' : 'env',
    tail: value.length >= 4 ? value.slice(-4) : '****',
  };
}

/** 归一化一组待保存的密钥：空串表示「不修改」，避免误清空 */
export function applySecretPatch(current: Partial<AppSecrets> | undefined, patch: unknown): Partial<AppSecrets> {
  const cur = current ?? {};
  const base: Partial<AppSecrets> = {
    gemini_api_key: cur.gemini_api_key ?? '',
    custom_ai_api_key: cur.custom_ai_api_key ?? '',
    anthropic_api_key: cur.anthropic_api_key ?? '',
    youtube_api_key: cur.youtube_api_key ?? '',
    google_client_id: cur.google_client_id ?? '',
    google_client_secret: cur.google_client_secret ?? '',
    storage_access_key_id: cur.storage_access_key_id ?? '',
    storage_secret_access_key: cur.storage_secret_access_key ?? '',
    webdav_username: cur.webdav_username ?? '',
    webdav_password: cur.webdav_password ?? '',
  };
  if (!patch || typeof patch !== 'object') return base;
  const src = patch as Record<string, unknown>;
  for (const key of Object.keys(base) as SecretKey[]) {
    if (!(key in src)) continue;
    const v = src[key];
    if (typeof v !== 'string') continue;
    // 空串 / 全空格 = 保持原样（前端「留空即不修改」）
    if (v.trim() === '') continue;
    base[key] = v.trim();
  }
  return base;
}
