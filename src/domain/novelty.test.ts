import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateNovelty } from './novelty';
import { FIXTURE_BALL_SORT, FIXTURE_MELODY_BOUNCE } from './templates';
import type { ChannelProfile } from './types';

const PROFILE_BLOCK: ChannelProfile = {
  channel_id: 'ch-1',
  locale: 'en-US',
  niche: 'physics-music',
  brand: {
    primary_color: '#0F172A',
    palette_family: 'neon',
    tone_rules: 'Concise and curious',
    forbidden_topics: [],
  },
  allowed_templates: ['melody-bounce', 'ball-sort'],
  review_mode: 'L0',
  trust_level: 0,
  novelty_mode: 'block',
  daily_cap: 3,
  is_new_channel: false,
  tz: 'America/New_York',
  posting_windows: [['17:00', '22:00']],
  ai_budget_monthly_usd: 5,
};

test('allows sufficiently different video across mechanics and music', () => {
  const report = evaluateNovelty(FIXTURE_BALL_SORT, {
    channelProfile: PROFILE_BLOCK,
    channelHistory: [
      {
        spec_id: 'sp-1',
        spec: FIXTURE_MELODY_BOUNCE,
        created_at: '2026-11-14T10:00:00Z',
      },
    ],
    crossChannelSpecs: [],
    now: new Date('2026-11-15T10:00:00Z'),
  });
  assert.equal(report.verdict, 'pass');
  assert.ok(report.score >= 75);
});

test('blocks consecutive same-mechanic/same-music videos when novelty_mode is block', () => {
  const dup = structuredClone(FIXTURE_MELODY_BOUNCE);
  dup.spec_key = 'mb-canon-hexagon-split-0009';
  const report = evaluateNovelty(dup, {
    channelProfile: PROFILE_BLOCK,
    channelHistory: [
      { spec_id: 'sp-1', spec: FIXTURE_MELODY_BOUNCE, created_at: '2026-11-14T10:00:00Z' },
      { spec_id: 'sp-2', spec: FIXTURE_MELODY_BOUNCE, created_at: '2026-11-13T10:00:00Z' },
    ],
    crossChannelSpecs: [],
    now: new Date('2026-11-15T10:00:00Z'),
  });
  assert.equal(report.verdict, 'block');
  assert.ok(report.violations.some((v) => v.rule === 'R5_DUPLICATE_TITLE'));
  assert.ok(report.violations.some((v) => v.rule === 'R3_MUSIC_14D_COOLDOWN'));
});

test('enforces cross-channel hard isolation on mechanic+music+hook_style combo', () => {
  const report = evaluateNovelty(FIXTURE_MELODY_BOUNCE, {
    channelProfile: { ...PROFILE_BLOCK, channel_id: 'ch-2', novelty_mode: 'warn' },
    channelHistory: [],
    crossChannelSpecs: [{ channel_id: 'ch-1', spec: FIXTURE_MELODY_BOUNCE }],
    now: new Date('2026-11-15T10:00:00Z'),
  });
  assert.equal(report.verdict, 'block');
  assert.ok(report.violations.some((v) => v.rule === 'R7_CROSS_CHANNEL_COMBO'));
});
