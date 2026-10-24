/**
 * Combine abort signals (outer run abort, pi's per-call signal, transport
 * timeout) into one signal, with a cleanup that removes every listener.
 */
export function combineAbortSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  const sources = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (sources.length === 0) return { signal: undefined, cleanup: () => {} };

  const controller = new AbortController();
  const listeners: Array<{ signal: AbortSignal; listener: () => void }> = [];
  for (const signal of sources) {
    const listener = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    listeners.push({ signal, listener });
    signal.addEventListener('abort', listener, { once: true });
    if (signal.aborted) listener();
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, listener } of listeners) {
        signal.removeEventListener('abort', listener);
      }
    },
  };
}
