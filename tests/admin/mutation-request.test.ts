import { describe, expect, it } from 'vitest';

import { adminMutationInit } from '@/lib/admin/mutation-request';

describe('admin mutation requests', () => {
  it('sends a JSON content type and body even for a bodyless DELETE', () => {
    const init = adminMutationInit('DELETE');
    expect(init.method).toBe('DELETE');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(init.body).toBe('{}');
  });

  it('preserves an explicit body', () => {
    expect(adminMutationInit('PATCH', { active: true }).body).toBe('{"active":true}');
    expect(adminMutationInit('POST', { email: 'a@b.co' }).body).toBe('{"email":"a@b.co"}');
  });

  it('keeps GET bodyless', () => {
    const init = adminMutationInit('GET');
    expect(init.headers).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});
