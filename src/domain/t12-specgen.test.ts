import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateImportPayload } from './videospec.ts';
import { DEFAULT_AI_CONFIG, normalizeAiConfig } from '../server/store.ts';
import {
  FIXTURE_BALL_SORT,
  FIXTURE_MELODY_BOUNCE,
  FIXTURE_ORBIT_SYNC,
  FIXTURE_PENDULUM_WAVE,
  FIXTURE_RINGS_ESCAPE,
} from './templates.ts';
import { countDifferentAxes, evaluateNovelty, STRUCTURAL_AXES_VISIBLE } from './novelty.ts';
import type { VideoSpec } from './types.ts';

const ALL_FIXTURES: VideoSpec[] = [
  FIXTURE_MELODY_BOUNCE,
  FIXTURE_BALL_SORT,
  FIXTURE_PENDULUM_WAVE,
  FIXTURE_ORBIT_SYNC,
  FIXTURE_RINGS_ESCAPE,
];

const EMPTY_CTX = {
  channels: [{ id: 'ch-physics-music', slug: 'physics-music' } as never],
  melodies: [],
  existingSpecHashesByChannel: new Map<string, Set<string>>(),
  existingSpecKeysByChannel: new Map<string, Set<string>>(),
};

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ---------------------------------------------------------------------------
// 提示词
// ---------------------------------------------------------------------------

test('specgen_system 完整替换为新版：包含 twist / 强度下限 / schema-only 要求', () => {
  const p = DEFAULT_AI_CONFIG.prompts.specgen_system;
  assert.ok(p.length > 1000, `新版提示词应显著变长，实际 ${p.length}`);
  for (const needle of [
    'concept.twist',
    '强度下限',
    'scene.arc.preset',
    'scene.style.fx.level',
    '≥ 12°/s',
    'balls.speed ≥ 0.8',
    'every_n_bounces ≤ 3',
    '只输出符合 schema 的 JSON',
  ]) {
    assert.ok(p.includes(needle), `提示词应包含「${needle}」`);
  }
  // 旧版是英文的，替换后不应再出现旧规则编号
  assert.ok(!p.includes('must be <= 6 words and deliver instant visual+audio payoff'));
});

test('next_episode 提示词要求升一级强度且 twist 必须不同', () => {
  const p = DEFAULT_AI_CONFIG.prompts.next_episode;
  assert.ok(p.includes('升一级'), '应要求强度升一级');
  assert.ok(p.includes('twist'), '应要求 twist');
  assert.ok(p.includes('不同'), '应要求 twist 与上一集不同');
  assert.ok(p.includes('至少') || p.includes('两项'), '应要求改动至少两项');
});

test('normalizeAiConfig 在缺省时回落到新版提示词', () => {
  const cfg = normalizeAiConfig(null);
  assert.equal(cfg.prompts.specgen_system, DEFAULT_AI_CONFIG.prompts.specgen_system);
  assert.ok(cfg.prompts.specgen_system.length > 20);
});

// ---------------------------------------------------------------------------
// fixture 补全
// ---------------------------------------------------------------------------

test('4 个主 fixture 都补齐了 fx / arc / hud / twist', () => {
  for (const f of ALL_FIXTURES) {
    const name = f.spec_key;
    assert.ok(f.scene.arc?.preset, `${name} 缺 scene.arc.preset`);
    assert.ok(typeof f.scene.style?.fx?.level === 'number', `${name} 缺 scene.style.fx.level`);
    assert.ok((f.scene.style!.fx!.level as number) >= 2, `${name} 的 fx.level 应 ≥ 2`);
    assert.ok(f.scene.hud?.counter, `${name} 缺 scene.hud`);
    assert.ok(typeof f.concept.twist === 'string' && f.concept.twist!.length >= 12, `${name} 的 twist 应 ≥ 12 字符`);
  }
});

test('补全后的 fixture 不再触发 W106 / W107', () => {
  for (const f of ALL_FIXTURES) {
    const r = validateImportPayload(clone(f), EMPTY_CTX);
    const codes = r.issues.map((i) => i.code);
    assert.ok(!codes.includes('W106'), `${f.spec_key} 不应触发 W106`);
    assert.ok(!codes.includes('W107'), `${f.spec_key} 不应触发 W107`);
  }
});

// ---------------------------------------------------------------------------
// 旧 Spec 兼容
// ---------------------------------------------------------------------------

test('旧 Spec（无 fx / arc / twist）仍可导入，只触发 W106 / W107 警告', () => {
  const old = clone(FIXTURE_MELODY_BOUNCE);
  delete (old.scene as { arc?: unknown }).arc;
  delete (old.scene.style as { fx?: unknown }).fx;
  delete (old.concept as { twist?: unknown }).twist;
  old.concept.novelty_notes =
    'Structural change: split interval tightens every 2 bounces instead of 3, audibly faster note clustering.';

  const r = validateImportPayload(old, EMPTY_CTX);

  const warnCodes = r.issues.filter((i) => i.level === 'warn').map((i) => i.code);
  assert.ok(warnCodes.includes('W106'), '应触发 W106（未设置 scene.arc）');
  assert.ok(warnCodes.includes('W107'), '应触发 W107（fx.level < 2）');

  // 不能因为缺 fx/arc/twist 就报错
  const errors = r.issues.filter((i) => i.level === 'error' && (i.code === 'W106' || i.code === 'W107'));
  assert.equal(errors.length, 0, 'W106/W107 必须只是警告');
});

test('W108 在高潮距结尾不足 0.8 秒时触发', () => {
  // duration 下限是 8 秒；8s × climax 0.95 = 7.6s，距结尾仅 0.4s
  const bad = clone(FIXTURE_MELODY_BOUNCE);
  bad.format.duration_sec = 8;
  bad.scene.arc = { preset: 'drop', climax_at: 0.95, hook_peek: true };
  const r = validateImportPayload(bad, EMPTY_CTX);
  assert.ok(r.issues.some((i) => i.code === 'W108'), '高潮太靠后应触发 W108');
});

test('W108 不因模板建议区间而误报（22/24 秒的成片是合法的）', () => {
  // 这些是能正常出片的真实 fixture，arc 与 duration 自洽，不该告警
  for (const f of [FIXTURE_MELODY_BOUNCE, FIXTURE_BALL_SORT, FIXTURE_PENDULUM_WAVE, FIXTURE_ORBIT_SYNC]) {
    const r = validateImportPayload(clone(f), EMPTY_CTX);
    assert.ok(
      !r.issues.some((i) => i.code === 'W108'),
      `${f.spec_key}（${f.format.duration_sec}s）不该触发 W108`,
    );
  }
});

test('W108 在高潮距结尾过近时触发', () => {
  // climax_at 上限是 0.95。取 dur=10s、climax_at=0.95：
  //   高潮在 9.5s，距结尾仅 0.5s < 0.8s → 触发
  //   同时 10s 也低于 melody-bounce 建议的 24–38s → 同样触发
  const bad = clone(FIXTURE_MELODY_BOUNCE);
  bad.format.duration_sec = 10;
  bad.scene.arc = { preset: 'drop', climax_at: 0.95, hook_peek: true };
  const r = validateImportPayload(bad, EMPTY_CTX);
  assert.ok(r.issues.some((i) => i.code === 'W108'), 'climax 太靠后且时长过短应触发 W108');
});

// ---------------------------------------------------------------------------
// novelty：arc.preset / fx.level 是非结构性差异
// ---------------------------------------------------------------------------

test('arc.preset 与 fx.level 不计入结构性差异', () => {
  const a = clone(FIXTURE_MELODY_BOUNCE);
  const b = clone(FIXTURE_MELODY_BOUNCE);
  b.scene.arc = { preset: 'drop', climax_at: 0.9, hook_peek: true };
  b.scene.style.fx = { level: 3 };

  // axes 完全一样 → 结构性差异应为 0
  assert.equal(countDifferentAxes(a.axes, b.axes), 0);

  // 结构性轴里不应出现 arc / fx
  const names = STRUCTURAL_AXES_VISIBLE.join(',');
  assert.ok(!names.includes('arc'), 'arc 不应是结构性轴');
  assert.ok(!names.includes('fx'), 'fx 不应是结构性轴');
});

test('只改 arc.preset + fx.level 的重复 mechanic+music 组合仍被判为重复', () => {
  const hist = clone(FIXTURE_MELODY_BOUNCE);
  hist.spec_key = 'hist-0001';
  hist.axes.arena = 'circle';
  hist.axes.rule = 'grow-on-bounce';
  hist.concept.novelty_notes =
    'Structural change: arena grew to 0.9 and the rule switched to grow-on-bounce, altering bounce cadence.';

  const cand = clone(FIXTURE_MELODY_BOUNCE);
  cand.spec_key = 'cand-0001';
  cand.scene.arc = { preset: 'drop', climax_at: 0.9, hook_peek: true };
  cand.scene.style.fx = { level: 3 };
  cand.concept.novelty_notes =
    'Structural: identical chamber and melody, only the intensity curve and FX level were retuned for a harder drop.';

  const rep = evaluateNovelty(cand, {
    channelProfile: { novelty_mode: 'warn', allowed_templates: ['melody-bounce'] } as never,
    channelHistory: [
      {
        spec_id: 'hist-0001',
        spec: hist,
        created_at: new Date().toISOString(),
        scheduled_at: new Date().toISOString(),
      } as never,
    ],
    crossChannelSpecs: [],
    now: new Date(),
  });

  const rules = rep.violations.map((v) => v.rule);
  assert.ok(rules.includes('R3_MUSIC_14D_COOLDOWN'), `应命中音乐冷却，实际 ${rules.join(',')}`);
  assert.ok(rep.score < 100, `只换 arc/fx 的重复组合不应拿满分，实际 ${rep.score}`);
});
