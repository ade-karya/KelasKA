import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getStageRoute } from '@/lib/server/model-routes';
import {
  activatedOpencodeModels,
  defaultTier3ModelString,
  readActiveModelOverride,
  writeActiveModelOverride,
} from '@/lib/server/agent-runtime/opencode-models';

export const runtime = 'nodejs';

/**
 * Daftar + pilihan model free OpenCode CLI untuk Pro Workbench.
 *
 *   GET /api/agent/models
 *     -> { active, driverApi, source, models: [{id, modelString, name}] }
 *
 *   POST /api/agent/models { model: "opencode:xxx" | "xxx" }
 *     -> memilih model aktif global (data/agent-driver-model.json).
 *        Berlaku untuk run berikutnya tanpa restart.
 *
 * `active` = override tombol bila ada, else MODEL_ROUTES maic-agent-driver,
 * else default tier3. `models` = SEMUA model free yang diaktifkan installer
 * di OPENCODE_MODELS (fallback katalog).
 */
export async function GET() {
  if (!isAgentRuntimeConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  const models = activatedOpencodeModels();
  const override = readActiveModelOverride();
  const routeModel = getStageRoute('maic-agent-driver')?.model?.trim() || '';
  const active = override?.modelString || routeModel || defaultTier3ModelString();
  return apiSuccess({
    active,
    driverApi: override?.api ?? getStageRoute('maic-agent-driver')?.api ?? 'opencode-cli',
    source: override ? 'workbench-override' : routeModel ? 'model-routes' : 'default',
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
  try {
    const saved = writeActiveModelOverride(raw);
    return apiSuccess(
      { active: saved.modelString, driverApi: saved.api, models: activatedOpencodeModels() },
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
