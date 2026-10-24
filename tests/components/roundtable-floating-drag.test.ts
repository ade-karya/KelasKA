// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-audio-recorder', () => ({
  useAudioRecorder: () => ({
    isRecording: false,
    isProcessing: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    cancelRecording: vi.fn(),
  }),
}));
vi.mock('@/lib/hooks/use-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/canvas/canvas-toolbar', () => ({ CanvasToolbar: () => null }));
vi.mock('@/components/ui/avatar-display', () => ({ AvatarDisplay: () => null }));
vi.mock('@/components/chat/proactive-card', () => ({ ProactiveCard: () => null }));
vi.mock('@/components/roundtable/presentation-speech-overlay', () => ({
  PresentationSpeechOverlay: () => null,
}));
vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: Object.assign((() => undefined) as unknown as Record<string, unknown>, {
    getState: () => ({}),
  }),
  PLAYBACK_SPEEDS: [1],
}));
vi.mock('@/lib/model-settings/use-model-settings', () => ({
  useModelCapabilities: () => ({}),
}));
vi.mock('@/lib/hooks/use-asr-available', () => ({ useASRAvailable: () => false }));
vi.mock('@/lib/orchestration/registry/store', () => ({
  useAgentRegistry: Object.assign({ getState: () => ({ getAgent: () => undefined }) }),
}));
vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

import { Roundtable } from '@/components/roundtable';

const PILL_RECT = {
  left: 100,
  top: 500,
  width: 300,
  height: 40,
  right: 400,
  bottom: 540,
  x: 100,
  y: 500,
  toJSON: () => ({}),
} as DOMRect;

function down(target: HTMLElement, x: number, y: number) {
  target.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, button: 0 }),
  );
}

function move(target: HTMLElement, x: number, y: number) {
  target.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
}

function up(target: HTMLElement) {
  target.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
}

describe('presentation pills are draggable without visual changes', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    window.localStorage.clear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderPresenting() {
    await act(async () =>
      root.render(createElement(Roundtable, { isPresenting: true, controlsVisible: true })),
    );
    const toolbar = container.querySelector(
      '[data-testid="presentation-toolbar-pill"]',
    ) as HTMLElement;
    const dock = container.querySelector('[data-testid="presentation-dock-pill"]') as HTMLElement;
    expect(toolbar).toBeTruthy();
    expect(dock).toBeTruthy();
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue(PILL_RECT);
    vi.spyOn(dock, 'getBoundingClientRect').mockReturnValue(PILL_RECT);
    return { toolbar, dock };
  }

  it('keeps the upstream pill styling untouched (only cursor + testid added)', async () => {
    const { toolbar, dock } = await renderPresenting();
    expect(toolbar.className).toContain('mb-3 px-2 py-1 rounded-full');
    expect(dock.className).toContain('flex items-center gap-2.5 rounded-full');
    // No grip chrome inside either pill.
    expect(toolbar.querySelector('svg')).toBeNull();
  });

  it('drags the toolbar pill background and persists the offset', async () => {
    const { toolbar } = await renderPresenting();
    await act(async () => down(toolbar, 120, 510));
    await act(async () => move(toolbar, 170, 470));
    await act(async () => up(toolbar));
    expect(toolbar.style.transform).toBe('translate3d(50px, -40px, 0)');
    expect(window.localStorage.getItem('roundtable:presentation-toolbar-offset')).toBe(
      JSON.stringify({ x: 50, y: -40 }),
    );
    // Double-clicking the background docks it back.
    await act(async () => {
      toolbar.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    expect(toolbar.style.transform).toBe('');
    expect(window.localStorage.getItem('roundtable:presentation-toolbar-offset')).toBeNull();
  });

  it('drags the dock pill background too', async () => {
    const { dock } = await renderPresenting();
    await act(async () => down(dock, 120, 510));
    await act(async () => move(dock, 100, 540));
    await act(async () => up(dock));
    expect(dock.style.transform).toBe('translate3d(-20px, 30px, 0)');
    expect(window.localStorage.getItem('roundtable:presentation-dock-offset')).toBe(
      JSON.stringify({ x: -20, y: 30 }),
    );
  });

  it('ignores plain clicks (below the drag threshold)', async () => {
    const { toolbar } = await renderPresenting();
    await act(async () => down(toolbar, 120, 510));
    await act(async () => move(toolbar, 122, 511));
    await act(async () => up(toolbar));
    expect(toolbar.style.transform).toBe('');
    expect(window.localStorage.getItem('roundtable:presentation-toolbar-offset')).toBeNull();
  });

  it('never starts a drag from a button inside the pill', async () => {
    const { dock } = await renderPresenting();
    const micButton = dock.querySelector('button') as HTMLElement;
    expect(micButton).toBeTruthy();
    await act(async () => down(micButton, 120, 510));
    await act(async () => move(micButton, 220, 410));
    await act(async () => up(micButton));
    expect(dock.style.transform).toBe('');
  });

  it('swallows the click that ends a drag', async () => {
    const { toolbar } = await renderPresenting();
    await act(async () => down(toolbar, 120, 510));
    await act(async () => move(toolbar, 170, 470));
    await act(async () => up(toolbar));
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    await act(async () => {
      toolbar.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
  });
});
