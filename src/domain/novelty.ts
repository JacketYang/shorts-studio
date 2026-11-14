import type {
  ChannelProfile,
  NoveltyReport,
  NoveltyRuleViolation,
  SpecRecord,
  VideoSpec,
} from './types.ts';
import { TEMPLATE_REGISTRY } from './templates.ts';

export interface NoveltyContext {
  channelProfile: ChannelProfile;
  channelHistory: Array<{
    spec_id: string;
    spec: VideoSpec;
    created_at: string;
    scheduled_at?: string;
    file_sha256?: string;
  }>;
  crossChannelSpecs: Array<{
    channel_id: string;
    spec: VideoSpec;
    file_sha256?: string;
  }>;
  candidateFileSha256?: string;
  now?: Date;
}

const STRUCTURAL_AXES = ['mechanic', 'arena', 'rule', 'music_piece', 'hook_style', 'ending'] as const;

export function normalizeTitleForDupCheck(title: string): string {
  return title
    .toLowerCase()
    .replace(/#\w+/g, '')
    .replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstThreeWords(title: string): string {
  return normalizeTitleForDupCheck(title).split(' ').slice(0, 3).join(' ');
}

export function jaccard3Gram(a: string, b: string): number {
  const normA = normalizeTitleForDupCheck(a);
  const normB = normalizeTitleForDupCheck(b);
  if (!normA || !normB) return 0;
  const grams = (s: string) => {
    const out = new Set<string>();
    if (s.length <= 3) {
      out.add(s);
      return out;
    }
    for (let i = 0; i <= s.length - 3; i++) {
      out.add(s.slice(i, i + 3));
    }
    return out;
  };
  const sa = grams(normA);
  const sb = grams(normB);
  let inter = 0;
  for (const g of sa) {
    if (sb.has(g)) inter++;
  }
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function countDifferentAxes(a: VideoSpec['axes'], b: VideoSpec['axes']): number {
  let diff = 0;
  for (const axis of STRUCTURAL_AXES) {
    if (a[axis] !== b[axis]) diff++;
  }
  return diff;
}

export function evaluateNovelty(candidate: VideoSpec, ctx: NoveltyContext): NoveltyReport {
  const now = ctx.now ?? new Date();
  const msDay = 86_400_000;
  const mode = ctx.channelProfile.novelty_mode;
  const violations: NoveltyRuleViolation[] = [];

  const sortedHistory = [...ctx.channelHistory].sort((a, b) => {
    const ta = new Date(a.scheduled_at ?? a.created_at).getTime();
    const tb = new Date(b.scheduled_at ?? b.created_at).getTime();
    return tb - ta;
  });

  const withinDays = (iso: string, days: number) =>
    now.getTime() - new Date(iso).getTime() <= days * msDay;

  const recent7d = sortedHistory.filter((h) => withinDays(h.scheduled_at ?? h.created_at, 7));
  const recent14d = sortedHistory.filter((h) => withinDays(h.scheduled_at ?? h.created_at, 14));
  const recent30d = sortedHistory.filter((h) => withinDays(h.scheduled_at ?? h.created_at, 30));

  const isSeries = Boolean(candidate.concept.series?.slug);
  const seriesSlug = candidate.concept.series?.slug;

  // Rule 1 & Rule 8: same mechanic <= 2 in 7d (series overrides to <= 3 in 7d) and <= 30% in 30d (series 40%)
  const sameMechanic7d = recent7d.filter((h) => h.spec.axes.mechanic === candidate.axes.mechanic);
  if (isSeries) {
    const sameSeries7d = recent7d.filter((h) => h.spec.concept.series?.slug === seriesSlug);
    if (sameSeries7d.length >= 3) {
      violations.push({
        rule: 'R8_SERIES_WEEKLY_CAP',
        severity: mode,
        message: `同系列 "${seriesSlug}" 近 7 天已有 ${sameSeries7d.length} 集（上限 3 集）`,
        suggested_axes: ['mechanic', 'series'],
      });
    }
    const sameSeriesPrev = sortedHistory.find((h) => h.spec.concept.series?.slug === seriesSlug);
    if (sameSeriesPrev) {
      const axisDiff = countDifferentAxes(candidate.axes, sameSeriesPrev.spec.axes);
      if (axisDiff < 2) {
        violations.push({
          rule: 'R8_SERIES_AXIS_DIFF',
          severity: mode,
          message: `与同系列上一集相比仅 ${axisDiff} 个核心轴不同（要求 >= 2 个结构/音频/概念轴不同）`,
          related_spec_id: sameSeriesPrev.spec_id,
          suggested_axes: ['arena', 'rule', 'music_piece', 'ending'],
        });
      }
    }
  } else if (sameMechanic7d.length >= 2) {
    violations.push({
      rule: 'R1_MECHANIC_7D_CAP',
      severity: mode,
      message: `机制 "${candidate.axes.mechanic}" 近 7 天已有 ${sameMechanic7d.length} 条（非系列上限 2 条）`,
      suggested_axes: ['mechanic'],
    });
  }

  const sameMech30d = recent30d.filter((h) => h.spec.axes.mechanic === candidate.axes.mechanic).length;
  const total30d = recent30d.length + 1;
  const pctLimit = isSeries ? 0.4 : 0.3;
  if (recent30d.length >= 4 && (sameMech30d + 1) / total30d > pctLimit) {
    violations.push({
      rule: 'R1_MECHANIC_30D_RATIO',
      severity: mode,
      message: `机制 "${candidate.axes.mechanic}" 近 30 天占比将达 ${Math.round(((sameMech30d + 1) / total30d) * 100)}%（上限 ${Math.round(pctLimit * 100)}%）`,
      suggested_axes: ['mechanic'],
    });
  }

  // Rule 2: Adjacent videos must differ on >= 2 structural/audio/concept axes
  if (sortedHistory.length > 0) {
    const prev = sortedHistory[0];
    const diffCount = countDifferentAxes(candidate.axes, prev.spec.axes);
    if (diffCount < 2) {
      violations.push({
        rule: 'R2_ADJACENT_AXES',
        severity: mode,
        message: `与最近一条视频相比仅 ${diffCount} 个核心轴不同（要求至少 2 个轴不同）`,
        related_spec_id: prev.spec_id,
        suggested_axes: ['arena', 'rule', 'music_piece', 'hook_style'],
      });
    }
  }

  // Rule 3: Same music_piece max once in 14d; second appearance must change mechanic or rule
  if (candidate.axes.music_piece !== 'none') {
    const sameMusic14d = recent14d.find((h) => h.spec.axes.music_piece === candidate.axes.music_piece);
    if (sameMusic14d) {
      violations.push({
        rule: 'R3_MUSIC_14D_COOLDOWN',
        severity: mode,
        message: `旋律 "${candidate.axes.music_piece}" 14 天内已使用过，请更换旋律`,
        related_spec_id: sameMusic14d.spec_id,
        suggested_axes: ['music_piece'],
      });
    }
    const prevMusicAny = sortedHistory.find((h) => h.spec.axes.music_piece === candidate.axes.music_piece);
    if (
      prevMusicAny &&
      prevMusicAny.spec.axes.mechanic === candidate.axes.mechanic &&
      prevMusicAny.spec.axes.rule === candidate.axes.rule
    ) {
      violations.push({
        rule: 'R3_MUSIC_REPEAT_COMBO',
        severity: mode,
        message: `旋律 "${candidate.axes.music_piece}" 再次出场必须更换 mechanic 或 rule`,
        related_spec_id: prevMusicAny.spec_id,
        suggested_axes: ['mechanic', 'rule'],
      });
    }
  }

  // Rule 4: Same title_pattern + first 3 words max once in 7d
  const candidateFirst3 = firstThreeWords(candidate.publish.title);
  const samePattern7d = recent7d.find(
    (h) =>
      h.spec.axes.title_pattern === candidate.axes.title_pattern &&
      firstThreeWords(h.spec.publish.title) === candidateFirst3
  );
  if (samePattern7d) {
    violations.push({
      rule: 'R4_TITLE_SKELETON_7D',
      severity: mode,
      message: `标题句式 (${candidate.axes.title_pattern}) 与前 3 词 "${candidateFirst3}" 在 7 天内已使用`,
      related_spec_id: samePattern7d.spec_id,
      suggested_axes: ['title_pattern'],
    });
  }

  // Rule 5: Exact normalized title duplicate or identical render file hash -> ALWAYS BLOCK
  const normCandTitle = normalizeTitleForDupCheck(candidate.publish.title);
  const dupTitle = sortedHistory.find((h) => normalizeTitleForDupCheck(h.spec.publish.title) === normCandTitle);
  if (dupTitle) {
    violations.push({
      rule: 'R5_DUPLICATE_TITLE',
      severity: 'block',
      message: `禁止同标题重复发布: "${candidate.publish.title}"`,
      related_spec_id: dupTitle.spec_id,
    });
  }
  if (ctx.candidateFileSha256) {
    const dupFile = sortedHistory.find((h) => h.file_sha256 && h.file_sha256 === ctx.candidateFileSha256);
    if (dupFile) {
      violations.push({
        rule: 'R5_DUPLICATE_FILE',
        severity: 'block',
        message: '检测到完全相同的渲染文件 SHA-256，禁止重复上传',
        related_spec_id: dupFile.spec_id,
      });
    }
  }

  // Rule 6: Daily channel cap (new channel <= 2 in first 14d, else channelProfile.daily_cap)
  const effectiveCap = ctx.channelProfile.is_new_channel
    ? Math.min(ctx.channelProfile.daily_cap, 2)
    : ctx.channelProfile.daily_cap;
  const todayStr = now.toISOString().slice(0, 10);
  const todayCount = sortedHistory.filter((h) => (h.scheduled_at ?? h.created_at).startsWith(todayStr)).length;
  if (todayCount >= effectiveCap) {
    violations.push({
      rule: 'R6_CHANNEL_DAILY_CAP',
      severity: mode,
      message: `今日排期/生成已达频道上限 (${todayCount}/${effectiveCap})，将顺延至下一窗口`,
    });
  }

  // Rule 7: Cross-channel isolation combo & hash guard -> ALWAYS BLOCK
  const crossDup = ctx.crossChannelSpecs.find(
    (other) =>
      other.spec.axes.mechanic === candidate.axes.mechanic &&
      other.spec.axes.music_piece === candidate.axes.music_piece &&
      other.spec.axes.hook_style === candidate.axes.hook_style
  );
  if (crossDup) {
    violations.push({
      rule: 'R7_CROSS_CHANNEL_COMBO',
      severity: 'block',
      message: `跨频道禁止相同 mechanic+music_piece+hook_style 组合 (${candidate.axes.mechanic} / ${candidate.axes.music_piece})`,
      suggested_axes: ['mechanic', 'music_piece', 'hook_style'],
    });
  }
  if (ctx.candidateFileSha256) {
    const crossFile = ctx.crossChannelSpecs.find((other) => other.file_sha256 === ctx.candidateFileSha256);
    if (crossFile) {
      violations.push({
        rule: 'R7_CROSS_CHANNEL_FILE',
        severity: 'block',
        message: '跨频道素材文件哈希不得相同',
      });
    }
  }

  // Compute text similarity & heuristic visual/melody distances
  let maxTextSim = 0;
  let minVisualDist = 64;
  let maxMelodySim = 0;

  for (const h of sortedHistory.slice(0, 30)) {
    const tj = jaccard3Gram(candidate.publish.title, h.spec.publish.title);
    if (tj > maxTextSim) maxTextSim = tj;

    const sameArena = h.spec.axes.arena === candidate.axes.arena;
    const sameMech = h.spec.axes.mechanic === candidate.axes.mechanic;
    const sameRule = h.spec.axes.rule === candidate.axes.rule;
    const estDist = (sameMech ? 0 : 24) + (sameArena ? 0 : 18) + (sameRule ? 0 : 14) + 8;
    if (estDist < minVisualDist) minVisualDist = estDist;

    if (h.spec.axes.music_piece === candidate.axes.music_piece) {
      maxMelodySim = 1.0;
    } else if (h.spec.audio.music?.instrument === candidate.audio.music?.instrument) {
      maxMelodySim = Math.max(maxMelodySim, 0.32);
    }
  }

  if (maxTextSim > 0.7) {
    violations.push({
      rule: 'SIM_NEAR_DUPLICATE_TEXT',
      severity: mode,
      message: `标题 3-gram 相似度达 ${Math.round(maxTextSim * 100)}%（阈值 70%）`,
      suggested_axes: ['title_pattern'],
    });
  }

  // Score calculation (0-100)
  let score = 96;
  score -= Math.round(maxTextSim * 28);
  score -= Math.round(maxMelodySim * 20);
  if (minVisualDist < 20) score -= 18;
  for (const v of violations) {
    score -= v.severity === 'block' ? 24 : 14;
  }
  score = Math.max(0, Math.min(100, score));

  const hasBlock = violations.some((v) => v.severity === 'block') || (mode === 'block' && score < 60);
  const hasWarn = violations.length > 0 || score < 75;
  const verdict: NoveltyReport['verdict'] = hasBlock ? 'block' : hasWarn ? 'warn' : 'pass';

  const suggestionSet = new Set<string>();
  for (const v of violations) {
    for (const ax of v.suggested_axes ?? []) suggestionSet.add(ax);
  }

  return {
    score,
    verdict,
    violations,
    similarity: {
      visual_phash_distance: minVisualDist,
      melody_similarity: Number(maxMelodySim.toFixed(2)),
      text_jaccard: Number(maxTextSim.toFixed(2)),
    },
    suggested_changes: Array.from(suggestionSet),
  };
}

export interface AxisComboCandidate {
  mechanic: string;
  arena: string;
  rule: string;
  music_piece: string;
  hook_style: VideoSpec['axes']['hook_style'];
  title_pattern: VideoSpec['axes']['title_pattern'];
  ending: VideoSpec['axes']['ending'];
}

/**
 * Code-first axis combo sampler (docs 05 §4.1 + Bandit 60/30/10 weighting):
 * Samples novel combinations BEFORE passing them to LLM so LLM never mode-collapses,
 * biasing toward winning template arms from channel analytics when available.
 */
export function sampleNovelCombos(
  count: number,
  profile: ChannelProfile,
  melodyIds: string[],
  history: SpecRecord[],
  armWeights?: Record<string, number>
): AxisComboCandidate[] {
  const hookStyles: VideoSpec['axes']['hook_style'][] = ['mystery', 'prediction', 'escalation', 'countdown', 'contrast'];
  const titlePatterns: VideoSpec['axes']['title_pattern'][] = ['question', 'challenge', 'number-contrast', 'statement'];
  const recentCombos = new Set(
    history.slice(0, 15).map((h) => `${h.spec.axes.mechanic}|${h.spec.axes.arena}|${h.spec.axes.rule}|${h.spec.axes.music_piece}`)
  );
  const recentMusic = new Set(history.slice(0, 8).map((h) => h.spec.axes.music_piece));

  const pool: Array<AxisComboCandidate & { _priority: number }> = [];
  const allowedTemplates = profile.allowed_templates.filter((t) => Boolean(TEMPLATE_REGISTRY[t]));
  const templatesToUse = allowedTemplates.length > 0 ? allowedTemplates : ['melody-bounce', 'ball-sort'];

  // Prioritize recognizable classical public-domain melodies over synthetic ones when available
  const sortedMelodies = [...melodyIds].sort((a, b) => {
    const aPd = a.startsWith('pd:') ? 0 : 1;
    const bPd = b.startsWith('pd:') ? 0 : 1;
    return aPd - bPd;
  });

  // Sort templates by bandit arm weight (descending) if provided
  const orderedTemplates = [...templatesToUse].sort(
    (a, b) => (armWeights?.[b] ?? 0) - (armWeights?.[a] ?? 0)
  );

  for (let mRank = 0; mRank < orderedTemplates.length; mRank++) {
    const mech = orderedTemplates[mRank];
    const tmpl = TEMPLATE_REGISTRY[mech];
    const mechBonus = (orderedTemplates.length - mRank) * 10 + (armWeights?.[mech] ?? 0);
    for (const arena of tmpl.allowedAxes.arena) {
      for (const rule of tmpl.allowedAxes.rule) {
        for (let melIdx = 0; melIdx < sortedMelodies.length; melIdx++) {
          const music = sortedMelodies[melIdx];
          if (recentMusic.has(music)) continue;
          const key = `${mech}|${arena}|${rule}|${music}`;
          if (recentCombos.has(key)) continue;
          const idx = pool.length;
          const pdBonus = music.startsWith('pd:') ? 6 : 0;
          pool.push({
            mechanic: mech,
            arena,
            rule,
            music_piece: music,
            hook_style: hookStyles[idx % hookStyles.length],
            title_pattern: titlePatterns[idx % titlePatterns.length],
            ending: tmpl.allowedAxes.ending[idx % tmpl.allowedAxes.ending.length],
            _priority: mechBonus + pdBonus - melIdx * 0.2,
          });
        }
      }
    }
  }

  // Fallback if all melodies were recently used
  if (pool.length === 0) {
    for (let i = 0; i < count; i++) {
      const mech = orderedTemplates[i % orderedTemplates.length];
      const tmpl = TEMPLATE_REGISTRY[mech];
      pool.push({
        mechanic: mech,
        arena: tmpl.allowedAxes.arena[i % tmpl.allowedAxes.arena.length],
        rule: tmpl.allowedAxes.rule[i % tmpl.allowedAxes.rule.length],
        music_piece: sortedMelodies[i % Math.max(1, sortedMelodies.length)] ?? 'gen:pentatonic-5521',
        hook_style: hookStyles[i % hookStyles.length],
        title_pattern: titlePatterns[i % titlePatterns.length],
        ending: tmpl.allowedAxes.ending[i % tmpl.allowedAxes.ending.length],
        _priority: 1,
      });
    }
  }

  // Interleave winning core templates with adjacent/explore slots (60/30/10 feel without duplicating consecutive mechanics)
  const byMech = new Map<string, Array<AxisComboCandidate & { _priority: number }>>();
  for (const cand of pool) {
    if (!byMech.has(cand.mechanic)) byMech.set(cand.mechanic, []);
    byMech.get(cand.mechanic)!.push(cand);
  }
  for (const list of byMech.values()) {
    list.sort((a, b) => b._priority - a._priority);
  }

  const selected: AxisComboCandidate[] = [];
  const usedMusic = new Set<string>();
  let pass = 0;
  while (selected.length < count) {
    let pickedInPass = false;
    for (const mech of orderedTemplates) {
      if (selected.length >= count) break;
      const bucket = byMech.get(mech);
      if (!bucket || bucket.length === 0) continue;
      // Pick first unused melody in this bucket if possible
      const candidateIdx = bucket.findIndex((c) => !usedMusic.has(c.music_piece));
      const chosen = bucket.splice(candidateIdx >= 0 ? candidateIdx : 0, 1)[0];
      usedMusic.add(chosen.music_piece);
      const { _priority: _ignored, ...clean } = chosen;
      selected.push(clean);
      pickedInPass = true;
    }
    pass++;
    if (!pickedInPass || pass > count + 2) break;
  }
  return selected;
}
