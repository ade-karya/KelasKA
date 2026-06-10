import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isKelaskaEditorEnabled } from '@/lib/config/feature-flags';

const FLAG = 'NEXT_PUBLIC_KELASKA_EDITOR_ENABLED';

describe('isKelaskaEditorEnabled', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env[FLAG];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[FLAG];
    } else {
      process.env[FLAG] = original;
    }
  });

  it('returns false when the env var is unset', () => {
    delete process.env[FLAG];
    expect(isKelaskaEditorEnabled()).toBe(false);
  });

  it("returns true for 'true'", () => {
    process.env[FLAG] = 'true';
    expect(isKelaskaEditorEnabled()).toBe(true);
  });

  it("returns true for '1'", () => {
    process.env[FLAG] = '1';
    expect(isKelaskaEditorEnabled()).toBe(true);
  });

  it("returns false for 'false'", () => {
    process.env[FLAG] = 'false';
    expect(isKelaskaEditorEnabled()).toBe(false);
  });

  it('returns false for an unrecognized string', () => {
    process.env[FLAG] = 'yes';
    expect(isKelaskaEditorEnabled()).toBe(false);
  });
});
