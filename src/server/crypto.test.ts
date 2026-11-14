import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  signOAuthState,
  signWorkerPayload,
  verifyOAuthState,
  verifyWorkerSignature,
} from './crypto.ts';

test('AES-256-GCM encryptSecret / decryptSecret round-trip', () => {
  const secret = '1//0gFakeRefreshToken-Example-Value';
  const encrypted = encryptSecret(secret);
  assert.ok(encrypted.startsWith('v1:'));
  assert.notEqual(encrypted, secret);
  assert.equal(decryptSecret(encrypted), secret);
});

test('tampered ciphertext throws on decrypt', () => {
  const encrypted = encryptSecret('refresh-token-abc');
  const parts = encrypted.split(':');
  parts[3] = 'AAAA' + parts[3].slice(4);
  assert.throws(() => decryptSecret(parts.join(':')));
});

test('Worker HMAC-SHA256 signing & verification', () => {
  const payload = { job_id: 'job-1', status: 'completed', sim_hash: 'abc123' };
  const sig = signWorkerPayload(payload);
  assert.equal(verifyWorkerSignature(payload, sig), true);
  assert.equal(verifyWorkerSignature({ ...payload, status: 'failed' }, sig), false);
});

test('OAuth state HMAC signing prevents tampering', () => {
  const state = signOAuthState({ channelId: 'ch-physics-music', ts: 1700000000 });
  const parsed = verifyOAuthState<{ channelId: string; ts: number }>(state);
  assert.equal(parsed?.channelId, 'ch-physics-music');
  assert.equal(verifyOAuthState(state + 'x'), null);
});
