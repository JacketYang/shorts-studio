import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  DbAdapterConfig,
  StorageArtifactFile,
  StorageConfig,
  StorageStatusSummary,
} from '../domain/types.ts';

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  driver: 'local',
  local_dir: './data/media',
  s3_endpoint: '',
  s3_region: 'auto',
  s3_bucket: '',
  s3_prefix: 'shorts-studio',
  s3_public_url: '',
  webdav_url: '',
  webdav_prefix: 'shorts-studio',
  webdav_public_url: '',
  auto_cleanup_cache_hours: 24,
  auto_cleanup_published_days: 14,
  keep_local_cache_after_upload: false,
};

export const DEFAULT_DB_CONFIG: DbAdapterConfig = {
  driver: 'json-file',
  json_path: './data/studio-db.json',
  table_prefix: 'ss_',
};

export function normalizeStorageConfig(raw?: Partial<StorageConfig> | null): StorageConfig {
  const driver =
    raw?.driver === 's3' || raw?.driver === 'webdav' ? raw.driver : 'local';
  return {
    driver,
    local_dir:
      typeof raw?.local_dir === 'string' && raw.local_dir.trim()
        ? raw.local_dir.trim()
        : DEFAULT_STORAGE_CONFIG.local_dir,
    s3_endpoint: typeof raw?.s3_endpoint === 'string' ? raw.s3_endpoint.trim().replace(/\/+$/, '') : '',
    s3_region:
      typeof raw?.s3_region === 'string' && raw.s3_region.trim()
        ? raw.s3_region.trim()
        : 'auto',
    s3_bucket: typeof raw?.s3_bucket === 'string' ? raw.s3_bucket.trim() : '',
    s3_prefix:
      typeof raw?.s3_prefix === 'string'
        ? raw.s3_prefix.trim().replace(/^\/+|\/+$/g, '')
        : 'shorts-studio',
    s3_public_url: typeof raw?.s3_public_url === 'string' ? raw.s3_public_url.trim().replace(/\/+$/, '') : '',
    webdav_url: typeof raw?.webdav_url === 'string' ? raw.webdav_url.trim().replace(/\/+$/, '') : '',
    webdav_prefix:
      typeof raw?.webdav_prefix === 'string'
        ? raw.webdav_prefix.trim().replace(/^\/+|\/+$/g, '')
        : 'shorts-studio',
    webdav_public_url:
      typeof raw?.webdav_public_url === 'string' ? raw.webdav_public_url.trim().replace(/\/+$/, '') : '',
    auto_cleanup_cache_hours: Math.max(
      1,
      Math.min(
        720,
        Number.isFinite(Number(raw?.auto_cleanup_cache_hours))
          ? Number(raw?.auto_cleanup_cache_hours)
          : DEFAULT_STORAGE_CONFIG.auto_cleanup_cache_hours
      )
    ),
    auto_cleanup_published_days: Math.max(
      1,
      Math.min(
        365,
        Number.isFinite(Number(raw?.auto_cleanup_published_days))
          ? Number(raw?.auto_cleanup_published_days)
          : DEFAULT_STORAGE_CONFIG.auto_cleanup_published_days
      )
    ),
    keep_local_cache_after_upload: Boolean(raw?.keep_local_cache_after_upload),
  };
}

export function normalizeDbConfig(raw?: Partial<DbAdapterConfig> | null): DbAdapterConfig {
  const envPath = process.env.STORAGE_DB_PATH?.trim();
  const defaultPath = envPath || DEFAULT_DB_CONFIG.json_path;
  return {
    driver: raw?.driver === 'postgresql-url' ? 'postgresql-url' : 'json-file',
    json_path:
      typeof raw?.json_path === 'string' && raw.json_path.trim()
        ? raw.json_path.trim()
        : defaultPath,
    table_prefix:
      typeof raw?.table_prefix === 'string' && raw.table_prefix.trim()
        ? raw.table_prefix.trim().replace(/[^a-zA-Z0-9_]/g, '')
        : 'ss_',
  };
}

export function resolveMediaDirectories(cfg: StorageConfig): {
  rootDir: string;
  cacheDir: string;
  rendersDir: string;
  compilationsDir: string;
} {
  const norm = normalizeStorageConfig(cfg);
  const rootDir = path.isAbsolute(norm.local_dir)
    ? norm.local_dir
    : path.resolve(process.cwd(), norm.local_dir);
  const cacheDir = path.join(rootDir, 'cache');
  const rendersDir = path.join(rootDir, 'renders');
  const compilationsDir = path.join(rootDir, 'compilations');
  for (const d of [rootDir, cacheDir, rendersDir, compilationsDir]) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
  return { rootDir, cacheDir, rendersDir, compilationsDir };
}

function getS3Credentials(): { accessKeyId: string; secretAccessKey: string } | null {
  const ak = process.env.STORAGE_ACCESS_KEY_ID?.trim();
  const sk = process.env.STORAGE_SECRET_ACCESS_KEY?.trim();
  if (!ak || !sk || ak.startsWith('MY_') || sk.startsWith('MY_')) return null;
  return { accessKeyId: ak, secretAccessKey: sk };
}

function getWebDavCredentials(): { username: string; password: string } | null {
  const username = process.env.WEBDAV_USERNAME?.trim();
  const password = process.env.WEBDAV_PASSWORD?.trim();
  if (!username || !password || username.startsWith('MY_')) return null;
  return { username, password };
}

function sha256HexBuf(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

export async function s3SignedRequest(params: {
  method: 'PUT' | 'HEAD' | 'DELETE' | 'GET';
  endpoint: string;
  region: string;
  bucket: string;
  objectKey: string;
  body?: Buffer;
  contentType?: string;
}): Promise<Response> {
  const creds = getS3Credentials();
  if (!creds) {
    throw new Error('未检测到服务端 STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY 环境变量');
  }
  if (!params.endpoint || !params.bucket) {
    throw new Error('请填写 S3 / Cloudflare R2 Endpoint 与 Bucket 名称');
  }

  const base = new URL(params.endpoint);
  const cleanKey = params.objectKey.replace(/^\/+/, '');
  const encodedKey = cleanKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const pathnamePrefix = base.pathname === '/' ? '' : base.pathname.replace(/\/+$/, '');
  const canonicalUri = cleanKey
    ? `${pathnamePrefix}/${encodeURIComponent(params.bucket)}/${encodedKey}`
    : `${pathnamePrefix}/${encodeURIComponent(params.bucket)}`;
  const targetUrl = `${base.origin}${canonicalUri}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = params.region || 'auto';
  const payload = params.body ?? Buffer.alloc(0);
  const payloadHash = sha256HexBuf(payload);

  const headers: Record<string, string> = {
    host: base.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (params.contentType) {
    headers['content-type'] = params.contentType;
  }

  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k]}\n`).join('');
  const signedHeaders = sortedKeys.join(';');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256HexBuf(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${creds.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(targetUrl, {
    method: params.method,
    headers: {
      ...headers,
      Authorization: authorization,
    },
    body: params.method === 'PUT' ? new Uint8Array(payload) : undefined,
  });
}

async function webdavRequest(params: {
  method: 'PUT' | 'MKCOL' | 'DELETE' | 'PROPFIND' | 'OPTIONS';
  url: string;
  body?: Buffer;
  contentType?: string;
}): Promise<Response> {
  const creds = getWebDavCredentials();
  if (!creds) {
    throw new Error('未检测到服务端 WEBDAV_USERNAME / WEBDAV_PASSWORD 环境变量');
  }
  const auth = Buffer.from(`${creds.username}:${creds.password}`, 'utf8').toString('base64');
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
  };
  if (params.contentType) {
    headers['Content-Type'] = params.contentType;
  }
  if (params.method === 'PROPFIND') {
    headers.Depth = '0';
  }
  return fetch(params.url, {
    method: params.method,
    headers,
    body: params.body ? new Uint8Array(params.body) : undefined,
  });
}

export async function uploadArtifactToStorage(params: {
  cfg: StorageConfig;
  localFilePath: string;
  category: 'renders' | 'compilations';
  fileName: string;
}): Promise<{ remoteUrl: string | null; deletedLocal: boolean }> {
  const cfg = normalizeStorageConfig(params.cfg);
  if (cfg.driver === 'local') {
    return { remoteUrl: null, deletedLocal: false };
  }

  const fileBuf = fs.readFileSync(params.localFilePath);

  if (cfg.driver === 's3') {
    const prefix = cfg.s3_prefix ? `${cfg.s3_prefix}/` : '';
    const objectKey = `${prefix}${params.category}/${params.fileName}`;
    const res = await s3SignedRequest({
      method: 'PUT',
      endpoint: cfg.s3_endpoint,
      region: cfg.s3_region,
      bucket: cfg.s3_bucket,
      objectKey,
      body: fileBuf,
      contentType: 'video/mp4',
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3/R2 上传失败 (HTTP ${res.status}): ${errText.slice(0, 160)}`);
    }
    const remoteUrl = cfg.s3_public_url
      ? `${cfg.s3_public_url}/${objectKey}`
      : `${cfg.s3_endpoint}/${cfg.s3_bucket}/${objectKey}`;
    let deletedLocal = false;
    if (!cfg.keep_local_cache_after_upload && fs.existsSync(params.localFilePath)) {
      fs.unlinkSync(params.localFilePath);
      deletedLocal = true;
    }
    return { remoteUrl, deletedLocal };
  }

  // WebDAV upload
  if (!cfg.webdav_url) {
    throw new Error('请填写 WebDAV 服务地址');
  }
  const baseUrl = cfg.webdav_url.replace(/\/+$/, '');
  const prefix = cfg.webdav_prefix ? `/${cfg.webdav_prefix}` : '';
  const dirUrl = `${baseUrl}${prefix}/${params.category}`;
  // Best-effort MKCOL for parent folders
  if (prefix) {
    await webdavRequest({ method: 'MKCOL', url: `${baseUrl}${prefix}` }).catch(() => undefined);
  }
  await webdavRequest({ method: 'MKCOL', url: dirUrl }).catch(() => undefined);

  const fileUrl = `${dirUrl}/${encodeURIComponent(params.fileName)}`;
  const res = await webdavRequest({
    method: 'PUT',
    url: fileUrl,
    body: fileBuf,
    contentType: 'video/mp4',
  });
  if (!res.ok && res.status !== 201 && res.status !== 204) {
    throw new Error(`WebDAV 上传失败 (HTTP ${res.status})`);
  }
  const remoteUrl = cfg.webdav_public_url
    ? `${cfg.webdav_public_url}${prefix}/${params.category}/${encodeURIComponent(params.fileName)}`
    : fileUrl;
  let deletedLocal = false;
  if (!cfg.keep_local_cache_after_upload && fs.existsSync(params.localFilePath)) {
    fs.unlinkSync(params.localFilePath);
    deletedLocal = true;
  }
  return { remoteUrl, deletedLocal };
}

export async function testStorageConnection(cfgInput: StorageConfig): Promise<{
  ok: boolean;
  driver: StorageConfig['driver'];
  latency_ms: number;
  message: string;
}> {
  const cfg = normalizeStorageConfig(cfgInput);
  const started = Date.now();

  if (cfg.driver === 'local') {
    const dirs = resolveMediaDirectories(cfg);
    const probe = path.join(dirs.cacheDir, `.probe-${Date.now()}.tmp`);
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return {
      ok: true,
      driver: 'local',
      latency_ms: Date.now() - started,
      message: `本地存储目录读写正常：${dirs.rootDir}`,
    };
  }

  if (cfg.driver === 's3') {
    const probeKey = `${cfg.s3_prefix ? `${cfg.s3_prefix}/` : ''}.shorts-studio-probe-${Date.now()}.txt`;
    const putRes = await s3SignedRequest({
      method: 'PUT',
      endpoint: cfg.s3_endpoint,
      region: cfg.s3_region,
      bucket: cfg.s3_bucket,
      objectKey: probeKey,
      body: Buffer.from('shorts-studio-probe', 'utf8'),
      contentType: 'text/plain',
    });
    if (!putRes.ok) {
      const msg = await putRes.text().catch(() => '');
      throw new Error(`S3/R2 写入测试失败 (HTTP ${putRes.status}): ${msg.slice(0, 160)}`);
    }
    await s3SignedRequest({
      method: 'DELETE',
      endpoint: cfg.s3_endpoint,
      region: cfg.s3_region,
      bucket: cfg.s3_bucket,
      objectKey: probeKey,
    }).catch(() => undefined);

    return {
      ok: true,
      driver: 's3',
      latency_ms: Date.now() - started,
      message: `S3 / Cloudflare R2 (${cfg.s3_bucket}) 读写测试通过 (${Date.now() - started}ms)`,
    };
  }

  if (!cfg.webdav_url) {
    throw new Error('请填写 WebDAV 地址 (例如 https://dav.example.com/shorts)');
  }
  const res = await webdavRequest({ method: 'PROPFIND', url: cfg.webdav_url });
  if (!res.ok && res.status !== 207) {
    const fallback = await webdavRequest({ method: 'OPTIONS', url: cfg.webdav_url });
    if (!fallback.ok) {
      throw new Error(`WebDAV 连接失败 (HTTP ${res.status})`);
    }
  }
  return {
    ok: true,
    driver: 'webdav',
    latency_ms: Date.now() - started,
    message: `WebDAV 连接验证通过 (${Date.now() - started}ms)`,
  };
}

export function scanStorageArtifacts(cfg: StorageConfig, dbPath: string): StorageStatusSummary {
  const dirs = resolveMediaDirectories(cfg);
  const categories: Array<{ key: 'cache' | 'renders' | 'compilations'; dir: string }> = [
    { key: 'cache', dir: dirs.cacheDir },
    { key: 'renders', dir: dirs.rendersDir },
    { key: 'compilations', dir: dirs.compilationsDir },
  ];

  // Also include legacy tmp-renders / tmp-compilations if present so user sees & can clean all artifacts
  const legacyTmpRenders = path.resolve(process.cwd(), 'data', 'tmp-renders');
  const legacyTmpComp = path.resolve(process.cwd(), 'data', 'tmp-compilations');

  const files: StorageArtifactFile[] = [];
  let cacheCount = 0;
  let cacheBytes = 0;
  let rendersCount = 0;
  let rendersBytes = 0;
  let compilationsCount = 0;
  let compilationsBytes = 0;

  const collectDir = (dirPath: string, category: 'cache' | 'renders' | 'compilations') => {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const effectiveCat: 'cache' | 'renders' | 'compilations' =
        entry.endsWith('.json') || entry.endsWith('.txt') || entry.endsWith('.tmp') ? 'cache' : category;
      if (effectiveCat === 'cache') {
        cacheCount++;
        cacheBytes += stat.size;
      } else if (effectiveCat === 'renders') {
        rendersCount++;
        rendersBytes += stat.size;
      } else {
        compilationsCount++;
        compilationsBytes += stat.size;
      }
      files.push({
        name: entry,
        category: effectiveCat,
        rel_path: path.relative(process.cwd(), full),
        size_bytes: stat.size,
        modified_at: stat.mtime.toISOString(),
      });
    }
  };

  for (const cat of categories) {
    collectDir(cat.dir, cat.key);
  }
  if (legacyTmpRenders !== dirs.rendersDir) collectDir(legacyTmpRenders, 'renders');
  if (legacyTmpComp !== dirs.compilationsDir) collectDir(legacyTmpComp, 'compilations');

  files.sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime());

  const resolvedDbPath = path.isAbsolute(dbPath) ? dbPath : path.resolve(process.cwd(), dbPath);
  const dbSize = fs.existsSync(resolvedDbPath) ? fs.statSync(resolvedDbPath).size : 0;

  return {
    driver: normalizeStorageConfig(cfg).driver,
    root_dir: dirs.rootDir,
    db_path: resolvedDbPath,
    db_size_bytes: dbSize,
    total_bytes: cacheBytes + rendersBytes + compilationsBytes,
    cache_count: cacheCount,
    cache_bytes: cacheBytes,
    renders_count: rendersCount,
    renders_bytes: rendersBytes,
    compilations_count: compilationsCount,
    compilations_bytes: compilationsBytes,
    files: files.slice(0, 100),
  };
}

export function cleanupStorageArtifacts(params: {
  cfg: StorageConfig;
  scope: 'cache' | 'expired_cache' | 'published_renders' | 'all_media' | 'single_file';
  relPath?: string;
  publishedRenderIds?: Set<string>;
}): { deletedCount: number; freedBytes: number } {
  const dirs = resolveMediaDirectories(params.cfg);
  const allowedRoots = [
    dirs.rootDir,
    path.resolve(process.cwd(), 'data', 'tmp-renders'),
    path.resolve(process.cwd(), 'data', 'tmp-compilations'),
  ];

  let deletedCount = 0;
  let freedBytes = 0;

  const tryDelete = (filePath: string) => {
    const resolved = path.resolve(filePath);
    const isAllowed = allowedRoots.some((root) => resolved.startsWith(root + path.sep));
    if (!isAllowed || !fs.existsSync(resolved)) return;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return;
    fs.unlinkSync(resolved);
    deletedCount++;
    freedBytes += stat.size;
  };

  if (params.scope === 'single_file' && params.relPath) {
    tryDelete(path.resolve(process.cwd(), params.relPath));
    return { deletedCount, freedBytes };
  }

  const scanAndDelete = (dirPath: string, predicate: (fileName: string, stat: fs.Stats) => boolean) => {
    if (!fs.existsSync(dirPath)) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const full = path.join(dirPath, entry);
      const stat = fs.statSync(full);
      if (stat.isFile() && predicate(entry, stat)) {
        tryDelete(full);
      }
    }
  };

  const maxAgeMs = Math.max(1, params.cfg.auto_cleanup_cache_hours || 24) * 3600_000;
  const nowMs = Date.now();

  if (params.scope === 'cache' || params.scope === 'expired_cache' || params.scope === 'all_media') {
    const ageCheck = (stat: fs.Stats) =>
      params.scope !== 'expired_cache' || nowMs - stat.mtimeMs >= maxAgeMs;
    scanAndDelete(dirs.cacheDir, (_name, stat) => ageCheck(stat));
    scanAndDelete(path.resolve(process.cwd(), 'data', 'tmp-renders'), (name, stat) =>
      (name.endsWith('.json') || name.endsWith('.txt')) && ageCheck(stat)
    );
    scanAndDelete(path.resolve(process.cwd(), 'data', 'tmp-compilations'), (name, stat) =>
      (name.endsWith('.txt') || name.endsWith('.json')) && ageCheck(stat)
    );
  }

  if (params.scope === 'published_renders') {
    const publishedSet = params.publishedRenderIds ?? new Set<string>();
    const isPublishedFile = (name: string) => {
      if (!name.endsWith('.mp4')) return false;
      const base = name.replace(/\.mp4$/, '');
      return publishedSet.has(base);
    };
    scanAndDelete(dirs.rendersDir, (name) => isPublishedFile(name));
    scanAndDelete(path.resolve(process.cwd(), 'data', 'tmp-renders'), (name) => isPublishedFile(name));
  }

  if (params.scope === 'all_media') {
    scanAndDelete(dirs.rendersDir, () => true);
    scanAndDelete(dirs.compilationsDir, () => true);
    scanAndDelete(path.resolve(process.cwd(), 'data', 'tmp-renders'), () => true);
    scanAndDelete(path.resolve(process.cwd(), 'data', 'tmp-compilations'), () => true);
  }

  return { deletedCount, freedBytes };
}

export function cleanupChannelMediaFiles(params: {
  cfg: StorageConfig;
  renderIds: string[];
  compilationIds: string[];
}): { deletedCount: number; freedBytes: number } {
  const dirs = resolveMediaDirectories(params.cfg);
  const renderSet = new Set(params.renderIds);
  const compSet = new Set(params.compilationIds);
  const allowedRoots = [
    dirs.rootDir,
    path.resolve(process.cwd(), 'data', 'tmp-renders'),
    path.resolve(process.cwd(), 'data', 'tmp-compilations'),
  ];

  let deletedCount = 0;
  let freedBytes = 0;

  const tryDelete = (filePath: string) => {
    const resolved = path.resolve(filePath);
    const isAllowed = allowedRoots.some((root) => resolved.startsWith(root + path.sep));
    if (!isAllowed || !fs.existsSync(resolved)) return;
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) return;
    fs.unlinkSync(resolved);
    deletedCount++;
    freedBytes += stat.size;
  };

  const purgeMatchingInDir = (dirPath: string, idSet: Set<string>) => {
    if (!fs.existsSync(dirPath) || idSet.size === 0) return;
    for (const entry of fs.readdirSync(dirPath)) {
      const base = entry.replace(/\.(mp4|json|txt|tmp)$/i, '');
      const matched =
        idSet.has(base) || Array.from(idSet).some((id) => entry.startsWith(`${id}.`) || entry.startsWith(`${id}-`));
      if (matched) {
        tryDelete(path.join(dirPath, entry));
      }
    }
  };

  purgeMatchingInDir(dirs.rendersDir, renderSet);
  purgeMatchingInDir(dirs.cacheDir, renderSet);
  purgeMatchingInDir(dirs.compilationsDir, compSet);
  purgeMatchingInDir(dirs.cacheDir, compSet);
  purgeMatchingInDir(path.resolve(process.cwd(), 'data', 'tmp-renders'), renderSet);
  purgeMatchingInDir(path.resolve(process.cwd(), 'data', 'tmp-compilations'), compSet);

  return { deletedCount, freedBytes };
}

