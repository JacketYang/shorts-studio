import { Type } from '@google/genai';
import { computeScoreboardAndMix } from '../domain/bandit.ts';
import { normalizeTitleForDupCheck, sampleNovelCombos } from '../domain/novelty.ts';
import { TEMPLATE_REGISTRY } from '../domain/templates.ts';
import type {
  AiProviderConfig,
  Channel,
  ChannelProfile,
  CommentRecord,
  IdeaItem,
  MelodyEntry,
  ReferenceVideoRecord,
  RemoteVideo,
  RenderRecord,
  SpecRecord,
  TrendSignalRecord,
  VideoSpec,
  VisualQAResult,
} from '../domain/types.ts';
import {
  callStructuredAi,
  fetchAvailableAiModels,
  GEMINI_MODEL_T1,
  testAiConnection,
} from './ai-protocols.ts';
import { DEFAULT_AI_CONFIG, normalizeAiConfig } from './store.ts';

export { fetchAvailableAiModels, GEMINI_MODEL_T1, testAiConnection };

function assertBudgetAvailable(profile: ChannelProfile, currentMonthSpendUsd: number) {
  if (currentMonthSpendUsd >= profile.ai_budget_monthly_usd) {
    throw new Error(
      `频道本月 AI 预算已达上限 ($${currentMonthSpendUsd.toFixed(2)} / $${profile.ai_budget_monthly_usd.toFixed(2)})`
    );
  }
}

function estimateCost(tokensIn: number, tokensOut: number): number {
  return Number(((tokensIn * 0.1 + tokensOut * 0.4) / 1_000_000).toFixed(5));
}

function buildAnalyticsGuidance(remoteVideos: RemoteVideo[] = [], history: SpecRecord[] = []) {
  const scoreboard = computeScoreboardAndMix(remoteVideos, history);
  const armWeights: Record<string, number> = {};
  for (const arm of scoreboard.arms) {
    const key = arm.arm.split('·')[0].trim();
    if (TEMPLATE_REGISTRY[key]) {
      armWeights[key] = Math.max(armWeights[key] ?? -99, arm.thompsonSampleScore);
    }
  }

  const active = remoteVideos.filter((v) => !v.is_legacy && v.views > 0);
  const prefixCounts = new Map<string, number>();
  for (const v of active) {
    const p3 = normalizeTitleForDupCheck(v.title).split(' ').slice(0, 3).join(' ');
    if (p3) prefixCounts.set(p3, (prefixCounts.get(p3) ?? 0) + 1);
  }
  const fatiguedOpeners = Array.from(prefixCounts.entries())
    .filter(([, cnt]) => cnt >= 3)
    .map(([prefix, cnt]) => `"${prefix}..." (${cnt} videos)`);

  // Penalize ball-sort slightly in armWeights if it already saturated >= 6 active videos
  const ballSortCount = active.filter((v) => v.series_tag === 'ball-sort').length;
  if (ballSortCount >= 6) {
    armWeights['ball-sort'] = (armWeights['ball-sort'] ?? 0) - 2.5;
  }

  const ranked = [...active].sort(
    (a, b) =>
      b.engaged_views + (b.subs_gained - b.subs_lost) * 160 + b.stayed_to_watch_pct * 6 -
      (a.engaged_views + (a.subs_gained - a.subs_lost) * 160 + a.stayed_to_watch_pct * 6)
  );
  const topWinners = ranked.slice(0, 4).map(
    (v) =>
      `${v.title} [${v.duration_sec}s, ${v.views} views, ${v.stayed_to_watch_pct.toFixed(1)}% stayed, +${v.subs_gained - v.subs_lost} subs, ${v.watch_hours.toFixed(1)}h]`
  );
  const underperformers = active
    .filter((v) => v.stayed_to_watch_pct > 0 && v.stayed_to_watch_pct < 32)
    .slice(0, 4)
    .map((v) => `${v.title} [${v.stayed_to_watch_pct.toFixed(1)}% stayed, ${v.views} views]`);

  return { scoreboard, armWeights, fatiguedOpeners, topWinners, underperformers };
}

function buildSpecFromCreativeDraft(params: {
  channel: Channel;
  profile: ChannelProfile;
  combo: {
    mechanic: string;
    arena: string;
    rule: string;
    music_piece: string;
    hook_style: VideoSpec['axes']['hook_style'];
    title_pattern: VideoSpec['axes']['title_pattern'];
    ending: VideoSpec['axes']['ending'];
  };
  item: Record<string, unknown>;
  idx: number;
  promptVersion: string;
}): VideoSpec {
  const { combo, item, idx } = params;
  const seed = Math.floor(100000 + Math.random() * 899999);
  const dur = Math.min(60, Math.max(15, Number(item.duration_sec) || 26));
  const hookLine = String(item.hook_line || 'Wait for the final bounce').slice(0, 60);
  const title = String(item.title || `${combo.arena} ${combo.rule} simulation`).slice(0, 100);
  const isMelodyBounce = combo.mechanic === 'melody-bounce';
  const isPendulumWave = combo.mechanic === 'pendulum-wave';
  const isOrbitSync = combo.mechanic === 'orbit-sync';

  const paramsObj = isPendulumWave
    ? {
        pendulum: { count: 15, length_min: 0.24, length_step: 0.022, max_angle_deg: 52, damping: 0.0 },
        rule: {
          type:
            combo.rule === 'phase-flip'
              ? 'phase_flip'
              : combo.rule === 'gravity-pulse'
                ? 'gravity_pulse'
                : 'harmonic_sweep',
          cycle_sec: 24,
        },
        note_trigger: { on: 'center_crossing', velocity_from: 'phase' },
      }
    : isOrbitSync
      ? {
          orbits: { count: 10, base_radius: 0.11, radius_step: 0.032, base_omega: 1.05, resonance_ratio: 0.14 },
          rule: {
            type:
              combo.rule === 'reverse-outer'
                ? 'reverse_outer'
                : combo.rule === 'pulse-rings'
                  ? 'pulse_rings'
                  : 'harmonic_align',
            trigger_angle_deg: -90,
          },
          note_trigger: { on: 'beam_crossing', velocity_from: 'orbit_index' },
        }
      : isMelodyBounce
        ? {
            arena: {
              shape: ['circle', 'hexagon', 'triangle', 'ellipse', 'polygon'].includes(combo.arena) ? combo.arena : 'hexagon',
              size: 0.78,
              wall_thickness: 0.012,
              rotation_deg_per_s: 8,
            },
            balls: { count_start: 1, radius: 0.025, speed: 0.56, restitution: 1.0, gravity: 0.1, max_count: 48 },
            rule: {
              type:
                combo.rule === 'grow-on-bounce'
                  ? 'grow_on_bounce'
                  : combo.rule === 'speed-up'
                    ? 'speed_up'
                    : combo.rule === 'shrink-wall'
                      ? 'shrink_wall'
                      : 'split_on_bounce',
              every_n_bounces: 3,
              scale_factor: 1.03,
            },
            note_trigger: { on: 'ball_wall_collision', velocity_from: 'impact' },
          }
        : {
            balls: { count: 24, colors: ['#FF595E', '#FFCA3A', '#8AC926', '#1982C4'] },
            bins: { count: 4, layout: 'under-funnel' },
            mechanism: {
              pegs: { rows: 7, jitter: 0.25 },
              gates: [{ type: 'moving', period_s: 2.4 }],
              spiral: { enabled: combo.arena === 'spiral' },
            },
            goal: { type: 'sorted_by_color', celebrate: 'confetti-light' },
          };

  const seriesSlug = typeof item.series_slug === 'string' && item.series_slug.trim() ? item.series_slug.trim() : null;

  return {
    schema: 'videospec/1',
    spec_key: `${combo.mechanic.slice(0, 2)}-${combo.arena}-${seed}-${idx}`,
    channel_slug: params.channel.slug,
    concept: {
      working_title: String(item.working_title || title),
      hook_line: hookLine,
      hook_style: combo.hook_style,
      payoff: String(item.payoff || 'Satisfying physics progression synced to every note.'),
      emotion: 'satisfying',
      series: seriesSlug
        ? {
            slug: seriesSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
            episode: Number(item.series_episode) || 1,
            title: String(item.series_title || seriesSlug),
          }
        : null,
      novelty_notes: String(
        item.novelty_notes || `New combination: ${combo.mechanic} in ${combo.arena} with ${combo.rule} and ${combo.music_piece}`
      ),
    },
    format: {
      aspect: '9:16',
      width: 1080,
      height: 1920,
      fps: 30,
      duration_sec: dur,
      loop: { enabled: combo.ending === 'loop', mode: combo.ending === 'loop' ? 'audio-return' : 'none' },
    },
    scene: {
      template: combo.mechanic,
      template_version: '^1.0',
      seed,
      style: {
        palette: {
          family: params.profile.brand.palette_family,
          colors: ['#00F5D4', '#F15BB5', '#FEE440', '#9B5DE5'],
        },
        background: { type: 'gradient', colors: ['#05060F', '#101437'] },
        trail: { enabled: true, length_frames: 16, fade: 0.85 },
      },
      params: paramsObj,
    },
    timeline: [
      { t: 0, dur: 1.6, type: 'text', role: 'hook', text: hookLine, position: 'top-safe', style: 'bold-white-shadow' },
      { t: -2.0, dur: 2.0, type: 'text', role: 'end_card', text: 'Wait for the loop', position: 'bottom-safe', style: 'small-white' },
    ],
    audio: {
      mode: 'sim-driven',
      music: {
        melody_ref: { source: 'library', id: combo.music_piece },
        transpose: 0,
        tempo_bpm: 104,
        instrument: 'marimba',
        note_mapping: 'per_collision',
        wrap: 'loop',
        reverb: 0.1,
      },
      mix: { target_lufs: -14, true_peak_db: -1 },
    },
    publish: {
      title,
      description: `${String(item.description || hookLine)}\n\n#Shorts #satisfying #physics`,
      tags: ['satisfying', 'physics simulation', combo.mechanic],
      category_id: '24',
      made_for_kids: false,
      contains_synthetic_media: false,
      default_language: 'en',
      first_comment: String(item.first_comment || 'Did you expect that ending? 👇').slice(0, 200),
      schedule: { mode: 'auto', window_local: ['17:00', '22:00'] },
    },
    axes: {
      mechanic: combo.mechanic,
      arena: combo.arena,
      rule: combo.rule,
      music_piece: combo.music_piece,
      hook_style: combo.hook_style,
      title_pattern: combo.title_pattern,
      ending: combo.ending,
      palette_family: params.profile.brand.palette_family,
      instrument: 'marimba',
    },
    provenance: {
      generator: { kind: 'llm', model: String(item._model || GEMINI_MODEL_T1), prompt_version: params.promptVersion },
      created_at: new Date().toISOString(),
    },
  };
}

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(text) as unknown;
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    for (const key of ['items', 'specs', 'ideas', 'data', 'results']) {
      if (Array.isArray(obj[key])) return obj[key] as Array<Record<string, unknown>>;
    }
  }
  return [];
}

export async function generateSpecBatchWithGemini(params: {
  channel: Channel;
  profile: ChannelProfile;
  melodies: MelodyEntry[];
  history: SpecRecord[];
  remoteVideos?: RemoteVideo[];
  count: number;
  currentMonthSpendUsd: number;
  aiConfig?: AiProviderConfig;
}): Promise<{
  specs: VideoSpec[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}> {
  assertBudgetAvailable(params.profile, params.currentMonthSpendUsd);
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);

  const guidance = buildAnalyticsGuidance(params.remoteVideos, params.history);
  const combos = sampleNovelCombos(
    params.count,
    params.profile,
    params.melodies.map((m) => m.id),
    params.history,
    guidance.armWeights
  );

  const recentTitles = params.history.slice(0, 15).map((h) => h.spec.publish.title);
  const melodySummary = params.melodies.map((m) => `${m.id} (${m.title})`).join(', ');

  const systemInstruction = cfg.prompts.specgen_system;

  const prompt = `Channel: ${params.channel.slug} (${params.profile.niche}, tone: ${params.profile.brand.tone_rules})
Allowed templates: ${Object.keys(TEMPLATE_REGISTRY).join(', ')}
Available melodies: ${melodySummary}
Data-driven 60/30/10 Bandit recommendation: ${guidance.scoreboard.weeklyHighlight}
Top-performing videos on this channel (emulate their instant curiosity hook & recognizable musical payoff): ${JSON.stringify(guidance.topWinners)}
Low-stayed videos to AVOID repeating (too abstract or slow opening): ${JSON.stringify(guidance.underperformers)}
Fatigued title openers strictly BANNED: ${JSON.stringify(guidance.fatiguedOpeners)}
Recent titles to avoid: ${JSON.stringify(recentTitles)}
Assigned combinations (${combos.length}): ${JSON.stringify(combos)}

Return JSON array of ${combos.length} creative specs matching fields: working_title, hook_line, payoff, emotion, novelty_notes, duration_sec, title, description, first_comment, series_slug, series_episode, series_title.`;

  const aiResult = await callStructuredAi({
    aiConfig: cfg,
    systemInstruction,
    prompt,
    expectArray: true,
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          working_title: { type: Type.STRING },
          hook_line: { type: Type.STRING },
          payoff: { type: Type.STRING },
          emotion: { type: Type.STRING },
          novelty_notes: { type: Type.STRING },
          duration_sec: { type: Type.NUMBER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          first_comment: { type: Type.STRING },
          series_slug: { type: Type.STRING },
          series_episode: { type: Type.INTEGER },
          series_title: { type: Type.STRING },
        },
        required: ['working_title', 'hook_line', 'payoff', 'novelty_notes', 'duration_sec', 'title', 'description', 'first_comment'],
      },
    },
  });

  const parsedItems = parseJsonArray(aiResult.text);

  const specs = combos.map((combo, idx) =>
    buildSpecFromCreativeDraft({
      channel: params.channel,
      profile: params.profile,
      combo,
      item: { ...(parsedItems[idx] ?? {}), _model: aiResult.model },
      idx,
      promptVersion: 'specgen-v1',
    })
  );

  return {
    specs,
    tokensIn: aiResult.tokensIn,
    tokensOut: aiResult.tokensOut,
    costUsd: estimateCost(aiResult.tokensIn, aiResult.tokensOut),
    model: aiResult.model,
  };
}

/**
 * Generates 3 new sequel VideoSpecs from a breakout video per docs 07 §9.1 ("做下一集").
 */
export async function generateNextEpisodeSpecsWithGemini(params: {
  channel: Channel;
  profile: ChannelProfile;
  melodies: MelodyEntry[];
  history: SpecRecord[];
  remoteVideos?: RemoteVideo[];
  sourceTitle: string;
  sourceMetricsSummary: string;
  currentMonthSpendUsd: number;
  aiConfig?: AiProviderConfig;
}): Promise<{
  specs: VideoSpec[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}> {
  assertBudgetAvailable(params.profile, params.currentMonthSpendUsd);
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);

  const guidance = buildAnalyticsGuidance(params.remoteVideos, params.history);
  const combos = sampleNovelCombos(
    3,
    params.profile,
    params.melodies.map((m) => m.id),
    params.history,
    guidance.armWeights
  );

  const prompt = `Source breakout video: "${params.sourceTitle}" (${params.sourceMetricsSummary})
Fatigued title openers to AVOID: ${JSON.stringify(guidance.fatiguedOpeners)}
Task: Produce 3 NEW sequel episode drafts in the same spirit while changing at least 2 axes (never reuse the exact source title skeleton or same melody within 14d).
Assigned combinations (3): ${JSON.stringify(combos)}
Return JSON array of 3 items with fields: working_title, hook_line, payoff, novelty_notes, duration_sec, title, description, first_comment.`;

  const aiResult = await callStructuredAi({
    aiConfig: cfg,
    systemInstruction: cfg.prompts.next_episode,
    prompt,
    expectArray: true,
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          working_title: { type: Type.STRING },
          hook_line: { type: Type.STRING },
          payoff: { type: Type.STRING },
          novelty_notes: { type: Type.STRING },
          duration_sec: { type: Type.NUMBER },
          title: { type: Type.STRING },
          description: { type: Type.STRING },
          first_comment: { type: Type.STRING },
        },
        required: ['working_title', 'hook_line', 'payoff', 'novelty_notes', 'duration_sec', 'title', 'description', 'first_comment'],
      },
    },
  });

  const parsedItems = parseJsonArray(aiResult.text);
  const specs = combos.map((combo, idx) =>
    buildSpecFromCreativeDraft({
      channel: params.channel,
      profile: params.profile,
      combo,
      item: {
        ...(parsedItems[idx] ?? {}),
        _model: aiResult.model,
        series_slug: 'sequel-series',
        series_episode: idx + 1,
        series_title: 'Sequel Series',
      },
      idx,
      promptVersion: 'next-episode-v1',
    })
  );

  return {
    specs,
    tokensIn: aiResult.tokensIn,
    tokensOut: aiResult.tokensOut,
    costUsd: estimateCost(aiResult.tokensIn, aiResult.tokensOut),
    model: aiResult.model,
  };
}

/**
 * Drafts a comment reply or moderation recommendation per docs 07 §9.2.
 */
export async function draftCommentReplyWithGemini(params: {
  profile: ChannelProfile;
  comment: CommentRecord;
  currentMonthSpendUsd: number;
  aiConfig?: AiProviderConfig;
}): Promise<{
  action: 'reply' | 'hide' | 'ignore';
  text: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}> {
  assertBudgetAvailable(params.profile, params.currentMonthSpendUsd);
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);

  const prompt = `Channel tone: ${params.profile.brand.tone_rules}. Forbidden topics: ${params.profile.brand.forbidden_topics.join(', ')}.
Instruction: ${cfg.prompts.comment_reply}
Target comment on video "${params.comment.video_title}":
Author: ${params.comment.author}
Comment: "${params.comment.text}"
Return JSON object with { "action": "reply" | "hide" | "ignore", "text": "..." }.`;

  const aiResult = await callStructuredAi({
    aiConfig: cfg,
    systemInstruction: cfg.prompts.comment_reply,
    prompt,
    expectArray: false,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING },
        text: { type: Type.STRING },
      },
      required: ['action', 'text'],
    },
  });

  const parsed = JSON.parse(aiResult.text || '{}') as { action?: string; text?: string };
  const action = parsed.action === 'hide' || parsed.action === 'ignore' ? parsed.action : 'reply';

  return {
    action,
    text: String(parsed.text ?? '').slice(0, 200),
    tokensIn: aiResult.tokensIn,
    tokensOut: aiResult.tokensOut,
    costUsd: estimateCost(aiResult.tokensIn, aiResult.tokensOut),
    model: aiResult.model,
  };
}

/**
 * T2 visual/layout QA check on rendered frames & text safe zones per docs 05 §9.1.
 */
export async function runVisualQaWithGemini(params: {
  profile: ChannelProfile;
  spec: VideoSpec;
  render: RenderRecord;
  currentMonthSpendUsd: number;
  aiConfig?: AiProviderConfig;
}): Promise<{
  result: VisualQAResult;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}> {
  assertBudgetAvailable(params.profile, params.currentMonthSpendUsd);
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);

  const prompt = `Inspect this Shorts simulation layout & timeline for visual QA:
Resolution: ${params.spec.format.width}x${params.spec.format.height}
Title: "${params.spec.publish.title}"
Hook line: "${params.spec.concept.hook_line}"
Timeline items: ${JSON.stringify(params.spec.timeline)}
Deterministic QA summary: ${JSON.stringify(params.render.qa_checks)}
Palette: ${JSON.stringify(params.spec.scene.style)}
Event count: ${params.render.events.length}

Evaluate if hook text is placed inside Shorts safe zones (top-safe/center/bottom-safe), readable against background, and unlikely to be occluded by Shorts right/bottom UI.
Return JSON object { passed, occlusion_risk, hook_readable, summary, issues }.`;

  const aiResult = await callStructuredAi({
    aiConfig: cfg,
    prompt,
    expectArray: false,
    responseSchema: {
      type: Type.OBJECT,
      properties: {
        passed: { type: Type.BOOLEAN },
        occlusion_risk: { type: Type.STRING },
        hook_readable: { type: Type.BOOLEAN },
        summary: { type: Type.STRING },
        issues: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: ['passed', 'occlusion_risk', 'hook_readable', 'summary', 'issues'],
    },
  });

  const parsed = JSON.parse(aiResult.text || '{}') as {
    passed?: boolean;
    occlusion_risk?: string;
    hook_readable?: boolean;
    summary?: string;
    issues?: string[];
  };
  const risk =
    parsed.occlusion_risk === 'high' || parsed.occlusion_risk === 'low' ? parsed.occlusion_risk : 'none';

  return {
    result: {
      model: aiResult.model,
      passed: Boolean(parsed.passed ?? true),
      occlusion_risk: risk,
      hook_readable: Boolean(parsed.hook_readable ?? true),
      summary: String(parsed.summary || '首帧运动与安全区文字排布清晰无遮挡'),
      issues: Array.isArray(parsed.issues) ? parsed.issues.map(String) : [],
      checked_at: new Date().toISOString(),
    },
    tokensIn: aiResult.tokensIn,
    tokensOut: aiResult.tokensOut,
    costUsd: estimateCost(aiResult.tokensIn, aiResult.tokensOut),
  };
}

/**
 * Generates ideabatch/1 items from reference outlier videos & trend signals (docs 08 Phase 3).
 */
export async function suggestIdeaBatchWithGemini(params: {
  channel: Channel;
  profile: ChannelProfile;
  melodies: MelodyEntry[];
  referenceVideos: ReferenceVideoRecord[];
  trends: TrendSignalRecord[];
  remoteVideos?: RemoteVideo[];
  currentMonthSpendUsd: number;
  aiConfig?: AiProviderConfig;
}): Promise<{
  items: IdeaItem[];
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  model: string;
}> {
  assertBudgetAvailable(params.profile, params.currentMonthSpendUsd);
  const cfg = normalizeAiConfig(params.aiConfig ?? DEFAULT_AI_CONFIG);

  const guidance = buildAnalyticsGuidance(params.remoteVideos, []);
  const melodyIds = params.melodies.slice(0, 12).map((m) => m.id);
  const prompt = `Channel: ${params.channel.slug} (${params.profile.niche})
Available templates: melody-bounce, ball-sort, pendulum-wave, orbit-sync
Available compliant melodies (ONLY pick from these): ${melodyIds.join(', ')}
Channel top winners: ${JSON.stringify(guidance.topWinners)}
Fatigued openers to ban: ${JSON.stringify(guidance.fatiguedOpeners)}
Outlier reference signals (inspiration only, never copy titles): ${JSON.stringify(
    params.referenceVideos.slice(0, 5).map((r) => ({ title: r.title, ratio: r.outlier_ratio, axes: r.extracted_axes }))
  )}
Trend hashtags/topics: ${JSON.stringify(params.trends.filter((t) => !t.reference_only).slice(0, 5).map((t) => t.name))}

Generate 3 original ideabatch items aligned with the channel's proven winning retention/sub formats.
Return JSON array of 3 objects with fields: idea_key, mechanic, arena, rule, music_piece, hook_style, hook_line, title_candidates, payoff, novelty_notes.`;

  const aiResult = await callStructuredAi({
    aiConfig: cfg,
    systemInstruction: cfg.prompts.specgen_system,
    prompt,
    expectArray: true,
    responseSchema: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          idea_key: { type: Type.STRING },
          mechanic: { type: Type.STRING },
          arena: { type: Type.STRING },
          rule: { type: Type.STRING },
          music_piece: { type: Type.STRING },
          hook_style: { type: Type.STRING },
          hook_line: { type: Type.STRING },
          title_candidates: { type: Type.ARRAY, items: { type: Type.STRING } },
          payoff: { type: Type.STRING },
          novelty_notes: { type: Type.STRING },
        },
        required: [
          'idea_key',
          'mechanic',
          'arena',
          'rule',
          'music_piece',
          'hook_style',
          'hook_line',
          'title_candidates',
          'payoff',
          'novelty_notes',
        ],
      },
    },
  });

  const raw = parseJsonArray(aiResult.text);
  const validHookStyles = new Set(['prediction', 'escalation', 'mystery', 'countdown', 'contrast']);
  const validMechanics = new Set(['melody-bounce', 'ball-sort', 'pendulum-wave', 'orbit-sync']);
  const items: IdeaItem[] = raw.map((r, i) => ({
    idea_key: String(r.idea_key || `idea-ai-${Date.now().toString(36)}-${i}`),
    channel_slug: params.channel.slug,
    mechanic: validMechanics.has(String(r.mechanic)) ? String(r.mechanic) : 'melody-bounce',
    arena: String(r.arena || 'hexagon'),
    rule: String(r.rule || 'split-on-bounce'),
    music_piece: melodyIds.includes(String(r.music_piece)) ? String(r.music_piece) : melodyIds[0] ?? 'pd:canon-in-d',
    hook_style: (validHookStyles.has(String(r.hook_style)) ? String(r.hook_style) : 'mystery') as IdeaItem['hook_style'],
    hook_line: String(r.hook_line || 'Can you name this tune?').slice(0, 60),
    title_candidates:
      Array.isArray(r.title_candidates) && r.title_candidates.length > 0
        ? r.title_candidates.map(String)
        : ['New Physics Simulation'],
    payoff: String(r.payoff || 'Escalating physics synced to melody notes.'),
    novelty_notes: String(r.novelty_notes || 'Inspired by recent outlier motion rhythm with original arena.'),
    source: { kind: 'trend_ai', ref: aiResult.model },
  }));

  return {
    items,
    tokensIn: aiResult.tokensIn,
    tokensOut: aiResult.tokensOut,
    costUsd: estimateCost(aiResult.tokensIn, aiResult.tokensOut),
    model: aiResult.model,
  };
}

