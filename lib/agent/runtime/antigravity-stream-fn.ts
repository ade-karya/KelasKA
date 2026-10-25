/**
 * MAIC Agent — Antigravity CLI StreamFn (`agy` transport).
 *
 * Mirrors the Python SDK transport but invokes the `agy` CLI in print mode
 * with structured output. The pi harness keeps owning the loop.
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

import { runAntigravityCliTurn, type AntigravityCliTurnResult } from '@/lib/ai/antigravity-cli';
import { ANTIGRAVITY_SDK_THINKING, ANTIGRAVITY_SDK_THINKING_GEMINI_FLASH } from '@/lib/ai/providers';
import { pickThinkingEffort } from '@/lib/ai/thinking-config';
import type { ThinkingConfig } from '@/lib/types/provider';
import { combineAbortSignals } from './abort-signals';
import { AssistantEventStream, EMPTY_USAGE } from './assistant-event-stream';

export const ANTIGRAVITY_TURN_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['text', 'toolCalls'],
  properties: {
    text: { type: 'string' },
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'arguments'],
        properties: {
          name: { type: 'string' },
          arguments: { type: 'string' },
        },
      },
    },
  },
};

export interface AntigravityStreamFnOptions {
  modelId: string;
  thinkingConfig?: ThinkingConfig;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  source?: string;
}

export function createAntigravityStreamFn(opts: AntigravityStreamFnOptions): StreamFn {
  return ((_piModel, context: PiContext, streamOptions?: SimpleStreamOptions) => {
    const stream = new AssistantEventStream();
    void pump(stream, context, opts, streamOptions).catch((error) => stream.fail(error));
    return stream as unknown as AssistantMessageEventStream;
  }) as StreamFn;
}

function antigravityUsageToPi(usage: AntigravityCliTurnResult['usage']): AssistantMessage['usage'] {
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
  const runCleanup = () => { for (const fn of cleanup.splice(0)) fn(); };

  const settleError = (reason: 'error' | 'aborted', error: unknown): void => {
    if (settled) return;
    settled = true;
    partial.stopReason = reason;
    partial.errorMessage = error instanceof Error ? error.message : String(error);
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

  const pushToolCalls = (calls: { name: string; arguments: Record<string, unknown> }[]): void => {
    calls.forEach((call, callIndex) => {
      const index = partial.content.length;
      let args: Record<string, unknown> = {};
      if (call.arguments && typeof call.arguments === 'object') args = call.arguments as Record<string, unknown>;
      else if (typeof call.arguments === 'string') {
        try { args = JSON.parse(call.arguments); } catch { args = {}; }
      }
      const toolCall: ToolCall = {
        type: 'toolCall',
        id: `antigravity-${partial.timestamp.toString(36)}-${callIndex}`,
        name: call.name,
        arguments: args,
      };
      partial.content.push(toolCall);
      stream.push({ type: 'toolcall_start', contentIndex: index, partial });
      stream.push({ type: 'toolcall_end', contentIndex: index, toolCall, partial });
    });
  };

  try {
    const timeoutMs = opts.timeoutMs ?? 900_000;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(new Error(`Antigravity CLI turn timed out after ${Math.round(timeoutMs / 1000)}s`)), timeoutMs) as ReturnType<typeof setTimeout> & { unref?: () => void };
    timer.unref?.();
    cleanup.push(() => clearTimeout(timer));

    const combined = combineAbortSignals([opts.abortSignal, streamOptions?.signal, timeout.signal]);
    cleanup.push(combined.cleanup);
    const onAbort = () => {
      const reason = combined.signal?.reason;
      settleError(timeout.signal.aborted ? 'error' : 'aborted', timeout.signal.aborted ? reason : (reason ?? 'Operation aborted'));
    };
    combined.signal?.addEventListener('abort', onAbort, { once: true });
    cleanup.push(() => combined.signal?.removeEventListener('abort', onAbort));
    if (combined.signal?.aborted) { onAbort(); return; }

    const prompt = buildAntigravityTurnPrompt(context);
    const systemInstructions = 'You are the model half of the OpenMAIC Pro Workbench. Follow the turn instructions exactly; the OpenMAIC harness executes tools.';
    const capability = opts.modelId === 'gemini-3.8-flash'
      ? ANTIGRAVITY_SDK_THINKING_GEMINI_FLASH
      : ANTIGRAVITY_SDK_THINKING;
    const effort = opts.thinkingConfig
      ? pickThinkingEffort(capability, opts.thinkingConfig)
      : capability.defaultEffort;
    const result = await runAntigravityCliTurn({
      prompt,
      systemInstructions,
      responseSchema: ANTIGRAVITY_TURN_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
      model: opts.modelId || '',
      thinkingLevel: effort,
      timeoutMs,
      signal: combined.signal ?? undefined,
    });
    if (settled) return;

    partial.usage = antigravityUsageToPi(result.usage);
    pushText(result.text);
    pushToolCalls(result.toolCalls);
    partial.stopReason = result.toolCalls.length > 0 ? 'toolUse' : 'stop';
    settled = true;
    runCleanup();
    stream.push({ type: 'done', reason: result.toolCalls.length > 0 ? 'toolUse' : 'stop', message: partial });
  } catch (error) {
    if (settled) return;
    settleError('error', error);
  } finally {
    runCleanup();
  }
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
          out.push(`<tool_call name="${block.name}">${JSON.stringify(block.arguments)}</tool_call>`);
        }
      }
    } else if (message.role === 'toolResult') {
      out.push(
        `### tool_result name="${message.toolName}" id="${message.toolCallId}"${message.isError ? ' error="true"' : ''}`,
        renderContent(message.content, { imageNote: IMAGE_NOTE }),
      );
    }
  }
  return out.join('\n');
}

function buildAntigravityTurnPrompt(context: PiContext): string {
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
