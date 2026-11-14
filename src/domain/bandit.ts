import type { ChannelProfile, RemoteVideo, ReviewRecord, SpecRecord, VideoRecord } from './types.ts';

export interface ArmScore {
  arm: string;
  count: number;
  totalViews: number;
  avgReward: number;
  avgStayedPct: number;
  subsPer1k: number;
  thompsonSampleScore: number;
  allocationBucket: 'core_60' | 'adjacent_30' | 'explore_10';
}

export interface WeeklyScoreboardSummary {
  arms: ArmScore[];
  recommendedMix: {
    core60: string[];
    adjacent30: string[];
    explore10: string[];
  };
  weeklyHighlight: string;
}

/**
 * Deterministic Thompson-like arm ranking & 60/30/10 weekly portfolio recommendation (docs 05 §4.3 & §8.2).
 */
export function computeScoreboardAndMix(videos: RemoteVideo[], specs: SpecRecord[]): WeeklyScoreboardSummary {
  const active = videos.filter((v) => !v.is_legacy);
  const specByTitle = new Map(specs.map((s) => [s.spec.publish.title.toLowerCase(), s]));

  const buckets = new Map<
    string,
    { count: number; views: number; subs: number; rewardSum: number; stayedSum: number }
  >();

  for (const v of active) {
    const linked = specByTitle.get(v.title.toLowerCase());
    const armKey = linked
      ? `${linked.spec.axes.mechanic} · ${linked.spec.axes.hook_style}`
      : `${v.series_tag || 'other'}`;

    const cur = buckets.get(armKey) ?? { count: 0, views: 0, subs: 0, rewardSum: 0, stayedSum: 0 };
    cur.count += 1;
    cur.views += v.views;
    cur.subs += v.subs_gained - v.subs_lost;
    cur.rewardSum += v.reward_score ?? 0;
    cur.stayedSum += v.stayed_to_watch_pct;
    buckets.set(armKey, cur);
  }

  const rawArms: ArmScore[] = Array.from(buckets.entries()).map(([arm, agg]) => {
    const avgReward = agg.count > 0 ? agg.rewardSum / agg.count : 0;
    const avgStayedPct = agg.count > 0 ? agg.stayedSum / agg.count : 0;
    const subsPer1k = agg.views > 0 ? (agg.subs / agg.views) * 1000 : 0;
    // Upper confidence / exploration bonus for low-N arms
    const explorationBonus = 1 / Math.sqrt(agg.count + 1);
    const tsScore = Number((avgReward + subsPer1k * 0.35 + (avgStayedPct - 45) * 0.04 + explorationBonus * 0.6).toFixed(2));
    return {
      arm,
      count: agg.count,
      totalViews: agg.views,
      avgReward: Number(avgReward.toFixed(2)),
      avgStayedPct: Number(avgStayedPct.toFixed(1)),
      subsPer1k: Number(subsPer1k.toFixed(2)),
      thompsonSampleScore: tsScore,
      allocationBucket: 'adjacent_30',
    };
  });

  rawArms.sort((a, b) => b.thompsonSampleScore - a.thompsonSampleScore);

  const arms = rawArms.map((a, idx) => {
    let allocationBucket: ArmScore['allocationBucket'] = 'adjacent_30';
    if (idx === 0 || idx < Math.ceil(rawArms.length * 0.3)) {
      allocationBucket = 'core_60';
    } else if (a.count <= 1 || idx === rawArms.length - 1) {
      allocationBucket = 'explore_10';
    }
    return { ...a, allocationBucket };
  });

  const core60 = arms.filter((a) => a.allocationBucket === 'core_60').map((a) => a.arm);
  const adjacent30 = arms.filter((a) => a.allocationBucket === 'adjacent_30').map((a) => a.arm);
  const explore10 = arms.filter((a) => a.allocationBucket === 'explore_10').map((a) => a.arm);

  const topArm = arms[0];
  const weeklyHighlight = topArm
    ? `本周主打 (${topArm.arm}) 均值继续观看 ${topArm.avgStayedPct}%、订阅转化 ${topArm.subsPer1k}/千播，建议下周维持 60% 主打 / 30% 邻近变体 / 10% 探索新规则。`
    : '暂无足够发布数据，建议先发布 5 条不同机制 Shorts 以建立 Thompson Sampling 基线。';

  return {
    arms,
    recommendedMix: {
      core60: core60.length ? core60 : ['melody-bounce · mystery'],
      adjacent30: adjacent30.length ? adjacent30 : ['ball-sort · prediction'],
      explore10: explore10.length ? explore10 : ['pendulum-wave · contrast'],
    },
    weeklyHighlight,
  };
}

export interface TrustEvaluationResult {
  recommendedMode: ChannelProfile['review_mode'];
  recommendedTrustLevel: number;
  reason: string;
}

/**
 * Trust-level promotion/demotion rules (docs 03 §4.5 & 08 Phase 2):
 * - L0 -> L1 after >= 20 clean approvals & 0 withdrawals
 * - Demote immediately to L0 if any recent withdrawal or >30% rejection rate
 */
export function evaluateChannelTrustLevel(
  profile: ChannelProfile,
  reviews: ReviewRecord[],
  videos: VideoRecord[]
): TrustEvaluationResult {
  const withdrawnCount = videos.filter((v) => v.state === 'withdrawn').length;
  if (withdrawnCount > 0) {
    return {
      recommendedMode: 'L0',
      recommendedTrustLevel: 0,
      reason: `检测到 ${withdrawnCount} 条事后撤回视频，按安全策略自动降级回 L0 全手动审核`,
    };
  }

  const recent20 = reviews.slice(0, 20);
  const approvedCount = recent20.filter((r) => r.decision === 'approved').length;
  const rejectedCount = recent20.filter((r) => r.decision === 'rejected').length;

  if (recent20.length >= 20 && rejectedCount === 0 && profile.trust_level < 1) {
    return {
      recommendedMode: 'L1',
      recommendedTrustLevel: 1,
      reason: '连续 20 条通过且无撤回，符合升级 L1（8h 超时自动过审）条件',
    };
  }

  if (recent20.length >= 40 && approvedCount >= 38 && profile.trust_level === 1) {
    return {
      recommendedMode: 'L2',
      recommendedTrustLevel: 2,
      reason: '连续 40 条高通过率且无撤回，符合升级 L2（仅高风险/20% 抽检）条件',
    };
  }

  return {
    recommendedMode: profile.review_mode,
    recommendedTrustLevel: profile.trust_level,
    reason: `当前累计审核 ${reviews.length} 条（L${profile.trust_level}），保持 ${profile.review_mode}`,
  };
}

/**
 * Finds specs eligible for L1 8-hour timeout auto-approval when Novelty Guard didn't block.
 */
export function findL1AutoApproveCandidates(
  profile: ChannelProfile,
  specs: SpecRecord[],
  now: Date = new Date()
): SpecRecord[] {
  if (profile.review_mode !== 'L1' && profile.review_mode !== 'L2') return [];
  const eightHoursMs = 8 * 3600 * 1000;
  return specs.filter(
    (s) => s.status === 'in_review' && now.getTime() - new Date(s.updated_at).getTime() >= eightHoursMs
  );
}
