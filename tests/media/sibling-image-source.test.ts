/**
 * Sibling-still reuse for image-to-video generation.
 *
 * When a video element sits on a slide that already holds a committed image
 * (e.g. a class image generated earlier), the orchestrator animates THAT
 * still instead of billing a second image generation.
 */
import { describe, expect, it } from 'vitest';

import {
  findOtherSlideImageSources,
  findSiblingImageSources,
  materializeSiblingStill,
} from '@/lib/media/media-orchestrator';

const slideWithVideoAndImage = {
  id: 'scene_1',
  content: {
    canvas: {
      id: 'canvas_1',
      elements: [
        {
          id: 'image_QuqVLadH',
          src: 'ast_9v0b8qv06208dmaq6pqd941wn4',
          type: 'image',
          width: 395,
          height: 222,
        },
        { id: 'video_1', type: 'video', mediaRef: 'gen_vid_sIG83ehk' },
      ],
    },
  },
};

describe('findSiblingImageSources', () => {
  it('finds the committed image on the video placeholder slide', () => {
    expect(findSiblingImageSources([slideWithVideoAndImage], 'gen_vid_sIG83ehk')).toEqual([
      { elementId: 'image_QuqVLadH', src: 'ast_9v0b8qv06208dmaq6pqd941wn4' },
    ]);
  });

  it('matches the video by src or element id as well as mediaRef', () => {
    const bySrc = {
      id: 'scene_2',
      content: {
        canvas: {
          elements: [
            { id: 'img_a', type: 'image', src: 'https://cdn.example/a.jpg' },
            { id: 'vid_b', type: 'video', src: 'gen_vid_b' },
          ],
        },
      },
    };
    expect(findSiblingImageSources([bySrc], 'gen_vid_b')).toEqual([
      { elementId: 'img_a', src: 'https://cdn.example/a.jpg' },
    ]);
  });

  it('skips uncommitted placeholders and non-image elements', () => {
    const slide = {
      id: 'scene_3',
      content: {
        canvas: {
          elements: [
            { id: 'img_pending', type: 'image', src: 'gen_img_pending' },
            { id: 'txt_1', type: 'text', src: 'whatever' },
            { id: 'img_ok', type: 'image', src: 'https://cdn.example/ok.png' },
            { id: 'vid_c', type: 'video', mediaRef: 'gen_vid_c' },
          ],
        },
      },
    };
    expect(findSiblingImageSources([slide], 'gen_vid_c')).toEqual([
      { elementId: 'img_ok', src: 'https://cdn.example/ok.png' },
    ]);
  });

  it('ignores other slides and returns empty when the video is absent', () => {
    expect(findSiblingImageSources([slideWithVideoAndImage], 'gen_vid_missing')).toEqual([]);
    expect(findSiblingImageSources(undefined, 'gen_vid_sIG83ehk')).toEqual([]);
    expect(findSiblingImageSources([{ id: 'no-canvas' }], 'gen_vid_sIG83ehk')).toEqual([]);
  });
});

describe('findOtherSlideImageSources', () => {
  const slideWithVideoOnly = {
    id: 'scene_video',
    content: {
      canvas: {
        elements: [{ id: 'video_1', type: 'video', mediaRef: 'gen_vid_x' }],
      },
    },
  };
  const slideWithImage = {
    id: 'scene_image',
    content: {
      canvas: {
        elements: [
          { id: 'img_class', type: 'image', src: 'ast_classimage1' },
          { id: 'img_pending', type: 'image', src: 'gen_img_pending' },
        ],
      },
    },
  };

  it('finds a committed classroom image when the video slide has none', () => {
    expect(findOtherSlideImageSources([slideWithVideoOnly, slideWithImage], 'gen_vid_x')).toEqual(
      [{ elementId: 'img_class', src: 'ast_classimage1' }],
    );
  });

  it('skips the video slide even when it holds its own committed image', () => {
    // Same-slide images stay the job of findSiblingImageSources; the fallback
    // must not offer them a second time.
    expect(
      findOtherSlideImageSources([slideWithVideoAndImage, slideWithImage], 'gen_vid_sIG83ehk'),
    ).toEqual([{ elementId: 'img_class', src: 'ast_classimage1' }]);
  });

  it('returns empty when the video is absent or no image is committed', () => {
    expect(findOtherSlideImageSources([slideWithImage], 'gen_vid_missing')).toEqual([]);
    expect(findOtherSlideImageSources([slideWithVideoOnly], 'gen_vid_x')).toEqual([]);
    expect(findOtherSlideImageSources(undefined, 'gen_vid_x')).toEqual([]);
  });
});

describe('materializeSiblingStill', () => {
  it('passes remote https: refs through untouched', async () => {
    await expect(materializeSiblingStill('https://cdn.example/a.jpg')).resolves.toBe(
      'https://cdn.example/a.jpg',
    );
  });

  it('returns undefined for empty refs', async () => {
    await expect(materializeSiblingStill('  ')).resolves.toBeUndefined();
  });
});
