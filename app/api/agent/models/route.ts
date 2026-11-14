import { isAgentRuntimeConfigured } from '@/lib/config/feature-flags';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { lookupSlot } from '@/lib/server/model-config/runtime';
import { withRequestOwner } from '@/lib/server/identity/with-owner';
import type { ThinkingCapability, ThinkingConfig } from '@/lib/types/provider';
import { NextResponse, type NextRequest } from 'next/server';
import {
  HTTP_DRIVER_API,
  activatedDriverModelsDynamic,
  defaultTier3ModelString,
  normalizeDriverModelSelection,
  normalizeStoredDriverModel,
  parseHttpModelInput,
  readActiveModelOverride,
  writeActiveModelOverrideSelection,
} from '@/lib/server/agent-runtime/opencode-models';
import {
  isSettingsChatModel,
  listSettingsChatModels,
} from '@/lib/server/agent-runtime/settings-chat-models';
import { getAgentSessionStore } from '@/lib/server/agent-runtime/store';
import { resolveRequestOwner } from '@/lib/server/identity/resolve';

export const runtime = 'nodejs';

export interface AgentModelItem {
  provider: string;
  id: string;
  modelString: string;
  name: string;
  thinking?: ThinkingCapability;
  contextWindow?: number;
  outputWindow?: number;
  /** Provider display name and logo for models that are not local CLIs. */
  providerName?: string;
  icon?: string;
  /**
   * `cli` — a local transport discovered live (opencode/codex/antigravity);
   * `http` — a chat model from the model settings, driven over HTTP.
   */
  transport?: 'cli' | 'http';
}

/**
 * Daftar + pilihan model transport lokal untuk Pro Workbench (provider
 * `opencode`, `opencode-go`, `codex` dan `antigravity` — empat grup di pemilih).
 * Hanya model yang benar-benar bisa dipakai akun yang login yang tampil:
 * daftar selalu hasil penemuan live (`opencode models`, `model/list` Codex,
 * `agy models`), diiris allowlist operator bila ada.
 *
 *   GET /api/agent/models                 -> { active, driverApi, thinking, source, models }
 *   GET /api/agent/models?sessionId=<id>  -> pilihan khusus percakapan itu
 *
 *   POST /api/agent/models { model, thinking?, sessionId? }
 *     Tanpa sessionId: memilih model default global untuk percakapan baru
 *     (data/agent-driver-model.json, dipakai run berikutnya tanpa restart).
 *     Dengan sessionId: menimpa pilihan HANYA percakapan itu
 *     (agent_sessions.driver_model) — percakapan lain tidak terpengaruh.
 *
 * `active` = pilihan percakapan (bila ada), else override tombol global,
 * else slot `agent`, else default tier3. `models` = model yang akun ini bisa
 * pakai.
 */

interface SlotResolution {
  model: string;
  thinking?: ThinkingConfig;
  api?: string;
}

/** Slot `agent` owns the driver model otherwise; tolerate unreadable slots. */
async function resolveSlotSelection(): Promise<SlotResolution> {
  try {
    const resolution = await lookupSlot('agent', null);
    if (resolution.status === 'assigned') {
      return {
        model:
          resolution.modelId && resolution.providerId
            ? `${resolution.providerId}:${resolution.modelId}`
            : (resolution.modelId ?? ''),
        thinking: resolution.thinking,
        api: resolution.api,
      };
    }
  } catch {
    // Slot unreadable -> caller falls back to the tier-3 default.
  }
  return { model: '' };
}

/**
 * The request owner, for the workspace providers the settings view includes.
 * Uses the shared resolution directly (not the route wrapper) so a model
 * picker never runs the auto-claim side effects.
 */
async function requestOwnerId(req?: NextRequest): Promise<string | null> {
  if (!req) return null;
  try {
    const outcome = await resolveRequestOwner(req);
    return outcome.ok ? outcome.principal.ownerId : null;
  } catch {
    return null;
  }
}

/** CLI discovery plus the HTTP chat models the model settings offer. */
async function driverPickerModels(req?: NextRequest): Promise<AgentModelItem[]> {
  const [cli, ownerId] = await Promise.all([activatedDriverModelsDynamic(), requestOwnerId(req)]);
  const settings = await listSettingsChatModels(ownerId);
  return [
    ...cli.map((model) => ({ ...model, transport: 'cli' as const })),
    ...settings.map((model) => ({ ...model, transport: 'http' as const })),
  ];
}

/**
 * Validate a picker selection: a local CLI transport (live discovery), else a
 * chat model the model settings offer, driven over HTTP. The HTTP branch keeps
 * no thinking effort: the agent contract forbids `reasoning_effort` alongside
 * function tools on the keyed path.
 */
async function normalizePickerSelection(
  raw: string,
  thinkingRaw: unknown,
  ownerId: string | null,
): Promise<{ modelString: string; api: string; thinking?: ThinkingConfig }> {
  try {
    return normalizeDriverModelSelection(raw, thinkingRaw);
  } catch (error) {
    const http = parseHttpModelInput(raw);
    if (http && (await isSettingsChatModel(http.modelString, ownerId))) {
      return { modelString: http.modelString, api: HTTP_DRIVER_API };
    }
    throw error;
  }
}

function buildSlotFallback(
  slot: SlotResolution,
  models: AgentModelItem[],
): { model: string; thinking?: ThinkingConfig; api?: string; source: string } {
  // An override that points at a model no longer available (for example a
  // Codex model the logged-in account cannot use) is ignored so the UI falls
  // back to the slot instead of a broken selection.
  const availableModelStrings = new Set(models.map((m) => m.modelString));
  const override = readActiveModelOverride();
  const overrideValid = !!override && availableModelStrings.has(override.modelString);
  const slotModel = slot.model;
  const model =
    (overrideValid ? override!.modelString : '') || slotModel || defaultTier3ModelString();
  // Varian aktif: override tombol, else thinking slot operator. Default
  // capability TIDAK disuntik di sini — kontrol picker menampilkannya sendiri
  // (getDefaultThinkingConfig) dan tak ada yang tersimpan sebelum user menyentuh.
  const thinking = overrideValid ? (override!.thinking ?? slot.thinking) : slot.thinking;
  const api = overrideValid ? override!.api : (slot.api ?? 'opencode-cli');
  const source = overrideValid ? 'workbench-override' : slotModel ? 'agent-slot' : 'default';
  return {
    model,
    ...(thinking ? { thinking } : {}),
    api,
    source,
  };
}

export async function GET(req?: NextRequest) {
  if (!isAgentRuntimeConfigured()) {
    return new Response('Not found', { status: 404 });
  }
  const sessionId = req ? new URL(req.url).searchParams.get('sessionId')?.trim() || null : null;
  const models = await driverPickerModels(req);
  const slot = await resolveSlotSelection();
  if (!sessionId) {
    const fallback = buildSlotFallback(slot, models);
    return apiSuccess({
      active: fallback.model,
      driverApi: fallback.api,
      ...(fallback.thinking ? { thinking: fallback.thinking } : {}),
      source: fallback.source,
      models,
    });
  }
  // Per-conversation selection: owner-scoped read; an unusable stored choice
  // (model no longer usable by this account) is treated as absent.
  if (!req) return new Response('Not found', { status: 404 }); // unreachable: sessionId implies req
  return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
    const store = await getAgentSessionStore();
    const session = await store.getSession(sessionId);
    if (!session || session.ownerId !== ownerId) {
      return new Response('Not found', { status: 404, headers: responseHeaders });
    }
    const stored = normalizeStoredDriverModel(session.driverModel);
    const availableModelStrings = new Set(models.map((m) => m.modelString));
    const storedValid = stored && availableModelStrings.has(stored.modelString) ? stored : null;
    const fallback = buildSlotFallback(slot, models);
    const active = storedValid ? storedValid.modelString : fallback.model;
    const thinking = storedValid ? storedValid.thinking : fallback.thinking;
    const driverApi = storedValid ? storedValid.api : fallback.api;
    return NextResponse.json(
      {
        success: true,
        active,
        driverApi,
        ...(thinking ? { thinking } : {}),
        source: storedValid ? 'session' : fallback.source,
        sessionId,
        models,
      },
      { status: 200, headers: responseHeaders },
    );
  });
}

export async function POST(req: NextRequest) {
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
  const sessionId =
    typeof (body as { sessionId?: unknown }).sessionId === 'string'
      ? ((body as { sessionId: string }).sessionId ?? '').trim()
      : '';
  // Ensure dynamic models are discovered so that isActivatedDriverModel
  // recognizes variants like gemini-3.8-flash-high from agy models.
  await activatedDriverModelsDynamic();

  // Per-conversation selection: writes ONLY this session row, never the
  // global override, so other conversations keep their own model.
  if (sessionId) {
    return withRequestOwner(req, async ({ ownerId }, responseHeaders) => {
      const store = await getAgentSessionStore();
      const session = await store.getSession(sessionId);
      if (!session || session.ownerId !== ownerId) {
        return new Response('Not found', { status: 404, headers: responseHeaders });
      }
      let selection: ReturnType<typeof normalizeDriverModelSelection>;
      try {
        selection = await normalizePickerSelection(raw, thinkingRaw, ownerId);
      } catch (error) {
        return apiError(
          'INVALID_REQUEST',
          400,
          error instanceof Error ? error.message : 'Model tidak valid.',
        );
      }
      await store.setSessionDriverModel(sessionId, ownerId, {
        model: selection.modelString,
        api: selection.api,
        ...(selection.thinking ? { thinking: selection.thinking } : {}),
      });
      return NextResponse.json(
        {
          success: true,
          active: selection.modelString,
          driverApi: selection.api,
          ...(selection.thinking ? { thinking: selection.thinking } : {}),
          source: 'session',
          sessionId,
          models: await driverPickerModels(req),
        },
        { status: 200, headers: responseHeaders },
      );
    });
  }

  try {
    const ownerId = await requestOwnerId(req);
    const selection = await normalizePickerSelection(raw, thinkingRaw, ownerId);
    const saved = writeActiveModelOverrideSelection(selection);
    return apiSuccess(
      {
        active: saved.modelString,
        driverApi: saved.api,
        ...(saved.thinking ? { thinking: saved.thinking } : {}),
        models: await driverPickerModels(req),
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
