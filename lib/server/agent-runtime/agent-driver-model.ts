import type { Api, Model } from '@earendil-works/pi-ai';

import { getStageRoute } from '@/lib/server/model-routes';
import { resolveModel, type ResolvedModel } from '@/lib/server/resolve-model';

export const AGENT_DRIVER_STAGE = 'maic-agent-driver' as const;
export const UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS = 8_192;
// The driver route owns the model choice. This adapter only enforces its transport
// contract: a resolvable provider prefix, no thinking effort, and an explicit
// pi api/dialect. The actual HTTP transport is selected by
// lib/ai/providers.ts.
//
// CLI tier-3 transport: `opencode:*` / `opencode-go:*` models run as a local
// `opencode run` child process (lib/ai/opencode-cli.ts, pola
// nexu-io/open-design) — no HTTP, no API key. Function tools reach the model
// via the ```tool_calls envelope and the pi loop executes them, so a free Zen
// model behaves like a keyed LLM from the harness perspective (single-turn
// emit → harness executes → follow-up). The route declares this with
// `"api":"opencode-cli"` (aliases `"cli"`, `"opencode"`); internally the pi
// metadata still carries the `openai-completions` shim because pi's
// Model<Api> union has no CLI member — the StreamFn ignores that stub and
// routes through OpenMAIC's resolved Vercel LanguageModel anyway
// (see lib/agent/runtime/stream-fn.ts).
const OPENAI_PI_APIS = new Set<Api>(['openai-completions', 'openai-responses']);

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
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" uses CLI api ${JSON.stringify(configuredApi)} ` +
        `but model provider is "${connection.providerId}" (expected "opencode" or "opencode-go").`,
    );
  }
  // Effective pi api: the CLI aliases collapse onto the OpenAI-completions
  // shim — pi metadata only, never an HTTP transport selector here.
  const effectiveApi = cliTransport ? 'openai-completions' : configuredApi;
  if (!effectiveApi || !OPENAI_PI_APIS.has(effectiveApi)) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" has unsupported pi api/dialect ` +
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

/** Resolve the driver from its dedicated route; DEFAULT_MODEL is never consulted. */
export async function resolveAgentDriverModel(): Promise<{
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
  const route = getStageRoute(AGENT_DRIVER_STAGE);
  if (!route) {
    throw new Error(
      `MODEL_ROUTES must explicitly configure stage "${AGENT_DRIVER_STAGE}" ` +
        `with a provider-prefixed model id and an api/dialect.`,
    );
  }
  // The provider prefix must be explicit. parseModelString silently defaults a
  // bare model id to the openai provider, so the driver must fail here before
  // resolveModel reaches that fallback and routes to the wrong provider.
  const providerSeparator = route.model.indexOf(':');
  const modelId = providerSeparator > 0 ? route.model.slice(providerSeparator + 1) : undefined;
  if (!modelId) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" must use a model id with an explicit ` +
        `provider prefix; ` +
        `received ${JSON.stringify(route.model)}.`,
    );
  }
  if (route.thinking?.effort !== undefined) {
    throw new Error(
      `MODEL_ROUTES stage "${AGENT_DRIVER_STAGE}" must not set thinking.effort because ` +
        `${modelId} cannot combine reasoning_effort with function tools on this transport.`,
    );
  }
  const connection = await resolveModel({ stage: AGENT_DRIVER_STAGE });
  const isCliDriver = isOpencodeCliApi(route.api) || isOpencodeCliProvider(connection.providerId);
  // CLI ignores maxTokens per-call (unsupported-setting warning only): never
  // send a hard cap on the wire for the CLI transport. HTTP keeps the catalog
  // output window as the API limit.
  const wireMaxOutputTokens = isCliDriver ? undefined : connection.modelInfo?.outputWindow;
  return {
    connection,
    piModel: buildPiDriverModel(connection, route.api, route.contextWindow),
    wireMaxOutputTokens,
    reservedOutputTokens: connection.modelInfo?.outputWindow ?? UNKNOWN_MODEL_RESERVED_OUTPUT_TOKENS,
    isCliDriver,
    driverApi: route.api,
  };
}
