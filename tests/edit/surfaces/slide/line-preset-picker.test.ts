import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import i18n from '@/lib/i18n/config';
import { I18nProvider } from '@/lib/hooks/use-i18n';
import { LinePresetPicker } from '@/components/edit/surfaces/slide/LinePresetPicker';

describe('LinePresetPicker', () => {
  it('renders the curved-line preset as a selectable control', async () => {
    await i18n.changeLanguage('id-ID');
    const html = renderToStaticMarkup(
      createElement(I18nProvider, null, createElement(LinePresetPicker, { onPick: vi.fn() })),
    );

    expect(html).toContain('aria-label="Kurva"');
    expect(html).toContain('aria-label="Kurva kubik"');
    expect(html).not.toContain('曲线');
    expect(html).not.toContain('三次曲线');
  });
});
