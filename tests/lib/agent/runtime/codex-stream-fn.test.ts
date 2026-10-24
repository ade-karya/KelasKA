/**
 * Codex SDK StreamFn — the transport half of the Pro Workbench agent loop.
 *
 * The SDK client is injected (`client` option), so these tests never spawn a
 * `codex` binary: they pin the wire contract (structured turn in, pi events
 * out) that the harness depends on.
 */
import type {
  AssistantMessageEvent,
  Context as PiContext,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';

import type { ThreadEvent, ThreadOptions } from '@/lib/ai/codex-sdk';
import {
  CODEX_TURN_OUTPUT_SCHEMA,
  buildCodexTurnPrompt,
  codexReasoningEffort,
  createCodexStreamFn,
  parseCodexTurnResponse,
} from '@/lib/agent/runtime/codex-stream-fn';
import { TOOL_ARGUMENTS_ERROR_KEY } from '@/lib/agent/runtime/tool-call-arguments';

interface FakeTurnOptions {
  outputSchema?: unknown;
  signal?: AbortSignal;
}

interface Captured {
  threadOptions?: ThreadOptions;
  input?: string;
  turnOptions?: FakeTurnOptions;
}

function fakeClient(
  events: ThreadEvent[] | ((signal: AbortSignal | undefined) => AsyncIterable<ThreadEvent>),
  captured: Captured = {},
) {
  return {
    startThread(options?: ThreadOptions) {
      captured.threadOptions = options;
      return {
        async runStreamed(input: string, turnOptions?: FakeTurnOptions) {
          captured.input = input;
          captured.turnOptions = turnOptions;
          const iterable =
            typeof events === 'function' ? events(turnOptions?.signal) : arrayIterable(events);
          return { events: iterable };
        },
      };
    },
  };
}

async function* arrayIterable(events: ThreadEvent[]): AsyncIterable<ThreadEvent> {
  for (const event of events) yield event;
}

function context(overrides: Partial<PiContext> = {}): PiContext {
  return {
    systemPrompt: 'You are the OpenMAIC workbench agent.',
    messages: [{ role: 'user', content: 'Buat satu slide tentang fotosintesis.', timestamp: 1 }],
    tools: [
      {
        name: 'render_scene_preview',
        description: 'Render the current scene.',
        parameters: { type: 'object', properties: {} },
      },
    ],
    ...overrides,
  } as unknown as PiContext;
}

async function collect(
  streamFn: StreamFn,
  ctx: PiContext = context(),
  streamOptions?: SimpleStreamOptions,
) {
  const stream = await streamFn({} as never, ctx, streamOptions);
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) events.push(event);
  return { events, message: await stream.result() };
}

const REASONING: ThreadEvent = {
  type: 'item.completed',
  item: { id: 'r1', type: 'reasoning', text: 'Pertimbangkan audiens.' },
};

function agentMessage(text: string, id = 'a1'): ThreadEvent {
  return { type: 'item.completed', item: { id, type: 'agent_message', text } };
}

const USAGE: ThreadEvent = {
  type: 'turn.completed',
  usage: {
    input_tokens: 100,
    cached_input_tokens: 20,
    cache_write_input_tokens: 5,
    output_tokens: 30,
    reasoning_output_tokens: 10,
  },
};

const STRUCTURED = JSON.stringify({
  text: 'Saya render dulu.',
  toolCalls: [{ name: 'render_scene_preview', arguments: '{"sceneId":"s1"}' }],
});

describe('parseCodexTurnResponse', () => {
  it('reads the structured contract and parses string arguments', () => {
    const parsed = parseCodexTurnResponse(STRUCTURED);
    expect(parsed.structured).toBe(true);
    expect(parsed.text).toBe('Saya render dulu.');
    expect(parsed.toolCalls).toEqual([
      { name: 'render_scene_preview', arguments: { sceneId: 's1' } },
    ]);
  });

  it('accepts a fenced JSON reply and one embedded in prose', () => {
    const fenced = parseCodexTurnResponse('```json\n{"text":"ok","toolCalls":[]}\n```');
    expect(fenced.structured).toBe(true);
    expect(fenced.text).toBe('ok');

    const embedded = parseCodexTurnResponse('Here you go:\n{"text":"ok","toolCalls":[]}\nThanks.');
    expect(embedded.structured).toBe(true);
    expect(embedded.text).toBe('ok');
  });

  it('keeps a malformed argument string as a parse diagnosis, never as raw arguments', () => {
    const parsed = parseCodexTurnResponse(
      JSON.stringify({ text: '', toolCalls: [{ name: 'demo', arguments: '{"a":' }] }),
    );
    expect(parsed.toolCalls).toHaveLength(1);
    expect(parsed.toolCalls[0]!.arguments[TOOL_ARGUMENTS_ERROR_KEY]).toMatch(/not valid JSON/);
  });

  it('skips nameless calls and tolerates a missing text field', () => {
    const parsed = parseCodexTurnResponse(
      JSON.stringify({ toolCalls: [{ name: '  ' }, { name: 'ok', arguments: {} }] }),
    );
    expect(parsed.structured).toBe(true);
    expect(parsed.text).toBe('');
    expect(parsed.toolCalls.map((call) => call.name)).toEqual(['ok']);
  });

  it('treats a plain answer as unstructured text', () => {
    const parsed = parseCodexTurnResponse('Fotosintesis adalah proses…');
    expect(parsed).toEqual({
      text: 'Fotosintesis adalah proses…',
      toolCalls: [],
      structured: false,
    });
  });

  it('treats JSON that is not the contract as plain text', () => {
    const parsed = parseCodexTurnResponse('{"answer":"42"}');
    expect(parsed.structured).toBe(false);
    expect(parsed.text).toBe('{"answer":"42"}');
  });
});

describe('buildCodexTurnPrompt', () => {
  it('carries the system prompt, the tool catalogue and the output contract', () => {
    const prompt = buildCodexTurnPrompt(context());
    expect(prompt).toContain('You are the OpenMAIC workbench agent.');
    expect(prompt).toContain('"name": "render_scene_preview"');
    expect(prompt).toContain('"parameters"');
    expect(prompt).toContain('Buat satu slide tentang fotosintesis.');
    expect(prompt).toContain('"toolCalls"');
    expect(prompt).toContain('Do not run shell commands');
  });

  it('renders tool calls and tool results from the transcript', () => {
    const prompt = buildCodexTurnPrompt(
      context({
        messages: [
          { role: 'user', content: 'render', timestamp: 1 },
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Rendering.' },
              {
                type: 'toolCall',
                id: 'call-1',
                name: 'render_scene_preview',
                arguments: { sceneId: 's1' },
              },
            ],
            api: 'openai-completions',
            provider: 'openai',
            model: 'gpt',
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: 'toolUse',
            timestamp: 2,
          },
          {
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'render_scene_preview',
            content: [{ type: 'text', text: 'rendered ok' }],
            isError: false,
            timestamp: 3,
          },
        ],
      }),
    );
    expect(prompt).toContain('<tool_call name="render_scene_preview">');
    expect(prompt).toContain('### tool_result name="render_scene_preview"');
    expect(prompt).toContain('rendered ok');
  });

  it('notes omitted images instead of silently dropping the turn', () => {
    const prompt = buildCodexTurnPrompt(
      context({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'lihat ini' },
              { type: 'image', data: 'cG5n', mimeType: 'image/png' },
            ],
            timestamp: 1,
          },
        ],
      }),
    );
    expect(prompt).toContain('lihat ini');
    expect(prompt).toContain('image observation omitted');
  });
});

describe('codexReasoningEffort', () => {
  it('maps a pi effort to the Codex effort', () => {
    expect(codexReasoningEffort({ effort: 'high' })).toBe('high');
  });

  it('sends no effort for "none" (the CLI keeps the model default)', () => {
    expect(codexReasoningEffort({ mode: 'disabled' })).toBeUndefined();
  });

  it('sends no effort when there is no thinking config', () => {
    expect(codexReasoningEffort(undefined)).toBeUndefined();
  });
});

describe('createCodexStreamFn', () => {
  it('answers one structured turn: text, tool calls and usage', async () => {
    const captured: Captured = {};
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      thinkingConfig: { effort: 'medium' },
      client: fakeClient([REASONING, agentMessage(STRUCTURED), USAGE], captured),
    });

    const { events, message } = await collect(streamFn);

    expect(events[0]!.type).toBe('start');
    expect(events.some((event) => event.type === 'thinking_delta')).toBe(true);
    expect(events.some((event) => event.type === 'text_delta')).toBe(true);
    expect(events.at(-1)!.type).toBe('done');

    expect(message.stopReason).toBe('toolUse');
    expect(message.content).toEqual([
      { type: 'thinking', thinking: 'Pertimbangkan audiens.' },
      { type: 'text', text: 'Saya render dulu.' },
      expect.objectContaining({
        type: 'toolCall',
        name: 'render_scene_preview',
        arguments: { sceneId: 's1' },
      }),
    ]);
    // input excludes the cached/written prompt tokens, which ride separately.
    expect(message.usage).toMatchObject({
      input: 75,
      output: 30,
      cacheRead: 20,
      cacheWrite: 5,
      totalTokens: 130,
    });

    expect(captured.threadOptions).toMatchObject({
      model: 'gpt-5.6-codex',
      modelReasoningEffort: 'medium',
      sandboxMode: 'read-only',
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      skipGitRepoCheck: true,
    });
    expect(captured.turnOptions?.outputSchema).toBe(CODEX_TURN_OUTPUT_SCHEMA);
    expect(captured.input).toContain('### user');
  });

  it('prefers the last structured reply over an earlier progress message', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient([
        agentMessage('Saya lihat dulu kursusnya.', 'a1'),
        agentMessage(STRUCTURED, 'a2'),
        USAGE,
      ]),
    });

    const { message } = await collect(streamFn);
    expect(message.content).toEqual([
      { type: 'text', text: 'Saya render dulu.' },
      expect.objectContaining({ type: 'toolCall', name: 'render_scene_preview' }),
    ]);
  });

  it('uses a plain answer verbatim when the reply ignores the contract', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient([agentMessage('Fotosintesis mengubah cahaya menjadi energi.')]),
    });

    const { message } = await collect(streamFn);
    expect(message.stopReason).toBe('stop');
    expect(message.content).toEqual([
      { type: 'text', text: 'Fotosintesis mengubah cahaya menjadi energi.' },
    ]);
  });

  it('surfaces turn.failed as an error event with the actionable message', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient([
        {
          type: 'turn.failed',
          error: { message: 'not logged in: run codex login' },
        },
      ]),
    });

    const { events, message } = await collect(streamFn);
    expect(events.at(-1)!.type).toBe('error');
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('Codex is not authenticated');
  });

  it('surfaces a fatal stream error event', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient([{ type: 'error', message: 'boom' }]),
    });

    const { message } = await collect(streamFn);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toBe('boom');
  });

  it('reports a client/thread failure (missing binary) instead of hanging', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: {
        startThread() {
          throw new Error('Unable to locate Codex CLI binaries for x86_64-unknown-linux-musl.');
        },
      },
    });

    const { message } = await collect(streamFn);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('Codex CLI is not installed for this platform');
  });

  it('aborts before starting a turn when the run signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('user cancelled'));
    let started = false;
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      abortSignal: controller.signal,
      client: {
        startThread() {
          started = true;
          return { runStreamed: async () => ({ events: arrayIterable([]) }) };
        },
      },
    });

    const { events, message } = await collect(streamFn);
    expect(started).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message.stopReason).toBe('aborted');
    expect(message.errorMessage).toBe('user cancelled');
  });

  it('aborts a turn that is already streaming (pi per-call signal)', async () => {
    const controller = new AbortController();
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient(async function* (signal) {
        yield REASONING;
        await new Promise<void>((resolve) => {
          signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
    });

    setTimeout(() => controller.abort(new Error('stop now')), 10);
    const { events, message } = await collect(streamFn, context(), {
      signal: controller.signal,
    });
    expect(events.some((event) => event.type === 'thinking_delta')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'error', reason: 'aborted' });
    expect(message.stopReason).toBe('aborted');
    expect(message.errorMessage).toBe('stop now');
  });

  it('times a turn out and reports the ceiling', async () => {
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      timeoutMs: 10,
      client: fakeClient(async function* () {
        await new Promise(() => {});
      }),
    });

    const { message } = await collect(streamFn);
    expect(message.stopReason).toBe('error');
    expect(message.errorMessage).toContain('Codex turn timed out');
  });

  it('does not cap the turn with a wire max_tokens', async () => {
    const captured: Captured = {};
    const streamFn = createCodexStreamFn({
      modelId: 'gpt-5.6-codex',
      client: fakeClient([agentMessage('ok')], captured),
    });
    await collect(streamFn);
    expect(captured.turnOptions).not.toHaveProperty('maxOutputTokens');
  });
});
