import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScoreboardAndMix, evaluateChannelTrustLevel, findL1AutoApproveCandidates } from './bandit';
import type { ChannelProfile, RemoteVideo, ReviewRecord, SpecRecord, VideoRecord } from './types';
import { FIXTURE_MELODY_BOUNCE } from './templates';

const BASE_PROFILE: ChannelProfile = {
  channel_id: 'ch-1',
  locale: 'en-US',
  niche: 'physics',
  brand: { primary_color: '#000000', palette_family: 'neon', tone_rules: 'clean', forbidden_topics: [] },
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

test('computeScoreboardAndMix ranks arms and generates 60/30/10 mix', () => {
  const videos: RemoteVideo[] = [
    {
      id: 'rv-1',
      channel_id: 'ch-1',
      yt_video_id: 'v1',
      title: 'Canon in D',
      published_at: '2026-11-10T00:00:00Z',
      privacy: 'public',
      duration_sec: 26,
      is_legacy: false,
      series_tag: 'melody-bounce',
      views: 5000,
      engaged_views: 3000,
      avg_view_pct: 95,
      avg_view_sec: 24,
      stayed_to_watch_pct: 58,
      stayed_is_estimated: false,
      likes: 120,
      comments: 10,
      shares: 5,
      subs_gained: 15,
      subs_lost: 0,
      watch_hours: 30,
      reward_score: 1.4,
      last_synced: '2026-11-12T00:00:00Z',
    },
    {
      id: 'rv-2',
      channel_id: 'ch-1',
      yt_video_id: 'v2',
      title: 'Sort Test',
      published_at: '2026-11-10T00:00:00Z',
      privacy: 'public',
      duration_sec: 20,
      is_legacy: false,
      series_tag: 'ball-sort',
      views: 900,
      engaged_views: 320,
      avg_view_pct: 75,
      avg_view_sec: 15,
      stayed_to_watch_pct: 36,
      stayed_is_estimated: false,
      likes: 10,
      comments: 0,
      shares: 0,
      subs_gained: 1,
      subs_lost: 0,
      watch_hours: 3,
      reward_score: -0.4,
      last_synced: '2026-11-12T00:00:00Z',
    },
  ];
  const summary = computeScoreboardAndMix(videos, []);
  assert.equal(summary.arms.length, 2);
  assert.equal(summary.arms[0].arm, 'melody-bounce');
  assert.equal(summary.arms[0].allocationBucket, 'core_60');
});

test('evaluateChannelTrustLevel demotes on withdrawn video and promotes at 20 approvals', () => {
  const reviews: ReviewRecord[] = Array.from({ length: 20 }, (_, idx) => ({
    id: `r-${idx}`,
    channel_id: 'ch-1',
    render_id: `rnd-${idx}`,
    spec_id: `s-${idx}`,
    mode: 'L0',
    decision: 'approved',
    reason_tags: [],
    note: '',
    decided_by: 'op',
    decided_at: '2026-11-12T00:00:00Z',
  }));
  const promoted = evaluateChannelTrustLevel(BASE_PROFILE, reviews, []);
  assert.equal(promoted.recommendedMode, 'L1');
  assert.equal(promoted.recommendedTrustLevel, 1);

  const withdrawn: VideoRecord = {
    id: 'vid-1',
    channel_id: 'ch-1',
    spec_id: 's-1',
    render_id: 'rnd-1',
    yt_video_id: 'YT_1',
    idempotency_key: 'upload:vid-1',
    state: 'withdrawn',
    scheduled_at: '2026-11-12T00:00:00Z',
    published_at: '2026-11-12T00:00:00Z',
    privacy: 'private',
    title: 'Test',
    description: 'Desc',
    first_comment: '',
    first_comment_posted: false,
    quota_deferred: false,
  };
  const demoted = evaluateChannelTrustLevel({ ...BASE_PROFILE, review_mode: 'L2', trust_level: 2 }, reviews, [withdrawn]);
  assert.equal(demoted.recommendedMode, 'L0');
  assert.equal(demoted.recommendedTrustLevel, 0);
});

test('findL1AutoApproveCandidates picks specs waiting >= 8h in L1', () => {
  const oldSpec: SpecRecord = {
    id: 'spec-old',
    channel_id: 'ch-1',
    spec: FIXTURE_MELODY_BOUNCE,
    spec_hash: 'h1',
    schema_version: 'videospec/1',
    status: 'in_review',
    series_id: null,
    episode: null,
    created_at: '2026-11-10T00:00:00Z',
    updated_at: '2026-11-10T00:00:00Z',
  };
  const candidates = findL1AutoApproveCandidates(
    { ...BASE_PROFILE, review_mode: 'L1' },
    [oldSpec],
    new Date('2026-11-10T10:00:00Z')
  );
  assert.equal(candidates.length, 1);
});

import { parseStudioCsv } from './analytics';
import { sampleNovelCombos } from './novelty';

test('parseStudioCsv accurately parses Chinese Studio headers, HH:MM:SS duration, and views vs engaged views', () => {
  const csv = [
    '内容,视频标题,视频发布时间,时长,深度观看次数,平均观看时长,平均观看百分比 (%),继续观看 (%),获得的订阅人数,流失的订阅人数,观看次数,观看时长（小时）',
    '总计,,,,11847,0:00:21,80.37,43.85,18,3,27669,76.0077',
    'JTrpkr4ZGCo,Canon in D on a Bouncing Ball Xylophone,"Nov 7, 2026",32,855,0:00:23,75,44.38,4,0,1871,6.0338',
    'AvnsgYsX-Yg,14 Orbits That Realign After Exactly 75 Seconds,"Nov 10, 2026",80,524,0:00:46,58.6,54.7,0,0,975,6.94',
    'lxQEc1bRd78,小鱼儿与花无缺,"Nov 14, 2019",256,1,0:00:41,16.27,,0,0,1,0.0116',
  ].join('\n');

  const parsed = parseStudioCsv(csv, 'ch-1');
  assert.equal(parsed.length, 3);
  const canon = parsed.find((v) => v.yt_video_id === 'JTrpkr4ZGCo')!;
  assert.equal(canon.views, 1871);
  assert.equal(canon.engaged_views, 855);
  assert.equal(canon.avg_view_sec, 23);
  assert.equal(canon.stayed_to_watch_pct, 44.38);
  assert.equal(canon.subs_gained, 4);
  assert.equal(canon.series_tag, 'melody-bounce');
  assert.equal(canon.is_legacy, false);

  const orbit = parsed.find((v) => v.yt_video_id === 'AvnsgYsX-Yg')!;
  assert.equal(orbit.series_tag, 'orbit-sync');

  const legacy = parsed.find((v) => v.yt_video_id === 'lxQEc1bRd78')!;
  assert.equal(legacy.is_legacy, true);
  assert.equal(legacy.series_tag, 'legacy-cn');
});

test('sampleNovelCombos prioritizes top Bandit arm weights and classical pd melodies', () => {
  const combos = sampleNovelCombos(
    2,
    { ...BASE_PROFILE, allowed_templates: ['ball-sort', 'melody-bounce'] },
    ['gen:pentatonic-5521', 'pd:canon-in-d', 'pd:fur-elise'],
    [],
    { 'melody-bounce': 4.5, 'ball-sort': -1.0 }
  );
  assert.equal(combos.length, 2);
  assert.equal(combos[0].mechanic, 'melody-bounce');
  assert.equal(combos[0].music_piece.startsWith('pd:'), true);
});

