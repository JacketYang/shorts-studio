import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_MELODIES } from './melodies';
import { runDeterministicSimulation } from './simulation';
import { FIXTURE_BALL_SORT, FIXTURE_MELODY_BOUNCE, FIXTURE_ORBIT_SYNC, FIXTURE_PENDULUM_WAVE } from './templates';
import { parseStudioCsv } from './analytics';

test('deterministic simulation yields identical sim_hash and events across two runs', () => {
  const melody = INITIAL_MELODIES.find((m) => m.id === 'pd:canon-in-d');
  const run1 = runDeterministicSimulation(FIXTURE_MELODY_BOUNCE, melody);
  const run2 = runDeterministicSimulation(FIXTURE_MELODY_BOUNCE, melody);
  assert.equal(run1.sim_hash, run2.sim_hash);
  assert.equal(run1.events.length, run2.events.length);
  assert.ok(run1.qa_passed);
  assert.ok(run1.hook_audio_onset_sec <= 0.5);
});

test('ball-sort simulation runs deterministically and passes QA', () => {
  const melody = INITIAL_MELODIES.find((m) => m.id === 'gen:pentatonic-5521');
  const run1 = runDeterministicSimulation(FIXTURE_BALL_SORT, melody);
  const run2 = runDeterministicSimulation(FIXTURE_BALL_SORT, melody);
  assert.equal(run1.sim_hash, run2.sim_hash);
  assert.ok(run1.events.some((e) => e.type === 'bin_drop'));
});

test('pendulum-wave simulation runs deterministically and passes QA', () => {
  const melody = INITIAL_MELODIES.find((m) => m.id === 'gen:lydian-3141');
  const run1 = runDeterministicSimulation(FIXTURE_PENDULUM_WAVE, melody);
  const run2 = runDeterministicSimulation(FIXTURE_PENDULUM_WAVE, melody);
  assert.equal(run1.sim_hash, run2.sim_hash);
  assert.equal(run1.qa_passed, true);
  assert.ok(run1.events.length > 20);
  assert.ok(run1.hook_audio_onset_sec <= 0.5);
});

test('orbit-sync simulation runs deterministically and passes QA', () => {
  const melody = INITIAL_MELODIES.find((m) => m.id === 'gen:pentatonic-5521');
  const run1 = runDeterministicSimulation(FIXTURE_ORBIT_SYNC, melody);
  const run2 = runDeterministicSimulation(FIXTURE_ORBIT_SYNC, melody);
  assert.equal(run1.sim_hash, run2.sim_hash);
  assert.equal(run1.qa_passed, true);
  assert.ok(run1.events.length > 20);
  assert.ok(run1.hook_audio_onset_sec <= 0.5);
});

test('Studio CSV parser extracts metrics and estimates stayed-to-watch when column omitted', () => {
  const csv = [
    'Content,Video title,Video publish time,Duration,Views,Engaged views,Average percentage viewed,Average view duration,Subscribers gained,Watch time (hours)',
    'JTrpkr4ZGCo,Canon in D on a Bouncing Ball Xylophone,2026-11-08,26,1871,923,94.2%,24,4,12.5',
    'LEGACY01,消防设施操作员实操讲解,2025-05-01,420,1,1,15.0%,63,0,0.02',
  ].join('\n');
  const rows = parseStudioCsv(csv, 'ch-1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].yt_video_id, 'JTrpkr4ZGCo');
  assert.equal(rows[0].stayed_is_estimated, true);
  assert.ok(rows[0].stayed_to_watch_pct > 45);
  assert.equal(rows[1].is_legacy, true);
});
