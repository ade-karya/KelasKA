import { describe, expect, it } from 'vitest';

import { staticRouteId, staticRouteLoginNext } from '@/components/static-ui/static-deep-link';

/**
 * Vercel rewrites `/classroom/<id>` to `/classroom?id=<id>` internally: the
 * browser URL keeps the path form, so `useSearchParams()` has no id. That is
 * what produced "Kelas tidak ditemukan." after generating a class on the
 * static UI. Both link shapes must resolve.
 */
describe('static deep links', () => {
  it('reads the id from the query (the canonical static form)', () => {
    expect(staticRouteId(new URLSearchParams('id=stage-abc'), '/classroom', 'classroom')).toBe(
      'stage-abc',
    );
  });

  it('reads the id from the rewritten path when the query is empty', () => {
    expect(
      staticRouteId(new URLSearchParams(''), '/classroom/stage-Gy1b8oDXSKXt', 'classroom'),
    ).toBe('stage-Gy1b8oDXSKXt');
  });

  it('keeps other query parameters when the path form carries them', () => {
    const params = new URLSearchParams('scene=scene-1');
    expect(staticRouteId(params, '/classroom/stage-abc', 'classroom')).toBe('stage-abc');
    expect(staticRouteLoginNext(params, 'classroom', 'stage-abc')).toBe(
      '/classroom?scene=scene-1&id=stage-abc',
    );
  });

  it('prefers a query id over a path segment', () => {
    expect(
      staticRouteId(new URLSearchParams('id=from-query'), '/classroom/from-path', 'classroom'),
    ).toBe('from-query');
  });

  it('does not invent an id from the bare route or a deeper path', () => {
    expect(staticRouteId(new URLSearchParams(''), '/classroom', 'classroom')).toBeNull();
    expect(
      staticRouteId(new URLSearchParams(''), '/classroom/stage-abc/extra', 'classroom'),
    ).toBeNull();
    expect(
      staticRouteId(new URLSearchParams(''), '/project-workspace/stage-abc', 'classroom'),
    ).toBeNull();
  });

  it('decodes an encoded path id but rejects a malformed escape', () => {
    expect(staticRouteId(new URLSearchParams(''), '/classroom/a%20b', 'classroom')).toBe('a b');
    expect(staticRouteId(new URLSearchParams(''), '/classroom/%E0%A4%A', 'classroom')).toBeNull();
  });

  it('supports the project-workspace rewrite and its workspaceId alias', () => {
    expect(
      staticRouteId(new URLSearchParams(''), '/project-workspace/ws-1', 'project-workspace', [
        'id',
        'workspaceId',
      ]),
    ).toBe('ws-1');
    expect(
      staticRouteId(
        new URLSearchParams('workspaceId=ws-2'),
        '/project-workspace',
        'project-workspace',
        ['id', 'workspaceId'],
      ),
    ).toBe('ws-2');
    expect(
      staticRouteLoginNext(new URLSearchParams('id=stale'), 'project-workspace', 'ws-1', [
        'id',
        'workspaceId',
      ]),
    ).toBe('/project-workspace?id=ws-1');
  });
});
