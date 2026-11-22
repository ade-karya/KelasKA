import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchStage,
  orderedScenes,
  slideText,
  stripHtml,
  type ClassroomDocument,
} from '@/deploy/spa/lib/classroom';

afterEach(() => vi.unstubAllGlobals());

const document: ClassroomDocument = {
  stage: { id: 'stage-1', name: 'Hujan', updatedAt: 2 },
  scenes: [
    {
      id: 's2',
      title: 'Kedua',
      order: 2,
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          elements: [
            { type: 'text', content: '<p>Evaporasi &amp; <strong>kondensasi</strong></p>' },
            { type: 'shape', content: 'bukan teks' },
          ],
        },
      },
    },
    {
      id: 's1',
      title: 'Pertama',
      order: 1,
      type: 'quiz',
      content: { type: 'quiz', questions: [] },
    },
  ],
};

describe('SPA classroom helpers', () => {
  it('fetches a stage with the app cookie and encodes its id', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    await fetchStage('stage/1');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/stages/stage%2F1',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('maps an owner refusal to an Indonesian message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 403 })),
    );
    await expect(fetchStage('stage-1')).rejects.toThrow('bukan milik Anda');
  });

  it('strips HTML from slide text elements only', () => {
    expect(stripHtml('<p>A &amp; <b>B</b><br>C</p>')).toBe('A & B\nC');
    expect(slideText(document.scenes[0]!)).toEqual(['Evaporasi & kondensasi']);
    expect(slideText(document.scenes[1]!)).toEqual([]);
  });

  it('orders scenes for playback', () => {
    expect(orderedScenes(document).map((scene) => scene.title)).toEqual(['Pertama', 'Kedua']);
  });
});
