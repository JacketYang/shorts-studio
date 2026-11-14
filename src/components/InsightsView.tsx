import React, { useState } from 'react';
import { Flame, Plus, Radio, RefreshCw, Search, Sparkles } from 'lucide-react';
import type { StudioState } from '../types/ui';

interface InsightsViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

const SAMPLE_REF_CHANNELS = {
  schema: 'referencechannels/1',
  items: [
    { name: 'CodeCraftedPhysics', handle: '@CodeCraftedPhysics', yt_channel_id: null, tags: ['ring-escape'] },
    { name: 'Satisfying Physics Simulation', handle: null, yt_channel_id: 'UCotJqOQEwG9OgDL2coBl9UA', tags: ['python-sim'] },
  ],
};

const SAMPLE_TREND_IMPORT = {
  schema: 'trendimport/1',
  source: 'tiktok_creative_center',
  captured_at: '2026-11-15T00:00:00Z',
  region: 'US',
  items: [
    { type: 'hashtag', name: '#satisfyingphysics', rank: 3, metric: { views: 88200000, growth_pct: 19 }, note: '高完播视觉标签' },
    { type: 'topic', name: 'Fibonacci Spiral Resonance', rank: 5, metric: { views: 14500000, growth_pct: 31 }, note: '数学规律主题上升' },
  ],
};

export const InsightsView: React.FC<InsightsViewProps> = ({ state, onRefresh, onNavigate }) => {
  const [subTab, setSubTab] = useState<'outliers' | 'trends' | 'import'>('outliers');
  const [importText, setImportText] = useState(JSON.stringify(SAMPLE_TREND_IMPORT, null, 2));
  const [importKind, setImportKind] = useState<'trends' | 'ref'>('trends');
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePollRefs = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/reference-channels/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: state.channel.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '抓取失败');
      } else {
        setStatusMsg(
          `已通过 YouTube RSS + videos.list 刷新 ${data.polledChannels} 个参考频道，更新 ${data.updatedVideos} 条视频（仅消耗 ${data.quotaUsed} 配额单位）`
        );
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResolveRef = async (refId: string) => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/reference-channels/${refId}/resolve`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '解析失败');
      } else {
        setStatusMsg(`已解析参考频道 ID: ${data.reference_channel?.yt_channel_id}（消耗 100 search.list 单位）`);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSuggestIdeas = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/ai/suggest-ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: state.channel.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '选题生成失败');
      } else {
        setStatusMsg(`已基于参考爆款与趋势生成 ${data.addedCount} 条创意 (ideabatch/1)，请到「创意库与导入」查看或展开`);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportJson = async () => {
    setBusy(true);
    setStatusMsg(null);
    try {
      const parsed = JSON.parse(importText);
      const endpoint = importKind === 'trends' ? '/api/trends/import' : '/api/reference-channels/import';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: state.channel.id, payload: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '导入失败');
      } else {
        setStatusMsg(`导入成功：新增 ${data.addedCount} 条记录`);
        await onRefresh();
        setSubTab(importKind === 'trends' ? 'trends' : 'outliers');
      }
    } catch (err: unknown) {
      setStatusMsg(`JSON 解析失败: ${err instanceof Error ? err.message : '格式错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          {[
            { id: 'outliers', label: `参考频道与离群爆款 (${state.reference_videos.length})` },
            { id: 'trends', label: `趋势信号库 (${state.trend_signals.length})` },
            { id: 'import', label: '导入趋势 / 参考清单' },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as typeof subTab)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={handlePollRefs}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            RSS 抓取离群爆款
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={handleSuggestIdeas}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Sparkles className="h-3.5 w-3.5" />
            AI 转译为创意 (ideabatch)
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-800 flex items-center justify-between gap-2">
          <span>{statusMsg}</span>
          <button
            type="button"
            onClick={() => onNavigate('library')}
            className="underline text-slate-900 whitespace-nowrap shrink-0"
          >
            前往创意库查看
          </button>
        </div>
      )}

      {subTab === 'outliers' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 lg:col-span-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Radio className="h-4 w-4 text-slate-500" />
              参考频道追踪清单 (日耗 ≤ 100 配额)
            </div>
            <p className="text-xs text-slate-500">
              通过公开 RSS（0 配额）拉取最新视频列表，再批量调用 videos.list（1 单位/50条）计算相对中位数倍率。
            </p>
            <div className="divide-y divide-slate-100 text-xs">
              {state.reference_channels.map((rc) => (
                <div key={rc.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">{rc.name}</div>
                    <div className="font-mono text-slate-500 truncate">
                      {rc.yt_channel_id ?? '未绑定 channel_id'} · {rc.tags.join(', ')}
                    </div>
                  </div>
                  {!rc.yt_channel_id && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolveRef(rc.id)}
                      className="inline-flex items-center gap-1 rounded border border-slate-200 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Search className="h-3 w-3" />
                      解析 ID
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-3 lg:col-span-7">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Flame className="h-4 w-4 text-amber-600" />
              离群爆款榜 (outlier_ratio ≥ 5x 标记爆款 · 仅灵感转译，禁止抄袭)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3">频道 / 视频标题</th>
                    <th className="py-2 pr-3">归因猜测</th>
                    <th className="py-2 pr-3 text-right">播放量</th>
                    <th className="py-2 text-right">离群倍率</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {state.reference_videos.map((rv) => (
                    <tr key={rv.id} className="hover:bg-slate-50">
                      <td className="py-2.5 pr-3">
                        <div className="font-medium text-slate-900">{rv.title}</div>
                        <div className="font-mono text-slate-500">
                          {rv.ref_channel_name} · {rv.yt_video_id}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-slate-600">
                        {rv.extracted_axes.mechanic_guess} · {rv.extracted_axes.hook_guess}
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-900">
                        {rv.views.toLocaleString()}
                      </td>
                      <td
                        className={`py-2.5 text-right font-mono font-semibold tabular-nums ${
                          rv.outlier_ratio >= 5 ? 'text-emerald-700' : 'text-slate-600'
                        }`}
                      >
                        {rv.outlier_ratio.toFixed(1)}x
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'trends' && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-500">
                <th className="px-4 py-3">来源 / 类型</th>
                <th className="px-4 py-3">信号名称</th>
                <th className="px-4 py-3 text-right">排名</th>
                <th className="px-4 py-3 text-right">体量 / 增速</th>
                <th className="px-4 py-3">版权与使用边界</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {state.trend_signals.map((tr) => (
                <tr key={tr.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-slate-600">
                    {tr.source} · {tr.type}
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-900">{tr.name}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">#{tr.rank}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                    {tr.views.toLocaleString()} (+{tr.growth_pct}%)
                  </td>
                  <td className="px-4 py-3">
                    {tr.reference_only ? (
                      <span className="font-medium text-rose-700">仅作参考 (禁止直接用版权音频)</span>
                    ) : (
                      <span className="text-slate-600">{tr.note || '可转化为物理/旋律主题'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'import' && (
        <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setImportKind('trends');
                  setImportText(JSON.stringify(SAMPLE_TREND_IMPORT, null, 2));
                }}
                className={`rounded border px-3 py-1.5 text-xs font-medium ${
                  importKind === 'trends' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                }`}
              >
                trendimport/1
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportKind('ref');
                  setImportText(JSON.stringify(SAMPLE_REF_CHANNELS, null, 2));
                }}
                className={`rounded border px-3 py-1.5 text-xs font-medium ${
                  importKind === 'ref' ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700'
                }`}
              >
                referencechannels/1
              </button>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={handleImportJson}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
            >
              <Plus className="h-3.5 w-3.5" />
              确认导入
            </button>
          </div>
          <textarea
            aria-label="趋势或参考频道 JSON"
            rows={12}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            className="w-full rounded-md border border-slate-200 bg-slate-50 p-3 font-mono text-xs text-slate-900"
          />
        </div>
      )}
    </div>
  );
};
