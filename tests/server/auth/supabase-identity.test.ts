import { describe, expect, it } from 'vitest';

import { googleIdentityFromSupabaseUser } from '@/lib/server/auth/supabase-identity';

const googleIdentityData = {
  sub: 'google-sub-123',
  email: 'Student@Example.com',
  email_verified: true,
  name: 'Student Name',
};

function supabaseUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'supabase-user-id',
    email: 'Student@Example.com',
    email_confirmed_at: '2026-11-15T00:00:00Z',
    user_metadata: { full_name: 'Student Name' },
    app_metadata: { provider: 'google', providers: ['google'] },
    identities: [{ provider: 'google', identity_data: googleIdentityData }],
    ...overrides,
  };
}

describe('googleIdentityFromSupabaseUser', () => {
  it('maps a verified Google user onto the account identity', () => {
    expect(googleIdentityFromSupabaseUser(supabaseUser())).toEqual({
      subject: 'google-sub-123',
      email: 'student@example.com',
      name: 'Student Name',
    });
  });

  it('refuses a missing user and a missing e-mail', () => {
    expect(googleIdentityFromSupabaseUser(null)).toBeNull();
    expect(googleIdentityFromSupabaseUser(supabaseUser({ email: null }))).toBeNull();
    expect(googleIdentityFromSupabaseUser(supabaseUser({ email: '   ' }))).toBeNull();
  });

  it('refuses an unverified Google identity even with a confirmed timestamp elsewhere', () => {
    const unverified = supabaseUser({
      identities: [
        { provider: 'google', identity_data: { ...googleIdentityData, email_verified: false } },
      ],
    });
    // user_metadata.email_verified also unset and no confirmed stamp: refused.
    expect(googleIdentityFromSupabaseUser({ ...unverified, email_confirmed_at: null })).toBeNull();
  });

  it('accepts metadata.email_verified as the verification proof', () => {
    const user = supabaseUser({
      identities: [
        { provider: 'google', identity_data: { ...googleIdentityData, email_verified: false } },
      ],
      user_metadata: { full_name: 'Student Name', email_verified: true },
      email_confirmed_at: null,
    });
    expect(googleIdentityFromSupabaseUser(user)?.subject).toBe('google-sub-123');
  });

  it('accepts email_confirmed_at as the verification proof', () => {
    const user = supabaseUser({
      identities: [
        { provider: 'google', identity_data: { ...googleIdentityData, email_verified: false } },
      ],
      user_metadata: {},
    });
    expect(googleIdentityFromSupabaseUser(user)?.subject).toBe('google-sub-123');
  });

  it("binds the Google sub, never the e-mail and never Supabase's own id", () => {
    const identity = googleIdentityFromSupabaseUser(supabaseUser());
    expect(identity?.subject).toBe('google-sub-123');

    // Without an identity_data.sub, the Supabase id is the stable fallback.
    const noSub = supabaseUser({
      identities: [{ provider: 'google', identity_data: { email: 'student@example.com' } }],
    });
    expect(googleIdentityFromSupabaseUser(noSub)?.subject).toBe('supabase-user-id');
  });

  it('refuses when neither a provider sub nor a Supabase id exists', () => {
    const noSubject = supabaseUser({
      id: undefined,
      identities: [{ provider: 'google', identity_data: { email: 'student@example.com' } }],
    });
    expect(googleIdentityFromSupabaseUser(noSubject)).toBeNull();
  });

  it('falls back to the first identity carrying identity_data', () => {
    const user = supabaseUser({
      identities: [
        { provider: 'apple', identity_data: { sub: 'oidc-sub-9', email_verified: true } },
      ],
    });
    expect(googleIdentityFromSupabaseUser(user)?.subject).toBe('oidc-sub-9');
  });

  it('derives a display name when Google provides none', () => {
    const user = supabaseUser({
      user_metadata: {},
      identities: [{ provider: 'google', identity_data: { ...googleIdentityData, name: '  ' } }],
    });
    expect(googleIdentityFromSupabaseUser(user)?.name).toBe('student');
  });

  it('prefers full_name, then name, then user_name from user_metadata', () => {
    const withName = supabaseUser({ user_metadata: { name: 'Nama Lengkap' } });
    expect(googleIdentityFromSupabaseUser(withName)?.name).toBe('Nama Lengkap');
    const withUserName = supabaseUser({ user_metadata: { user_name: 'user.name' } });
    expect(googleIdentityFromSupabaseUser(withUserName)?.name).toBe('user.name');
  });

  it('normalizes the e-mail for storage and lookup', () => {
    const user = supabaseUser({ email: '  MixedCase@Example.COM ' });
    expect(googleIdentityFromSupabaseUser(user)?.email).toBe('mixedcase@example.com');
  });
});
