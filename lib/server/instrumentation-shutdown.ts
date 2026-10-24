/**
 * Node-only shutdown hook registration for instrumentation.
 *
 * Imported dynamically from `instrumentation.ts` (Node runtime branch only) so
 * the Edge bundle never statically includes `process.once`. Turbopack flags a
 * static `process.once` in `instrumentation.ts` as unsupported in the Edge
 * runtime even behind a `NEXT_RUNTIME !== 'nodejs'` early return, because the
 * check is runtime-only and the Edge compilation still sees the Node API.
 */

export function registerShutdownHooks(shutdown: () => Promise<void>): void {
  process.once('SIGTERM', () => void shutdown());
  process.once('SIGINT', () => void shutdown());
}
