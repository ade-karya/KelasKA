export const ADMIN_COOKIE_NAME = 'openmaic_admin_session';

/** Convert string to Uint8Array */
export function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** Convert ArrayBuffer to hex string */
export function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Validates whether the admin password matches process.env.ADMIN_PASSWORD.
 */
export function verifyAdminPassword(password: string): boolean {
  const envPassword = process.env.ADMIN_PASSWORD;
  if (!envPassword) return false;
  return password === envPassword;
}

/**
 * Generates an HMAC token for the admin session.
 */
export async function generateAdminToken(): Promise<string> {
  const adminSecret = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET || 'default-admin-secret-replace-me';
  const timestamp = Date.now().toString();
  
  const keyData = encode(adminSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  
  const data = encode(timestamp);
  const signature = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));
  
  return `${timestamp}.${signature}`;
}

/**
 * Verify an HMAC-signed token using Web Crypto API (Edge-compatible)
 */
export async function verifyAdminToken(token: string): Promise<boolean> {
  const adminSecret = process.env.ADMIN_PASSWORD || process.env.ADMIN_SECRET;
  if (!adminSecret) {
    // If no admin secret is set, admin panel is effectively disabled.
    return false;
  }
  
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return false;

  const timestamp = token.substring(0, dotIndex);
  const signature = token.substring(dotIndex + 1);

  // Expire after 7 days
  const time = parseInt(timestamp, 10);
  if (isNaN(time) || Date.now() - time > 7 * 24 * 60 * 60 * 1000) {
    return false;
  }

  const keyData = encode(adminSecret);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData.buffer as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const data = encode(timestamp);
  const expected = bufToHex(await crypto.subtle.sign('HMAC', key, data.buffer as ArrayBuffer));

  if (signature.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}
