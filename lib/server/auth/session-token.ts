/**
 * The signed session token, using Web Crypto only.
 *
 * Both the Edge proxy and the Node routes verify the same string, so the
 * signature lives in one module that neither runtime's exclusive APIs leak
 * into: no `node:crypto`, no database. The database row the token names is read
 * separately (`./session.ts`), so a valid signature only proves the cookie was
 * minted by this deployment — never that the account is still allowed in.
 *
 * Format: `v1.<base64url(payload json)>.<base64url(hmac-sha256)>`, where the
 * payload is `{ sid, sub, exp }` with `exp` in seconds since the epoch. The
 * role is deliberately NOT in the token: it changes under an admin's hands, and
 * a stale claim would route the account to the wrong home until its next login.
 */

export interface SessionTokenPayload {
  /** The session id (a random 32-byte base64url string). */
  readonly sid: string;
  /** The account id the session belongs to. */
  readonly sub: string;
  /** Expiry, seconds since the Unix epoch. */
  readonly exp: number;
}

const TOKEN_PREFIX = 'v1';
/** Tolerated clock skew when checking expiry, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  try {
    const binary = atob(padded + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Sign a payload into a cookie-safe token. */
export async function signSessionToken(
  payload: SessionTokenPayload,
  secret: string,
): Promise<string> {
  const encodedPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(`${TOKEN_PREFIX}.${encodedPayload}`),
  );
  return `${TOKEN_PREFIX}.${encodedPayload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/**
 * Verify a token's signature and expiry. Returns the payload, or `null` for
 * anything malformed, tampered with, signed under another secret or expired.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<SessionTokenPayload | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null;
  const [, encodedPayload, encodedSignature] = parts;

  const payloadBytes = base64UrlDecode(encodedPayload);
  const signatureBytes = base64UrlDecode(encodedSignature);
  if (!payloadBytes || !signatureBytes) return null;

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      signatureBytes,
      new TextEncoder().encode(`${TOKEN_PREFIX}.${encodedPayload}`),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { sid, sub, exp } = parsed as Partial<SessionTokenPayload>;
  if (typeof sid !== 'string' || sid.length < 16 || sid.length > 128) return null;
  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  if (exp + CLOCK_SKEW_SECONDS < nowSeconds) return null;
  return { sid, sub, exp };
}
