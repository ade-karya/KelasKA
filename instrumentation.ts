/**
 * Process-scoped startup work (thin Edge-safe entrypoint).
 *
 * Next calls `register` in BOTH Node and Edge runtimes, so this file must not
 * statically reference any Node-only module: Turbopack builds the Edge
 * variant too and flags every transitive `node:*`/`fs`/`path` import. All
 * Node-only startup lives in `./instrumentation.node` and is imported only
 * when `NEXT_RUNTIME === 'nodejs'` (pattern from Next docs:
 * guides/instrumentation "Importing runtime-specific code" + open-telemetry
 * "Manual OpenTelemetry configuration").
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation.node').then((m) => m.registerNode());
  }
}
