/**
 * Minimal ambient declarations for the Cloudflare Workers runtime so these
 * files typecheck in an editor without pulling @cloudflare/workers-types into
 * the app's dependency graph. `wrangler deploy` uses esbuild and does not
 * require them; they are only for local tooling.
 */
interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}
