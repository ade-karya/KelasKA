import type { Api, Model } from '@earendil-works/pi-ai';

import { getStageRoute } from '@/lib/server/model-routes';
import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';

export const AGENT_DRIVER_STAGE = 'maic-agent-driver' as const;
export const UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS = 8_192;
// The driver route owns the model choice. This adapter only enforces its transport
// contract: a resolvable provider prefix, no thinking effort, and an explicit
// OpenAI-compatible pi api/dialect. The actual HTTP transport is selected by
// lib/ai/providers.ts.
const OPENAI_PI_APIS = new Set<Api>(['openai-completions', 'openai-responses']);

/**
 * Whether the driver model is served by the local OpenCode CLI rather than an
 * HTTP endpoint. The CLI transport (`lib/ai/opencode-model.ts`) is a full AI
 * SDK language model, so the pi-native api/dialect contract below does not
 * apply — the injected StreamFn ignores the pi-side model stub entirely (see
 * `lib/agent/runtime/build-agent.ts`) and routes through OpenMAIC's resolved
 * model instead.
 */
export function isOpencodeDriverModel(providerId: string): boolean {
  return providerId === 'opencode';
}

/**
 * pi-side model stub for CLI-served drivers. Structural sibling of STUB_MODEL
 * in `lib/agent/runtime/build-agent.ts`: never used for transport, only
 * present because pi requires *a* model object on the agent state.
 */
function buildOpencodeDriverStub(modelId: string): Model<Api> {
  return {
    id: `opencode/${modelId}`,
    name: `opencode/${modelId}`,
    api: 'unknown',
    provider: 'opencode',
    baseUrl: '',
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 8192,
  } as unknown as Model<Api>;
}

export function buildPiDriverModel(
  connection: ResolvedModel,
  configuredApi?: string,
  routeContextWindow?: number,
): Model<Api> {
  if (!configuredApi || !OPENAI_PI_APIS.has(configuredApi)) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" has unsupported pi api/dialect ` +
        `${JSON.stringify(configuredApi)} for model id ${connection.modelId}.`,
    );
  }
  return {
    id: connection.modelId,
    name: connection.modelId,
    api: configuredApi,
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

/** Resolve the driver from its dedicated route; DEFAULT_MODEL is never consulted. */
export async function resolveAgentDriverModel(opts?: {
  /**
   * Optional per-session `provider:model` pin (the Pro workbench model pick).
   * Slots into `resolveModel` exactly like a client x-model: the operator's
   * `maic-agent-driver` route still wins when set, otherwise this beats
   * DEFAULT_MODEL. There is intentionally no other fallback source.
   */
  modelString?: string;
}): Promise<{
  connection: ResolvedModel;
  piModel: Model<Api>;
  /** Catalog-backed API limit; undefined means omit max_tokens on the wire. */
  wireMaxOutputTokens?: number;
  /** Internal compaction output-space estimate; never used as a conversation API limit. */
  reservedOutputTokens: number;
}> {
  const route = getStageRoute(AGENT_DRIVER_STAGE);
  if (!route && !opts?.modelString) {
    throw new Error(
      `MODEL_ROUTES must explicitly configure stage "${AGENT_DRIVER_STAGE}" ` +
        `with a provider-prefixed model id and an api/dialect.`,
    );
  }
  // The provider prefix must be explicit. parseModelString silently defaults a
  // bare model id to the openai provider, so the driver must fail here before
  // resolveModel reaches that fallback and routes to the wrong provider.
  const effectiveModel = route?.model ?? opts?.modelString ?? '';
  const providerSeparator = effectiveModel.indexOf(':');
  const modelId = providerSeparator > 0 ? effectiveModel.slice(providerSeparator + 1) : undefined;
  if (!modelId) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" must use a model id with an explicit ` +
        `provider prefix; ` +
        `received ${JSON.stringify(effectiveModel)}.`,
    );
  }
  if (route?.thinking?.effort !== undefined) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" must not set thinking.effort because ` +
        `${modelId} cannot combine reasoning_effort with function tools on this transport.`,
    );
  }
  const connection = await resolveModel({
    stage: AGENT_DRIVER_STAGE,
    modelString: opts?.modelString,
  });
  // CLI-served drivers (today: opencode) carry no pi api/dialect — the
  // injected StreamFn routes through the resolved AI SDK model instead.
  if (isOpencodeDriverModel(connection.providerId)) {
    return {
      connection,
      piModel: buildOpencodeDriverStub(connection.modelId),
      wireMaxOutputTokens: undefined,
      reservedOutputTokens:
        connection.modelInfo?.outputWindow ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
    };
  }
  if (!route) {
    throw new Error(
      `MODEL_ROUTES must explicitly configure stage "${AGENT_DRIVER_STAGE}" ` +
        `with a provider-prefixed model id and an api/dialect.`,
    );
  }
  const wireMaxOutputTokens = connection.modelInfo?.outputWindow;
  return {
    connection,
    piModel: buildPiDriverModel(connection, route.api, route.contextWindow),
    wireMaxOutputTokens,
    reservedOutputTokens: wireMaxOutputTokens ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
  };
}
