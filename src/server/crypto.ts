import crypto from 'node:crypto';

const DEV_FALLBACK_KEY = crypto
  .createHash('sha256')
  .update('shorts-studio-dev-local-encryption-key-change-in-prod')
  .digest();

function resolveAesKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw || raw.startsWith('REPLACE_WITH')) {
    return DEV_FALLBACK_KEY;
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypts sensitive refresh tokens using AES-256-GCM before storing in DB.
 */
export function encryptSecret(plaintext: string): string {
  const key = resolveAesKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${authTag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptSecret(ciphertext: string): string {
  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new Error('Unsupported encrypted token format');
  }
  const key = resolveAesKey();
  const iv = Buffer.from(parts[1], 'base64url');
  const authTag = Buffer.from(parts[2], 'base64url');
  const encrypted = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function resolveHmacSecret(): string {
  const raw = process.env.WORKER_HMAC_SECRET;
  if (!raw || raw.startsWith('REPLACE_WITH')) {
    return 'shorts-studio-dev-hmac-secret';
  }
  return raw;
}

export function signWorkerPayload(payload: string | Record<string, unknown>): string {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', resolveHmacSecret()).update(body).digest('hex');
}

export function verifyWorkerSignature(payload: string | Record<string, unknown>, signatureHex: string): boolean {
  if (!signatureHex) return false;
  const expected = signWorkerPayload(payload);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signatureHex.trim(), 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function signOAuthState(data: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', resolveAesKey()).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyOAuthState<T = Record<string, unknown>>(state: string): T | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', resolveAesKey()).update(encoded).digest('base64url');
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
