import {
  auditPublishMetadata,
  diversifyMetadataLocal,
  type MetadataAuditReport,
} from '../domain/metadata-guard.ts';
import { evaluateNovelty, type NoveltyContext } from '../domain/novelty.ts';
import type { ChannelProfile, NoveltyReport, VideoSpec } from '../domain/types.ts';
import { toWorkbenchEnqueueItem, workbenchItemToStudioSpec } from './bridge.ts';
import type { Recipe } from './catalog/catalog.ts';
import type { VideoSpec as WorkbenchSpec } from './engine/types.ts';
import { THEMES } from './engine/util.ts';

export interface WorkbenchMetaOverride {
  title: string;
  hook: string;
  description: string;
  tags: string[];
}

export interface WorkbenchAuditReport {
  passed: boolean;
  score: number;
  novelty: NoveltyReport;
  metadata: MetadataAuditReport;
  reasons: string[];
}

export interface WorkbenchAuditContext {
  channelProfile: ChannelProfile;
  channelHistory: NoveltyContext['channelHistory'];
  crossChannelSpecs: NoveltyContext['crossChannelSpecs'];
  recentTitles: string[];
  forbiddenTopics?: string[];
  now?: Date;
}

export function buildAuditContextFromHistory(params: {
  channelProfile: ChannelProfile;
  specs: Array<{ id: string; channel_id: string; spec: VideoSpec; created_at: string }>;
  renders: Array<{ spec_id: string; file_sha256: string }>;
  videos: Array<{ spec_id: string; scheduled_at: string; state: string }>;
  remoteTitles?: string[];
  now?: Date;
}): WorkbenchAuditContext {
  const channelId = params.channelProfile.channel_id;
  const renderShaBySpec = new Map<string, string>();
  for (const r of params.renders) {
    renderShaBySpec.set(r.spec_id, r.file_sha256);
  }
  const scheduledBySpec = new Map<string, string>();
  for (const v of params.videos) {
    if (v.state !== 'withdrawn') {
      scheduledBySpec.set(v.spec_id, v.scheduled_at);
    }
  }

  const channelHistory: NoveltyContext['channelHistory'] = [];
  const crossChannelSpecs: NoveltyContext['crossChannelSpecs'] = [];
  const recentTitles: string[] = [...(params.remoteTitles ?? [])];

  for (const s of params.specs) {
    const fileSha = renderShaBySpec.get(s.id);
    if (s.channel_id === channelId) {
      channelHistory.push({
        spec_id: s.id,
        spec: s.spec,
        created_at: s.created_at,
        scheduled_at: scheduledBySpec.get(s.id),
        file_sha256: fileSha,
      });
      if (s.spec.publish.title) recentTitles.push(s.spec.publish.title);
    } else {
      crossChannelSpecs.push({
        channel_id: s.channel_id,
        spec: s.spec,
        file_sha256: fileSha,
      });
    }
  }

  return {
    channelProfile: params.channelProfile,
    channelHistory,
    crossChannelSpecs,
    recentTitles,
    forbiddenTopics: params.channelProfile.brand.forbidden_topics,
    now: params.now,
  };
}

export function auditWorkbenchSpecStrict(
  wbSpec: WorkbenchSpec,
  ctx: WorkbenchAuditContext
): WorkbenchAuditReport {
  const studioSpec = workbenchItemToStudioSpec(
    toWorkbenchEnqueueItem(wbSpec, 25),
    ctx.channelProfile.channel_id || 'workbench'
  );
  const novelty = evaluateNovelty(studioSpec, {
    channelProfile: ctx.channelProfile,
    channelHistory: ctx.channelHistory,
    crossChannelSpecs: ctx.crossChannelSpecs,
    now: ctx.now,
  });

  const metadata = auditPublishMetadata({
    title: wbSpec.title,
    hookLine: wbSpec.hook,
    description: wbSpec.description,
    tags: wbSpec.tags,
    recentTitles: ctx.recentTitles,
    forbiddenTopics: ctx.forbiddenTopics ?? ctx.channelProfile.brand.forbidden_topics,
  });

  const reasons: string[] = [];
  for (const v of novelty.violations) {
    reasons.push(v.message);
  }
  for (const issue of metadata.issues) {
    if (
      issue.level === 'error' ||
      issue.code === 'AI_SLOP_FILLER' ||
      issue.code === 'TITLE_HASHTAG_SPAM' ||
      issue.code.startsWith('DUP_')
    ) {
      reasons.push(issue.message);
    }
  }

  const strictMetaClean =
    metadata.passed &&
    !metadata.issues.some(
      (i) =>
        i.code === 'POLICY_AI_SLOP_CLICHE' ||
        i.code === 'AI_SLOP_FILLER' ||
        i.code === 'TITLE_HASHTAG_SPAM' ||
        i.code.startsWith('DUP_')
    );

  const passed = novelty.verdict === 'pass' && strictMetaClean;
  const score = Math.round(novelty.score * 0.6 + metadata.score * 0.4);

  return {
    passed,
    score,
    novelty,
    metadata,
    reasons: Array.from(new Set(reasons)),
  };
}

export interface PassingVariantResult {
  variant: number;
  spec: WorkbenchSpec;
  metaOverride?: WorkbenchMetaOverride;
  audit: WorkbenchAuditReport;
}

export function findPassingVariant(
  recipe: Recipe,
  currentVariant: number,
  ctx: WorkbenchAuditContext,
  maxTries = 18
): PassingVariantResult {
  let best: PassingVariantResult | null = null;

  for (let step = 1; step <= maxTries; step++) {
    const v = currentVariant + step;
    const raw = recipe.spec(v);
    const directAudit = auditWorkbenchSpecStrict(raw, ctx);
    if (directAudit.passed) {
      return { variant: v, spec: raw, audit: directAudit };
    }

    const div = diversifyMetadataLocal({
      id: raw.id,
      engine: raw.engine,
      category: raw.category,
      baseTitle: raw.title,
      hookLine: raw.hook,
      description: raw.description,
      tags: raw.tags,
      params: raw.params,
      seed: raw.seed,
      variant: v,
      recentTitles: ctx.recentTitles,
      forbiddenTopics: ctx.forbiddenTopics ?? ctx.channelProfile.brand.forbidden_topics,
    });

    const mutated: WorkbenchSpec = {
      ...raw,
      title: div.title,
      hook: div.hookLine,
      description: div.description,
      tags: div.tags,
    };
    const mutatedAudit = auditWorkbenchSpecStrict(mutated, ctx);
    const candidate: PassingVariantResult = {
      variant: v,
      spec: mutated,
      metaOverride: {
        title: div.title,
        hook: div.hookLine,
        description: div.description,
        tags: div.tags,
      },
      audit: mutatedAudit,
    };

    if (mutatedAudit.passed) {
      return candidate;
    }

    if (!best || candidate.audit.score > best.audit.score) {
      best = candidate;
    }
    if (!best || directAudit.score > best.audit.score) {
      best = { variant: v, spec: raw, audit: directAudit };
    }
  }

  return best!;
}

export interface DiverseBatchSelection {
  picks: Array<{
    recipeId: string;
    variant: number;
    spec: WorkbenchSpec;
    metaOverride?: WorkbenchMetaOverride;
    audit: WorkbenchAuditReport;
  }>;
  variantsUpdate: Record<string, number>;
  metaOverridesUpdate: Record<string, WorkbenchMetaOverride>;
}

export function pickDiversePassBatch(
  recipes: Recipe[],
  count: number,
  ctx: WorkbenchAuditContext,
  options?: {
    currentVariants?: Record<string, number>;
    excludeBaseIds?: Set<string>;
  }
): DiverseBatchSelection {
  const baseNow = ctx.now ?? new Date();
  const effectiveCap = ctx.channelProfile.is_new_channel
    ? Math.min(ctx.channelProfile.daily_cap, 2)
    : Math.max(1, ctx.channelProfile.daily_cap);

  const todayPrefix = baseNow.toISOString().slice(0, 10);
  const existingToday = ctx.channelHistory.filter((h) =>
    (h.scheduled_at ?? h.created_at).startsWith(todayPrefix)
  ).length;

  const simHistory: NoveltyContext['channelHistory'] = [...ctx.channelHistory];
  const simRecentTitles: string[] = [...ctx.recentTitles];
  const excluded = new Set(options?.excludeBaseIds ?? []);
  const usedEngines = new Set<string>();
  const usedBaseIds = new Set<string>();

  const categories = ['music', 'phys', 'math', 'algo', 'sort'];
  const byCategory = new Map<string, Recipe[]>();
  for (const c of categories) byCategory.set(c, []);
  for (const r of recipes) {
    if (excluded.has(r.id)) continue;
    const list = byCategory.get(r.category) ?? [];
    list.push(r);
    byCategory.set(r.category, list);
  }

  const picks: DiverseBatchSelection['picks'] = [];
  const variantsUpdate: Record<string, number> = {};
  const metaOverridesUpdate: Record<string, WorkbenchMetaOverride> = {};
  let wantLight: boolean | null = null;
  let dayOffset = existingToday >= effectiveCap ? 1 : 0;
  let slotsInDay = dayOffset === 0 ? existingToday : 0;

  for (let round = 0; round < count * 4 && picks.length < count; round++) {
    const targetCat = categories[round % categories.length];
    const pool = byCategory.get(targetCat) ?? recipes;
    if (pool.length === 0) continue;

    // Prioritize unseen engines first, then light/dark contrast
    const sortedPool = [...pool].sort((a, b) => {
      const aUsed = usedEngines.has(a.engine) ? 1 : 0;
      const bUsed = usedEngines.has(b.engine) ? 1 : 0;
      if (aUsed !== bUsed) return aUsed - bUsed;
      if (wantLight !== null) {
        const va = options?.currentVariants?.[a.id] ?? 0;
        const vb = options?.currentVariants?.[b.id] ?? 0;
        const ta = THEMES[a.spec(va).theme % THEMES.length].isLight === wantLight ? 0 : 1;
        const tb = THEMES[b.spec(vb).theme % THEMES.length].isLight === wantLight ? 0 : 1;
        if (ta !== tb) return ta - tb;
      }
      return 0;
    });

    const stepNow = new Date(baseNow.getTime() + dayOffset * 86_400_000);
    const stepCtx: WorkbenchAuditContext = {
      ...ctx,
      channelHistory: simHistory,
      recentTitles: simRecentTitles,
      now: stepNow,
    };

    let chosen: DiverseBatchSelection['picks'][number] | null = null;

    for (const recipe of sortedPool) {
      if (usedBaseIds.has(recipe.id)) continue;
      const curV = options?.currentVariants?.[recipe.id] ?? 0;
      const curSpec = recipe.spec(curV);
      const curAudit = auditWorkbenchSpecStrict(curSpec, stepCtx);
      const curLight = THEMES[curSpec.theme % THEMES.length].isLight;

      if (curAudit.passed && (wantLight === null || curLight === wantLight || round >= categories.length * 2)) {
        chosen = {
          recipeId: recipe.id,
          variant: curV,
          spec: curSpec,
          audit: curAudit,
        };
        break;
      }

      const mutated = findPassingVariant(recipe, curV, stepCtx, 12);
      if (mutated.audit.passed) {
        chosen = {
          recipeId: recipe.id,
          variant: mutated.variant,
          spec: mutated.spec,
          metaOverride: mutated.metaOverride,
          audit: mutated.audit,
        };
        break;
      }
    }

    if (!chosen) continue;

    usedBaseIds.add(chosen.recipeId);
    usedEngines.add(chosen.spec.engine);
    wantLight = !THEMES[chosen.spec.theme % THEMES.length].isLight;
    picks.push(chosen);
    variantsUpdate[chosen.recipeId] = chosen.variant;
    if (chosen.metaOverride) {
      metaOverridesUpdate[chosen.spec.id] = chosen.metaOverride;
    }

    const studioSpec = workbenchItemToStudioSpec(
      toWorkbenchEnqueueItem(chosen.spec, 25),
      ctx.channelProfile.channel_id || 'workbench'
    );
    const stamp = stepNow.toISOString();
    simHistory.unshift({
      spec_id: `sim-pick-${picks.length}`,
      spec: studioSpec,
      created_at: stamp,
      scheduled_at: stamp,
    });
    simRecentTitles.unshift(chosen.spec.title);

    slotsInDay++;
    if (slotsInDay >= effectiveCap) {
      dayOffset++;
      slotsInDay = 0;
    }
  }

  return { picks, variantsUpdate, metaOverridesUpdate };
}
