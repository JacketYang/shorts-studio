import React, { useEffect, useState } from 'react';
import { Check, Info, X } from 'lucide-react';
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
  const [selectedTags, setSelectedTags] = useState<RejectionReasonTag[]>([]);
  const [note, setNote] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (currentSpec) {
      setEditedTitle(currentSpec.spec.publish.title);
      setSelectedTags([]);
      setNote('');
      setErrorMsg(null);
    }
  }, [currentSpec?.id]);

  const melodyResolved =
    currentSpec?.spec.audio.music?.melody_ref.source === 'library'
      ? state.melodies.find((m) => m.id === (currentSpec.spec.audio.music!.melody_ref as { source: 'library'; id: string }).id)
      : undefined;

  const toggleTag = (tag: RejectionReasonTag) => {
    setSelectedTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const handleApprove = async () => {
    if (!currentRender) return;
    setBusy(true);
    setErrorMsg(null);
    try {
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
          <SimulationPlayer spec={currentSpec.spec} melody={melodyResolved} />
        </div>

        <div className="space-y-5 rounded-lg border border-slate-200 bg-white p-6 lg:col-span-7">
          <div>
            <label htmlFor="review-title-input" className="block text-xs font-medium text-slate-600">
              发布标题 (可修改后通过 · ≤ 100 字符)
            </label>
            <input
              id="review-title-input"
              type="text"
              maxLength={100}
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 border-y border-slate-100 py-4 text-xs">
            <div>
              <div className="text-slate-500">前 1.5s 钩子 ({currentSpec.spec.axes.hook_style})</div>
              <div className="mt-1 font-medium text-slate-900">{currentSpec.spec.concept.hook_line}</div>
            </div>
            <div>
              <div className="text-slate-500">差异度评分 / 状态</div>
              <div className="mt-1 font-mono font-semibold text-slate-900 tabular-nums">
                {currentRender.novelty.score}/100 ({currentRender.novelty.verdict})
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">实质差异说明 (novelty_notes)</div>
              <div className="mt-1 text-slate-800">{currentSpec.spec.concept.novelty_notes}</div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500">提问式首评 (发布后自动发送)</div>
              <div className="mt-1 font-mono text-slate-800">{currentSpec.spec.publish.first_comment || '无'}</div>
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
