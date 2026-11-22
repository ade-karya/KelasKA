import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCourse, fetchCourses, formatDate } from '@/deploy/spa/lib/courses';

afterEach(() => vi.unstubAllGlobals());

describe('SPA course library', () => {
  it('lists courses with the app cookie included', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            stages: [{ id: 'stage-1', name: 'Hujan', sceneCount: 3, createdAt: 1, updatedAt: 2 }],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const courses = await fetchCourses();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stages',
      expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
    );
    expect(courses).toHaveLength(1);
    expect(courses[0]?.name).toBe('Hujan');
  });

  it('maps an unauthenticated refusal to an Indonesian message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    await expect(fetchCourses()).rejects.toThrow('Sesi aplikasi belum aktif');
  });

  it('creates a course and omits a blank description', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            stage: {
              id: 'stage-2',
              name: 'Fotosintesis',
              sceneCount: 0,
              createdAt: 1,
              updatedAt: 1,
            },
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const course = await createCourse('  Fotosintesis  ', '   ');
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ name: 'Fotosintesis' });
    expect(course.id).toBe('stage-2');
  });

  it('formats timestamps in Indonesian', () => {
    expect(formatDate(Date.UTC(2026, 0, 2))).toMatch(/2026/);
  });
});
