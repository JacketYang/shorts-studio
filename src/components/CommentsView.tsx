import React, { useState } from 'react';
import { EyeOff, Info, MessageSquare, RefreshCw, Send, Sparkles } from 'lucide-react';
import type { CommentRecord } from '../domain/types';
import type { StudioState } from '../types/ui';

interface CommentsViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
}

export const CommentsView: React.FC<CommentsViewProps> = ({ state, onRefresh }) => {
  const [filter, setFilter] = useState<'inbox' | 'all'>('inbox');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const visibleComments =
    filter === 'inbox' ? state.comments.filter((c) => c.status === 'inbox') : state.comments;

  const getDraftValue = (c: CommentRecord) => drafts[c.id] ?? c.ai_draft ?? '';

  const handleSync = async () => {
    setSyncing(true);
    setStatusMsg(null);
    try {
      const res = await fetch('/api/comments/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: state.channel.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '拉取评论失败');
      } else {
        setStatusMsg(`已同步远端评论 ${data.syncedCount} 条（新增 ${data.addedCount} 条进入收件箱）`);
        await onRefresh();
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleDraft = async (comment: CommentRecord) => {
    setBusyId(comment.id);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}/draft`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? 'AI 起草失败');
      } else {
        setDrafts((prev) => ({ ...prev, [comment.id]: data.comment?.ai_draft ?? '' }));
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleSend = async (comment: CommentRecord) => {
    const text = getDraftValue(comment).trim();
    if (!text) return;
    setBusyId(comment.id);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusMsg(data.error ?? '发送失败');
      } else {
        setStatusMsg(`已回复 ${comment.author}（消耗 50 配额单位）`);
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  const handleModerate = async (comment: CommentRecord, action: 'hide' | 'ignore') => {
    setBusyId(comment.id);
    setStatusMsg(null);
    try {
      const res = await fetch(`/api/comments/${comment.id}/moderate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        setStatusMsg(action === 'hide' ? `已隐藏垃圾评论 (${comment.author})` : `已忽略评论`);
        await onRefresh();
      }
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setFilter('inbox')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              filter === 'inbox' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            待处理收件箱 ({state.comments.filter((c) => c.status === 'inbox').length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('all')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
              filter === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            全部记录 ({state.comments.length})
          </button>
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={handleSync}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          同步 YouTube 频道评论
        </button>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-3.5 text-xs text-slate-600">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>
          优先级规则：对首评的回复 &gt; 提问评论 &gt; 正向互动 &gt; 垃圾评论。默认由 AI 按频道语气起草（{state.profile.brand.tone_rules}），经人工确认后发送；YouTube API 不支持置顶首评，需在 Studio 手动置顶。
        </span>
      </div>

      {statusMsg && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-800">
          {statusMsg}
        </div>
      )}

      <div className="space-y-3">
        {visibleComments.map((c) => {
          const isBusy = busyId === c.id;
          return (
            <div key={c.id} className="rounded-lg border border-slate-200 bg-white p-5 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
                  <span className="font-semibold text-slate-900">{c.author}</span>
                  <span className="text-slate-400">·</span>
                  <span className="font-mono text-slate-600">{c.video_title}</span>
                  {c.is_reply_to_first_comment && (
                    <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      回复首评
                    </span>
                  )}
                  {c.is_question && (
                    <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-700">
                      观众提问
                    </span>
                  )}
                  {c.ai_suggested_action === 'hide' && (
                    <span className="rounded border border-rose-200 bg-rose-50 px-1.5 py-0.5 font-mono text-[10px] text-rose-700">
                      疑似垃圾建议隐藏
                    </span>
                  )}
                </div>
                <span className="font-mono text-xs text-slate-500 tabular-nums">
                  权重 {c.priority_score} · {c.status}
                </span>
              </div>

              <p className="text-sm text-slate-800">{c.text}</p>

              {c.status === 'inbox' ? (
                <div className="space-y-2 border-t border-slate-100 pt-3">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      aria-label={`回复 ${c.author}`}
                      maxLength={200}
                      value={getDraftValue(c)}
                      onChange={(e) => setDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="输入或点击「AI 起草」生成回复（≤ 200 字符）..."
                      className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDraft(c)}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        AI 起草
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || !getDraftValue(c).trim()}
                        onClick={() => handleSend(c)}
                        className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Send className="h-3.5 w-3.5" />
                        确认发送
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleModerate(c, 'hide')}
                        className="inline-flex items-center gap-1 rounded-md border border-rose-200 bg-white px-2.5 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50 whitespace-nowrap"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                        隐藏
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                c.reply_text && (
                  <div className="rounded bg-slate-50 p-2.5 text-xs text-slate-700">
                    <span className="font-medium text-slate-900">已回复：</span>
                    {c.reply_text}
                  </div>
                )
              )}
            </div>
          );
        })}

        {visibleComments.length === 0 && (
          <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
            收件箱暂无待处理评论。
          </div>
        )}
      </div>
    </div>
  );
};
