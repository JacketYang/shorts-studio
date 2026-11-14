import test from 'node:test';
import assert from 'node:assert/strict';
import { canConsumeQuota, computeQuotaSummary, findNextPublishSlot, YOUTUBE_QUOTA_COSTS } from './quota';
import type { ChannelProfile, QuotaLedgerEntry } from './types';

test('computes PT-day quota remaining and upload cap accurately', () => {
  const now = new Date('2026-11-15T20:00:00Z'); // 12:00 PT on 2026-11-15
  const ledger: QuotaLedgerEntry[] = [
    {
      id: 'q1',
      project_ref: 'proj-main',
      channel_id: 'ch-1',
      date_pt: '2026-11-15',
      units: YOUTUBE_QUOTA_COSTS['videos.insert'] * 2,
      op: 'videos.insert',
      ref: 'vid-1',
      created_at: now.toISOString(),
    },
  ];
  const summary = computeQuotaSummary(ledger, 'proj-main', 10_000, now);
  assert.equal(summary.used_units, 3200);
  assert.equal(summary.remaining_units, 6800);
  assert.equal(summary.global_daily_upload_cap, 4);
  assert.equal(summary.remaining_uploads_today, 4);

  const check = canConsumeQuota(ledger, 'proj-main', 'videos.insert', 10_000, now);
  assert.equal(check.allowed, true);
  assert.equal(check.cost, 1600);
});

test('schedules publish slots >= 3h apart within daily cap', () => {
  const profile: ChannelProfile = {
    channel_id: 'ch-1',
    locale: 'en-US',
    niche: 'physics-music',
    brand: { primary_color: '#0F172A', palette_family: 'neon', tone_rules: '', forbidden_topics: [] },
    allowed_templates: ['melody-bounce'],
    review_mode: 'L0',
    trust_level: 0,
    novelty_mode: 'warn',
    daily_cap: 3,
    is_new_channel: false,
    tz: 'America/New_York',
    posting_windows: [['17:00', '22:00']],
    ai_budget_monthly_usd: 5,
  };
  const slot1 = findNextPublishSlot(profile, [], new Date('2026-11-15T12:00:00Z'));
  const slot2 = findNextPublishSlot(
    profile,
    [
      {
        id: 'v1',
        channel_id: 'ch-1',
        spec_id: 's1',
        render_id: 'r1',
        yt_video_id: null,
        idempotency_key: 'upload:v1',
        state: 'scheduled',
        scheduled_at: slot1.scheduled_at,
        published_at: null,
        privacy: 'private',
        title: 't1',
        description: 'd1',
        first_comment: 'fc1',
        first_comment_posted: false,
        quota_deferred: false,
      },
    ],
    new Date('2026-11-15T12:00:00Z')
  );
  const diffHours = Math.abs(new Date(slot2.scheduled_at).getTime() - new Date(slot1.scheduled_at).getTime()) / 3600_000;
  assert.ok(diffHours >= 3);
});
