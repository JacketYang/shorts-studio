import fs from 'node:fs';
import { decryptSecret, signOAuthState } from './crypto.ts';
import type { CommentRecord, ReferenceVideoRecord, RemoteVideo, VideoRecord } from '../domain/types.ts';
import { resolveSecret } from './secrets.ts';

export const YOUTUBE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.force-ssl',
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
];

export function isYoutubeOAuthConfigured(): boolean {
  const cid = resolveSecret('google_client_id');
  const csec = resolveSecret('google_client_secret');
  return Boolean(cid && csec && !cid.startsWith('MY_') && !csec.startsWith('MY_'));
}

export function isYoutubeApiKeyConfigured(): boolean {
  const key = resolveSecret('youtube_api_key');
  return Boolean(key && !key.startsWith('MY_'));
}

export function getAppBaseUrl(): string {
  const rawBase =
    process.env.APP_URL ||
    'https://ais-dev-suiarb4hfe3gb5pgv4wcv5-106022029809.us-west2.run.app';
  const trimmed = rawBase.replace(/\/+$/, '');
  return trimmed.startsWith('http://') && !trimmed.includes('localhost')
    ? trimmed.replace(/^http:\/\//, 'https://')
    : trimmed;
}

/**
 * Constructs an HTTPS redirect URI strictly matching APP_URL (per AI Studio iframe/OAuth requirements).
 */
export function getYoutubeRedirectUri(): string {
  return `${getAppBaseUrl()}/api/auth/youtube/callback`;
}

export function buildYoutubeAuthUrl(channelId: string): { url: string; redirectUri: string } {
  const clientId = resolveSecret('google_client_id');
  if (!clientId || clientId.startsWith('MY_')) {
    throw new Error('未配置 GOOGLE_CLIENT_ID');
  }
  const redirectUri = getYoutubeRedirectUri();
  const state = signOAuthState({ channelId, ts: Date.now() });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: YOUTUBE_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
    state,
  });
  return {
    url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    redirectUri,
  };
}

export async function exchangeCodeForYoutubeTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}> {
  const clientId = resolveSecret('google_client_id')!;
  const clientSecret = resolveSecret('google_client_secret')!;
  const redirectUri = getYoutubeRedirectUri();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(String(data.error_description || data.error || 'OAuth token 换取失败'));
  }
  return {
    access_token: String(data.access_token),
    refresh_token: typeof data.refresh_token === 'string' ? data.refresh_token : undefined,
    expires_in: Number(data.expires_in ?? 3600),
    scope: typeof data.scope === 'string' ? data.scope : undefined,
  };
}

// In-memory short-lived access token cache (refresh tokens stay encrypted at rest)
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

export class YoutubeAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export async function getValidAccessTokenForChannel(
  channelId: string,
  encryptedRefreshToken: string
): Promise<string> {
  const cached = accessTokenCache.get(channelId);
  // Refresh 5 minutes before expiration (docs 06 §2)
  if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) {
    return cached.token;
  }

  const refreshToken = decryptSecret(encryptedRefreshToken);
  const clientId = resolveSecret('google_client_id')!;
  const clientSecret = resolveSecret('google_client_secret')!;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    const errCode = String(data.error || 'refresh_failed');
    if (errCode === 'invalid_grant' || res.status === 401) {
      throw new YoutubeAuthError('invalid_grant', 'YouTube 刷新令牌已失效 (invalid_grant)，需重新授权');
    }
    throw new Error(String(data.error_description || errCode));
  }

  const token = String(data.access_token);
  const expiresIn = Number(data.expires_in ?? 3600);
  accessTokenCache.set(channelId, { token, expiresAt: Date.now() + expiresIn * 1000 });
  return token;
}

export function clearAccessTokenCache(channelId: string): void {
  accessTokenCache.delete(channelId);
}

export async function fetchAuthorizedYoutubeChannel(accessToken: string): Promise<{
  yt_channel_id: string;
  title: string;
  uploads_playlist_id: string | null;
}> {
  const res = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&mine=true',
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: { title?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }>;
    error?: { message?: string };
  };
  if (!res.ok || !data.items || data.items.length === 0) {
    throw new Error(data.error?.message ?? '未找到授权的 YouTube 频道（请确认选择了拥有频道的品牌账号）');
  }
  const ch = data.items[0];
  return {
    yt_channel_id: ch.id,
    title: ch.snippet?.title ?? 'YouTube Channel',
    uploads_playlist_id: ch.contentDetails?.relatedPlaylists?.uploads ?? null,
  };
}

function parseIso8601Duration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

export async function syncRemoteVideosFromYoutubeApi(params: {
  channelId: string;
  accessToken: string;
  maxResults?: number;
}): Promise<{ videos: RemoteVideo[]; quotaUsed: number }> {
  let quotaUsed = 0;
  const chInfo = await fetchAuthorizedYoutubeChannel(params.accessToken);
  quotaUsed += 1;
  if (!chInfo.uploads_playlist_id) {
    return { videos: [], quotaUsed };
  }

  const max = Math.min(50, params.maxResults ?? 25);
  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${encodeURIComponent(
      chInfo.uploads_playlist_id
    )}&maxResults=${max}`,
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );
  const plData = (await plRes.json()) as {
    items?: Array<{ contentDetails?: { videoId?: string } }>;
    error?: { message?: string };
  };
  quotaUsed += 1;
  if (!plRes.ok) {
    throw new Error(plData.error?.message ?? '读取 uploads 播放列表失败');
  }

  const ids = (plData.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) {
    return { videos: [], quotaUsed };
  }

  const vidRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet,status,contentDetails,statistics&id=${ids.join(',')}`,
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );
  const vidData = (await vidRes.json()) as {
    items?: Array<{
      id: string;
      snippet?: { title?: string; publishedAt?: string };
      status?: { privacyStatus?: 'public' | 'unlisted' | 'private' };
      contentDetails?: { duration?: string };
      statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
    }>;
    error?: { message?: string };
  };
  quotaUsed += 1;
  if (!vidRes.ok) {
    throw new Error(vidData.error?.message ?? '获取视频统计详情失败');
  }

  const nowIso = new Date().toISOString();
  const remoteVideos: RemoteVideo[] = (vidData.items ?? []).map((item) => {
    const title = item.snippet?.title ?? item.id;
    const views = Number(item.statistics?.viewCount ?? 0);
    const dur = parseIso8601Duration(item.contentDetails?.duration ?? 'PT25S');
    const isLegacy = /[\u4e00-\u9fa5]/.test(title) || dur > 180;
    const engaged = Math.round(views * 0.45);
    return {
      id: `rv-${params.channelId}-${item.id}`,
      channel_id: params.channelId,
      yt_video_id: item.id,
      title,
      published_at: item.snippet?.publishedAt ?? nowIso,
      privacy: item.status?.privacyStatus ?? 'private',
      duration_sec: dur,
      is_legacy: isLegacy,
      series_tag: title.toLowerCase().includes('sort') ? 'ball-sort' : 'melody-bounce',
      views,
      engaged_views: engaged,
      avg_view_pct: 80,
      avg_view_sec: Math.round(dur * 0.8),
      stayed_to_watch_pct: views > 0 ? 45.0 : 0,
      stayed_is_estimated: true,
      likes: Number(item.statistics?.likeCount ?? 0),
      comments: Number(item.statistics?.commentCount ?? 0),
      shares: 0,
      subs_gained: 0,
      subs_lost: 0,
      watch_hours: Number(((views * dur * 0.8) / 3600).toFixed(2)),
      last_synced: nowIso,
    };
  });

  return { videos: remoteVideos, quotaUsed };
}

export async function resumableUploadVideoToYoutube(params: {
  accessToken: string;
  mp4Path: string;
  video: VideoRecord;
  tags: string[];
  categoryId: string;
  madeForKids: boolean;
  containsSyntheticMedia: boolean;
  defaultLanguage: string;
}): Promise<{ ytVideoId: string; privacyStatus: 'private' | 'unlisted' | 'public' }> {
  const fileBuf = fs.readFileSync(params.mp4Path);
  const metadata = {
    snippet: {
      title: params.video.title.slice(0, 100),
      description: params.video.description.slice(0, 5000),
      tags: params.tags.slice(0, 12),
      categoryId: params.categoryId || '24',
      defaultLanguage: params.defaultLanguage || 'en',
      defaultAudioLanguage: params.defaultLanguage || 'en',
    },
    status: {
      privacyStatus: 'private',
      publishAt: params.video.scheduled_at,
      selfDeclaredMadeForKids: params.madeForKids,
      containsSyntheticMedia: params.containsSyntheticMedia,
    },
  };

  const initRes = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(fileBuf.byteLength),
        'X-Upload-Content-Type': 'video/mp4',
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initRes.ok) {
    const errBody = await initRes.text();
    if (errBody.includes('quotaExceeded')) {
      throw new YoutubeAuthError('quotaExceeded', 'YouTube API 日配额已耗尽 (quotaExceeded)');
    }
    if (errBody.includes('uploadLimitExceeded')) {
      throw new YoutubeAuthError('uploadLimitExceeded', '该频道今日上传数已达 YouTube 平台限制');
    }
    throw new Error(`初始化可续传上传失败 (${initRes.status}): ${errBody.slice(0, 200)}`);
  }

  const uploadUrl = initRes.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube 未返回 resumable upload Location URL');
  }

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Length': String(fileBuf.byteLength),
      'Content-Type': 'video/mp4',
    },
    body: fileBuf,
  });

  const putData = (await putRes.json()) as {
    id?: string;
    status?: { privacyStatus?: 'private' | 'unlisted' | 'public' };
    error?: { message?: string };
  };
  if (!putRes.ok || !putData.id) {
    throw new Error(putData.error?.message ?? `上传视频分片失败 (${putRes.status})`);
  }

  return {
    ytVideoId: putData.id,
    privacyStatus: putData.status?.privacyStatus ?? 'private',
  };
}

export async function postFirstCommentOnYoutube(params: {
  accessToken: string;
  ytChannelId: string;
  ytVideoId: string;
  text: string;
}): Promise<string> {
  const res = await fetch('https://www.googleapis.com/youtube/v3/commentThreads?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        channelId: params.ytChannelId,
        videoId: params.ytVideoId,
        topLevelComment: {
          snippet: { textOriginal: params.text.slice(0, 200) },
        },
      },
    }),
  });
  const data = (await res.json()) as { id?: string; error?: { message?: string } };
  if (!res.ok || !data.id) {
    throw new Error(data.error?.message ?? '发布首评失败');
  }
  return data.id;
}

export async function verifyYoutubeVideoPublicStatus(params: {
  accessToken?: string;
  ytVideoId: string;
}): Promise<{ privacyStatus: string; uploadStatus: string; isPublic: boolean }> {
  const apiKey = resolveSecret('youtube_api_key');
  const url = params.accessToken
    ? `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(params.ytVideoId)}`
    : `https://www.googleapis.com/youtube/v3/videos?part=status&id=${encodeURIComponent(params.ytVideoId)}&key=${apiKey}`;

  const res = await fetch(
    url,
    params.accessToken ? { headers: { Authorization: `Bearer ${params.accessToken}` } } : undefined
  );
  const data = (await res.json()) as {
    items?: Array<{ status?: { privacyStatus?: string; uploadStatus?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok || !data.items?.[0]) {
    throw new Error(data.error?.message ?? '未找到对应远端视频');
  }
  const st = data.items[0].status;
  const privacyStatus = st?.privacyStatus ?? 'unknown';
  return {
    privacyStatus,
    uploadStatus: st?.uploadStatus ?? 'unknown',
    isPublic: privacyStatus === 'public',
  };
}

export async function updateYoutubeVideoPrivacy(params: {
  accessToken: string;
  ytVideoId: string;
  privacyStatus: 'private' | 'unlisted' | 'public';
}): Promise<void> {
  const res = await fetch('https://www.googleapis.com/youtube/v3/videos?part=status', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: params.ytVideoId,
      status: { privacyStatus: params.privacyStatus },
    }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? '更新视频隐私状态失败');
  }
}

export async function updateYoutubeVideoMetadata(params: {
  accessToken: string;
  ytVideoId: string;
  title: string;
  description?: string;
  tags?: string[];
}): Promise<{ quotaUsed: number }> {
  const existingRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${encodeURIComponent(params.ytVideoId)}`,
    { headers: { Authorization: `Bearer ${params.accessToken}` } }
  );
  const existingData = (await existingRes.json()) as {
    items?: Array<{
      snippet?: {
        title?: string;
        description?: string;
        tags?: string[];
        categoryId?: string;
        defaultLanguage?: string;
      };
    }>;
    error?: { message?: string };
  };

  if (!existingRes.ok || !existingData.items?.[0]?.snippet) {
    throw new Error(existingData.error?.message ?? '获取远端视频现有 snippet 失败');
  }

  const prev = existingData.items[0].snippet;
  const putRes = await fetch('https://www.googleapis.com/youtube/v3/videos?part=snippet', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: params.ytVideoId,
      snippet: {
        title: params.title.slice(0, 100),
        description: (params.description ?? prev.description ?? '').slice(0, 5000),
        tags: (params.tags ?? prev.tags ?? []).slice(0, 15),
        categoryId: prev.categoryId || '24',
        defaultLanguage: prev.defaultLanguage || 'en',
      },
    }),
  });

  if (!putRes.ok) {
    const putErr = (await putRes.json()) as { error?: { message?: string } };
    throw new Error(putErr.error?.message ?? '更新 YouTube 视频元数据失败');
  }

  return { quotaUsed: 51 };
}

export async function deleteYoutubeVideo(params: {
  accessToken: string;
  ytVideoId: string;
}): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(params.ytVideoId)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    }
  );
  if (!res.ok) {
    const data = (await res.json()) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? '删除远端视频失败');
  }
}

export async function fetchChannelCommentsFromYoutube(params: {
  channelId: string;
  ytChannelId: string;
  accessToken?: string;
}): Promise<CommentRecord[]> {
  const key = resolveSecret('youtube_api_key');
  const base = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${encodeURIComponent(
    params.ytChannelId
  )}&maxResults=25&order=time`;
  const url = params.accessToken ? base : `${base}&key=${encodeURIComponent(key || '')}`;
  const res = await fetch(
    url,
    params.accessToken ? { headers: { Authorization: `Bearer ${params.accessToken}` } } : undefined
  );
  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      snippet?: {
        videoId?: string;
        topLevelComment?: {
          id: string;
          snippet?: {
            authorDisplayName?: string;
            authorChannelId?: { value?: string };
            textDisplay?: string;
            publishedAt?: string;
          };
        };
      };
      replies?: {
        comments?: Array<{
          id: string;
          snippet?: {
            authorDisplayName?: string;
            textDisplay?: string;
            publishedAt?: string;
          };
        }>;
      };
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(data.error?.message ?? '拉取频道评论失败');
  }

  const out: CommentRecord[] = [];
  for (const thread of data.items ?? []) {
    const top = thread.snippet?.topLevelComment;
    const isFirstCommentByOwner = top?.snippet?.authorChannelId?.value === params.ytChannelId;
    const videoId = thread.snippet?.videoId ?? '';

    if (isFirstCommentByOwner && thread.replies?.comments?.length) {
      for (const rep of thread.replies.comments) {
        const text = rep.snippet?.textDisplay ?? '';
        const isQ = text.includes('?');
        out.push({
          id: `cmt-${rep.id}`,
          channel_id: params.channelId,
          yt_comment_id: rep.id,
          yt_video_id: videoId,
          video_title: videoId,
          author: rep.snippet?.authorDisplayName ?? 'Viewer',
          text,
          is_reply_to_first_comment: true,
          is_question: isQ,
          priority_score: 100 + (isQ ? 20 : 0),
          status: 'inbox',
          created_at: rep.snippet?.publishedAt ?? new Date().toISOString(),
        });
      }
    } else if (top) {
      const text = top.snippet?.textDisplay ?? '';
      const isQ = text.includes('?');
      out.push({
        id: `cmt-${top.id}`,
        channel_id: params.channelId,
        yt_comment_id: top.id,
        yt_video_id: videoId,
        video_title: videoId,
        author: top.snippet?.authorDisplayName ?? 'Viewer',
        text,
        is_reply_to_first_comment: false,
        is_question: isQ,
        priority_score: isQ ? 80 : 50,
        status: 'inbox',
        created_at: top.snippet?.publishedAt ?? new Date().toISOString(),
      });
    }
  }
  return out;
}

export async function replyToYoutubeComment(params: {
  accessToken: string;
  parentCommentId: string;
  text: string;
}): Promise<void> {
  const res = await fetch('https://www.googleapis.com/youtube/v3/comments?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        parentId: params.parentCommentId,
        textOriginal: params.text.slice(0, 200),
      },
    }),
  });
  if (!res.ok) {
    const data = (await res.json()) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? '发送评论回复失败');
  }
}

export async function moderateYoutubeComment(params: {
  accessToken: string;
  commentId: string;
  status: 'heldForReview' | 'rejected';
}): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/comments/setModerationStatus?id=${encodeURIComponent(
      params.commentId
    )}&moderationStatus=${params.status}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${params.accessToken}` },
    }
  );
  if (!res.ok) {
    const data = (await res.json()) as { error?: { message?: string } };
    throw new Error(data.error?.message ?? '评论审核隐藏失败');
  }
}

/**
 * Fetches public YouTube RSS (0 quota units) + batches videos.list (1 quota unit per 50 IDs)
 * to discover outlier videos (>= 5x median views) per docs 05 §7.1 & §7.2.
 */
export async function pollReferenceChannelOutliers(params: {
  channelId: string;
  refChannelId: string;
  refChannelName: string;
  ytChannelId: string;
}): Promise<{ videos: ReferenceVideoRecord[]; quotaUsed: number }> {
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(params.ytChannelId)}`;
  const rssRes = await fetch(rssUrl);
  if (!rssRes.ok) {
    throw new Error(`RSS 抓取失败 (${rssRes.status})`);
  }
  const xml = await rssRes.text();

  const entries: Array<{ videoId: string; title: string; published: string }> = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(xml)) !== null && entries.length < 15) {
    const block = m[1];
    const vid = block.match(/<yt:videoId>(.*?)<\/yt:videoId>/)?.[1]?.trim();
    const title = block.match(/<title>(.*?)<\/title>/)?.[1]?.trim() ?? '';
    const pub = block.match(/<published>(.*?)<\/published>/)?.[1]?.trim() ?? new Date().toISOString();
    if (vid) entries.push({ videoId: vid, title, published: pub });
  }
  if (entries.length === 0) return { videos: [], quotaUsed: 0 };

  let quotaUsed = 0;
  const viewsById = new Map<string, number>();
  const apiKey = resolveSecret('youtube_api_key');
  if (apiKey && !apiKey.startsWith('MY_')) {
    const statsRes = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${entries
        .map((e) => e.videoId)
        .join(',')}&key=${encodeURIComponent(apiKey)}`
    );
    quotaUsed += 1;
    if (statsRes.ok) {
      const statsData = (await statsRes.json()) as {
        items?: Array<{ id: string; statistics?: { viewCount?: string } }>;
      };
      for (const item of statsData.items ?? []) {
        viewsById.set(item.id, Number(item.statistics?.viewCount ?? 0));
      }
    }
  }

  const allViews = entries.map((e) => viewsById.get(e.videoId) ?? 0).sort((a, b) => a - b);
  const median = allViews.length > 0 ? allViews[Math.floor(allViews.length / 2)] : 1;
  const denom = Math.max(median, 1);

  const videos: ReferenceVideoRecord[] = entries.map((e) => {
    const v = viewsById.get(e.videoId) ?? 0;
    const lower = e.title.toLowerCase();
    return {
      id: `refv-${params.refChannelId}-${e.videoId}`,
      channel_id: params.channelId,
      ref_channel_id: params.refChannelId,
      ref_channel_name: params.refChannelName,
      yt_video_id: e.videoId,
      title: e.title,
      published_at: e.published,
      views: v,
      outlier_ratio: Number((v / denom).toFixed(1)),
      extracted_axes: {
        mechanic_guess: lower.includes('sort') || lower.includes('bin') ? 'ball-sort' : 'melody-bounce',
        hook_guess: lower.includes('?') ? 'mystery' : 'escalation',
        title_pattern: lower.includes('?') ? 'question' : 'statement',
      },
    };
  });

  return { videos, quotaUsed };
}

export async function addVideoToYoutubePlaylist(params: {
  accessToken: string;
  ytVideoId: string;
  playlistTitle: string;
  playlistDescription?: string;
}): Promise<{ playlistId: string; playlistTitle: string; createdNew: boolean; quotaUsed: number }> {
  let quotaUsed = 0;
  const listRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50', {
    headers: { Authorization: `Bearer ${params.accessToken}` },
  });
  const listData = (await listRes.json()) as {
    items?: Array<{ id: string; snippet?: { title?: string } }>;
    error?: { message?: string };
  };
  quotaUsed += 1;
  if (!listRes.ok) {
    throw new Error(listData.error?.message ?? '查询播放列表失败');
  }

  let playlist = (listData.items ?? []).find(
    (p) => (p.snippet?.title ?? '').trim().toLowerCase() === params.playlistTitle.trim().toLowerCase()
  );
  let createdNew = false;

  if (!playlist) {
    const createRes = await fetch('https://www.googleapis.com/youtube/v3/playlists?part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        snippet: {
          title: params.playlistTitle.slice(0, 150),
          description: (params.playlistDescription ?? 'Automated series playlist by Shorts Studio').slice(0, 5000),
        },
        status: { privacyStatus: 'public' },
      }),
    });
    const createData = (await createRes.json()) as {
      id?: string;
      snippet?: { title?: string };
      error?: { message?: string };
    };
    quotaUsed += 50;
    if (!createRes.ok || !createData.id) {
      throw new Error(createData.error?.message ?? '创建系列播放列表失败');
    }
    playlist = { id: createData.id, snippet: { title: createData.snippet?.title ?? params.playlistTitle } };
    createdNew = true;
  }

  const insertRes = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?part=snippet', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      snippet: {
        playlistId: playlist.id,
        resourceId: {
          kind: 'youtube#video',
          videoId: params.ytVideoId,
        },
      },
    }),
  });
  const insertData = (await insertRes.json()) as { error?: { message?: string } };
  quotaUsed += 50;
  if (!insertRes.ok) {
    throw new Error(insertData.error?.message ?? '将视频加入播放列表失败');
  }

  return {
    playlistId: playlist.id,
    playlistTitle: playlist.snippet?.title ?? params.playlistTitle,
    createdNew,
    quotaUsed,
  };
}

export async function searchChannelByQuery(query: string): Promise<{ yt_channel_id: string; title: string } | null> {
  const apiKey = resolveSecret('youtube_api_key');
  if (!apiKey || apiKey.startsWith('MY_')) {
    throw new Error('未配置 YOUTUBE_API_KEY');
  }
  const res = await fetch(
    `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=1&q=${encodeURIComponent(
      query
    )}&key=${encodeURIComponent(apiKey)}`
  );
  const data = (await res.json()) as {
    items?: Array<{ id?: { channelId?: string }; snippet?: { title?: string } }>;
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(data.error?.message ?? 'search.list 解析频道失败');
  const first = data.items?.[0];
  if (!first?.id?.channelId) return null;
  return {
    yt_channel_id: first.id.channelId,
    title: first.snippet?.title ?? query,
  };
}
