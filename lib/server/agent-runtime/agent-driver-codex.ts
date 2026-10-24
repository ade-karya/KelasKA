/**
 * maic-agent-driver khusus Codex SDK (transport lokal, tanpa endpoint HTTP).
 *
 * Transport: satu turn `@openai/codex-sdk` (`Codex.startThread` +
 * `runStreamed`) dengan structured output — lihat
 * lib/agent/runtime/codex-stream-fn.ts. Bukan `codex exec` yang dirakit tangan:
 * SDK yang men-spawn binary, memetakan event, dan menegakkan schema output.
 *
 * Loop tetap milik OpenMAIC (pi): function tools sampai ke model sebagai
 * katalog + kontrak JSON, lalu dieksekusi harness dengan allowlist, timeout,
 * quota, dan transcript yang sama seperti transport HTTP/CLI.
 *
 * Route:
 *   slots:
 *     agent: codex:gpt-5.6-codex
 * atau lewat tombol pemilih Pro Workbench (POST /api/agent/models, tersimpan
 * di data/agent-driver-model.json sebagai `{"model":"codex:…","api":"codex-sdk"}`).
 * Alias api sah: "codex-sdk" | "codex". Provider sah: "codex".
 *
 * Validasi kontraktual (prefix eksplisit, api/provider cocok) milik
 * lib/server/agent-runtime/agent-driver-model.ts — modul ini hanya menegaskan
 * varian SDK: memastikan route yang ter-resolve memang Codex, lalu menyediakan
 * opsi StreamFn yang benar (tanpa cap max_tokens di wire) dan probe
 * ketersediaan binary/auth sebelum run dimulai.
 */

import { codexSdkAvailability, describeCodexSdkError } from '@/lib/ai/codex-sdk';
import {
  AGENT_DRIVER_STAGE,
  isCodexSdkApi,
  isCodexSdkProvider,
  resolveAgentDriverModel,
} from './agent-driver-model';

export { AGENT_DRIVER_STAGE, isCodexSdkApi, isCodexSdkProvider };

/** True bila koneksi yang ter-resolve dieksekusi lokal lewat Codex SDK. */
export function isCodexSdkDriverConnection(providerId: string, driverApi?: string): boolean {
  return isCodexSdkApi(driverApi) || isCodexSdkProvider(providerId);
}

/**
 * Resolve driver dan pastikan varian Codex. Melempar bila route ter-resolve
 * bukan Codex (mis. operator bermaksud HTTP ber-key) agar kesalahan config
 * gagal keras saat start run, bukan sebagai turn yang menggantung.
 */
export async function resolveCodexSdkDriverModel(): Promise<
  Awaited<ReturnType<typeof resolveAgentDriverModel>>
> {
  const driver = await resolveAgentDriverModel();
  if (driver.driverTransport !== 'codex-sdk') {
    throw new Error(
      `maic-agent-driver Codex khusus mengharapkan provider "codex" dengan api ` +
        `"codex-sdk"; ter-resolve ${driver.connection.modelString} via ` +
        `${JSON.stringify(driver.driverApi)}.`,
    );
  }
  return driver;
}

/**
 * Fail loud *before* the session starts when the host cannot run Codex at all
 * (binary missing / SDK not installed). Auth failures can only be observed on
 * the first turn; those surface through describeCodexSdkError.
 */
export async function assertCodexSdkReady(): Promise<void> {
  const availability = await codexSdkAvailability();
  if (!availability.available) throw new Error(availability.reason);
}

/** Opsi StreamFn yang benar untuk driver Codex (tanpa cap max_tokens di wire). */
export function codexSdkStreamFnOptions(driver: {
  wireMaxOutputTokens?: number;
  connection: { thinkingConfig?: unknown };
}): {
  maxOutputTokens: undefined;
  omitMaxOutputTokens: true;
  source: 'agent-runtime:codex-sdk';
} {
  void driver.wireMaxOutputTokens;
  return {
    maxOutputTokens: undefined,
    omitMaxOutputTokens: true,
    source: 'agent-runtime:codex-sdk',
  };
}

/** Message shown when a Codex run fails before/while answering. */
export function codexSdkFailureMessage(error: unknown): string {
  return describeCodexSdkError(error);
}
