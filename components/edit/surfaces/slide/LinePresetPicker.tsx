'use client';

import { useI18n } from '@/lib/hooks/use-i18n';
import { LINE_LIST, type LinePoolItem } from '@/configs/lines';

interface LinePresetPickerProps {
  readonly onPick: (preset: LinePoolItem) => void;
}

function getPresetLabel(t: (key: string) => string, preset: LinePoolItem) {
  if (preset.isCubic) return t('edit.insert.linePresets.cubic');
  if (preset.isCurve) return t('edit.insert.linePresets.curve');
  if (preset.isBroken2) return t('edit.insert.linePresets.doubleBroken');
  if (preset.isBroken) return t('edit.insert.linePresets.broken');
  if (preset.points[1] === 'arrow') return t('edit.insert.linePresets.arrow');
  if (preset.points[1] === 'dot') return t('edit.insert.linePresets.dottedEnd');
  return preset.style === 'dashed'
    ? t('edit.insert.linePresets.dashed')
    : t('edit.insert.linePresets.straight');
}

/** Renderer-editor insert palette for the existing DSL line presets. */
export function LinePresetPicker({ onPick }: LinePresetPickerProps) {
  const { t } = useI18n();
  return (
    <div className="grid grid-cols-5 gap-2" role="group" aria-label={t('edit.insert.line')}>
      {LINE_LIST.flatMap((group) => group.children).map((preset, index) => {
        const label = getPresetLabel(t, preset);
        return (
          <button
            key={`${preset.path}-${index}`}
            type="button"
            aria-label={label}
            className="flex aspect-square items-center justify-center rounded-md border border-transparent p-2 text-zinc-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700 dark:text-zinc-300 dark:hover:border-violet-500/50 dark:hover:bg-violet-500/10"
            onClick={() => onPick(preset)}
          >
            <svg viewBox="0 0 20 20" className="h-7 w-7" aria-hidden="true">
              <path
                d={preset.path}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray={preset.style === 'dashed' ? '5 2.5' : undefined}
              />
            </svg>
          </button>
        );
      })}
    </div>
  );
}
