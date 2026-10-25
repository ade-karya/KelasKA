/**
 * MAIC Agent — Antigravity SDK StreamFn (local Python transport).
 *
 * The pi harness keeps owning the loop: tools, the allowlist gate, per-tool
 * timeouts, quota, the transcript and the SSE fold are untouched. This adapter
 * only answers one question per turn — "given this system prompt, history and
 * tool catalogue, what does the model say and which tools does it call?" — by
 * asking the local Antigravity SDK through `lib/ai/antigravity-sdk.ts`.
 *
 * Antigravity is a full agent, so its built-in tools are disabled except
 * `finish`; the reply is constrained by the SDK's structured output (response
 * schema) to one JSON object:
 *
 *   { "text": "...", "toolCalls": [{ "name": "...", "arguments": "{\"…\":1}" }] }
 *
 * `arguments` is a JSON *string* because strict structured output forbids
 * free-form objects; `toolCallArguments()` parses it (and turns malformed JSON
 * into the shared parse diagnosis instead of storing it). A reply that is not
 * that shape is used verbatim as the assistant text, so a plain answer never
 * fails a turn.
 *
 * Streaming: the bridge returns one completed answer, not token deltas, so the
 * text and tool calls are emitted once the turn completes (the same shape as
 * the Codex transport).
 */
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context as PiContext,
  Message as PiMessage,
  SimpleStreamOptions,
  TextContent,
  ToolCall,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { jsonrepair } from 'jsonrepair';

import {
  ANTIGRAVITY_SDK_DEFAULT_TIMEOUT_MS,
  antigravitySdkSettingsFromEnv,
  describeAntigravityError,
  runAntigravityTurn,
  type AntigravitySdkSettings,
  type AntigravityTurnResult,
  type AntigravityUsage,
} from '@/lib/ai/antigravity-sdk';
import { pickThinkingEffort } from '@/lib/ai/thinking-config';
import { ANTIGRAVITY_SDK_THINKING } from '@/lib/ai/providers';
import type { ThinkingConfig } from '@/lib/types/provider';
import { combineAbortSignals } from './abort-signals';
import { AssistantEventStream, EMPTY_USAGE } from './assistant-event-stream';
import { toolCallArguments } from './tool-call-arguments';

/**
 * Structured-output contract for one Antigravity turn. Gemini's schema subset
 * rejects `additionalProperties` on some models, so the schema stays to plain
 * object/array/string fields with every property required.
 */
export const ANTIGRAVITY_TURN_OUTPUT_SCHEMA = {
  type: 'object',
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
        properties: {
          name: { type: 'string', description: 'Exact tool name from the provided catalogue.' },
          arguments: {
            type: 'string',
            description: 'A JSON object with the tool arguments, encoded as a string.',
          },
        },
        required: ['name', 'arguments'],
      },
    },
  },
  required: ['text', 'toolCalls'],
} as const;

export interface AntigravityToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ParsedAntigravityTurn {
  text: string;
  toolCalls: AntigravityToolCall[];
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

function turnFromRecord(record: Record<string, unknown>): ParsedAntigravityTurn | null {
  if (!('text' in record) && !('toolCalls' in record)) return null;
  const toolCalls: AntigravityToolCall[] = [];
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

/**
 * Read one turn's reply: the SDK's parsed structured output first, then a JSON
 * contract in the text, otherwise the raw text as a plain answer. Never throws.
 */
export function parseAntigravityTurnResponse(
  result: Pick<AntigravityTurnResult, 'text' | 'structured'>,
): ParsedAntigravityTurn {
  if (typeof result.structured === 'string') {
    const parsed = parseJsonObject(result.structured);
    const turn = parsed ? turnFromRecord(parsed) : null;
    if (turn) return turn;
  } else if (result.structured && typeof result.structured === 'object') {
    const turn = turnFromRecord(result.structured as Record<string, unknown>);
    if (turn) return turn;
  }

  const parsedText = parseJsonObject(result.text);
  const textTurn = parsedText ? turnFromRecord(parsedText) : null;
  if (textTurn) return textTurn;

  return { text: result.text, toolCalls: [], structured: false };
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

const IMAGE_NOTE = '[image observation omitted: the Antigravity transport is text-only]';

/** Render the pi transcript as the text conversation the Antigravity turn receives. */
export function renderAntigravityConversation(messages: PiMessage[]): string {
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
export function buildAntigravityTurnPrompt(context: PiContext): string {
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
    renderAntigravityConversation(context.messages),
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
 * pi thinking config -> Antigravity `ThinkingLevel`. `none` means "do not send a
 * level" (the model default); `xhigh`/`max` collapse onto `extra_high`.
 */
export function antigravityThinkingLevel(config: ThinkingConfig | undefined): string | undefined {
  if (!config) return undefined;
  const effort = pickThinkingEffort(ANTIGRAVITY_SDK_THINKING, config);
  switch (effort) {
    case 'minimal':
      return 'minimal';
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    case 'xhigh':
    case 'max':
      return 'extra_high';
    default:
      return undefined;
  }
}

export interface AntigravityStreamFnOptions {
  /** Model id resolved for the driver (e.g. `gemini-3.8-flash`). */
  modelId: string;
  /** Thinking config of the resolved connection (maps to an SDK level). */
  thinkingConfig?: ThinkingConfig;
  /** Abort the turn (run abort). */
  abortSignal?: AbortSignal;
  /** Per-turn ceiling; defaults to the settings/env value. */
  timeoutMs?: number;
  /** Attribution label for logs; kept for parity with the HTTP transport. */
  source?: string;
  /** Deployment settings; defaults to the environment. */
  settings?: AntigravitySdkSettings;
}

function antigravityUsageToPi(usage: AntigravityUsage | null): AssistantMessage['usage'] {
  if (!usage) return { ...EMPTY_USAGE };
  const cacheRead = Math.max(0, usage.cachedContentTokenCount ?? 0);
  const prompt = Math.max(0, usage.promptTokenCount ?? 0);
  const input = Math.max(0, prompt - cacheRead);
  const output = Math.max(0, (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0));
  return {
    input,
    output,
    cacheRead,
    cacheWrite: 0,
    totalTokens: input + output + cacheRead,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

/** Build a pi `StreamFn` that answers one turn through the Antigravity SDK. */
export function createAntigravityStreamFn(opts: AntigravityStreamFnOptions): StreamFn {
  return ((_piModel, context: PiContext, streamOptions?: SimpleStreamOptions) => {
    const stream = new AssistantEventStream();
    void pump(stream, context, opts, streamOptions).catch((error) => stream.fail(error));
    return stream as unknown as AssistantMessageEventStream;
  }) as StreamFn;
}

async function pump(
  stream: AssistantEventStream,
  context: PiContext,
  opts: AntigravityStreamFnOptions,
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
    partial.errorMessage = describeAntigravityError(error);
    runCleanup();
    stream.push({ type: 'error', reason, error: partial });
  };

  const pushText = (text: string): void => {
    if (!text) return;
    const index = partial.content.length;
    partial.content.push({ type: 'text', text } satisfies TextContent);
    stream.push({ type: 'text_start', contentIndex: index, partial });
    stream.push({ type: 'text_delta', contentIndex: index, delta: text, partial });
    stream.push({ type: 'text_end', contentIndex: index, content: text, partial });
  };

  const pushToolCalls = (calls: AntigravityToolCall[]): void => {
    calls.forEach((call, callIndex) => {
      const index = partial.content.length;
      const toolCall: ToolCall = {
        type: 'toolCall',
        id: `antigravity-${partial.timestamp.toString(36)}-${callIndex}`,
        name: call.name,
        arguments: call.arguments,
      };
      partial.content.push(toolCall);
      stream.push({ type: 'toolcall_start', contentIndex: index, partial });
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial });
    });
  };

  try {
    const settings = opts.settings ?? antigravitySdkSettingsFromEnv();
    const timeoutMs = opts.timeoutMs ?? settings.timeoutMs ?? ANTIGRAVITY_SDK_DEFAULT_TIMEOUT_MS;
    const timeout = new AbortController();
    const timer = setTimeout(() => {
      timeout.abort(new Error(`Antigravity turn timed out after ${Math.round(timeoutMs / 1000)}s`));
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

    const result = await runAntigravityTurn(
      {
        prompt: buildAntigravityTurnPrompt(context),
        systemInstructions:
          'You are the model half of the OpenMAIC Pro Workbench. Follow the ' +
          'turn instructions exactly; the OpenMAIC harness executes tools.',
        responseSchema: ANTIGRAVITY_TURN_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
        model: opts.modelId || settings.model || '',
        ...(antigravityThinkingLevel(opts.thinkingConfig)
          ? { thinkingLevel: antigravityThinkingLevel(opts.thinkingConfig) }
          : {}),
        timeoutMs,
        ...(combined.signal ? { signal: combined.signal } : {}),
      },
      settings,
    );
    if (settled) return;

    const parsed = parseAntigravityTurnResponse(result);
    partial.usage = antigravityUsageToPi(result.usage);
    pushText(parsed.text);
    pushToolCalls(parsed.toolCalls);
    partial.stopReason = parsed.toolCalls.length > 0 ? 'toolUse' : 'stop';
    settled = true;
    runCleanup();
    stream.push({
      type: 'done',
      reason: parsed.toolCalls.length > 0 ? 'toolUse' : 'stop',
      message: partial,
    });
  } catch (error) {
    if (settled) return;
    settleError('error', error);
  } finally {
    runCleanup();
  }
}
