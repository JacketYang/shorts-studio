import React, { useEffect, useState } from 'react';
import { Database, FolderCog, HardDrive, RefreshCw, Trash2, Wifi } from 'lucide-react';
import type {
  DbAdapterConfig,
  DbDriver,
  ServerEnvStatus,
  StorageConfig,
  StorageDriver,
  StorageStatusSummary,
} from '../../domain/types';

interface StorageSettingsCardProps {
  storageConfig: StorageConfig;
  dbConfig: DbAdapterConfig;
  envStatus: ServerEnvStatus;
  storageStatus: StorageStatusSummary | null;
  setStorageStatus: (s: StorageStatusSummary | null) => void;
  onRefreshStorageStatus: () => Promise<void>;
  onRefreshState: () => Promise<void>;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onDriverPreviewChange?: (driver: StorageDriver) => void;
}

export function formatStorageBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const StorageSettingsCard: React.FC<StorageSettingsCardProps> = ({
  storageConfig,
  dbConfig,
  envStatus,
  storageStatus,
  setStorageStatus,
  onRefreshStorageStatus,
  onRefreshState,
  busy,
  setBusy,
  onDriverPreviewChange,
}) => {
  const [storageDriver, setStorageDriver] = useState<StorageDriver>(storageConfig.driver);
  const [localDir, setLocalDir] = useState(storageConfig.local_dir);
  const [s3Endpoint, setS3Endpoint] = useState(storageConfig.s3_endpoint);
  const [s3Region, setS3Region] = useState(storageConfig.s3_region);
  const [s3Bucket, setS3Bucket] = useState(storageConfig.s3_bucket);
  const [s3Prefix, setS3Prefix] = useState(storageConfig.s3_prefix);
  const [s3PublicUrl, setS3PublicUrl] = useState(storageConfig.s3_public_url);
  const [webdavUrl, setWebdavUrl] = useState(storageConfig.webdav_url);
  const [webdavPrefix, setWebdavPrefix] = useState(storageConfig.webdav_prefix);
  const [webdavPublicUrl, setWebdavPublicUrl] = useState(storageConfig.webdav_public_url);
  const [cacheHours, setCacheHours] = useState(storageConfig.auto_cleanup_cache_hours);
  const [publishedDays, setPublishedDays] = useState(storageConfig.auto_cleanup_published_days);
  const [deleteLocalAfterUpload, setDeleteLocalAfterUpload] = useState(!storageConfig.keep_local_cache_after_upload);

  const [dbDriver, setDbDriver] = useState<DbDriver>(dbConfig.driver);
  const [dbJsonPath, setDbJsonPath] = useState(dbConfig.json_path);
  const [dbPrefix, setDbPrefix] = useState(dbConfig.table_prefix);
  const [storageMsg, setStorageMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showFiles, setShowFiles] = useState(false);

  useEffect(() => {
    setStorageDriver(storageConfig.driver);
    setLocalDir(storageConfig.local_dir);
    setS3Endpoint(storageConfig.s3_endpoint);
    setS3Region(storageConfig.s3_region);
    setS3Bucket(storageConfig.s3_bucket);
    setS3Prefix(storageConfig.s3_prefix);
    setS3PublicUrl(storageConfig.s3_public_url);
    setWebdavUrl(storageConfig.webdav_url);
    setWebdavPrefix(storageConfig.webdav_prefix);
    setWebdavPublicUrl(storageConfig.webdav_public_url);
    setCacheHours(storageConfig.auto_cleanup_cache_hours);
    setPublishedDays(storageConfig.auto_cleanup_published_days);
    setDeleteLocalAfterUpload(!storageConfig.keep_local_cache_after_upload);
    setDbDriver(dbConfig.driver);
    setDbJsonPath(dbConfig.json_path);
    setDbPrefix(dbConfig.table_prefix);
  }, [storageConfig, dbConfig]);

  const buildStoragePayload = () => ({
    driver: storageDriver,
    local_dir: localDir,
    s3_endpoint: s3Endpoint,
    s3_region: s3Region,
    s3_bucket: s3Bucket,
    s3_prefix: s3Prefix,
    s3_public_url: s3PublicUrl,
    webdav_url: webdavUrl,
    webdav_prefix: webdavPrefix,
    webdav_public_url: webdavPublicUrl,
    auto_cleanup_cache_hours: Number(cacheHours),
    auto_cleanup_published_days: Number(publishedDays),
    keep_local_cache_after_upload: !deleteLocalAfterUpload,
  });

  const handleTestStorage = async () => {
    setStorageMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/storage/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildStoragePayload()),
      });
      const data = await res.json();
      setStorageMsg(res.ok ? { ok: true, text: data.message } : { ok: false, text: data.error ?? '存储测试失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveStorageConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setStorageMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/storage-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storage_config: buildStoragePayload(),
          db_config: {
            driver: dbDriver,
            json_path: dbJsonPath,
            table_prefix: dbPrefix,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStorageMsg({ ok: false, text: data.error ?? '保存存储配置失败' });
      } else {
        if (data.status) setStorageStatus(data.status);
        setStorageMsg({ ok: true, text: `已保存存储与数据库配置（当前存储：${data.storage_config?.driver}）` });
        await onRefreshState();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCleanupStorage = async (
    scope: 'cache' | 'published_renders' | 'all_media' | 'single_file',
    relPath?: string
  ) => {
    setStorageMsg(null);
    setBusy(true);
    try {
      const res = await fetch('/api/storage/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope, relPath }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStorageMsg({ ok: false, text: data.error ?? '清理失败' });
      } else {
        if (data.status) setStorageStatus(data.status);
        setStorageMsg({
          ok: true,
          text: `清理完成：删除 ${data.deletedCount} 个文件，释放空间 ${formatStorageBytes(data.freedBytes ?? 0)}`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={handleSaveStorageConfig} className="rounded-lg border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <HardDrive className="h-4 w-4 text-slate-500" />
            视频存储接口、过程缓存清理与数据库适配器
          </div>
          <p className="mt-1 text-xs text-slate-500">
            支持本地自定义目录、Cloudflare R2 / S3 兼容对象存储、WebDAV（Alist/Nextcloud/群晖）；视频成品与渲染过程缓存分目录存放并支持一键清理。
          </p>
        </div>
        <button
          type="button"
          onClick={onRefreshStorageStatus}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          刷新磁盘统计
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 text-xs">
        <div>
          <label htmlFor="storage-driver-select" className="block font-medium text-slate-700">
            视频与素材存储后端
          </label>
          <select
            id="storage-driver-select"
            value={storageDriver}
            onChange={(e) => {
              const next = e.target.value as StorageDriver;
              setStorageDriver(next);
              onDriverPreviewChange?.(next);
            }}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          >
            <option value="local">本地自定义目录 (Local Folder)</option>
            <option value="s3">Cloudflare R2 / AWS S3 / MinIO</option>
            <option value="webdav">WebDAV 网盘 (Alist / Nextcloud / NAS)</option>
          </select>
        </div>

        <div>
          <label htmlFor="storage-local-dir" className="block font-medium text-slate-700">
            本地存储/中转根目录路径
          </label>
          <input
            id="storage-local-dir"
            type="text"
            value={localDir}
            onChange={(e) => setLocalDir(e.target.value)}
            placeholder="./data/media 或 /mnt/nas/shorts"
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          />
        </div>

        <div>
          <label htmlFor="db-driver-select" className="block font-medium text-slate-700">
            数据库适配器模式
          </label>
          <select
            id="db-driver-select"
            value={dbDriver}
            onChange={(e) => setDbDriver(e.target.value as DbDriver)}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
          >
            <option value="json-file">单机原子 JSON 文件库（免安装零依赖）</option>
            <option value="postgresql-url">外置 PostgreSQL 接口 (DATABASE_URL)</option>
          </select>
        </div>
      </div>

      {storageDriver === 's3' && (
        <div className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700">S3 / R2 Endpoint URL</label>
            <input
              type="text"
              value={s3Endpoint}
              onChange={(e) => setS3Endpoint(e.target.value)}
              placeholder="https://<account_id>.r2.cloudflarestorage.com"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">Bucket 名称</label>
            <input
              type="text"
              value={s3Bucket}
              onChange={(e) => setS3Bucket(e.target.value)}
              placeholder="shorts-studio-media"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">Region (R2 填 auto)</label>
            <input
              type="text"
              value={s3Region}
              onChange={(e) => setS3Region(e.target.value)}
              placeholder="auto"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">对象前缀 (Prefix)</label>
            <input
              type="text"
              value={s3Prefix}
              onChange={(e) => setS3Prefix(e.target.value)}
              placeholder="shorts-studio"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block font-medium text-slate-700">公开访问 / CDN 域名前缀（可选）</label>
            <input
              type="text"
              value={s3PublicUrl}
              onChange={(e) => setS3PublicUrl(e.target.value)}
              placeholder="https://cdn.example.com"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
        </div>
      )}

      {storageDriver === 'webdav' && (
        <div className="grid grid-cols-1 gap-3 rounded border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 text-xs">
          <div>
            <label className="block font-medium text-slate-700">WebDAV 服务根地址</label>
            <input
              type="text"
              value={webdavUrl}
              onChange={(e) => setWebdavUrl(e.target.value)}
              placeholder="https://dav.example.com/dav"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">远程子目录前缀</label>
            <input
              type="text"
              value={webdavPrefix}
              onChange={(e) => setWebdavPrefix(e.target.value)}
              placeholder="shorts-studio"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
          <div>
            <label className="block font-medium text-slate-700">公开下载域名前缀（可选）</label>
            <input
              type="text"
              value={webdavPublicUrl}
              onChange={(e) => setWebdavPublicUrl(e.target.value)}
              placeholder="https://files.example.com"
              className="mt-1 w-full rounded border border-slate-200 bg-white px-3 py-1.5 font-mono"
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
        <div>
          <label className="block font-medium text-slate-700">
            {dbDriver === 'json-file' ? '数据库文件路径' : '表前缀 / Schema 前缀'}
          </label>
          {dbDriver === 'json-file' ? (
            <input
              type="text"
              value={dbJsonPath}
              onChange={(e) => setDbJsonPath(e.target.value)}
              placeholder="./data/studio-db.json"
              className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
            />
          ) : (
            <div className="mt-1 flex items-center gap-2">
              <input
                type="text"
                value={dbPrefix}
                onChange={(e) => setDbPrefix(e.target.value)}
                className="w-28 rounded border border-slate-200 px-3 py-2 font-mono"
              />
              <span className="font-mono text-slate-600">
                DATABASE_URL: {envStatus.database_url ? '已注入' : '未注入 (降级 JSON)'}
              </span>
            </div>
          )}
        </div>

        <div>
          <label className="block font-medium text-slate-700">过程缓存自动过期时间（小时）</label>
          <input
            type="number"
            min={1}
            max={720}
            value={cacheHours}
            onChange={(e) => setCacheHours(Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          />
        </div>

        <div>
          <label className="block font-medium text-slate-700">已发布视频本地保留天数</label>
          <input
            type="number"
            min={1}
            max={365}
            value={publishedDays}
            onChange={(e) => setPublishedDays(Number(e.target.value))}
            className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
        <input
          type="checkbox"
          checked={deleteLocalAfterUpload}
          onChange={(e) => setDeleteLocalAfterUpload(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300"
        />
        <span>上传到 S3 / R2 / WebDAV 后自动删除本地 MP4 缓存（仅保留云端链接，大幅节省磁盘空间）</span>
      </label>

      {storageStatus && (
        <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-slate-500">
                <Database className="h-3.5 w-3.5" />
                <span>主数据库体积</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {formatStorageBytes(storageStatus.db_size_bytes)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-slate-500">
                <FolderCog className="h-3.5 w-3.5" />
                <span>过程缓存 (cache/)</span>
              </div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {storageStatus.cache_count} 项 · {formatStorageBytes(storageStatus.cache_bytes)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="text-slate-500">Shorts 视频 (renders/)</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {storageStatus.renders_count} 条 · {formatStorageBytes(storageStatus.renders_bytes)}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white p-3">
              <div className="text-slate-500">合集视频 (compilations/)</div>
              <div className="mt-1 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {storageStatus.compilations_count} 条 · {formatStorageBytes(storageStatus.compilations_bytes)}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
            <span className="font-mono text-[11px] text-slate-500 truncate max-w-md">
              媒体目录：{storageStatus.root_dir}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => handleCleanupStorage('cache')}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
              >
                <Trash2 className="h-3 w-3" />
                清理过程缓存
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleCleanupStorage('published_renders')}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-100"
              >
                <Trash2 className="h-3 w-3" />
                清理已发布视频 MP4
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => handleCleanupStorage('all_media')}
                className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2.5 py-1.5 font-medium text-rose-700 hover:bg-rose-50"
              >
                <Trash2 className="h-3 w-3" />
                清空全部缓存文件
              </button>
              {storageStatus.files.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowFiles((v) => !v)}
                  className="rounded border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-100"
                >
                  {showFiles ? '收起文件明细' : `查看文件 (${storageStatus.files.length})`}
                </button>
              )}
            </div>
          </div>

          {showFiles && storageStatus.files.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                    <th className="px-3 py-2">文件名</th>
                    <th className="px-3 py-2">分类</th>
                    <th className="px-3 py-2 text-right">体积</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {storageStatus.files.map((f) => (
                    <tr key={f.rel_path}>
                      <td className="px-3 py-1.5 font-mono text-slate-900">{f.name}</td>
                      <td className="px-3 py-1.5 font-mono text-slate-500">{f.category}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700">
                        {formatStorageBytes(f.size_bytes)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleCleanupStorage('single_file', f.rel_path)}
                          className="text-rose-700 hover:underline"
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs min-h-[20px]">
          {storageMsg && (
            <span className={storageMsg.ok ? 'font-medium text-emerald-700' : 'font-medium text-rose-700'}>
              {storageMsg.text}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleTestStorage}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
          >
            <Wifi className="h-3.5 w-3.5" />
            测试存储连接
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
          >
            保存存储与数据库配置
          </button>
        </div>
      </div>
    </form>
  );
};
