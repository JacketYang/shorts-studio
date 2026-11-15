import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncAxesFromScene, validateImportPayload } from './videospec.ts';
import { scoreChannelVideos } from './analytics.ts';
import {
  ARC_PRESETS,
  EXPLORE_DIMENSION_WEIGHTS,
  FX_LEVELS,
  computeScoreboardAndMix,
} from './bandit.ts';
import { FIXTURE_MELODY_BOUNCE } from './templates.ts';
import type { RemoteVideo, VideoSpec } from './types.ts';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function mkVideo(i: number, o: Partial<RemoteVideo> = {}): RemoteVideo {
  return {
    id: `v${i}`,
    title: `Video ${i}`,
    views: 10_000,
    likes: 400,
    comments: 30,
    shares: 50,
    subs_gained: 80,
    subs_lost: 10,
    stayed_to_watch_pct: 45,
    avg_view_pct: 60,
    is_legacy: false,
    published_at: '2026-11-01T00:00:00Z',
    ...o,
  } as RemoteVideo;
}

const EMPTY_CTX = {
  channels: [{ id: 'ch-physics-music', slug: 'physics-music' } as never],
  melodies: [],
  existingSpecHashesByChannel: new Map<string, Set<string>>(),
  existingSpecKeysByChannel: new Map<string, Set<string>>(),
};

// ---------------------------------------------------------------------------
// 1) scene → axes 自动同步
// ---------------------------------------------------------------------------

test('scene.arc.preset 与 scene.style.fx.level 自动复制到 axes', () => {
  const raw = clone(FIXTURE_MELODY_BOUNCE);
  delete raw.axes.arc_preset;
  delete raw.axes.fx_level;

  const synced = syncAxesFromScene(raw) as VideoSpec;
  assert.equal(synced.axes.arc_preset, raw.scene.arc!.preset);
  assert.equal(synced.axes.fx_level, raw.scene.style!.fx!.level);
});

test('已显式写过的 axes 不被覆盖', () => {
  const raw = clone(FIXTURE_MELODY_BOUNCE);
  raw.axes.arc_preset = 'wave'; // 与 scene 的 ramp 故意不同
  const synced = syncAxesFromScene(raw) as VideoSpec;
  assert.equal(synced.axes.arc_preset, 'wave', '显式值优先');
});

test('旧 Spec（无 arc / fx）同步后 axes 仍为空，且不报错', () => {
  const raw = clone(FIXTURE_MELODY_BOUNCE);
  delete (raw.scene as { arc?: unknown }).arc;
  delete (raw.scene.style as { fx?: unknown }).fx;
  delete raw.axes.arc_preset;
  delete raw.axes.fx_level;

  const synced = syncAxesFromScene(raw) as VideoSpec;
  assert.equal(synced.axes.arc_preset, undefined);
  assert.equal(synced.axes.fx_level, undefined);

  // 校验阶段也不该因缺这两个字段报错
  const r = validateImportPayload(clone(raw), EMPTY_CTX);
  const errs = r.issues.filter(
    (i) => i.level === 'error' && (i.path.includes('arc_preset') || i.path.includes('fx_level')),
  );
  assert.equal(errs.length, 0, '旧 Spec 不应因缺 arc_preset / fx_level 报错');
});

// ---------------------------------------------------------------------------
// 2) 奖励权重
// ---------------------------------------------------------------------------

test('平均观看百分比先 min(…,100) 再计算', () => {
  const base = [0, 1, 2, 3, 4].map((i) =>
    mkVideo(i, {
      stayed_to_watch_pct: 40 + i * 5,
      avg_view_pct: 50 + i * 8,
      subs_gained: 60 + i * 15,
      shares: 30 + i * 20,
      likes: 300 + i * 60,
    }),
  );
  const at100 = base.map((v, i) => (i === 4 ? { ...v, avg_view_pct: 100 } : v));
  const at260 = base.map((v, i) => (i === 4 ? { ...v, avg_view_pct: 260 } : v));

  const r100 = scoreChannelVideos(at100).find((v) => v.id === 'v4')!;
  const r260 = scoreChannelVideos(at260).find((v) => v.id === 'v4')!;
  assert.equal(r260.reward_score, r100.reward_score, '超过 100 的部分不应计入奖励');
});

test('分享率单独成项，影响力大于平均观看百分比', () => {
  const base = [0, 1, 2, 3, 4].map((i) =>
    mkVideo(i, {
      stayed_to_watch_pct: 40 + i * 5,
      avg_view_pct: 50 + i * 8,
      subs_gained: 60 + i * 15,
      shares: 30 + i * 20,
      likes: 300 + i * 60,
    }),
  );
  const baseReward = scoreChannelVideos(base).find((v) => v.id === 'v4')!.reward_score!;

  const hiShare = base.map((v, i) => (i === 4 ? { ...v, shares: 900 } : v));
  const hiPct = base.map((v, i) => (i === 4 ? { ...v, avg_view_pct: 260 } : v));

  const shareGain = scoreChannelVideos(hiShare).find((v) => v.id === 'v4')!.reward_score! - baseReward;
  const pctGain = scoreChannelVideos(hiPct).find((v) => v.id === 'v4')!.reward_score! - baseReward;

  assert.ok(shareGain > 0, '分享数上升应抬高奖励');
  assert.ok(shareGain > pctGain, `分享权重(0.15)应高于百分比权重(0.15 且封顶)，实际 share=${shareGain.toFixed(2)} pct=${pctGain.toFixed(2)}`);
});

test('评论不再与分享合并计入同一个权重项', () => {
  // 只把评论拉高，奖励变化应小于把分享拉高同样的对数
  const base = [0, 1, 2, 3, 4].map((i) => mkVideo(i, { shares: 30 + i * 20, comments: 10 + i * 5 }));
  const baseReward = scoreChannelVideos(base).find((v) => v.id === 'v4')!.reward_score!;

  const hiComment = base.map((v, i) => (i === 4 ? { ...v, comments: 500 } : v));
  const commentGain = scoreChannelVideos(hiComment).find((v) => v.id === 'v4')!.reward_score! - baseReward;
  assert.equal(commentGain, 0, '评论已不在奖励公式里，拉高评论不应改变奖励');
});

// ---------------------------------------------------------------------------
// 3) bandit 双维度
// ---------------------------------------------------------------------------

test('arc_preset 与 fx_level 的探索权重低于 mechanic / music_piece', () => {
  assert.ok(EXPLORE_DIMENSION_WEIGHTS.arc_preset < EXPLORE_DIMENSION_WEIGHTS.mechanic);
  assert.ok(EXPLORE_DIMENSION_WEIGHTS.arc_preset < EXPLORE_DIMENSION_WEIGHTS.music_piece);
  assert.ok(EXPLORE_DIMENSION_WEIGHTS.fx_level < EXPLORE_DIMENSION_WEIGHTS.mechanic);
  assert.ok(EXPLORE_DIMENSION_WEIGHTS.fx_level < EXPLORE_DIMENSION_WEIGHTS.music_piece);
  assert.deepEqual([...ARC_PRESETS].sort(), ['countdown', 'drop', 'ramp', 'tease-then-build', 'wave']);
  assert.deepEqual([...FX_LEVELS], [2, 3]);
});

test('bandit 产出 arcArms / fxArms，且在无历史时给出启动值', () => {
  const summary = computeScoreboardAndMix([], []);
  assert.ok(Array.isArray(summary.arcArms));
  assert.ok(Array.isArray(summary.fxArms));
  assert.equal(summary.arcArms!.length, 0, '无历史时 arcArms 为空');
  assert.ok(
    (ARC_PRESETS as readonly string[]).includes(summary.explorationAssignments!.arcPreset!),
    '应给出一个合法的启动 arc',
  );
  assert.ok(summary.explorationAssignments!.fxLevel === 2 || summary.explorationAssignments!.fxLevel === 3);
});

test('bandit 按 arc / fx 分桶统计，并优先探索样本最少的取值', () => {
  const specs = [
    { spec: { ...clone(FIXTURE_MELODY_BOUNCE), axes: { ...clone(FIXTURE_MELODY_BOUNCE).axes, arc_preset: 'ramp', fx_level: 3 } } },
  ] as never[];

  const videos: RemoteVideo[] = [
    mkVideo(0, { title: FIXTURE_MELODY_BOUNCE.publish.title, reward_score: 1.2 }),
    mkVideo(1, { title: FIXTURE_MELODY_BOUNCE.publish.title, reward_score: 0.8 }),
  ];

  const summary = computeScoreboardAndMix(videos, specs);
  const arc = summary.arcArms!.find((a) => a.arm === 'ramp');
  const fx = summary.fxArms!.find((a) => a.arm === '3');
  assert.ok(arc, 'arcArms 应包含 ramp');
  assert.equal(arc!.count, 2);
  assert.ok(fx, 'fxArms 应包含 3');
  assert.equal(fx!.count, 2);

  // 只有一个 arc 取值时，探索档仍应指向它（样本最少的那个）
  assert.equal(summary.explorationAssignments!.arcPreset, 'ramp');
  assert.equal(summary.explorationAssignments!.fxLevel, 3);
});
