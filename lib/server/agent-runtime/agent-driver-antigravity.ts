/**
 * maic-agent-driver khusus Google Antigravity CLI (transport lokal, tanpa
 * endpoint HTTP).
 *
 * Transport: satu turn `agy` (flags CLI, diurai sebagai stream). Turn diproses
 * `agy` dengan alat bawaannya dimatikan; function tools tetap milik OpenMAIC.
 * Lihat lib/ai/antigravity-cli.ts dan lib/agent/runtime/antigravity-stream-fn.ts.
 *
 * Loop tetap milik OpenMAIC (pi): function tools sampai ke model sebagai
 * katalog + kontrak JSON, lalu dieksekusi harness dengan allowlist, timeout,
 * quota, dan transcript yang sama seperti transport HTTP/CLI/Codex.
 *
 * Route:
 *   slots:
 *     agent: antigravity:gemini-3.8-flash
 *   api: antigravity-sdk
 * atau lewat tombol pemilih Pro Workbench (POST /api/agent/models, tersimpan
 * di data/agent-driver-model.json sebagai
 * `{"model":"antigravity:…","api":"antigravity-sdk"}` — nama wire lama).
 * Alias api sah: "antigravity-sdk" | "antigravity". Provider sah:
 * "antigravity".
 *
 * Validasi kontraktual (prefix eksplisit, api/provider cocok) milik
 * lib/server/agent-runtime/agent-driver-model.ts — modul ini hanya menegaskan
 * varian Antigravity: memastikan route yang ter-resolve memang Antigravity,
 * lalu menyediakan opsi StreamFn yang benar (tanpa cap max_tokens di wire) dan
 * probe ketersediaan CLI/kredensial sebelum run dimulai.
 */

import { antigravityCliAuthStatus } from '@/lib/ai/antigravity-cli-auth';
import {
  AGENT_DRIVER_STAGE,
  isAntigravitySdkApi,
  isAntigravitySdkProvider,
  resolveAgentDriverModel,
} from './agent-driver-model';

export { AGENT_DRIVER_STAGE, isAntigravitySdkApi, isAntigravitySdkProvider };

/** True bila koneksi yang ter-resolve dieksekusi lokal lewat Antigravity CLI. */
export function isAntigravitySdkDriverConnection(providerId: string, driverApi?: string): boolean {
  return isAntigravitySdkApi(driverApi) || isAntigravitySdkProvider(providerId);
}

export async function resolveAntigravitySdkDriverModel(): Promise<
  Awaited<ReturnType<typeof resolveAgentDriverModel>>
> {
  const driver = await resolveAgentDriverModel();
  if (driver.driverTransport !== 'antigravity-sdk') {
    throw new Error(
      `maic-agent-driver Antigravity khusus mengharapkan provider "antigravity" dengan api ` +
        `"antigravity-sdk"; ter-resolve ${driver.connection.modelString} via ` +
        `${JSON.stringify(driver.driverApi)}.`,
    );
  }
  return driver;
}

export async function assertAntigravitySdkReady(): Promise<void> {
  const availability = await antigravityCliAuthStatus();
  if (!availability.installed) throw new Error(availability.message);
  if (!availability.authenticated) throw new Error(availability.message);
}

/** Opsi StreamFn yang benar untuk driver Antigravity (tanpa cap max_tokens di wire). */
export function antigravitySdkStreamFnOptions(driver: {
  wireMaxOutputTokens?: number;
  connection: { thinkingConfig?: unknown };
}): {
  maxOutputTokens: undefined;
  omitMaxOutputTokens: true;
  source: 'agent-runtime:antigravity-cli';
} {
  void driver.wireMaxOutputTokens;
  return {
    maxOutputTokens: undefined,
    omitMaxOutputTokens: true,
    source: 'agent-runtime:antigravity-cli',
  };
}

/** Message shown when an Antigravity run fails before/while answering. */
export function antigravitySdkFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
