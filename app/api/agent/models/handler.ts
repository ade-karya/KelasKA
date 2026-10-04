import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { lookupSlot } from '@/lib/server/model-config/runtime';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';
import {
  activatedOpencodeModels,
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
 * Daftar + pilihan model CLI OpenCode untuk Pro Workbench (provider
 * `opencode` dan `opencode-go`, dua grup di pemilih).
 *
 *   GET /api/agent/models
 *     -> { active, driverApi, thinking, source,
 *          models: [{provider, id, modelString, name, thinking, ...}] }
 *
 *   POST /api/agent/models { model: "opencode:xxx" | "opencode-go:yyy" | "xxx",
 *                            thinking?: {...} }
 *     -> memilih model aktif global + varian thinking per model
 *        (data/agent-driver-model.json). Berlaku untuk run berikutnya
 *        tanpa restart.
 *
 * `active` = override tombol bila ada, else slot `agent` (openmaic.yml /
 * model settings), else default tier3. `thinking` = varian thinking aktif
 * (override, else slot; tanpa default suntikan). `models` = SEMUA model yang
 * diaktifkan installer di OPENCODE_MODELS / OPENCODE_GO_MODELS
 * (fallback katalog).
 */
export async function GET() {
  if (!isAgentRuntimeConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  const models = activatedOpencodeModels();
  const override = readActiveModelOverride();
  // Slot `agent` owns the driver model now (MODEL_ROUTES is gone upstream).
  // Unassigned/disabled -> fall through to the tier-3 default.
  let slotModel = '';
  let slotThinking: ThinkingConfig | undefined;
  let slotApi: string | undefined;
  try {
    const lookup = await lookupSlot('agent', null);
    const resolution =
      lookup.configured.status === 'unassigned' ? lookup.defaults() : lookup.configured;
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
  const active = override?.modelString || slotModel || defaultTier3ModelString();
  // Varian aktif: override tombol, else thinking slot operator. Default
  // capability TIDAK disuntik di sini — kontrol picker menampilkannya sendiri
  // (getDefaultThinkingConfig) dan tak ada yang tersimpan sebelum user menyentuh.
  const thinking: ThinkingConfig | undefined = override?.thinking ?? slotThinking;
  return apiSuccess({
    active,
    driverApi: override?.api ?? slotApi ?? 'opencode-cli',
    ...(thinking ? { thinking } : {}),
    source: override ? 'workbench-override' : slotModel ? 'agent-slot' : 'default',
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
  try {
    const saved = writeActiveModelOverride(raw, thinkingRaw);
    return apiSuccess(
      {
        active: saved.modelString,
        driverApi: saved.api,
        ...(saved.thinking ? { thinking: saved.thinking } : {}),
        models: activatedOpencodeModels(),
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
