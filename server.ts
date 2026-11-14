import 'dotenv/config';
import express from 'express';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseStudioCsv, scoreChannelVideos } from './src/domain/analytics.ts';
import { computeQuotaSummary, getPacificDateString, YOUTUBE_QUOTA_COSTS } from './src/domain/quota.ts';
import { FIXTURE_BALL_SORT, FIXTURE_MELODY_BOUNCE, FIXTURE_ORBIT_SYNC, FIXTURE_PENDULUM_WAVE, TEMPLATE_REGISTRY } from './src/domain/templates.ts';
import type { Channel, ChannelProfile, CompilationChapter, CompilationRecord, RejectionReasonTag, SpecRecord } from './src/domain/types.ts';
import {
  IdeaBatchSchema,
  MelodyEntrySchema,
  ReferenceChannelsSchema,
  TrendImportSchema,
  VIDEO_SPEC_JSON_SCHEMA,
  validateImportPayload,
} from './src/domain/videospec.ts';
import { encryptSecret, verifyOAuthState, verifyWorkerSignature } from './src/server/crypto.ts';
import {
  SECRET_ENV_MAP,
  SECRET_LABELS,
  applySecretPatch,
  describeSecret,
  type SecretKey,
} from './src/server/secrets.ts';
import {
  draftCommentReplyWithGemini,
  fetchAvailableAiModels,
  generateNextEpisodeSpecsWithGemini,
  generateSpecBatchWithGemini,
  runVisualQaWithGemini,
  suggestIdeaBatchWithGemini,
  testAiConnection,
} from './src/server/gemini.ts';
import {
  cleanupStorageArtifacts,
  normalizeDbConfig,
  normalizeStorageConfig,
  resolveMediaDirectories,
  scanStorageArtifacts,
  testStorageConnection,
  uploadArtifactToStorage,
} from './src/server/storage.ts';
import {
  approveAndScheduleRender,
  deleteChannelFromDb,
  deleteRenderCascade,
  deleteSpecCascade,
  deleteIdea,
  executeRenderForSpec,
  expandIdeaRecordToSpec,
  getChannelDataStats,
  getChannelScopedState,
  idempotentUploadVideo,
  loadDb,
  normalizeAiConfig,
  resolveDbPath,
  runCronTick,
  saveDb,
} from './src/server/store.ts';
import {
  addVideoToYoutubePlaylist,
  buildYoutubeAuthUrl,
  clearAccessTokenCache,
  deleteYoutubeVideo,
  exchangeCodeForYoutubeTokens,
  fetchAuthorizedYoutubeChannel,
  fetchChannelCommentsFromYoutube,
  getValidAccessTokenForChannel,
  moderateYoutubeComment,
  pollReferenceChannelOutliers,
  postFirstCommentOnYoutube,
  replyToYoutubeComment,
  resumableUploadVideoToYoutube,
  searchChannelByQuery,
  syncRemoteVideosFromYoutubeApi,
  updateYoutubeVideoMetadata,
  updateYoutubeVideoPrivacy,
  verifyYoutubeVideoPublicStatus,
  YoutubeAuthError,
} from './src/server/youtube.ts';

const execFileAsync = promisify(execFile);

async function ensureRenderedMp4(
  renderId: string,
  spec: SpecRecord['spec'],
  melodies: ReturnType<typeof loadDb>['melodies'],
  storageConfig: ReturnType<typeof loadDb>['storage_config']
): Promise<{ mp4File: string; remoteUrl: string | null }> {
  const dirs = resolveMediaDirectories(storageConfig);
  const specFile = path.join(dirs.cacheDir, `${renderId}.json`);
  const mp4File = path.join(dirs.rendersDir, `${renderId}.mp4`);
  const legacyMp4 = path.resolve(process.cwd(), 'data', 'tmp-renders', `${renderId}.mp4`);
  if (!fs.existsSync(mp4File) && fs.existsSync(legacyMp4)) {
    fs.copyFileSync(legacyMp4, mp4File);
  }
  let remoteUrl: string | null = null;
  if (!fs.existsSync(mp4File)) {
    const melId = spec.audio.music?.melody_ref.source === 'library' ? spec.audio.music.melody_ref.id : undefined;
    const melody = melodies.find((m) => m.id === melId);
    fs.writeFileSync(specFile, JSON.stringify({ spec, melody }), 'utf8');
    await execFileAsync('python3', [path.resolve(process.cwd(), 'workers/render/render_worker.py'), specFile, mp4File], {
      timeout: 60_000,
    });
    if (storageConfig.driver !== 'local') {
      try {
        const uploaded = await uploadArtifactToStorage({
          cfg: storageConfig,
          localFilePath: mp4File,
          category: 'renders',
          fileName: `${renderId}.mp4`,
        });
        remoteUrl = uploaded.remoteUrl;
      } catch {
        // Keep local MP4 usable even if background cloud sync fails
      }
    }
  }
  return { mp4File, remoteUrl };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '5mb' }));

  app.get('/privacy', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shorts Studio — Privacy Policy / 隐私政策</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 20px; line-height: 1.65; color: #0f172a; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 24px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Shorts Studio Privacy Policy (隐私政策)</h1>
  <div class="meta">Effective Date: 2026-11-13 · Contact: fu86871@gmail.com</div>
  <p>Shorts Studio is a creator-operated multi-channel YouTube workflow tool for deterministic physics/music video rendering, scheduling, analytics snapshots, and comment management.</p>
  <h2>1. Google / YouTube Data Accessed</h2>
  <p>When you explicitly authorize a YouTube channel via Google OAuth 2.0, Shorts Studio stores an encrypted OAuth refresh token (AES-256-GCM) solely to upload user-approved videos, update video privacy/metadata/playlists, and read channel performance analytics and comments for your own authorized channels.</p>
  <h2>2. Limited Use &amp; Non-Disclosure</h2>
  <p>Shorts Studio adheres to the Google API Services User Data Policy, including the Limited Use requirements. Your YouTube API data and OAuth tokens are never sold, shared with third parties, or used to train external models.</p>
  <h2>3. Token Deletion &amp; Revocation</h2>
  <p>You can click "Disconnect &amp; Delete Credentials" inside the Channels &amp; Settings page at any time to immediately erase encrypted refresh tokens from local storage, or revoke access in your Google Account security settings.</p>
</body>
</html>`);
  });

  app.get('/terms', (_req, res) => {
    res.type('html').send(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shorts Studio — Terms of Service / 服务条款</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 48px auto; padding: 0 20px; line-height: 1.65; color: #0f172a; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    h2 { font-size: 16px; margin-top: 24px; }
    .meta { color: #64748b; font-size: 13px; margin-bottom: 24px; }
  </style>
</head>
<body>
  <h1>Shorts Studio Terms of Service (服务条款)</h1>
  <div class="meta">Effective Date: 2026-11-13 · Contact: fu86871@gmail.com</div>
  <p>By using Shorts Studio, you agree to comply with the YouTube Terms of Service and Google API Services Terms of Service.</p>
  <h2>1. Authorized Ownership</h2>
  <p>You may only connect YouTube channels that you own or are explicitly authorized to manage. All uploaded media, titles, descriptions, and comments remain your sole responsibility.</p>
  <h2>2. Original &amp; Compliant Content</h2>
  <p>Shorts Studio enforces novelty guards, public-domain/CC0/original melody license checks, and quota ledgers to help creators avoid repetitive or copyright-infringing uploads.</p>
  <h2>3. Availability</h2>
  <p>This software is provided as-is for creator operations; YouTube API quota limits and OAuth Testing-mode 7-day token lifetimes are governed by Google Cloud Platform.</p>
</body>
</html>`);
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'shorts-studio',
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/state', (req, res) => {
    const db = loadDb();
    const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : db.channels[0]?.id;
    res.json({ ...getChannelScopedState(db, channelId), _build: { rev: process.env.BUILD_REV || 'dev', deployed_at: process.env.BUILD_AT || null } });
  });

  app.get('/api/templates', (_req, res) => {
    res.json({
      schema: VIDEO_SPEC_JSON_SCHEMA,
      templates: Object.values(TEMPLATE_REGISTRY).map((t) => ({
        key: t.key,
        version: t.version,
        name: t.name,
        description: t.description,
        status: t.status,
        events: t.events,
        allowedAxes: t.allowedAxes,
        jsonSchema: t.jsonSchema,
      })),
      fixtures: {
        melodyBounce: FIXTURE_MELODY_BOUNCE,
        ballSort: FIXTURE_BALL_SORT,
        pendulumWave: FIXTURE_PENDULUM_WAVE,
        orbitSync: FIXTURE_ORBIT_SYNC,
      },
    });
  });

  // ---------------------------------------------------------------------------
  // Real YouTube OAuth 2.0 Popup Flow (docs 06 §2 + AI Studio iframe pattern)
  // ---------------------------------------------------------------------------
  app.get('/api/auth/youtube/url', (req, res) => {
    try {
      const db = loadDb();
      const channelId = typeof req.query.channelId === 'string' ? req.query.channelId : db.channels[0]?.id;
      if (!channelId || !db.channels.some((c) => c.id === channelId)) {
        return res.status(404).json({ error: '频道不存在' });
      }
      const { url, redirectUri } = buildYoutubeAuthUrl(channelId);
      res.json({ url, redirectUri });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '生成 YouTube 授权链接失败' });
    }
  });


  // OAuth 回调收尾页：无论成功失败都 postMessage 回 opener，前端统一处理
  const sendOauthResultPage = (
    res: express.Response,
    payload: Record<string, unknown>,
    message: string,
    status = 200
  ) => {
    const safe = JSON.stringify(payload).replace(/</g, '\\u003c');
    res.status(status).send(`<!doctype html><html><head><meta charset="utf-8"><title>Shorts Studio</title>
      <style>body{font-family:system-ui,-apple-system,sans-serif;padding:32px;color:#0f172a}
      .box{max-width:440px;margin:40px auto;text-align:center}
      .i{font-size:40px;line-height:1}</style></head>
      <body><div class="box"><div class="i">${payload.type === 'YT_OAUTH_SUCCESS' ? '✅' : '⚠️'}</div>
      <p>${message}</p></div>
      <script>
        try {
          if (window.opener) {
            window.opener.postMessage(${safe}, '*');
            setTimeout(function(){ window.close(); }, 400);
          } else {
            window.location.href = '/';
          }
        } catch (e) {}
      </script></body></html>`);
  };

  const handleYoutubeOAuthCallback = async (req: express.Request, res: express.Response) => {
    try {
      const { code, state, error } = req.query;
      if (error) {
        return sendOauthResultPage(res, { type: 'YT_OAUTH_ERROR', error: String(error) }, '授权被取消或拒绝。', 400);
      }
      if (typeof code !== 'string' || typeof state !== 'string') {
        return sendOauthResultPage(res, { type: 'YT_OAUTH_ERROR', error: 'missing_code_or_state' }, '缺少 code 或 state 参数。', 400);
      }
      const parsedState = verifyOAuthState<{ channelId: string; ts: number }>(state);
      if (!parsedState?.channelId) {
        return sendOauthResultPage(res, { type: 'YT_OAUTH_ERROR', error: 'invalid_state' }, 'OAuth state 校验失败，请返回工作台重试。', 400);
      }

      const db = loadDb();
      const channel = db.channels.find((c) => c.id === parsedState.channelId);
      if (!channel) {
        return sendOauthResultPage(res, { type: 'YT_OAUTH_ERROR', error: 'channel_not_found' }, '目标频道不存在。', 404);
      }

      const tokens = await exchangeCodeForYoutubeTokens(code);
      const ytInfo = await fetchAuthorizedYoutubeChannel(tokens.access_token);

      // Enforce docs 06 §2: same yt_channel_id cannot connect to two different channels
      const conflict = db.channels.find(
        (other) => other.id !== channel.id && other.oauth_connected && other.yt_channel_id === ytInfo.yt_channel_id
      );
      if (conflict) {
        return res
          .status(409)
          .send(`<p>YouTube 频道 ${ytInfo.yt_channel_id} 已绑定至工作台频道 "${conflict.slug}"，禁止重复绑定。</p>`);
      }

      channel.yt_channel_id = ytInfo.yt_channel_id;
      channel.title = ytInfo.title;
      if (tokens.refresh_token) {
        channel.oauth_refresh_token_enc = encryptSecret(tokens.refresh_token);
      }
      channel.oauth_connected = Boolean(channel.oauth_refresh_token_enc || tokens.refresh_token);
      channel.oauth_connected_at = new Date().toISOString();
      channel.token_scopes = tokens.scope ? tokens.scope.split(' ') : [];
      if (channel.status === 'reauth_required' || channel.status === 'paused') {
        channel.status = channel.api_audit_verified ? 'connected' : 'audit_pending';
      }
      clearAccessTokenCache(channel.id);

      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: channel.id,
        actor: 'oauth@youtube',
        action: 'youtube_channel_connected',
        entity: ytInfo.yt_channel_id,
        payload: { title: ytInfo.title, scopes_count: channel.token_scopes.length },
        at: new Date().toISOString(),
      });
      saveDb(db);

      sendOauthResultPage(
        res,
        {
          type: 'YT_OAUTH_SUCCESS',
          channelId: channel.id,
          ytChannelId: ytInfo.yt_channel_id,
          title: ytInfo.title,
        },
        'YouTube 频道授权成功，正在返回工作台…'
      );
    } catch (err: unknown) {
      sendOauthResultPage(
        res,
        { type: 'YT_OAUTH_ERROR', error: err instanceof Error ? err.message : '未知错误' },
        'YouTube OAuth 回调失败，请返回工作台重试。',
        500
      );
    }
  };

  app.get(['/api/auth/youtube/callback', '/api/auth/youtube/callback/'], handleYoutubeOAuthCallback);

  app.post('/api/channels/:id/disconnect', (req, res) => {
    const db = loadDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    channel.oauth_connected = false;
    channel.oauth_connected_at = null;
    channel.oauth_refresh_token_enc = null;
    channel.token_scopes = [];
    clearAccessTokenCache(channel.id);
    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: channel.id,
      actor: 'operator@shorts-studio',
      action: 'youtube_credentials_deleted',
      entity: channel.yt_channel_id,
      payload: { reason: 'manual_disconnect' },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ disconnected: true });
  });

  app.post('/api/channels/:id/sync', async (req, res) => {
    const db = loadDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    if (!channel) return res.status(404).json({ error: 'Channel not found' });
    if (!channel.oauth_connected || !channel.oauth_refresh_token_enc) {
      return res.status(400).json({ error: '请先在「频道与设置」中点击「连接 YouTube 频道 (OAuth)」完成授权。' });
    }

    try {
      const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
      const { videos, quotaUsed } = await syncRemoteVideosFromYoutubeApi({
        channelId: channel.id,
        accessToken,
      });

      const datePt = getPacificDateString();
      db.quota_ledger.push({
        id: `ql-sync-${Date.now().toString(36)}`,
        project_ref: channel.gcp_project_ref,
        channel_id: channel.id,
        date_pt: datePt,
        units: quotaUsed,
        op: 'videos.list',
        ref: 'channel-sync',
        created_at: new Date().toISOString(),
      });

      const others = db.remote_videos.filter((v) => v.channel_id !== channel.id);
      const existingMap = new Map(
        db.remote_videos.filter((v) => v.channel_id === channel.id).map((v) => [v.yt_video_id, v])
      );
      for (const rv of videos) {
        existingMap.set(rv.yt_video_id, rv);
      }
      const scored = scoreChannelVideos(Array.from(existingMap.values()));
      db.remote_videos = [...others, ...scored];
      channel.last_synced_at = new Date().toISOString();

      saveDb(db);
      res.json({ syncedCount: videos.length, quotaUsed });
    } catch (err: unknown) {
      if (err instanceof YoutubeAuthError && err.code === 'invalid_grant') {
        channel.status = 'reauth_required';
        saveDb(db);
      }
      res.status(400).json({ error: err instanceof Error ? err.message : '同步远端视频失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // Import VideoSpec / SpecBatch / IdeaBatch
  // ---------------------------------------------------------------------------
  app.post('/api/import', (req, res) => {
    const db = loadDb();
    const { payload, dry_run = false, channel_slug } = req.body ?? {};

    const existingSpecHashesByChannel = new Map<string, Set<string>>();
    const existingSpecKeysByChannel = new Map<string, Set<string>>();
    for (const s of db.specs) {
      if (!existingSpecHashesByChannel.has(s.channel_id)) existingSpecHashesByChannel.set(s.channel_id, new Set());
      if (!existingSpecKeysByChannel.has(s.channel_id)) existingSpecKeysByChannel.set(s.channel_id, new Set());
      existingSpecHashesByChannel.get(s.channel_id)!.add(s.spec_hash);
      existingSpecKeysByChannel.get(s.channel_id)!.add(s.spec.spec_key);
    }

    const result = validateImportPayload(payload, {
      channels: db.channels,
      melodies: db.melodies,
      existingSpecHashesByChannel,
      existingSpecKeysByChannel,
      overrideChannelSlug: typeof channel_slug === 'string' ? channel_slug : undefined,
    });

    const created: SpecRecord[] = [];
    if (!dry_run && result.accepted.length > 0) {
      const now = new Date().toISOString();
      for (const item of result.accepted) {
        const rec: SpecRecord = {
          id: `spec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          channel_id: item.channel_id,
          spec: item.spec,
          spec_hash: item.spec_hash,
          schema_version: 'videospec/1',
          status: 'spec_ready',
          series_id: item.spec.concept.series?.slug ?? null,
          episode: item.spec.concept.series?.episode ?? null,
          created_at: now,
          updated_at: now,
        };
        db.specs.unshift(rec);
        created.push(rec);
      }
      saveDb(db);
    }

    res.json({
      dry_run: Boolean(dry_run),
      acceptedCount: result.accepted.length,
      created,
      issues: result.issues,
    });
  });

  app.post('/api/ideas/import', (req, res) => {
    const db = loadDb();
    const parsed = IdeaBatchSchema.safeParse(req.body?.payload ?? req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'ideabatch/1 校验失败' });
    }
    const now = new Date().toISOString();
    let added = 0;
    for (const item of parsed.data.items) {
      const targetChannel =
        db.channels.find((c) => c.slug === item.channel_slug) ??
        db.channels.find((c) => c.id === req.body?.channelId) ??
        db.channels[0];
      if (!targetChannel) continue;
      if (db.ideas.some((i) => i.channel_id === targetChannel.id && i.idea.idea_key === item.idea_key)) {
        continue;
      }
      db.ideas.unshift({
        id: `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        channel_id: targetChannel.id,
        batch_id: parsed.data.batch_id,
        idea: item,
        status: 'pending',
        spec_id: null,
        created_at: now,
      });
      added++;
    }
    saveDb(db);
    res.json({ addedCount: added });
  });

  app.post('/api/ideas/:id/expand', (req, res) => {
    try {
      const db = loadDb();
      const spec = expandIdeaRecordToSpec(db, req.params.id);
      saveDb(db);
      res.json({ spec });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '展开创意失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // AI Producers (Gemini Server-Side)
  // ---------------------------------------------------------------------------
  const ingestGeneratedSpecs = (
    db: ReturnType<typeof loadDb>,
    channelId: string,
    specs: SpecRecord['spec'][]
  ): { created: SpecRecord[]; issues: ReturnType<typeof validateImportPayload>['issues'] } => {
    const history = db.specs.filter((s) => s.channel_id === channelId);
    const batchPayload = {
      schema: 'specbatch/1',
      batch_id: `ai-${Date.now().toString(36)}`,
      generated_at: new Date().toISOString(),
      items: specs,
    };
    const validation = validateImportPayload(batchPayload, {
      channels: db.channels,
      melodies: db.melodies,
      existingSpecHashesByChannel: new Map([[channelId, new Set(history.map((h) => h.spec_hash))]]),
      existingSpecKeysByChannel: new Map([[channelId, new Set(history.map((h) => h.spec.spec_key))]]),
    });
    const now = new Date().toISOString();
    const created: SpecRecord[] = [];
    for (const acc of validation.accepted) {
      const rec: SpecRecord = {
        id: `spec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        channel_id: channelId,
        spec: acc.spec,
        spec_hash: acc.spec_hash,
        schema_version: 'videospec/1',
        status: 'spec_ready',
        series_id: acc.spec.concept.series?.slug ?? null,
        episode: acc.spec.concept.series?.episode ?? null,
        created_at: now,
        updated_at: now,
      };
      db.specs.unshift(rec);
      created.push(rec);
    }
    return { created, issues: validation.issues };
  };

  app.post('/api/ai/generate-specs', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId, count = 2 } = req.body ?? {};
      const channel = db.channels.find((c) => c.id === channelId) ?? db.channels[0];
      const profile = db.profiles.find((p) => p.channel_id === channel.id)!;
      const history = db.specs.filter((s) => s.channel_id === channel.id);
      const melodies = db.melodies.filter((m) => !m.channel_id || m.channel_id === channel.id);
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const currentMonthSpendUsd = db.ai_calls
        .filter((a) => a.channel_id === channel.id && a.created_at.startsWith(monthPrefix))
        .reduce((sum, a) => sum + a.cost_usd, 0);

      const remoteVideos = db.remote_videos.filter((v) => v.channel_id === channel.id);
      const generated = await generateSpecBatchWithGemini({
        channel,
        profile,
        melodies,
        history,
        remoteVideos,
        count: Math.min(5, Math.max(1, Number(count) || 2)),
        currentMonthSpendUsd,
        aiConfig: db.ai_config,
      });

      db.ai_calls.unshift({
        id: `ai-${Date.now().toString(36)}`,
        channel_id: channel.id,
        purpose: 'specgen',
        model: generated.model,
        tokens_in: generated.tokensIn,
        tokens_out: generated.tokensOut,
        cost_usd: generated.costUsd,
        created_at: new Date().toISOString(),
      });

      const { created, issues } = ingestGeneratedSpecs(db, channel.id, generated.specs);
      saveDb(db);
      res.json({ created, issues, cost_usd: generated.costUsd, model: generated.model });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'AI 生成失败' });
    }
  });

  app.post('/api/ai/next-episode', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId, sourceTitle, sourceMetricsSummary = '' } = req.body ?? {};
      const channel = db.channels.find((c) => c.id === channelId) ?? db.channels[0];
      const profile = db.profiles.find((p) => p.channel_id === channel.id)!;
      const history = db.specs.filter((s) => s.channel_id === channel.id);
      const melodies = db.melodies.filter((m) => !m.channel_id || m.channel_id === channel.id);
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const currentMonthSpendUsd = db.ai_calls
        .filter((a) => a.channel_id === channel.id && a.created_at.startsWith(monthPrefix))
        .reduce((sum, a) => sum + a.cost_usd, 0);

      const remoteVideos = db.remote_videos.filter((v) => v.channel_id === channel.id);
      const generated = await generateNextEpisodeSpecsWithGemini({
        channel,
        profile,
        melodies,
        history,
        remoteVideos,
        sourceTitle: String(sourceTitle || 'Breakout Simulation'),
        sourceMetricsSummary: String(sourceMetricsSummary || ''),
        currentMonthSpendUsd,
        aiConfig: db.ai_config,
      });

      db.ai_calls.unshift({
        id: `ai-next-${Date.now().toString(36)}`,
        channel_id: channel.id,
        purpose: 'next_episode',
        model: generated.model,
        tokens_in: generated.tokensIn,
        tokens_out: generated.tokensOut,
        cost_usd: generated.costUsd,
        created_at: new Date().toISOString(),
      });

      const { created, issues } = ingestGeneratedSpecs(db, channel.id, generated.specs);
      saveDb(db);
      res.json({ created, issues, cost_usd: generated.costUsd, model: generated.model });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '生成下一集失败' });
    }
  });

  app.post('/api/ai/suggest-ideas', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId } = req.body ?? {};
      const channel = db.channels.find((c) => c.id === channelId) ?? db.channels[0];
      const profile = db.profiles.find((p) => p.channel_id === channel.id)!;
      const melodies = db.melodies.filter((m) => !m.channel_id || m.channel_id === channel.id);
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const currentMonthSpendUsd = db.ai_calls
        .filter((a) => a.channel_id === channel.id && a.created_at.startsWith(monthPrefix))
        .reduce((sum, a) => sum + a.cost_usd, 0);

      const generated = await suggestIdeaBatchWithGemini({
        channel,
        profile,
        melodies,
        referenceVideos: db.reference_videos.filter((rv) => rv.channel_id === channel.id),
        trends: db.trend_signals.filter((t) => t.channel_id === channel.id),
        remoteVideos: db.remote_videos.filter((v) => v.channel_id === channel.id),
        currentMonthSpendUsd,
        aiConfig: db.ai_config,
      });

      db.ai_calls.unshift({
        id: `ai-idea-${Date.now().toString(36)}`,
        channel_id: channel.id,
        purpose: 'specgen',
        model: generated.model,
        tokens_in: generated.tokensIn,
        tokens_out: generated.tokensOut,
        cost_usd: generated.costUsd,
        created_at: new Date().toISOString(),
      });

      const now = new Date().toISOString();
      const batchId = `ai-ideas-${now.slice(0, 10)}`;
      for (const item of generated.items) {
        db.ideas.unshift({
          id: `idea-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
          channel_id: channel.id,
          batch_id: batchId,
          idea: item,
          status: 'pending',
          spec_id: null,
          created_at: now,
        });
      }
      saveDb(db);
      res.json({ addedCount: generated.items.length, cost_usd: generated.costUsd, model: generated.model });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '生成趋势选题失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // Render, Visual QA, MP4 Export
  // ---------------------------------------------------------------------------
  app.post('/api/specs/:id/render', (req, res) => {
    try {
      const db = loadDb();
      const render = executeRenderForSpec(db, req.params.id, 'local-deterministic-worker');
      saveDb(db);
      res.json({ render });
    } catch (err: unknown) {
      res.status(404).json({ error: err instanceof Error ? err.message : 'Render failed' });
    }
  });

  app.post('/api/renders/:id/retry', (req, res) => {
    try {
      const db = loadDb();
      const existing = db.renders.find((r) => r.id === req.params.id);
      if (!existing) return res.status(404).json({ error: 'Render not found' });
      const render = executeRenderForSpec(db, existing.spec_id, 'local-deterministic-worker-retry');
      saveDb(db);
      res.json({ render });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Retry failed' });
    }
  });

  app.post('/api/renders/:id/visual-qa', async (req, res) => {
    try {
      const db = loadDb();
      const render = db.renders.find((r) => r.id === req.params.id);
      if (!render) return res.status(404).json({ error: 'Render not found' });
      const specRec = db.specs.find((s) => s.id === render.spec_id);
      const profile = db.profiles.find((p) => p.channel_id === render.channel_id);
      if (!specRec || !profile) return res.status(404).json({ error: 'Spec or profile not found' });

      const monthPrefix = new Date().toISOString().slice(0, 7);
      const spend = db.ai_calls
        .filter((a) => a.channel_id === render.channel_id && a.created_at.startsWith(monthPrefix))
        .reduce((sum, a) => sum + a.cost_usd, 0);

      const qa = await runVisualQaWithGemini({
        profile,
        spec: specRec.spec,
        render,
        currentMonthSpendUsd: spend,
        aiConfig: db.ai_config,
      });

      render.visual_qa = qa.result;
      db.ai_calls.unshift({
        id: `ai-vqa-${Date.now().toString(36)}`,
        channel_id: render.channel_id,
        purpose: 'qa_vision',
        model: qa.result.model,
        tokens_in: qa.tokensIn,
        tokens_out: qa.tokensOut,
        cost_usd: qa.costUsd,
        created_at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ visual_qa: qa.result });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '视觉抽检失败' });
    }
  });

  app.get('/api/renders/:id/mp4', async (req, res) => {
    try {
      const db = loadDb();
      const render = db.renders.find((r) => r.id === req.params.id);
      if (!render) return res.status(404).json({ error: 'Render not found' });
      const specRec = db.specs.find((s) => s.id === render.spec_id);
      if (!specRec) return res.status(404).json({ error: 'Spec not found' });

      const { mp4File, remoteUrl } = await ensureRenderedMp4(
        render.id,
        specRec.spec,
        db.melodies,
        db.storage_config
      );
      if (remoteUrl && !render.remote_url) {
        render.remote_url = remoteUrl;
        saveDb(db);
      }
      if (!fs.existsSync(mp4File) && render.remote_url) {
        return res.redirect(render.remote_url);
      }
      res.download(mp4File, `${specRec.spec.spec_key}.mp4`);
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'MP4 导出失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // Long-Form YPP Compilation Builder (docs 08 Phase 4)
  // ---------------------------------------------------------------------------
  app.post('/api/compilations/build', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId, renderIds, title } = req.body ?? {};
      if (!Array.isArray(renderIds) || renderIds.length < 2) {
        return res.status(400).json({ error: '合集至少需要勾选 2 条已完成的渲染任务' });
      }
      const selectedRenders = renderIds
        .map((id) => db.renders.find((r) => r.id === id && r.channel_id === channelId))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      if (selectedRenders.length < 2) {
        return res.status(400).json({ error: '所选渲染任务无效或不属于当前频道' });
      }

      const compId = `cmp-${Date.now().toString(36)}`;
      const dirs = resolveMediaDirectories(db.storage_config);

      const mp4Paths: string[] = [];
      const chapters: CompilationChapter[] = [];
      let cursorSec = 0;

      const formatTimecode = (sec: number) => {
        const mins = Math.floor(sec / 60);
        const secs = Math.floor(sec % 60);
        return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      };

      for (const rnd of selectedRenders) {
        const specRec = db.specs.find((s) => s.id === rnd.spec_id);
        if (!specRec) continue;
        const { mp4File } = await ensureRenderedMp4(rnd.id, specRec.spec, db.melodies, {
          ...db.storage_config,
          keep_local_cache_after_upload: true,
        });
        mp4Paths.push(mp4File);
        chapters.push({
          timecode: formatTimecode(cursorSec),
          title: specRec.spec.publish.title,
          spec_id: specRec.id,
          render_id: rnd.id,
          duration_sec: specRec.spec.format.duration_sec,
        });
        cursorSec += specRec.spec.format.duration_sec;
      }

      const concatListPath = path.join(dirs.cacheDir, `${compId}.txt`);
      const outMp4Path = path.join(dirs.compilationsDir, `${compId}.mp4`);
      fs.writeFileSync(
        concatListPath,
        mp4Paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'),
        'utf8'
      );

      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          concatListPath,
          '-c:v',
          'libx264',
          '-preset',
          'veryfast',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-movflags',
          '+faststart',
          outMp4Path,
        ],
        { timeout: 120_000 }
      );

      let remoteUrl: string | null = null;
      if (db.storage_config.driver !== 'local') {
        try {
          const uploaded = await uploadArtifactToStorage({
            cfg: db.storage_config,
            localFilePath: outMp4Path,
            category: 'compilations',
            fileName: `${compId}.mp4`,
          });
          remoteUrl = uploaded.remoteUrl;
        } catch {
          // Keep local compilation MP4 available if remote upload fails
        }
      }

      const compTitle = String(title || `Physics & Music Compilation (${chapters.length} Simulations)`).trim().slice(0, 100);
      const descriptionText = `${compTitle}\n\nChapters:\n${chapters
        .map((c) => `${c.timecode} ${c.title}`)
        .join('\n')}\n\n#satisfying #physics #music`;

      const record: CompilationRecord = {
        id: compId,
        channel_id: String(channelId),
        title: compTitle,
        render_ids: selectedRenders.map((r) => r.id),
        duration_sec: Math.round(cursorSec),
        chapters,
        description_text: descriptionText,
        remote_url: remoteUrl,
        created_at: new Date().toISOString(),
      };
      db.compilations.unshift(record);
      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: String(channelId),
        actor: 'operator@shorts-studio',
        action: 'compilation_built',
        entity: compId,
        payload: { count: chapters.length, duration_sec: record.duration_sec, remote_url: remoteUrl },
        at: record.created_at,
      });
      saveDb(db);
      res.json({ compilation: record });
    } catch (err: unknown) {
      res.status(500).json({ error: err instanceof Error ? err.message : '生成合集视频失败' });
    }
  });

  app.get('/api/compilations/:id/mp4', (req, res) => {
    const db = loadDb();
    const comp = db.compilations.find((c) => c.id === req.params.id);
    if (!comp) return res.status(404).json({ error: '合集记录不存在' });
    const dirs = resolveMediaDirectories(db.storage_config);
    const mp4Path = path.join(dirs.compilationsDir, `${comp.id}.mp4`);
    const legacyPath = path.resolve(process.cwd(), 'data', 'tmp-compilations', `${comp.id}.mp4`);
    const resolved = fs.existsSync(mp4Path) ? mp4Path : legacyPath;
    if (!fs.existsSync(resolved)) {
      if (comp.remote_url) return res.redirect(comp.remote_url);
      return res.status(404).json({ error: '合集视频文件尚未构建或已被清理，请重新生成' });
    }
    res.download(resolved, `${comp.id}.mp4`);
  });

  // ---------------------------------------------------------------------------
  // Review & Publishing (with real YouTube API when OAuth connected)
  // ---------------------------------------------------------------------------
  app.post('/api/reviews', (req, res) => {
    try {
      const db = loadDb();
      const { renderId, decision, reasonTags = [], note = '', editedTitle } = req.body ?? {};
      const render = db.renders.find((r) => r.id === renderId);
      if (!render) return res.status(404).json({ error: 'Render not found' });
      const specRec = db.specs.find((s) => s.id === render.spec_id);
      if (!specRec) return res.status(404).json({ error: 'Spec not found' });

      if (decision === 'approved') {
        const video = approveAndScheduleRender(db, renderId, { editedTitle });
        saveDb(db);
        return res.json({ status: 'approved', video });
      }

      if (decision === 'rejected') {
        const tags = Array.isArray(reasonTags) ? (reasonTags as RejectionReasonTag[]) : [];
        if (tags.length === 0) {
          return res.status(400).json({ error: '驳回视频必须选择至少一个原因标签' });
        }
        db.reviews.unshift({
          id: `rev-${Date.now().toString(36)}`,
          channel_id: render.channel_id,
          render_id: render.id,
          spec_id: specRec.id,
          mode: 'L0',
          decision: 'rejected',
          reason_tags: tags,
          note: String(note || ''),
          decided_by: 'operator@shorts-studio',
          decided_at: new Date().toISOString(),
        });
        specRec.status = 'rejected';
        specRec.updated_at = new Date().toISOString();
        saveDb(db);
        return res.json({ status: 'rejected' });
      }

      return res.status(400).json({ error: 'Invalid decision' });
    } catch (err: unknown) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Review failed' });
    }
  });

  app.post('/api/videos/:id/publish', async (req, res) => {
    try {
      const db = loadDb();
      const { action = 'upload', simulateNetworkDrop = false, manualYoutubeUrl } = req.body ?? {};
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video) return res.status(404).json({ error: 'Video not found' });
      const channel = db.channels.find((c) => c.id === video.channel_id)!;
      const specRec = db.specs.find((s) => s.id === video.spec_id);

      if (action === 'link_manual' && typeof manualYoutubeUrl === 'string') {
        const match = manualYoutubeUrl.match(/(?:v=|shorts\/|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
        const ytId = match?.[1] ?? manualYoutubeUrl.trim();
        if (!ytId) return res.status(400).json({ error: '请输入有效的 YouTube 视频链接或 ID' });
        video.yt_video_id = ytId;
        video.state = 'published';
        video.privacy = 'public';
        video.published_at = new Date().toISOString();
        video.error_message = null;
        saveDb(db);
        return res.json({ video, alreadyExisted: false, quotaCharged: 1 });
      }

      if (action === 'withdraw') {
        video.state = 'withdrawn';
        video.privacy = 'private';
        saveDb(db);
        return res.json({ video });
      }

      // Real YouTube Data API v3 upload path when OAuth connected & not testing simulated 90% drop
      if (!simulateNetworkDrop && channel.oauth_connected && channel.oauth_refresh_token_enc && specRec) {
        if (video.yt_video_id && video.state === 'published') {
          return res.json({ video, alreadyExisted: true, quotaCharged: 0 });
        }
        try {
          const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
          const { mp4File } = await ensureRenderedMp4(
            video.render_id,
            specRec.spec,
            db.melodies,
            { ...db.storage_config, keep_local_cache_after_upload: true }
          );
          const datePt = getPacificDateString();
          db.quota_ledger.push({
            id: `ql-${Date.now().toString(36)}`,
            project_ref: channel.gcp_project_ref,
            channel_id: channel.id,
            date_pt: datePt,
            units: YOUTUBE_QUOTA_COSTS['videos.insert'],
            op: 'videos.insert',
            ref: video.idempotency_key,
            created_at: new Date().toISOString(),
          });

          const uploaded = await resumableUploadVideoToYoutube({
            accessToken,
            mp4Path: mp4File,
            video,
            tags: specRec.spec.publish.tags,
            categoryId: specRec.spec.publish.category_id ?? '24',
            madeForKids: specRec.spec.publish.made_for_kids,
            containsSyntheticMedia: specRec.spec.publish.contains_synthetic_media,
            defaultLanguage: specRec.spec.publish.default_language,
          });

          video.yt_video_id = uploaded.ytVideoId;
          video.privacy = uploaded.privacyStatus;
          video.state = channel.api_audit_verified ? 'published' : 'semi_manual_pending';
          video.published_at = channel.api_audit_verified ? new Date().toISOString() : null;
          video.error_message = channel.api_audit_verified
            ? null
            : '已真实上传至 YouTube（私享待公开）。请点击「验证公开权限」确认项目是否已通过合规审计。';

          if (video.first_comment && !video.first_comment_posted) {
            try {
              await postFirstCommentOnYoutube({
                accessToken,
                ytChannelId: channel.yt_channel_id,
                ytVideoId: uploaded.ytVideoId,
                text: video.first_comment,
              });
              video.first_comment_posted = true;
              db.quota_ledger.push({
                id: `ql-fc-${Date.now().toString(36)}`,
                project_ref: channel.gcp_project_ref,
                channel_id: channel.id,
                date_pt: datePt,
                units: YOUTUBE_QUOTA_COSTS['commentThreads.insert'],
                op: 'commentThreads.insert',
                ref: uploaded.ytVideoId,
                created_at: new Date().toISOString(),
              });
            } catch {
              // Comment may fail if video is still processing; non-fatal
            }
          }

          db.audit_log.unshift({
            id: `aud-${Date.now().toString(36)}`,
            channel_id: channel.id,
            actor: 'youtube_api_v3',
            action: 'resumable_upload_completed',
            entity: uploaded.ytVideoId,
            payload: { video_id: video.id, privacy: uploaded.privacyStatus },
            at: new Date().toISOString(),
          });
          saveDb(db);
          return res.json({
            video,
            alreadyExisted: false,
            quotaCharged: YOUTUBE_QUOTA_COSTS['videos.insert'],
            realUpload: true,
          });
        } catch (err: unknown) {
          if (err instanceof YoutubeAuthError && err.code === 'invalid_grant') {
            channel.status = 'reauth_required';
            saveDb(db);
          }
          return res.status(400).json({ error: err instanceof Error ? err.message : '真实上传失败' });
        }
      }

      const result = idempotentUploadVideo(db, req.params.id, Boolean(simulateNetworkDrop));
      saveDb(db);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Publish failed' });
    }
  });

  app.post('/api/videos/:id/verify-public', async (req, res) => {
    try {
      const db = loadDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video?.yt_video_id) {
        return res.status(400).json({ error: '该视频尚未关联 YouTube 远端 ID' });
      }
      const channel = db.channels.find((c) => c.id === video.channel_id)!;
      const accessToken =
        channel.oauth_connected && channel.oauth_refresh_token_enc
          ? await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc)
          : undefined;
      const check = await verifyYoutubeVideoPublicStatus({ accessToken, ytVideoId: video.yt_video_id });
      if (check.isPublic) {
        channel.api_audit_verified = true;
        if (channel.status === 'audit_pending') channel.status = 'connected';
        video.privacy = 'public';
        video.state = 'published';
        video.error_message = null;
      }
      saveDb(db);
      res.json(check);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '验证公开状态失败' });
    }
  });

  app.patch('/api/videos/:id/schedule', (req, res) => {
    const db = loadDb();
    const video = db.videos.find((v) => v.id === req.params.id);
    if (!video) return res.status(404).json({ error: '排期视频不存在' });
    const { scheduledAt } = req.body ?? {};
    const dt = new Date(String(scheduledAt || ''));
    if (Number.isNaN(dt.getTime())) {
      return res.status(400).json({ error: '无效的排期时间格式' });
    }
    video.scheduled_at = dt.toISOString();
    video.quota_deferred = false;
    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: video.channel_id,
      actor: 'operator@shorts-studio',
      action: 'video_rescheduled',
      entity: video.id,
      payload: { scheduled_at: video.scheduled_at },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ video });
  });

  app.post('/api/videos/:id/withdraw', async (req, res) => {
    try {
      const db = loadDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video) return res.status(404).json({ error: '视频不存在' });

      const channel = db.channels.find((c) => c.id === video.channel_id);
      const profile = db.profiles.find((p) => p.channel_id === video.channel_id);

      if (
        channel?.oauth_connected &&
        channel.oauth_refresh_token_enc &&
        video.yt_video_id &&
        !video.yt_video_id.startsWith('YT_')
      ) {
        try {
          const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
          await updateYoutubeVideoPrivacy({
            accessToken,
            ytVideoId: video.yt_video_id,
            privacyStatus: 'private',
          });
        } catch {
          // Proceed with local withdrawal safety state even if remote fails
        }
      }

      video.state = 'withdrawn';
      video.privacy = 'private';
      if (video.yt_video_id) {
        const rv = db.remote_videos.find(
          (r) => r.channel_id === video.channel_id && r.yt_video_id === video.yt_video_id
        );
        if (rv) rv.privacy = 'private';
      }

      if (profile) {
        profile.review_mode = 'L0';
        profile.trust_level = 0;
      }

      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: video.channel_id,
        actor: 'operator@shorts-studio',
        action: 'video_emergency_withdrawn',
        entity: video.id,
        payload: { yt_video_id: video.yt_video_id, demoted_to: 'L0' },
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ video, demotedTo: 'L0' });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '撤回失败' });
    }
  });

  app.post('/api/videos/:id/playlist', async (req, res) => {
    try {
      const db = loadDb();
      const video = db.videos.find((v) => v.id === req.params.id);
      if (!video) return res.status(404).json({ error: '排期视频不存在' });
      const channel = db.channels.find((c) => c.id === video.channel_id)!;
      const specRec = db.specs.find((s) => s.id === video.spec_id);
      const playlistTitle = String(
        req.body?.playlistTitle || specRec?.spec.concept.series?.title || 'Physics & Music Shorts'
      ).trim();

      let playlistId = `PL_LOCAL_${playlistTitle.toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 16)}`;
      let createdNew = false;
      let quotaUsed = 0;

      if (
        channel.oauth_connected &&
        channel.oauth_refresh_token_enc &&
        video.yt_video_id &&
        !video.yt_video_id.startsWith('YT_')
      ) {
        const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
        const plRes = await addVideoToYoutubePlaylist({
          accessToken,
          ytVideoId: video.yt_video_id,
          playlistTitle,
        });
        playlistId = plRes.playlistId;
        createdNew = plRes.createdNew;
        quotaUsed = plRes.quotaUsed;
        db.quota_ledger.push({
          id: `ql-pl-${Date.now().toString(36)}`,
          project_ref: channel.gcp_project_ref,
          channel_id: channel.id,
          date_pt: getPacificDateString(),
          units: quotaUsed,
          op: 'playlistItems.insert',
          ref: playlistId,
          created_at: new Date().toISOString(),
        });
      }

      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: video.channel_id,
        actor: 'operator@shorts-studio',
        action: 'video_added_to_playlist',
        entity: video.id,
        payload: { playlistTitle, playlistId, createdNew, quotaUsed },
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ playlistId, playlistTitle, createdNew, quotaUsed });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '加入播放列表失败' });
    }
  });

  app.post('/api/videos/batch-privacy', async (req, res) => {
    const db = loadDb();
    const { channelId, videoIds = [], privacy = 'unlisted' } = req.body ?? {};
    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ error: '请选择至少一条视频' });
    }
    if (videoIds.length > 20) {
      return res.status(400).json({ error: '单次批量改隐私上限为 20 条' });
    }
    if (!['unlisted', 'private', 'public'].includes(privacy)) {
      return res.status(400).json({ error: '非法隐私状态' });
    }

    const channel = db.channels.find((c) => c.id === channelId);
    let accessToken: string | undefined;
    if (channel?.oauth_connected && channel.oauth_refresh_token_enc) {
      try {
        accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
      } catch {
        // Fallback to local state update if token invalid
      }
    }

    const updated: string[] = [];
    for (const id of videoIds) {
      const rv = db.remote_videos.find((v) => v.id === id && v.channel_id === channelId);
      if (rv) {
        if (accessToken && !rv.yt_video_id.startsWith('YT_')) {
          try {
            await updateYoutubeVideoPrivacy({
              accessToken,
              ytVideoId: rv.yt_video_id,
              privacyStatus: privacy,
            });
          } catch {
            // Continue recording local error resilience
          }
        }
        rv.privacy = privacy;
        updated.push(rv.id);
      }
    }

    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: channelId,
      actor: 'operator@shorts-studio',
      action: 'batch_privacy_update',
      entity: 'remote_videos',
      payload: { count: updated.length, privacy, ids: updated },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ updatedCount: updated.length, privacy });
  });

  app.delete('/api/remote-videos/:id', async (req, res) => {
    const db = loadDb();
    const { confirmTitle, channelId } = req.body ?? {};
    const idx = db.remote_videos.findIndex((v) => v.id === req.params.id && v.channel_id === channelId);
    if (idx === -1) return res.status(404).json({ error: '视频不存在或不属于当前频道' });
    const target = db.remote_videos[idx];
    if (confirmTitle !== target.title) {
      return res.status(400).json({ error: '确认标题不匹配，删除已中止' });
    }

    const channel = db.channels.find((c) => c.id === channelId);
    if (channel?.oauth_connected && channel.oauth_refresh_token_enc && !target.yt_video_id.startsWith('YT_')) {
      const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
      await deleteYoutubeVideo({ accessToken, ytVideoId: target.yt_video_id });
    }

    db.remote_videos.splice(idx, 1);
    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: channelId,
      actor: 'operator@shorts-studio',
      action: 'remote_video_deleted',
      entity: target.yt_video_id,
      payload: { title: target.title },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ deleted: true });
  });

  app.patch('/api/remote-videos/:id', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId, title, description, tags } = req.body ?? {};
      const rv = db.remote_videos.find((v) => v.id === req.params.id && v.channel_id === channelId);
      if (!rv) return res.status(404).json({ error: '视频不存在或不属于当前频道' });

      const cleanTitle = String(title || '').trim().slice(0, 100);
      if (!cleanTitle) return res.status(400).json({ error: '视频标题不能为空' });

      const channel = db.channels.find((c) => c.id === channelId);
      let quotaUsed = 0;
      if (channel?.oauth_connected && channel.oauth_refresh_token_enc && !rv.yt_video_id.startsWith('YT_')) {
        const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
        const upd = await updateYoutubeVideoMetadata({
          accessToken,
          ytVideoId: rv.yt_video_id,
          title: cleanTitle,
          description: typeof description === 'string' ? description : undefined,
          tags: Array.isArray(tags) ? tags.map(String) : undefined,
        });
        quotaUsed = upd.quotaUsed;
        db.quota_ledger.push({
          id: `ql-meta-${Date.now().toString(36)}`,
          project_ref: channel.gcp_project_ref,
          channel_id: channel.id,
          date_pt: getPacificDateString(),
          units: quotaUsed,
          op: 'videos.update',
          ref: rv.yt_video_id,
          created_at: new Date().toISOString(),
        });
      }

      rv.title = cleanTitle;
      rv.last_synced = new Date().toISOString();
      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: channelId,
        actor: 'operator@shorts-studio',
        action: 'remote_video_metadata_updated',
        entity: rv.yt_video_id,
        payload: { title: cleanTitle, quotaUsed },
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ video: rv, quotaUsed });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '更新视频元数据失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // Comments Center (docs 06 §6 & 08 Phase 3)
  // ---------------------------------------------------------------------------
  app.post('/api/comments/sync', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId } = req.body ?? {};
      const channel = db.channels.find((c) => c.id === channelId);
      if (!channel) return res.status(404).json({ error: 'Channel not found' });

      const accessToken =
        channel.oauth_connected && channel.oauth_refresh_token_enc
          ? await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc)
          : undefined;

      const fetched = await fetchChannelCommentsFromYoutube({
        channelId: channel.id,
        ytChannelId: channel.yt_channel_id,
        accessToken,
      });

      const titleMap = new Map(
        db.remote_videos.filter((v) => v.channel_id === channel.id).map((v) => [v.yt_video_id, v.title])
      );
      let added = 0;
      for (const c of fetched) {
        c.video_title = titleMap.get(c.yt_video_id) ?? c.yt_video_id;
        if (!db.comments.some((existing) => existing.yt_comment_id === c.yt_comment_id)) {
          db.comments.unshift(c);
          added++;
        }
      }
      db.quota_ledger.push({
        id: `ql-cmt-${Date.now().toString(36)}`,
        project_ref: channel.gcp_project_ref,
        channel_id: channel.id,
        date_pt: getPacificDateString(),
        units: YOUTUBE_QUOTA_COSTS['commentThreads.list'],
        op: 'commentThreads.list',
        ref: channel.yt_channel_id,
        created_at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ syncedCount: fetched.length, addedCount: added });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '同步评论失败（若为示例 YT ID 请先连接真实频道）' });
    }
  });

  app.post('/api/comments/:id/draft', async (req, res) => {
    try {
      const db = loadDb();
      const comment = db.comments.find((c) => c.id === req.params.id);
      if (!comment) return res.status(404).json({ error: '评论不存在' });
      const profile = db.profiles.find((p) => p.channel_id === comment.channel_id)!;
      const monthPrefix = new Date().toISOString().slice(0, 7);
      const spend = db.ai_calls
        .filter((a) => a.channel_id === comment.channel_id && a.created_at.startsWith(monthPrefix))
        .reduce((sum, a) => sum + a.cost_usd, 0);

      const drafted = await draftCommentReplyWithGemini({
        profile,
        comment,
        currentMonthSpendUsd: spend,
        aiConfig: db.ai_config,
      });

      comment.ai_draft = drafted.text;
      comment.ai_suggested_action = drafted.action;
      db.ai_calls.unshift({
        id: `ai-cmt-${Date.now().toString(36)}`,
        channel_id: comment.channel_id,
        purpose: 'comment_draft',
        model: drafted.model,
        tokens_in: drafted.tokensIn,
        tokens_out: drafted.tokensOut,
        cost_usd: drafted.costUsd,
        created_at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ comment });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'AI 起草回复失败' });
    }
  });

  app.post('/api/comments/:id/send', async (req, res) => {
    try {
      const db = loadDb();
      const comment = db.comments.find((c) => c.id === req.params.id);
      if (!comment) return res.status(404).json({ error: '评论不存在' });
      const text = String(req.body?.text ?? comment.ai_draft ?? '').trim();
      if (!text) return res.status(400).json({ error: '回复内容不能为空' });

      const channel = db.channels.find((c) => c.id === comment.channel_id)!;
      if (channel.oauth_connected && channel.oauth_refresh_token_enc && !comment.yt_comment_id.startsWith('yt_c_')) {
        const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
        await replyToYoutubeComment({ accessToken, parentCommentId: comment.yt_comment_id, text });
      }

      comment.reply_text = text;
      comment.status = 'replied';
      comment.replied_at = new Date().toISOString();
      db.quota_ledger.push({
        id: `ql-rep-${Date.now().toString(36)}`,
        project_ref: channel.gcp_project_ref,
        channel_id: channel.id,
        date_pt: getPacificDateString(),
        units: YOUTUBE_QUOTA_COSTS['comments.insert'],
        op: 'comments.insert',
        ref: comment.yt_comment_id,
        created_at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ comment });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '发送回复失败' });
    }
  });

  app.post('/api/comments/:id/moderate', async (req, res) => {
    try {
      const db = loadDb();
      const comment = db.comments.find((c) => c.id === req.params.id);
      if (!comment) return res.status(404).json({ error: '评论不存在' });
      const action = req.body?.action === 'ignore' ? 'ignored' : 'hidden';

      const channel = db.channels.find((c) => c.id === comment.channel_id)!;
      if (
        action === 'hidden' &&
        channel.oauth_connected &&
        channel.oauth_refresh_token_enc &&
        !comment.yt_comment_id.startsWith('yt_c_')
      ) {
        const accessToken = await getValidAccessTokenForChannel(channel.id, channel.oauth_refresh_token_enc);
        await moderateYoutubeComment({ accessToken, commentId: comment.yt_comment_id, status: 'heldForReview' });
      }

      comment.status = action;
      saveDb(db);
      res.json({ comment });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '处理评论失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // Reference Channels (RSS + videos.list) & Trend Signals
  // ---------------------------------------------------------------------------
  app.post('/api/reference-channels/import', (req, res) => {
    const db = loadDb();
    const { channelId, payload } = req.body ?? {};
    const parsed = ReferenceChannelsSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'referencechannels/1 格式校验失败' });
    }
    let added = 0;
    for (const item of parsed.data.items) {
      if (
        db.reference_channels.some(
          (rc) => rc.channel_id === channelId && rc.name.toLowerCase() === item.name.toLowerCase()
        )
      ) {
        continue;
      }
      db.reference_channels.unshift({
        id: `refc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        channel_id: channelId,
        name: item.name,
        handle: item.handle ?? null,
        yt_channel_id: item.yt_channel_id ?? null,
        tags: item.tags,
        note: item.note ?? '',
        last_polled_at: null,
      });
      added++;
    }
    saveDb(db);
    res.json({ addedCount: added });
  });

  app.post('/api/reference-channels/:id/resolve', async (req, res) => {
    try {
      const db = loadDb();
      const refCh = db.reference_channels.find((r) => r.id === req.params.id);
      if (!refCh) return res.status(404).json({ error: '参考频道不存在' });
      const channel = db.channels.find((c) => c.id === refCh.channel_id)!;

      const resolved = await searchChannelByQuery(refCh.handle || refCh.name);
      if (!resolved) return res.status(404).json({ error: '未能解析出匹配的 YouTube 频道 ID' });

      refCh.yt_channel_id = resolved.yt_channel_id;
      refCh.note = `已通过 search.list 解析 (${resolved.title})`;
      db.quota_ledger.push({
        id: `ql-srch-${Date.now().toString(36)}`,
        project_ref: channel.gcp_project_ref,
        channel_id: channel.id,
        date_pt: getPacificDateString(),
        units: YOUTUBE_QUOTA_COSTS['search.list'],
        op: 'search.list',
        ref: refCh.name,
        created_at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ reference_channel: refCh });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '解析频道 ID 失败' });
    }
  });

  app.post('/api/reference-channels/poll', async (req, res) => {
    try {
      const db = loadDb();
      const { channelId } = req.body ?? {};
      const channel = db.channels.find((c) => c.id === channelId) ?? db.channels[0];
      const targets = db.reference_channels.filter((rc) => rc.channel_id === channel.id && rc.yt_channel_id);
      let totalVideos = 0;
      let totalQuota = 0;

      for (const rc of targets) {
        try {
          const { videos, quotaUsed } = await pollReferenceChannelOutliers({
            channelId: channel.id,
            refChannelId: rc.id,
            refChannelName: rc.name,
            ytChannelId: rc.yt_channel_id!,
          });
          totalQuota += quotaUsed;
          rc.last_polled_at = new Date().toISOString();
          for (const rv of videos) {
            const existingIdx = db.reference_videos.findIndex(
              (x) => x.channel_id === channel.id && x.yt_video_id === rv.yt_video_id
            );
            if (existingIdx >= 0) {
              db.reference_videos[existingIdx] = rv;
            } else {
              db.reference_videos.unshift(rv);
            }
            totalVideos++;
          }
        } catch {
          // Individual RSS feed failure doesn't break remaining channels
        }
      }

      if (totalQuota > 0) {
        db.quota_ledger.push({
          id: `ql-ref-${Date.now().toString(36)}`,
          project_ref: channel.gcp_project_ref,
          channel_id: channel.id,
          date_pt: getPacificDateString(),
          units: totalQuota,
          op: 'videos.list',
          ref: 'reference-rss-poll',
          created_at: new Date().toISOString(),
        });
      }
      saveDb(db);
      res.json({ polledChannels: targets.length, updatedVideos: totalVideos, quotaUsed: totalQuota });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '刷新参考频道失败' });
    }
  });

  app.post('/api/trends/import', (req, res) => {
    const db = loadDb();
    const { channelId, payload } = req.body ?? {};
    const parsed = TrendImportSchema.safeParse(payload);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'trendimport/1 格式校验失败' });
    }
    let added = 0;
    for (const item of parsed.data.items) {
      db.trend_signals.unshift({
        id: `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        channel_id: channelId,
        source: parsed.data.source,
        type: item.type,
        name: item.name,
        rank: item.rank,
        views: item.metric?.views ?? 0,
        growth_pct: item.metric?.growth_pct ?? 0,
        reference_only: item.type === 'sound' ? true : Boolean(item.reference_only),
        note: item.note ?? '',
        captured_at: parsed.data.captured_at,
      });
      added++;
    }
    saveDb(db);
    res.json({ addedCount: added });
  });

  // ---------------------------------------------------------------------------
  // Analytics CSV, Melodies, Channels, Cron Tick, Worker Protocol, Export
  // ---------------------------------------------------------------------------
  app.post('/api/analytics/import-csv', (req, res) => {
    const db = loadDb();
    const { channelId, csvText } = req.body ?? {};
    if (typeof csvText !== 'string' || csvText.trim().length < 10) {
      return res.status(400).json({ error: '请粘贴有效的 YouTube Studio CSV 内容' });
    }
    const parsed = parseStudioCsv(csvText, channelId);
    if (parsed.length === 0) {
      return res.status(400).json({ error: '未能解析出视频数据行，请检查表头是否包含视频标题/观看次数' });
    }
    const existingOther = db.remote_videos.filter((v) => v.channel_id !== channelId);
    const hasOnlyRealIds = parsed.every((r) => !r.yt_video_id.startsWith('YT_'));
    const existingChannelMap = new Map(
      db.remote_videos
        .filter((v) => v.channel_id === channelId && (!hasOnlyRealIds || !v.yt_video_id.startsWith('YT_')))
        .map((v) => [v.yt_video_id, v])
    );
    for (const row of parsed) {
      existingChannelMap.set(row.yt_video_id, row);
    }
    const scored = scoreChannelVideos(Array.from(existingChannelMap.values()));
    db.remote_videos = [...existingOther, ...scored];
    saveDb(db);
    res.json({ importedCount: parsed.length });
  });

  app.post('/api/melodies', (req, res) => {
    const db = loadDb();
    const parsed = MelodyEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0]?.message ?? '旋律格式校验失败' });
    }
    if (db.melodies.some((m) => m.id === parsed.data.id)) {
      return res.status(400).json({ error: `旋律 ID "${parsed.data.id}" 已存在` });
    }
    db.melodies.unshift(parsed.data);
    saveDb(db);
    res.json({ melody: parsed.data });
  });

  app.post('/api/channels', (req, res) => {
    const db = loadDb();
    const { slug, title, niche } = req.body ?? {};
    const cleanSlug = String(slug || '')
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-');
    if (!cleanSlug || cleanSlug.length < 3 || db.channels.some((c) => c.slug === cleanSlug)) {
      return res.status(400).json({ error: '频道 slug 须为 >= 3 字符且全局唯一' });
    }
    const id = `ch-${cleanSlug}`;
    const channel: Channel = {
      id,
      slug: cleanSlug,
      yt_channel_id: `UC_${cleanSlug.toUpperCase()}`,
      title: String(title || cleanSlug),
      status: 'connected',
      api_audit_verified: false,
      gcp_project_ref: 'proj-shorts-studio',
      oauth_connected: false,
      created_at: new Date().toISOString(),
    };
    const profile: ChannelProfile = {
      channel_id: id,
      locale: 'en-US',
      niche: String(niche || 'physics-simulations'),
      brand: {
        primary_color: '#0F172A',
        palette_family: 'cool',
        tone_rules: 'Curious, clean, engaging',
        forbidden_topics: [],
      },
      allowed_templates: ['melody-bounce', 'ball-sort', 'pendulum-wave', 'orbit-sync'],
      review_mode: 'L0',
      trust_level: 0,
      novelty_mode: 'block',
      daily_cap: 2,
      is_new_channel: true,
      tz: 'America/New_York',
      posting_windows: [['18:00', '21:00']],
      ai_budget_monthly_usd: 5,
    };
    db.channels.push(channel);
    db.profiles.push(profile);
    saveDb(db);
    res.json({ channel, profile });
  });

  app.patch('/api/channels/:id', (req, res) => {
    const db = loadDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    const profile = db.profiles.find((p) => p.channel_id === req.params.id);
    if (!channel || !profile) return res.status(404).json({ error: 'Channel not found' });

    const { status, api_audit_verified, review_mode, novelty_mode, daily_cap, ai_budget_monthly_usd, trust_level } =
      req.body ?? {};
    if (status && ['connected', 'paused', 'reauth_required', 'audit_pending'].includes(status)) {
      channel.status = status;
    }
    if (typeof api_audit_verified === 'boolean') {
      channel.api_audit_verified = api_audit_verified;
      if (api_audit_verified && channel.status === 'audit_pending') {
        channel.status = 'connected';
      }
    }
    if (review_mode && ['L0', 'L1', 'L2'].includes(review_mode)) profile.review_mode = review_mode;
    if (typeof trust_level === 'number') profile.trust_level = Math.max(0, Math.min(2, trust_level));
    if (novelty_mode && ['warn', 'block'].includes(novelty_mode)) profile.novelty_mode = novelty_mode;
    if (typeof daily_cap === 'number') profile.daily_cap = Math.max(1, Math.min(6, daily_cap));
    if (typeof ai_budget_monthly_usd === 'number') {
      profile.ai_budget_monthly_usd = Math.max(1, Math.min(100, ai_budget_monthly_usd));
    }

    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: channel.id,
      actor: 'operator@shorts-studio',
      action: 'channel_settings_updated',
      entity: channel.id,
      payload: {
        status: channel.status,
        api_audit_verified: channel.api_audit_verified,
        review_mode: profile.review_mode,
        novelty_mode: profile.novelty_mode,
      },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ channel, profile, quota: computeQuotaSummary(db.quota_ledger, channel.gcp_project_ref) });
  });

  app.get('/api/channels/:id/stats', (req, res) => {
    const db = loadDb();
    const channel = db.channels.find((c) => c.id === req.params.id);
    if (!channel) return res.status(404).json({ error: '目标频道不存在' });
    res.json({
      channel: { id: channel.id, slug: channel.slug, title: channel.title },
      stats: getChannelDataStats(db, channel.id),
    });
  });

  app.delete('/api/channels/:id', (req, res) => {
    try {
      const db = loadDb();
      const purgeData = Boolean(req.body?.purge_data ?? req.query?.purge_data === 'true');
      clearAccessTokenCache(req.params.id);
      const result = deleteChannelFromDb(db, req.params.id, { purgeData });
      saveDb(db);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '删除频道失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // 删除：创意（spec）/ 渲染（render）/ 创意池（idea），同时清理磁盘文件
  // ---------------------------------------------------------------------------
  app.delete('/api/specs/:id', (req, res) => {
    try {
      const db = loadDb();
      const result = deleteSpecCascade(db, req.params.id);
      saveDb(db);
      res.json({ ok: true, ...result, status: scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path)) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除创意失败';
      res.status(msg.includes('不存在') ? 404 : 400).json({ error: msg });
    }
  });

  app.delete('/api/renders/:id', (req, res) => {
    try {
      const db = loadDb();
      const result = deleteRenderCascade(db, req.params.id);
      saveDb(db);
      res.json({ ok: true, ...result, status: scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path)) });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除渲染记录失败';
      res.status(msg.includes('不存在') ? 404 : 400).json({ error: msg });
    }
  });

  app.delete('/api/ideas/:id', (req, res) => {
    try {
      const db = loadDb();
      const result = deleteIdea(db, req.params.id);
      saveDb(db);
      res.json({ ok: true, ...result });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '删除创意条目失败';
      res.status(msg.includes('不存在') ? 404 : 400).json({ error: msg });
    }
  });

  /** 批量清理内置种子数据（demo/fixture），保留用户真实创作 */
  app.post('/api/maintenance/purge-seed', (req, res) => {
    try {
      const db = loadDb();
      const keepIds = new Set<string>(Array.isArray(req.body?.keep_spec_ids) ? req.body.keep_spec_ids : []);
      const seedSpecKeys = new Set([
        'mb-canon-hexagon-split-0001',
        'bs-funnel-color-filter-0002',
        'mb-ode-to-joy-triangle-grow-0003',
        'pw-harmonic-15-wave-0003',
        'os-10-planets-resonance-0004',
      ]);
      const targets = db.specs.filter((s) => seedSpecKeys.has(s.spec.spec_key) && !keepIds.has(s.id));
      let deletedFiles = 0;
      let freedBytes = 0;
      const removed: Record<string, number> = {};
      for (const spec of targets) {
        const r = deleteSpecCascade(db, spec.id);
        deletedFiles += r.deletedFiles;
        freedBytes += r.freedBytes;
        for (const [k, v] of Object.entries(r.removedRecords)) removed[k] = (removed[k] ?? 0) + v;
      }
      const seedIdeas = db.ideas.filter((i) => i.batch_id?.startsWith('batch-seed') || i.id.startsWith('idea-seed'));
      for (const idea of seedIdeas) deleteIdea(db, idea.id);
      saveDb(db);
      res.json({
        ok: true,
        purgedSpecs: targets.length,
        purgedIdeas: seedIdeas.length,
        deletedFiles,
        freedBytes,
        removedRecords: removed,
        status: scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path)),
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '清理内置数据失败' });
    }
  });

  app.get('/api/ai/models', async (req, res) => {
    try {
      const db = loadDb();
      const providerRaw = typeof req.query.provider === 'string' ? req.query.provider : db.ai_config.provider;
      const provider =
        providerRaw === 'openai-compatible' || providerRaw === 'anthropic' ? providerRaw : 'gemini';
      const base_url = typeof req.query.base_url === 'string' ? req.query.base_url : db.ai_config.base_url;
      const result = await fetchAvailableAiModels({ provider, base_url });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '获取模型列表失败' });
    }
  });

  app.post('/api/ai/test', async (req, res) => {
    try {
      const db = loadDb();
      const { provider, base_url, model, thinking_level } = req.body ?? {};
      const result = await testAiConnection({
        provider: provider ?? db.ai_config.provider,
        base_url: typeof base_url === 'string' ? base_url : db.ai_config.base_url,
        model: typeof model === 'string' ? model : db.ai_config.model,
        thinking_level: thinking_level ?? db.ai_config.thinking_level,
      });
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'AI 接口连通性测试失败' });
    }
  });

  // ---------------------------------------------------------------------------
  // 凭据管理：所有 key/token 都可在后台表单填写，不必再改 .env
  // ---------------------------------------------------------------------------
  app.get('/api/secrets', (_req, res) => {
    const db = loadDb();
    void db;
    const items = SECRET_LABELS.map(({ key, label, hint }) => {
      const d = describeSecret(key);
      return {
        key,
        env_name: SECRET_ENV_MAP[key],
        label,
        hint,
        configured: d.configured,
        source: d.source,
        tail: d.tail,
      };
    });
    res.json({ items });
  });

  app.patch('/api/secrets', (req, res) => {
    try {
      const db = loadDb();
      const { secrets } = req.body ?? {};
      if (!secrets || typeof secrets !== 'object') {
        return res.status(400).json({ error: '缺少 secrets 对象' });
      }
      db.secrets = applySecretPatch(db.secrets ?? {}, secrets);
      const changed = Object.keys(secrets).filter((k) => SECRET_ENV_MAP[k as SecretKey]);
      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: db.channels[0]?.id ?? 'ch-physics-music',
        actor: 'operator@shorts-studio',
        action: 'secrets_updated',
        entity: 'secrets',
        payload: { changed_keys: changed },
        at: new Date().toISOString(),
      });
      saveDb(db);
      const items = SECRET_LABELS.map(({ key, label, hint }) => {
        const d = describeSecret(key);
        return {
          key,
          env_name: SECRET_ENV_MAP[key],
          label,
          hint,
          configured: d.configured,
          source: d.source,
          tail: d.tail,
        };
      });
      res.json({ ok: true, changed, items });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '保存凭据失败' });
    }
  });

  app.delete('/api/secrets/:key', (req, res) => {
    try {
      const key = req.params.key as SecretKey;
      if (!SECRET_ENV_MAP[key]) return res.status(400).json({ error: '未知的凭据字段' });
      const db = loadDb();
      const next = { ...(db.secrets ?? {}) };
      next[key] = '';
      db.secrets = next;
      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: db.channels[0]?.id ?? 'ch-physics-music',
        actor: 'operator@shorts-studio',
        action: 'secret_cleared',
        entity: key,
        payload: {},
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({ ok: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '清除凭据失败' });
    }
  });

  app.patch('/api/ai-config', (req, res) => {
    const db = loadDb();
    const { provider, base_url, model, thinking_level, prompts } = req.body ?? {};
    if (typeof base_url === 'string' && base_url.trim()) {
      try {
        const parsed = new URL(base_url.trim());
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return res.status(400).json({ error: 'Base URL 必须使用 http:// 或 https://' });
        }
      } catch {
        return res.status(400).json({ error: 'Base URL 格式无效，请输入完整网址（例如 https://api.openai.com/v1）' });
      }
    }
    db.ai_config = normalizeAiConfig({
      provider: provider ?? db.ai_config.provider,
      base_url: typeof base_url === 'string' ? base_url : db.ai_config.base_url,
      model: typeof model === 'string' ? model : db.ai_config.model,
      thinking_level: thinking_level ?? db.ai_config.thinking_level,
      prompts: {
        specgen_system: prompts?.specgen_system ?? db.ai_config.prompts.specgen_system,
        next_episode: prompts?.next_episode ?? db.ai_config.prompts.next_episode,
        comment_reply: prompts?.comment_reply ?? db.ai_config.prompts.comment_reply,
      },
    });
    db.audit_log.unshift({
      id: `aud-${Date.now().toString(36)}`,
      channel_id: db.channels[0]?.id ?? 'ch-physics-music',
      actor: 'operator@shorts-studio',
      action: 'ai_config_updated',
      entity: db.ai_config.provider,
      payload: {
        provider: db.ai_config.provider,
        model: db.ai_config.model,
        thinking_level: db.ai_config.thinking_level,
        has_base_url: Boolean(db.ai_config.base_url),
      },
      at: new Date().toISOString(),
    });
    saveDb(db);
    res.json({ ai_config: db.ai_config });
  });

  // ---------------------------------------------------------------------------
  // Storage, Cache Cleanup & Database Adapter APIs
  // ---------------------------------------------------------------------------
  app.get('/api/storage/status', (_req, res) => {
    const db = loadDb();
    const summary = scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path));
    res.json(summary);
  });

  app.patch('/api/storage-config', (req, res) => {
    try {
      const db = loadDb();
      const { storage_config, db_config } = req.body ?? {};
      if (storage_config?.s3_endpoint) {
        new URL(String(storage_config.s3_endpoint).trim());
      }
      if (storage_config?.webdav_url) {
        new URL(String(storage_config.webdav_url).trim());
      }
      db.storage_config = normalizeStorageConfig({ ...db.storage_config, ...(storage_config ?? {}) });
      db.db_config = normalizeDbConfig({ ...db.db_config, ...(db_config ?? {}) });
      resolveMediaDirectories(db.storage_config);

      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: db.channels[0]?.id ?? 'ch-physics-music',
        actor: 'operator@shorts-studio',
        action: 'storage_config_updated',
        entity: db.storage_config.driver,
        payload: { driver: db.storage_config.driver, local_dir: db.storage_config.local_dir },
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({
        storage_config: db.storage_config,
        db_config: db.db_config,
        status: scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path)),
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '存储配置格式无效' });
    }
  });

  app.post('/api/storage/test', async (req, res) => {
    try {
      const db = loadDb();
      const candidate = normalizeStorageConfig({ ...db.storage_config, ...(req.body ?? {}) });
      const result = await testStorageConnection(candidate);
      res.json(result);
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '存储连接测试失败' });
    }
  });

  app.post('/api/storage/cleanup', (req, res) => {
    try {
      const db = loadDb();
      const { scope = 'cache', relPath } = req.body ?? {};
      if (!['cache', 'expired_cache', 'published_renders', 'all_media', 'single_file'].includes(scope)) {
        return res.status(400).json({ error: '无效的清理范围' });
      }
      const publishedRenderIds = new Set(
        db.videos.filter((v) => v.state === 'published' || v.state === 'withdrawn').map((v) => v.render_id)
      );
      const cleaned = cleanupStorageArtifacts({
        cfg: db.storage_config,
        scope,
        relPath: typeof relPath === 'string' ? relPath : undefined,
        publishedRenderIds,
      });
      db.audit_log.unshift({
        id: `aud-${Date.now().toString(36)}`,
        channel_id: db.channels[0]?.id ?? 'ch-physics-music',
        actor: 'operator@shorts-studio',
        action: 'storage_cleaned',
        entity: scope,
        payload: cleaned,
        at: new Date().toISOString(),
      });
      saveDb(db);
      res.json({
        ...cleaned,
        status: scanStorageArtifacts(db.storage_config, resolveDbPath(db.db_config.json_path)),
      });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : '清理失败' });
    }
  });

  app.post('/api/cron/tick', async (req, res) => {
    const db = loadDb();
    const summary = runCronTick(db);
    const cacheClean = cleanupStorageArtifacts({ cfg: db.storage_config, scope: 'expired_cache' });
    let autoReplenishedCount = 0;
    const replenishWarnings: string[] = [];

    const shouldAutoReplenish =
      req.body?.autoReplenish !== false &&
      Boolean(process.env.GEMINI_API_KEY || process.env.CUSTOM_AI_API_KEY || process.env.ANTHROPIC_API_KEY);
    if (shouldAutoReplenish && summary.lowPoolChannels.length > 0) {
      const monthPrefix = new Date().toISOString().slice(0, 7);
      for (const slug of summary.lowPoolChannels) {
        const ch = db.channels.find((c) => c.slug === slug);
        const profile = ch ? db.profiles.find((p) => p.channel_id === ch.id) : undefined;
        if (!ch || !profile) continue;
        const spend = db.ai_calls
          .filter((a) => a.channel_id === ch.id && a.created_at.startsWith(monthPrefix))
          .reduce((sum, a) => sum + a.cost_usd, 0);
        if (spend >= profile.ai_budget_monthly_usd) {
          replenishWarnings.push(`${slug}: AI 月预算已熔断 ($${spend.toFixed(2)}/$${profile.ai_budget_monthly_usd})`);
          continue;
        }
        try {
          const history = db.specs.filter((s) => s.channel_id === ch.id);
          const melodies = db.melodies.filter((m) => !m.channel_id || m.channel_id === ch.id);
          const remoteVideos = db.remote_videos.filter((v) => v.channel_id === ch.id);
          const generated = await generateSpecBatchWithGemini({
            channel: ch,
            profile,
            melodies,
            history,
            remoteVideos,
            count: 2,
            currentMonthSpendUsd: spend,
            aiConfig: db.ai_config,
          });
          db.ai_calls.unshift({
            id: `ai-auto-${Date.now().toString(36)}`,
            channel_id: ch.id,
            purpose: 'specgen',
            model: generated.model,
            tokens_in: generated.tokensIn,
            tokens_out: generated.tokensOut,
            cost_usd: generated.costUsd,
            created_at: new Date().toISOString(),
          });
          const { created } = ingestGeneratedSpecs(db, ch.id, generated.specs);
          autoReplenishedCount += created.length;
        } catch (err: unknown) {
          replenishWarnings.push(`${slug}: ${err instanceof Error ? err.message : '自动补货跳过'}`);
        }
      }
    }

    saveDb(db);
    res.json({ ok: true, ...summary, cacheCleaned: cacheClean.deletedCount, autoReplenishedCount, replenishWarnings });
  });

  app.post('/api/worker/claim', (req, res) => {
    const db = loadDb();
    const job = db.jobs.find((j) => j.type === 'render' && j.status === 'queued');
    if (!job) return res.json({ job: null });
    job.status = 'running';
    job.attempts += 1;
    job.updated_at = new Date().toISOString();
    saveDb(db);
    res.json({ job, worker: req.body?.worker ?? 'external-worker' });
  });

  app.post('/api/worker/complete', (req, res) => {
    const signature = req.header('x-worker-signature');
    if (signature && !verifyWorkerSignature(req.body ?? {}, signature)) {
      return res.status(401).json({ error: 'Worker HMAC 签名无效' });
    }
    const db = loadDb();
    const { job_id } = req.body ?? {};
    const job = db.jobs.find((j) => j.id === job_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.status = 'completed';
    job.updated_at = new Date().toISOString();
    saveDb(db);
    res.json({ ok: true, job });
  });

  app.post('/api/worker/fail', (req, res) => {
    const signature = req.header('x-worker-signature');
    if (signature && !verifyWorkerSignature(req.body ?? {}, signature)) {
      return res.status(401).json({ error: 'Worker HMAC 签名无效' });
    }
    const db = loadDb();
    const { job_id, reason_code = 'render_error' } = req.body ?? {};
    const job = db.jobs.find((j) => j.id === job_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    job.error_code = String(reason_code);
    job.status = job.attempts < job.max_attempts ? 'queued' : 'failed';
    job.updated_at = new Date().toISOString();
    saveDb(db);
    res.json({ ok: true, job });
  });

  app.get('/api/export', (_req, res) => {
    const db = loadDb();
    const { secrets: _omitSecrets, ...rest } = db;
    const sanitized = {
      ...rest,
      channels: db.channels.map((c) => ({ ...c, oauth_refresh_token_enc: undefined })),
    };
    res.json(sanitized);
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Shorts Studio control plane running on http://localhost:${PORT}`);
  });
}

startServer();
