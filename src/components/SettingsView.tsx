import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, Copy, KeyRound, RefreshCw, Server, Unlink, XCircle } from 'lucide-react';
import type { StorageDriver, StorageStatusSummary } from '../domain/types';
import type { StudioState } from '../types/ui';
import { AiSettingsCard } from './settings/AiSettingsCard';
import { SecretsCard } from './settings/SecretsCard';
import { ChannelAccountCard } from './settings/ChannelAccountCard';
import { StorageSettingsCard } from './settings/StorageSettingsCard';

interface SettingsViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onSwitchChannel: (channelId: string) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ state, onRefresh, onSwitchChannel }) => {
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [oauthMsg, setOauthMsg] = useState<string | null>(null);
  const [copiedUri, setCopiedUri] = useState<string | null>(null);
  const [policyModal, setPolicyModal] = useState<'privacy' | 'terms' | null>(null);
  const [busy, setBusy] = useState(false);

  const [storageStatus, setStorageStatus] = useState<StorageStatusSummary | null>(null);
  const [previewStorageDriver, setPreviewStorageDriver] = useState<StorageDriver>(state.storage_config.driver);

  const oauthAgeDays = state.channel.oauth_connected_at
    ? (Date.now() - new Date(state.channel.oauth_connected_at).getTime()) / 86_400_000
    : null;
  const testingDaysRemaining = oauthAgeDays !== null ? Math.max(0, 7 - oauthAgeDays) : null;

  const refreshStorageStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/storage/status');
      if (res.ok) {
        setStorageStatus((await res.json()) as StorageStatusSummary);
      }
    } catch {
      // Ignore transient poll error
    }
  }, []);

  useEffect(() => {
    void refreshStorageStatus();
  }, [refreshStorageStatus]);

  useEffect(() => {
    setPreviewStorageDriver(state.storage_config.driver);
  }, [state.storage_config.driver]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      if (event.data?.type === 'YT_OAUTH_SUCCESS') {
        setOauthMsg(`YouTube 频道「${event.data.title}」(${event.data.ytChannelId}) 已成功授权并保存凭据！`);
        void onRefresh();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onRefresh]);

  const handleConnectYoutube = async (targetChannelId: string = state.channel.id) => {
    setOauthMsg(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/youtube/url?channelId=${encodeURIComponent(targetChannelId)}`);
      const data = await res.json();
      if (!res.ok || !data.url) {
        setOauthMsg(data.error ?? '获取授权链接失败');
        return;
      }
      const popup = window.open(data.url, 'yt_oauth_popup', 'width=600,height=720');
      if (!popup) {
        setOauthMsg('浏览器拦截了弹窗，请允许当前站点弹出窗口后重试。');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDisconnectYoutube = async () => {
    setBusy(true);
    setOauthMsg(null);
    try {
      const res = await fetch(`/api/channels/${state.channel.id}/disconnect`, { method: 'POST' });
      if (res.ok) {
        setOauthMsg('已断开当前频道 OAuth 授权并清除凭据。');
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUri(key);
      setTimeout(() => setCopiedUri(null), 1500);
    } catch {
      // Ignore clipboard failures in headless
    }
  };

  const handleTriggerCronTick = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/cron/tick', { method: 'POST' });
      const data = await res.json();
      setSaveMsg(
        `Tick 完成：处理任务 ${data.processedJobs ?? 0} 条 · L1 过审 ${data.l1AutoApproved ?? 0} 条 · 清理缓存 ${data.cacheCleaned ?? 0} 个${
          data.lowPoolChannels?.length ? ` · 低水位告警: ${data.lowPoolChannels.join(', ')}` : ''
        }`
      );
      await onRefresh();
      await refreshStorageStatus();
    } finally {
      setBusy(false);
    }
  };

  const monthPrefix = new Date().toISOString().slice(0, 7);
  const monthAiSpend = state.ai_calls
    .filter((a) => a.created_at.startsWith(monthPrefix))
    .reduce((sum, a) => sum + a.cost_usd, 0);

  return (
    <div className="space-y-6">
      {/* Real YouTube OAuth Connection Card */}
      <div className="rounded-lg border border-slate-200 bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <KeyRound className="h-4 w-4 text-slate-500" />
              YouTube Data API v3 与多账号 OAuth 2.0 授权
            </div>
            <p className="mt-1 text-xs text-slate-500">
              所有频道共用同一套 GCP OAuth Client；授权时可自选不同 Google 账号，令牌按 channel_id 独立加密存库，删除频道时同步清除。
            </p>
          </div>
          <div className="flex items-center gap-2">
            {state.channel.oauth_connected && (
              <button
                type="button"
                disabled={busy}
                onClick={handleDisconnectYoutube}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-3.5 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap"
              >
                <Unlink className="h-3.5 w-3.5" />
                断开当前 OAuth
              </button>
            )}
            <button
              type="button"
              disabled={busy || !state.oauth_config.oauth_configured}
              onClick={() => handleConnectYoutube(state.channel.id)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {state.channel.oauth_connected ? '重新授权 / 换绑账号' : '连接 YouTube 频道 (OAuth)'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
          <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="flex items-center justify-between text-slate-500">
              <span>当前频道授权状态 ({state.channel.slug})</span>
              {state.channel.oauth_connected && testingDaysRemaining !== null && (
                <span
                  className={`font-mono font-medium tabular-nums ${
                    testingDaysRemaining <= 1.5 || state.channel.status === 'reauth_required'
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }`}
                >
                  测试版有效期约剩 {testingDaysRemaining.toFixed(1)} 天
                </span>
              )}
            </div>
            <div className="font-mono font-medium text-slate-900">
              {state.channel.oauth_connected
                ? `已连接真实 YouTube (${state.channel.yt_channel_id})`
                : `未授权 OAuth · 当前为本地占位 ID (${state.channel.yt_channel_id})`}
            </div>
            <div className="text-[11px] text-slate-500">
              每个频道独立保存自己的 Refresh Token，新增或删除频道均互不影响。
            </div>
          </div>

          <div className="rounded border border-slate-200 bg-slate-50 p-3 space-y-1">
            <div className="flex items-center justify-between text-slate-500">
              <span>HTTPS 授权回调 URL (填入 GCP Console)</span>
              <button
                type="button"
                onClick={() => handleCopyText('redirect', state.oauth_config.redirect_uri)}
                className="inline-flex items-center gap-1 text-slate-700 hover:text-slate-900"
              >
                <Copy className="h-3 w-3" />
                {copiedUri === 'redirect' ? '已复制' : '复制'}
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-900 break-all">{state.oauth_config.redirect_uri}</div>
            <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-200/70 text-[11px] text-slate-600">
              <span>品牌页端点：</span>
              <button
                type="button"
                onClick={() => handleCopyText('privacy', `${state.oauth_config.app_url}/privacy`)}
                className="underline hover:text-slate-900"
              >
                {copiedUri === 'privacy' ? '已复制 /privacy' : '复制隐私政策 URL'}
              </button>
              <button
                type="button"
                onClick={() => handleCopyText('terms', `${state.oauth_config.app_url}/terms`)}
                className="underline hover:text-slate-900"
              >
                {copiedUri === 'terms' ? '已复制 /terms' : '复制服务条款 URL'}
              </button>
            </div>
          </div>
        </div>

        {oauthMsg && (
          <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-800">
            {oauthMsg}
          </div>
        )}
      </div>

      {/* 平台凭据管理（全部可在后台填写保存） */}
      <SecretsCard secrets={state.secrets ?? []} onRefresh={onRefresh} />

      {/* Modular Settings Cards */}
      <AiSettingsCard
        aiConfig={state.ai_config}
        defaultAiConfig={state.default_ai_config}
        busy={busy}
        setBusy={setBusy}
        onRefresh={onRefresh}
      />

      <StorageSettingsCard
        storageConfig={state.storage_config}
        dbConfig={state.db_config}
        envStatus={state.env_status}
        storageStatus={storageStatus}
        setStorageStatus={setStorageStatus}
        onRefreshStorageStatus={refreshStorageStatus}
        onRefreshState={onRefresh}
        busy={busy}
        setBusy={setBusy}
        onDriverPreviewChange={setPreviewStorageDriver}
      />

      <ChannelAccountCard
        state={state}
        busy={busy}
        setBusy={setBusy}
        onRefresh={onRefresh}
        onRefreshStorageStatus={refreshStorageStatus}
        onSwitchChannel={onSwitchChannel}
        onConnectYoutube={handleConnectYoutube}
        saveMsg={saveMsg}
        setSaveMsg={setSaveMsg}
      />

      {/* Ops Monitor: Background Jobs & AI Cost Ledger */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Activity className="h-4 w-4 text-slate-500" />
              后台任务队列 ({state.jobs.length})
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleTriggerCronTick}
              className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw className="h-3 w-3" />
              手动运行 Tick
            </button>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {state.jobs.slice(0, 6).map((j) => (
              <div key={j.id} className="flex items-center justify-between py-2">
                <div>
                  <div className="font-mono font-medium text-slate-900">
                    {j.type} · {j.status}
                  </div>
                  <div className="font-mono text-slate-500">{j.idempotency_key}</div>
                </div>
                <span className="font-mono text-slate-500 tabular-nums">
                  {j.attempts}/{j.max_attempts} 次
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">AI 成本台账 (本月熔断保护)</h3>
            <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
              ${monthAiSpend.toFixed(4)} / ${state.profile.ai_budget_monthly_usd.toFixed(2)}
            </span>
          </div>
          <div className="divide-y divide-slate-100 text-xs">
            {state.ai_calls.slice(0, 6).map((a) => (
              <div key={a.id} className="flex items-center justify-between py-2">
                <div className="font-mono text-slate-700">
                  {a.purpose} · {a.model}
                </div>
                <div className="font-mono text-slate-900 tabular-nums">
                  {a.tokens_in + a.tokens_out} tok · ${a.cost_usd.toFixed(5)}
                </div>
              </div>
            ))}
            {state.ai_calls.length === 0 && (
              <div className="py-6 text-center text-slate-500">本月尚未产生 AI 调用费用。</div>
            )}
          </div>
        </div>
      </div>

      {/* Compliance Footer */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-200 pt-4 text-xs text-slate-500">
        <span>Shorts Studio · 单体全栈一键部署 · 无 GPU 确定性渲染</span>
        <div className="flex items-center gap-4">
          <a href="/privacy" target="_blank" rel="noreferrer" className="hover:text-slate-900 underline">
            隐私政策 (/privacy)
          </a>
          <a href="/terms" target="_blank" rel="noreferrer" className="hover:text-slate-900 underline">
            服务条款 (/terms)
          </a>
          <button type="button" onClick={() => setPolicyModal('privacy')} className="hover:text-slate-900 underline">
            合规声明弹窗
          </button>
        </div>
      </div>

      {policyModal && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 space-y-3 text-xs text-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">
                {policyModal === 'privacy' ? 'Shorts Studio 隐私政策' : 'Shorts Studio 服务条款'}
              </h3>
              <button type="button" onClick={() => setPolicyModal(null)} className="text-slate-500 hover:text-slate-900">
                关闭
              </button>
            </div>
            <p>
              本工具仅用于管理创作者本人拥有与授权的 YouTube 频道内容生产、排期上传与公开数据分析。所有 OAuth
              刷新令牌均按 channel_id 独立加密保存，可随时断开连接并清除凭据；绝不向第三方转售或跨用户共享 YouTube API 数据。
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
