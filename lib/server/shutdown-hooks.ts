/**
 * Node-only process shutdown hooks (SIGTERM/SIGINT).
 *
 * Split out of `instrumentation.ts` so that module keeps no static reference
 * to Node-only `process` APIs: it is dynamically imported from the Node.js
 * branch of `register()` only, which keeps the Edge bundle from ever pulling
 * in `process.once` (Turbopack flags it as unsupported in the Edge Runtime).
 */
export function installShutdownHooks(onShutdown: () => void): void {
  process.once('SIGTERM', onShutdown);
  process.once('SIGINT', onShutdown);
}
