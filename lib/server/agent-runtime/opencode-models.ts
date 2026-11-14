import fs from 'node:fs';
import path from 'node:path';
import {
  PROVIDERS,
  CODEX_SDK_THINKING,
  OPENCODE_CLI_THINKING,
  ANTIGRAVITY_SDK_THINKING,
} from '@/lib/ai/providers';
import { listCodexModels } from '@/lib/ai/codex-app-server';
import { listAntigravityModels } from '@/lib/ai/antigravity-cli-models';
import { listOpencodeModels } from '@/lib/ai/opencode-cli-models';
import { codexAuthStatus } from '@/lib/ai/codex-auth';
import { antigravityCliAuthStatus } from '@/lib/ai/antigravity-cli-auth';
import { getDefaultThinkingConfig, normalizeThinkingConfig } from '@/lib/ai/thinking-config';
import type { ThinkingCapability, ThinkingConfig, ThinkingEffort } from '@/lib/types/provider';

const discoveredCodexIds = new Set<string>();
const discoveredCodexModels = new Map<
  string,
  { reasoningEfforts: string[]; defaultReasoningEffort: string | null }
>();
const discoveredAntigravityIds = new Set<string>();
// Runtime discovery outcomes, used by `isActivatedDriverModel`. `ran` stays false
// until a dynamic listing ran in this process, so synchronous callers in dev keep
// the old allowlist behaviour; once it ran, the live list is authoritative and
// models the account cannot use are rejected.
let opencodeDiscovery: { ran: boolean; ids: Set<string> } = { ran: false, ids: new Set() };
let codexDiscoveryRan = false;
let antigravityDiscoveryRan = false;

/**
 * Daftar model transport lokal yang diaktifkan installer untuk Pro Workbench.
 *
 * Tiga+ provider (`opencode` dan `opencode-go` via `opencode run`, `codex`
 * via native `@openai/codex-sdk`, `antigravity` via Google Antigravity CLI):
 * - Model yang TAMPIL di pemilih selalu hasil penemuan live: `opencode
 *   models` (login-aware), `model/list` Codex dan `agy models`. Model yang
 *   akun tidak bisa pakai tidak pernah ditampilkan.
 * - Untuk OpenCode, OPENCODE_MODELS / OPENCODE_GO_MODELS berfungsi sebagai
 *   allowlist operator (comma-separated, bare id): daftar ditampilkan adalah
 *   irisan allowlist dengan hasil `opencode models`. Variabel tidak ada atau
 *   kosong = tanpa allowlist — tampilkan apa pun yang live-discovery temukan
 *   (kosong bila CLI/login tidak tersedia).
 * - CODEX_MODELS / ANTIGRAVITY_MODELS tetap ditulis installer sebagai catatan,
 *   tetapi pemilih memakai penemuan live; saat penemuan gagal atau kosong,
 *   tidak ada model yang ditampilkan.
 * - Tombol pemilih model di Pro Workbench (/workspace) membaca daftar ini via
 *   GET /api/agent/models dan memilih aktif (+ varian thinking per model)
 *   via POST (tersimpan di data/agent-driver-model.json, dipakai run
 *   berikutnya tanpa restart).
 */

export const OPENCODE_CLI_PROVIDERS = ['opencode', 'opencode-go'] as const;
export type OpencodeCliProvider = (typeof OPENCODE_CLI_PROVIDERS)[number];

/** Provider transport lokal yang bisa dipilih dari tombol Pro Workbench. */
export const CODEX_PROVIDER = 'codex' as const;
export const ANTIGRAVITY_PROVIDER = 'antigravity' as const;
export const DRIVER_PROVIDERS = [
  ...OPENCODE_CLI_PROVIDERS,
  CODEX_PROVIDER,
  ANTIGRAVITY_PROVIDER,
] as const;
export type DriverProvider = (typeof DRIVER_PROVIDERS)[number];

export const OPENCODE_FREE_FALLBACK_IDS = [
  'space-bunny-free',
  'muse-spark-1.3-contributor-free',
  'big-pickle',
  'longcat-2.5-preview-free',
  'mimo-v2.6-flash-free',
  'ling-3.1-flash-free',
  'nemotron-3-ultra-free',
  'nemotron-3.5-lightning-free',
  'step-5-preview-free',
  'beam-free',
  'deepseek-v4.1-flash-free',
  'glm-5.3-flash-free',
  'nemotron-3.5-super-vl-free',
] as const;

export const OPENCODE_DRIVER_API = 'opencode-cli' as const;
/** Route api of the native Codex SDK transport (lib/ai/codex-sdk.ts). */
export const CODEX_DRIVER_API = 'codex-sdk' as const;
/** Route api of the Antigravity CLI transport (lib/ai/antigravity-cli.ts); the name is a documented wire alias. */
export const ANTIGRAVITY_DRIVER_API = 'antigravity-sdk' as const;
/**
 * Route api of a chat model picked from the model settings (an HTTP provider,
 * not a local CLI transport). The selection is stored with this marker so the
 * runner resolves it over the keyed HTTP path instead of the CLI envelope.
 */
export const HTTP_DRIVER_API = 'http' as const;
export const OPENCODE_ACTIVE_MODEL_FILE = 'agent-driver-model.json';

function dataDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return path.join(dir, 'data');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), 'data');
}

export function activeModelFilePath(): string {
  const override = process.env.OPENCODE_ACTIVE_MODEL_FILE?.trim();
  if (override)
    return path.isAbsolute(override)
      ? override
      : path.join(/*turbopackIgnore: true*/ process.cwd(), override);
  return path.join(dataDir(), OPENCODE_ACTIVE_MODEL_FILE);
}

function splitIds(raw: string | undefined, provider: DriverProvider): string[] {
  if (!raw) return [];
  const prefix = new RegExp(`^${provider}[/:]`, 'i');
  return raw
    .split(',')
    .map((s) => s.trim().replace(prefix, ''))
    .filter(Boolean);
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function envVarFor(provider: DriverProvider): string {
  if (provider === 'codex') return 'CODEX_MODELS';
  if (provider === 'antigravity') return 'ANTIGRAVITY_MODELS';
  return provider === 'opencode-go' ? 'OPENCODE_GO_MODELS' : 'OPENCODE_MODELS';
}

/** Katalog statis satu provider transport (lib/ai/providers.ts). */
export function catalogDriverIds(provider: DriverProvider): string[] {
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.map((m) => m.id).filter(Boolean);
  } catch {
    return provider === CODEX_PROVIDER ? [] : [...OPENCODE_FREE_FALLBACK_IDS];
  }
}

/** Katalog statis provider CLI (lib/ai/providers.ts). */
export function catalogOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  return catalogDriverIds(provider);
}

/**
 * SEMUA id yang diaktifkan untuk satu provider: env (OPENCODE_MODELS /
 * OPENCODE_GO_MODELS) bila terisi, else katalog statis. Nilai operator
 * eksplisit dihormati apa adanya (tanpa menyuntik default) — installer yang
 * memastikan default ikut saat menulis daftar.
 *
 * Synchronous allowlist read (legacy/dev paths). Runtime discovery is the
 * source of truth for what the picker shows; this function only backs the
 * non-async call sites. `VAR` unset means "static catalog", `VAR=` empty means
 * "no operator allowlist, follow live discovery", otherwise the listed ids.
 */
export function activatedDriverIds(provider: DriverProvider): string[] {
  const raw = process.env[envVarFor(provider)];
  if (raw !== undefined && raw.trim() === '') return [];
  const fromEnv = dedupe(splitIds(raw, provider));
  if (fromEnv.length > 0) return fromEnv;
  return dedupe(catalogDriverIds(provider));
}

export function activatedOpencodeIds(provider: OpencodeCliProvider = 'opencode'): string[] {
  return activatedDriverIds(provider);
}

export interface ActivatedDriverModel {
  provider: DriverProvider;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  contextWindow?: number;
  outputWindow?: number;
}

/** @deprecated Nama lama; model kini mencakup transport Codex juga. */
export type ActivatedOpencodeModel = ActivatedDriverModel;

function defaultDriverThinking(provider: DriverProvider): ThinkingCapability {
  if (provider === CODEX_PROVIDER) return CODEX_SDK_THINKING;
  if (provider === ANTIGRAVITY_PROVIDER) return ANTIGRAVITY_SDK_THINKING;
  return OPENCODE_CLI_THINKING;
}

function modelEntry(provider: DriverProvider, id: string): ActivatedDriverModel | null {
  if (!id) return null;
  const catalog = PROVIDERS?.[provider]?.models ?? [];
  const info = catalog.find((m) => m.id === id);
  const item: ActivatedDriverModel = {
    provider,
    id,
    modelString: `${provider}:${id}`,
    name: info?.name ?? id,
  };
  if (info?.capabilities?.thinking) item.thinking = info.capabilities.thinking;
  else item.thinking = defaultDriverThinking(provider);
  if (info?.contextWindow) item.contextWindow = info.contextWindow;
  if (info?.outputWindow) item.outputWindow = info.outputWindow;
  return item;
}

/** SEMUA model aktif kedua provider CLI (urutan: opencode dulu, lalu opencode-go). */
export function activatedOpencodeModels(): ActivatedDriverModel[] {
  const out: ActivatedOpencodeModel[] = [];
  for (const provider of OPENCODE_CLI_PROVIDERS) {
    for (const id of activatedOpencodeIds(provider)) {
      const item = modelEntry(provider, id);
      if (item) out.push(item);
    }
  }
  return out;
}

/** Model Codex aktif (CODEX_MODELS, fallback katalog provider `codex`). */
export function activatedCodexModels(): ActivatedDriverModel[] {
  return activatedDriverIds(CODEX_PROVIDER)
    .map((id) => modelEntry(CODEX_PROVIDER, id))
    .filter((item): item is ActivatedDriverModel => item !== null);
}

/** Model Google Antigravity aktif (ANTIGRAVITY_MODELS, fallback katalog). */
export function activatedAntigravityModels(): ActivatedDriverModel[] {
  return activatedDriverIds(ANTIGRAVITY_PROVIDER)
    .map((id) => modelEntry(ANTIGRAVITY_PROVIDER, id))
    .filter((item): item is ActivatedDriverModel => item !== null);
}

/** Model Antigravity yang tersedia untuk akun yang login (via `agy models`). */
export async function activatedAntigravityModelsDynamic(): Promise<ActivatedDriverModel[]> {
  antigravityDiscoveryRan = true;
  try {
    // `agy models` prints a banner + sign-in error (not models) when the
    // account is signed out, but gate on auth anyway so a stale cache never
    // survives a logout.
    const auth = await antigravityCliAuthStatus();
    discoveredAntigravityIds.clear();
    if (!auth.authenticated) return [];
    const discovered = await listAntigravityModels();
    if (discovered.length > 0) {
      discovered.forEach((m) => discoveredAntigravityIds.add(m.id));
      return discovered.map((m) => {
        const item: ActivatedDriverModel = {
          provider: ANTIGRAVITY_PROVIDER,
          id: m.id,
          modelString: `${ANTIGRAVITY_PROVIDER}:${m.id}`,
          name: m.displayName || m.id,
          thinking: undefined,
        };
        return item;
      });
    }
  } catch {
    // fall through
  }
  // Penemuan kosong/gagal = tidak ada model yang bisa dipakai, jadi pemilih
  // mengosongkan grupnya (bukan menampilkan katalog lama yang sudah mati).
  return [];
}

/** Model Codex yang tersedia untuk akun yang login (via app-server model/list). */
export async function activatedCodexModelsDynamic(): Promise<ActivatedDriverModel[]> {
  codexDiscoveryRan = true;
  try {
    // `model/list` mengembalikan katalog bawaan Codex bahkan tanpa login,
    // jadi periksa status login dulu; kalau belum, tidak ada model yang bisa
    // dipakai dan grupnya harus kosong.
    const auth = await codexAuthStatus();
    discoveredCodexIds.clear();
    discoveredCodexModels.clear();
    if (!auth.loggedIn) return [];
    const discovered = await listCodexModels();
    if (discovered.length > 0) {
      discovered.forEach((m) => {
        discoveredCodexIds.add(m.id);
        discoveredCodexModels.set(m.id, {
          reasoningEfforts: m.reasoningEfforts,
          defaultReasoningEffort: m.defaultReasoningEffort,
        });
      });
      return discovered.map((m) => {
        const efforts =
          m.reasoningEfforts.length > 0
            ? m.reasoningEfforts
            : (CODEX_SDK_THINKING.effortValues ?? []);
        const thinking: ThinkingCapability = {
          ...CODEX_SDK_THINKING,
          effortValues: efforts as ThinkingEffort[],
          defaultEffort:
            (m.defaultReasoningEffort as ThinkingCapability['defaultEffort']) ??
            CODEX_SDK_THINKING.defaultEffort,
        };
        const item: ActivatedDriverModel = {
          provider: CODEX_PROVIDER,
          id: m.id,
          modelString: `${CODEX_PROVIDER}:${m.id}`,
          name: m.displayName || m.id,
          thinking,
        };
        return item;
      });
    }
  } catch {
    // fall through: nothing usable to show
  }
  return [];
}

/** SEMUA model transport lokal, hanya yang bisa dipakai akun yang login. */
export async function activatedDriverModelsDynamic(): Promise<ActivatedDriverModel[]> {
  const [opencodeLive, codex, antigravity] = await Promise.all([
    listOpencodeModels(),
    activatedCodexModelsDynamic(),
    activatedAntigravityModelsDynamic(),
  ]);
  const liveByProvider = new Map<'opencode' | 'opencode-go', string[]>();
  for (const provider of OPENCODE_CLI_PROVIDERS) liveByProvider.set(provider, []);
  for (const model of opencodeLive) {
    liveByProvider.get(model.provider)?.push(model.id);
  }
  opencodeDiscovery = {
    ran: true,
    ids: new Set(opencodeLive.map((model) => `${model.provider}:${model.id}`)),
  };
  const opencode: ActivatedDriverModel[] = [];
  for (const provider of OPENCODE_CLI_PROVIDERS) {
    const live = liveByProvider.get(provider) ?? [];
    const raw = process.env[envVarFor(provider)];
    let ids: string[];
    if (raw !== undefined && raw.trim() !== '') {
      // Allowlist operator: irisan dengan yang benar-benar bisa dipakai akun.
      const liveSet = new Set(live);
      ids = dedupe(splitIds(raw, provider)).filter((id) => liveSet.has(id));
    } else {
      // Tanpa allowlist: apa pun yang live-discovery temukan (login-aware).
      ids = dedupe(live);
    }
    for (const id of ids) {
      const item = modelEntry(provider, id);
      if (item) opencode.push(item);
    }
  }
  return [...opencode, ...codex, ...antigravity];
}

/** SEMUA model transport lokal untuk tombol pemilih Pro Workbench. */
export function activatedDriverModels(): ActivatedDriverModel[] {
  return [...activatedOpencodeModels(), ...activatedCodexModels(), ...activatedAntigravityModels()];
}

/** Capability thinking satu model transport (fallback: varian transport standar). */
export function driverThinkingCapability(
  provider: DriverProvider,
  id: string,
): ThinkingCapability | undefined {
  const fallback = defaultDriverThinking(provider);
  if (provider === CODEX_PROVIDER) {
    const discovered = discoveredCodexModels.get(id);
    if (discovered) {
      const efforts =
        discovered.reasoningEfforts.length > 0
          ? discovered.reasoningEfforts
          : (CODEX_SDK_THINKING.effortValues ?? []);
      return {
        ...CODEX_SDK_THINKING,
        effortValues: efforts as ThinkingEffort[],
        defaultEffort:
          (discovered.defaultReasoningEffort as ThinkingCapability['defaultEffort']) ??
          CODEX_SDK_THINKING.defaultEffort,
      };
    }
  }
  try {
    const models = PROVIDERS?.[provider]?.models ?? [];
    return models.find((m) => m.id === id)?.capabilities?.thinking ?? fallback;
  } catch {
    return fallback;
  }
}

/** Capability thinking satu model CLI (fallback: varian CLI standar). */
export function opencodeThinkingCapability(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingCapability | undefined {
  return driverThinkingCapability(provider, id);
}

/** Thinking default satu model CLI (dipakai saat override/route tak menyebutnya). */
export function defaultOpencodeThinking(
  provider: OpencodeCliProvider,
  id: string,
): ThinkingConfig | undefined {
  return getDefaultThinkingConfig(driverThinkingCapability(provider, id));
}

export interface ParsedDriverModel {
  provider: DriverProvider;
  bare: string;
  modelString: string;
}

/** @deprecated Nama lama; parse kini mencakup transport Codex juga. */
export type ParsedOpencodeModel = ParsedDriverModel;

/**
 * Parse input model transport: `opencode:x`, `opencode/x`, `opencode-go:x`,
 * `opencode-go/x`, `codex:x`, `codex/x`, atau bare `x` (= provider `opencode`,
 * kompatibel lama). Null bila kosong / mengandung karakter terlarang.
 */
export function parseDriverModelInput(raw: string): ParsedDriverModel | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || /[\s"{}]/.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  for (const provider of DRIVER_PROVIDERS) {
    if (provider === 'opencode') continue;
    if (lower.startsWith(`${provider}:`) || lower.startsWith(`${provider}/`)) {
      const bare = trimmed.slice(provider.length + 1).trim();
      if (!bare || /[\s"{}]/.test(bare)) return null;
      return { provider, bare, modelString: `${provider}:${bare}` };
    }
  }
  const bare = trimmed.replace(/^opencode[/:]/i, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return { provider: 'opencode', bare, modelString: `opencode:${bare}` };
}

export interface ParsedHttpModel {
  provider: string;
  bare: string;
  modelString: string;
}

/** True when a stored selection names the keyed HTTP transport. */
export function isHttpDriverApi(api: string | undefined): boolean {
  return !!api && api.trim() === HTTP_DRIVER_API;
}

/**
 * Parse a `provider:model` reference to a chat model from the model settings.
 * CLI providers are refused here: their transports are parsed by
 * {@link parseDriverModelInput} and validated against live discovery.
 */
export function parseHttpModelInput(raw: string): ParsedHttpModel | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || /[\s"{}]/.test(trimmed)) return null;
  const colon = trimmed.indexOf(':');
  if (colon <= 0 || colon === trimmed.length - 1) return null;
  const provider = trimmed.slice(0, colon).trim();
  const bare = trimmed.slice(colon + 1).trim();
  if (!provider || !bare || /[\s"{}]/.test(bare)) return null;
  if ((DRIVER_PROVIDERS as readonly string[]).includes(provider.toLowerCase())) return null;
  return { provider, bare, modelString: `${provider}:${bare}` };
}

/** Parse input provider CLI OpenCode saja (kompatibel lama). */
export function parseOpencodeModelInput(raw: string): ParsedOpencodeModel | null {
  const parsed = parseDriverModelInput(raw);
  return parsed && parsed.provider !== CODEX_PROVIDER ? parsed : null;
}

/**
 * Kompatibel lama: bare id provider `opencode` (tanpa prefix). Input
 * `opencode-go:*` mengembalikan null — pakai parseOpencodeModelInput untuk
 * kedua provider.
 */
export function normalizeOpencodeModelInput(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const bare = trimmed.replace(/^opencode[/:]/, '').trim();
  if (!bare || /[\s"{}]/.test(bare)) return null;
  return bare;
}

export function resetDiscoveredCodexIds(): void {
  discoveredCodexIds.clear();
  discoveredCodexModels.clear();
  codexDiscoveryRan = false;
}

export function resetDiscoveredAntigravityIds(): void {
  discoveredAntigravityIds.clear();
  antigravityDiscoveryRan = false;
}

/** Drop the live OpenCode discovery cache (after sign-in / model catalog changes). */
export function resetDiscoveredOpencodeIds(): void {
  opencodeDiscovery = { ran: false, ids: new Set() };
}

export function isActivatedDriverModel(provider: DriverProvider, id: string): boolean {
  // Once live discovery ran in this process, its result is authoritative: models
  // the account cannot use are rejected. Before that (synchronous cold path),
  // keep the installer's allowlist so a fresh runner can still resolve the
  // override the picker wrote.
  if (provider === CODEX_PROVIDER) {
    if (codexDiscoveryRan) return discoveredCodexIds.has(id);
    return discoveredCodexIds.has(id) || activatedDriverIds(provider).includes(id);
  }
  if (provider === ANTIGRAVITY_PROVIDER) {
    if (antigravityDiscoveryRan) return discoveredAntigravityIds.has(id);
    return discoveredAntigravityIds.has(id) || activatedDriverIds(provider).includes(id);
  }
  if (opencodeDiscovery.ran) return opencodeDiscovery.ids.has(`${provider}:${id}`);
  return activatedDriverIds(provider).includes(id);
}

export function isActivatedOpencodeId(
  id: string,
  provider: OpencodeCliProvider = 'opencode',
): boolean {
  return isActivatedDriverModel(provider, id);
}

/** Route `api` for a driver provider (all are local, non-HTTP transports). */
export function driverApiFor(provider: DriverProvider): string {
  if (provider === CODEX_PROVIDER) return CODEX_DRIVER_API;
  if (provider === ANTIGRAVITY_PROVIDER) return ANTIGRAVITY_DRIVER_API;
  return OPENCODE_DRIVER_API;
}

interface ActiveModelFile {
  model?: string;
  api?: string;
  thinking?: ThinkingConfig;
  updatedAt?: number;
}

/** Override aktif dari tombol workbench (file data/), null bila belum ada. */
export function readActiveModelOverride(): {
  modelString: string;
  api: string;
  thinking?: ThinkingConfig;
} | null {
  try {
    const file = activeModelFilePath();
    if (!fs.existsSync(/*turbopackIgnore: true*/ file)) return null;
    const parsed = JSON.parse(
      fs.readFileSync(/*turbopackIgnore: true*/ file, 'utf8'),
    ) as ActiveModelFile;
    // A model picked from the model settings is stored with the HTTP marker;
    // membership in the settings is validated by the runner before a turn.
    if (isHttpDriverApi(parsed.api)) {
      const http = parseHttpModelInput(parsed.model ?? '');
      if (!http) return null;
      return { modelString: http.modelString, api: HTTP_DRIVER_API };
    }
    const input = parseDriverModelInput(parsed.model ?? '');
    if (!input || !isActivatedDriverModel(input.provider, input.bare)) return null;
    const out: { modelString: string; api: string; thinking?: ThinkingConfig } = {
      modelString: input.modelString,
      api: parsed.api || driverApiFor(input.provider),
    };
    const capability = driverThinkingCapability(input.provider, input.bare);
    const thinking =
      parsed.thinking && typeof parsed.thinking === 'object'
        ? (normalizeThinkingConfig(capability, parsed.thinking) ?? undefined)
        : undefined;
    if (thinking) out.thinking = thinking;
    return out;
  } catch {
    return null;
  }
}

/**
 * Validate + normalize a driver-model selection from any caller (picker,
 * session creation, session override). Throws a readable error when the
 * model is unknown or not usable by the signed-in account. Thinking is
 * normalized against the model's capability.
 */
export function normalizeDriverModelSelection(
  rawModel: string,
  rawThinking?: unknown,
): { modelString: string; api: string; thinking?: ThinkingConfig } {
  const input = parseDriverModelInput(rawModel);
  if (!input)
    throw new Error(
      'Model tidak valid (contoh: opencode:muse-spark-1.3-contributor-free, codex:gpt-5.6-codex).',
    );
  if (!isActivatedDriverModel(input.provider, input.bare)) {
    throw new Error(
      `Model "${input.bare}" tidak ada di daftar aktif (${envVarFor(input.provider)}). Pilih dari tombol pemilih model.`,
    );
  }
  const capability = driverThinkingCapability(input.provider, input.bare);
  const thinking =
    rawThinking && typeof rawThinking === 'object'
      ? (normalizeThinkingConfig(capability, rawThinking as ThinkingConfig) ?? undefined)
      : undefined;
  const normalized: { modelString: string; api: string; thinking?: ThinkingConfig } = {
    modelString: input.modelString,
    api: driverApiFor(input.provider),
  };
  if (thinking) normalized.thinking = thinking;
  return normalized;
}

/**
 * Validate a stored per-conversation selection (agent_sessions.driver_model).
 * Returns null when it is absent or no longer usable by this account.
 */
export function normalizeStoredDriverModel(
  stored: { model?: unknown; api?: unknown; thinking?: unknown } | null | undefined,
): { modelString: string; api: string; thinking?: ThinkingConfig } | null {
  if (!stored || typeof stored.model !== 'string') return null;
  // A conversation that chose a model from the model settings keeps it without
  // the CLI allowlist: the runner checks the settings before a turn.
  if (isHttpDriverApi(typeof stored.api === 'string' ? stored.api : undefined)) {
    const http = parseHttpModelInput(stored.model);
    if (!http) return null;
    return { modelString: http.modelString, api: HTTP_DRIVER_API };
  }
  try {
    const normalized = normalizeDriverModelSelection(stored.model, stored.thinking);
    if (typeof stored.api === 'string' && stored.api.trim()) {
      normalized.api = stored.api.trim();
    }
    return normalized;
  } catch {
    return null;
  }
}

/**
 * Simpan pilihan tombol workbench (model + varian thinking); melempar bila
 * model di luar allowlist. Thinking dinormalisasi terhadap capability model
 * (nilai tak dikenal jatuh ke default capability, bukan gagal).
 */
export function writeActiveModelOverride(
  rawModel: string,
  rawThinking?: unknown,
): { modelString: string; api: string; thinking?: ThinkingConfig } {
  return writeActiveModelOverrideSelection(normalizeDriverModelSelection(rawModel, rawThinking));
}

/**
 * Persist an already validated selection (CLI transport or a settings HTTP
 * model). Callers that validate against the model settings use this instead of
 * {@link writeActiveModelOverride}, which only knows the CLI allowlist.
 */
export function writeActiveModelOverrideSelection(normalized: {
  modelString: string;
  api: string;
  thinking?: ThinkingConfig;
}): { modelString: string; api: string; thinking?: ThinkingConfig } {
  const dir = dataDir();
  fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  const payload: ActiveModelFile = {
    model: normalized.modelString,
    api: normalized.api,
    ...(normalized.thinking ? { thinking: normalized.thinking } : {}),
    updatedAt: Date.now(),
  };
  const tmp = path.join(
    /*turbopackIgnore: true*/ dir,
    `${OPENCODE_ACTIVE_MODEL_FILE}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`,
  );
  fs.writeFileSync(/*turbopackIgnore: true*/ tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(/*turbopackIgnore: true*/ tmp, /*turbopackIgnore: true*/ activeModelFilePath());
  const saved: { modelString: string; api: string; thinking?: ThinkingConfig } = {
    modelString: payload.model!,
    api: payload.api!,
  };
  if (normalized.thinking) saved.thinking = normalized.thinking;
  return saved;
}

/** Default tier3 = muse-spark bila aktif, else entri pertama daftar aktif. */
export function defaultTier3ModelString(): string {
  const ids = activatedOpencodeIds('opencode');
  if (ids.includes('muse-spark-1.3-contributor-free')) {
    return 'opencode:muse-spark-1.3-contributor-free';
  }
  const first = ids[0];
  if (first) return `opencode:${first}`;
  return `opencode:${OPENCODE_FREE_FALLBACK_IDS[1]}`;
}
