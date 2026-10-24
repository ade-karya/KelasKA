'use client';

/** The owner's active generation runs, for course lists (see `OwnerRunsWatcher`). */
import { useEffect, useRef, useState } from 'react';

import { createLogger } from '@/lib/logger';

import { listActiveGenerationRuns, RunApiError } from './api';
import { OwnerRunsWatcher } from './owner-runs';
import { subscribeRunsChanged } from './runs-changed';
import type { RunSnapshot } from './types';

const log = createLogger('OwnerRuns');

export { mergeOwnerRun } from './owner-runs';

export interface OwnerRunsOptions {
  /** A run gained its course, or finished: the course list should be read again. */
  onCourseChanged?: (run: RunSnapshot) => void;
}

export function useOwnerRuns(options: OwnerRunsOptions = {}): {
  runs: RunSnapshot[];
  forget: (runId: string) => void;
} {
  const [runs, setRuns] = useState<RunSnapshot[]>([]);
  const watcherRef = useRef<OwnerRunsWatcher | null>(null);
  const onCourseChangedRef = useRef(options.onCourseChanged);
  useEffect(() => {
    onCourseChangedRef.current = options.onCourseChanged;
  });

  useEffect(() => {
    const watcher = new OwnerRunsWatcher({
      listActive: listActiveGenerationRuns,
      openStream:
        typeof EventSource === 'undefined'
          ? null
          : () => new EventSource('/api/generation-runs/events'),
      onChange: setRuns,
      onCourseChanged: (run) => onCourseChangedRef.current?.(run),
      onWarn: (message, error) => {
        // Pre-auth (ACCESS_CODE gate, no cookie yet): the 401 is an expected
        // state, not a failure. Debug-level only so the first-open console
        // stays clean; `auth-change`/remount polls again once authorized.
        if (error instanceof RunApiError && error.status === 401) {
          log.debug(`${message} (pre-auth, access code required).`);
          return;
        }
        log.warn(`${message}:`, error);
      },
    });
    watcherRef.current = watcher;
    void watcher.poll();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void watcher.poll('visible');
    };
    document.addEventListener('visibilitychange', onVisible);
    // Pre-auth polls were skipped silently; retry now that the request will
    // be authorized (the guard also remounts, which re-polls via the above).
    const onAuthChange = () => void watcher.poll();
    window.addEventListener('auth-change', onAuthChange);
    // A run started (or discarded) in another tab of this browser: read now.
    const unsubscribe = subscribeRunsChanged(() => void watcher.poll());
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('auth-change', onAuthChange);
      watcher.close();
      if (watcherRef.current === watcher) watcherRef.current = null;
    };
  }, []);

  const forget = (runId: string) => watcherRef.current?.forget(runId);
  return { runs, forget };
}
