import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from './catalog/catalog';
import { BUILDERS, buildScene } from './scenes';
import {
  extractWorkbenchMetaFromSpec,
  matchWorkbenchChannelStatus,
  toWorkbenchEnqueueItem,
  workbenchItemToStudioSpec,
  workbenchMetaToWorkbenchSpec,
} from './bridge';
import type { RenderRecord, SpecRecord, VideoRecord } from '../domain/types';

test('video-workbench catalog builds 215 recipes and every engine exists in BUILDERS', () => {
  const recipes = buildCatalog();
  assert.equal(recipes.length, 215);
  for (const r of recipes) {
    assert.ok(BUILDERS[r.engine], `Missing builder for engine ${r.engine}`);
    const spec = r.spec(0);
    assert.ok(spec.id.length > 0);
    assert.ok(spec.title.length > 0);
  }
});

test('toWorkbenchEnqueueItem and workbenchItemToStudioSpec produce valid videospec/1', () => {
  const recipes = buildCatalog();
  const sample = recipes[0].spec(0);
  const scene = buildScene(sample);
  const payload = toWorkbenchEnqueueItem(sample, scene.duration);
  const studioSpec = workbenchItemToStudioSpec(payload, 'physics-music', 'neon');

  assert.equal(studioSpec.schema, 'videospec/1');
  assert.equal(studioSpec.channel_slug, 'physics-music');
  assert.ok(studioSpec.publish.title.length <= 100);
  assert.equal(studioSpec.provenance.generator.kind, 'bot');
  assert.equal(studioSpec.provenance.generator.model, `workbench:${sample.engine}`);

  const extracted = extractWorkbenchMetaFromSpec(studioSpec);
  assert.ok(extracted);
  assert.equal(extracted.engine, sample.engine);
});

test('matchWorkbenchChannelStatus tracks available, scheduled, mediaReady, and published states', () => {
  const recipes = buildCatalog();
  const sample = recipes[2].spec(0);
  const payload = toWorkbenchEnqueueItem(sample, 24);
  const studioSpec = workbenchItemToStudioSpec(payload, 'physics-music');

  const specs: SpecRecord[] = [
    {
      id: 'spec-1',
      channel_id: 'ch-1',
      spec: studioSpec,
      spec_hash: 'hash-1',
      schema_version: 'videospec/1',
      status: 'scheduled',
      series_id: null,
      episode: null,
      workbench_id: sample.id,
      created_at: '2026-11-15T00:00:00.000Z',
      updated_at: '2026-11-15T00:00:00.000Z',
    },
  ];
  const renders: RenderRecord[] = [
    {
      id: 'rnd-1',
      channel_id: 'ch-1',
      spec_id: 'spec-1',
      template_version: '1.0.0',
      status: 'completed',
      worker: 'browser-workbench',
      started_at: '2026-11-15T00:00:00.000Z',
      ended_at: '2026-11-15T00:00:01.000Z',
      duration_ms: 100,
      sim_hash: 'sim-1',
      file_sha256: 'sha-1',
      events: [],
      qa_checks: [],
      qa_passed: true,
      novelty: {
        score: 92,
        verdict: 'pass',
        violations: [],
        similarity: { visual_phash_distance: 16, melody_similarity: 0.1, text_jaccard: 0.1 },
        suggested_changes: [],
      },
      media_ready: true,
      media_ext: 'mp4',
      media_bytes: 2_500_000,
    },
  ];
  const videos: VideoRecord[] = [
    {
      id: 'vid-1',
      channel_id: 'ch-1',
      spec_id: 'spec-1',
      render_id: 'rnd-1',
      yt_video_id: null,
      idempotency_key: 'upload:vid-1',
      state: 'scheduled',
      scheduled_at: '2026-11-16T17:00:00.000Z',
      published_at: null,
      privacy: 'private',
      title: studioSpec.publish.title,
      description: studioSpec.publish.description,
      first_comment: '',
      first_comment_posted: false,
      quota_deferred: false,
    },
  ];

  const matched = matchWorkbenchChannelStatus(sample.id, sample.id, specs, renders, videos);
  assert.equal(matched.inChannel, true);
  assert.equal(matched.status, 'scheduled');
  assert.equal(matched.mediaReady, true);
  assert.equal(matched.mediaExt, 'mp4');

  const unmatched = matchWorkbenchChannelStatus('nonexistent-id', 'nonexistent-id', specs, renders, videos);
  assert.equal(unmatched.inChannel, false);
  assert.equal(unmatched.status, 'available');

  const rebuilt = workbenchMetaToWorkbenchSpec(
    {
      id: sample.id,
      base_id: sample.id,
      engine: sample.engine,
      params: sample.params,
      seed: sample.seed,
      theme: sample.theme,
      category: sample.category,
      cat_label: sample.catLabel,
      hook: sample.hook,
      filename: sample.filename,
      duration_sec: 24,
    },
    sample.title,
    sample.description,
    sample.tags
  );
  assert.equal(rebuilt.engine, sample.engine);
  assert.equal(rebuilt.seed, sample.seed);
});

test('workbench bridge extracts real distinct axes (music_piece, instrument, arena, rule, series=null) instead of hardcoded stubs', () => {
  const recipes = buildCatalog();
  const sampleIndices = [0, 1, 2, 100, 130, 155, 190];
  const mapped = sampleIndices.map((idx) => {
    const spec = recipes[idx].spec(0);
    const scene = buildScene(spec);
    return workbenchItemToStudioSpec(toWorkbenchEnqueueItem(spec, scene.duration), 'physics-music');
  });

  const instruments = new Set(mapped.map((m) => m.axes.instrument));
  const musicPieces = new Set(mapped.map((m) => m.axes.music_piece));
  const arenas = new Set(mapped.map((m) => m.axes.arena));
  const rules = new Set(mapped.map((m) => m.axes.rule));
  const palettes = new Set(mapped.map((m) => m.scene.style.palette.family));

  assert.ok(instruments.size >= 3, `Expected >= 3 distinct instruments, got ${instruments.size}`);
  assert.ok(musicPieces.size >= 4, `Expected >= 4 distinct music pieces, got ${musicPieces.size}`);
  assert.ok(arenas.size >= 5, `Expected >= 5 distinct arenas, got ${arenas.size}`);
  assert.ok(rules.size >= 5, `Expected >= 5 distinct rules, got ${rules.size}`);
  assert.ok(palettes.size >= 2, `Expected >= 2 theme-derived palette families, got ${palettes.size}`);
  for (const m of mapped) {
    assert.equal(m.concept.series, null);
  }
});

