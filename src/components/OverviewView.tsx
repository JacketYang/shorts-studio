import React from 'react';
import {
  auditActionLabel,
  auditPayloadSummary,
  auditToneDotClass,
  formatAuditRelative,
  formatAuditTime,
  localTimeZoneLabel,
} from '../lib/audit-format';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock } from 'lucide-react';
import type { StudioState } from '../types/ui';

interface OverviewViewProps {
  state: StudioState;
  onNavigate: (tab: string) => void;
}

export const OverviewView: React.FC<OverviewViewProps> = ({ state, onNavigate }) => {
  const activeRemote = state.remote_videos.filter((v) => !v.is_legacy);
  const totalViews = activeRemote.reduce((s, v) => s + v.views, 0);
  const totalSubs = activeRemote.reduce((s, v) => s + (v.subs_gained - v.subs_lost), 0);
  const subPerK = totalViews > 0 ? (totalSubs / totalViews) * 1000 : 0;
  const sortedStayed = [...activeRemote].map((v) => v.stayed_to_watch_pct).sort((a, b) => a - b);
  const medianStayed = sortedStayed.length ? sortedStayed[Math.floor(sortedStayed.length / 2)] : 0;
  const breakouts = activeRemote.filter((v) => v.performance_tier === 'breakout').length;
  const legacyCount = state.remote_videos.filter((v) => v.is_legacy && v.privacy === 'public').length;

  const readySpecs = state.specs.filter((s) => s.status === 'spec_ready').length;
  const inReview = state.specs.filter((s) => s.status === 'in_review').length;
  const scheduled = state.videos.filter((v) => v.state === 'scheduled' || v.state === 'semi_manual_pending').length;
  const published = state.videos.filter((v) => v.state === 'published').length;

  const oauthDaysElapsed = state.channel.oauth_connected_at
    ? (Date.now() - new Date(state.channel.oauth_connected_at).getTime()) / 86_400_000
    : 0;
  const oauthExpiringSoon =
    state.channel.status === 'reauth_required' ||
    (state.channel.oauth_connected && oauthDaysElapsed >= 6);

  return (
    <div className="space-y-6">
      {/* KPI Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">继续观看率中位数 (近 30 条)</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {medianStayed.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-500">4 周目标 ≥ 52%</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">订阅转化率</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums whitespace-nowrap">
              {subPerK.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500 whitespace-nowrap">/千播放 · 目标 ≥ 2.0</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">破圈视频数 (≥ 10k 或 5x 中位数)</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums whitespace-nowrap">
              {breakouts} / {activeRemote.length}
            </span>
            <span className="text-xs text-slate-500 whitespace-nowrap">净增订阅 +{totalSubs}</span>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5">
          <div className="text-xs font-medium text-slate-500">项目日配额余量 (PT 午夜重置)</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-semibold text-slate-900 tabular-nums">
              {state.quota.remaining_units.toLocaleString()}
            </span>
            <span className="text-xs text-slate-500">/ {state.quota.daily_limit.toLocaleString()} 单位</span>
          </div>
        </div>
      </div>

      {/* Actionable Operational Alerts */}
      {(!state.channel.api_audit_verified || legacyCount > 0 || state.channel.status === 'paused' || oauthExpiringSoon) && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <div className="text-sm font-semibold text-slate-900">当前频道运行提示</div>
          {oauthExpiringSoon && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-sm">
              <div className="flex items-center gap-2 text-rose-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  {state.channel.status === 'reauth_required'
                    ? 'YouTube OAuth 刷新令牌已过期（测试应用 7 天限制或被撤销），请一键重新授权以恢复自动上传与同步。'
                    : 'YouTube 测试应用 OAuth 令牌已使用超过 6 天，即将于 7 天期限到期，建议提前刷新授权。'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('channels')}
                className="text-xs font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700 whitespace-nowrap shrink-0"
              >
                前往刷新授权
              </button>
            </div>
          )}
          {!state.channel.api_audit_verified && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-sm">
              <div className="flex items-center gap-2 text-amber-700">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  YouTube API 尚未标记为「已通过合规审计」：上传视频将被锁为私享，已启用半手动发布包降级流程。
                </span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('channels')}
                className="text-xs font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700 whitespace-nowrap shrink-0"
              >
                前往频道设置确认
              </button>
            </div>
          )}
          {legacyCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-2.5 text-sm">
              <div className="flex items-center gap-2 text-slate-700">
                <Clock className="h-4 w-4 shrink-0 text-slate-500" />
                <span>检测到 {legacyCount} 条历史无关中文视频仍为公开状态，建议批量设为不公开以聚焦频道定位。</span>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('videos')}
                className="text-xs font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700 whitespace-nowrap shrink-0"
              >
                前往批量治理
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pipeline Overview + Recent Audit Log */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-1">
          <h2 className="text-base font-semibold text-slate-900">今日生产流水线</h2>
          <p className="mt-1 text-xs text-slate-500">
            差异度守卫模式：{state.profile.novelty_mode === 'block' ? '强制阻断' : '告警校准'} · 审核：{state.profile.review_mode}
          </p>

          <div className="mt-4 divide-y divide-slate-100">
            <button
              type="button"
              onClick={() => onNavigate('library')}
              className="flex w-full items-center justify-between py-3 text-left hover:bg-slate-50/70"
            >
              <span className="text-sm text-slate-700">待渲染规格 (spec_ready)</span>
              <span className="flex items-center gap-2 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {readySpecs}
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('review')}
              className="flex w-full items-center justify-between py-3 text-left hover:bg-slate-50/70"
            >
              <span className="text-sm text-slate-700">待人工审核 (in_review)</span>
              <span className="flex items-center gap-2 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {inReview}
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('calendar')}
              className="flex w-full items-center justify-between py-3 text-left hover:bg-slate-50/70"
            >
              <span className="text-sm text-slate-700">已排期 / 待发包 (scheduled)</span>
              <span className="flex items-center gap-2 font-mono text-sm font-semibold text-slate-900 tabular-nums">
                {scheduled}
                <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              </span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('videos')}
              className="flex w-full items-center justify-between py-3 text-left hover:bg-slate-50/70"
            >
              <span className="text-sm text-slate-700">已发布关联 (published)</span>
              <span className="flex items-center gap-2 font-mono text-sm font-semibold text-emerald-700 tabular-nums">
                {published}
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              </span>
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">频道审计与运行记录</h2>
            <span className="text-xs text-slate-500">仅显示当前频道 ({state.channel.slug})</span>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs font-medium text-slate-500">
                  <th className="pb-2 pr-4">
                    时间
                    <span className="ml-1 font-normal text-slate-400">({localTimeZoneLabel()})</span>
                  </th>
                  <th className="pb-2 pr-4">动作</th>
                  <th className="pb-2 pr-4">对象</th>
                  <th className="pb-2">详情</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {state.audit_log.slice(0, 7).map((entry) => {
                  const rel = formatAuditRelative(entry.at);
                  return (
                    <tr key={entry.id} className="h-10 hover:bg-slate-50">
                      <td className="py-2 pr-4 tabular-nums whitespace-nowrap">
                        <div className="text-slate-700">{formatAuditTime(entry.at)}</div>
                        {rel && <div className="text-[11px] text-slate-400">{rel}</div>}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                          <span
                            className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${auditToneDotClass(entry.action)}`}
                          />
                          {auditActionLabel(entry.action)}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-slate-600 whitespace-nowrap">{entry.entity}</td>
                      <td className="py-2 text-slate-600">
                        <div className="max-w-[320px] truncate" title={auditPayloadSummary(entry.payload)}>
                          {auditPayloadSummary(entry.payload) || '—'}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
