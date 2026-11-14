import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MELODIES, parseNoteSequence } from './melodies';
import { buildCustomVideoSpec, FIXTURE_BALL_SORT, FIXTURE_MELODY_BOUNCE } from './templates';
import { computeSpecHash, validateImportPayload } from './videospec';
import type { Channel } from './types';

const TEST_CHANNELS: Channel[] = [
  {
    id: 'ch-1',
    slug: 'physics-music',
    yt_channel_id: 'UC_TEST_1',
    title: 'Physics & Music Shorts',
    status: 'connected',
    api_audit_verified: false,
    gcp_project_ref: 'proj-main',
    created_at: '2026-10-26T00:00:00Z',
  },
];

test('validates both VideoSpec fixtures cleanly', () => {
  const batch = {
    schema: 'specbatch/1',
    batch_id: 'test-batch-1',
    generated_at: '2026-11-15T08:00:00Z',
    items: [FIXTURE_MELODY_BOUNCE, FIXTURE_BALL_SORT],
  };
  const res = validateImportPayload(batch, {
    channels: TEST_CHANNELS,
    melodies: INITIAL_MELODIES,
    existingSpecHashesByChannel: new Map(),
    existingSpecKeysByChannel: new Map(),
  });
  assert.equal(res.accepted.length, 2);
  assert.equal(res.issues.filter((i) => i.level === 'error').length, 0);
});

test('spec_hash ignores provenance and spec_key and detects duplicate specs (E041)', () => {
  const hashA = computeSpecHash(FIXTURE_MELODY_BOUNCE);
  const clone = structuredClone(FIXTURE_MELODY_BOUNCE);
  clone.spec_key = 'mb-canon-hexagon-split-9999';
  clone.provenance.created_at = '2026-11-20T00:00:00Z';
  const hashB = computeSpecHash(clone);
  assert.equal(hashA, hashB);

  const res = validateImportPayload(clone, {
    channels: TEST_CHANNELS,
    melodies: INITIAL_MELODIES,
    existingSpecHashesByChannel: new Map([['ch-1', new Set([hashA])]]),
    existingSpecKeysByChannel: new Map(),
  });
  assert.equal(res.accepted.length, 0);
  assert.ok(res.issues.some((i) => i.code === 'E041'));
});

test('returns structured JSON path error codes for invalid params and missing melody', () => {
  const bad = structuredClone(FIXTURE_MELODY_BOUNCE);
  (bad.scene.params as Record<string, unknown>).arena = { shape: 'octagon', size: 0.1 };
  bad.audio.music = {
    ...bad.audio.music!,
    melody_ref: { source: 'library', id: 'pd:nonexistent' },
  };
  const res = validateImportPayload(
    { schema: 'specbatch/1', batch_id: 'bad-1', generated_at: '2026-11-15T00:00:00Z', items: [bad] },
    {
      channels: TEST_CHANNELS,
      melodies: INITIAL_MELODIES,
      existingSpecHashesByChannel: new Map(),
      existingSpecKeysByChannel: new Map(),
    }
  );
  assert.equal(res.accepted.length, 0);
  assert.ok(res.issues.some((i) => i.code === 'E011' && i.path.includes('items[0].scene.params.arena')));
  assert.ok(res.issues.some((i) => i.code === 'E030' && i.path === 'items[0].audio.music.melody_ref.id'));
});

test('parseNoteSequence parses MIDI and pitch names cleanly and rejects invalid inputs', () => {
  const okNames = parseNoteSequence('C4:1, E4:0.5, G#4:0.5, Bb4:2');
  assert.equal(okNames.error, undefined);
  assert.equal(okNames.notes.length, 4);
  assert.equal(okNames.notes[0].pitch, 60);
  assert.equal(okNames.notes[0].beat, 0);
  assert.equal(okNames.notes[2].pitch, 68);
  assert.equal(okNames.notes[2].beat, 1.5);
  assert.equal(okNames.notes[3].pitch, 70);
  assert.equal(okNames.notes[3].beat, 2);

  const okMidi = parseNoteSequence('60, 64, 67, 72');
  assert.equal(okMidi.error, undefined);
  assert.equal(okMidi.notes[3].beat, 3);

  const tooShort = parseNoteSequence('C4:1, E4:1');
  assert.ok(tooShort.error);

  const badPitch = parseNoteSequence('C4:1, H4:1, G4:1, C5:1');
  assert.ok(badPitch.error);
});

test('buildCustomVideoSpec generates valid specs for all 4 physics/music templates', () => {
  const cases: Array<{
    template: 'melody-bounce' | 'ball-sort' | 'pendulum-wave' | 'orbit-sync';
    arena: string;
    rule: string;
  }> = [
    { template: 'melody-bounce', arena: 'hexagon', rule: 'split-on-bounce' },
    { template: 'ball-sort', arena: 'funnel', rule: 'color-filter-gate' },
    { template: 'pendulum-wave', arena: 'wave-beam', rule: 'harmonic-sweep' },
    { template: 'orbit-sync', arena: 'concentric-rings', rule: 'harmonic-align' },
  ];

  const built = cases.map((c, idx) =>
    buildCustomVideoSpec({
      channelSlug: 'physics-music',
      template: c.template,
      arena: c.arena,
      rule: c.rule,
      melodyId: 'pd:canon-in-d',
      instrument: 'marimba',
      tempoBpm: 110,
      durationSec: 26,
      seed: 123456 + idx,
      paletteFamily: 'neon',
      hookStyle: 'mystery',
      hookLine: 'Wait for alignment',
      title: `Custom ${c.template} Simulation #${idx + 1}`,
      firstComment: 'Which beat hit best?',
      loopEnabled: true,
    })
  );

  const res = validateImportPayload(
    {
      schema: 'specbatch/1',
      batch_id: 'custom-builder-test',
      generated_at: '2026-11-15T00:00:00Z',
      items: built,
    },
    {
      channels: TEST_CHANNELS,
      melodies: INITIAL_MELODIES,
      existingSpecHashesByChannel: new Map(),
      existingSpecKeysByChannel: new Map(),
    }
  );

  assert.equal(res.issues.filter((i) => i.level === 'error').length, 0);
  assert.equal(res.accepted.length, 4);
});

