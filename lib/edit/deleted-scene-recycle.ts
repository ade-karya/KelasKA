import { create } from 'zustand';
import type { Scene } from '@/lib/types/stage';
import { useStageStore } from '@/lib/store/stage';

export interface DeletedSceneEntry {
  scene: Scene;
  index: number;
  stageId: string;
}

export interface DeletedSceneRecycleState {
  entry: DeletedSceneEntry | null;
  capture: (scene: Scene, index: number, stageId?: string) => void;
  consume: () => DeletedSceneEntry | null;
  clear: () => void;
}

/**
 * Temporary undo store for deleted scenes.
 * Holds at most one deleted scene entry during undo-toast lifetime.
 */
export const useDeletedSceneRecycle = create<DeletedSceneRecycleState>()((set, get) => ({
  entry: null,
  capture: (scene, index, stageId) => {
    const currentStageId = stageId ?? useStageStore.getState().stage?.id ?? '';
    set({
      entry: {
        scene,
        index,
        stageId: currentStageId,
      },
    });
  },
  consume: () => {
    const { entry } = get();
    set({ entry: null });
    return entry;
  },
  clear: () => {
    set({ entry: null });
  },
}));
