import React, { useState } from 'react';
import { extractInstrument, type WorkbenchChannelStatus } from '../workbench/bridge';
import type { WorkbenchAuditReport } from '../workbench/diversity';
import { copyText, saveWithPicker } from '../workbench/engine/download';
import type { VideoSpec as WorkbenchSpec } from '../workbench/engine/types';
import { themeOf } from '../workbench/scenes';
import { WorkbenchThumb } from './WorkbenchThumb';

export interface WorkbenchRenderResult {
  blob: Blob;
  url: string;
  ext: 'mp4' | 'webm';
  size: number;
  note: string;
}

const CAT_BADGES: Record<string, string> = {
  music: '🎵 旋律·球体奏乐',
  sort: '🌈 小球分拣',
  algo: '🔊 排序算法之声',
  phys: '⚛️ 物理现象',
  math: '📐 数学图形',
};

const VOICE_LABELS: Record<string, string> = {
  marimba: '木琴',
  kalimba: '拇指琴',
  celesta: '钢片琴',
  rhodes: '电钢',
  pizzicato: '弦乐拨奏',
  blip: '脉冲音',
  tick: '节拍器',
  click: '计数器',
  pluck: '拨弦',
  harp: '竖琴',
  bell: '钟琴',
  chime: '风铃',
};

interface WorkbenchCardProps {
  spec: WorkbenchSpec;
  audit?: WorkbenchAuditReport;
  result?: WorkbenchRenderResult;
  job?: { stage: string; p: number };
  queued: boolean;
  error?: string;
  selected: boolean;
  publishedLocal: boolean;
  channelStatus: WorkbenchChannelStatus;
  downloaded: boolean;
  busy: boolean;
  onToggleSelect: () => void;
  onTogglePublishedLocal: () => void;
  onOpenPreview: () => void;
  onGenerateDownload: () => void;
  onEnqueueReview: () => void;
  onEnqueueSchedule: () => void;
  onRenderAndSync: () => void;
  onReroll: () => void;
  onMarkDownloaded: () => void;
}

export const WorkbenchCard: React.FC<WorkbenchCardProps> = ({
  spec,
  audit,
  result,
  job,
  queued,
  error,
  selected,
  publishedLocal,
  channelStatus,
  downloaded,
  busy,
  onToggleSelect,
  onTogglePublishedLocal,
  onOpenPreview,
  onGenerateDownload,
  onEnqueueReview,
  onEnqueueSchedule,
  onRenderAndSync,
  onReroll,
  onMarkDownloaded,
}) => {
  const [showCopy, setShowCopy] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [saveMsg, setSaveMsg] = useState('');

  const theme = themeOf(spec);
  const voiceKey = extractInstrument({
    id: spec.id,
    baseId: spec.id.split('~')[0],
    engine: spec.engine,
    params: spec.params,
    seed: spec.seed,
    theme: spec.theme,
    category: spec.category,
    catLabel: spec.catLabel,
    title: spec.title,
    hook: spec.hook,
    description: spec.description,
    tags: spec.tags,
    filename: spec.filename,
    durationSec: 25,
  });
  const voiceLabel = VOICE_LABELS[voiceKey] ?? voiceKey;

  const fname = `${spec.filename}.${result?.ext ?? 'mp4'}`;
  const mb = result ? (result.size / 1048576).toFixed(1) : '';
  const serverMb = channelStatus.mediaBytes ? (channelStatus.mediaBytes / 1048576).toFixed(1) : '';
  const fullCopy = `${spec.title}\n\n${spec.description}\n\nTags: ${spec.tags.join(', ')}`;
  const isPublished = publishedLocal || channelStatus.status === 'published';

  const handleCopy = async (key: string, text: string) => {
    const ok = await copyText(text);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1300);
    }
  };

  return (
    <article
      className={`flex flex-col gap-2 rounded-lg border bg-white p-2.5 transition-colors ${
        selected
          ? 'border-slate-900 ring-1 ring-slate-900/20'
          : 'border-slate-200 hover:border-slate-300'
      } ${isPublished ? 'opacity-65' : ''}`}
    >
      {/* Compact Header Row above 9:16 Artwork */}
      <div className="flex items-center justify-between gap-1.5 text-[11px]">
        <label className="inline-flex cursor-pointer items-center gap-1 font-medium text-slate-700 hover:text-slate-900">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`选择 ${spec.title}`}
            className="h-3.5 w-3.5 accent-slate-900"
          />
          <span>选择</span>
        </label>
        <span className="truncate font-medium text-slate-500">
          {CAT_BADGES[spec.category] ?? spec.catLabel}
        </span>
      </div>

      {/* Unobstructed 9:16 Artwork Box */}
      <WorkbenchThumb spec={spec} onOpen={onOpenPreview} />

      {/* Title */}
      <h3 className="line-clamp-2 min-h-[2.45rem] text-[13px] font-semibold leading-snug text-slate-900">
        {spec.title}
      </h3>

      {/* Aesthetic / Instrument & Strict Audit Row */}
      <div className="flex items-center justify-between gap-1.5 text-[10px]">
        <span className="truncate font-mono text-slate-500" title={`引擎 ${spec.engine} · ${theme.labelZh} · 音色 ${voiceLabel}`}>
          {theme.labelZh} · {voiceLabel}
        </span>
        {audit && (
          <span
            className={`shrink-0 font-mono font-semibold tabular-nums ${
              audit.passed ? 'text-emerald-700' : 'text-amber-700'
            }`}
            title={
              audit.passed
                ? `已通过全部严审（新颖度 ${audit.novelty.score} / 文案 ${audit.metadata.score}）`
                : `未过审原因：${audit.reasons.join('；')}`
            }
          >
            {audit.passed ? `✓ 严审 ${audit.score}` : `⚠ ${audit.reasons[0]?.slice(0, 12) ?? '待调整'}`}
          </span>
        )}
      </div>

      {/* Primary Action or Progress / Result */}
      {job ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-slate-700">
            <span>{job.stage}</span>
            <span className="font-mono tabular-nums">{Math.round(job.p * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-slate-900 transition-all"
              style={{ width: `${Math.round(job.p * 100)}%` }}
            />
          </div>
        </div>
      ) : queued ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-center text-xs text-slate-500">
          排队等待生成中…
        </div>
      ) : result ? (
        <div className="flex flex-col gap-1.5">
          <a
            href={result.url}
            download={fname}
            onClick={onMarkDownloaded}
            className="inline-flex items-center justify-center gap-1 rounded-md bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800"
          >
            ⬇ 下载 {result.ext.toUpperCase()} ({mb} MB)
          </a>
          <div className="grid grid-cols-2 gap-1">
            <button
              type="button"
              onClick={async () => {
                try {
                  await saveWithPicker(result.blob, fname, result.ext);
                  onMarkDownloaded();
                  setSaveMsg('已保存到本地');
                } catch (err) {
                  const m = err instanceof Error ? err.message : '';
                  if (!m.includes('abort')) setSaveMsg(`另存为不可用: ${m}`);
                }
              }}
              className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50"
            >
              另存为…
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onRenderAndSync}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-40"
            >
              存入生产线
            </button>
          </div>
          <div className="text-center font-mono text-[10px] text-slate-500">{result.note}</div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onGenerateDownload}
          className="inline-flex w-full items-center justify-center gap-1 rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          ⬇ 生成并下载
        </button>
      )}

      {error && (
        <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
          失败：{error}
        </div>
      )}
      {saveMsg && <div className="text-[11px] text-emerald-700">{saveMsg}</div>}

      {/* 4-column quick copy row */}
      <div className="grid grid-cols-4 gap-1">
        <button
          type="button"
          onClick={() => handleCopy('title', spec.title)}
          className="rounded border border-slate-200 bg-slate-50 py-1 text-[11px] text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          {copiedKey === 'title' ? '✓标题' : '标题'}
        </button>
        <button
          type="button"
          onClick={() => handleCopy('desc', spec.description)}
          className="rounded border border-slate-200 bg-slate-50 py-1 text-[11px] text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          {copiedKey === 'desc' ? '✓描述' : '描述'}
        </button>
        <button
          type="button"
          onClick={() => handleCopy('tags', spec.tags.join(', '))}
          className="rounded border border-slate-200 bg-slate-50 py-1 text-[11px] text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          {copiedKey === 'tags' ? '✓标签' : '标签'}
        </button>
        <button
          type="button"
          onClick={() => handleCopy('all', fullCopy)}
          className="rounded border border-slate-200 bg-slate-50 py-1 text-[11px] text-slate-700 hover:bg-slate-100 hover:text-slate-900"
        >
          {copiedKey === 'all' ? '✓全部' : '全部'}
        </button>
      </div>

      {/* Bottom utility row + Shorts Studio channel pipeline status */}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-1 border-t border-slate-100 pt-1.5 text-[11px] text-slate-500">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onReroll}
            title="切换画风（白底印刷/蓝图/示波器）、音色（木琴/拇指琴/钢片琴/电钢/拨奏）、音阶调性与去重文案，直至通过严格审校"
            className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900"
          >
            🔄 换风蜕变
          </button>
          <button
            type="button"
            onClick={() => setShowCopy((v) => !v)}
            className="rounded px-1 py-0.5 hover:bg-slate-100 hover:text-slate-900"
          >
            {showCopy ? '收起' : '看文案'}
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          {channelStatus.inChannel ? (
            <span
              className={`font-medium ${
                channelStatus.status === 'published'
                  ? 'text-emerald-700'
                  : channelStatus.status === 'in_review'
                    ? 'text-amber-700'
                    : 'text-sky-700'
              }`}
              title={channelStatus.mediaReady ? `已存入生产线存储 ${serverMb}MB` : '已接入频道生产线'}
            >
              {channelStatus.status === 'published'
                ? '✓ 已发布'
                : channelStatus.mediaReady
                  ? `✓ 成片 ${serverMb}M`
                  : channelStatus.status === 'in_review'
                    ? '✓ 审校中'
                    : '✓ 已排期'}
            </span>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={onEnqueueReview}
                title="送入「制作与渲染」和「审核队列」"
                className="rounded px-1 py-0.5 font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
              >
                +送审
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={onEnqueueSchedule}
                title="直接加入「排期与配额」"
                className="rounded px-1 py-0.5 font-medium text-sky-700 hover:bg-sky-50 hover:text-sky-900 disabled:opacity-40"
              >
                +排期
              </button>
            </>
          )}
          <label className="inline-flex cursor-pointer items-center gap-1 text-slate-500 hover:text-slate-900">
            <input
              type="checkbox"
              checked={isPublished}
              onChange={onTogglePublishedLocal}
              className="h-3 w-3 accent-emerald-600"
            />
            <span>已发布</span>
          </label>
        </div>
      </div>

      {downloaded && !result && !channelStatus.mediaReady && (
        <div className="text-[10px] text-emerald-700">✓ 已本地下载</div>
      )}

      {showCopy && (
        <div className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50 p-2 text-[11px] text-slate-700">
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap font-sans leading-relaxed">
            {spec.description}
          </pre>
          <div className="text-[10px] text-slate-500">Tags: {spec.tags.join(', ')}</div>
        </div>
      )}
    </article>
  );
};
