import {
  DEFAULT_AI_CONFIG,
  deleteChannelFromDb,
  expandIdeaRecordToSpec,
  getChannelDataStats,
  getChannelScopedState,
  getServerEnvStatus,
  idempotentUploadVideo,
  loadDb,
  normalizeAiConfig,
  runCronTick,
} from './store.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveMediaDirectories } from './storage.ts';

test('channel-scoped state enforces strict multi-channel isolation', () => {
  const db = loadDb();
  const stateA = getChannelScopedState(db, 'ch-physics-music');
  const stateB = getChannelScopedState(db, 'ch-algo-sounds');

  assert.equal(stateA.channel.id, 'ch-physics-music');
  assert.equal(stateB.channel.id, 'ch-algo-sounds');

  assert.ok(stateA.specs.every((s) => s.channel_id === 'ch-physics-music'));
  assert.ok(stateB.specs.every((s) => s.channel_id === 'ch-algo-sounds'));
  assert.ok(stateA.remote_videos.every((v) => v.channel_id === 'ch-physics-music'));
  assert.ok(stateB.remote_videos.every((v) => v.channel_id === 'ch-algo-sounds'));

  const idsA = new Set(stateA.specs.map((s) => s.id));
  for (const s of stateB.specs) {
    assert.equal(idsA.has(s.id), false);
  }
});

test('getChannelScopedState never leaks oauth_refresh_token_enc', () => {
  const db = structuredClone(loadDb());
  db.channels[0].oauth_connected = true;
  db.channels[0].oauth_refresh_token_enc = 'v1:secret_iv:secret_tag:secret_cipher';

  const state = getChannelScopedState(db, db.channels[0].id);
  assert.equal(state.channel.oauth_connected, true);
  assert.equal('oauth_refresh_token_enc' in state.channel, false);
  for (const ch of state.channels) {
    assert.equal('oauth_refresh_token_enc' in ch, false);
  }
});

test('expandIdeaRecordToSpec converts pending idea into spec_ready SpecRecord', () => {
  const db = structuredClone(loadDb());
  const ch = db.channels[0];
  const syntheticIdeaId = 'idea-hermetic-test';
  db.ideas.unshift({
    id: syntheticIdeaId,
    channel_id: ch.id,
    batch_id: 'batch-test',
    status: 'pending',
    spec_id: null,
    created_at: new Date().toISOString(),
    idea: {
      idea_key: 'hermetic-pentagon-test',
      channel_slug: ch.slug,
      mechanic: 'melody-bounce',
      arena: 'polygon',
      rule: 'speed-up',
      music_piece: 'pd:canon-in-d',
      hook_style: 'mystery',
      hook_line: 'Can you guess this melody before 3x speed?',
      title_candidates: ['Can You Guess This Melody Before 3x Speed?'],
      payoff: 'Clean resolution on beat 32',
      series: null,
      novelty_notes: 'Hermetic test fixture',
    },
  });

  const spec = expandIdeaRecordToSpec(db, syntheticIdeaId);
  const updatedIdea = db.ideas.find((i) => i.id === syntheticIdeaId)!;
  assert.equal(spec.status, 'spec_ready');
  assert.equal(spec.channel_id, ch.id);
  assert.equal(updatedIdea.status, 'expanded');
  assert.equal(updatedIdea.spec_id, spec.id);
});

test('runCronTick processes queued jobs past run_at', () => {
  const db = structuredClone(loadDb());
  const pastIso = new Date(Date.now() - 60_000).toISOString();
  db.jobs.unshift({
    id: 'job-test-cron',
    channel_id: db.channels[0].id,
    type: 'sync_videos',
    status: 'queued',
    attempts: 0,
    max_attempts: 3,
    idempotency_key: 'test-cron-key',
    run_at: pastIso,
    payload: {},
    created_at: pastIso,
    updated_at: pastIso,
  });

  const summary = runCronTick(db, new Date());
  assert.ok(summary.processedJobs >= 1);
  const job = db.jobs.find((j) => j.id === 'job-test-cron');
  assert.equal(job?.status, 'completed');
});

test('idempotentUploadVideo recovers from 90% network drop without duplicate YouTube IDs', () => {
  const db = structuredClone(loadDb());
  const ch = db.channels.find((c) => c.id === 'ch-physics-music')!;
  ch.api_audit_verified = true;

  const vid = db.videos[0];
  vid.yt_video_id = null;
  vid.state = 'scheduled';

  const dropRes = idempotentUploadVideo(db, vid.id, true);
  assert.equal(dropRes.video.state, 'failed');
  assert.ok(dropRes.video.yt_video_id);
  const firstYtId = dropRes.video.yt_video_id;

  const retryRes = idempotentUploadVideo(db, vid.id, false);
  assert.equal(retryRes.alreadyExisted, true);
  assert.equal(retryRes.quotaCharged, 0);
  assert.equal(retryRes.video.yt_video_id, firstYtId);
  assert.equal(retryRes.video.state, 'published');
});

test('normalizeAiConfig defaults thinking_level to max and supports anthropic + openai-compatible', () => {
  const def = normalizeAiConfig(undefined);
  assert.equal(def.provider, 'gemini');
  assert.equal(def.thinking_level, 'max');
  assert.equal(def.model, DEFAULT_AI_CONFIG.model);
  assert.ok(def.prompts.specgen_system.length > 20);

  const custom = normalizeAiConfig({
    provider: 'openai-compatible',
    base_url: ' https://api.deepseek.com/v1 ',
    model: 'deepseek-chat',
    thinking_level: 'low',
    prompts: {
      specgen_system: 'Custom SpecGen prompt',
      next_episode: '',
      comment_reply: 'Custom comment prompt',
    },
  });
  assert.equal(custom.provider, 'openai-compatible');
  assert.equal(custom.base_url, 'https://api.deepseek.com/v1');
  assert.equal(custom.model, 'deepseek-chat');
  assert.equal(custom.thinking_level, 'low');
  assert.equal(custom.prompts.specgen_system, 'Custom SpecGen prompt');
  assert.equal(custom.prompts.next_episode, DEFAULT_AI_CONFIG.prompts.next_episode);
  assert.equal(custom.prompts.comment_reply, 'Custom comment prompt');

  const claude = normalizeAiConfig({
    provider: 'anthropic',
    base_url: 'https://api.anthropic.com',
    model: 'claude-3-7-sonnet-20250219',
  });
  assert.equal(claude.provider, 'anthropic');
  assert.equal(claude.thinking_level, 'max');
});

test('getServerEnvStatus exposes platform & storage statuses without non-platform token_enc_key', () => {
  const envStatus = getServerEnvStatus();
  assert.equal('token_enc_key' in envStatus, false);
  assert.equal(typeof envStatus.anthropic_key, 'boolean');
  assert.equal(typeof envStatus.s3_credentials, 'boolean');
  assert.equal(typeof envStatus.webdav_credentials, 'boolean');
  assert.equal(typeof envStatus.database_url, 'boolean');
});

test('deleteChannelFromDb supports archive retention vs complete wipe of all records and physical media files', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-ch-del-'));
  try {
    // Case 1: purgeData = false removes channel + profile only, keeps archive
    const dbKeep = structuredClone(loadDb());
    const targetId = dbKeep.channels[1].id;
    const statsBefore = getChannelDataStats(dbKeep, targetId);
    assert.ok(statsBefore.specs >= 1);

    const keepRes = deleteChannelFromDb(dbKeep, targetId, { purgeData: false, skipDiskCleanup: true });
    assert.equal(keepRes.deletedChannelId, targetId);
    assert.equal(dbKeep.channels.some((c) => c.id === targetId), false);
    assert.equal(dbKeep.specs.some((s) => s.channel_id === targetId), true);

    // Case 2: purgeData = true wipes every table + physical media files cleanly
    const dbPurge = structuredClone(loadDb());
    dbPurge.storage_config.local_dir = tempRoot;
    const dirs = resolveMediaDirectories(dbPurge.storage_config);

    const syntheticRenderId = 'rnd-purge-test-1';
    const nowIso = new Date().toISOString();
    dbPurge.renders.unshift({
      id: syntheticRenderId,
      channel_id: targetId,
      spec_id: 'spec-purge-test-1',
      template_version: '1.0.0',
      status: 'completed',
      worker: 'local-test',
      started_at: nowIso,
      ended_at: nowIso,
      duration_ms: 2000,
      sim_hash: 'hash-test',
      file_sha256: 'sha-test',
      events: [],
      qa_checks: [],
      qa_passed: true,
      novelty: {
        score: 0.9,
        verdict: 'pass',
        violations: [],
        similarity: { visual_phash_distance: 24, melody_similarity: 0.1, text_jaccard: 0.1 },
        suggested_changes: [],
      },
      remote_url: null,
    });
    const otherRender = dbPurge.renders.find((r) => r.channel_id !== targetId);

    const targetMp4 = path.join(dirs.rendersDir, `${syntheticRenderId}.mp4`);
    const targetCache = path.join(dirs.cacheDir, `${syntheticRenderId}.json`);
    fs.writeFileSync(targetMp4, Buffer.alloc(1024, 9));
    fs.writeFileSync(targetCache, '{"tmp":1}', 'utf8');

    const otherMp4 = otherRender ? path.join(dirs.rendersDir, `${otherRender.id}.mp4`) : null;
    if (otherMp4) fs.writeFileSync(otherMp4, Buffer.alloc(512, 7));

    const purgeRes = deleteChannelFromDb(dbPurge, targetId, { purgeData: true });
    assert.equal(purgeRes.deletedFiles, 2);
    assert.equal(fs.existsSync(targetMp4), false);
    assert.equal(fs.existsSync(targetCache), false);
    if (otherMp4) assert.equal(fs.existsSync(otherMp4), true);

    assert.equal(dbPurge.channels.some((c) => c.id === targetId), false);
    assert.equal(dbPurge.profiles.some((p) => p.channel_id === targetId), false);
    assert.equal(dbPurge.ideas.some((i) => i.channel_id === targetId), false);
    assert.equal(dbPurge.specs.some((s) => s.channel_id === targetId), false);
    assert.equal(dbPurge.renders.some((r) => r.channel_id === targetId), false);
    assert.equal(dbPurge.videos.some((v) => v.channel_id === targetId), false);
    assert.equal(dbPurge.remote_videos.some((v) => v.channel_id === targetId), false);
    assert.equal(dbPurge.comments.some((c) => c.channel_id === targetId), false);
    assert.equal(dbPurge.jobs.some((j) => j.channel_id === targetId), false);

    // Deleting the last remaining channel must throw cleanly
    assert.throws(() => deleteChannelFromDb(dbPurge, dbPurge.channels[0].id, { purgeData: true }));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});


