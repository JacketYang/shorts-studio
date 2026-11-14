import React, { useMemo, useState } from 'react';
import {
  CalendarDays,
  Clock,
  Copy,
  Download,
  ExternalLink,
  List,
  ListPlus,
  Package,
  ShieldAlert,
  ShieldOff,
  UploadCloud,
} from 'lucide-react';
import type { VideoRecord } from '../domain/types';
import type { StudioState } from '../types/ui';

interface CalendarViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
}

export const CalendarView: React.FC<CalendarViewProps> = ({ state, onRefresh }) => {
  const [viewMode, setViewMode] = useState<'list' | 'week'>('list');
  const [packVideo, setPackVideo] = useState<VideoRecord | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<VideoRecord | null>(null);
  const [rescheduleIso, setRescheduleIso] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weekDays = useMemo(() => {
    const base = new Date();
    base.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base.getTime() + i * 86400_000);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short', timeZone: 'UTC' });
      const items = state.videos.filter((v) => v.scheduled_at.slice(0, 10) === key);
      return { key, label, items };
    });
  }, [state.videos]);

  const handlePublishAction = async (
    videoId: string,
    opts: { action?: string; simulateNetworkDrop?: boolean; manualYoutubeUrl?: string }
  ) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(opts),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '发布操作失败');
      } else if (opts.simulateNetworkDrop) {
        setStatusMsg(
          `已模拟 90% 断网：远端已记录幂等 ID (${data.video?.yt_video_id})，点击「立即上传」将自动恢复而不重复创建。`
        );
      } else if (data.alreadyExisted) {
        setStatusMsg(`幂等恢复成功：复用远端视频 ${data.video?.yt_video_id}，未重复扣除 1,600 上传配额！`);
      } else {
        setStatusMsg(
          `操作完成：状态 ${data.video?.state}${data.video?.yt_video_id ? ` (${data.video.yt_video_id})` : ''}`
        );
      }
      await onRefresh();
    } finally {
      setBusy(false);
    }
  };

  const handleRescheduleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rescheduleTarget || !rescheduleIso) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/videos/${rescheduleTarget.id}/schedule`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scheduledAt: new Date(rescheduleIso).toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '调整排期失败');
      } else {
        setStatusMsg(`已将「${rescheduleTarget.title}」排期调整至 ${data.video.scheduled_at.slice(0, 16).replace('T', ' ')} UTC`);
        setRescheduleTarget(null);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async (v: VideoRecord) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/videos/${v.id}/withdraw`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '紧急撤回失败');
      } else {
        setStatusMsg(`已紧急撤回「${v.title}」（设为 private）并按安全规则将该频道审核档位降级为 L0 全手动。`);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddToPlaylist = async (v: VideoRecord) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const sp = state.specs.find((s) => s.id === v.spec_id);
      const playlistTitle = sp?.spec.concept.series?.title || 'Physics & Music Shorts';
      const res = await fetch(`/api/videos/${v.id}/playlist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playlistTitle }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '加入播放列表失败');
      } else {
        setStatusMsg(
          `已将「${v.title}」归入系列播放列表「${data.playlistTitle}」(${data.playlistId})`
        );
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(label);
      setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Fallback ignored in headless
    }
  };

  const quotaPct = Math.min(100, Math.round((state.quota.used_units / state.quota.daily_limit) * 100));

  return (
    <div className="space-y-6">
      {/* Quota Dashboard */}
      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              YouTube API 项目配额台账 ({state.quota.date_pt} PT)
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              按太平洋时间午夜重置 · 每次上传预扣 1,600 单位 · 全局上传上限 {state.quota.global_daily_upload_cap} 条/天（所有频道合计）
            </p>
          </div>
          <div className="text-right font-mono tabular-nums">
            <div className="text-lg font-semibold text-slate-900">
              {state.quota.used_units.toLocaleString()} / {state.quota.daily_limit.toLocaleString()}
            </div>
            <div className="text-xs text-slate-500">今日剩余可上传约 {state.quota.remaining_uploads_today} 条</div>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100">
          <div className="h-full bg-slate-900 transition-all" style={{ width: `${quotaPct}%` }} />
        </div>
      </div>

      {/* View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              viewMode === 'list' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <List className="h-3.5 w-3.5" />
            排期与上传队列 ({state.videos.length})
          </button>
          <button
            type="button"
            onClick={() => setViewMode('week')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              viewMode === 'week' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            <CalendarDays className="h-3.5 w-3.5" />
            7 天内容日历
          </button>
        </div>
        <div className="text-xs text-slate-500 font-mono tabular-nums">
          当前频道日上限: {state.profile.daily_cap} 条 · 发布窗: {state.profile.posting_windows.map((w) => w.join('-')).join(', ')} ({state.profile.tz})
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-xs font-medium text-slate-800">
          {statusMsg}
        </div>
      )}

      {viewMode === 'week' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekDays.map((day) => (
            <div key={day.key} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2.5">
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-semibold text-slate-900">{day.label}</span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {day.items.length}/{state.profile.daily_cap}
                </span>
              </div>
              <div className="space-y-2">
                {day.items.map((item) => (
                  <div key={item.id} className="rounded border border-slate-200 bg-slate-50 p-2 text-xs space-y-1 min-w-0 overflow-hidden">
                    <div className="flex items-center justify-between gap-1 font-mono text-[11px] text-slate-500 tabular-nums">
                      <span className="shrink-0">{item.scheduled_at.slice(11, 16)}</span>
                      <span className="truncate text-right" title={item.state}>
                        {item.state === 'semi_manual_pending' ? '半手动' : item.state}
                      </span>
                    </div>
                    <div className="font-medium text-slate-900 line-clamp-2 break-words">{item.title}</div>
                    <button
                      type="button"
                      onClick={() => {
                        setRescheduleTarget(item);
                        setRescheduleIso(item.scheduled_at.slice(0, 16));
                      }}
                      className="text-[11px] font-medium text-slate-700 underline hover:text-slate-900"
                    >
                      调整时间
                    </button>
                  </div>
                ))}
                {day.items.length === 0 && (
                  <div className="py-4 text-center text-[11px] text-slate-400">空闲槽位</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Scheduled Queue Table */}
      {viewMode === 'list' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="px-4 py-3">排期时间 (UTC)</th>
                <th className="px-4 py-3">标题与幂等键</th>
                <th className="px-4 py-3">状态 / 隐私</th>
                <th className="px-4 py-3">远端 ID</th>
                <th className="px-4 py-3 text-right">发布操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.videos.map((v) => (
                <tr key={v.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums whitespace-nowrap">
                    {v.scheduled_at.slice(0, 16).replace('T', ' ')}
                    {v.quota_deferred && <div className="text-amber-700">配额顺延</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{v.title}</div>
                    <div className="font-mono text-[11px] text-slate-500">{v.idempotency_key}</div>
                    {v.error_message && <div className="mt-1 text-xs text-amber-700">{v.error_message}</div>}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-700 whitespace-nowrap">
                    <div>{v.state}</div>
                    <div className="font-mono text-slate-400">{v.privacy}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                    {v.yt_video_id ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setRescheduleTarget(v);
                          setRescheduleIso(v.scheduled_at.slice(0, 16));
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <Clock className="h-3 w-3" />
                        改期
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handlePublishAction(v.id, { action: 'upload', simulateNetworkDrop: true })}
                        className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        模拟90%断网
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handlePublishAction(v.id, { action: 'upload' })}
                        className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <UploadCloud className="h-3.5 w-3.5" />
                        {v.state === 'failed' ? '幂等恢复上传' : '上传发布'}
                      </button>
                      {v.yt_video_id && !v.yt_video_id.startsWith('YT_') && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            try {
                              const r = await fetch(`/api/videos/${v.id}/verify-public`, { method: 'POST' });
                              const d = await r.json();
                              setStatusMsg(
                                r.ok
                                  ? `远端公开校验：privacyStatus=${d.privacyStatus} (${d.isPublic ? '已公开，项目已验证' : '仍为私享'})`
                                  : d.error ?? '校验失败'
                              );
                              await onRefresh();
                            } finally {
                              setBusy(false);
                            }
                          }}
                          className="rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                        >
                          校验公开
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleAddToPlaylist(v)}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <ListPlus className="h-3 w-3" />
                        入列表
                      </button>
                      {v.state !== 'withdrawn' && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleWithdraw(v)}
                          className="inline-flex items-center gap-1 rounded border border-rose-200 bg-white px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 whitespace-nowrap shrink-0"
                        >
                          <ShieldOff className="h-3 w-3" />
                          撤回
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setPackVideo(v);
                          setManualUrl('');
                        }}
                        className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <Package className="h-3.5 w-3.5" />
                        发布包
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {state.videos.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    暂无排期视频，请先在审核队列通过一条视频。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="调整排期时间"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
        >
          <form
            onSubmit={handleRescheduleSave}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">调整定时发布槽位</h3>
            <p className="text-xs text-slate-600">{rescheduleTarget.title}</p>
            <div>
              <label htmlFor="reschedule-dt" className="block text-xs font-medium text-slate-700 mb-1">
                目标时间 (UTC)
              </label>
              <input
                id="reschedule-dt"
                type="datetime-local"
                required
                value={rescheduleIso}
                onChange={(e) => setRescheduleIso(e.target.value)}
                className="w-full rounded border border-slate-200 px-3 py-2 font-mono text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRescheduleTarget(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
              >
                保存新排期
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Semi-Manual Publish Pack Modal */}
      {packVideo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="半手动发布包"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
        >
          <div className="w-full max-w-xl rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">半手动发布包 (API 审计降级方案)</h3>
                <p className="mt-1 text-xs text-slate-500">
                  下载确定性成片后在 YouTube Studio 上传定时，再回填视频链接完成数据关联。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPackVideo(null)}
                className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                关闭
              </button>
            </div>

            {!state.channel.api_audit_verified && (
              <div className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>当前项目未通过 YouTube API 合规审计，自动上传的视频会被锁为私享，推荐使用此发布包。</span>
              </div>
            )}

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between rounded border border-slate-200 p-3">
                <div>
                  <div className="font-medium text-slate-900">1. 下载确定性渲染成片 (1080×1920 H.264 + -14 LUFS)</div>
                  <div className="text-slate-500 mt-0.5">由 Python + ffmpeg 按 Spec 种子实时合成</div>
                </div>
                <a
                  href={`/api/renders/${packVideo.render_id}/mp4`}
                  className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  下载 MP4
                </a>
              </div>

              <div className="rounded border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">标题</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('title', packVideo.title)}
                    className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedField === 'title' ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="font-mono text-slate-900">{packVideo.title}</div>
              </div>

              <div className="rounded border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-700">首评 (发布后复制发送并手动置顶)</span>
                  <button
                    type="button"
                    onClick={() => handleCopy('comment', packVideo.first_comment)}
                    className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedField === 'comment' ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="font-mono text-slate-900">{packVideo.first_comment || '—'}</div>
              </div>

              <div className="rounded border border-slate-200 p-3 space-y-2">
                <label htmlFor="manual-yt-url" className="block font-medium text-slate-700">
                  2. 回填 YouTube Shorts 链接以关联指标快照
                </label>
                <div className="flex gap-2">
                  <input
                    id="manual-yt-url"
                    type="text"
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="https://youtube.com/shorts/JTrpkr4ZGCo"
                    className="flex-1 rounded border border-slate-200 px-3 py-1.5 font-mono text-xs"
                  />
                  <button
                    type="button"
                    disabled={busy || !manualUrl.trim()}
                    onClick={async () => {
                      await handlePublishAction(packVideo.id, {
                        action: 'link_manual',
                        manualYoutubeUrl: manualUrl,
                      });
                      setPackVideo(null);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    关联视频
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
