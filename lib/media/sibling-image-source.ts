/**
 * Sibling-still reuse for image-to-video generation.
 *
 * An image-to-video provider (Hugging Face Video Gen) animates a source still
 * instead of dreaming motion from the prompt alone. When the course already
 * holds a committed image, animating that image beats billing a fresh still —
 * on a free ZeroGPU tier a second generation can be the run that exhausts the
 * daily quota. The media lane looks on the video's own slide first and on
 * every other slide after it (the classroom's already-generated images are
 * paid for either way).
 *
 * Pure over plain scene data (unit-testable); scene and element shapes are
 * read defensively because editor and playback variants differ.
 */
import { isGeneratedMediaPlaceholder } from '@/lib/media/media-ref';

/** A committed slide image usable as an animation source. */
export interface SiblingImageSource {
  elementId: string;
  src: string;
}

/** Canvas elements of one scene, read defensively (editor/playback shapes differ). */
function sceneCanvasElements(scene: unknown): unknown[] {
  const elements = (scene as { content?: { canvas?: { elements?: unknown[] } } })?.content?.canvas
    ?.elements;
  return Array.isArray(elements) ? elements : [];
}

/** Whether a canvas element is the video placeholder looking for a source. */
function isVideoPlaceholderElement(el: unknown, videoElementId: string): boolean {
  const e = el as { id?: unknown; src?: unknown; mediaRef?: unknown };
  return e?.mediaRef === videoElementId || e?.src === videoElementId || e?.id === videoElementId;
}

/** Committed images among canvas elements — placeholders and the video itself excluded. */
function committedImageSources(elements: unknown[], videoElementId: string): SiblingImageSource[] {
  const sources: SiblingImageSource[] = [];
  for (const el of elements) {
    const e = el as { id?: unknown; type?: unknown; src?: unknown };
    if (e?.type !== 'image' || typeof e.src !== 'string' || !e.src) continue;
    if (e.id === videoElementId) continue;
    if (isGeneratedMediaPlaceholder(e.src)) continue;
    sources.push({ elementId: typeof e.id === 'string' ? e.id : '', src: e.src });
  }
  return sources;
}

/**
 * Find committed image elements on the same slide as a video placeholder.
 * Placeholders and the video element itself are never candidates.
 */
export function findSiblingImageSources(
  scenes: unknown,
  videoElementId: string,
): SiblingImageSource[] {
  if (!Array.isArray(scenes)) return [];
  for (const scene of scenes) {
    const elements = sceneCanvasElements(scene);
    if (!elements.some((el) => isVideoPlaceholderElement(el, videoElementId))) continue;
    return committedImageSources(elements, videoElementId);
  }
  return [];
}

/**
 * Find committed image elements on every slide EXCEPT the video's own.
 *
 * Fallback when the video's slide holds no usable image: the classroom's
 * already-generated images are paid for, so animating one of them beats
 * billing a fresh still — which on a free ZeroGPU tier can be the run that
 * exhausts the daily quota. Scene order decides; the first committed image
 * wins. Same purity and defensiveness contract as
 * {@link findSiblingImageSources}.
 */
export function findOtherSlideImageSources(
  scenes: unknown,
  videoElementId: string,
): SiblingImageSource[] {
  if (!Array.isArray(scenes)) return [];
  let ownsVideo = false;
  const sources: SiblingImageSource[] = [];
  for (const scene of scenes) {
    const elements = sceneCanvasElements(scene);
    if (elements.some((el) => isVideoPlaceholderElement(el, videoElementId))) {
      ownsVideo = true;
      continue;
    }
    sources.push(...committedImageSources(elements, videoElementId));
  }
  // No video placeholder anywhere (stale scenes): offer nothing, mirroring
  // findSiblingImageSources — animating a classroom image for a video the
  // document no longer names would bill a run nobody asked for.
  return ownsVideo ? sources : [];
}
