/**
 * CLI-native harness: the OpenCode CLI runs the agent loop for a session.
 *
 * Why this exists: `opencode run` never returns tool calls to its caller, so
 * the pi loop (`lib/agent/runtime/stream-fn.ts`) can never drive tools through
 * this transport. Instead the CLI is given the run's tools over MCP
 * (`lib/server/agent-runtime/mcp-registry.ts` + `scripts/opencode-mcp-bridge.mjs`)
 * and OpenMAIC consumes its event stream:
 *
 *   - text deltas   -> `message_start` / `message_update` / `message_end`
 *   - tool_use      -> `tool_execution_start` / `tool_execution_end`
 *   - terminal      -> the runner's own settlement (session_end) as before
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
        parts.push(
          `[tool call ${block.name} ${block.id}]\n${
            typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments)
          }`,
        );
      }
    }
    return `[assistant]\n${parts.filter(Boolean).join('\n')}`;
  }
  // toolResult
  const text = message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
  return `[tool result ${message.toolName} ${message.toolCallId}]\n${text}`;
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
 * this the model uses the CLI's native `question`/`write`/`shell` tools
 * (acting on the server checkout) and narrates stage plans as text instead
 * of building them with tools.
 */
export function buildCliHarnessSystemPrompt(systemPrompt: string): string {
  return (
    `${systemPrompt}\n\n[opencode CLI harness — read this first]\n` +
    `- Your OpenMAIC tools live on the MCP server "openmaic" and are reachable ONLY through ` +
    `Code Mode. Call them with the execute tool, e.g. ` +
    `return await tools.openmaic["generate_scene"]({ title: "...", type: "slide", brief: "..." }). ` +
    `First run search({}) if you need the exact call shape.\n` +
    `- Never use the CLI built-in tools (question, read, write, edit, shell, grep, glob, ` +
    `webfetch, websearch, subagent, skill, task); they are disabled. To ask the user ` +
    `anything, call tools.openmaic["ask_user"] — a question ends your turn, so stop after asking.\n` +
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
  let textStarted = false;
  let lastUpdateAt = 0;
  const emitUpdate = (force = false): void => {
    const now = Date.now();
    if (!force && now - lastUpdateAt < 150) return;
    lastUpdateAt = now;
    options.emit('message_update', { message: { ...assistant } });
  };

  try {
    const events = stream({
      cliPath,
      modelId: options.modelId,
      prompt: renderHarnessPrompt(
        buildCliHarnessSystemPrompt(options.systemPrompt),
        options.history,
        options.messages,
      ),
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
          // reachable through Code Mode `execute`.
          codemode: false,
        },
      ],
    });

    for await (const event of events) {
      if (event.kind === 'text-delta') {
        if (!textStarted) {
          textStarted = true;
          assistant.content.push(textBlock);
          options.emit('message_start', { message: { ...assistant } });
        }
        textBlock.text += event.delta;
        emitUpdate();
        continue;
      }
      if (event.kind !== 'tool') continue;

      // The CLI reports a call once, already completed: the transcript gets the
      // start+end pair in one step so the fold's card lifecycle is unchanged.
      const mapped = extractOpenmaicCall(event.tool);
      const toolName = mapped?.name ?? event.tool.name;
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
      if (!textStarted) {
        // A tool card before any text: the turn still owns an assistant frame.
        textStarted = true;
        options.emit('message_start', { message: { ...assistant } });
      }
      emitUpdate(true);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assistant.stopReason = 'error';
    assistant.errorMessage = message;
    if (textStarted || assistant.content.length > 0) {
      options.emit('message_end', { message: { ...assistant } });
      await options.persistMessage(assistant).catch(() => undefined);
    }
    releaseRunResources();
    return { toolCalls, questionEmitted, error: message };
  }

  assistant.timestamp = Date.now();
  if (!textStarted && assistant.content.length === 0) {
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
