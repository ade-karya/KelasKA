/**
 * The pending driver-model choice shared between the home-composer picker and
 * conversation creation.
 *
 * The home picker writes the selection it shows (model + thinking) here; the
 * launch composer reads it when it asks the server to create the conversation,
 * so a brand-new conversation starts on the model the user just picked instead
 * of on whatever a previous conversation remembered. Per-conversation picks
 * made later ride `POST /api/agent/models { sessionId }` and are stored on the
 * session row itself.
 */
import type { ThinkingConfig } from '@/lib/types/provider';

export const DRIVER_MODEL_STORAGE_KEY = 'openmaic-workbench-model';
export const DRIVER_MODEL_THINKING_STORAGE_KEY = 'openmaic-workbench-model-thinking';

export interface PendingDriverModel {
  model: string;
  thinking?: ThinkingConfig;
}

/** Client-only: the pending default, or null when nothing valid is stored. */
export function readPendingDriverModel(): PendingDriverModel | null {
  if (typeof window === 'undefined') return null;
  try {
    const model = window.localStorage.getItem(DRIVER_MODEL_STORAGE_KEY);
    if (!model) return null;
    const parsedThinking = window.localStorage.getItem(DRIVER_MODEL_THINKING_STORAGE_KEY);
    const thinking = parsedThinking
      ? (JSON.parse(parsedThinking) as ThinkingConfig)
      : undefined;
    return thinking && typeof thinking === 'object' ? { model, thinking } : { model };
  } catch {
    return null;
  }
}

/** Client-only: persist (or clear) the pending default. */
export function writePendingDriverModel(
  model: string | null,
  thinking?: ThinkingConfig | null,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (model) window.localStorage.setItem(DRIVER_MODEL_STORAGE_KEY, model);
    else window.localStorage.removeItem(DRIVER_MODEL_STORAGE_KEY);
    if (thinking && typeof thinking === 'object') {
      window.localStorage.setItem(DRIVER_MODEL_THINKING_STORAGE_KEY, JSON.stringify(thinking));
    } else if (thinking === null || !model) {
      window.localStorage.removeItem(DRIVER_MODEL_THINKING_STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}
