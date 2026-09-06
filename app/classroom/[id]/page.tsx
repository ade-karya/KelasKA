'use client';

import { Stage } from '@/components/stage';
import { ThemeProvider } from '@/lib/hooks/use-theme';
import { useStageStore } from '@/lib/store';
import { useSettingsStore } from '@/lib/store/settings';
import { claimStageSceneLoadToken, isCurrentStageSceneLoadToken } from '@/lib/store/stage';
import { loadImageMapping } from '@/lib/utils/image-storage';
import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useSceneGenerator } from '@/lib/hooks/use-scene-generator';
import { useMediaGenerationStore } from '@/lib/store/media-generation';
import { useWhiteboardHistoryStore } from '@/lib/store/whiteboard-history';
import { createLogger } from '@/lib/logger';
import { MediaStageProvider } from '@/lib/contexts/media-stage-context';
import { generateMediaForOutlines } from '@/lib/media/media-orchestrator';
import { useAgentRegistry } from '@/lib/orchestration/registry/store';
import { fetchStageMeta } from '@/lib/classroom/stage-meta-client';
import { noteStageOwnership } from '@/lib/classroom/stage-ownership-signal';
import { isStageDeleted } from '@/lib/utils/deleted-stages';
import {
  applyClassroomStageAndScenes,
  defaultClassroomLoadDeps,
  runClassroomLoad,
} from '@/lib/classroom/load-classroom';

const log = createLogger('Classroom');

export default function ClassroomDetailPage() {
  const params = useParams();
  const classroomId = params?.id as string;

  const { loadFromStorage } = useStageStore();

  // Warm fast-path: the store may already hold this classroom (SPA navigation,
  // remount, Back). Start painted instead of flashing "Loading classroom..."
  // while IndexedDB/media revalidate in the background.
  const [loading, setLoading] = useState(() => {
    const s = useStageStore.getState();
    return !(
      s.stage?.id === classroomId &&
      s.scenes.length > 0 &&
      !isStageDeleted(classroomId)
    );
  });
  const [error, setError] = useState<string | null>(null);

  const generationStartedRef = useRef(false);

  const { generateRemaining, retrySingleOutline, stop } = useSceneGenerator({
    onComplete: () => {
      log.info('[Classroom] All scenes generated');
    },
  });

  const loadClassroom = useCallback(
    async (isEffectCurrent: () => boolean = () => true) => {
      const loadToken = claimStageSceneLoadToken();
      const isCurrent = () => isEffectCurrent() && isCurrentStageSceneLoadToken(loadToken);

      await runClassroomLoad({
        classroomId,
        loadToken,
        isCurrent,
        loadFromStorage,
        getCurrentStage: () => useStageStore.getState().stage,
        fetchClassroom: defaultClassroomLoadDeps.fetchClassroom,
        applyFallbackScenes: (args) =>
          defaultClassroomLoadDeps.applyFallbackScenes({
            ...args,
            isCurrent,
            applyStageAndScenes: applyClassroomStageAndScenes,
          }),
        loadRestoredMediaTasks: defaultClassroomLoadDeps.loadRestoredMediaTasks,
        applyRestoredMediaTasks: (restored) =>
          defaultClassroomLoadDeps.applyRestoredMediaTasks(restored, isCurrent),
        discardRestoredMediaTasks: defaultClassroomLoadDeps.discardRestoredMediaTasks,
        loadLegacyAgentFallbacks: defaultClassroomLoadDeps.loadLegacyAgentFallbacks,
        commitMigratedAgentConfigs: defaultClassroomLoadDeps.commitMigratedAgentConfigs,
        applyGeneratedAgents: defaultClassroomLoadDeps.applyGeneratedAgents,
        getSettings: () => useSettingsStore.getState(),
        getAgent: (id) => useAgentRegistry.getState().getAgent(id),
        restoreAgentSelection: defaultClassroomLoadDeps.restoreAgentSelection,
        setError,
        setLoading,
        // Document-first paint: drop the spinner as soon as stage+scenes land,
        // media/roster continue in the background (see load-classroom.ts).
        onDocumentReady: () => {
          if (isCurrent()) setLoading(false);
        },
        log,
      });

      // The stage-meta sidecar resolves the viewer-facing ownership facts the
      // document seam does not carry — `isOwner` decides read-only vs editable
      // (see `stage-meta-client.ts`). Run it strictly AFTER the load applied
      // its defaults so its answer wins, and fire it without blocking the
      // render that already happened.
      if (isEffectCurrent()) {
        void fetchStageMeta(classroomId)
          .then((result) => {
            if (!isEffectCurrent()) return;
            if (result.outcome === 'found') {
              noteStageOwnership(classroomId, true, {
                isOwner: result.meta.isOwner,
              });
              useStageStore.getState().setViewerAccess({
                isOwner: result.meta.isOwner,
              });
            } else if (result.outcome === 'unavailable') {
              // A silent sidecar is not "this is a stranger's course": record
              // the outage so nothing treats `isOwner === false` as a visitor
              // conclusion. The edit gate stays on the upstream defaults.
              noteStageOwnership(classroomId, false, null);
            } else {
              // 'absent' — no sidecar row for this id. This classroom also
              // serves local-only courses, so the upstream editable default
              // stays; the server's owner-scoped writes remain the authority.
              noteStageOwnership(classroomId, true, null);
            }
          })
          .catch(() => noteStageOwnership(classroomId, false, null));
      }
    },
    [classroomId, loadFromStorage],
  );

  useEffect(() => {
    // Only unmount Stage + clear per-classroom caches on an actual switch.
    // A remount of the SAME classroom keeps its warm store/tasks visible while
    // the load revalidates in the background (stale-while-revalidate).
    const isWarm = (() => {
      const s = useStageStore.getState();
      return (
        s.stage?.id === classroomId && s.scenes.length > 0 && !isStageDeleted(classroomId)
      );
    })();
    /* eslint-disable react-hooks/set-state-in-effect -- Course switch must hide stale Stage before async load */
    if (!isWarm) setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    generationStartedRef.current = false;

    // Clear previous classroom's media tasks to prevent cross-classroom contamination.
    // Placeholder IDs (gen_img_1, gen_vid_1) are NOT globally unique across stages,
    // so stale tasks from a previous classroom would shadow the new one's.
    // Skipped for a warm remount of the same classroom to avoid flashing media away.
    if (!isWarm) {
      const mediaStore = useMediaGenerationStore.getState();
      mediaStore.revokeObjectUrls();
      useMediaGenerationStore.setState({ tasks: {} });

      // Clear whiteboard history to prevent snapshots from a previous course leaking in.
      useWhiteboardHistoryStore.getState().clearHistory();
    }

    let cancelled = false;
    loadClassroom(() => !cancelled);

    // Cancel ongoing generation when classroomId changes or component unmounts
    return () => {
      cancelled = true;
      stop();
    };
  }, [classroomId, loadClassroom, stop]);

  // Auto-resume generation for pending outlines
  useEffect(() => {
    if (loading || error || generationStartedRef.current) return;

    const state = useStageStore.getState();
    const { outlines, scenes, stage, generationComplete } = state;

    // Check if there are pending outlines. A finished deck is frozen for
    // editing: deleting a slide leaves its outline orphaned, but that must not
    // be treated as an interrupted generation and regenerated. Only resume
    // when generation has not completed.
    const completedOrders = new Set(scenes.map((s) => s.order));
    const hasPending = !generationComplete && outlines.some((o) => !completedOrders.has(o.order));

    if (hasPending && stage) {
      generationStartedRef.current = true;

      // Load generation params from sessionStorage (stored by generation-preview before navigating)
      const genParamsStr = sessionStorage.getItem('generationParams');
      const params = genParamsStr ? JSON.parse(genParamsStr) : {};

      // Reconstruct imageMapping for the resumed generation. A server-backed
      // deployment stored allocated asset ids on the session's pdfImages (RFC
      // #1153 part 2 B): the extracted images are pool assets, so generation
      // is fed by id and the routes resolve the bytes server-side. Per source
      // (N4) the mapping may MIX allocated asset ids and IndexedDB data URLs —
      // a source whose cache write failed materialized its own images — so the
      // resume mapping merges both, instead of choosing one transport for the
      // whole set and silently dropping the other half.
      const pdfImages = (params.pdfImages || []) as Array<
        { id: string; assetId?: string; storageId?: string } & Record<string, unknown>
      >;
      const finishResume = (imageMapping: Record<string, string>) =>
        generateRemaining({
          pdfImages: params.pdfImages,
          imageMapping,
          stageInfo: {
            name: stage.name || '',
            description: stage.description,
            style: stage.style,
          },
          agents: params.agents,
          userProfile: params.userProfile,
          languageDirective: params.languageDirective || stage.languageDirective,
        });

      const imageMapping: Record<string, string> = {};
      for (const img of pdfImages) {
        if (img.assetId) imageMapping[img.id] = img.assetId;
      }
      const storageIds = pdfImages
        .filter((img) => !img.assetId && img.storageId)
        .map((img) => img.storageId as string);
      void (async () => {
        if (storageIds.length > 0) {
          Object.assign(imageMapping, await loadImageMapping(storageIds));
        }
        finishResume(imageMapping);
      })();
    } else if (outlines.length > 0 && stage) {
      // All scenes are generated, but some media may not have finished.
      // Resume media generation for any tasks not yet in IndexedDB.
      // generateMediaForOutlines skips already-completed tasks automatically.
      generationStartedRef.current = true;
      // The deck reached the classroom already fully materialized (e.g. a
      // single-slide course, or a deck whose last slide finished in
      // generation-preview), so generateRemaining's completion path never
      // ran. Record completion now so a later edit/delete is not treated as
      // an interrupted generation. No-op if already complete or not all
      // outlines have scenes.
      useStageStore.getState().markGenerationCompleteIfDone();
      // Resume media only for outlines that still have a scene. On a finished
      // deck the user may have deleted a slide, leaving an orphaned outline;
      // generating its media would waste API calls on a slide that is gone.
      const materializedOrders = new Set(scenes.map((s) => s.order));
      const materializedOutlines = outlines.filter((o) => materializedOrders.has(o.order));
      generateMediaForOutlines(materializedOutlines, stage.id).catch((err) => {
        log.warn('[Classroom] Media generation resume error:', err);
      });
    }
  }, [loading, error, generateRemaining]);

  return (
    <ThemeProvider>
      <MediaStageProvider value={classroomId}>
        <div className="h-screen flex flex-col overflow-hidden">
          {loading ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center text-muted-foreground">
                <p>Loading classroom...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900">
              <div className="text-center">
                <p className="text-destructive mb-4">Error: {error}</p>
                <button
                  onClick={() => {
                    setError(null);
                    setLoading(true);
                    loadClassroom();
                  }}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
                >
                  Retry
                </button>
              </div>
            </div>
          ) : (
            <Stage onRetryOutline={retrySingleOutline} />
          )}
        </div>
      </MediaStageProvider>
    </ThemeProvider>
  );
}
