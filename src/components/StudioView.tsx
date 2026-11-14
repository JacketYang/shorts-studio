import React, { useState } from 'react';
import { CheckCircle2, Copy, Download, Film, RefreshCw, ShieldAlert, XCircle } from 'lucide-react';
import type { StudioState } from '../types/ui';
import { SimulationPlayer } from './SimulationPlayer';

interface StudioViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

export const StudioView: React.FC<StudioViewProps> = ({ state, onRefresh, onNavigate }) => {
  const [selectedRenderId, setSelectedRenderId] = useState<string>(state.renders[0]?.id ?? '');
  const [compRenderIds, setCompRenderIds] = useState<string[]>(() =>
    state.renders.slice(0, 2).map((r) => r.id)
  );
  const [compTitle, setCompTitle] = useState('Relaxing Physics & Music Compilation (No Ads)');
  const [compMsg, setCompMsg] = useState<string | null>(null);
  const [copiedCompId, setCopiedCompId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [qaError, setQaError] = useState<string | null>(null);

  const selectedRender =
    state.renders.find((r) => r.id === selectedRenderId) ?? state.renders[0] ?? null;
  const selectedSpec = selectedRender
    ? state.specs.find((s) => s.id === selectedRender.spec_id) ?? null
    : null;

  const melodyResolved =
    selectedSpec?.spec.audio.music?.melody_ref.source === 'library'
      ? state.melodies.find((m) => m.id === (selectedSpec.spec.audio.music!.melody_ref as { source: 'library'; id: string }).id)
      : undefined;

  const handleRetryRender = async (renderId: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/renders/${renderId}/retry`, { method: 'POST' });
      const data = await res.json();
      await onRefresh();
      if (data.render?.id) setSelectedRenderId(data.render.id);
    } finally {
      setBusy(false);
    }
  };

  const handleRunVisualQa = async (renderId: string) => {
    setBusy(true);
    setQaError(null);
    try {
      const res = await fetch(`/api/renders/${renderId}/visual-qa`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setQaError(data.error ?? '视觉抽检失败');
      } else {
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleCompRender = (id: string) => {
    setCompRenderIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleBuildCompilation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (compRenderIds.length < 2) return;
    setBusy(true);
    setCompMsg(null);
    try {
      const res = await fetch('/api/compilations/build', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          renderIds: compRenderIds,
          title: compTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCompMsg(data.error ?? '生成合集失败');
      } else {
        setCompMsg(`合集「${data.compilation.title}」已生成 (${data.compilation.duration_sec}s)，可下载 MP4 并复制章节。`);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCopyChapters = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCompId(id);
      setTimeout(() => setCopiedCompId(null), 1500);
    } catch {
      // ignore in headless
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Render Queue */}
        <div className="space-y-4 lg:col-span-5">
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">确定性渲染队列 ({state.renders.length})</h2>
            <p className="mt-1 text-xs text-slate-500">
              相同 Spec + 种子 + 模板版本输出完全一致的仿真哈希与音画事件。
            </p>
            <div className="mt-3 divide-y divide-slate-100">
              {state.renders.map((rnd) => {
                const spec = state.specs.find((s) => s.id === rnd.spec_id);
                const isSelected = selectedRender?.id === rnd.id;
                return (
                  <div
                    key={rnd.id}
                    className={`flex items-center justify-between gap-3 py-3 px-2 rounded-md transition-colors ${
                      isSelected ? 'bg-slate-100' : 'hover:bg-slate-50'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedRenderId(rnd.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="truncate text-sm font-medium text-slate-900">
                        {spec?.spec.publish.title ?? rnd.spec_id}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                        {rnd.worker} · sim:{rnd.sim_hash.slice(0, 10)} · 差异度 {rnd.novelty.score}/100
                      </div>
                    </button>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`text-xs font-medium ${
                          rnd.novelty.verdict === 'block' || !rnd.qa_passed
                            ? 'text-rose-700'
                            : rnd.novelty.verdict === 'warn'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                        }`}
                      >
                        {rnd.novelty.verdict === 'block'
                          ? '已阻断'
                          : !rnd.qa_passed
                            ? 'QA 未过'
                            : rnd.novelty.verdict === 'warn'
                              ? '告警通过'
                              : '全部通过'}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => handleRetryRender(rnd.id)}
                        aria-label={`重新渲染 ${rnd.id}`}
                        className="rounded border border-slate-200 bg-white p-1.5 text-slate-600 hover:bg-slate-50"
                      >
                        <RefreshCw className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
              {state.renders.length === 0 && (
                <div className="py-8 text-center text-xs text-slate-500">
                  暂无渲染记录，请先在创意库选择一条 Spec 点击「渲染」。
                </div>
              )}
            </div>
          </div>

          {/* QA & Novelty Diagnostics */}
          {selectedRender && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">自动 QA 与差异度评分</h3>
                <span className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                  Novelty {selectedRender.novelty.score}/100
                </span>
              </div>

              <div className="space-y-1.5">
                {selectedRender.qa_checks.map((chk) => (
                  <div key={chk.name} className="flex items-center justify-between text-xs py-1 border-b border-slate-100 last:border-0">
                    <div className="flex items-center gap-1.5 text-slate-700">
                      {chk.passed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                      )}
                      <span>{chk.name}</span>
                    </div>
                    <span className="font-mono text-slate-500 tabular-nums">{chk.actual}</span>
                  </div>
                ))}
              </div>

              {selectedRender.novelty.violations.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-200 pt-3">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                    <ShieldAlert className="h-3.5 w-3.5" />
                    差异度守卫命中规则 ({selectedRender.novelty.verdict})
                  </div>
                  {selectedRender.novelty.violations.map((v, idx) => (
                    <div key={idx} className="text-xs text-slate-600">
                      <span className="font-mono font-medium text-slate-800">[{v.rule}]</span> {v.message}
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-900">T2 视觉 AI 安全区抽检</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleRunVisualQa(selectedRender.id)}
                    className="rounded border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    运行视觉抽检
                  </button>
                </div>
                {qaError && <div className="text-xs text-rose-700">{qaError}</div>}
                {selectedRender.visual_qa && (
                  <div className="rounded bg-slate-50 p-2.5 text-xs text-slate-700 space-y-1">
                    <div className="font-mono font-medium text-slate-900">
                      {selectedRender.visual_qa.passed ? '通过' : '发现风险'} · 遮挡风险: {selectedRender.visual_qa.occlusion_risk}
                    </div>
                    <div>{selectedRender.visual_qa.summary}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right: 9:16 Deterministic Preview + MP4 Download */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          {selectedRender && selectedSpec ? (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{selectedSpec.spec.publish.title}</h2>
                  <div className="mt-1 font-mono text-xs text-slate-500">
                    {selectedSpec.spec.axes.mechanic} · {selectedSpec.spec.axes.arena} · seed {selectedSpec.spec.scene.seed} ·
                    SHA {selectedRender.file_sha256.slice(0, 12)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/renders/${selectedRender.id}/mp4`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-3.5 w-3.5" />
                    导出 1080p MP4
                  </a>
                  <button
                    type="button"
                    onClick={() => onNavigate('review')}
                    className="rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    前往审核队列
                  </button>
                </div>
              </div>

              <SimulationPlayer spec={selectedSpec.spec} melody={melodyResolved} />
            </div>
          ) : (
            <div className="py-24 text-center text-sm text-slate-500">请选择左侧一条渲染任务以预览物理音频仿真。</div>
          )}
        </div>
      </div>

      {/* Phase 4 Long-Form YPP Compilation Builder */}
      <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Film className="h-4 w-4 text-slate-500" />
              长视频合集生成器 (YPP 观看时长补强)
            </div>
            <p className="mt-1 text-xs text-slate-500">
              勾选 2 条以上已渲染片段，自动通过 ffmpeg 无缝拼接成可下载长视频并生成标准 YouTube 章节时间戳（用于冲刺 4,000h 公开观看时长）。
            </p>
          </div>
        </div>

        <form onSubmit={handleBuildCompilation} className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-2">
            <div className="text-xs font-medium text-slate-700">选择要拼接的成片 ({compRenderIds.length} 已选)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {state.renders.map((rnd) => {
                const sp = state.specs.find((s) => s.id === rnd.spec_id);
                const checked = compRenderIds.includes(rnd.id);
                return (
                  <label
                    key={rnd.id}
                    className={`flex items-center gap-2 rounded border p-2 text-xs cursor-pointer ${
                      checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCompRender(rnd.id)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span className="truncate font-medium text-slate-800">{sp?.spec.publish.title ?? rnd.spec_id}</span>
                    <span className="ml-auto font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {sp?.spec.format.duration_sec ?? 24}s
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-5 flex flex-col justify-between gap-3">
            <div>
              <label htmlFor="comp-title" className="block text-xs font-medium text-slate-700">
                合集标题
              </label>
              <input
                id="comp-title"
                type="text"
                required
                value={compTitle}
                onChange={(e) => setCompTitle(e.target.value)}
                className="mt-1 w-full rounded border border-slate-200 px-3 py-2 text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={busy || compRenderIds.length < 2}
              className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {busy ? '正在合成长视频...' : `拼接 ${compRenderIds.length} 条片段并生成章节`}
            </button>
          </div>
        </form>

        {compMsg && <div className="text-xs font-medium text-emerald-700">{compMsg}</div>}

        {state.compilations.length > 0 && (
          <div className="divide-y divide-slate-100 border-t border-slate-200 pt-3">
            {state.compilations.slice(0, 3).map((cmp) => (
              <div key={cmp.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">
                    {cmp.title} ({cmp.chapters.length} 章节 · {cmp.duration_sec}s)
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-slate-500 truncate">
                    {cmp.chapters.map((c) => `${c.timecode} ${c.title}`).join(' | ')}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyChapters(cmp.id, cmp.description_text)}
                    className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <Copy className="h-3 w-3" />
                    {copiedCompId === cmp.id ? '已复制章节' : '复制章节描述'}
                  </button>
                  <a
                    href={`/api/compilations/${cmp.id}/mp4`}
                    className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    <Download className="h-3.5 w-3.5" />
                    下载合集 MP4
                  </a>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
