import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, CheckCircle2, Clapperboard, Pause, Play, ShieldAlert, Shuffle, Sparkles, Volume2, VolumeX, Wand2 } from 'lucide-react';
import {
  auditPublishMetadata,
  DEFAULT_METADATA_REWRITE_PROMPT,
  diversifyMetadataLocal,
  sanitizeMetadataCandidate,
} from '../domain/metadata-guard';
import type { StudioState } from '../types/ui';
import { toWorkbenchEnqueueItem, WORKBENCH_ENGINE_LABELS } from '../workbench/bridge';
import { buildCatalog, CATEGORIES } from '../workbench/catalog/catalog';
import { drawStill, startPreview } from '../workbench/engine/preview';
import { THEMES } from '../workbench/engine/util';
import { buildScene } from '../workbench/scenes';
import { CreativeAudioTuner } from './CreativeAudioTuner';

interface WorkbenchCreativeBuilderProps {
  state: StudioState;
  onRefresh: () => Promise<void>;
  onNavigate: (tab: string) => void;
  onOpenFullWorkbench?: () => void;
}

export const WorkbenchCreativeBuilder: React.FC<WorkbenchCreativeBuilderProps> = ({
  state,
  onRefresh,
  onNavigate,
  onOpenFullWorkbench,
}) => {
  const recipes = useMemo(() => buildCatalog(), []);
  const [catFilter, setCatFilter] = useState<string>('all');
  const [engineFilter, setEngineFilter] = useState<string>('all');

  const availableEngines = useMemo(() => {
    const set = new Set<string>();
    for (const r of recipes) {
      if (catFilter === 'all' || r.category === catFilter) {
        set.add(r.engine);
      }
    }
    return [...set];
  }, [recipes, catFilter]);

  const filteredRecipes = useMemo(
    () =>
      recipes.filter((r) => {
        if (catFilter !== 'all' && r.category !== catFilter) return false;
        if (engineFilter !== 'all' && r.engine !== engineFilter) return false;
        return true;
      }),
    [recipes, catFilter, engineFilter]
  );

  const [recipeId, setRecipeId] = useState<string>(() => recipes[0]?.id ?? 'hop-canon');
  const [variant, setVariant] = useState<number>(0);

  const activeRecipe = useMemo(
    () => filteredRecipes.find((r) => r.id === recipeId) ?? filteredRecipes[0] ?? recipes[0],
    [filteredRecipes, recipeId, recipes]
  );

  useEffect(() => {
    if (activeRecipe && activeRecipe.id !== recipeId) {
      setRecipeId(activeRecipe.id);
    }
  }, [activeRecipe, recipeId]);

  const baseSpec = useMemo(() => activeRecipe.spec(variant), [activeRecipe, variant]);

  const [themeIdx, setThemeIdx] = useState<number>(baseSpec.theme);
  const [seedOverride, setSeedOverride] = useState<number>(baseSpec.seed);
  const [paramOverrides, setParamOverrides] = useState<Record<string, unknown>>({});
  const [customTitle, setCustomTitle] = useState<string>(baseSpec.title);
  const [customHook, setCustomHook] = useState<string>(baseSpec.hook);
  const [customDesc, setCustomDesc] = useState<string>(baseSpec.description);
  const [customTags, setCustomTags] = useState<string>(baseSpec.tags.join(', '));
  const [copyVariant, setCopyVariant] = useState<number>(0);
  const [showPromptEditor, setShowPromptEditor] = useState<boolean>(false);
  const [promptDraft, setPromptDraft] = useState<string>(
    () => state.ai_config?.prompts?.metadata_rewrite ?? DEFAULT_METADATA_REWRITE_PROMPT
  );
  const [aiRewriting, setAiRewriting] = useState<boolean>(false);

  useEffect(() => {
    if (state.ai_config?.prompts?.metadata_rewrite) {
      setPromptDraft(state.ai_config.prompts.metadata_rewrite);
    }
  }, [state.ai_config?.prompts?.metadata_rewrite]);

  // Sync editable metadata whenever recipe or variant changes
  useEffect(() => {
    setThemeIdx(baseSpec.theme);
    setSeedOverride(baseSpec.seed);
    setParamOverrides({});
    setCustomTitle(baseSpec.title);
    setCustomHook(baseSpec.hook);
    setCustomDesc(baseSpec.description);
    setCustomTags(baseSpec.tags.join(', '));
    setCopyVariant(0);
  }, [baseSpec]);

  const recentChannelTitles = useMemo(
    () => [
      ...state.specs.map((s) => s.spec.publish.title),
      ...state.remote_videos.filter((v) => !v.is_legacy).map((v) => v.title),
    ],
    [state.specs, state.remote_videos]
  );

  const parsedTagList = useMemo(
    () =>
      customTags
        .split(/[,，\n]/)
        .map((t) => t.trim())
        .filter(Boolean),
    [customTags]
  );

  const metadataAudit = useMemo(
    () =>
      auditPublishMetadata({
        title: customTitle,
        hookLine: customHook,
        description: customDesc,
        tags: parsedTagList,
        recentTitles: recentChannelTitles,
        forbiddenTopics: state.profile.brand.forbidden_topics,
      }),
    [customTitle, customHook, customDesc, parsedTagList, recentChannelTitles, state.profile.brand.forbidden_topics]
  );

  const handleLocalDiversify = () => {
    const nextVar = copyVariant + 1;
    setCopyVariant(nextVar);
    const res = diversifyMetadataLocal({
      id: baseSpec.id,
      engine: baseSpec.engine,
      category: baseSpec.category,
      baseTitle: baseSpec.title,
      hookLine: baseSpec.hook,
      description: baseSpec.description,
      tags: baseSpec.tags,
      params: baseSpec.params,
      seed: baseSpec.seed,
      variant: nextVar,
      recentTitles: recentChannelTitles,
      forbiddenTopics: state.profile.brand.forbidden_topics,
    });
    setCustomTitle(res.title);
    setCustomHook(res.hookLine);
    setCustomDesc(res.description);
    setCustomTags(res.tags.join(', '));
    setFeedback({
      ok: true,
      text: `已用「无 AI 本地防重引擎」生成第 ${nextVar} 版合规文案（句式：${res.patternUsed} · 体检 ${res.audit.score}/100）。`,
    });
  };

  const handleSanitizeMetadata = () => {
    const clean = sanitizeMetadataCandidate({
      title: customTitle,
      hookLine: customHook,
      description: customDesc,
      tags: parsedTagList,
      forbiddenTopics: state.profile.brand.forbidden_topics,
    });
    setCustomTitle(clean.title);
    setCustomHook(clean.hookLine);
    setCustomDesc(clean.description);
    setCustomTags(clean.tags.join(', '));
    setFeedback({ ok: true, text: '已清理标题 #标签、过量表情与多余 #tag，使描述符合 YouTube 3-4 标签规范。' });
  };

  const handleAiRewrite = async () => {
    setAiRewriting(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/ai/rewrite-metadata', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          promptOverride: promptDraft,
          items: [
            {
              id: baseSpec.id,
              engine: baseSpec.engine,
              category: baseSpec.category,
              title: customTitle,
              hookLine: customHook,
              description: customDesc,
              tags: parsedTagList,
              params: baseSpec.params,
            },
          ],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error ?? 'AI 润色失败（请检查「频道与设置」中的 API Key）' });
        return;
      }
      const rewritten = data.items?.[0];
      if (rewritten) {
        setCustomTitle(rewritten.title);
        setCustomHook(rewritten.hookLine);
        setCustomDesc(rewritten.description);
        setCustomTags((rewritten.tags ?? []).join(', '));
        setFeedback({
          ok: true,
          text: `AI 润色完成（模型 ${data.model} · 费用 $${Number(data.cost_usd ?? 0).toFixed(5)} · 合规分 ${rewritten.audit?.score ?? 100}/100）`,
        });
      }
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : '网络错误' });
    } finally {
      setAiRewriting(false);
    }
  };

  const mergedParams = useMemo(
    () => ({
      ...(baseSpec.params && typeof baseSpec.params === 'object' ? (baseSpec.params as Record<string, unknown>) : {}),
      ...paramOverrides,
    }),
    [baseSpec.params, paramOverrides]
  );

  const previewSpec = useMemo(
    () => ({
      ...baseSpec,
      seed: seedOverride,
      theme: themeIdx,
      params: mergedParams,
      title: customTitle.trim() || baseSpec.title,
      hook: customHook.trim() || baseSpec.hook,
      description: customDesc.trim() || baseSpec.description,
      tags: parsedTagList,
    }),
    [baseSpec, seedOverride, themeIdx, mergedParams, customTitle, customHook, customDesc, parsedTagList]
  );

  const sceneInfo = useMemo(() => {
    try {
      const scene = buildScene(previewSpec);
      return { scene, theme: THEMES[previewSpec.theme % THEMES.length] };
    } catch {
      return null;
    }
  }, [previewSpec]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [livePlay, setLivePlay] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !sceneInfo) return;

    if (!livePlay) {
      try {
        drawStill(cv, sceneInfo.scene, sceneInfo.theme, previewSpec.hook, sceneInfo.scene.duration * 0.48);
      } catch {
        // ignore canvas draw error
      }
      return;
    }

    const handle = startPreview(cv, sceneInfo.scene, sceneInfo.theme, previewSpec.hook, soundOn);
    return () => handle.stop();
  }, [sceneInfo, previewSpec.hook, livePlay, soundOn]);

  const handleEnqueue = async (autoSchedule: boolean) => {
    if (!sceneInfo) return;
    setBusy(true);
    setFeedback(null);
    try {
      const item = toWorkbenchEnqueueItem(previewSpec, sceneInfo.scene.duration);
      const res = await fetch('/api/workbench/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: state.channel.id,
          items: [item],
          autoSchedule,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ ok: false, text: data.error ?? '入库失败' });
        return;
      }
      await onRefresh();
      if (autoSchedule) {
        onNavigate('calendar');
      } else {
        onNavigate('studio');
      }
    } catch (err) {
      setFeedback({ ok: false, text: err instanceof Error ? err.message : '网络请求失败' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      {/* Left: Engine & Recipe Controls */}
      <div className="space-y-4 lg:col-span-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label htmlFor="wb-builder-cat" className="block font-medium text-slate-700">
              1. 选择创意分类 (5 大高完播赛道)
            </label>
            <select
              id="wb-builder-cat"
              value={catFilter}
              onChange={(e) => {
                setCatFilter(e.target.value);
                setEngineFilter('all');
              }}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="all">全部类别 ({recipes.length} 条配方)</option>
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="wb-builder-engine" className="block font-medium text-slate-700">
              2. 选择视觉物理/数学引擎 (19 种引擎)
            </label>
            <select
              id="wb-builder-engine"
              value={engineFilter}
              onChange={(e) => setEngineFilter(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              <option value="all">全部引擎 ({availableEngines.length} 种)</option>
              {availableEngines.map((eng) => (
                <option key={eng} value={eng}>
                  {WORKBENCH_ENGINE_LABELS[eng] ?? eng}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-12 text-xs">
          <div className="sm:col-span-9">
            <label htmlFor="wb-builder-recipe" className="block font-medium text-slate-700">
              3. 选择基础创意配方 ({filteredRecipes.length} 条可选)
            </label>
            <select
              id="wb-builder-recipe"
              value={activeRecipe.id}
              onChange={(e) => {
                setRecipeId(e.target.value);
                setVariant(0);
              }}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none"
            >
              {filteredRecipes.map((r) => {
                const sp = r.spec(0);
                return (
                  <option key={r.id} value={r.id}>
                    [{WORKBENCH_ENGINE_LABELS[r.engine]?.split(' ')[0] ?? r.engine}] {sp.title}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="sm:col-span-3 flex items-end">
            <button
              type="button"
              onClick={() => setVariant((v) => v + 1)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 font-medium text-slate-800 hover:bg-slate-50"
            >
              <Shuffle className="h-3.5 w-3.5" />
              换一版配方 (#{variant + 1})
            </button>
          </div>
        </div>

        {/* Theme Swatches */}
        <div className="text-xs">
          <div className="mb-1.5 font-medium text-slate-700">4. 选择背景与荧光色板 (Theme)</div>
          <div className="flex flex-wrap gap-2">
            {THEMES.map((th, idx) => {
              const active = themeIdx % THEMES.length === idx;
              return (
                <button
                  key={th.name}
                  type="button"
                  onClick={() => setThemeIdx(idx)}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="h-3 w-3 rounded-sm border border-white/30 shrink-0"
                    style={{ background: `linear-gradient(135deg, ${th.bg[0]}, ${th.accent[0]})` }}
                  />
                  <span>{th.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 5: Audio, Speed & Scale Tuning */}
        <CreativeAudioTuner
          mode="workbench"
          engine={previewSpec.engine}
          params={mergedParams}
          theme={themeIdx}
          seed={seedOverride}
          durationSec={sceneInfo?.scene.duration ?? 25}
          showThemePicker={false}
          showTextFields={false}
          onChangeParams={(patch) => setParamOverrides((prev) => ({ ...prev, ...patch }))}
          onChangeSeed={(next) => setSeedOverride(next)}
        />

        {/* Metadata Diversification & Compliance Toolbar */}
        <div className="space-y-2.5 rounded-lg border border-slate-200 bg-slate-50/80 p-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {metadataAudit.passed && metadataAudit.issues.length === 0 ? (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  合规与防重体检：{metadataAudit.score}/100（通过）
                </span>
              ) : (
                <span className={`inline-flex items-center gap-1 font-semibold ${metadataAudit.passed ? 'text-amber-700' : 'text-rose-700'}`}>
                  <ShieldAlert className="h-3.5 w-3.5" />
                  文案体检 {metadataAudit.score}/100（{metadataAudit.issues.length} 项建议修正）
                </span>
              )}
              <span className="font-mono text-[10px] text-slate-500">
                标题 {metadataAudit.stats.titleLen}/100 · 描述# {metadataAudit.stats.hashtagCount} 个 · 最高相似度 {Math.round(metadataAudit.stats.maxTitleSim * 100)}%
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={handleLocalDiversify}
                className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-800 hover:bg-slate-100"
              >
                <Shuffle className="h-3 w-3" />
                无 AI 防重换文案
              </button>
              {metadataAudit.issues.length > 0 && (
                <button
                  type="button"
                  onClick={handleSanitizeMetadata}
                  className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-100"
                >
                  一键合规清理
                </button>
              )}
              <button
                type="button"
                disabled={aiRewriting}
                onClick={handleAiRewrite}
                className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 disabled:opacity-50"
              >
                <Wand2 className="h-3 w-3" />
                {aiRewriting ? 'AI 润色中…' : 'AI 降本润色'}
              </button>
              <button
                type="button"
                onClick={() => setShowPromptEditor((v) => !v)}
                className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
              >
                {showPromptEditor ? '收起提示词' : '改提示词'}
              </button>
            </div>
          </div>

          {metadataAudit.issues.length > 0 && (
            <div className="space-y-0.5 text-[11px] text-slate-600">
              {metadataAudit.issues.map((iss, idx) => (
                <div key={idx} className={iss.level === 'error' ? 'text-rose-700' : 'text-amber-700'}>
                  • {iss.message}
                </div>
              ))}
            </div>
          )}

          {showPromptEditor && (
            <div className="space-y-1.5 border-t border-slate-200 pt-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span>AI 改写提示词（本次临时微调；持久保存请前往「频道与设置」）</span>
                <button
                  type="button"
                  onClick={() => setPromptDraft(DEFAULT_METADATA_REWRITE_PROMPT)}
                  className="text-sky-700 hover:underline"
                >
                  重置默认
                </button>
              </div>
              <textarea
                rows={4}
                value={promptDraft}
                onChange={(e) => setPromptDraft(e.target.value)}
                className="w-full rounded border border-slate-200 bg-white p-2 font-mono text-[11px] text-slate-800 focus:border-slate-900 focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* Copy & Hook Editors */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label htmlFor="wb-builder-hook" className="block font-medium text-slate-700">
              首秒屏幕钩子文案 (Hook · 叠印在画面顶部)
            </label>
            <input
              id="wb-builder-hook"
              type="text"
              maxLength={80}
              value={customHook}
              onChange={(e) => setCustomHook(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="wb-builder-title" className="block font-medium text-slate-700">
              YouTube 视频标题 (≤ 100 字符)
            </label>
            <input
              id="wb-builder-title"
              type="text"
              maxLength={100}
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-900 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 text-xs">
          <div>
            <label htmlFor="wb-builder-desc" className="block font-medium text-slate-700">
              视频描述 (Description)
            </label>
            <textarea
              id="wb-builder-desc"
              rows={3}
              value={customDesc}
              onChange={(e) => setCustomDesc(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 focus:border-slate-900 focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="wb-builder-tags" className="block font-medium text-slate-700">
              标签 (逗号分隔)
            </label>
            <textarea
              id="wb-builder-tags"
              rows={3}
              value={customTags}
              onChange={(e) => setCustomTags(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-slate-800 focus:border-slate-900 focus:outline-none"
            />
          </div>
        </div>

        {feedback && (
          <div
            className={`rounded-md border px-3 py-2 text-xs font-medium ${
              feedback.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          {onOpenFullWorkbench ? (
            <button
              type="button"
              onClick={onOpenFullWorkbench}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              去「视频工坊 (215+)」批量挑选
            </button>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={busy || !sceneInfo}
              onClick={() => handleEnqueue(false)}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              <Clapperboard className="h-3.5 w-3.5" />
              加入创意库并前往「制作与渲染」
            </button>
            <button
              type="button"
              disabled={busy || !sceneInfo}
              onClick={() => handleEnqueue(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              <CalendarPlus className="h-3.5 w-3.5" />
              直接加入频道排期
            </button>
          </div>
        </div>
      </div>

      {/* Right: Live 9:16 Interactive Canvas Preview */}
      <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 lg:col-span-4">
        <div className="flex w-full items-center justify-between text-xs">
          <span className="font-semibold text-slate-900">实时音画效果预览 (9:16)</span>
          {sceneInfo && (
            <span className="font-mono text-[11px] text-slate-500 tabular-nums">
              {sceneInfo.scene.duration.toFixed(1)}s · {sceneInfo.scene.audio.length} 音符
            </span>
          )}
        </div>

        <div className="relative w-[224px] overflow-hidden rounded-lg border border-slate-200 bg-slate-950 shadow-sm" style={{ aspectRatio: '9 / 16' }}>
          <canvas
            ref={canvasRef}
            width={360}
            height={640}
            data-testid="wb-builder-preview-canvas"
            className="h-full w-full block"
          />
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLivePlay((p) => !p)}
            className="inline-flex items-center gap-1.5 rounded-md bg-slate-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          >
            {livePlay ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            {livePlay ? '停止实时预览' : '实时试看音画'}
          </button>
          <button
            type="button"
            onClick={() => setSoundOn((s) => !s)}
            aria-label={soundOn ? '静音预览' : '开启声音'}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            {soundOn ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
            {soundOn ? '声音开' : '静音'}
          </button>
        </div>

        <p className="text-center text-[11px] leading-relaxed text-slate-500">
          送入「制作与渲染」或「审核队列」后，可一键渲染 1080×1920 MP4 并存入{' '}
          <span className="font-mono text-slate-700">
            {state.storage_config.driver === 'local' ? `${state.storage_config.local_dir}/renders` : state.storage_config.driver}
          </span>
          。
        </p>
      </div>
    </div>
  );
};
