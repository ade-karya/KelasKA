import type { Api, Model } from '@earendil-works/pi-ai';

import { slotLanguageModel } from '@/lib/server/model-config/llm';
import {
  lookupSlot,
  SlotDisabledError,
  SlotUnassignedError,
} from '@/lib/server/model-config/runtime';
import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';
import {
  isActivatedOpencodeId,
  parseOpencodeModelInput,
  readActiveModelOverride,
} from './opencode-models';

export const AGENT_DRIVER_STAGE = 'maic-agent-driver' as const;
export const UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS = 8_192;
// The agent slot owns the model choice. This adapter only enforces its transport
// contract: no thinking effort of its own and an OpenAI-compatible pi api/dialect. The actual HTTP transport is selected by
// lib/ai/providers.ts.
//
// CLI tier-3 transport: `opencode:*` / `opencode-go:*` models run as a local
// `opencode run` child process (lib/ai/opencode-cli.ts, pola
// nexu-io/open-design) — no HTTP, no API key. Function tools reach the model
// via the ```tool_calls envelope and the pi loop executes them, so a free Zen
// model behaves like a keyed LLM from the harness perspective (single-turn
// emit → harness executes → follow-up). Sampling batas (max tokens,
// temperature, stop) dipetakan ke instruksi prompt di opencode-cli.ts
// (paritas perilaku; hanya seed yang tetap unsupported). Usage diestimasi
// karakter/4 agar observability sama. The route declares this with
// `"api":"opencode-cli"` (aliases `"cli"`, `"opencode"`); internally the pi
// metadata still carries the `openai-completions` shim because pi's
// Model<Api> union has no CLI member — the StreamFn ignores that stub and
// routes through OpenMAIC's resolved Vercel LanguageModel anyway
// (see lib/agent/runtime/stream-fn.ts).
const OPENAI_PI_APIS = new Set<Api>(['openai-completions', 'openai-responses']);
const DEFAULT_DRIVER_API: Api = 'openai-completions';

/** Route `api` values that select the local CLI transport instead of HTTP. */
export const OPENCODE_CLI_APIS = new Set(['opencode-cli', 'cli', 'opencode']);

/** Providers executed locally via CLI (no key, no HTTP). */
export function isOpencodeCliProvider(providerId: string): boolean {
  return providerId === 'opencode' || providerId === 'opencode-go';
}

/** True when the route explicitly selects the CLI transport. */
export function isOpencodeCliApi(api: string | undefined): boolean {
  return !!api && OPENCODE_CLI_APIS.has(api);
}

export function buildPiDriverModel(
  connection: ResolvedModel,
  configuredApi?: string,
  routeContextWindow?: number,
): Model<Api> {
  const cliTransport = isOpencodeCliApi(configuredApi);
  if (cliTransport && !isOpencodeCliProvider(connection.providerId)) {
    throw new Error(
      `The agent slot uses CLI api ${JSON.stringify(configuredApi)} ` +
        `but model provider is "${connection.providerId}" (expected "opencode" or "opencode-go").`,
    );
  }
  // Effective pi api: the CLI aliases collapse onto the OpenAI-completions
  // shim — pi metadata only, never an HTTP transport selector here.
  const effectiveApi = cliTransport ? 'openai-completions' : configuredApi;
  if (!effectiveApi || !OPENAI_PI_APIS.has(effectiveApi)) {
    throw new Error(
      `The agent slot has unsupported pi api/dialect ` +
        `${JSON.stringify(configuredApi)} for model id ${connection.modelId}.`,
    );
  }
  return {
    id: connection.modelId,
    name: connection.modelId,
    api: effectiveApi,
    provider: connection.providerId,
    baseUrl: connection.baseUrl ?? '',
    reasoning: true,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // Context-window value chain: route operator pin > catalog model window >
    // conservative 128k fallback. The fallback is only an internal estimate
    // used to decide when to compact; it is not sent to the model API. It must
    // stay below the gateway's real request limit so compaction remains
    // reachable before the gateway rejects an oversized prompt.
    contextWindow: routeContextWindow ?? connection.modelInfo?.contextWindow ?? 128_000,
    // Pi requires Model.maxTokens. For known models this is the real catalog
    // output window. For unknown models 8192 is only a deterministic internal
    // compaction reservation; resolveAgentDriverModel deliberately exposes an
    // independent undefined wireMaxOutputTokens so it never becomes an API cap.
    maxTokens: connection.modelInfo?.outputWindow ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
  } as Model<Api>;
}

/**
 * Resolve the driver through the `agent` slot for `workspaceId` (where an
 * older deployment's translated defaults leave the agent off). The slot requires tool calling; a model the catalogue says lacks it is
 * refused. The transport dialect defaults to openai-completions.
 */
export async function resolveAgentDriverModel(workspaceId: string | null = null): Promise<{
  connection: ResolvedModel;
  piModel: Model<Api>;
  /** Catalog-backed API limit; undefined means omit max_tokens on the wire. */
  wireMaxOutputTokens?: number;
  /** Internal compaction output-space estimate; never used as a conversation API limit. */
  reservedOutputTokens: number;
  /** True when the route selects the local CLI transport (tier-3 free). */
  isCliDriver: boolean;
  /** Raw `api` value from the route (e.g. "opencode-cli" vs "openai-completions"). */
  driverApi?: string;
}> {
  const resolution = await lookupSlot('agent', workspaceId);
  if (resolution.status === 'disabled') throw new SlotDisabledError('agent');
  if (resolution.status === 'unassigned') throw new SlotUnassignedError('agent');
  if (resolution.requirements.some((check) => check.status === 'unmet')) {
    throw new Error(
      `The agent model ${resolution.modelId} does not support tool calling; choose another model for the agent.`,
    );
  }
  // Transport CLI menyalurkan thinking sebagai instruksi prompt (bukan
  // wire-param reasoning), jadi thinking.effort legal di sini. Untuk transport
  // HTTP, effort + function tools tetap dilarang (kontrak slot).
  const slotIsCliTransport =
    isOpencodeCliApi(resolution.api) || isOpencodeCliProvider(resolution.providerId);
  if (resolution.thinking?.effort !== undefined && !slotIsCliTransport) {
    throw new Error(
      `The agent slot must not set thinking.effort because ${resolution.modelId} ` +
        `cannot combine reasoning_effort with function tools on this transport. ` +
        `Remove the thinking effort from the agent slot.`,
    );
  }
  // Tombol pemilih model Pro Workbench (/workspace -> POST /api/agent/models)
  // menyimpan override global di data/agent-driver-model.json: model
  // `opencode:*` / `opencode-go:*` + varian thinking per model. Override hanya
  // berlaku bila slot menunjuk transport CLI yang gratis (provider
  // `opencode`/`opencode-go` atau api CLI): bila slot menunjuk tier ber-key
  // via HTTP, override diabaikan agar pilihan operator ber-key tidak dibajak.
  // Override di luar allowlist juga diabaikan.
  const override = readActiveModelOverride();
  if (override) {
    const input = parseOpencodeModelInput(override.modelString);
    if (input && isActivatedOpencodeId(input.bare, input.provider) && slotIsCliTransport) {
      const connection = await resolveModel({
        modelString: override.modelString,
        // Varian thinking tombol workbench menang; bila tak diset, pakai
        // thinking slot operator (bila ada) agar default operator ikut.
        thinkingConfig: override.thinking ?? resolution.thinking,
      });
      const driverApi = override.api || 'opencode-cli';
      const isCliDriver = true;
      return {
        connection,
        piModel: buildPiDriverModel(connection, driverApi, undefined),
        wireMaxOutputTokens: undefined,
        reservedOutputTokens:
          connection.modelInfo?.outputWindow ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
        isCliDriver,
        driverApi,
      };
    }
  }
  const connection = await slotLanguageModel(resolution);
  // CLI memetakan batas sampling ke instruksi prompt (bukan cap wire), jadi
  // wire tidak pernah membawa max_tokens untuk transport CLI. HTTP memakai
  // jendela output katalog sebagai batas API.
  const isCliDriver = slotIsCliTransport;
  const wireMaxOutputTokens = isCliDriver ? undefined : connection.modelInfo?.outputWindow;
  return {
    connection,
    piModel: buildPiDriverModel(
      connection,
      resolution.api ?? DEFAULT_DRIVER_API,
      resolution.contextWindow,
    ),
    wireMaxOutputTokens,
    reservedOutputTokens:
      connection.modelInfo?.outputWindow ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
    isCliDriver,
    driverApi: resolution.api,
  };
}
