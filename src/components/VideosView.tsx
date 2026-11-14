import React, { useState } from 'react';
import { BarChart3, ChevronDown, ChevronUp, Edit3, EyeOff, FileSpreadsheet, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import type { RemoteVideo } from '../domain/types';
import type { StudioState } from '../types/ui';

interface VideosViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

const SAMPLE_STUDIO_CSV = `Content,Video title,Video publish time,Duration,Views,Engaged views,Average percentage viewed,Average view duration,Subscribers gained,Watch time (hours)
YT_CSV_01,Canon in D on Spinning Pentagon Xylophone,2026-11-12,26,12400,7936,104.2%,27,32,93.0
YT_CSV_02,16 Balls 4 Bins Spiral Gate,2026-11-11,22,1180,510,79.5%,17,1,5.6
YT_CSV_03,消防安全巡检实操要点,2024-07-10,380,2,1,12.0%,45,0,0.02`;

const BUCKET_LABELS: Record<'core_60' | 'adjacent_30' | 'explore_10', string> = {
  core_60: '60% 主打 (Core)',
  adjacent_30: '30% 相邻 (Adjacent)',
  explore_10: '10% 探索 (Explore)',
};

export const VideosView: React.FC<VideosViewProps> = ({ state, onRefresh, onNavigate }) => {
  const [subTab, setSubTab] = useState<'all' | 'legacy' | 'csv' | 'scoreboard'>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [csvText, setCsvText] = useState(SAMPLE_STUDIO_CSV);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [sequelReadyCount, setSequelReadyCount] = useState<number>(0);
  const [deleteTarget, setDeleteTarget] = useState<RemoteVideo | null>(null);
  const [confirmTitle, setConfirmTitle] = useState('');
  const [editTarget, setEditTarget] = useState<RemoteVideo | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [expandedCurveId, setExpandedCurveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const displayedVideos =
    subTab === 'legacy'
      ? state.remote_videos.filter((v) => v.is_legacy)
      : state.remote_videos;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSyncRemote = async () => {
    setBusy(true);
    setStatusMsg(null);
    setSequelReadyCount(0);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(state.channel.id)}/sync`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '同步 YouTube 远端视频失败');
      } else {
        setStatusMsg(
          `已从 YouTube API 同步 ${data.syncedCount} 条远端视频与统计快照（消耗配额 ${data.quotaUsed} units）`
        );
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateNextEpisode = async (video: RemoteVideo) => {
    setBusy(true);
    setStatusMsg(null);
    setSequelReadyCount(0);
    try {
      const netSubs = video.subs_gained - video.subs_lost;
      const summary = `Views=${video.views}, Engaged=${video.engaged_views}, Stayed=${video.stayed_to_watch_pct.toFixed(
        1
      )}%, AvgViewPct=${video.avg_view_pct.toFixed(1)}%, NetSubs=${netSubs}, Tier=${video.performance_tier ?? 'solid'}`;
      const res = await fetch('/api/ai/next-episode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          sourceTitle: video.title,
          sourceMetricsSummary: summary,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '生成下一集失败');
      } else {
        const count = Array.isArray(data.created) ? data.created.length : 0;
        setSequelReadyCount(count);
        setStatusMsg(
          `已基于 "${video.title}" 生成 ${count} 条续集变体 VideoSpec（Model: ${data.model ?? 'gemini'} · $${Number(
            data.cost_usd ?? 0
          ).toFixed(4)}）`
        );
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleBatchPrivacy = async (privacy: 'unlisted' | 'private') => {
    if (selectedIds.length === 0) return;
    setBusy(true);
    setStatusMsg(null);
    setSequelReadyCount(0);
    try {
      const res = await fetch('/api/videos/batch-privacy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          videoIds: selectedIds,
          privacy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '批量修改隐私失败');
      } else {
        setStatusMsg(`已将 ${data.updatedCount} 条视频批量设为 ${privacy} 并写入审计日志`);
        setSelectedIds([]);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportCsv = async () => {
    setBusy(true);
    setStatusMsg(null);
    setSequelReadyCount(0);
    try {
      const res = await fetch('/api/analytics/import-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          csvText,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? 'CSV 导入失败');
      } else {
        setStatusMsg(`已解析并更新 ${data.importedCount} 条视频指标快照（含继续观看率估算与评分分层）`);
        await onRefresh();
        setSubTab('all');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/remote-videos/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          confirmTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '删除失败');
      } else {
        setStatusMsg(`已删除远端记录 "${deleteTarget.title}" 并记录审计日志`);
        setDeleteTarget(null);
        setConfirmTitle('');
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const renderRetentionCurve = (video: RemoteVideo) => {
    const curve = video.retention_curve ?? [];
    if (curve.length < 2) {
      return (
        <div className="text-xs text-slate-500">
          暂无分段留存曲线快照（连接 YouTube OAuth 并同步后自动拉取 audienceWatchRatio）。
        </div>
      );
    }

    const width = 440;
    const height = 110;
    const padX = 28;
    const padY = 14;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;
    const maxY = Math.max(1.2, ...curve.map((p) => p.watch_ratio));

    const points = curve
      .map((p) => {
        const x = padX + Math.max(0, Math.min(1, p.ratio)) * innerW;
        const y = padY + (1 - p.watch_ratio / maxY) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const baselineY = padY + (1 - 1 / maxY) * innerH;
    const startRatio = curve[0]?.watch_ratio ?? 0;
    const midPoint = curve[Math.floor(curve.length / 2)];
    const endRatio = curve[curve.length - 1]?.watch_ratio ?? 0;

    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="h-28 w-full max-w-[440px] rounded border border-slate-200 bg-white"
            role="img"
            aria-label={`${video.title} 留存曲线`}
          >
            <line
              x1={padX}
              y1={baselineY}
              x2={width - padX}
              y2={baselineY}
              stroke="#cbd5e1"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <polyline fill="none" stroke="#0f172a" strokeWidth="2" points={points} />
            {curve.map((p, idx) => {
              const cx = padX + Math.max(0, Math.min(1, p.ratio)) * innerW;
              const cy = padY + (1 - p.watch_ratio / maxY) * innerH;
              return <circle key={idx} cx={cx} cy={cy} r="2.5" fill="#0f172a" />;
            })}
            <text x={4} y={baselineY + 3} fontSize="9" fill="#64748b">
              100%
            </text>
            <text x={padX} y={height - 2} fontSize="9" fill="#64748b">
              0s
            </text>
            <text x={width - padX - 18} y={height - 2} fontSize="9" fill="#64748b">
              {video.duration_sec}s
            </text>
          </svg>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs font-mono tabular-nums">
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <div className="font-sans text-[11px] text-slate-500">开场留存</div>
            <div className="mt-0.5 font-semibold text-slate-900">{(startRatio * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <div className="font-sans text-[11px] text-slate-500">中段 (50%)</div>
            <div className="mt-0.5 font-semibold text-slate-900">
              {((midPoint?.watch_ratio ?? 0) * 100).toFixed(0)}%
            </div>
          </div>
          <div className="rounded border border-slate-200 bg-white px-3 py-2">
            <div className="font-sans text-[11px] text-slate-500">完播/循环尾</div>
            <div className="mt-0.5 font-semibold text-slate-900">{(endRatio * 100).toFixed(0)}%</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          {[
            { id: 'all', label: `全部视频 (${state.remote_videos.length})` },
            { id: 'legacy', label: `旧视频治理 (${state.remote_videos.filter((v) => v.is_legacy).length})` },
            { id: 'scoreboard', label: '机制记分牌' },
            { id: 'csv', label: '导入 Studio CSV' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id as typeof subTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                subTab === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handleSyncRemote}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            同步 YouTube 远端视频
          </button>

          {(subTab === 'all' || subTab === 'legacy') && (
            <>
              {state.remote_videos.some((v) => v.is_legacy && v.privacy === 'public') && (
                <button
                  type="button"
                  onClick={() =>
                    setSelectedIds(
                      state.remote_videos.filter((v) => v.is_legacy && v.privacy === 'public').map((v) => v.id)
                    )
                  }
                  className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  全选旧中文视频 ({state.remote_videos.filter((v) => v.is_legacy && v.privacy === 'public').length})
                </button>
              )}
              {selectedIds.length > 0 && (
                <>
                  <span className="text-xs text-slate-600">已选 {selectedIds.length} 条</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleBatchPrivacy('unlisted')}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    批量设为不公开 (Unlisted)
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleBatchPrivacy('private')}
                    className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    批量设为私享
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Data-Driven Channel Strategy Summary */}
      {(() => {
        const active = state.remote_videos.filter((v) => !v.is_legacy && v.views > 0);
        if (active.length === 0) return null;
        const legacyPublicCount = state.remote_videos.filter((v) => v.is_legacy && v.privacy === 'public').length;
        const topSub = [...active].sort((a, b) => b.subs_gained - a.subs_gained || b.engaged_views - a.engaged_views)[0];
        const topStayed = [...active].filter((v) => v.views >= 300).sort((a, b) => b.stayed_to_watch_pct - a.stayed_to_watch_pct)[0];
        const lowStayedCount = active.filter((v) => v.stayed_to_watch_pct > 0 && v.stayed_to_watch_pct < 32).length;
        return (
          <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-700 space-y-1.5">
            <div className="font-semibold text-slate-900">
              数据驱动调优状态（AI 生成与 60/30/10 选品已自动加权）
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-3 pt-1">
              <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">最高涨粉 / 主打方向</div>
                <div className="mt-0.5 font-medium text-slate-900 truncate">
                  {topSub ? `${topSub.title} (+${topSub.subs_gained} 订)` : '—'}
                </div>
              </div>
              <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">最高继续观看率</div>
                <div className="mt-0.5 font-medium text-slate-900 truncate">
                  {topStayed ? `${topStayed.stayed_to_watch_pct.toFixed(1)}% · ${topStayed.title}` : '—'}
                </div>
              </div>
              <div className="rounded border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-[11px] text-slate-500">待优化 / 清理项</div>
                <div className="mt-0.5 font-medium text-slate-900">
                  {lowStayedCount} 条低留存(&lt;32%)已降权 · {legacyPublicCount} 条旧中文视频待不公开
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {!state.channel.oauth_connected && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
          <span>当前频道尚未完成 YouTube OAuth 授权，远端同步将以提示拦截；可前往「频道与设置」连接真实频道。</span>
          <button
            type="button"
            onClick={() => onNavigate('channels')}
            className="rounded border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0"
          >
            去连接 OAuth
          </button>
        </div>
      )}

      {statusMsg && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-800">
          <span>{statusMsg}</span>
          {sequelReadyCount > 0 && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onNavigate('library')}
                className="rounded border border-slate-200 px-2.5 py-1 text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                前往创意库查看
              </button>
              <button
                type="button"
                onClick={() => onNavigate('studio')}
                className="rounded bg-slate-900 px-2.5 py-1 text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                前往制作与渲染
              </button>
            </div>
          )}
        </div>
      )}

      {(subTab === 'all' || subTab === 'legacy') && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                <th className="w-10 px-4 py-3">选择</th>
                <th className="px-4 py-3">视频标题 / ID</th>
                <th className="px-4 py-3">隐私状态</th>
                <th className="px-4 py-3 text-right">播放 / 深度观看</th>
                <th className="px-4 py-3 text-right">继续观看%</th>
                <th className="px-4 py-3 text-right">订阅净增</th>
                <th className="px-4 py-3 text-right">分层</th>
                <th className="px-4 py-3 text-right">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {displayedVideos.map((v) => {
                const isExpanded = expandedCurveId === v.id;
                const hasCurve = (v.retention_curve?.length ?? 0) >= 2;
                return (
                  <React.Fragment key={v.id}>
                    <tr className="hover:bg-slate-50/70">
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          aria-label={`选择 ${v.title}`}
                          checked={selectedIds.includes(v.id)}
                          onChange={() => toggleSelect(v.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{v.title}</div>
                        <div className="mt-0.5 font-mono text-slate-500">
                          {v.yt_video_id} · {v.duration_sec}s {v.is_legacy ? '· 历史无关' : ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-700">{v.privacy}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                        {v.views.toLocaleString()} / {v.engaged_views.toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                        {v.stayed_to_watch_pct.toFixed(1)}%
                        {v.stayed_is_estimated ? ' (估算)' : ''}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                        {v.subs_gained - v.subs_lost >= 0 ? `+${v.subs_gained - v.subs_lost}` : v.subs_gained - v.subs_lost}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-medium">
                        <span
                          className={
                            v.performance_tier === 'breakout'
                              ? 'text-emerald-700'
                              : v.performance_tier === 'flop'
                                ? 'text-rose-700'
                                : 'text-slate-700'
                          }
                        >
                          {v.performance_tier ?? 'pending'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setExpandedCurveId(isExpanded ? null : v.id)}
                            aria-label={`留存曲线 ${v.title}`}
                            className="inline-flex items-center gap-1 rounded border border-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                          >
                            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            <span>{hasCurve ? '留存曲线' : '详情'}</span>
                          </button>
                          {!v.is_legacy && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleGenerateNextEpisode(v)}
                              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50"
                            >
                              <Sparkles className="h-3 w-3" />
                              做下一集
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setEditTarget(v);
                              setEditTitle(v.title);
                              setEditDescription('');
                            }}
                            aria-label={`编辑 ${v.title}`}
                            className="rounded border border-slate-200 p-1 text-slate-600 hover:bg-slate-50"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setDeleteTarget(v);
                              setConfirmTitle('');
                            }}
                            aria-label={`删除 ${v.title}`}
                            className="rounded border border-slate-200 p-1 text-slate-500 hover:border-rose-200 hover:text-rose-700"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={8} className="px-4 py-3">
                          <div className="space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                              <span className="font-medium text-slate-800">
                                观众留存曲线 (audienceWatchRatio) · 平均观看时长 {v.avg_view_sec}s ({v.avg_view_pct.toFixed(1)}%)
                              </span>
                              <span className="font-mono tabular-nums">
                                奖励分: {(v.reward_score ?? 0).toFixed(2)} · 互动: {v.likes} 赞 / {v.comments} 评 / {v.shares} 转
                              </span>
                            </div>
                            {renderRetentionCurve(v)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'scoreboard' && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <BarChart3 className="h-4 w-4 text-slate-500" />
              Thompson Sampling 机制记分牌（下周 60 / 30 / 10 题材配比建议）
            </div>
            <p className="text-xs text-slate-700">{state.scoreboard.weeklyHighlight}</p>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-900">60% 主打扩产 (Core)</div>
                <div className="mt-1.5 space-y-1 font-mono text-xs text-slate-700">
                  {state.scoreboard.recommendedMix.core60.map((arm) => (
                    <div key={arm}>{arm}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-900">30% 相邻变体 (Adjacent)</div>
                <div className="mt-1.5 space-y-1 font-mono text-xs text-slate-700">
                  {state.scoreboard.recommendedMix.adjacent30.map((arm) => (
                    <div key={arm}>{arm}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-900">10% 全新探索 (Explore)</div>
                <div className="mt-1.5 space-y-1 font-mono text-xs text-slate-700">
                  {state.scoreboard.recommendedMix.explore10.map((arm) => (
                    <div key={arm}>{arm}</div>
                  ))}
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-4">组合臂 (Mechanic · Hook)</th>
                    <th className="py-2 pr-4 text-right">视频数</th>
                    <th className="py-2 pr-4 text-right">总播放</th>
                    <th className="py-2 pr-4 text-right">平均奖励分</th>
                    <th className="py-2 pr-4 text-right">继续观看%</th>
                    <th className="py-2 pr-4 text-right">订阅 / 千播</th>
                    <th className="py-2 pr-4 text-right">TS 采样分</th>
                    <th className="py-2 text-right">下周配比槽位</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {state.scoreboard.arms.map((arm) => (
                    <tr key={arm.arm} className="h-10">
                      <td className="py-2 pr-4 font-sans font-medium text-slate-900">{arm.arm}</td>
                      <td className="py-2 pr-4 text-right text-slate-700">{arm.count}</td>
                      <td className="py-2 pr-4 text-right text-slate-900">{arm.totalViews.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right text-slate-700">{arm.avgReward.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right text-slate-700">{arm.avgStayedPct.toFixed(1)}%</td>
                      <td className="py-2 pr-4 text-right text-slate-900">{arm.subsPer1k.toFixed(2)}</td>
                      <td className="py-2 pr-4 text-right font-semibold text-slate-900">
                        {arm.thompsonSampleScore.toFixed(2)}
                      </td>
                      <td className="py-2 text-right font-sans text-slate-700">
                        {BUCKET_LABELS[arm.allocationBucket]}
                      </td>
                    </tr>
                  ))}
                  {state.scoreboard.arms.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-4 text-center font-sans text-slate-500">
                        暂无已发布的非历史视频指标，导入 CSV 或同步 YouTube 数据后自动计算。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'csv' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <FileSpreadsheet className="h-4 w-4 text-slate-500" />
              导入 YouTube Studio 导出 CSV
            </div>
            <div className="flex items-center gap-2">
              <label className="cursor-pointer rounded border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                选择 .csv 文件
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        setCsvText(reader.result);
                      }
                    };
                    reader.readAsText(file, 'utf-8');
                  }}
                />
              </label>
              <button
                type="button"
                onClick={() => setCsvText(SAMPLE_STUDIO_CSV)}
                className="rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
              >
                重置示例 CSV
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500">
            支持中英文 YouTube Studio 表头；当未包含继续观看率时，系统会自动使用 engagedViews / views 进行估算并标注。
          </p>
          <textarea
            aria-label="YouTube Studio CSV 内容"
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900"
          />
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy}
              onClick={handleImportCsv}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              解析并更新频道指标
            </button>
          </div>
        </div>
      )}

      {/* Edit Metadata Dialog */}
      {editTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="编辑视频元数据"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setStatusMsg(null);
              try {
                const res = await fetch(`/api/remote-videos/${editTarget.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    channelId: state.channel.id,
                    title: editTitle,
                    description: editDescription || undefined,
                  }),
                });
                const data = await res.json();
                if (!res.ok) {
                  setStatusMsg(data.error ?? '更新元数据失败');
                } else {
                  setStatusMsg(
                    `已更新「${data.video.title}」元数据${
                      data.quotaUsed ? `（已同步至 YouTube，消耗 ${data.quotaUsed} 配额单位）` : '（仅更新本地快照）'
                    }`
                  );
                  setEditTarget(null);
                  await onRefresh();
                }
              } finally {
                setBusy(false);
              }
            }}
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 space-y-4"
          >
            <h3 className="text-base font-semibold text-slate-900">编辑视频标题与描述</h3>
            <div className="space-y-3 text-xs">
              <div>
                <label htmlFor="edit-rv-title" className="block font-medium text-slate-700 mb-1">
                  标题 (≤ 100 字符)
                </label>
                <input
                  id="edit-rv-title"
                  type="text"
                  required
                  maxLength={100}
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full rounded border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label htmlFor="edit-rv-desc" className="block font-medium text-slate-700 mb-1">
                  描述（留空则保留远端现有描述）
                </label>
                <textarea
                  id="edit-rv-desc"
                  rows={4}
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="可选更新描述内容..."
                  className="w-full rounded border border-slate-200 px-3 py-2 text-xs"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
              >
                取消
              </button>
              <button
                type="submit"
                disabled={busy || !editTitle.trim()}
                className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                保存更新
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Safe Delete Confirmation Dialog */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="确认删除视频"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <h3 className="text-base font-semibold text-slate-900">二次确认：永久删除视频记录</h3>
            <p className="text-xs text-slate-600">
              删除操作不可恢复（建议优先使用「批量设为不公开」）。若确认删除，请输入完整标题：
            </p>
            <div className="rounded bg-slate-100 p-2 font-mono text-xs text-slate-900 select-all">
              {deleteTarget.title}
            </div>
            <input
              type="text"
              aria-label="输入视频标题确认删除"
              value={confirmTitle}
              onChange={(e) => setConfirmTitle(e.target.value)}
              placeholder="输入上方完整标题"
              className="w-full rounded border border-slate-200 px-3 py-2 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded border border-slate-200 px-3 py-1.5 text-xs text-slate-700"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy || confirmTitle !== deleteTarget.title}
                onClick={handleConfirmDelete}
                className="rounded bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                确认永久删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
