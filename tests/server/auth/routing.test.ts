import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { roleHomePath } from '@/lib/server/auth/config';
import { safeNextPath } from '@/lib/server/auth/guards';

const FLAGS = [
  'NEXT_PUBLIC_WORKBENCH_ENABLED',
  'NEXT_PUBLIC_PRO_WORKBENCH_ENABLED',
  'OPENMAIC_AGENT_RUNTIME_ENABLED',
  'DATABASE_URL',
] as const;

describe('role routing', () => {
  const originals = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const name of FLAGS) {
      originals.set(name, process.env[name]);
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of FLAGS) {
      const original = originals.get(name);
      if (original === undefined) delete process.env[name];
      else process.env[name] = original;
    }
    originals.clear();
  });

  it('sends students home, teachers to the workspace and admins to the console', () => {
    expect(roleHomePath('student', true)).toBe('/');
    expect(roleHomePath('teacher', true)).toBe('/workspace');
    expect(roleHomePath('teacher', false)).toBe('/');
    expect(roleHomePath('admin', true)).toBe('/admin');
    expect(roleHomePath('admin', false)).toBe('/admin');
  });

  it('keeps a deep link the role may open', () => {
    expect(safeNextPath('/workspace?course=abc', 'teacher')).toBe('/workspace?course=abc');
    expect(safeNextPath('/admin?tab=users', 'admin')).toBe('/admin?tab=users');
    expect(safeNextPath('/account', 'student')).toBe('/account');
  });

  it('refuses a surface the role cannot open', () => {
    expect(safeNextPath('/workspace', 'student')).toBe('/');
    expect(safeNextPath('/workspace/course', 'student')).toBe('/');
    expect(safeNextPath('/workspace?course=abc', 'student')).toBe('/');
    expect(safeNextPath('/workspace/#pane', 'student')).toBe('/');
    expect(safeNextPath('/admin', 'student')).toBe('/');
    expect(safeNextPath('/admin/users', 'student')).toBe('/');
    expect(safeNextPath('/admin?tab=users', 'student')).toBe('/');
    expect(safeNextPath('/admin/users', 'teacher')).toBe('/');
    expect(safeNextPath('/admin?tab=users', 'teacher')).toBe('/');
  });

  it('refuses an off-site, protocol-relative or looping destination', () => {
    for (const next of [
      undefined,
      null,
      '',
      'workspace',
      'https://evil.example',
      '//evil.example',
      '/login',
      '/login?next=%2F',
    ]) {
      expect(safeNextPath(next, 'teacher')).toBe('/');
    }
    expect(safeNextPath(`/${'a'.repeat(2_001)}`, 'student')).toBe('/');
  });
});
