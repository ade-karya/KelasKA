/**
 * maic-agent-driver khusus CLI (tier-3 gratis, tanpa API key).
 *
 * Transport: `opencode run --format json` sebagai child process lokal
 * (lib/ai/opencode-cli.ts, pola nexu-io/open-design), bukan HTTP.
 * Function tools sampai ke model via envelope ```tool_calls dan dieksekusi
 * pi loop — dari sisi harness berperilaku sama seperti LLM ber-key
 * (single-turn emit → harness execute → follow-up).
 *
 * Route:
 *   MODEL_ROUTES='{"maic-agent-driver":{"model":"opencode:muse-spark-1.3-contributor-free","api":"opencode-cli"}}'
 * Alias api sah: "opencode-cli" | "cli" | "opencode".
 * Provider sah: "opencode" | "opencode-go".
 *
 * Validasi kontraktual (prefix eksplisit, tanpa thinking.effort, api/provider
 * cocok) tetap milik lib/server/agent-runtime/agent-driver-model.ts — modul
 * ini hanya menegaskan varian CLI: memastikan route yang ter-resolve memang
 * CLI, lalu menyediakan opsi StreamFn yang benar untuk CLI (tanpa max_tokens
 * di wire — batas disalurkan sebagai instruksi prompt di lib/ai/opencode-cli.ts
 * agar paritas perilaku dengan cap wire jalur ber-key; thinking tetap disabled).
 */

import {
  isOpencodeCliApi,
  isOpencodeCliProvider,
  resolveAgentDriverModel,
  AGENT_DRIVER_STAGE,
} from './agent-driver-model';

export { isOpencodeCliApi, isOpencodeCliProvider, AGENT_DRIVER_STAGE };

/** True bila koneksi yang ter-resolve dieksekusi lokal via CLI. */
export function isOpencodeCliDriverConnection(providerId: string, driverApi?: string): boolean {
  return isOpencodeCliApi(driverApi) || isOpencodeCliProvider(providerId);
}

/**
 * Resolve driver dan pastikan varian CLI. Melempar bila route ter-resolve
 * bukan CLI (mis. operator bermaksud HTTP ber-key) agar kesalahan config
 * gagal keras saat start run, bukan sebagai tool-call yang macet.
 */
export async function resolveOpencodeCliDriverModel(): Promise<
  Awaited<ReturnType<typeof resolveAgentDriverModel>>
> {
  const driver = await resolveAgentDriverModel();
  if (!driver.isCliDriver) {
    throw new Error(
      `maic-agent-driver CLI khusus mengharapkan provider opencode/opencode-go dengan api ` +
        `"opencode-cli" (alias cli/opencode); ter-resolve ${driver.connection.modelString} via ` +
        `${JSON.stringify(driver.driverApi)}.`,
    );
  }
  return driver;
}

/** Opsi StreamFn yang benar untuk driver CLI (tanpa cap max_tokens di wire). */
export function opencodeCliStreamFnOptions(driver: {
  wireMaxOutputTokens?: number;
  connection: { thinkingConfig?: unknown };
}): {
  maxOutputTokens: undefined;
  omitMaxOutputTokens: true;
  source: 'agent-runtime:opencode-cli';
} {
  void driver.wireMaxOutputTokens;
  return {
    maxOutputTokens: undefined,
    omitMaxOutputTokens: true,
    source: 'agent-runtime:opencode-cli',
  };
}
