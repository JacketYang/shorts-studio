import {
  DEFAULT_AI_CONFIG,
  deleteChannelFromDb,
  enqueueWorkbenchItems,
  executeRenderForSpec,
  expandIdeaRecordToSpec,
  getChannelDataStats,
  getChannelScopedState,
  getServerEnvStatus,
  idempotentUploadVideo,
  loadDb,
  normalizeAiConfig,
  runCronTick,
  updateSpecCreative,
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
  assert.equal(custom.prompts.metadata_rewrite, DEFAULT_AI_CONFIG.prompts.metadata_rewrite);

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

test('enqueueWorkbenchItems supports in_review pipeline entry, promotion to scheduled, and preserves workbench_meta on retry', () => {
  const db = structuredClone(loadDb());
  const ch = db.channels[0];
  const sampleItem = {
    id: 'lorenz-test-01',
    baseId: 'lorenz-test-01',
    engine: 'lorenz',
    params: { sigma: 10, rho: 28, beta: 2.667 },
    seed: 123456,
    theme: 2,
    category: 'math',
    catLabel: '📐 数学图形',
    title: 'Lorenz Attractor Butterfly Effect',
    hook: 'Chaos that never repeats',
    description: 'Math visualization',
    tags: ['math', 'chaos'],
    filename: 'lorenz-test-01',
    durationSec: 22,
  };

  const reviewEnq = enqueueWorkbenchItems(db, ch.id, [sampleItem], { autoSchedule: false });
  assert.equal(reviewEnq.createdCount, 1);
  assert.equal(reviewEnq.entries[0].videoId, null);

  const specRec = db.specs.find((s) => s.id === reviewEnq.entries[0].specId)!;
  assert.equal(specRec.status, 'in_review');

  const retriedRender = executeRenderForSpec(db, specRec.id);
  assert.equal(retriedRender.worker, 'browser-workbench');
  assert.equal(retriedRender.workbench_meta?.engine, 'lorenz');
  assert.equal(retriedRender.media_ready, false);

  const promoteEnq = enqueueWorkbenchItems(db, ch.id, [sampleItem], { autoSchedule: true });
  assert.equal(promoteEnq.createdCount, 1);
  assert.ok(promoteEnq.entries[0].videoId);
  assert.equal(specRec.status, 'scheduled');

  // Adding a second identical-engine/theme/title item on the same channel triggers real novelty checks instead of a hardcoded 95
  const cloneItem = {
    ...sampleItem,
    id: 'lorenz-test-02',
    baseId: 'lorenz-test-02',
    filename: 'lorenz-test-02',
  };
  const dupEnq = enqueueWorkbenchItems(db, ch.id, [cloneItem], { autoSchedule: false });
  assert.equal(dupEnq.createdCount, 1);
  const dupRender = db.renders.find((r) => r.id === dupEnq.entries[0].renderId)!;
  assert.ok(dupRender.novelty.score < 95, `Expected real lowered novelty score for duplicate item, got ${dupRender.novelty.score}`);
  assert.ok(dupRender.novelty.violations.length > 0 || dupRender.novelty.verdict !== 'pass');
});

test('updateSpecCreative updates Workbench params, tempoScale, voice, invalidates stale media_ready, and updates Native Studio specs', () => {
  const db = structuredClone(loadDb());
  const ch = db.channels[0];

  // 1) Workbench spec path
  const wbRes = enqueueWorkbenchItems(
    db,
    ch.id,
    [
      {
        id: 'hop-tune-01',
        baseId: 'hop-tune-01',
        engine: 'hop',
        params: { song: 'canon', voice: 'marimba', tempoScale: 1, echo: true },
        seed: 55555,
        theme: 0,
        category: 'music',
        catLabel: '🎵 旋律弹跳',
        title: 'Canon Hop Original',
        hook: 'Wait for the drop',
        description: 'Canon hop test',
        tags: ['music', 'canon'],
        filename: 'hop-tune-01',
        durationSec: 26,
      },
    ],
    { autoSchedule: false }
  );
  const wbSpecId = wbRes.entries[0].specId;
  const wbRender = db.renders.find((r) => r.id === wbRes.entries[0].renderId)!;
  wbRender.media_ready = true;
  const prevHash = wbRender.file_sha256;

  const updatedWb = updateSpecCreative(db, wbSpecId, {
    title: 'Turkish March 1.5x Hop',
    hookLine: '1.5x Speed Celesta',
    theme: 2,
    seed: 77777,
    paramsPatch: { tempoScale: 1.5, songId: 'turkish', voice: 'celesta', echo: false },
  });

  const wbParams = updatedWb.render?.workbench_meta?.params as Record<string, unknown>;
  assert.equal(updatedWb.spec.spec.publish.title, 'Turkish March 1.5x Hop');
  assert.equal(updatedWb.spec.spec.concept.hook_line, '1.5x Speed Celesta');
  assert.equal(updatedWb.spec.spec.audio.music?.tempo_bpm, 162);
  assert.equal(updatedWb.spec.spec.axes.instrument, 'celesta');
  assert.equal(updatedWb.render?.workbench_meta?.theme, 2);
  assert.equal(updatedWb.render?.workbench_meta?.seed, 77777);
  assert.equal(wbParams?.tempoScale, 1.5);
  assert.equal(wbParams?.voice, 'celesta');
  assert.equal(wbParams?.echo, false);
  assert.equal(updatedWb.render?.media_ready, false);
  assert.notEqual(updatedWb.render?.file_sha256, prevHash);

  // 2) Native Studio spec path
  const nativeSpec = db.specs.find((s) => !db.renders.some((r) => r.spec_id === s.id && r.workbench_meta));
  assert.ok(nativeSpec, 'Expected at least one native spec in default database');
  const nextMelody = db.melodies[1]?.id ?? db.melodies[0]?.id ?? 'pd:canon-in-d';
  const prevRendersCount = db.renders.filter((r) => r.spec_id === nativeSpec.id).length;

  const updatedNative = updateSpecCreative(db, nativeSpec.id, {
    title: 'Native Kalimba 148 BPM Edition',
    audioPatch: {
      tempoBpm: 148,
      instrument: 'kalimba',
      melodyId: nextMelody,
      transpose: 2,
      reverb: 0,
    },
    motionSpeedScale: 1.25,
    paletteFamily: 'warm',
  });

  assert.equal(updatedNative.spec.spec.publish.title, 'Native Kalimba 148 BPM Edition');
  assert.equal(updatedNative.spec.spec.audio.music?.tempo_bpm, 148);
  assert.equal(updatedNative.spec.spec.audio.music?.instrument, 'kalimba');
  assert.equal(updatedNative.spec.spec.audio.music?.transpose, 2);
  assert.equal(updatedNative.spec.spec.audio.music?.reverb, 0);
  assert.equal(updatedNative.spec.spec.axes.instrument, 'kalimba');
  assert.equal(updatedNative.spec.spec.axes.palette_family, 'warm');
  assert.ok(db.renders.filter((r) => r.spec_id === nativeSpec.id).length >= prevRendersCount + 1);
});



