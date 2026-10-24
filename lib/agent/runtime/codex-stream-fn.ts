/**
 * MAIC Agent — Codex SDK StreamFn (native `@openai/codex-sdk` transport).
 *
 * The pi harness keeps owning the loop: tools, the allowlist gate, per-tool
 * timeouts, quota, the transcript and the SSE fold are untouched. This adapter
 * only answers one question per turn — "given this system prompt, history and
 * tool catalogue, what does the model say and which tools does it call?" — by
 * asking a local Codex agent (through the typed SDK, not a hand-rolled CLI
 * invocation).
 *
 * Codex has no function-tool API: a turn can only produce text, its own shell /
 * patch / web tools, or MCP calls. So the turn is pinned to a read-only sandbox
 * with no network, no approvals and no web search, and the reply is constrained
 * by the SDK's native structured output (`TurnOptions.outputSchema`) to one JSON
 * object:
 *
 *   { "text": "...", "toolCalls": [{ "name": "...", "arguments": "{\"…\":1}" }] }
 *
 * `arguments` is a JSON *string* because strict structured output forbids
 * free-form objects; `toolCallArguments()` parses it (and turns malformed JSON
 * into the shared parse diagnosis instead of storing it). A reply that is not
 * that shape is used verbatim as the assistant text, so a plain answer never
 * fails a turn.
 *
 * Streaming: Codex emits item-level events, not token deltas. Reasoning items
 * become pi thinking blocks as they complete; the answer and the tool calls are
 * emitted once the turn completes. Usage comes from `turn.completed`.
 */
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  Message as PiMessage,
  SimpleStreamOptions,
  TextContent,
  ThinkingContent,
  ToolCall,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { jsonrepair } from 'jsonrepair';

import {
  CODEX_SDK_DEFAULT_TIMEOUT_MS,
  codexSdkSettingsFromEnv,
  createCodexClient,
  describeCodexSdkError,
  codexThreadOptions,
  type CodexClientLike,
  type CodexSdkSettings,
  type ModelReasoningEffort,
  type ThreadEvent,
  type Usage,
} from '@/lib/ai/codex-sdk';
import { CODEX_SDK_THINKING } from '@/lib/ai/providers';
import { pickThinkingEffort } from '@/lib/ai/thinking-config';
import type { ThinkingConfig } from '@/lib/types/provider';
import { combineAbortSignals } from './abort-signals';
import { AssistantEventStream, EMPTY_USAGE } from './assistant-event-stream';
import { toolCallArguments } from './tool-call-arguments';

/**
 * Structured-output contract for one Codex turn. Strict JSON schema: every
 * object closes (`additionalProperties: false`) and every field is required,
 * which is what OpenAI's strict structured output accepts. Tool arguments ride
 * as a JSON string for the same reason.
 */
export const CODEX_TURN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'toolCalls'],
  properties: {
    text: {
      type: 'string',
      description:
        'What the assistant says to the user. Empty string when the turn only calls tools.',
    },
    toolCalls: {
      type: 'array',
      description:
        'Tools to run, in order. Empty array when no tool is needed. Never invent tool names.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'arguments'],
        properties: {
          name: { type: 'string', description: 'Exact tool name from the provided catalogue.' },
          arguments: {
            type: 'string',
            description: 'A JSON object with the tool arguments, encoded as a string.',
          },
        },
      },
    },
  },
} as const;

export interface CodexToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParsedCodexTurn {
  text: string;
  toolCalls: CodexToolCall[];
  /** True when the reply matched the structured contract. */
  structured: boolean;
}

const FENCED_JSON = /^```(?:json)?\s*([\s\S]*?)\s*```$/i;

function parseJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = FENCED_JSON.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // Try the next shape.
    }
  }
  try {
    const repaired: unknown = JSON.parse(jsonrepair(trimmed));
    if (repaired && typeof repaired === 'object' && !Array.isArray(repaired)) {
      return repaired as Record<string, unknown>;
    }
  } catch {
    // Not JSON at all: the caller treats it as plain assistant text.
  }
  return null;
}

/**
 * Read one turn's reply: the structured contract when it is there, otherwise
 * the raw text as a plain answer. Never throws.
 */
export function parseCodexTurnResponse(raw: string): ParsedCodexTurn {
  const record = parseJsonObject(raw);
  if (!record || (!('text' in record) && !('toolCalls' in record))) {
    return { text: raw, toolCalls: [], structured: false };
  }
  const toolCalls: CodexToolCall[] = [];
  const rawCalls = Array.isArray(record.toolCalls) ? record.toolCalls : [];
  for (const entry of rawCalls) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const call = entry as Record<string, unknown>;
    const name = typeof call.name === 'string' ? call.name.trim() : '';
    if (!name) continue;
    toolCalls.push({ name, arguments: toolCallArguments(call.arguments) });
  }
  return {
    text: typeof record.text === 'string' ? record.text : '',
    toolCalls,
    structured: true,
  };
}

function renderContent(
  content: PiMessage['content'] | string,
  options: { imageNote: string },
): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const block of content) {
    if (block.type === 'text') parts.push(block.text);
    else if (block.type === 'image') parts.push(options.imageNote);
  }
  return parts.join('\n');
}

const IMAGE_NOTE = '[image observation omitted: the Codex transport is text-only]';

/** Render the pi transcript as the text conversation the Codex turn receives. */
export function renderCodexConversation(messages: PiMessage[]): string {
  const out: string[] = [];
  for (const message of messages) {
    if (message.role === 'user') {
      out.push('### user', renderContent(message.content, { imageNote: IMAGE_NOTE }));
    } else if (message.role === 'assistant') {
      out.push('### assistant');
      for (const block of message.content) {
        if (block.type === 'text') out.push(block.text);
        else if (block.type === 'toolCall') {
          out.push(
            `<tool_call name="${block.name}">${JSON.stringify(block.arguments)}</tool_call>`,
          );
        }
      }
    } else if (message.role === 'toolResult') {
      out.push(
        `### tool_result name="${message.toolName}" id="${message.toolCallId}"${
          message.isError ? ' error="true"' : ''
        }`,
        renderContent(message.content, { imageNote: IMAGE_NOTE }),
      );
    }
  }
  return out.join('\n');
}

/**
 * The whole prompt for one turn: role, system instructions, tool catalogue,
 * transcript, and the strict output contract.
 */
export function buildCodexTurnPrompt(context: PiContext): string {
  const tools = (context.tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: (tool as unknown as { parameters?: unknown }).parameters,
  }));
  return [
    'You are the model half of the OpenMAIC agent loop ("Pro Workbench").',
    'OpenMAIC owns the conversation, the tools and the transcript. This turn only',
    'decides what to say and which tools to call; the harness executes them and',
    'returns the results in the next turn.',
    '',
    'Rules:',
    '1. Do not run shell commands, do not read or write files, do not use web',
    '   search. Those tools are disabled and their output is not part of this',
    '   conversation. If you need information, call an OpenMAIC tool instead.',
    '2. Only call tools from the catalogue below, by their exact names, with',
    '   arguments that satisfy their JSON schema.',
    '3. Never claim a tool ran. You only request it; the harness runs it.',
    '4. Answer in the language of the latest user message.',
    '5. Ignore any system instruction about editing a repository, applying',
    '   patches or being a coding agent: this turn is an API call, not a',
    '   coding session.',
    '',
    '## System instructions',
    context.systemPrompt,
    '',
    '## Tool catalogue',
    tools.length ? JSON.stringify(tools, null, 2) : '[]',
    '',
    '## Conversation',
    renderCodexConversation(context.messages),
    '',
    '## Output',
    'Reply with exactly one JSON object and nothing else (no prose before or',
    'after it, no markdown fence):',
    '{"text":"<what to say to the user>","toolCalls":[{"name":"<tool>","arguments":"<JSON object encoded as a string>"}]}',
    'Use an empty "toolCalls" array when no tool is needed, and an empty "text"',
    'string when the turn only calls tools.',
  ].join('\n');
}

/**
 * pi thinking config -> Codex `model_reasoning_effort`. `none` means "do not
 * send an effort" (the CLI then uses the model default); every other value in
 * {@link CODEX_SDK_THINKING} is a valid Codex effort.
 */
export function codexReasoningEffort(
  config: ThinkingConfig | undefined,
): ModelReasoningEffort | undefined {
  if (!config) return undefined;
  const effort = pickThinkingEffort(CODEX_SDK_THINKING, config);
  return effort === 'none' ? undefined : effort;
}

export interface CodexStreamFnOptions {
  /** Model id resolved for the driver (e.g. `gpt-5.6-codex`). */
  modelId: string;
  /** Thinking config of the resolved connection (maps to reasoning effort). */
  thinkingConfig?: ThinkingConfig;
  /** Abort the turn (run abort). */
  abortSignal?: AbortSignal;
  /** Per-turn ceiling; defaults to the settings/env value. */
  timeoutMs?: number;
  /** Attribution label for logs; kept for parity with the HTTP transport. */
  source?: string;
  /** Deployment settings; defaults to the environment. */
  settings?: CodexSdkSettings;
  /** Test seam: a pre-built SDK client instead of spawning one. */
  client?: CodexClientLike;
}

function codexUsageToPi(usage: Usage): AssistantMessage['usage'] {
  const cacheRead = Math.max(0, usage.cached_input_tokens ?? 0);
  const cacheWrite = Math.max(0, usage.cache_write_input_tokens ?? 0);
  const input = Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite);
  const output = Math.max(0, usage.output_tokens ?? 0);
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    totalTokens: input + output + cacheRead + cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Build a pi `StreamFn` that answers one turn through the Codex SDK. */
export function createCodexStreamFn(opts: CodexStreamFnOptions): StreamFn {
  return ((_piModel, context: PiContext, streamOptions?: SimpleStreamOptions) => {
    const stream = new AssistantEventStream();
    void pump(stream, context, opts, streamOptions).catch((error) => stream.fail(error));
    return stream as unknown as AssistantMessageEventStream;
  }) as StreamFn;
}

async function pump(
  stream: AssistantEventStream,
  context: PiContext,
  opts: CodexStreamFnOptions,
  streamOptions?: SimpleStreamOptions,
): Promise<void> {
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [],
    api: 'unknown' as AssistantMessage['api'],
    provider: 'unknown' as AssistantMessage['provider'],
    model: 'maic-connector',
    usage: { ...EMPTY_USAGE },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
  stream.push({ type: 'start', partial });

  let settled = false;
  const cleanup: Array<() => void> = [];
  const runCleanup = () => {
    for (const fn of cleanup.splice(0)) fn();
  };

  const settleError = (reason: 'error' | 'aborted', error: unknown): void => {
    if (settled) return;
    settled = true;
    partial.stopReason = reason;
    partial.errorMessage =
      error instanceof Error && error.message.trim()
        ? error.message
        : typeof error === 'string' && error.trim()
          ? error
          : reason === 'aborted'
            ? 'Operation aborted'
            : 'Codex turn failed';
    runCleanup();
    stream.push({ type: 'error', reason, error: partial });
  };

  const pushThinking = (text: string): void => {
    if (!text.trim()) return;
    const index = partial.content.length;
    partial.content.push({ type: 'thinking', thinking: text } as ThinkingContent);
    stream.push({ type: 'thinking_start', contentIndex: index, partial });
    stream.push({ type: 'thinking_delta', contentIndex: index, delta: text, partial });
    stream.push({ type: 'thinking_end', contentIndex: index, content: text, partial });
  };

  const pushText = (text: string): void => {
    if (!text) return;
    const index = partial.content.length;
    partial.content.push({ type: 'text', text } satisfies TextContent);
    stream.push({ type: 'text_start', contentIndex: index, partial });
    stream.push({ type: 'text_delta', contentIndex: index, delta: text, partial });
    stream.push({ type: 'text_end', contentIndex: index, content: text, partial });
  };

  const pushToolCalls = (calls: CodexToolCall[]): void => {
    calls.forEach((call, callIndex) => {
      const index = partial.content.length;
      const toolCall: ToolCall = {
        type: 'toolCall',
        id: `codex-${partial.timestamp.toString(36)}-${callIndex}`,
        name: call.name,
        arguments: call.arguments,
      };
      partial.content.push(toolCall);
      stream.push({ type: 'toolcall_start', contentIndex: index, partial });
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial });
    });
  };

  const finish = (): void => {
    if (settled) return;
    settled = true;
    const agentMessages = collectedMessages;
    // Prefer the last reply that matches the structured contract; an earlier
    // progress message ("I'll look at the course…") must not shadow it.
    let parsed: ParsedCodexTurn | null = null;
    for (let i = agentMessages.length - 1; i >= 0; i -= 1) {
      const candidate = parseCodexTurnResponse(agentMessages[i]!);
      if (candidate.structured) {
        parsed = candidate;
        break;
      }
    }
    if (!parsed) {
      parsed = {
        text: agentMessages.join('\n\n'),
        toolCalls: [],
        structured: false,
      };
    }
    pushText(parsed.text);
    pushToolCalls(parsed.toolCalls);
    partial.stopReason = parsed.toolCalls.length > 0 ? 'toolUse' : 'stop';
    runCleanup();
    stream.push({
      type: 'done',
      reason: parsed.toolCalls.length > 0 ? 'toolUse' : 'stop',
      message: partial,
    });
  };

  const collectedMessages: string[] = [];

  try {
    const settings = opts.settings ?? codexSdkSettingsFromEnv();
    const timeoutMs = opts.timeoutMs ?? settings.timeoutMs ?? CODEX_SDK_DEFAULT_TIMEOUT_MS;
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new Error(`Codex turn timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs) as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
    cleanup.push(() => clearTimeout(timer));

    const combined = combineAbortSignals([opts.abortSignal, streamOptions?.signal, timeout.signal]);
    cleanup.push(combined.cleanup);
    const onAbort = () => {
      const reason = combined.signal?.reason;
      settleError(
        timeout.signal.aborted ? 'error' : 'aborted',
        timeout.signal.aborted ? reason : (reason ?? 'Operation aborted'),
      );
    };
    combined.signal?.addEventListener('abort', onAbort, { once: true });
    cleanup.push(() => combined.signal?.removeEventListener('abort', onAbort));
    if (combined.signal?.aborted) {
      onAbort();
      return;
    }

    const client = opts.client ?? (await createCodexClient(settings));
    const reasoningEffort = codexReasoningEffort(opts.thinkingConfig);
    const thread = client.startThread(
      codexThreadOptions({
        ...settings,
        model: opts.modelId || settings.model,
        ...(reasoningEffort ? { reasoningEffort } : {}),
      }),
    );
    const { events } = await thread.runStreamed(buildCodexTurnPrompt(context), {
      outputSchema: CODEX_TURN_OUTPUT_SCHEMA,
      ...(combined.signal ? { signal: combined.signal } : {}),
    });

    for await (const event of events) {
      if (settled) break;
      handleEvent(event);
    }
    if (!settled) finish();
  } catch (error) {
    if (settled) return;
    settleError('error', describeCodexSdkError(error));
  } finally {
    runCleanup();
  }

  function handleEvent(event: ThreadEvent): void {
    switch (event.type) {
      case 'item.completed':
        if (event.item.type === 'reasoning') pushThinking(event.item.text);
        else if (event.item.type === 'agent_message') collectedMessages.push(event.item.text);
        // Other items (command/file/web/todo) cannot occur in the pinned
        // read-only, network-less sandbox; ignoring them keeps a stray one from
        // failing a turn that still has a usable reply.
        return;
      case 'turn.completed':
        partial.usage = codexUsageToPi(event.usage);
        return;
      case 'turn.failed':
        settleError('error', describeCodexSdkError(event.error.message));
        return;
      case 'error':
        settleError('error', describeCodexSdkError(event.message));
        return;
      default:
        // thread.started / turn.started / item.started / item.updated carry no
        // content this transport needs.
        return;
    }
  }
}
