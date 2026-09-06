import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetLegacyAgentFallbackProbes,
  runClassroomLoad,
} from '@/lib/classroom/load-classroom';
import { useStageStore } from '@/lib/store/stage';
import type { Stage } from '@/lib/types/stage';

vi.mock('@/lib/utils/stage-storage', () => ({
  saveStageData: vi.fn().mockResolvedValue(undefined),
  saveStageDataIncremental: vi.fn().mockResolvedValue({ failedChanges: [] }),
  loadStageData: vi.fn().mockResolvedValue(null),
}));

function makeStage(id: string): Stage {
  return { id, name: id, createdAt: 1, updatedAt: 1 };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const settings = {
    agentMode: 'auto' as const,
    selectedAgentIds: [] as string[],
    agentSelectionIsUserSet: false,
    setAgentMode: vi.fn(),
    setSelectedAgentIds: vi.fn(),
    setAgentSelectionIsUserSet: vi.fn(),
  };
  return {
    classroomId: 'stage-a',
    loadToken: 1,
    isCurrent: () => true,
    loadFromStorage: vi.fn().mockResolvedValue(undefined),
    getCurrentStage: () => makeStage('stage-a'),
    fetchClassroom: vi.fn().mockResolvedValue(null),
    applyFallbackScenes: vi.fn().mockResolvedValue(false),
    loadRestoredMediaTasks: vi.fn().mockResolvedValue({}),
    applyRestoredMediaTasks: vi.fn(),
    discardRestoredMediaTasks: vi.fn(),
    loadLegacyAgentFallbacks: vi.fn().mockResolvedValue([]),
    commitMigratedAgentConfigs: vi.fn(),
    applyGeneratedAgents: vi.fn().mockReturnValue([]),
    getSettings: () => settings,
    getAgent: vi.fn().mockReturnValue(undefined),
    restoreAgentSelection: vi.fn().mockReturnValue({
      selection: { mode: 'preset', selectedAgentIds: [] },
      isUserSet: false,
    }),
    setError: vi.fn(),
    setLoading: vi.fn(),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides,
  } as unknown as Parameters<typeof runClassroomLoad>[0];
}

beforeEach(() => {
  resetLegacyAgentFallbackProbes();
  useStageStore.getState().clearStore();
});

describe('document-first paint', () => {
  it('fires onDocumentReady before slow media restore finishes', async () => {
    const order: string[] = [];
    let releaseMedia!: (v: object) => void;
    const mediaGate = new Promise<object>((res) => {
      releaseMedia = res;
    });
    const deps = makeDeps({
      loadRestoredMediaTasks: vi.fn().mockImplementation(async () => {
        order.push('media-start');
        const tasks = await mediaGate;
        order.push('media-done');
        return tasks;
      }),
      onDocumentReady: vi.fn().mockImplementation(() => {
        order.push('document-ready');
      }),
    });

    const loading = runClassroomLoad(deps);
    // Let loadFromStorage + document gate flush, media stays gated.
    await vi.waitFor(() => expect(order).toContain('document-ready'));

    // Document paint happened while media was still pending.
    // markDocumentReady runs right after the document lands, before the
    // media read starts — so order is deterministic here.
    expect(order).toEqual(['document-ready', 'media-start']);
    expect(deps.setLoading).not.toHaveBeenCalled();

    releaseMedia({});
    await loading;
    expect(deps.setLoading).toHaveBeenCalledWith(false);
    expect(order).toEqual(['document-ready', 'media-start', 'media-done']);
  });

  it('does not replace painted document with full-page error on background failure', async () => {
    const deps = makeDeps({
      loadRestoredMediaTasks: vi.fn().mockRejectedValue(new Error('media boom')),
      onDocumentReady: vi.fn(),
    });

    await runClassroomLoad(deps);

    expect(deps.onDocumentReady).toHaveBeenCalledOnce();
    // Terminal loading still clears; error must NOT wipe the painted doc.
    expect(deps.setLoading).toHaveBeenCalledWith(false);
    expect(deps.setError).not.toHaveBeenCalled();
  });

  it('still surfaces error when document never landed', async () => {
    const deps = makeDeps({
      getCurrentStage: () => null,
      loadRestoredMediaTasks: vi.fn().mockRejectedValue(new Error('media boom')),
      onDocumentReady: vi.fn(),
    });

    await runClassroomLoad(deps);

    expect(deps.onDocumentReady).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalled();
  });
});
