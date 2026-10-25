import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { lookupSlot } from '@/lib/server/model-config/runtime';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';
import {
  activatedDriverModelsDynamic,
  defaultTier3ModelString,
  readActiveModelOverride,
  writeActiveModelOverride,
} from '@/lib/server/agent-runtime/opencode-models';

export const runtime = 'nodejs';

export interface AgentModelItem {
  provider: string;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  contextWindow?: number;
  outputWindow?: number;
}

/**
 * Daftar + pilihan model transport lokal untuk Pro Workbench (provider
 * `opencode`, `opencode-go`, `codex` dan `antigravity` — empat grup di pemilih).
 *
 *   GET /api/agent/models
 *     -> { active, driverApi, thinking, source,
 *          models: [{provider, id, modelString, name, thinking, ...}] }
 *
 *   POST /api/agent/models { model: "opencode:xxx" | "opencode-go:yyy" |
 *                                   "codex:zzz" | "antigravity:www" | "xxx", thinking?: {...} }
 *     -> memilih model aktif global + varian thinking per model
 *        (data/agent-driver-model.json). Berlaku untuk run berikutnya
 *        tanpa restart.
 *
 * `active` = override tombol bila ada, else slot `agent` (openmaic.yml /
 * model settings), else default tier3. `thinking` = varian thinking aktif
 * (override, else slot; tanpa default suntikan). `models` = SEMUA model yang
 * diaktifkan installer di OPENCODE_MODELS / OPENCODE_GO_MODELS / CODEX_MODELS /
 * ANTIGRAVITY_MODELS (fallback katalog).
 */
export async function GET() {
  if (!isAgentRuntimeConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  const models = await activatedDriverModelsDynamic();
  const override = readActiveModelOverride();
  // Slot `agent` owns the driver model now (MODEL_ROUTES is gone upstream).
  // Unassigned/disabled -> fall through to the tier-3 default.
  let slotModel = '';
  let slotThinking: ThinkingConfig | undefined;
  let slotApi: string | undefined;
  try {
    const resolution = await lookupSlot('agent', null);
    if (resolution.status === 'assigned') {
      slotModel =
        resolution.modelId && resolution.providerId
          ? `${resolution.providerId}:${resolution.modelId}`
          : (resolution.modelId ?? '');
      slotThinking = resolution.thinking;
      slotApi = resolution.api;
    }
  } catch {
    // Slot unreadable -> default below.
  }
  // An override that points at a model no longer available (for example a
  // Codex model the logged-in account cannot use) is ignored so the UI falls
  // back to the slot instead of a broken selection.
  const availableModelStrings = new Set(models.map((m) => m.modelString));
  const overrideValid = !!override && availableModelStrings.has(override.modelString);
  const active =
    (overrideValid ? override!.modelString : '') || slotModel || defaultTier3ModelString();
  // Varian aktif: override tombol, else thinking slot operator. Default
  // capability TIDAK disuntik di sini — kontrol picker menampilkannya sendiri
  // (getDefaultThinkingConfig) dan tak ada yang tersimpan sebelum user menyentuh.
  const thinking: ThinkingConfig | undefined = overrideValid
    ? override!.thinking ?? slotThinking
    : slotThinking;
  return apiSuccess({
    active,
    driverApi:
      (overrideValid ? override!.api : undefined) ?? slotApi ?? 'opencode-cli',
    ...(thinking ? { thinking } : {}),
    source: overrideValid ? 'workbench-override' : slotModel ? 'agent-slot' : 'default',
    models,
  });
}

export async function POST(req: Request) {
  if (!isAgentRuntimeConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  let body: unknown = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return apiError('INVALID_REQUEST', 400, 'invalid JSON body');
  }
  const raw =
    typeof (body as { model?: unknown }).model === 'string'
      ? ((body as { model: string }).model ?? '')
      : '';
  if (!raw.trim()) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'model is required');
  }
  const thinkingRaw = (body as { thinking?: unknown }).thinking;
  // Ensure dynamic models are discovered so that isActivatedDriverModel
  // recognizes variants like gemini-3.8-flash-high from agy models.
  await activatedDriverModelsDynamic();
  try {
    const saved = writeActiveModelOverride(raw, thinkingRaw);
    return apiSuccess(
      {
        active: saved.modelString,
        driverApi: saved.api,
        ...(saved.thinking ? { thinking: saved.thinking } : {}),
        models: await activatedDriverModelsDynamic(),
      },
      200,
    );
  } catch (error) {
    return apiError(
      'INVALID_REQUEST',
      400,
      error instanceof Error ? error.message : 'Model tidak valid.',
    );
  }
}
