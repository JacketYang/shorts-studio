import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Download,
  Film,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldAlert,
  SlidersHorizontal,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { VideoSpec, WorkbenchRecipeMeta } from '../domain/types';
import type { StudioState } from '../types/ui';
import { workbenchMetaToWorkbenchSpec } from '../workbench/bridge';
import { clampTempoScale } from '../workbench/engine/presets';
import { buildScene } from '../workbench/scenes';
import { CreativeAudioTuner } from './CreativeAudioTuner';
import { SimulationPlayer } from './SimulationPlayer';

interface StudioViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

interface NativeCreativeDraft {
  title: string;
  hookLine: string;
  melodyId: string;
  tempoBpm: number;
  motionSpeedScale: number;
  instrument: string;
  transpose: number;
  reverb: number;
  paletteFamily: 'neon' | 'pastel' | 'mono' | 'warm' | 'cool';
  seed: number;
}

const NATIVE_PALETTE_PREVIEW: Record<
  'neon' | 'pastel' | 'mono' | 'warm' | 'cool',
  { colors: string[]; bg: [string, string] }
> = {
  neon: { colors: ['#00F5D4', '#F15BB5', '#FEE440', '#9B5DE5'], bg: ['#05060F', '#101437'] },
  pastel: { colors: ['#FFADAD', '#FFD6A5', '#CAFFBF', '#9BF6FF'], bg: ['#1E1B2E', '#2A2438'] },
  mono: { colors: ['#F8FAFC', '#CBD5E1', '#94A3B8', '#64748B'], bg: ['#09090B', '#18181B'] },
  warm: { colors: ['#F97316', '#FBBF24', '#EF4444', '#FB7185'], bg: ['#1C0F0A', '#2D160C'] },
  cool: { colors: ['#38BDF8', '#22D3EE', '#818CF8', '#34D399'], bg: ['#061423', '#0B253A'] },
};

function makeNativeDraftFromSpec(spec: VideoSpec): NativeCreativeDraft {
  const mRef = spec.audio.music?.melody_ref;
  return {
    title: spec.publish.title,
    hookLine: spec.concept.hook_line,
    melodyId: mRef?.source === 'library' ? mRef.id : 'pd:canon-in-d',
    tempoBpm: spec.audio.music?.tempo_bpm ?? 108,
    motionSpeedScale: 1,
    instrument: spec.audio.music?.instrument ?? 'marimba',
    transpose: spec.audio.music?.transpose ?? 0,
    reverb: spec.audio.music?.reverb ?? 0.12,
    paletteFamily: spec.scene.style.palette.family,
    seed: spec.scene.seed,
  };
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

  const [tunerOpen, setTunerOpen] = useState(true);
  const [draftWbMeta, setDraftWbMeta] = useState<WorkbenchRecipeMeta | null>(null);
  const [draftWbTitle, setDraftWbTitle] = useState('');
  const [nativeDraft, setNativeDraft] = useState<NativeCreativeDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [savingCreative, setSavingCreative] = useState(false);
  const [creativeNotice, setCreativeNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const selectedRender =
    state.renders.find((r) => r.id === selectedRenderId) ?? state.renders[0] ?? null;
  const selectedSpec = selectedRender
    ? state.specs.find((s) => s.id === selectedRender.spec_id) ?? null
    : null;

  // Sync draft when selection or saved spec timestamp changes
  useEffect(() => {
    setDirty(false);
    if (!selectedRender || !selectedSpec) {
      setDraftWbMeta(null);
      setDraftWbTitle('');
      setNativeDraft(null);
      return;
    }
    if (selectedRender.workbench_meta) {
      const m = selectedRender.workbench_meta;
      setDraftWbMeta({
        ...m,
        params:
          m.params && typeof m.params === 'object'
            ? structuredClone(m.params)
            : {},
      });
      setDraftWbTitle(selectedSpec.spec.publish.title);
      setNativeDraft(null);
    } else {
      setDraftWbMeta(null);
      setDraftWbTitle('');
      setNativeDraft(makeNativeDraftFromSpec(selectedSpec.spec));
    }
  }, [selectedRender?.id, selectedSpec?.id, selectedSpec?.updated_at]);

  useEffect(() => {
    setCreativeNotice(null);
  }, [selectedSpec?.id]);

  const draftWbDuration = useMemo(() => {
    if (!draftWbMeta || !selectedSpec) return draftWbMeta?.duration_sec ?? 25;
    try {
      const wbSpec = workbenchMetaToWorkbenchSpec(
        draftWbMeta,
        draftWbTitle || selectedSpec.spec.publish.title,
        selectedSpec.spec.publish.description,
        selectedSpec.spec.publish.tags
      );
      return buildScene(wbSpec).duration;
    } catch {
      return draftWbMeta.duration_sec;
    }
  }, [draftWbMeta, draftWbTitle, selectedSpec]);

  const liveSpecForPlayer = useMemo<VideoSpec | null>(() => {
    if (!selectedSpec) return null;
    if (selectedRender?.workbench_meta && draftWbMeta) {
      return {
        ...selectedSpec.spec,
        scene: {
          ...selectedSpec.spec.scene,
          seed: draftWbMeta.seed,
        },
        concept: {
          ...selectedSpec.spec.concept,
          hook_line: draftWbMeta.hook,
          working_title: draftWbTitle || selectedSpec.spec.publish.title,
        },
        publish: {
          ...selectedSpec.spec.publish,
          title: draftWbTitle || selectedSpec.spec.publish.title,
        },
      };
    }
    if (!selectedRender?.workbench_meta && nativeDraft) {
      const base = selectedSpec.spec;
      const cloned: VideoSpec = structuredClone(base);
      cloned.publish.title = nativeDraft.title || base.publish.title;
      cloned.concept.working_title = cloned.publish.title;
      cloned.concept.hook_line = nativeDraft.hookLine || base.concept.hook_line;
      cloned.scene.seed = nativeDraft.seed;
      const pal = NATIVE_PALETTE_PREVIEW[nativeDraft.paletteFamily];
      if (pal) {
        cloned.scene.style.palette = { family: nativeDraft.paletteFamily, colors: [...pal.colors] };
        cloned.scene.style.background = { type: 'gradient', colors: [...pal.bg] };
      }
      if (cloned.audio.music) {
        cloned.audio.music.melody_ref = { source: 'library', id: nativeDraft.melodyId };
        cloned.audio.music.tempo_bpm = nativeDraft.tempoBpm;
        cloned.audio.music.instrument = nativeDraft.instrument;
        cloned.audio.music.transpose = nativeDraft.transpose;
        cloned.audio.music.reverb = nativeDraft.reverb;
      }
      const s = clampTempoScale(nativeDraft.motionSpeedScale);
      if (Math.abs(s - 1) > 0.001) {
        const scParams = cloned.scene.params as Record<string, Record<string, unknown>>;
        if (cloned.scene.template === 'melody-bounce' && scParams.balls && typeof scParams.balls.speed === 'number') {
          scParams.balls.speed = Number(Math.max(0.25, Math.min(1.5, scParams.balls.speed * s)).toFixed(3));
        } else if (cloned.scene.template === 'orbit-sync' && scParams.orbits && typeof scParams.orbits.base_omega === 'number') {
          scParams.orbits.base_omega = Number(Math.max(0.3, Math.min(4.0, scParams.orbits.base_omega * s)).toFixed(3));
        } else if (cloned.scene.template === 'pendulum-wave' && scParams.rule && typeof scParams.rule.cycle_sec === 'number') {
          scParams.rule.cycle_sec = Number(Math.max(8, Math.min(60, scParams.rule.cycle_sec / s)).toFixed(2));
        } else if (cloned.scene.template === 'rings-escape' && scParams.rings && typeof scParams.rings.rotation_deg_per_s === 'number') {
          scParams.rings.rotation_deg_per_s = Number(
            Math.max(-120, Math.min(120, scParams.rings.rotation_deg_per_s * s)).toFixed(2)
          );
        }
      }
      return cloned;
    }
    return selectedSpec.spec;
  }, [selectedSpec, selectedRender?.workbench_meta, draftWbMeta, draftWbTitle, nativeDraft]);

  const melodyResolved = useMemo(() => {
    const targetSpec = liveSpecForPlayer ?? selectedSpec?.spec;
    if (targetSpec?.audio.music?.melody_ref.source === 'library') {
      const mId = targetSpec.audio.music.melody_ref.id;
      return state.melodies.find((m) => m.id === mId);
    }
    return undefined;
  }, [liveSpecForPlayer, selectedSpec, state.melodies]);

  const handleResetDraft = () => {
    if (!selectedRender || !selectedSpec) return;
    if (selectedRender.workbench_meta) {
      const m = selectedRender.workbench_meta;
      setDraftWbMeta({
        ...m,
        params: m.params && typeof m.params === 'object' ? structuredClone(m.params) : {},
      });
      setDraftWbTitle(selectedSpec.spec.publish.title);
    } else {
      setNativeDraft(makeNativeDraftFromSpec(selectedSpec.spec));
    }
    setDirty(false);
    setCreativeNotice(null);
  };

  const handleSaveCreative = async () => {
    if (!selectedRender || !selectedSpec) return;
    setSavingCreative(true);
    setCreativeNotice(null);
    try {
      const payload =
        selectedRender.workbench_meta && draftWbMeta
          ? {
              title: draftWbTitle.trim() || selectedSpec.spec.publish.title,
              hookLine: draftWbMeta.hook,
              seed: draftWbMeta.seed,
              theme: draftWbMeta.theme,
              durationSec: Math.round(draftWbDuration),
              paramsPatch:
                draftWbMeta.params && typeof draftWbMeta.params === 'object'
                  ? (draftWbMeta.params as Record<string, unknown>)
                  : {},
            }
          : nativeDraft
            ? {
                title: nativeDraft.title.trim() || selectedSpec.spec.publish.title,
                hookLine: nativeDraft.hookLine,
                seed: nativeDraft.seed,
                paletteFamily: nativeDraft.paletteFamily,
                motionSpeedScale: nativeDraft.motionSpeedScale,
                audioPatch: {
                  melodyId: nativeDraft.melodyId,
                  tempoBpm: nativeDraft.tempoBpm,
                  transpose: nativeDraft.transpose,
                  instrument: nativeDraft.instrument,
                  reverb: nativeDraft.reverb,
                },
              }
            : {};

      const res = await fetch(`/api/specs/${selectedSpec.id}/creative`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreativeNotice({ ok: false, text: data.error ?? '保存音画调校失败' });
        return;
      }
      if (data.render?.id) {
        setSelectedRenderId(data.render.id);
      }
      setDirty(false);
      await onRefresh();
      const noveltyScore = data.render?.novelty?.score;
      setCreativeNotice({
        ok: true,
        text: selectedRender.workbench_meta
          ? `已保存音画与节奏调校（差异度 ${noveltyScore ?? '--'}/100）。请点击下方「渲染 1080p 成片并存入生产线存储」写入最新成片。`
          : `已保存音画参数并重算确定性仿真（Novelty ${noveltyScore ?? '--'}/100）。`,
      });
    } catch (err) {
      setCreativeNotice({ ok: false, text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSavingCreative(false);
    }
  };

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

  const handleDeleteRender = async (renderId: string, title: string) => {
    const ok = window.confirm(
      `确定删除这条渲染记录？\n\n「${title}」\n\n将同时删除磁盘上的 MP4 与缓存文件，创意本身保留。`
    );
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/renders/${renderId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        window.alert(data.error ?? '删除失败');
      } else {
        const mb = ((data.freedBytes ?? 0) / 1048576).toFixed(1);
        window.alert(`已删除渲染记录，清理 ${data.deletedFiles ?? 0} 个文件（释放 ${mb} MB）`);
        if (selectedRenderId === renderId) setSelectedRenderId('');
        await onRefresh();
      }
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
              相同 Spec + 种子 + 模板版本输出完全一致的仿真哈希与音画事件；右侧支持随时微调节奏/曲目/音色。
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
                        {rnd.workbench_meta ? `工坊:${rnd.workbench_meta.engine}` : rnd.worker} · sim:{rnd.sim_hash.slice(0, 10)} · 差异度 {rnd.novelty.score}/100
                        {rnd.workbench_meta && (
                          <span className={rnd.media_ready ? ' text-emerald-700' : ' text-amber-700'}>
                            {' · '}
                            {rnd.media_ready
                              ? `成片已存 (${((rnd.media_bytes ?? 0) / 1048576).toFixed(1)}M)`
                              : '待渲染成片'}
                          </span>
                        )}
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
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          handleDeleteRender(rnd.id, spec?.spec.publish.title ?? rnd.spec_id)
                        }
                        aria-label={`删除渲染 ${rnd.id}`}
                        title="删除渲染记录与磁盘文件"
                        className="rounded border border-rose-200 bg-white p-1.5 text-rose-600 hover:bg-rose-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
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

        {/* Right: 9:16 Deterministic Preview + Live Creative Tuner + MP4 Download */}
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-7">
          {selectedRender && selectedSpec && liveSpecForPlayer ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{liveSpecForPlayer.publish.title}</h2>
                  <div className="mt-1 font-mono text-xs text-slate-500">
                    {selectedSpec.spec.axes.mechanic} · {selectedSpec.spec.axes.arena} · seed {liveSpecForPlayer.scene.seed} ·
                    SHA {selectedRender.file_sha256.slice(0, 12)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setTunerOpen((v) => !v)}
                    aria-expanded={tunerOpen}
                    className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                      tunerOpen
                        ? 'border-slate-900 bg-slate-900 text-white'
                        : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    {tunerOpen ? '收起音画调校' : '调速/换曲/换音色'}
                  </button>
                  <a
                    href={`/api/renders/${selectedRender.id}/mp4`}
                    className={`inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0 ${
                      selectedRender.workbench_meta && !selectedRender.media_ready ? 'opacity-60' : ''
                    }`}
                    title={
                      selectedRender.workbench_meta && !selectedRender.media_ready
                        ? '请先点击播放器下方的「渲染 1080p 成片并存入生产线存储」'
                        : '下载已存入生产线存储的 MP4'
                    }
                  >
                    <Download className="h-3.5 w-3.5" />
                    {selectedRender.workbench_meta && !selectedRender.media_ready ? '待渲染成片' : '导出 1080p MP4'}
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

              {/* Inline Live Creative & Music Tuner */}
              {tunerOpen && (
                <div className="space-y-2.5">
                  {selectedRender.workbench_meta && draftWbMeta ? (
                    <CreativeAudioTuner
                      mode="workbench"
                      engine={draftWbMeta.engine}
                      params={
                        draftWbMeta.params && typeof draftWbMeta.params === 'object'
                          ? (draftWbMeta.params as Record<string, unknown>)
                          : {}
                      }
                      theme={draftWbMeta.theme}
                      seed={draftWbMeta.seed}
                      durationSec={draftWbDuration}
                      hookLine={draftWbMeta.hook}
                      title={draftWbTitle}
                      onChangeParams={(patch) => {
                        setDraftWbMeta((prev) =>
                          prev
                            ? {
                                ...prev,
                                params: {
                                  ...(prev.params && typeof prev.params === 'object'
                                    ? (prev.params as Record<string, unknown>)
                                    : {}),
                                  ...patch,
                                },
                              }
                            : prev
                        );
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                      onChangeTheme={(nextTheme) => {
                        setDraftWbMeta((prev) => (prev ? { ...prev, theme: nextTheme } : prev));
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                      onChangeSeed={(nextSeed) => {
                        setDraftWbMeta((prev) => (prev ? { ...prev, seed: nextSeed } : prev));
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                      onChangeHookLine={(val) => {
                        setDraftWbMeta((prev) => (prev ? { ...prev, hook: val } : prev));
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                      onChangeTitle={(val) => {
                        setDraftWbTitle(val);
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                    />
                  ) : nativeDraft ? (
                    <CreativeAudioTuner
                      mode="native"
                      melodies={state.melodies}
                      melodyId={nativeDraft.melodyId}
                      tempoBpm={nativeDraft.tempoBpm}
                      motionSpeedScale={nativeDraft.motionSpeedScale}
                      instrument={nativeDraft.instrument}
                      transpose={nativeDraft.transpose}
                      reverb={nativeDraft.reverb}
                      paletteFamily={nativeDraft.paletteFamily}
                      seed={nativeDraft.seed}
                      hookLine={nativeDraft.hookLine}
                      title={nativeDraft.title}
                      durationSec={selectedSpec.spec.format.duration_sec}
                      onChangeNative={(patch) => {
                        setNativeDraft((prev) => (prev ? { ...prev, ...patch } : prev));
                        setDirty(true);
                        setCreativeNotice(null);
                      }}
                    />
                  ) : null}

                  {(dirty || creativeNotice) && (
                    <div
                      className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-xs ${
                        dirty
                          ? 'border-amber-200 bg-amber-50 text-amber-900'
                          : creativeNotice?.ok
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                            : 'border-rose-200 bg-rose-50 text-rose-800'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        {dirty
                          ? selectedRender.workbench_meta && selectedRender.media_ready
                            ? '正在试听未保存的音画改动：点「保存调校」后将重新计算差异度分，并需重渲 MP4 覆盖旧成片。'
                            : '正在实时试听未保存的改动：可直接点下方「播放预览」试听速度、曲目与音色效果。'
                          : creativeNotice?.text}
                      </span>

                      {dirty && (
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={savingCreative}
                            onClick={handleResetDraft}
                            className="inline-flex items-center gap-1 rounded border border-amber-300 bg-white px-2.5 py-1 font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <RotateCcw className="h-3 w-3" />
                            还原已保存
                          </button>
                          <button
                            type="button"
                            disabled={savingCreative}
                            onClick={() => void handleSaveCreative()}
                            className="inline-flex items-center gap-1 rounded bg-slate-900 px-3 py-1 font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                            <Save className="h-3 w-3" />
                            {savingCreative ? '保存中…' : '保存调校并重算审校'}
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <SimulationPlayer
                spec={liveSpecForPlayer}
                melody={melodyResolved}
                renderId={selectedRender?.id ?? null}
                renderCompleted={selectedRender?.status === 'completed'}
                workbenchMeta={selectedRender?.workbench_meta ? draftWbMeta : null}
                mediaReady={Boolean(selectedRender?.media_ready) && !dirty}
                storageHint={
                  state.storage_config.driver === 'local'
                    ? `${state.storage_config.local_dir}/renders`
                    : `${state.storage_config.driver} 远端存储`
                }
                onMediaUploaded={onRefresh}
              />
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
                const needsWbRender = Boolean(rnd.workbench_meta && !rnd.media_ready);
                return (
                  <label
                    key={rnd.id}
                    className={`flex items-center gap-2 rounded border p-2 text-xs ${
                      needsWbRender ? 'cursor-not-allowed opacity-60 border-slate-200 bg-slate-50' : 'cursor-pointer'
                    } ${checked ? 'border-slate-900 bg-slate-50' : 'border-slate-200'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={needsWbRender}
                      onChange={() => toggleCompRender(rnd.id)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    <span className="truncate font-medium text-slate-800">{sp?.spec.publish.title ?? rnd.spec_id}</span>
                    <span className="ml-auto font-mono text-[11px] text-slate-500 tabular-nums shrink-0">
                      {needsWbRender ? '待出片' : `${sp?.spec.format.duration_sec ?? 24}s`}
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
