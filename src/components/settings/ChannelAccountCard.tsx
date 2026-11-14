import React, { useEffect, useState } from 'react';
import { AlertTriangle, Download, PauseCircle, PlayCircle, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { Channel } from '../../domain/types';
import type { StudioState } from '../../types/ui';
import { formatStorageBytes } from './StorageSettingsCard';

interface ChannelAccountCardProps {
  state: StudioState;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  onRefreshStorageStatus: () => Promise<void>;
  onSwitchChannel: (channelId: string) => void;
  onConnectYoutube: (channelId: string) => Promise<void>;
  saveMsg: string | null;
  setSaveMsg: (v: string | null) => void;
}

interface DeleteStatsPreview {
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

export const ChannelAccountCard: React.FC<ChannelAccountCardProps> = ({
  state,
  busy,
  setBusy,
  onRefresh,
  onRefreshStorageStatus,
  onSwitchChannel,
  onConnectYoutube,
  saveMsg,
  setSaveMsg,
}) => {
  const [reviewMode, setReviewMode] = useState(state.profile.review_mode);
  const [noveltyMode, setNoveltyMode] = useState(state.profile.novelty_mode);
  const [dailyCap, setDailyCap] = useState(state.profile.daily_cap);
  const [aiBudget, setAiBudget] = useState(state.profile.ai_budget_monthly_usd);
  const [auditVerified, setAuditVerified] = useState(state.channel.api_audit_verified);

  const [newSlug, setNewSlug] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newNiche, setNewNiche] = useState('');
  const [channelActionMsg, setChannelActionMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [deleteStats, setDeleteStats] = useState<DeleteStatsPreview | null>(null);
  const [purgeAllData, setPurgeAllData] = useState(true);

  useEffect(() => {
    setReviewMode(state.profile.review_mode);
    setNoveltyMode(state.profile.novelty_mode);
    setDailyCap(state.profile.daily_cap);
    setAiBudget(state.profile.ai_budget_monthly_usd);
    setAuditVerified(state.channel.api_audit_verified);
  }, [
    state.channel.id,
    state.profile.review_mode,
    state.profile.novelty_mode,
    state.profile.daily_cap,
    state.profile.ai_budget_monthly_usd,
    state.channel.api_audit_verified,
  ]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaveMsg(null);
    const res = await fetch(`/api/channels/${state.channel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        review_mode: reviewMode,
        novelty_mode: noveltyMode,
        daily_cap: Number(dailyCap),
        ai_budget_monthly_usd: Number(aiBudget),
        api_audit_verified: auditVerified,
      }),
    });
    if (res.ok) {
      setSaveMsg('频道配置已保存并生效');
      await onRefresh();
    }
  };

  const handleTogglePause = async () => {
    const nextStatus = state.channel.status === 'paused' ? 'connected' : 'paused';
    await fetch(`/api/channels/${state.channel.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    });
    await onRefresh();
  };

  const handleCreateChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    setChannelActionMsg(null);
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: newSlug, title: newTitle, niche: newNiche }),
    });
    const data = await res.json();
    if (!res.ok) {
      setChannelActionMsg({ ok: false, text: data.error ?? '创建频道失败' });
      return;
    }
    if (data.channel) {
      setNewSlug('');
      setNewTitle('');
      setNewNiche('');
      setChannelActionMsg({ ok: true, text: `已创建隔离频道「${data.channel.title}」并切换过去。` });
      await onRefresh();
      onSwitchChannel(data.channel.id);
    }
  };

  const handleOpenDeleteModal = async (ch: Channel) => {
    setChannelActionMsg(null);
    setDeleteTarget(ch);
    setDeleteStats(null);
    setPurgeAllData(true);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(ch.id)}/stats`);
      if (res.ok) {
        const data = await res.json();
        setDeleteStats(data.stats);
      }
    } catch {
      // Optional stats preview
    }
  };

  const handleConfirmDeleteChannel = async () => {
    if (!deleteTarget) return;
    setBusy(true);
    setChannelActionMsg(null);
    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(deleteTarget.id)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ purge_data: purgeAllData }),
      });
      const data = await res.json();
      if (!res.ok) {
        setChannelActionMsg({ ok: false, text: data.error ?? '删除频道失败' });
        setDeleteTarget(null);
        return;
      }
      const deletedTitle = deleteTarget.title;
      setDeleteTarget(null);
      setChannelActionMsg({
        ok: true,
        text: purgeAllData
          ? `已彻底删除频道「${deletedTitle}」，清空 ${data.removedRecords} 条关联数据与 ${data.deletedFiles} 个媒体文件（释放 ${formatStorageBytes(data.freedBytes ?? 0)}）。`
          : `已移除频道账号「${deletedTitle}」及其 OAuth 凭据（保留历史归档数据）。`,
      });
      if (data.remainingChannelId && deleteTarget.id === state.channel.id) {
        onSwitchChannel(data.remainingChannelId);
      }
      await onRefresh();
      await onRefreshStorageStatus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Current Channel Profile */}
        <form onSubmit={handleSaveProfile} className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 truncate">
                当前频道档案 ({state.channel.slug})
              </h2>
              <p className="text-xs text-slate-500 font-mono truncate">YT Channel ID: {state.channel.yt_channel_id}</p>
            </div>
            <button
              type="button"
              onClick={handleTogglePause}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                state.channel.status === 'paused'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-rose-200 bg-rose-50 text-rose-800'
              }`}
            >
              {state.channel.status === 'paused' ? (
                <>
                  <PlayCircle className="h-3.5 w-3.5" />
                  恢复发布
                </>
              ) : (
                <>
                  <PauseCircle className="h-3.5 w-3.5" />
                  紧急暂停频道
                </>
              )}
            </button>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
            <span className="font-medium text-slate-900">信任等级评估：</span>
            {state.trust_evaluation.reason}
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700">审核自动化档位</label>
              <select
                value={reviewMode}
                onChange={(e) => setReviewMode(e.target.value as typeof reviewMode)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                <option value="L0">L0 全手动 (MVP 默认)</option>
                <option value="L1">L1 半自动 (8h 超时自动过)</option>
                <option value="L2">L2 全自动 (20% 抽检)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700">差异度守卫模式</label>
              <select
                value={noveltyMode}
                onChange={(e) => setNoveltyMode(e.target.value as typeof noveltyMode)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2"
              >
                <option value="warn">仅告警 (Phase 1 校准期)</option>
                <option value="block">强制阻断 (Phase 2)</option>
              </select>
            </div>

            <div>
              <label className="block font-medium text-slate-700">频道日发布上限</label>
              <input
                type="number"
                min={1}
                max={6}
                value={dailyCap}
                onChange={(e) => setDailyCap(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700">AI 月预算上限 (USD)</label>
              <input
                type="number"
                min={1}
                max={100}
                value={aiBudget}
                onChange={(e) => setAiBudget(Number(e.target.value))}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 font-mono"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 rounded border border-slate-200 p-3 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={auditVerified}
              onChange={(e) => setAuditVerified(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <span>GCP 项目已通过 YouTube API 合规审计（勾选后上传可直转公开，不再锁私享）</span>
          </label>

          {saveMsg && <div className="text-xs font-medium text-emerald-700">{saveMsg}</div>}

          <div className="flex items-center justify-between pt-2">
            <a
              href="/api/export"
              download="shorts-studio-backup.json"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 hover:text-slate-900"
            >
              <Download className="h-3.5 w-3.5" />
              导出全量工作台 JSON 备份
            </a>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              保存频道配置
            </button>
          </div>
        </form>

        {/* Multi-channel Hard Isolation Manager (Add, Switch, Bind OAuth, Delete + Clean Purge) */}
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <ShieldCheck className="h-4 w-4 text-slate-500" />
              多频道账号管理与隔离列表 ({state.channels.length})
            </div>
            <p className="text-xs text-slate-500">
              所有业务表按 channel_id 强制隔离，支持新增、切换、独立授权绑定及彻底删除频道账号与关联数据。
            </p>

            {channelActionMsg && (
              <div
                className={`rounded border px-3 py-2 text-xs font-medium ${
                  channelActionMsg.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-rose-200 bg-rose-50 text-rose-800'
                }`}
              >
                {channelActionMsg.text}
              </div>
            )}

            <div className="divide-y divide-slate-100 text-xs">
              {state.channels.map((ch) => (
                <div key={ch.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{ch.title}</div>
                    <div className="font-mono text-slate-500 truncate">
                      {ch.slug} · {ch.status} · {ch.oauth_connected ? 'OAuth已连' : '未授权'}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={busy || !state.oauth_config.oauth_configured}
                      onClick={() => onConnectYoutube(ch.id)}
                      className="rounded border border-slate-200 px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      {ch.oauth_connected ? '重连账号' : '授权绑定'}
                    </button>
                    <button
                      type="button"
                      onClick={() => onSwitchChannel(ch.id)}
                      className={`rounded px-3 py-1 font-medium ${
                        ch.id === state.channel.id
                          ? 'bg-slate-900 text-white'
                          : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      {ch.id === state.channel.id ? '当前频道' : '切换'}
                    </button>
                    <button
                      type="button"
                      disabled={busy || state.channels.length <= 1}
                      title={state.channels.length <= 1 ? '至少保留 1 个活跃频道' : `删除频道 ${ch.title}`}
                      onClick={() => handleOpenDeleteModal(ch)}
                      className="inline-flex items-center gap-1 rounded border border-rose-200 px-2 py-1 font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-35"
                    >
                      <Trash2 className="h-3 w-3" />
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <form onSubmit={handleCreateChannel} className="rounded-lg border border-slate-200 bg-white p-6 space-y-3">
            <h3 className="text-sm font-semibold text-slate-900">新增隔离频道</h3>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <input
                type="text"
                required
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="slug (如 abstract-asmr)"
                className="rounded border border-slate-200 px-3 py-2 font-mono"
              />
              <input
                type="text"
                required
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="频道名称"
                className="rounded border border-slate-200 px-3 py-2"
              />
            </div>
            <input
              type="text"
              value={newNiche}
              onChange={(e) => setNewNiche(e.target.value)}
              placeholder="题材定位（需与现有频道明显区隔，如 magnetic-pendulum-asmr）"
              className="w-full rounded border border-slate-200 px-3 py-2 text-xs"
            />
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50"
            >
              <Plus className="h-3.5 w-3.5" />
              创建独立频道
            </button>
          </form>
        </div>
      </div>

      {/* Delete Channel Confirmation Modal */}
      {deleteTarget && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-rose-50 p-2 text-rose-700 shrink-0">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-slate-900">
                  确认删除频道「{deleteTarget.title}」({deleteTarget.slug})
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  将立即移除该频道配置及独立保存的 OAuth 授权凭据。您可以选择是否同时把该频道名下的所有历史数据与视频缓存彻底清空：
                </p>
              </div>
            </div>

            {deleteStats && (
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-[11px] font-mono text-slate-700 space-y-1">
                <div>关联数据总计：{deleteStats.total_records} 条记录</div>
                <div className="text-slate-500">
                  创意 {deleteStats.ideas} · Spec {deleteStats.specs} · 渲染 {deleteStats.renders} · 视频 {deleteStats.videos} ·
                  远端快照 {deleteStats.remote_videos} · 评论 {deleteStats.comments} · 合集 {deleteStats.compilations}
                </div>
              </div>
            )}

            <label className="flex items-start gap-2.5 rounded border border-rose-200 bg-rose-50/50 p-3 text-xs text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={purgeAllData}
                onChange={(e) => setPurgeAllData(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-rose-300"
              />
              <div>
                <div className="font-semibold text-rose-900">彻底删除该频道所有关联数据与本地缓存视频（删干净）</div>
                <div className="mt-0.5 text-[11px] text-rose-700">
                  勾选后将不可恢复地清空该频道的全部创意、Spec、审核、排期、分析、评论、AI 台账及磁盘上的 MP4/过程缓存文件；不勾选则仅删账号和凭据并保留历史归档。
                </div>
              </div>
            </label>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setDeleteTarget(null)}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirmDeleteChannel}
                className="rounded-md bg-rose-700 px-4 py-2 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50"
              >
                {purgeAllData ? '确认删号并清空全部数据' : '仅移除账号凭据'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
