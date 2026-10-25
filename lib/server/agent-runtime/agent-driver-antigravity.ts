/**
 * maic-agent-driver khusus Google Antigravity SDK (transport lokal, tanpa
 * endpoint HTTP).
 *
 * Transport: satu turn SDK Python (`Agent.chat` dengan structured output) —
 * lihat lib/ai/antigravity-sdk.ts, lib/ai/antigravity_bridge.py, dan
 * lib/agent/runtime/antigravity-stream-fn.ts. Bukan panggilan REST: bridge
 * Python yang men-spawn SDK, mematikan semua built-in tool kecuali `finish`,
 * dan mengembalikan `{text, toolCalls}` sesuai response_schema.
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
 * `{"model":"antigravity:…","api":"antigravity-sdk"}`).
 * Alias api sah: "antigravity-sdk" | "antigravity". Provider sah:
 * "antigravity".
 *
 * Validasi kontraktual (prefix eksplisit, api/provider cocok) milik
 * lib/server/agent-runtime/agent-driver-model.ts — modul ini hanya menegaskan
 * varian SDK: memastikan route yang ter-resolve memang Antigravity, lalu
 * menyediakan opsi StreamFn yang benar (tanpa cap max_tokens di wire) dan probe
 * ketersediaan Python/SDK/kredensial sebelum run dimulai.
 */

import { antigravitySdkAvailability, describeAntigravityError } from '@/lib/ai/antigravity-sdk';
import {
  AGENT_DRIVER_STAGE,
  isAntigravitySdkApi,
  isAntigravitySdkProvider,
  resolveAgentDriverModel,
} from './agent-driver-model';

export { AGENT_DRIVER_STAGE, isAntigravitySdkApi, isAntigravitySdkProvider };

/** True bila koneksi yang ter-resolve dieksekusi lokal lewat Antigravity SDK. */
export function isAntigravitySdkDriverConnection(providerId: string, driverApi?: string): boolean {
  return isAntigravitySdkApi(driverApi) || isAntigravitySdkProvider(providerId);
}

/**
 * Resolve driver dan pastikan varian Antigravity. Melempar bila route
 * ter-resolve bukan Antigravity (mis. operator bermaksud HTTP ber-key) agar
 * kesalahan config gagal keras saat start run, bukan sebagai turn yang
 * menggantung.
 */
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

/**
 * Fail loud *before* the session starts when the host cannot run Antigravity
 * at all (bridge missing / Python package not installed / key absent). Turn
 * failures after this point surface through describeAntigravityError.
 */
export async function assertAntigravitySdkReady(): Promise<void> {
  const availability = await antigravitySdkAvailability();
  if (!availability.available) throw new Error(availability.reason);
}

/** Opsi StreamFn yang benar untuk driver Antigravity (tanpa cap max_tokens di wire). */
export function antigravitySdkStreamFnOptions(driver: {
  wireMaxOutputTokens?: number;
  connection: { thinkingConfig?: unknown };
}): {
  maxOutputTokens: undefined;
  omitMaxOutputTokens: true;
  source: 'agent-runtime:antigravity-sdk';
} {
  void driver.wireMaxOutputTokens;
  return {
    maxOutputTokens: undefined,
    omitMaxOutputTokens: true,
    source: 'agent-runtime:antigravity-sdk',
  };
}

/** Message shown when an Antigravity run fails before/while answering. */
export function antigravitySdkFailureMessage(error: unknown): string {
  return describeAntigravityError(error);
}
