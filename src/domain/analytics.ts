import type { RemoteVideo } from './types.ts';

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function robustZ(val: number, series: number[]): number {
  if (series.length < 3) return 0;
  const med = median(series);
  const absDevs = series.map((x) => Math.abs(x - med));
  const mad = median(absDevs);
  let scale = 1.4826 * mad;
  if (scale < 1e-4) {
    const mean = series.reduce((a, b) => a + b, 0) / series.length;
    const variance = series.reduce((acc, x) => acc + (x - mean) ** 2, 0) / series.length;
    scale = Math.sqrt(variance);
  }
  if (scale < 1e-4) return 0;
  const z = (val - med) / scale;
  return Math.max(-3.5, Math.min(3.5, z));
}

/**
 * Computes 72h reward & tier (breakout / solid / flop) per docs 05 §8.1
 */
export function scoreChannelVideos(videos: RemoteVideo[]): RemoteVideo[] {
  const recentActive = videos.filter((v) => !v.is_legacy && v.views >= 300).slice(0, 30);
  if (recentActive.length === 0) return videos;

  const viewsList = recentActive.map((v) => v.views);
  const medianViews = median(viewsList);

  const stayedSeries = recentActive.map((v) => v.stayed_to_watch_pct);
  const pctSeries = recentActive.map((v) => Math.min(v.avg_view_pct, 150));
  const subRateSeries = recentActive.map((v) => (v.views > 0 ? ((v.subs_gained - v.subs_lost) / v.views) * 1000 : 0));
  const engageRateSeries = recentActive.map((v) => (v.views > 0 ? ((v.shares + v.comments) / v.views) * 1000 : 0));

  return videos.map((v) => {
    if (v.is_legacy || v.views < 300) {
      return { ...v, performance_tier: v.is_legacy ? 'pending' : v.views < 100 ? 'flop' : 'solid' };
    }
    const subRate = ((v.subs_gained - v.subs_lost) / v.views) * 1000;
    const engageRate = ((v.shares + v.comments) / v.views) * 1000;

    const reward =
      0.35 * robustZ(v.stayed_to_watch_pct, stayedSeries) +
      0.25 * robustZ(Math.min(v.avg_view_pct, 150), pctSeries) +
      0.25 * robustZ(subRate, subRateSeries) +
      0.15 * robustZ(engageRate, engageRateSeries);

    let tier: RemoteVideo['performance_tier'] = 'solid';
    if (v.views >= 10_000 || (medianViews > 0 && v.views >= 5 * medianViews)) {
      tier = 'breakout';
    } else if ((medianViews > 0 && v.views < 0.3 * medianViews) || reward < -1) {
      tier = 'flop';
    }

    return {
      ...v,
      reward_score: Number(reward.toFixed(2)),
      performance_tier: tier,
    };
  });
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDurationSeconds(raw: string): number {
  const s = raw.trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const parts = s.split(':').map((p) => Number(p.trim()));
    if (parts.some((n) => !Number.isFinite(n))) return 0;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
  }
  const val = Number(s.replace(/[%,\s]/g, ''));
  return Number.isFinite(val) ? val : 0;
}

function classifySeriesTag(title: string, isLegacy: boolean): string {
  if (isLegacy) return 'legacy-cn';
  const t = title.toLowerCase();
  if (t.includes('pendulum')) return 'pendulum-wave';
  if (t.includes('orbit') || t.includes('clocks') || t.includes('petals')) return 'orbit-sync';
  if (
    t.includes('canon') ||
    t.includes('elise') ||
    t.includes('ode to joy') ||
    t.includes('mountain king') ||
    t.includes('xylophone') ||
    t.includes('bouncing ball') ||
    t.includes('balls play') ||
    t.includes('slinkies')
  ) {
    return 'melody-bounce';
  }
  if ((t.includes('ball') && t.includes('bin')) || t.includes('ball sort')) return 'ball-sort';
  if (t.includes('sort')) return 'sorting-algo';
  return 'physics-misc';
}

/**
 * Parses YouTube Studio exported CSV (supporting English & Chinese Studio column headers).
 */
export function parseStudioCsv(csvText: string, channelId: string): RemoteVideo[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const findIdx = (exactPatterns: string[], fuzzyPatterns: string[] = []) => {
    const exact = headers.findIndex((h) => exactPatterns.includes(h));
    if (exact >= 0) return exact;
    return headers.findIndex((h) => fuzzyPatterns.some((p) => h.includes(p)));
  };

  const idxId = findIdx(['content', '内容'], ['video id', '内容']);
  const idxTitle = findIdx(['video title', '视频标题'], ['title', '标题']);
  const idxDate = findIdx(['video publish time', '视频发布时间'], ['publish', '发布时间']);
  const idxDur = findIdx(['duration', '时长'], ['duration', '时长']);
  const idxViews = findIdx(['views', '观看次数'], ['观看次数']);
  const idxEngaged = findIdx(['engaged views', '深度观看次数'], ['engaged', '深度观看']);
  const idxStayed = findIdx(['stayed to watch (%)', '继续观看 (%)'], ['stayed', '继续观看']);
  const idxAvgPct = findIdx(['average percentage viewed (%)', '平均观看百分比 (%)'], ['average percentage', '平均观看百分比']);
  const idxAvgSec = findIdx(['average view duration', '平均观看时长'], ['average view duration', '平均观看时长']);
  const idxSubsGained = findIdx(['subscribers gained', '获得的订阅人数'], ['subscribers gained', '获得的订阅']);
  const idxSubsLost = findIdx(['subscribers lost', '流失的订阅人数'], ['subscribers lost', '流失的订阅']);
  const idxWatchHours = findIdx(['watch time (hours)', '观看时长（小时）'], ['watch time', '观看时长（小时）']);
  const idxLikes = findIdx(['likes', '赞'], ['likes']);
  const idxComments = findIdx(['comments added', '添加的评论数'], ['comment', '评论']);
  const idxShares = findIdx(['shares', '分享数'], ['share', '分享']);

  const parsed: RemoteVideo[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = parseCsvLine(lines[r]);
    if (cols.length < 3) continue;
    const rawId = idxId >= 0 ? cols[idxId] : `csv-${r}`;
    if (!rawId || rawId.toLowerCase() === 'total' || rawId === '总计') continue;

    const num = (idx: number) => {
      if (idx < 0 || !cols[idx]) return 0;
      const cleaned = cols[idx].replace(/[%,\s]/g, '');
      if (!cleaned) return 0;
      const val = Number(cleaned);
      return Number.isFinite(val) ? val : 0;
    };

    const views = num(idxViews);
    const engaged = idxEngaged >= 0 ? num(idxEngaged) : Math.round(views * 0.44);
    const stayed =
      idxStayed >= 0 && cols[idxStayed]
        ? num(idxStayed)
        : views > 0
          ? Number(((engaged / views) * 100).toFixed(1))
          : 0;
    const title = (idxTitle >= 0 ? cols[idxTitle] : '') || rawId;
    const pubDate = (idxDate >= 0 ? cols[idxDate] : '') || new Date().toISOString();
    const isLegacy = /[\u4e00-\u9fa5]/.test(title);
    const durSec = idxDur >= 0 ? parseDurationSeconds(cols[idxDur]) : 24;
    const avgSec = idxAvgSec >= 0 ? parseDurationSeconds(cols[idxAvgSec]) : 20;

    parsed.push({
      id: `rv-${channelId}-${rawId}`,
      channel_id: channelId,
      yt_video_id: rawId,
      title,
      published_at: pubDate,
      privacy: 'public',
      duration_sec: durSec || 24,
      is_legacy: isLegacy,
      series_tag: classifySeriesTag(title, isLegacy),
      views,
      engaged_views: engaged,
      avg_view_pct: num(idxAvgPct) || 80,
      avg_view_sec: avgSec || 20,
      stayed_to_watch_pct: stayed,
      stayed_is_estimated: idxStayed < 0 || !cols[idxStayed],
      likes: num(idxLikes),
      comments: num(idxComments),
      shares: num(idxShares),
      subs_gained: num(idxSubsGained),
      subs_lost: num(idxSubsLost),
      watch_hours: num(idxWatchHours),
      last_synced: new Date().toISOString(),
    });
  }
  return scoreChannelVideos(parsed);
}
