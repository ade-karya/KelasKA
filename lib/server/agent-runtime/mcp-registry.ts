/**
 * In-process registry of a run's toolset, exposed to the OpenCode CLI over MCP.
 *
 * Why a registry: when the driver is served by the `opencode` CLI, the CLI owns
 * the agent loop and executes tools itself — the pi loop that normally runs
 * OpenMAIC's tools never sees a call. The CLI can, however, load MCP servers,
 * so this module publishes the run's already-assembled tools under a
 * per-run secret token; the CLI reaches them through
 * `app/api/agent/mcp/[token]` and the stdio bridge.
 *
 * The entry lives only for the duration of a run and only in the process that
 * claimed the session. Nothing here is durable, and the token is a 256-bit
 * random value: it is the whole authorization boundary for the bridge route,
 * which is why the route is exempt from the access-code cookie (a local CLI
 * process cannot hold one).
 */

import { randomBytes } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';

/** One tool as the bridge sees it (JSON Schema, MCP-compatible). */
export interface RunToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface RunToolsetEntry {
  sessionId: string;
  ownerId: string;
  attempt: number;
  createdAt: number;
  tools: AgentTool<never, never>[];
  /**
   * Emit a durable run event from inside a tool call. The harness passes the
   * runner's `emit`, so a tool that must record something (`ask_user`'s
   * `user_question`, a checkpoint) writes it into the same log the pi path
   * writes to — the transcript stays identical either way.
   */
  emit: (type: string, data: unknown) => void;
  /** Counts tool calls for the run's settlement frame. */
  onToolCall?: (toolName: string, isError: boolean) => void;
}

const REGISTRY_GLOBAL_KEY = '__openmaicRunToolsets';

/**
 * The live registry, rooted at `globalThis` instead of module scope.
 *
 * The runner (started from `instrumentation.ts`) and the bridge route can be
 * evaluated in different module graphs of the same process (observed in the
 * field: a token registered microseconds earlier 404s from the route). A
 * module-level `Map` then silently splits in two; `globalThis` is shared by
 * every graph in the process, so the entry is visible wherever it is read.
 */
function registry(): Map<string, RunToolsetEntry> {
  const holder = globalThis as unknown as Record<string, Map<string, RunToolsetEntry> | undefined>;
  return (holder[REGISTRY_GLOBAL_KEY] ??= new Map<string, RunToolsetEntry>());
}

/** Publish a run's toolset and return its token + a revoke function. */
export function registerRunToolset(entry: Omit<RunToolsetEntry, 'createdAt'>): {
  token: string;
  unregister: () => void;
} {
  const token = randomBytes(32).toString('hex');
  registry().set(token, { ...entry, createdAt: Date.now() });
  return {
    token,
    unregister: () => {
      registry().delete(token);
    },
  };
}

/** The toolset a bridge token names, or undefined for an unknown/expired token. */
export function getRunToolset(token: string): RunToolsetEntry | undefined {
  return registry().get(token);
}

/** How many runs currently publish a toolset (diagnostics only). */
export function liveToolsetCount(): number {
  return registry().size;
}

/** Tool descriptors in the MCP `tools/list` shape. */
export function listRunTools(entry: RunToolsetEntry): RunToolDescriptor[] {
  return entry.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: (tool.parameters ?? { type: 'object', properties: {} }) as Record<string, unknown>,
  }));
}

/** A tool result as the bridge relays it. */
export interface RunToolResult {
  content: { type: 'text'; text: string }[];
  isError: boolean;
  details?: unknown;
}

/**
 * Execute one tool call for a bridge request.
 *
 * Mirrors what pi does for a tool call: `prepareArguments` first (the same
 * coercion shim the loop applies), then `execute`. A throw becomes an error
 * result rather than a transport failure, so the model sees the failure and can
 * recover — exactly like a pi tool result with `isError`.
 */
export async function callRunTool(
  entry: RunToolsetEntry,
  name: string,
  args: unknown,
): Promise<RunToolResult> {
  const tool = entry.tools.find((candidate) => candidate.name === name);
  if (!tool) {
    entry.onToolCall?.(name, true);
    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }
  const toolCallId = `mcp-${randomBytes(8).toString('hex')}`;
  try {
    const prepared = tool.prepareArguments
      ? tool.prepareArguments(args ?? {})
      : ((args ?? {}) as never);
    const result = await tool.execute(toolCallId, prepared);
    const text = (result.content ?? [])
      .map((part) => (part.type === 'text' ? part.text : '[image omitted]'))
      .join('\n');
    entry.onToolCall?.(name, false);
    return {
      content: [{ type: 'text', text: text || '(no output)' }],
      isError: false,
      details: result.details,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    entry.onToolCall?.(name, true);
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}
