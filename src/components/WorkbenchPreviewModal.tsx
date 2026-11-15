import React, { useEffect, useRef, useState } from 'react';
import type { WorkbenchChannelStatus } from '../workbench/bridge';
import { copyText } from '../workbench/engine/download';
import { startPreview } from '../workbench/engine/preview';
import type { VideoSpec as WorkbenchSpec } from '../workbench/engine/types';
import { buildScene, themeOf } from '../workbench/scenes';

const CAT_LABELS: Record<string, string> = {
  music: '🎵 旋律·球体奏乐',
  sort: '🌈 小球分拣',
  algo: '🔊 排序算法之声',
  phys: '⚛️ 物理现象',
  math: '📐 数学图形',
};

interface WorkbenchPreviewModalProps {
  spec: WorkbenchSpec;
  channelTitle: string;
  storageHint: string;
  channelStatus: WorkbenchChannelStatus;
  busy: boolean;
  onClose: () => void;
  onGenerateDownload: () => void;
  onRenderAndUpload: () => void;
  onEnqueueReview: () => void;
  onEnqueueSchedule: () => void;
}

export const WorkbenchPreviewModal: React.FC<WorkbenchPreviewModalProps> = ({
  spec,
  channelTitle,
  storageHint,
  channelStatus,
  busy,
  onClose,
  onGenerateDownload,
  onRenderAndUpload,
  onEnqueueReview,
  onEnqueueSchedule,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [sound, setSound] = useState(true);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    let handle: { stop: () => void } | null = null;
    let dead = false;
    const timer = setTimeout(() => {
      if (dead || !canvasRef.current) return;
      try {
        const scene = buildScene(spec);
        setDuration(scene.duration);
        handle = startPreview(canvasRef.current, scene, themeOf(spec), spec.hook, sound);
      } catch (err) {
        console.error('Workbench preview error:', err);
      }
      setLoading(false);
    }, 30);

    return () => {
      dead = true;
      clearTimeout(timer);
      handle?.stop();
    };
  }, [spec, sound]);

  const handleCopy = async (key: string, value: string) => {
    const ok = await copyText(value);
    if (ok) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1400);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`预览 ${spec.title}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[94vh] w-full max-w-4xl flex-col gap-5 overflow-auto rounded-xl border border-slate-200 bg-white p-5 text-slate-900 shadow-2xl md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative mx-auto aspect-[9/16] h-[68vh] max-h-[720px] shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-950">
          <canvas
            ref={canvasRef}
            width={540}
            height={960}
            data-testid="workbench-preview-canvas"
            className="h-full w-full"
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 text-xs text-white">
              正在构建音画仿真…
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3.5 text-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-sky-700">
                {CAT_LABELS[spec.category] ?? spec.catLabel}
                {duration > 0 && ` · ${duration.toFixed(1)}s`}
              </div>
              <h3 className="text-lg font-bold leading-snug text-slate-900">{spec.title}</h3>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭预览"
              className="shrink-0 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              关闭 ✕
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleCopy('title', spec.title)}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {copiedKey === 'title' ? '✓ 已复制标题' : '复制标题'}
            </button>
            <button
              type="button"
              onClick={() => handleCopy('desc', spec.description)}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {copiedKey === 'desc' ? '✓ 已复制描述' : '复制描述'}
            </button>
            <button
              type="button"
              onClick={() => handleCopy('tags', spec.tags.join(', '))}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {copiedKey === 'tags' ? '✓ 已复制标签' : '复制标签'}
            </button>
            <button
              type="button"
              onClick={() => setSound((s) => !s)}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {sound ? '🔊 声音开' : '🔇 静音'}
            </button>
          </div>

          <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3.5 font-sans text-xs leading-relaxed text-slate-700">
            {spec.description}
          </pre>

          <div className="text-xs leading-relaxed text-slate-500">
            标签 : {spec.tags.join(', ')}
          </div>

          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
            统一存储位置：<span className="font-mono text-slate-900">{storageHint}</span>（与主生产线 Render/合集共享）
          </div>

          <div className="mt-auto space-y-2 pt-1">
            <button
              type="button"
              onClick={() => {
                onGenerateDownload();
                onClose();
              }}
              className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
            >
              ⬇ 生成并下载到本地 MP4
            </button>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={busy}
                title={`送入「${channelTitle}」制作与审核队列`}
                onClick={() => {
                  onEnqueueReview();
                  onClose();
                }}
                className="truncate rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
              >
                {channelStatus.inChannel ? '✓ 已在生产线' : '送入审校队列'}
              </button>
              <button
                type="button"
                disabled={busy}
                title={`直接加入「${channelTitle}」排期`}
                onClick={() => {
                  onEnqueueSchedule();
                  onClose();
                }}
                className="truncate rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
              >
                {channelStatus.status === 'scheduled' ? '✓ 已排期' : '直接加入排期'}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onRenderAndUpload();
                  onClose();
                }}
                className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800 whitespace-nowrap hover:bg-sky-100 disabled:opacity-40"
              >
                渲染并存入生产线存储
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
