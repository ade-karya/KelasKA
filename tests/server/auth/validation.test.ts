import { describe, expect, it } from 'vitest';

import { normalizeEmail, validEmail, validName } from '@/lib/server/auth/validation';

describe('account input validation', () => {
  it('normalizes an e-mail the way storage and lookup do', () => {
    expect(normalizeEmail('  Admin@KelasKA.id ')).toBe('admin@kelaska.id');
  });

  it('accepts a plausible e-mail and refuses the rest', () => {
    expect(validEmail('guru@sekolah.id')).toBe('guru@sekolah.id');
    expect(validEmail('  GURU@Sekolah.ID ')).toBe('guru@sekolah.id');

    for (const value of [
      undefined,
      null,
      42,
      '',
      'not-an-email',
      'a@b',
      'a b@c.id',
      `${'a'.repeat(250)}@b.id`,
    ]) {
      expect(validEmail(value)).toBeUndefined();
    }
  });

  it('collapses whitespace in a name and bounds its length', () => {
    expect(validName('  Budi   Santoso  ')).toBe('Budi Santoso');
    expect(validName('')).toBeUndefined();
    expect(validName('   ')).toBeUndefined();
    expect(validName('a'.repeat(81))).toBeUndefined();
    expect(validName(7)).toBeUndefined();
  });
});
