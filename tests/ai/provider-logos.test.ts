import { describe, expect, it } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { MONO_LOGO_PROVIDERS, PROVIDERS } from '@/lib/ai/providers';
import { logoLightDimClass, logoScaleClass } from '@/components/settings/model-picker';

/**
 * Regression test for provider logo assets:
 * - Atlas Cloud ships its official "A" mark and inverts it in dark mode
 *   (near-black monochrome, like openai/openrouter/ollama).
 * - DeepSeek keeps its blue whale with an explicit fill so the mark never
 *   inherits surrounding text color (no `currentColor` + inline `color`).
 * - A logo's fixed width/height must agree with its viewBox: DeepSeek once
 *   shipped width=182 for a 34-wide viewBox, so `object-contain` squeezed
 *   the whale into a tiny dot in the list and the header.
 * - Hugging Face uses the official yellow face mark instead of a
 *   font-dependent "HF" text placeholder.
 *
 * A logo drawn with `object-contain` at a fixed CSS size collapses into a
 * speck when its fixed width/height disagree with its viewBox (DeepSeek once
 * shipped width=182 for a 34-wide viewBox). No fixed size, no viewBox, or a
 * size matching the viewBox aspect are all safe.
 */
function intrinsicSizeMatchesViewBox(svg: string): boolean {
  const tag = svg.match(/<svg[^>]*>/)?.[0] ?? '';
  const size = (name: string) => {
    const match = tag.match(new RegExp(`${name}="([\\d.]+)(px)?"`));
    return match ? Number(match[1]) : null;
  };
  const viewBox = tag
    .match(/viewBox="([\d.\-+\s]+)"/)?.[1]
    .trim()
    .split(/\s+/)
    .map(Number);
  const width = size('width');
  const height = size('height');
  if (
    width === null ||
    height === null ||
    !viewBox ||
    viewBox.length !== 4 ||
    !viewBox[2] ||
    !viewBox[3]
  ) {
    return true;
  }
  const viewAspect = viewBox[2] / viewBox[3];
  return Math.abs(width / height - viewAspect) / viewAspect < 0.02;
}

describe('provider logos', () => {
  // Content-hashed on purpose: the URL changes with the bytes, so browser
  // disks, Cloudflare edge, and any other cache serve the new whale instead
  // of a stale (once width-broken) copy. Keep the `-<hash>` suffix whenever
  // this artwork is touched again.
  const DEEPSEEK_ICON = '/logos/deepseek-4187943a.svg';

  it.each([
    { id: 'atlascloud', icon: '/logos/atlascloud.svg' },
    { id: 'deepseek', icon: DEEPSEEK_ICON },
  ])('$id wires its logo asset', ({ id, icon }) => {
    expect(PROVIDERS[id as keyof typeof PROVIDERS].icon).toBe(icon);
  });

  it('the deepseek URL stays cache-busting', () => {
    expect(PROVIDERS.deepseek.icon).toMatch(/deepseek-[0-9a-f]{8}\.svg$/);
  });

  it('atlascloud.svg is a monochrome mark that inverts in dark mode', async () => {
    expect(MONO_LOGO_PROVIDERS.has('atlascloud')).toBe(true);
    const svg = await readFile('public/logos/atlascloud.svg', 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('deepseek.svg uses an explicit brand fill', async () => {
    const svg = await readFile(`public${DEEPSEEK_ICON}`, 'utf8');
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('fill="#3964fe"');
  });

  it('pale logos dim outside dark mode, others are untouched', () => {
    expect(logoLightDimClass('/logos/huggingface-c167703f.svg')).toContain('brightness-');
    expect(logoLightDimClass('/logos/huggingface-c167703f.svg')).toContain('dark:brightness-100');
    expect(logoLightDimClass('/logos/deepseek-4187943a.svg')).toBe('');
    expect(logoLightDimClass('/logos/qwen.svg')).toBe('');
    expect(logoLightDimClass(null)).toBe('');
    expect(logoLightDimClass(undefined)).toBe('');
  });

  it('deepseek keeps its legibility scale bump', () => {
    expect(logoScaleClass('/logos/deepseek-4187943a.svg')).not.toBe('');
    expect(logoScaleClass('/logos/qwen.svg')).toBe('');
  });

  it('deepseek.svg has no fixed size disagreeing with its viewBox', async () => {
    const svg = await readFile(`public${DEEPSEEK_ICON}`, 'utf8');
    expect(intrinsicSizeMatchesViewBox(svg)).toBe(true);
  });

  it('every local logo keeps a size its viewBox agrees with', async () => {
    const files = (await readdir('public/logos')).filter((file) => file.endsWith('.svg'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const svg = await readFile(`public/logos/${file}`, 'utf8');
      expect({ file, matches: intrinsicSizeMatchesViewBox(svg) }).toEqual({
        file,
        matches: true,
      });
    }
  });

  // Same cache-busting contract as DeepSeek: the old "HF" text placeholder
  // may still sit in edge caches, so the official face ships under a new URL.
  const HUGGINGFACE_ICON = '/logos/huggingface-c167703f.svg';

  it('the huggingface URL stays cache-busting', () => {
    expect(HUGGINGFACE_ICON).toMatch(/huggingface-[0-9a-f]{8}\.svg$/);
  });

  it('huggingface.svg is the official face mark, not a text placeholder', async () => {
    const svg = await readFile(`public${HUGGINGFACE_ICON}`, 'utf8');
    expect(svg).not.toContain('<text');
    expect(svg).toContain('#FFD21E');
  });

  it('image and video services wire the official face', async () => {
    const { IMAGE_PROVIDERS } = await import('@/lib/media/image-providers');
    const { VIDEO_PROVIDERS } = await import('@/lib/media/video-providers');
    const { REGISTRY_INFO } = await import('@/components/settings/service-display');
    expect(IMAGE_PROVIDERS['huggingface-image'].icon).toBe(HUGGINGFACE_ICON);
    expect(VIDEO_PROVIDERS['huggingface-video'].icon).toBe(HUGGINGFACE_ICON);
    expect(REGISTRY_INFO.image.icon('huggingface-image')).toBe(HUGGINGFACE_ICON);
    expect(REGISTRY_INFO.video.icon('huggingface-video')).toBe(HUGGINGFACE_ICON);
  });
});
