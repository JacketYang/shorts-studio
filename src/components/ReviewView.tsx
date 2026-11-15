import React, { useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Info, Save, ShieldAlert, Shuffle, Wand2, X } from 'lucide-react';
import {
  auditPublishMetadata,
  diversifyMetadataLocal,
  sanitizeMetadataCandidate,
} from '../domain/metadata-guard';
import type { RejectionReasonTag } from '../domain/types';
import type { StudioState } from '../types/ui';
import { SimulationPlayer } from './SimulationPlayer';

interface ReviewViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

const REASON_TAGS: Array<{ id: RejectionReasonTag; label: string }> = [
  { id: 'hook_weak', label: '钩子太弱' },
  { id: 'too_similar', label: '内容重复度高' },
  { id: 'audio_bad', label: '音画或响度不佳' },
  { id: 'visual_bad', label: '画面遮挡/节奏差' },
  { id: 'title_bad', label: '标题缺乏悬念' },
  { id: 'risky', label: '政策或版权风险' },
];

export const ReviewView: React.FC<ReviewViewProps> = ({ state, onRefresh, onNavigate }) => {
  const reviewQueue = state.specs.filter((s) => s.status === 'in_review');
  const [activeIndex, setActiveIndex] = useState(0);
  const currentSpec = reviewQueue[activeIndex] ?? reviewQueue[0] ?? null;
  const currentRender = currentSpec
    ? state.renders.find((r) => r.spec_id === currentSpec.id) ?? null
    : null;

  const [editedTitle, setEditedTitle] = useState('');
  const [editedHook, setEditedHook] = useState('');
  const [editedDesc, setEditedDesc] = useState('');
  const [editedTags, setEditedTags] = useState('');
  const [diversifyCounter, setDiversifyCounter] = useState(0);
  const [selectedTags, setSelectedTags] = useState<RejectionReasonTag[]>([]);
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [metaNotice, setMetaNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (currentSpec) {
      setEditedTitle(currentSpec.spec.publish.title);
      setEditedHook(currentSpec.spec.concept.hook_line);
      setEditedDesc(currentSpec.spec.publish.description);
      setEditedTags(currentSpec.spec.publish.tags.join(', '));
      setDiversifyCounter(0);
      setSelectedTags([]);
      setNote('');
      setErrorMsg(null);
      setMetaNotice(null);
    }
  }, [currentSpec?.id]);

  const recentChannelTitles = useMemo(
    () =>
      [
        ...state.specs.filter((s) => s.id !== currentSpec?.id).map((s) => s.spec.publish.title),
        ...state.remote_videos.filter((v) => !v.is_legacy).map((v) => v.title),
      ].filter(Boolean),
    [state.specs, state.remote_videos, currentSpec?.id]
  );

  const parsedTagList = useMemo(
    () =>
      editedTags
        .split(/[,，\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [editedTags]
  );

  const metadataAudit = useMemo(
    () =>
      auditPublishMetadata({
        title: editedTitle,
        hookLine: editedHook,
        description: editedDesc,
        tags: parsedTagList,
        recentTitles: recentChannelTitles,
        forbiddenTopics: state.profile.brand.forbidden_topics,
      }),
    [editedTitle, editedHook, editedDesc, parsedTagList, recentChannelTitles, state.profile.brand.forbidden_topics]
  );

  const persistEditedMetadata = async (silent = false) => {
    if (!currentSpec) return;
    const res = await fetch(`/api/specs/${currentSpec.id}/metadata`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: editedTitle,
        hookLine: editedHook,
        description: editedDesc,
        tags: parsedTagList,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error ?? '保存文案失败');
    }
    if (!silent) {
      setMetaNotice(`已保存标题、描述与标签（合规体检 ${data.audit?.score ?? 100}/100）`);
      await onRefresh();
    }
  };

  const handleLocalDiversify = () => {
    if (!currentSpec) return;
    const nextVar = diversifyCounter + 1;
    setDiversifyCounter(nextVar);
    const res = diversifyMetadataLocal({
      id: currentSpec.spec.spec_key,
      engine: currentRender?.workbench_meta?.engine ?? currentSpec.spec.axes.mechanic,
      category: currentRender?.workbench_meta?.category ?? currentSpec.spec.axes.arena,
      baseTitle: currentSpec.spec.publish.title,
      hookLine: currentSpec.spec.concept.hook_line,
      description: currentSpec.spec.publish.description,
      tags: currentSpec.spec.publish.tags,
      params: currentRender?.workbench_meta?.params ?? currentSpec.spec.scene.params,
      seed: currentSpec.spec.scene.seed,
      variant: nextVar,
      recentTitles: recentChannelTitles,
      forbiddenTopics: state.profile.brand.forbidden_topics,
    });
    setEditedTitle(res.title);
    setEditedHook(res.hookLine);
    setEditedDesc(res.description);
    setEditedTags(res.tags.join(', '));
    setMetaNotice(`已用无 AI 防重引擎生成第 ${nextVar} 版（体检 ${res.audit.score}/100），点「保存文案改动」或直接放行生效。`);
  };

  const handleSanitize = () => {
    const clean = sanitizeMetadataCandidate({
      title: editedTitle,
      hookLine: editedHook,
      description: editedDesc,
      tags: parsedTagList,
      forbiddenTopics: state.profile.brand.forbidden_topics,
    });
    setEditedTitle(clean.title);
    setEditedHook(clean.hookLine);
    setEditedDesc(clean.description);
    setEditedTags(clean.tags.join(', '));
    setMetaNotice('已自动清理标题 #标签、过量表情与多余 #tag。');
  };

  const handleAiRewrite = async () => {
    if (!currentSpec) return;
    setBusy(true);
    setErrorMsg(null);
    setMetaNotice(null);
    try {
      const res = await fetch('/api/ai/rewrite-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          applyToSpecs: true,
          items: [
            {
              id: currentSpec.id,
              engine: currentRender?.workbench_meta?.engine ?? currentSpec.spec.axes.mechanic,
              category: currentRender?.workbench_meta?.category ?? currentSpec.spec.axes.arena,
              title: editedTitle,
              hookLine: editedHook,
              description: editedDesc,
              tags: parsedTagList,
              params: currentRender?.workbench_meta?.params ?? currentSpec.spec.scene.params,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? 'AI 润色失败');
        return;
      }
      const item = data.items?.[0];
      if (item) {
        setEditedTitle(item.title);
        setEditedHook(item.hookLine);
        setEditedDesc(item.description);
        setEditedTags((item.tags ?? []).join(', '));
        setMetaNotice(`AI 降本润色完成并已保存（模型 ${data.model} · 费用 $${Number(data.cost_usd ?? 0).toFixed(5)}）`);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  const melodyResolved =
    currentSpec?.spec.audio.music?.melody_ref.source === 'library'
      ? state.melodies.find((m) => m.id === (currentSpec.spec.audio.music!.melody_ref as { source: 'library'; id: string }).id)
      : undefined;

  const toggleTag = (tag: RejectionReasonTag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleApprove = async () => {
    if (!currentRender || !currentSpec) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      await persistEditedMetadata(true);
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renderId: currentRender.id,
          decision: 'approved',
          editedTitle,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? '审核提交失败');
      } else {
        await onRefresh();
        onNavigate('calendar');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '审核提交失败');
    } finally {
      setBusy(false);
    }
  };

  const handleReject = async () => {
    if (!currentRender) return;
    setBusy(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          renderId: currentRender.id,
          decision: 'rejected',
          reasonTags: selectedTags,
          note,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error ?? '驳回失败');
      } else {
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!currentSpec || !currentRender) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-12 text-center">
        <h2 className="text-base font-semibold text-slate-900">审核队列已清空</h2>
        <p className="mt-2 text-sm text-slate-500">当前频道暂无待审核视频，可前往创意库渲染新的规格。</p>
        <button
          type="button"
          onClick={() => onNavigate('library')}
          className="mt-4 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
        >
          前往创意库
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-slate-600">
          待审队列：<span className="font-mono font-semibold text-slate-900">{reviewQueue.length}</span> 条 · 审核模式{' '}
          <span className="font-mono font-semibold text-slate-900">{state.profile.review_mode}</span>
        </div>
        {reviewQueue.length > 1 && (
          <div className="flex items-center gap-1.5">
            {reviewQueue.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`rounded px-2.5 py-1 text-xs font-mono ${
                  idx === activeIndex ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-700'
                }`}
              >
                #{idx + 1}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-lg border border-slate-200 bg-white p-5 lg:col-span-5">
          <SimulationPlayer
            spec={currentSpec.spec}
            melody={melodyResolved}
            renderId={currentRender.id}
            renderCompleted={currentRender.status === 'completed'}
            workbenchMeta={currentRender.workbench_meta ?? null}
            mediaReady={Boolean(currentRender.media_ready)}
            storageHint={
              state.storage_config.driver === 'local'
                ? `${state.storage_config.local_dir}/renders`
                : `${state.storage_config.driver} 远端存储`
            }
            onMediaUploaded={onRefresh}
          />
        </div>

        <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          {/* T14：自动 QA 得分偏低时提示"建议重做"，但不阻止人工放行 */}
          {typeof currentRender.qa_score === 'number' && currentRender.qa_score < 0.8 && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <div className="flex items-center gap-1.5 font-semibold">
                <ShieldAlert className="h-3.5 w-3.5" />
                建议重做（自动 QA 得分 {(currentRender.qa_score * 10).toFixed(0)}/10）
              </div>
              <div className="mt-1 text-amber-800">
                以下检查未通过：
                {(currentRender.auto_qa?.checks ?? [])
                  .filter((c) => !c.passed)
                  .map((c) => c.name)
                  .join('、') || '（详见渲染记录）'}
                。仍可人工放行。
              </div>
            </div>
          )}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                {metadataAudit.passed && metadataAudit.issues.length === 0 ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    发布文案体检：{metadataAudit.score}/100（合规无撞车）
                  </span>
                ) : (
                  <span className={`inline-flex items-center gap-1 font-semibold ${metadataAudit.passed ? 'text-amber-700' : 'text-rose-700'}`}>
                    <ShieldAlert className="h-3.5 w-3.5" />
                    文案体检 {metadataAudit.score}/100（{metadataAudit.issues.length} 项提醒）
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  disabled={busy}
                  onClick={handleLocalDiversify}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
                >
                  <Shuffle className="h-3 w-3" />
                  无 AI 防重重拟
                </button>
                {metadataAudit.issues.length > 0 && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleSanitize}
                    className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                  >
                    合规清理
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleAiRewrite()}
                  className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  <Wand2 className="h-3 w-3" />
                  AI 降本润色
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void persistEditedMetadata(false)}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                >
                  <Save className="h-3 w-3" />
                  保存文案
                </button>
              </div>
            </div>

            {metadataAudit.issues.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50/70 px-3 py-1.5 text-[11px] space-y-0.5">
                {metadataAudit.issues.map((iss, idx) => (
                  <div key={idx} className={iss.level === 'error' ? 'text-rose-700' : 'text-amber-800'}>
                    • {iss.message}
                  </div>
                ))}
              </div>
            )}

            {metaNotice && (
              <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-medium text-emerald-800">
                {metaNotice}
              </div>
            )}

            <div>
              <label htmlFor="review-title-input" className="block text-xs font-medium text-slate-600">
                发布标题 (≤ 100 字符 · 建议 ≤ 65 字符且不含 #标签)
              </label>
              <input
                id="review-title-input"
                type="text"
                maxLength={100}
                value={editedTitle}
                onChange={(e) => setEditedTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
              <div>
                <label htmlFor="review-hook-input" className="block font-medium text-slate-600">
                  前 1.5s 画面钩子 ({currentSpec.spec.axes.hook_style})
                </label>
                <input
                  id="review-hook-input"
                  type="text"
                  maxLength={80}
                  value={editedHook}
                  onChange={(e) => setEditedHook(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="review-tags-input" className="block font-medium text-slate-600">
                  搜索标签 Tags (逗号分隔 · {parsedTagList.join(',').length}/500 字符)
                </label>
                <input
                  id="review-tags-input"
                  type="text"
                  value={editedTags}
                  onChange={(e) => setEditedTags(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-200 px-2.5 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label htmlFor="review-desc-input" className="block text-xs font-medium text-slate-600">
                视频描述 Description（底部建议保留 3-4 个 #hashtag）
              </label>
              <textarea
                id="review-desc-input"
                rows={4}
                value={editedDesc}
                onChange={(e) => setEditedDesc(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-xs leading-relaxed text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-3 text-xs">
            <div>
              <div className="text-slate-500">差异度评分 / 状态</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {currentRender.novelty.score}/100 ({currentRender.novelty.verdict})
              </div>
            </div>
            <div>
              <div className="text-slate-500">提问式首评 (发布后自动发送)</div>
              <div className="mt-1 font-mono text-slate-800 truncate">{currentSpec.spec.publish.first_comment || '无'}</div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">实质差异说明 (novelty_notes)</div>
              <div className="mt-1 text-slate-800">{currentSpec.spec.concept.novelty_notes}</div>
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <span>
              YouTube Data API 不支持自动置顶评论。系统会在发布后自动发出首评，如需置顶请在 YouTube Studio 手动点击「置顶」。
            </span>
          </div>

          {/* Rejection reason tags */}
          <div className="space-y-2">
            <div className="text-xs font-medium text-slate-600">若需驳回，请选择原因标签（用于回流优化提示词）：</div>
            <div className="flex flex-wrap gap-2">
              {REASON_TAGS.map((tag) => {
                const active = selectedTags.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'border-rose-700 bg-rose-700 text-white'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="补充审核备注（可选）"
              className="mt-2 w-full rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-800"
            />
          </div>

          {errorMsg && <div className="text-xs font-medium text-rose-700">{errorMsg}</div>}

          <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleReject}
              className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-white px-4 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap shrink-0"
            >
              <X className="h-3.5 w-3.5" />
              驳回并回流
            </button>
            <button
              type="button"
              disabled={busy || currentRender.novelty.verdict === 'block'}
              onClick={handleApprove}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Check className="h-3.5 w-3.5" />
              通过并排期发布
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
