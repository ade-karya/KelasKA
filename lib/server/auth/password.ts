import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Username+password credential hashing (scrypt, stdlib only).
 *
 * Stored format: `scrypt$N$r$p$saltHex$hashHex`
 * - salt: 16 random bytes (hex)
 * - hash: 64 bytes from scrypt (hex)
 * - default params: N=16384, r=8, p=1
 */

const DEFAULT_N = 16384;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

/**
 * Maximum password length (characters). Bounds scrypt input so a huge
 * password cannot burn CPU/memory (anti-DoS). 128 chars is far above any
 * legitimate password while keeping KDF work predictable.
 */
export const MAX_PASSWORD_LENGTH = 128;

// Strict-parsing bounds for the stored `scrypt$N$r$p$salt$hash` envelope.
// N/r/p come from the DB (attacker-influenced), so an unbounded value would
// turn verify into a memory/CPU bomb via scryptSync.
const MAX_STORED_LENGTH = 1024;
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 8;
const INT_RE = /^\d+$/;
const HEX_RE = /^[0-9a-fA-F]+$/;

function parseBoundedInt(raw: string, max: number): number | null {
  if (!INT_RE.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) return null;
  return value;
}

export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('password must be a non-empty string');
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error(`password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(password, salt, KEY_BYTES, {
    N: DEFAULT_N,
    r: DEFAULT_R,
    p: DEFAULT_P,
  });
  return `scrypt$${DEFAULT_N}$${DEFAULT_R}$${DEFAULT_P}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    // Reject before any KDF work: empty or oversized input never reaches scrypt.
    if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;
    if (stored.length === 0 || stored.length > MAX_STORED_LENGTH) return false;
    const parts = stored.split('$');
    // ["scrypt", N, r, p, saltHex, hashHex]
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = parseBoundedInt(parts[1], MAX_N);
    const r = parseBoundedInt(parts[2], MAX_R);
    const p = parseBoundedInt(parts[3], MAX_P);
    if (n === null || r === null || p === null) return false;
    // scrypt requires N to be a power of two greater than 1.
    if (n <= 1 || (n & (n - 1)) !== 0) return false;
    const saltHex = parts[4];
    const hashHex = parts[5];
    if (saltHex.length !== SALT_BYTES * 2 || hashHex.length !== KEY_BYTES * 2) return false;
    if (!HEX_RE.test(saltHex) || !HEX_RE.test(hashHex)) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
    const actual = scryptSync(password, salt, KEY_BYTES, { N: n, r, p });
    if (actual.length !== expected.length) return false;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
