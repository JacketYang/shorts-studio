import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScene } from './index';
import type { VideoSpec } from '../engine/types';

test('buildScene scales duration, audio timestamps, echo, and draw timeline for tempoScale', () => {
  const baseSpec: VideoSpec = {
    id: 'test-hop-1',
    engine: 'hop',
    params: { song: 'canon', tempoScale: 1, echo: true },
    seed: 12345,
    theme: 0,
    category: 'music',
    catLabel: '🎵 旋律弹跳',
    title: 'Test Hop',
    hook: 'Test Hook',
    description: 'Test',
    tags: [],
    filename: 'test-hop-1',
  };

  const base = buildScene(baseSpec);
  const fast = buildScene({
    ...baseSpec,
    params: { song: 'turkish', tempoScale: 2, echo: false, voice: 'celesta' },
  });

  assert.equal(fast.echo, false);
  assert.ok(base.duration > 10);
  assert.ok(Math.abs(fast.duration - Math.max(4, base.duration / 2)) < 0.05);

  const sameSongFast = buildScene({
    ...baseSpec,
    params: { song: 'canon', tempoScale: 2, echo: false },
  });
  assert.equal(sameSongFast.audio.length, base.audio.length);
  for (let i = 0; i < Math.min(8, base.audio.length); i++) {
    assert.ok(Math.abs(sameSongFast.audio[i].t - base.audio[i].t / 2) < 1e-6);
  }
});

test('buildScene transposes non-melody audio frequencies by semitones without altering melody count', () => {
  const baseLorenz: VideoSpec = {
    id: 'test-lorenz-1',
    engine: 'lorenz',
    params: { tempoScale: 1, transpose: 0 },
    seed: 999,
    theme: 1,
    category: 'math',
    catLabel: '📐 数学图形',
    title: 'Test Lorenz',
    hook: 'Chaos',
    description: 'Test',
    tags: [],
    filename: 'test-lorenz-1',
  };

  const base = buildScene(baseLorenz);
  const octaveUp = buildScene({
    ...baseLorenz,
    params: { tempoScale: 1, transpose: 12 },
  });

  assert.equal(octaveUp.audio.length, base.audio.length);
  assert.ok(base.audio.length > 0);
  for (let i = 0; i < Math.min(5, base.audio.length); i++) {
    assert.ok(Math.abs(octaveUp.audio[i].f - base.audio[i].f * 2) < 1e-5);
  }
});
