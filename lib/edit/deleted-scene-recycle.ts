import { create } from 'zustand';
import type { Scene } from '@/lib/types/stage';
import { useStageStore } from '@/lib/store/stage';

/**
 * Single-slot recycle bin for the Pro mode slide-nav rail's toast-undo.
 *
 * When the user deletes a slide from the rail, the deleted scene + its
 * original array index are pushed here so a "Undo" affordance in the
 * delete toast can restore the scene at its prior position. The slot
 * holds at most one entry — a subsequent delete evicts the previous
 * pending undo (matching Figma's recycle semantics).
 *
 * Restoring the scene happens at the call site by re-inserting it into
 * `useStageStore.scenes` at the recorded index; this store only owns
 * the snapshot, not the restoration logic.
 */

interface RecycleEntry {
  readonly scene: Scene;
  readonly index: number;
  /** Cleared if the auto-dismiss timer has already fired. */
  readonly stageId: string;
}

// Alias for v0.3.2-dev compatibility
export type DeletedSceneEntry = RecycleEntry;

interface DeletedSceneRecycleState {
  pending: RecycleEntry | null;
  entry: RecycleEntry | null;
  capture: (scene: Scene, index: number, stageId?: string) => void;
  consume: () => RecycleEntry | null;
  clear: () => void;
}

export const useDeletedSceneRecycle = create<DeletedSceneRecycleState>()((set, get) => ({
  pending: null,
  entry: null,
  capture: (scene, index, stageId) => {
    const resolvedStageId =
      stageId ?? (scene as unknown as { stageId?: string }).stageId ?? useStageStore.getState().stage?.id ?? '';
    const rec: RecycleEntry = { scene, index, stageId: resolvedStageId };
    set({ pending: rec, entry: rec });
  },
  consume: () => {
    const entry = get().pending ?? get().entry;
    if (entry) set({ pending: null, entry: null });
    return entry ?? null;
  },
  clear: () => set({ pending: null, entry: null }),
}));
