'use client';

import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/hooks/use-i18n';
import {
  Flashlight,
  MousePointer2,
  Type,
  Shapes,
  Eraser,
  PanelLeftOpen,
  PanelLeftClose,
  MessageSquare,
  Zap,
  Loader2,
  BarChart3,
  Sigma,
  Table2,
  PenLine,
  Trash2,
  Play,
  Minus,
  Code2,
  FileCode,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface InlineActionTagProps {
  actionName: string;
  state: string;
}

// ── Style tokens ──────────────────────────────────────────────

const WB_STYLE =
  'bg-violet-50 dark:bg-violet-500/15 border-violet-300/40 dark:border-violet-500/30 text-violet-600 dark:text-violet-300';
const WB_ACCENT = 'bg-violet-500 dark:bg-violet-400';

const SPOTLIGHT_STYLE =
  'bg-yellow-50 dark:bg-yellow-500/15 border-yellow-300/40 dark:border-yellow-500/30 text-yellow-700 dark:text-yellow-300';
const LASER_STYLE =
  'bg-red-50 dark:bg-red-500/15 border-red-300/40 dark:border-red-500/30 text-red-600 dark:text-red-300';
const DISCUSS_STYLE =
  'bg-amber-50 dark:bg-amber-500/15 border-amber-300/40 dark:border-amber-500/30 text-amber-700 dark:text-amber-300';
const DEFAULT_STYLE =
  'bg-gray-50 dark:bg-gray-500/15 border-gray-300/40 dark:border-gray-500/30 text-gray-600 dark:text-gray-300';

// ── Action config ─────────────────────────────────────────────

interface ActionCfg {
  i18nKey: string;
  Icon: LucideIcon;
  style: string;
  /** Whiteboard family — gets the pen-line accent indicator */
  wb?: boolean;
}

const ACTION_CONFIG: Record<string, ActionCfg> = {
  // Slide effects
  spotlight: { i18nKey: 'actions.names.spotlight', Icon: Flashlight, style: SPOTLIGHT_STYLE },
  laser: { i18nKey: 'actions.names.laser', Icon: MousePointer2, style: LASER_STYLE },
  play_video: { i18nKey: 'actions.names.play_video', Icon: Play, style: SPOTLIGHT_STYLE },

  // Whiteboard lifecycle
  wb_open: { i18nKey: 'actions.names.wb_open', Icon: PanelLeftOpen, style: WB_STYLE, wb: true },
  wb_close: { i18nKey: 'actions.names.wb_close', Icon: PanelLeftClose, style: WB_STYLE, wb: true },
  wb_clear: { i18nKey: 'actions.names.wb_clear', Icon: Eraser, style: WB_STYLE, wb: true },
  wb_delete: { i18nKey: 'actions.names.wb_delete', Icon: Trash2, style: WB_STYLE, wb: true },

  // Whiteboard drawing
  wb_draw_text: { i18nKey: 'actions.names.wb_draw_text', Icon: Type, style: WB_STYLE, wb: true },
  wb_draw_shape: { i18nKey: 'actions.names.wb_draw_shape', Icon: Shapes, style: WB_STYLE, wb: true },
  wb_draw_chart: { i18nKey: 'actions.names.wb_draw_chart', Icon: BarChart3, style: WB_STYLE, wb: true },
  wb_draw_latex: { i18nKey: 'actions.names.wb_draw_latex', Icon: Sigma, style: WB_STYLE, wb: true },
  wb_draw_table: { i18nKey: 'actions.names.wb_draw_table', Icon: Table2, style: WB_STYLE, wb: true },
  wb_draw_line: { i18nKey: 'actions.names.wb_draw_line', Icon: Minus, style: WB_STYLE, wb: true },
  wb_draw_code: { i18nKey: 'actions.names.wb_draw_code', Icon: Code2, style: WB_STYLE, wb: true },
  wb_edit_code: { i18nKey: 'actions.names.wb_edit_code', Icon: FileCode, style: WB_STYLE, wb: true },

  // Social
  discussion: { i18nKey: 'actions.names.discussion', Icon: MessageSquare, style: DISCUSS_STYLE },
};

// ── Component ─────────────────────────────────────────────────

export function InlineActionTag({ actionName, state }: InlineActionTagProps) {
  const { t } = useI18n();
  const config = ACTION_CONFIG[actionName];
  const Icon = config?.Icon || Zap;
  const label = config ? t(config.i18nKey) : actionName;
  const style = config?.style || DEFAULT_STYLE;
  const isWb = config?.wb ?? false;
  const isRunning = state === 'running' || state === 'input-available';

  return (
    <span
      className={cn(
        'inline-flex items-center mx-1 rounded-full border align-middle leading-none whitespace-nowrap',
        'text-[9px] font-bold tracking-wide',
        // Slightly tighter padding when wb accent is present (accent provides left visual weight)
        isWb ? 'pl-0.5 pr-1.5 py-px' : 'px-1.5 py-px',
        style,
        isRunning && 'animate-pulse',
      )}
    >
      {/* Whiteboard accent: tiny PenLine chip on the left */}
      {isWb && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-full mr-0.5 shrink-0',
            'w-3 h-3',
            WB_ACCENT,
          )}
        >
          <PenLine className="w-[7px] h-[7px] text-white dark:text-violet-950" strokeWidth={2.5} />
        </span>
      )}

      {/* Action icon */}
      {isRunning ? (
        <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />
      ) : (
        <Icon className="w-2.5 h-2.5 shrink-0" />
      )}

      <span className="ml-0.5">{label}</span>
    </span>
  );
}
