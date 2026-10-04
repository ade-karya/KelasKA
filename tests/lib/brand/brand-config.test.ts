import { describe, expect, it } from 'vitest';
import { DEFAULT_BRAND } from '@/lib/brand/brand-config';

describe('DEFAULT_BRAND (single-brand build)', () => {
  it('uses the Kelas KA product identity for full chrome', () => {
    expect(DEFAULT_BRAND.productName).toBe('Kelas KA');
    expect(DEFAULT_BRAND.shortName).toBe('Kelas KA');
    expect(DEFAULT_BRAND.markSrc).toBe('/logo-kemendikdasmen.png');
    expect(DEFAULT_BRAND.themeColor).toBe('#1d4ed8');
  });

  it('marks its horizontal logo as already containing the wordmark', () => {
    expect(DEFAULT_BRAND.logoHasWordmark).toBe(false);
    expect(DEFAULT_BRAND.logoSrc).toBe('/logo-kemendikdasmen.png');
  });
});
