import type { ChannelProfile, QuotaLedgerEntry, VideoRecord } from './types.ts';

export const YOUTUBE_QUOTA_COSTS: Record<QuotaLedgerEntry['op'], number> = {
  'videos.insert': 1600,
  'videos.update': 50,
  'commentThreads.insert': 50,
  'comments.insert': 50,
  'comments.setModerationStatus': 50,
  'commentThreads.list': 1,
  'videos.delete': 50,
  'videos.list': 1,
  'playlistItems.list': 1,
  'playlistItems.insert': 50,
  'playlists.insert': 50,
  'channels.list': 1,
  'search.list': 100,
};

export const DEFAULT_DAILY_PROJECT_QUOTA = 10_000;
export const UPLOAD_QUOTA_SHARE = 0.64; // 6400 units -> 4 uploads/day across GCP project

/**
 * Returns YYYY-MM-DD in America/Los_Angeles (Pacific Time), where YouTube resets daily quota.
 */
export function getPacificDateString(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const month = parts.find((p) => p.type === 'month')?.value ?? '01';
  const day = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${year}-${month}-${day}`;
}

export interface QuotaSummary {
  project_ref: string;
  date_pt: string;
  daily_limit: number;
  used_units: number;
  remaining_units: number;
  upload_share_limit: number;
  remaining_uploads_today: number;
  global_daily_upload_cap: number;
}

export function computeQuotaSummary(
  ledger: QuotaLedgerEntry[],
  projectRef: string,
  dailyLimit: number = DEFAULT_DAILY_PROJECT_QUOTA,
  now: Date = new Date()
): QuotaSummary {
  const datePt = getPacificDateString(now);
  const used = ledger
    .filter((entry) => entry.project_ref === projectRef && entry.date_pt === datePt)
    .reduce((acc, e) => acc + e.units, 0);

  const remaining = Math.max(0, dailyLimit - used);
  const globalUploadCap = Math.floor((dailyLimit * UPLOAD_QUOTA_SHARE) / YOUTUBE_QUOTA_COSTS['videos.insert']);
  const remainingUploads = Math.floor(remaining / YOUTUBE_QUOTA_COSTS['videos.insert']);

  return {
    project_ref: projectRef,
    date_pt: datePt,
    daily_limit: dailyLimit,
    used_units: used,
    remaining_units: remaining,
    upload_share_limit: Math.floor(dailyLimit * UPLOAD_QUOTA_SHARE),
    remaining_uploads_today: remainingUploads,
    global_daily_upload_cap: globalUploadCap,
  };
}

export function canConsumeQuota(
  ledger: QuotaLedgerEntry[],
  projectRef: string,
  op: QuotaLedgerEntry['op'],
  dailyLimit: number = DEFAULT_DAILY_PROJECT_QUOTA,
  now: Date = new Date()
): { allowed: boolean; cost: number; remaining: number } {
  const cost = YOUTUBE_QUOTA_COSTS[op];
  const summary = computeQuotaSummary(ledger, projectRef, dailyLimit, now);
  return {
    allowed: summary.remaining_units >= cost,
    cost,
    remaining: summary.remaining_units,
  };
}

/**
 * Computes next valid publish slot respecting:
 * - channel posting windows
 * - >= 3 hours spacing from existing scheduled/published videos in the same channel
 * - channel daily_cap (new channels capped at 2 for first 14 days)
 */
export function findNextPublishSlot(
  profile: ChannelProfile,
  existingVideos: VideoRecord[],
  fromDate: Date = new Date()
): { scheduled_at: string; quota_deferred: boolean } {
  const effectiveCap = profile.is_new_channel ? Math.min(profile.daily_cap, 2) : profile.daily_cap;
  const occupiedTimes = existingVideos
    .filter((v) => v.channel_id === profile.channel_id && v.state !== 'withdrawn' && v.state !== 'failed')
    .map((v) => new Date(v.scheduled_at).getTime());

  const minSpacingMs = 3 * 3600 * 1000;
  const start = new Date(fromDate.getTime() + 2 * 3600 * 1000); // T+2h buffer

  for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
    const dayDate = new Date(start.getTime() + dayOffset * 86_400_000);
    const dayPrefix = dayDate.toISOString().slice(0, 10);
    const sameDayCount = existingVideos.filter(
      (v) => v.channel_id === profile.channel_id && v.scheduled_at.startsWith(dayPrefix) && v.state !== 'withdrawn'
    ).length;
    if (sameDayCount >= effectiveCap) continue;

    // Candidate hours derived from posting windows (default 17:00, 20:00 UTC)
    const candidateHours = [17, 20, 23, 14];
    for (const h of candidateHours) {
      const candidate = new Date(`${dayPrefix}T${String(h).padStart(2, '0')}:00:00.000Z`);
      if (candidate.getTime() < start.getTime()) continue;
      const tooClose = occupiedTimes.some((t) => Math.abs(t - candidate.getTime()) < minSpacingMs);
      if (!tooClose) {
        return { scheduled_at: candidate.toISOString(), quota_deferred: dayOffset > 0 };
      }
    }
  }

  return {
    scheduled_at: new Date(start.getTime() + 24 * 3600 * 1000).toISOString(),
    quota_deferred: true,
  };
}
