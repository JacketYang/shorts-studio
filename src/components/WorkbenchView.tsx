import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { diversifyMetadataLocal } from '../domain/metadata-guard';
import type { StudioState } from '../types/ui';
import {
  matchWorkbenchChannelStatus,
  toWorkbenchEnqueueItem,
  type WorkbenchChannelStatus,
} from '../workbench/bridge';
import { buildCatalog, CATEGORIES } from '../workbench/catalog/catalog';
import {
  auditWorkbenchSpecStrict,
  buildAuditContextFromHistory,
  findPassingVariant,
  pickDiversePassBatch,
  type WorkbenchAuditReport,
} from '../workbench/diversity';
import { buildZip, saveUrl } from '../workbench/engine/download';
import { renderVideo } from '../workbench/engine/render';
import type { VideoSpec as WorkbenchSpec } from '../workbench/engine/types';
import { buildScene, themeOf } from '../workbench/scenes';
import { WorkbenchCard, type WorkbenchRenderResult } from './WorkbenchCard';
import { WorkbenchPreviewModal } from './WorkbenchPreviewModal';

interface WorkbenchViewProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
}

const CAT_LABELS: Record<string, string> = {
  music: '🎵 旋律·球体奏乐',
  sort: '🌈 小球分拣',
  algo: '🔊 排序算法之声',
  phys: '⚛️ 物理现象',
  math: '📐 数学图形',
};

const loadSet = (key: string): string[] => {
  try {
    return JSON.parse(localStorage.getItem(key) || '[]') as string[];
  } catch {
    return [];
  }
};

const saveSet = (key: string, val: Iterable<string>) => {
  try {
    localStorage.setItem(key, JSON.stringify([...val]));
  } catch {
    // ignore storage quota errors
  }
};

function buildPublishSummaryText(specs: WorkbenchSpec[], extOf: (s: WorkbenchSpec) => string): string {
  return specs
    .map(
      (s, i) =>
        `#${i + 1}  文件：${s.filename}.${extOf(s)}\n标题：${s.title}\n\n描述：\n${s.description}\n\n标签：${s.tags.join(', ')}\n`
    )
    .join('\n' + '='.repeat(60) + '\n\n');
}

export const WorkbenchView: React.FC<WorkbenchViewProps> = ({ state, onRefresh, onNavigate }) => {
  const recipes = useMemo(() => buildCatalog(), []);
  const [variants, setVariants] = useState<Record<string, number>>({});
  const [metaOverrides, setMetaOverrides] = useState<
    Record<string, { title: string; hook: string; description: string; tags: string[] }>
  >({});
  const [specOverrides, setSpecOverrides] = useState<Record<string, Partial<WorkbenchSpec>>>({});
  const [diversifyRound, setDiversifyRound] = useState(0);
  const [aiBatching, setAiBatching] = useState(false);

  const specs = useMemo(
    () =>
      recipes.map((r) => {
        const base = r.spec(variants[r.id] ?? 0);
        const ov = metaOverrides[base.id];
        const spOv = specOverrides[base.id];
        return {
          ...base,
          ...(ov ?? {}),
          ...(spOv ?? {}),
        };
      }),
    [recipes, variants, metaOverrides, specOverrides]
  );

  const [cat, setCat] = useState('all');
  const [query, setQuery] = useState('');
  const [hideDone, setHideDone] = useState(false);
  const [resolution, setResolution] = useState<'1080' | '720'>('1080');
  const [fps, setFps] = useState<30 | 60>(30);
  const [limit, setLimit] = useState(36);
  const [showInsights, setShowInsights] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [doneLocal, setDoneLocal] = useState<Set<string>>(() => new Set(loadSet('wb_done')));
  const [downloaded, setDownloaded] = useState<Set<string>>(() => new Set(loadSet('wb_downloaded')));
  const [results, setResults] = useState<Record<string, WorkbenchRenderResult>>({});
  const [jobs, setJobs] = useState<Record<string, { stage: string; p: number }>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [queued, setQueued] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);
  const [statusNotice, setStatusNotice] = useState<{ text: string; targetTab: string; targetLabel: string } | null>(null);

  const [previewSpec, setPreviewSpec] = useState<WorkbenchSpec | null>(null);
  const [zip, setZip] = useState<{ url: string; name: string; n: number; mb: string } | null>(null);
  const [zipping, setZipping] = useState(false);

  const queueRef = useRef<{ spec: WorkbenchSpec; autoDownload: boolean; uploadToChannel: boolean }[]>([]);
  const runningRef = useRef(false);
  const cancelTokenRef = useRef({ cancelled: false });
  const optsRef = useRef({ resolution, fps, channelId: state.channel.id });
  optsRef.current = { resolution, fps, channelId: state.channel.id };

  const storageHint =
    state.storage_config.driver === 'local'
      ? `${state.storage_config.local_dir}/renders`
      : `${state.storage_config.driver.toUpperCase()} 云端存储`;

  const statusMap = useMemo(() => {
    const map = new Map<string, WorkbenchChannelStatus>();
    for (const s of specs) {
      const baseId = s.id.split('~')[0];
      map.set(s.id, matchWorkbenchChannelStatus(s.id, baseId, state.specs, state.renders, state.videos));
    }
    return map;
  }, [specs, state.specs, state.renders, state.videos]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { all: specs.length };
    for (const s of specs) {
      counts[s.category] = (counts[s.category] ?? 0) + 1;
    }
    return counts;
  }, [specs]);

  const isMarkedDone = useCallback(
    (s: WorkbenchSpec) => doneLocal.has(s.id) || statusMap.get(s.id)?.status === 'published',
    [doneLocal, statusMap]
  );

  const inChannelCount = useMemo(
    () => specs.filter((s) => statusMap.get(s.id)?.inChannel).length,
    [specs, statusMap]
  );

  const publishedCount = useMemo(
    () => specs.filter((s) => isMarkedDone(s)).length,
    [specs, isMarkedDone]
  );

  const auditCtx = useMemo(
    () =>
      buildAuditContextFromHistory({
        channelProfile: state.profile,
        specs: state.specs,
        renders: state.renders,
        videos: state.videos,
        remoteTitles: state.remote_videos.filter((v) => !v.is_legacy).map((v) => v.title),
      }),
    [state.profile, state.specs, state.renders, state.videos, state.remote_videos]
  );

  const auditMap = useMemo(() => {
    const map = new Map<string, WorkbenchAuditReport>();
    for (const s of specs) {
      map.set(s.id, auditWorkbenchSpecStrict(s, auditCtx));
    }
    return map;
  }, [specs, auditCtx]);

  const strictPassCount = useMemo(() => {
    let n = 0;
    for (const rep of auditMap.values()) {
      if (rep.passed) n++;
    }
    return n;
  }, [auditMap]);

  const markDownloaded = useCallback((id: string) => {
    setDownloaded((prev) => {
      const next = new Set(prev);
      next.add(id);
      saveSet('wb_downloaded', next);
      return next;
    });
  }, []);

  const toggleDoneLocal = (id: string) => {
    setDoneLocal((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveSet('wb_done', next);
      return next;
    });
  };

  const enqueueItemsToServer = useCallback(
    async (targetSpecs: WorkbenchSpec[], autoSchedule: boolean, silent = false): Promise<Map<string, string>> => {
      const payloadItems = targetSpecs.map((s) => {
        const scene = buildScene(s);
        return toWorkbenchEnqueueItem(s, scene.duration);
      });
      const res = await fetch('/api/workbench/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: optsRef.current.channelId,
          items: payloadItems,
          autoSchedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? '入库失败');
      }
      const renderByWbId = new Map<string, string>();
      if (Array.isArray(data.entries)) {
        for (const entry of data.entries as Array<{ workbenchId: string; renderId: string }>) {
          renderByWbId.set(entry.workbenchId, entry.renderId);
        }
      }
      if (!silent) {
        setStatusNotice({
          text: autoSchedule
            ? `已将 ${data.createdCount} 条工坊创意加入「${state.channel.title}」排期队列` +
              (data.skippedCount > 0 ? `（跳过 ${data.skippedCount} 条已存在）` : '')
            : `已将 ${data.createdCount} 条工坊创意送入「${state.channel.title}」制作与审核队列` +
              (data.skippedCount > 0 ? `（跳过 ${data.skippedCount} 条已存在）` : ''),
          targetTab: autoSchedule ? 'calendar' : 'studio',
          targetLabel: autoSchedule ? '前往「排期与配额」' : '前往「制作与渲染」',
        });
      }
      await onRefresh();
      return renderByWbId;
    },
    [onRefresh, state.channel.title]
  );

  const handleBatchEnqueue = async (targetSpecs: WorkbenchSpec[], autoSchedule: boolean) => {
    if (targetSpecs.length === 0) return;
    setEnqueuing(true);
    setStatusNotice(null);
    try {
      await enqueueItemsToServer(targetSpecs, autoSchedule, false);
    } catch (err) {
      setStatusNotice({
        text: err instanceof Error ? err.message : '批量入库失败',
        targetTab: 'studio',
        targetLabel: '查看队列',
      });
    } finally {
      setEnqueuing(false);
    }
  };

  const handleLocalBatchDiversify = (targets: WorkbenchSpec[]) => {
    if (targets.length === 0) return;
    const nextRound = diversifyRound + 1;
    setDiversifyRound(nextRound);
    const seenTitles = [
      ...state.specs.map((s) => s.spec.publish.title),
      ...state.remote_videos.filter((v) => !v.is_legacy).map((v) => v.title),
    ];
    const updates: Record<string, { title: string; hook: string; description: string; tags: string[] }> = {};
    for (const s of targets) {
      const res = diversifyMetadataLocal({
        id: s.id,
        engine: s.engine,
        category: s.category,
        baseTitle: s.title,
        hookLine: s.hook,
        description: s.description,
        tags: s.tags,
        params: s.params,
        seed: s.seed,
        variant: nextRound,
        recentTitles: seenTitles,
        forbiddenTopics: state.profile.brand.forbidden_topics,
      });
      updates[s.id] = {
        title: res.title,
        hook: res.hookLine,
        description: res.description,
        tags: res.tags,
      };
      seenTitles.unshift(res.title);
    }
    setMetaOverrides((prev) => ({ ...prev, ...updates }));
    setStatusNotice({
      text: `已用「无 AI 本地防重引擎」为 ${targets.length} 条创意重新生成去重且合规的标题、钩子与 3-4 标签描述。`,
      targetTab: 'channels',
      targetLabel: '如需 AI 语义润色可点右方按钮或去设置模型',
    });
  };

  const handleSmartDiversePick = () => {
    const excludeBaseIds = new Set(
      specs
        .filter((s) => isMarkedDone(s) || statusMap.get(s.id)?.inChannel)
        .map((s) => s.id.split('~')[0])
    );
    const batch = pickDiversePassBatch(recipes, 7, auditCtx, {
      currentVariants: variants,
      excludeBaseIds,
    });
    if (batch.picks.length === 0) {
      setStatusNotice({
        text: '当前频道历史冲突密集，暂未凑齐无冲突批次，请对列表条目点「🔄 换风蜕变」或先清理队列。',
        targetTab: 'studio',
        targetLabel: '查看制作与审核队列',
      });
      return;
    }
    if (Object.keys(batch.variantsUpdate).length > 0) {
      setVariants((prev) => ({ ...prev, ...batch.variantsUpdate }));
    }
    if (Object.keys(batch.metaOverridesUpdate).length > 0) {
      setMetaOverrides((prev) => ({ ...prev, ...batch.metaOverridesUpdate }));
    }
    setSelected(new Set(batch.picks.map((p) => p.spec.id)));
    const avgScore = Math.round(
      batch.picks.reduce((sum, item) => sum + item.audit.score, 0) / batch.picks.length
    );
    setStatusNotice({
      text: `已跨 5 大分类与浅/深画风自动严选并勾选 ${batch.picks.length} 条全过审创意（平均严审分 ${avgScore}，全部满足去重与无 AI Slop 要求）。`,
      targetTab: 'studio',
      targetLabel: '可直接点「送入审校队列」',
    });
  };

  const handleRerollSpec = (s: WorkbenchSpec) => {
    const base = s.id.split('~')[0];
    const recipe = recipes.find((r) => r.id === base);
    if (!recipe) {
      setVariants((v) => ({ ...v, [base]: (v[base] ?? 0) + 1 }));
      return;
    }
    const curV = variants[base] ?? 0;
    const res = findPassingVariant(recipe, curV, auditCtx);
    setVariants((v) => ({ ...v, [base]: res.variant }));
    if (res.metaOverride) {
      const ov = res.metaOverride;
      setMetaOverrides((prev) => ({ ...prev, [res.spec.id]: ov }));
    }
    setSelected((prev) => {
      if (!prev.has(s.id)) return prev;
      const next = new Set(prev);
      next.delete(s.id);
      next.add(res.spec.id);
      return next;
    });
  };

  const handleAiBatchRewrite = async (targets: WorkbenchSpec[]) => {
    if (targets.length === 0) return;
    const capped = targets.slice(0, 30);
    setAiBatching(true);
    setStatusNotice(null);
    try {
      const res = await fetch('/api/ai/rewrite-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          items: capped.map((s) => ({
            id: s.id,
            engine: s.engine,
            category: s.category,
            title: s.title,
            hookLine: s.hook,
            description: s.description,
            tags: s.tags,
            params: s.params,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatusNotice({
          text: data.error ?? 'AI 批量改写失败（请先配置服务端 AI Key）',
          targetTab: 'channels',
          targetLabel: '前往「频道与设置」配置 AI 密钥/提示词',
        });
        return;
      }
      const updates: Record<string, { title: string; hook: string; description: string; tags: string[] }> = {};
      for (const item of data.items ?? []) {
        updates[item.id] = {
          title: item.title,
          hook: item.hookLine,
          description: item.description,
          tags: item.tags,
        };
      }
      setMetaOverrides((prev) => ({ ...prev, ...updates }));
      await onRefresh();
      setStatusNotice({
        text: `AI 批量改写 ${capped.length} 条完成（模型 ${data.model} · 仅花费 $${Number(data.cost_usd ?? 0).toFixed(5)} · 已过合规守卫）`,
        targetTab: 'channels',
        targetLabel: '调整改写提示词',
      });
    } catch (err) {
      setStatusNotice({
        text: err instanceof Error ? err.message : '网络请求失败',
        targetTab: 'channels',
        targetLabel: '查看 AI 设置',
      });
    } finally {
      setAiBatching(false);
    }
  };

  const generateOne = useCallback(
    async (spec: WorkbenchSpec, autoDownload: boolean, uploadToChannel: boolean) => {
      const { resolution: rs, fps: f } = optsRef.current;
      const width = rs === '1080' ? 1080 : 720;
      const height = rs === '1080' ? 1920 : 1280;
      setErrors((e) => {
        const next = { ...e };
        delete next[spec.id];
        return next;
      });
      setJobs((j) => ({ ...j, [spec.id]: { stage: '构建音画场景', p: 0 } }));
      try {
        await new Promise((r) => setTimeout(r, 20));
        const scene = buildScene(spec);
        const out = await renderVideo(scene, themeOf(spec), spec.hook, {
          width,
          height,
          fps: f,
          bitrate: (rs === '1080' ? 7e6 : 3.5e6) * (f === 60 ? 1.4 : 1),
          token: cancelTokenRef.current,
          onProgress: (p, stage) => setJobs((j) => ({ ...j, [spec.id]: { stage, p } })),
        });

        const url = URL.createObjectURL(out.blob);
        setResults((r) => ({
          ...r,
          [spec.id]: { blob: out.blob, url, ext: out.ext, size: out.blob.size, note: out.note },
        }));

        if (uploadToChannel) {
          setJobs((j) => ({ ...j, [spec.id]: { stage: '写入生产线统一存储', p: 0.99 } }));
          const renderMap = await enqueueItemsToServer([spec], false, true);
          const renderId = renderMap.get(spec.id);
          if (renderId) {
            const upRes = await fetch(`/api/renders/${renderId}/upload-media?ext=${out.ext}`, {
              method: 'POST',
              headers: { 'Content-Type': out.ext === 'webm' ? 'video/webm' : 'video/mp4' },
              body: out.blob,
            });
            const upData = await upRes.json().catch(() => ({}));
            if (!upRes.ok) {
              throw new Error(upData.error ?? '保存成片到生产线存储失败');
            }
            await onRefresh();
            const savedLoc = upData.storagePath || storageHint;
            setStatusNotice({
              text: `已完成渲染并存入生产线存储 (${savedLoc})：「${spec.title}」（已进入制作与审校队列）`,
              targetTab: 'studio',
              targetLabel: '前往「制作与渲染」查看',
            });
          }
        }

        if (autoDownload) {
          saveUrl(url, `${spec.filename}.${out.ext}`);
          markDownloaded(spec.id);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '渲染失败';
        if (msg !== 'cancelled') {
          setErrors((er) => ({ ...er, [spec.id]: msg }));
        }
      } finally {
        setJobs((j) => {
          const next = { ...j };
          delete next[spec.id];
          return next;
        });
      }
    },
    [enqueueItemsToServer, markDownloaded, onRefresh, storageHint]
  );

  const pumpQueue = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    while (queueRef.current.length > 0) {
      const job = queueRef.current.shift()!;
      cancelTokenRef.current = { cancelled: false };
      await generateOne(job.spec, job.autoDownload, job.uploadToChannel);
      setQueued((qs) => {
        const next = new Set(qs);
        next.delete(job.spec.id);
        return next;
      });
    }
    runningRef.current = false;
    setBusy(false);
  }, [generateOne]);

  const enqueueRender = useCallback(
    (spec: WorkbenchSpec, autoDownload: boolean, uploadToChannel: boolean) => {
      if (queueRef.current.some((j) => j.spec.id === spec.id)) return;
      queueRef.current.push({ spec, autoDownload, uploadToChannel });
      setQueued((qs) => new Set(qs).add(spec.id));
      void pumpQueue();
    },
    [pumpQueue]
  );

  const cancelAllRenders = () => {
    cancelTokenRef.current.cancelled = true;
    const ids = queueRef.current.map((j) => j.spec.id);
    queueRef.current = [];
    setQueued((qs) => {
      const next = new Set(qs);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const filtered = useMemo(() => {
    const kw = query.trim().toLowerCase();
    return specs.filter((s) => {
      if (cat !== 'all' && s.category !== cat) return false;
      if (kw && !s.title.toLowerCase().includes(kw) && !s.engine.toLowerCase().includes(kw)) return false;
      if (hideDone && (isMarkedDone(s) || statusMap.get(s.id)?.inChannel)) return false;
      return true;
    });
  }, [specs, cat, query, hideDone, isMarkedDone, statusMap]);

  useEffect(() => {
    setLimit(36);
  }, [cat, query, hideDone]);

  const shown = filtered.slice(0, limit);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedSpecs = specs.filter((s) => selected.has(s.id));
  const selectedNotInChannel = selectedSpecs.filter((s) => !statusMap.get(s.id)?.inChannel);
  const doneSelected = selectedSpecs.filter((s) => results[s.id]);
  const totalDone = Object.keys(results).length;

  const handleMakeZip = async () => {
    setZipping(true);
    try {
      const list = doneSelected.length > 0 ? doneSelected : specs.filter((s) => results[s.id]);
      const files: { name: string; blob?: Blob; text?: string }[] = [];
      for (const s of list) {
        const r = results[s.id];
        files.push({ name: `${s.filename}.${r.ext}`, blob: r.blob });
        files.push({ name: `${s.filename}.txt`, text: `${s.title}\n\n${s.description}\n\nTags: ${s.tags.join(', ')}\n` });
      }
      files.push({ name: '发布文案汇总.txt', text: buildPublishSummaryText(list, (s) => results[s.id].ext) });
      const blob = await buildZip(files);
      if (zip?.url) URL.revokeObjectURL(zip.url);
      const url = URL.createObjectURL(blob);
      const name = `shorts-${list.length}-${new Date().toISOString().slice(0, 10)}.zip`;
      setZip({ url, name, n: list.length, mb: (blob.size / 1048576).toFixed(1) });
      saveUrl(url, name);
      list.forEach((s) => markDownloaded(s.id));
    } finally {
      setZipping(false);
    }
  };

  const handleExportTxt = () => {
    const list = selectedSpecs.length > 0 ? selectedSpecs : filtered;
    const text = buildPublishSummaryText(list, (s) => results[s.id]?.ext ?? 'mp4');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    saveUrl(url, `发布文案-${list.length}条.txt`);
  };

  const activeJobId = Object.keys(jobs)[0];
  const activeJob = activeJobId ? jobs[activeJobId] : undefined;
  const activeJobSpec = activeJobId ? specs.find((s) => s.id === activeJobId) : undefined;

  return (
    <div className="space-y-4 text-slate-900">
      {/* Clean Light Header */}
      <header className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900">
            <span aria-hidden="true">🎬</span>
            <span>Shorts 爆款创意视频工坊（19 种音画引擎）</span>
          </h2>
          <p className="text-xs text-slate-600">
            共 <span className="font-mono font-semibold text-slate-900">{specs.length}</span> 条竖屏创意（1080×1920 · MP4 · 带音乐）· 成片统一存入{' '}
            <span className="font-mono font-medium text-slate-800">{storageHint}</span>
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-800">
            严审过检 <span className="font-semibold">{strictPassCount}/{specs.length}</span>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            已生成 <span className="font-semibold text-slate-900">{totalDone}</span>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            已下载 <span className="font-semibold text-emerald-700">{downloaded.size}</span>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            已入生产线 <span className="font-semibold text-sky-700">{inChannelCount}</span>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600">
            已发布 <span className="font-semibold text-amber-700">{publishedCount}</span>
          </div>
        </div>
      </header>

      {/* Collapsible Channel Data Insights Drawer */}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowInsights((v) => !v)}
          aria-expanded={showInsights}
          className="flex w-full items-center justify-between px-4 py-3 text-left text-xs font-medium text-slate-800 transition-colors hover:bg-slate-50"
        >
          <span>📊 你的频道数据洞察（本批 215+ 创意的设计依据）</span>
          <span className="text-[11px] text-slate-400">{showInsights ? '▲' : '▼'}</span>
        </button>
        {showInsights && (
          <div className="grid grid-cols-1 gap-4 border-t border-slate-100 px-4 py-3.5 text-xs leading-relaxed text-slate-600 md:grid-cols-2">
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                <strong className="text-slate-900">总播放 29,060</strong>，前几名全是“球体 / 物理 + 旋律”：Canon in D 木琴球 1,896、Ode to Joy 1,544、Für Elise 1,105、山魔王越来越快 1,079。→ 旋律类做了最多（约 99 条）。
              </li>
              <li>
                <strong className="text-slate-900">数字 + 悬念标题表现好</strong>：40 Pendulums 1,562、16 Balls 4 Bins 系列都过千、Pi 碰撞 1,293、排序之声 1,269。→ 小球分拣 / 钟摆 / 圆周率 / 排序算法都保留并扩展。
              </li>
              <li>
                完播率高的片子时长多在 <strong className="text-slate-900">13–45 秒</strong>，且结尾有“揭晓”。本批视频全部 14–35 秒，并带最终结果画面。
              </li>
            </ul>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>
                纯讲解题（汤放冰箱 24、月球为什么不掉 33、借力飞行 35）几乎没人看 → <strong className="text-slate-900">本批不再出讲解型</strong>，全部是“看了就停不下来”的可视化。
              </li>
              <li>
                同一玩法重复发太多会互相抢流量 → 本批用 <strong className="text-slate-900">19 种不同引擎 × 多种布局/配色/曲目</strong>，并有“🎲 换一版”随时再出变体。
              </li>
              <li>
                可勾选任意创意送入「{state.channel.title}」的<strong className="text-slate-900">制作与审核队列</strong>，或直接在「创意库 → 自定义制作」中微调工坊引擎参数。
              </li>
            </ul>
          </div>
        )}
      </div>

      {/* Category Filter, Search & Batch Toolbar */}
      <div className="space-y-2.5 rounded-lg border border-slate-200 bg-white p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex flex-wrap max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setCat('all')}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                cat === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              全部 ({categoryCounts.all ?? 0})
            </button>
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCat(c.id)}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                  cat === c.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {CAT_LABELS[c.id] ?? c.label} ({categoryCounts[c.id] ?? 0})
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题或引擎…"
              aria-label="搜索工坊视频"
              className="w-40 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none sm:w-44"
            />
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-slate-600 whitespace-nowrap">
              <input
                type="checkbox"
                checked={hideDone}
                onChange={(e) => setHideDone(e.target.checked)}
                className="h-3.5 w-3.5 accent-slate-900"
              />
              <span>隐藏已入库/已发布</span>
            </label>
          </div>
        </div>

        {/* Batch toolbar */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2.5 text-xs">
          <select
            aria-label="导出分辨率"
            value={resolution}
            onChange={(e) => setResolution(e.target.value as '1080' | '720')}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          >
            <option value="1080">1080×1920 高清</option>
            <option value="720">720×1280 快速</option>
          </select>
          <select
            aria-label="导出帧率"
            value={fps}
            onChange={(e) => setFps(Number(e.target.value) as 30 | 60)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-800 focus:border-slate-900 focus:outline-none"
          >
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>

          <span className="hidden text-slate-300 sm:inline" aria-hidden="true">|</span>

          <button
            type="button"
            onClick={() => setSelected(new Set(filtered.map((s) => s.id)))}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            全选 ({filtered.length})
          </button>
          <button
            type="button"
            onClick={handleSmartDiversePick}
            title="不放松任何审校标准：跨 5 类引擎、浅/深主题、不同音色与去重文案，自动选出 7 条全部过审且互不撞车的视频"
            className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-900 hover:bg-emerald-100"
          >
            🎯 智能严选防重 (7条过审)
          </button>
          <button
            type="button"
            onClick={() =>
              setSelected(
                new Set(
                  filtered
                    .filter((s) => !isMarkedDone(s) && !statusMap.get(s.id)?.inChannel)
                    .slice(0, 10)
                    .map((s) => s.id)
                )
              )
            }
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            选前10个未发布
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            disabled={selected.size === 0}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            清空 ({selected.size})
          </button>

          <button
            type="button"
            disabled={busy || selectedSpecs.length === 0}
            onClick={() => selectedSpecs.forEach((s) => enqueueRender(s, false, false))}
            className="rounded-md bg-slate-900 px-2.5 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
          >
            批量本地生成 ({selectedSpecs.length})
          </button>
          <button
            type="button"
            disabled={zipping || totalDone === 0}
            onClick={handleMakeZip}
            className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-medium text-emerald-800 hover:bg-emerald-100 disabled:opacity-40"
          >
            📦 {zipping ? '打包中…' : `打包 ZIP (${doneSelected.length || totalDone})`}
          </button>
          <button
            type="button"
            onClick={handleExportTxt}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-700 hover:bg-slate-50"
          >
            导出 TXT
          </button>
          <button
            type="button"
            onClick={() => handleLocalBatchDiversify(selectedSpecs.length > 0 ? selectedSpecs : shown)}
            className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-50"
            title="不用 AI，按频道历史避重并剔除标题 #标签与多余 hashtag"
          >
            🎲 无 AI 防重改写 ({selectedSpecs.length > 0 ? selectedSpecs.length : shown.length})
          </button>
          <button
            type="button"
            disabled={aiBatching || selectedSpecs.length === 0}
            onClick={() => void handleAiBatchRewrite(selectedSpecs)}
            className="rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1.5 font-medium text-violet-800 hover:bg-violet-100 disabled:opacity-40"
            title="6 条打包一次请求 + low 思考降本，输出自动过合规守卫"
          >
            ✨ {aiBatching ? 'AI 改写中…' : `AI 批量改写 (${Math.min(30, selectedSpecs.length)})`}
          </button>

          {/* Shorts Studio pipeline bridge */}
          <div className="flex flex-wrap items-center gap-1.5 xl:ml-auto">
            <button
              type="button"
              disabled={enqueuing || selectedNotInChannel.length === 0}
              onClick={() => void handleBatchEnqueue(selectedNotInChannel, false)}
              className="rounded-md bg-slate-900 px-2.5 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-40"
            >
              送入审校队列 ({selectedNotInChannel.length})
            </button>
            <button
              type="button"
              disabled={enqueuing || selectedNotInChannel.length === 0}
              onClick={() => void handleBatchEnqueue(selectedNotInChannel, true)}
              className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
            >
              直接加入排期 ({selectedNotInChannel.length})
            </button>
            <button
              type="button"
              disabled={busy || selectedSpecs.length === 0}
              onClick={() => selectedSpecs.forEach((s) => enqueueRender(s, false, true))}
              className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 font-medium text-sky-800 hover:bg-sky-100 disabled:opacity-40"
            >
              渲染并存入生产线存储 ({selectedSpecs.length})
            </button>
          </div>
        </div>
      </div>

      {/* Notices & Progress */}
      {statusNotice && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
          <span>{statusNotice.text}</span>
          <button
            type="button"
            onClick={() => onNavigate(statusNotice.targetTab)}
            className="font-semibold text-sky-800 underline hover:text-sky-950"
          >
            {statusNotice.targetLabel}
          </button>
        </div>
      )}

      {zip && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-900">
          <span>
            ZIP 已就绪：{zip.n} 个视频 · <span className="font-mono tabular-nums">{zip.mb} MB</span>
          </span>
          <a
            href={zip.url}
            download={zip.name}
            className="rounded-md bg-emerald-700 px-3 py-1.5 font-semibold text-white hover:bg-emerald-800"
          >
            下载 {zip.name}
          </a>
        </div>
      )}

      {(busy || queued.size > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs">
          <span className="font-semibold text-slate-900">
            {activeJobSpec ? `正在生成：${activeJobSpec.title.slice(0, 42)}` : '排队处理中…'}
          </span>
          {activeJob && (
            <span className="font-mono text-slate-600 tabular-nums">
              {activeJob.stage} {Math.round(activeJob.p * 100)}%
            </span>
          )}
          <div className="h-1.5 w-44 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full bg-slate-900 transition-all"
              style={{ width: `${Math.round((activeJob?.p ?? 0) * 100)}%` }}
            />
          </div>
          <span className="font-mono text-slate-500 tabular-nums">队列剩余 {queued.size}</span>
          <button
            type="button"
            onClick={cancelAllRenders}
            className="ml-auto rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 font-medium text-rose-700 hover:bg-rose-100"
          >
            取消渲染
          </button>
        </div>
      )}

      {/* 5-Column Light Card Grid */}
      {shown.length > 0 ? (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {shown.map((s) => (
            <WorkbenchCard
              key={s.id}
              spec={s}
              audit={auditMap.get(s.id)}
              result={results[s.id]}
              job={jobs[s.id]}
              queued={queued.has(s.id) && !jobs[s.id]}
              error={errors[s.id]}
              selected={selected.has(s.id)}
              publishedLocal={doneLocal.has(s.id)}
              channelStatus={statusMap.get(s.id)!}
              downloaded={downloaded.has(s.id)}
              busy={busy || enqueuing}
              onToggleSelect={() => toggleSelect(s.id)}
              onTogglePublishedLocal={() => toggleDoneLocal(s.id)}
              onOpenPreview={() => setPreviewSpec(s)}
              onGenerateDownload={() => enqueueRender(s, true, false)}
              onEnqueueReview={() => void handleBatchEnqueue([s], false)}
              onEnqueueSchedule={() => void handleBatchEnqueue([s], true)}
              onRenderAndSync={() => enqueueRender(s, false, true)}
              onReroll={() => handleRerollSpec(s)}
              onMarkDownloaded={() => markDownloaded(s.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">
          没有符合条件的视频，请清空搜索词或切换分类。
        </div>
      )}

      {shown.length < filtered.length && (
        <div className="py-2 text-center">
          <button
            type="button"
            onClick={() => setLimit((l) => l + 36)}
            className="rounded-md border border-slate-200 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            加载更多（{shown.length}/{filtered.length}）
          </button>
        </div>
      )}

      <footer className="border-t border-slate-200 pt-4 pb-2 text-center text-xs text-slate-500">
        所有旋律均为公版曲目，音效由程序合成，画面由代码实时渲染。支持导出 MP4，或直接送入「{state.channel.title}」审校制作生产线，成片统一存储于{' '}
        <span className="font-mono text-slate-700">{storageHint}</span>。
      </footer>

      {previewSpec && (
        <WorkbenchPreviewModal
          spec={previewSpec}
          channelTitle={state.channel.title}
          storageHint={storageHint}
          channelStatus={statusMap.get(previewSpec.id)!}
          busy={busy || enqueuing}
          onClose={() => setPreviewSpec(null)}
          onSaveSpec={(updated) => {
            setSpecOverrides((prev) => ({
              ...prev,
              [updated.id]: {
                params: updated.params,
                theme: updated.theme,
                seed: updated.seed,
                hook: updated.hook,
                title: updated.title,
              },
            }));
            setPreviewSpec(updated);
          }}
          onGenerateDownload={(specToUse) => {
            setSpecOverrides((prev) => ({
              ...prev,
              [specToUse.id]: {
                params: specToUse.params,
                theme: specToUse.theme,
                seed: specToUse.seed,
                hook: specToUse.hook,
                title: specToUse.title,
              },
            }));
            enqueueRender(specToUse, true, false);
          }}
          onEnqueueReview={(specToUse) => {
            setSpecOverrides((prev) => ({
              ...prev,
              [specToUse.id]: {
                params: specToUse.params,
                theme: specToUse.theme,
                seed: specToUse.seed,
                hook: specToUse.hook,
                title: specToUse.title,
              },
            }));
            void handleBatchEnqueue([specToUse], false);
          }}
          onEnqueueSchedule={(specToUse) => {
            setSpecOverrides((prev) => ({
              ...prev,
              [specToUse.id]: {
                params: specToUse.params,
                theme: specToUse.theme,
                seed: specToUse.seed,
                hook: specToUse.hook,
                title: specToUse.title,
              },
            }));
            void handleBatchEnqueue([specToUse], true);
          }}
          onRenderAndUpload={(specToUse) => {
            setSpecOverrides((prev) => ({
              ...prev,
              [specToUse.id]: {
                params: specToUse.params,
                theme: specToUse.theme,
                seed: specToUse.seed,
                hook: specToUse.hook,
                title: specToUse.title,
              },
            }));
            enqueueRender(specToUse, false, true);
          }}
        />
      )}
    </div>
  );
};
