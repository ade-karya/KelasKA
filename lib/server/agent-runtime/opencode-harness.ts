/**
 * CLI-native harness: the OpenCode CLI runs the agent loop for a session.
 *
 * Why this exists: `opencode run` never returns tool calls to its caller, so
 * the pi loop (`lib/agent/runtime/stream-fn.ts`) can never drive tools through
 * this transport. Instead the CLI is given the run's tools over MCP
 * (`lib/server/agent-runtime/mcp-registry.ts` + `scripts/opencode-mcp-bridge.mjs`)
 * and OpenMAIC consumes its event stream:
 *
 *   - text deltas      -> `message_start` / `message_update` / `message_end`
 *   - reasoning deltas -> a `thinking` content block on the same message
 *   - tool_use         -> `tool_execution_start` / `tool_execution_end`
 *   - terminal `done`  -> token usage on the persisted message; an `error`
 *                         finish settles the run failed, like the pi path
 *
 * The run's tools execute in THIS process (the MCP route calls them directly),
 * so every durable side effect a tool emits — checkpoints, stage links, library
 * changes, `user_question` — is written by the same `emit` the pi path uses.
 * The transcript is therefore identical in shape either way.
 *
 * Scope: one CLI process per run, run to completion. Mid-run steer injection is
 * not implemented; a message sent during a run is durably queued and answered by
 * the next claim, exactly like a steer that arrived after the pi loop went idle.
 */
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { join } from 'node:path';
import { jsonrepair } from 'jsonrepair';

import {
  prepareOpencodeScratchDir,
  resolveOpencodeCliPath,
  streamOpencodePrompt,
  type OpencodeToolCall,
  type OpencodeUsage,
} from '@/lib/ai/opencode-cli';
import { registerRunToolset, type RunToolsetEntry } from './mcp-registry';

/** Tool name the CLI reports for a Code Mode call that reaches our MCP tools. */
const CODE_MODE_TOOL = 'execute';
/** MCP namespace the bridge is registered under. */
export const OPENMAIC_MCP_SERVER_NAME = 'openmaic';

/**
 * The app's own base URL, as the CLI child process can reach it.
 *
 * `OPENMAIC_MCP_BASE_URL` is the explicit override for deployments where the
 * app is not on loopback; otherwise the port the server itself is listening on
 * (Next sets `PORT`; 3000 is the dev default).
 */
export function resolveOpencodeBridgeBaseUrl(): string {
  const explicit = process.env.OPENMAIC_MCP_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const port = process.env.PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

/** Absolute path of the stdio bridge script (the child's cwd is the app root). */
export function resolveOpencodeBridgeScript(): string {
  return join(process.cwd(), 'scripts', 'opencode-mcp-bridge.mjs');
}

export interface OpencodeHarnessOptions {
  /** Bare CLI model id (e.g. `nemotron-3.5-lightning-free`). */
  modelId: string;
  /** Full system prompt (the same one the pi path uses). */
  systemPrompt: string;
  /** The run's assembled tools — published over MCP, executed in this process. */
  tools: AgentTool<never, never>[];
  /** Prior transcript to seed the CLI with (pi messages; may be empty). */
  history: readonly AgentMessage[];
  /** Messages this run must answer. */
  messages: readonly AgentMessage[];
  sessionId: string;
  ownerId: string;
  attempt: number;
  /** The runner's durable event emitter. */
  emit: (type: string, data: unknown) => void;
  /** Persist a finalized assistant message into the durable entry tree. */
  persistMessage: (message: AssistantMessageLike) => Promise<void>;
  abortSignal: AbortSignal;
  /** Base URL of this app, as reachable from the CLI child process. */
  appBaseUrl: string;
  /** Explicit CLI path override; defaults to discovery. */
  cliPath?: string;
  /** Injected for tests: replaces CLI discovery. */
  resolveCliPath?: (explicitPath?: string) => string | undefined;
  /** Injected for tests: replaces the whole stream call. */
  stream?: typeof streamOpencodePrompt;
  /** Injected for tests: skips MCP registration (returns a fixed token). */
  registerToolset?: typeof registerRunToolset;
  /** Injected for tests: replaces the bridge preflight fetch. */
  fetchImpl?: typeof fetch;
}

/** Wall-clock budget for one bridge preflight attempt. */
export const OPENMAIC_BRIDGE_PREFLIGHT_TIMEOUT_MS = 8_000;

/**
 * Fail fast when the CLI child could not possibly list this run's tools.
 *
 * The bridge reaches the run's toolset over HTTP loopback into *this*
 * process (`/api/agent/mcp/<token>` against an in-process registry), and an
 * `mcp connect failed` inside the CLI is only a WARN — the run would continue
 * with none of OpenMAIC's tools and burn a full provider turn building
 * nothing. A GET here exercises the exact endpoint the bridge will call: a
 * 404 means the serving process does not hold the token (wrong
 * OPENMAIC_MCP_BASE_URL/PORT, a deployment without the route, or an app
 * restart that wiped the registry), anything else non-OK is reported as-is.
 * Exported for unit tests.
 */
export async function verifyBridgeEndpoint(
  fetchImpl: typeof fetch,
  baseUrl: string,
  token: string,
  timeoutMs = OPENMAIC_BRIDGE_PREFLIGHT_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/agent/mcp/${encodeURIComponent(token)}`;
  const describe = (cause: string): string =>
    `MCP bridge preflight failed: GET ${baseUrl.replace(/\/+$/, '')}/api/agent/mcp/${token.slice(0, 8)}… → ${cause} (runner pid ${process.pid}). ` +
    `The CLI child would not see this run's tools. Check OPENMAIC_MCP_BASE_URL (or PORT) points at this app process, ` +
    `the deployment serves /api/agent/mcp/[token], and the app did not restart (the toolset registry is in-process).`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(endpoint, { method: 'GET', signal: controller.signal });
    if (res.ok) return { ok: true };
    return { ok: false, error: describe(`HTTP ${res.status}`) };
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    return { ok: false, error: describe(cause) };
  } finally {
    clearTimeout(timer);
  }
}

/** The assistant message shape the runner persists and the fold renders. */
export interface AssistantMessageLike {
  role: 'assistant';
  content: Array<
    | { type: 'text'; text: string }
    | { type: 'thinking'; thinking: string }
    | { type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }
  >;
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  };
  stopReason: 'stop' | 'error';
  errorMessage?: string;
  timestamp: number;
}

export interface OpencodeHarnessOutcome {
  toolCalls: number;
  /** Set when the run failed; the runner settles `failed` with this message. */
  error?: string;
  /** True when a tool asked the user a question (terminal for the run). */
  questionEmitted: boolean;
}

const EMPTY_USAGE: AssistantMessageLike['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** CLI-native tool names that must never appear callable in a harness prompt. */
export const NATIVE_CLI_TOOL_NAMES = new Set([
  'read',
  'write',
  'edit',
  'shell',
  'grep',
  'glob',
  'webfetch',
  'websearch',
  'subagent',
  'skill',
  'question',
  'task',
]);

/** Render one pi message as the labeled transcript block the CLI expects. */
function renderMessage(message: AgentMessage): string {
  if (message.role === 'user') {
    const text =
      typeof message.content === 'string'
        ? message.content
        : message.content
            .map((part) => (part.type === 'text' ? part.text : ''))
            .filter(Boolean)
            .join('\n');
    return `[user]\n${text}`;
  }
  if (message.role === 'assistant') {
    const parts: string[] = [];
    for (const block of message.content) {
      if (block.type === 'text') parts.push(block.text);
      else if (block.type === 'thinking') parts.push(`[thinking]\n${block.thinking}`);
      else if (block.type === 'toolCall') {
        // A pi-transcript `read` (e.g. the skill-preload's synthesized
        // `assistant(toolCall read SKILL.md)`) rendered as `[tool call read …]`
        // teaches the CLI model a callable native tool — the field failure was
        // exactly this mimicry (native read of a repo-absolute path is declined
        // non-interactively, and the declined call aborts the whole session).
        // Demote native calls to a note; the matching toolResult below still
        // carries the loaded text (e.g. the full SKILL.md body).
        if (NATIVE_CLI_TOOL_NAMES.has(block.name)) {
          parts.push(
            `[note: a previous turn used the CLI-native "${block.name}" tool — that tool is not available here; use tools.openmaic[...] instead]`,
          );
        } else {
          parts.push(
            `[tool call ${block.name} ${block.id}]\n${
              typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)
            }`,
          );
        }
      }
    }
    return `[assistant]\n${parts.filter(Boolean).join('\n')}`;
  }
  // toolResult
  const toolName = message.toolName;
  const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  // A native-labeled result (e.g. a preloaded SKILL.md body) is reference text,
  // not an invitation: relabel so no callable `[tool … read …]` shape remains.
  // The durable transcript is untouched — this string only seeds the CLI run.
  if (NATIVE_CLI_TOOL_NAMES.has(toolName)) return `[reference text]\n${text}`;
  return `[tool result ${toolName} ${message.toolCallId}]\n${text}`;
}

/**
 * Render the whole CLI prompt: the system prompt plus the conversation, in the
 * same labeled format `opencodePromptToText` produces (proven against the CLI).
 */
export function renderHarnessPrompt(
  systemPrompt: string,
  history: readonly AgentMessage[],
  messages: readonly AgentMessage[],
): string {
  const sections = [`[system]\n${systemPrompt}`];
  for (const message of [...history, ...messages]) sections.push(renderMessage(message));
  return sections.join('\n\n');
}

/**
 * CLI-specific augmentation of the runner system prompt.
 *
 * The CLI owns its agent loop and, on this build, reaches MCP tools only
 * through Code Mode — none of that is in the pi-oriented prompt, so without
 * this the model uses the CLI's native tools and narrates stage plans as text
 * instead of building them with tools. The ban has teeth: a declined native
 * call (e.g. `read` of a repo-absolute path, declined non-interactively)
 * aborts the whole session with `Session interrupted: shutdown`.
 */
export function buildCliHarnessSystemPrompt(
  systemPrompt: string,
  toolNames: readonly string[] = [],
): string {
  const inventory = toolNames.length
    ? `Your tools (and ONLY these — there is no other tool): ${toolNames.join(', ')}. `
    : '';
  const example = toolNames.length
    ? `e.g. return await tools.openmaic["${toolNames[0]}"]({ ... }) with a JSON object argument. `
    : '';
  return (
    `${systemPrompt}\n\n[opencode CLI harness — read this first]\n` +
    `- Your OpenMAIC tools live on the MCP server "openmaic" and are reachable ONLY through ` +
    `Code Mode. Call them with the execute tool. ${example}${inventory}\n` +
    `- NEVER call a CLI built-in tool (read, shell, write, edit, grep, glob, ` +
    `webfetch, websearch, subagent, skill, task, question). A single native call ` +
    `fails the entire run: declined native calls abort the session, destroying ` +
    `everything built so far.\n` +
    `- Skill texts appearing in this prompt are already complete — NEVER re-read a ` +
    `SKILL.md or any repo path. The session directory is an empty scratch dir; ` +
    `absolute repo paths do not exist here.\n` +
    `- To ask the user anything, call tools.openmaic["ask_user"] — a question ends ` +
    `your turn, so stop after asking.\n` +
    `- Build the stage with tools (create_stage, then set_roster, then one generate_scene ` +
    `per settled page in order, then list_scenes to verify). Describing the plan in text ` +
    `without calling the tools leaves the classroom empty.`
  );
}

/**
 * Recover the OpenMAIC tool call a Code Mode `execute` step made.
 *
 * On this CLI build MCP tools are only reachable through Code Mode, so the
 * model's step arrives as `execute` with JavaScript in `input.code`. The
 * transcript should name the real tool (`create_stage`, `generate_scene`, …)
 * — the fold keys page-in-progress state and the tool cards off that name.
 * A code step that does not resolve to exactly one namespace call stays
 * `execute` with its code as the arguments.
 */
export function extractOpenmaicCall(
  toolCall: OpencodeToolCall,
): { name: string; args: Record<string, unknown> } | null {
  if (toolCall.name !== CODE_MODE_TOOL) return null;
  const code = (toolCall.input as { code?: unknown } | undefined)?.code;
  if (typeof code !== 'string') return null;
  const call = new RegExp(
    `tools\\.${OPENMAIC_MCP_SERVER_NAME}\\[?["']([A-Za-z0-9_-]+)["']\\]?\\s*\\(`,
  ).exec(code);
  if (!call) return null;
  const name = call[1];
  const start = code.indexOf('(', call.index + call[0].length - 1);
  if (start < 0) return { name, args: {} };
  const args = parseObjectLiteral(code.slice(start + 1));
  return { name, args: args ?? { code } };
}

/**
 * Resolve the transcript name for a CLI-reported tool call against the run's
 * known tools. Exported for unit tests.
 *
 * Code Mode steps (`execute` carrying `tools.openmaic["<tool>"](...)`) go
 * through {@link extractOpenmaicCall}. Newer CLI builds honor
 * `codemode: false` and report first-class MCP calls namespaced by server
 * (`openmaic_create_stage`, `openmaic.create_stage`); when the suffix matches
 * a run tool, the transcript uses the bare tool name so the fold's tool cards
 * behave exactly like the pi path. Anything unrecognized stays verbatim —
 * the transcript must never invent a tool the run did not call.
 */
export function resolveHarnessToolName(
  reportedName: string,
  knownToolNames: readonly string[],
): string {
  if (knownToolNames.includes(reportedName)) return reportedName;
  const namespaced = new RegExp(`^${OPENMAIC_MCP_SERVER_NAME}[_.:-](.+)$`).exec(reportedName);
  if (namespaced && knownToolNames.includes(namespaced[1])) return namespaced[1];
  return reportedName;
}

/**
 * Map a CLI `step_finish` token report onto the persisted assistant usage.
 * Missing counters default to zero (unit-test `done` fixtures carry `{}`).
 */
export function toHarnessUsage(usage: Partial<OpencodeUsage>): AssistantMessageLike['usage'] {
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadTokens ?? 0;
  const cacheWrite = usage.cacheWriteTokens ?? 0;
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/**
 * Is a repaired object plausibly what the literal said?
 *
 * `jsonrepair` is deliberately forgiving — on `{ path: "/x", value: fn() }` it
 * happily produced `{ path: "/x", value: ")" }`. A silently WRONG argument is
 * worse than an unparsed one, so every key and string value must actually
 * appear in the source literal before the repair is trusted.
 */
function isPlausibleRepair(literal: string, repaired: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(repaired)) {
    const keyPattern = new RegExp(`(?:^|[{,\\s])["'\`]?${escapeRegExp(key)}["'\`]?\\s*:`);
    if (!keyPattern.test(literal)) return false;
    if (typeof value === 'string') {
      if (!literal.includes(`"${value}"`) && !literal.includes(`'${value}'`)) return false;
    } else if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (
            typeof item === 'string' &&
            !literal.includes(`"${item}"`) &&
            !literal.includes(`'${item}'`)
          ) {
            return false;
          }
        }
      } else if (!isPlausibleRepair(literal, value as Record<string, unknown>)) {
        return false;
      }
    }
  }
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a JS object literal starting at `source[0] === '{'`.
 *
 * The model writes the arguments as a JS literal (unquoted keys, single quotes,
 * trailing commas), so plain `JSON.parse` is not enough and `eval` is not an
 * option — the text comes from a model. `jsonrepair` (already a dependency for
 * LLM output) closes the gap, guarded by {@link isPlausibleRepair}; a literal
 * that cannot be trusted falls back to the raw code, which is still honest to
 * render.
 */
function parseObjectLiteral(source: string): Record<string, unknown> | null {
  const trimmed = source.trimStart();
  if (!trimmed.startsWith('{')) return null;
  let depth = 0;
  let inString: string | null = null;
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === inString) inString = null;
      continue;
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      continue;
    }
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const literal = trimmed.slice(0, i + 1);
        try {
          const repaired = JSON.parse(jsonrepair(literal)) as Record<string, unknown>;
          return isPlausibleRepair(literal, repaired) ? repaired : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Run one CLI-native agent turn to completion.
 *
 * Emits the same durable frames the pi harness emits, so the workbench fold,
 * the event log and the entry tree cannot tell which harness ran a session.
 */
export async function runOpencodeHarness(
  options: OpencodeHarnessOptions,
): Promise<OpencodeHarnessOutcome> {
  const stream = options.stream ?? streamOpencodePrompt;
  const register = options.registerToolset ?? registerRunToolset;
  const resolveCli = options.resolveCliPath ?? resolveOpencodeCliPath;
  // The resolver owns existence checking (it scans the explicit path, PATH and
  // the documented install dir), so a resolved path is a usable one.
  const cliPath = resolveCli(options.cliPath);
  if (!cliPath) {
    return {
      toolCalls: 0,
      questionEmitted: false,
      error:
        'OpenCode CLI provider is selected but no `opencode` binary was found. ' +
        'Install it (see https://opencode.ai) or set OPENCODE_CLI_PATH to its location.',
    };
  }

  let questionEmitted = false;
  let toolCalls = 0;
  const toolset: Omit<RunToolsetEntry, 'createdAt'> = {
    sessionId: options.sessionId,
    ownerId: options.ownerId,
    attempt: options.attempt,
    tools: options.tools,
    emit: (type, data) => {
      if (type === 'user_question') questionEmitted = true;
      options.emit(type, data);
    },
    onToolCall: () => {
      toolCalls += 1;
    },
  };
  const { token, unregister } = register(toolset);
  // Run the CLI with its git snapshot/watcher machinery pointed at a scratch
  // directory, never at the app checkout (exit-1 "Session interrupted:
  // shutdown" runs in the field all carried --work-tree /content/KelasKA).
  const scratch = prepareOpencodeScratchDir();
  const releaseRunResources = () => {
    unregister();
    scratch.cleanup();
  };

  // The bridge lists this run's tools over HTTP loopback; when that endpoint
  // is unreachable the CLI only warns and runs tool-less. Fail here instead
  // of burning a provider turn that cannot build anything.
  const preflight = await verifyBridgeEndpoint(
    options.fetchImpl ?? fetch,
    options.appBaseUrl,
    token,
  );
  if (!preflight.ok) {
    releaseRunResources();
    return { toolCalls, questionEmitted, error: preflight.error };
  }

  const assistant: AssistantMessageLike = {
    role: 'assistant',
    content: [],
    api: 'unknown',
    provider: 'unknown',
    model: `opencode/${options.modelId}`,
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };

  /** The single text block of this turn, mirroring pi's one-block-per-stream. */
  const textBlock = { type: 'text' as const, text: '' };
  let textPushed = false;
  /** The thinking block, in arrival order relative to the text block. */
  const thinkingBlock = { type: 'thinking' as const, thinking: '' };
  let thinkingPushed = false;
  let messageStarted = false;
  /** Set when the terminal `done` reports an `error` finish. */
  let terminalError: string | undefined;
  let lastUpdateAt = 0;
  const emitUpdate = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastUpdateAt < 150) return;
    lastUpdateAt = now;
    options.emit('message_update', { message: { ...assistant } });
  };
  const ensureMessageStarted = (): void => {
    if (!messageStarted) {
      messageStarted = true;
      options.emit('message_start', { message: { ...assistant } });
    }
  };

  try {
    const knownToolNames = options.tools.map((tool) => tool.name);
    const events = stream({
      cliPath,
      modelId: options.modelId,
      prompt: renderHarnessPrompt(
        buildCliHarnessSystemPrompt(
          options.systemPrompt,
          options.tools.map((tool) => tool.name),
        ),
        options.history,
        options.messages,
      ),
      thinking: true,
      abortSignal: options.abortSignal,
      cwd: scratch.dir,
      lockBuiltinTools: true,
      mcpServers: [
        {
          name: OPENMAIC_MCP_SERVER_NAME,
          command: ['node', resolveOpencodeBridgeScript()],
          environment: {
            OPENMAIC_MCP_URL: options.appBaseUrl,
            OPENMAIC_MCP_TOKEN: token,
          },
          // First-class tools exist only on CLI builds newer than the pinned
          // v2.0.15; on this build the field is ignored and tools stay
          // reachable through Code Mode `execute`. Either shape maps to the
          // same transcript below.
          codemode: false,
        },
      ],
    });

    for await (const event of events) {
      if (event.kind === 'reasoning-delta') {
        if (!thinkingPushed) {
          thinkingPushed = true;
          assistant.content.push(thinkingBlock);
          ensureMessageStarted();
        }
        thinkingBlock.thinking += event.delta;
        emitUpdate();
        continue;
      }
      if (event.kind === 'text-delta') {
        if (!textPushed) {
          textPushed = true;
          assistant.content.push(textBlock);
          ensureMessageStarted();
        }
        textBlock.text += event.delta;
        emitUpdate();
        continue;
      }
      if (event.kind === 'done') {
        // The terminal completion carries the run's token report (the pi
        // path records the same via onFinish) and its real finish reason.
        assistant.usage = toHarnessUsage(event.completion.usage ?? {});
        if (event.completion.finishReason === 'error') {
          terminalError =
            event.completion.errorMessage?.trim() ||
            `opencode CLI run failed for model "${options.modelId}"`;
          assistant.stopReason = 'error';
          assistant.errorMessage = terminalError;
        }
        continue;
      }
      if (event.kind !== 'tool') continue;

      // The CLI reports a call once, already completed: the transcript gets the
      // start+end pair in one step so the fold's card lifecycle is unchanged.
      const mapped = extractOpenmaicCall(event.tool);
      const reportedName = mapped?.name ?? event.tool.name;
      const toolName = mapped ? reportedName : resolveHarnessToolName(reportedName, knownToolNames);
      const toolArgs = mapped?.args ?? (event.tool.input as Record<string, unknown>) ?? {};
      const toolCallId = event.tool.id ?? `cli-${toolName}-${toolCalls}`;
      const isError = event.tool.status === 'error';
      assistant.content.push({
        type: 'toolCall',
        id: toolCallId,
        name: toolName,
        arguments: toolArgs,
      });
      options.emit('tool_execution_start', { toolCallId, toolName, args: toolArgs });
      options.emit('tool_execution_end', {
        toolCallId,
        toolName,
        isError,
        result: {
          content: [{ type: 'text', text: event.tool.output ?? '' }],
          details: undefined,
        },
      });
      if (!textPushed && !thinkingPushed) {
        // A tool card before any text: the turn still owns an assistant frame.
        textPushed = true;
        assistant.content.push(textBlock);
        ensureMessageStarted();
      }
      emitUpdate(true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assistant.stopReason = 'error';
    assistant.errorMessage = message;
    if (messageStarted || assistant.content.length > 0) {
      options.emit('message_end', { message: { ...assistant } });
      await options.persistMessage(assistant).catch(() => undefined);
    }
    releaseRunResources();
    return { toolCalls, questionEmitted, error: message };
  }

  // A CLI-reported `error` finish (exit 0 with an error event) settles the
  // run failed with the real cause — the pi path settles its own stream
  // errors the same way instead of recording an empty success.
  if (terminalError) {
    if (messageStarted || assistant.content.length > 0) {
      emitUpdate(true);
      options.emit('message_end', { message: { ...assistant } });
      await options.persistMessage(assistant).catch(() => undefined);
    }
    releaseRunResources();
    return { toolCalls, questionEmitted, error: terminalError };
  }

  assistant.timestamp = Date.now();
  if (!messageStarted && assistant.content.length === 0) {
    // Nothing was produced: no assistant frame at all, exactly like an empty pi
    // turn. The runner settles on its own bookkeeping.
    releaseRunResources();
    return { toolCalls, questionEmitted };
  }
  emitUpdate(true);
  options.emit('message_end', { message: { ...assistant } });
  await options.persistMessage(assistant);
  releaseRunResources();
  return { toolCalls, questionEmitted };
}
