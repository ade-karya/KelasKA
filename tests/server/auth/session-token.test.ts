import { describe, expect, it } from 'vitest';

import {
  signSessionToken,
  verifySessionToken,
  type SessionTokenPayload,
} from '@/lib/server/auth/session-token';

const SECRET = 'a-test-secret-long-enough-to-sign-with';
const NOW = 1_800_000_000;

function payload(overrides: Partial<SessionTokenPayload> = {}): SessionTokenPayload {
  return {
    sid: 'c2Vzc2lvbi1pZC10aGF0LWlzLWxvbmcgZW5vdWdo',
    sub: 'user-123',
    exp: NOW + 3600,
    ...overrides,
  };
}

describe('the signed session token', () => {
  it('round-trips the payload it signed', async () => {
    const token = await signSessionToken(payload(), SECRET);

    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toEqual(payload());
  });

  it('refuses a token signed under another secret', async () => {
    const token = await signSessionToken(payload(), SECRET);

    await expect(verifySessionToken(token, 'another-secret', NOW)).resolves.toBeNull();
  });

  it('refuses a tampered payload', async () => {
    const token = await signSessionToken(payload(), SECRET);
    const [prefix, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify(payload({ sub: 'someone-else' })), 'utf8').toString(
      'base64url',
    );

    await expect(
      verifySessionToken(`${prefix}.${forged}.${signature}`, SECRET, NOW),
    ).resolves.toBeNull();
  });

  it('refuses an expired token, and tolerates a minute of clock skew', async () => {
    const token = await signSessionToken(payload({ exp: NOW - 120 }), SECRET);

    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toBeNull();
    await expect(verifySessionToken(token, SECRET, NOW - 90)).resolves.toEqual(
      payload({ exp: NOW - 120 }),
    );
  });

  it('refuses anything malformed', async () => {
    for (const token of ['', 'v1', 'v2.abc.def', 'v1.not-base64!.signature', 'v1..', 'v1.abc']) {
      await expect(verifySessionToken(token, SECRET, NOW)).resolves.toBeNull();
    }
  });

  it('refuses a correctly signed payload with the wrong shape', async () => {
    const token = await signSessionToken(
      { sid: 'short', sub: '', exp: NOW + 60 } as SessionTokenPayload,
      SECRET,
    );

    await expect(verifySessionToken(token, SECRET, NOW)).resolves.toBeNull();
  });
});
