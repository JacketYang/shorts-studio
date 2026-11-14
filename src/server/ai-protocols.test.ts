import assert from 'node:assert/strict';
import test from 'node:test';
import { buildThinkingCascade } from './ai-protocols.ts';

test('buildThinkingCascade aligns max tier cleanly across OpenAI (xhigh -> max -> high), Anthropic, and Gemini', () => {
  const oaiMax = buildThinkingCascade('openai-compatible', 'max');
  assert.deepEqual(
    oaiMax.map((s) => s.value),
    ['xhigh', 'max', 'high', null]
  );

  const claudeMax = buildThinkingCascade('anthropic', 'max');
  assert.deepEqual(
    claudeMax.map((s) => s.value),
    [32000, 16000, 8192, null]
  );

  const geminiMax = buildThinkingCascade('gemini', 'max');
  assert.deepEqual(
    geminiMax.map((s) => s.value),
    [32768, 24576, 8192, null]
  );

  const offCascade = buildThinkingCascade('openai-compatible', 'off');
  assert.deepEqual(offCascade, [{ label: 'off', value: null }]);
});
