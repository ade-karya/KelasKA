import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { MONO_LOGO_PROVIDERS, PROVIDERS } from '@/lib/ai/providers';

/**
 * Regression test for provider logo assets:
 * - Atlas Cloud ships its official "A" mark and inverts it in dark mode
 *   (near-black monochrome, like openai/openrouter/ollama).
 * - DeepSeek keeps its blue whale with an explicit fill so the mark never
 *   inherits surrounding text color (no `currentColor` + inline `color`).
 * - Hugging Face uses the official yellow face mark instead of a
 *   font-dependent "HF" text placeholder.
 */
describe('provider logos', () => {
  it.each([
    { id: 'atlascloud', icon: '/logos/atlascloud.svg' },
    { id: 'deepseek', icon: '/logos/deepseek.svg' },
  ])('$id wires its logo asset', ({ id, icon }) => {
    expect(PROVIDERS[id as keyof typeof PROVIDERS].icon).toBe(icon);
  });

  it('atlascloud.svg is a monochrome mark that inverts in dark mode', async () => {
    expect(MONO_LOGO_PROVIDERS.has('atlascloud')).toBe(true);
    const svg = await readFile('public/logos/atlascloud.svg', 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).toContain('<path');
  });

  it('deepseek.svg uses an explicit brand fill', async () => {
    const svg = await readFile('public/logos/deepseek.svg', 'utf8');
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('fill="#3964fe"');
  });

  it('huggingface.svg is the official face mark, not a text placeholder', async () => {
    const svg = await readFile('public/logos/huggingface.svg', 'utf8');
    expect(svg).not.toContain('<text');
    expect(svg).toContain('#FFD21E');
  });
});
