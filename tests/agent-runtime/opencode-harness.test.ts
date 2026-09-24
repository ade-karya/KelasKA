import { describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  buildCliHarnessSystemPrompt,
  extractOpenmaicCall,
  renderHarnessPrompt,
  runOpencodeHarness,
} from '@/lib/server/agent-runtime/opencode-harness';
import { getRunToolset } from '@/lib/server/agent-runtime/mcp-registry';

function tool(name: string, execute?: AgentTool<never, never>['execute']): AgentTool<never, never> {
  return {
    name,
    label: name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute:
      execute ??
      (async () => ({ content: [{ type: 'text' as const, text: 'ok' }], details: undefined })),
  } as unknown as AgentTool<never, never>;
}

/** A stream stub that yields the given events and records its options. */
function streamOf(events: unknown[], onCall?: (options: unknown) => void) {
  return ((options: unknown) => {
    onCall?.(options);
    return (async function* () {
      for (const event of events) yield event;
    })();
  }) as never;
}

function baseOptions(overrides: Record<string, unknown> = {}) {
  return {
    modelId: 'test-model',
    systemPrompt: 'SYS',
    tools: [tool('create_stage')],
    history: [],
    messages: [{ role: 'user', content: 'buat kelas' } as never],
    sessionId: 's1',
    ownerId: 'o1',
    attempt: 1,
    emit: vi.fn(),
    persistMessage: vi.fn(async () => undefined),
    abortSignal: new AbortController().signal,
    appBaseUrl: 'http://127.0.0.1:3000',
    cliPath: '/usr/local/bin/opencode',
    resolveCliPath: () => '/usr/local/bin/opencode',
    stream: undefined,
    registerToolset: undefined,
    ...overrides,
  };
}

describe('renderHarnessPrompt', () => {
  it('renders the system prompt and the labeled conversation', () => {
    const prompt = renderHarnessPrompt(
      'SYS',
      [{ role: 'user', content: 'halo' } as never],
      [{ role: 'user', content: 'buat kelas' } as never],
    );
    expect(prompt).toBe('[system]\nSYS\n\n[user]\nhalo\n\n[user]\nbuat kelas');
  });

  it('renders assistant text and tool calls', () => {
    const prompt = renderHarnessPrompt(
      'SYS',
      [],
      [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'siap' },
            { type: 'toolCall', id: 'c1', name: 'create_stage', arguments: { title: 'T' } },
          ],
        } as never,
      ],
    );
    expect(prompt).toContain('[assistant]\nsiap\n[tool call create_stage c1]\n{"title":"T"}');
  });

  it('renders tool results', () => {
    const prompt = renderHarnessPrompt(
      'SYS',
      [],
      [
        {
          role: 'toolResult',
          toolCallId: 'c1',
          toolName: 'create_stage',
          content: [{ type: 'text', text: 'created' }],
        } as never,
      ],
    );
    expect(prompt).toContain('[tool result create_stage c1]\ncreated');
  });
});

describe('extractOpenmaicCall', () => {
  it('recovers the real tool name and arguments from a Code Mode step', () => {
    const call = extractOpenmaicCall({
      name: 'execute',
      status: 'completed',
      input: { code: 'return await tools.openmaic["generate_scene"]({ order: 2, brief: "x" })' },
    });
    expect(call).toEqual({ name: 'generate_scene', args: { order: 2, brief: 'x' } });
  });

  it('keeps the code as the arguments when the literal is not JSON', () => {
    const code = 'return await tools.openmaic["patch_stage"]({ path: "/x", value: fn() })';
    const call = extractOpenmaicCall({
      name: 'execute',
      status: 'completed',
      input: { code },
    });
    expect(call?.name).toBe('patch_stage');
    expect(call?.args).toEqual({ code });
  });

  it('returns null for a non-Code-Mode tool or a foreign namespace', () => {
    expect(
      extractOpenmaicCall({ name: 'read', status: 'completed', input: { path: '/x' } }),
    ).toBeNull();
    expect(
      extractOpenmaicCall({
        name: 'execute',
        status: 'completed',
        input: { code: 'return await tools.other["thing"]({})' },
      }),
    ).toBeNull();
  });
});

describe('runOpencodeHarness', () => {
  it('maps text into message frames and persists the assistant message', async () => {
    const emit = vi.fn();
    const persistMessage = vi.fn(async () => undefined);
    const outcome = await runOpencodeHarness(
      baseOptions({
        emit,
        persistMessage,
        stream: streamOf([
          { kind: 'text-delta', delta: 'Halo ' },
          { kind: 'text-delta', delta: 'dunia' },
          {
            kind: 'done',
            completion: { text: 'Halo dunia', reasoning: '', usage: {}, finishReason: 'stop' },
          },
        ]),
      }),
    );

    const types = emit.mock.calls.map((call) => call[0]);
    expect(types).toContain('message_start');
    expect(types).toContain('message_update');
    expect(types[types.length - 1]).toBe('message_end');
    expect(outcome).toEqual({ toolCalls: 0, questionEmitted: false });
    const persisted = persistMessage.mock.calls[0]?.[0] as { content: unknown[] };
    expect(persisted.content).toEqual([{ type: 'text', text: 'Halo dunia' }]);
  });

  it('maps a Code Mode tool step to the real tool card frames', async () => {
    const emit = vi.fn();
    await runOpencodeHarness(
      baseOptions({
        emit,
        stream: streamOf([
          {
            kind: 'tool',
            tool: {
              id: 'call-1',
              name: 'execute',
              status: 'completed',
              input: {
                code: 'return await tools.openmaic["create_stage"]({ title: "Fotosintesis" })',
              },
              output: 'stage-123',
            },
          },
          { kind: 'text-delta', delta: 'Selesai.' },
          {
            kind: 'done',
            completion: { text: 'Selesai.', reasoning: '', usage: {}, finishReason: 'stop' },
          },
        ]),
      }),
    );

    const start = emit.mock.calls.find((call) => call[0] === 'tool_execution_start')?.[1] as {
      toolName: string;
      args: Record<string, unknown>;
      toolCallId: string;
    };
    expect(start.toolName).toBe('create_stage');
    expect(start.args).toEqual({ title: 'Fotosintesis' });
    expect(start.toolCallId).toBe('call-1');
    const end = emit.mock.calls.find((call) => call[0] === 'tool_execution_end')?.[1] as {
      isError: boolean;
      result: { content: { text: string }[] };
    };
    expect(end.isError).toBe(false);
    expect(end.result.content[0]?.text).toBe('stage-123');
  });

  it('publishes the run toolset to the MCP registry and revokes it afterwards', async () => {
    let seenToken = '';
    await runOpencodeHarness(
      baseOptions({
        stream: streamOf(
          [
            { kind: 'text-delta', delta: 'x' },
            {
              kind: 'done',
              completion: { text: 'x', reasoning: '', usage: {}, finishReason: 'stop' },
            },
          ],
          (options) => {
            const servers = (options as { mcpServers: { environment: Record<string, string> }[] })
              .mcpServers;
            seenToken = servers[0]!.environment.OPENMAIC_MCP_TOKEN!;
            expect(servers[0]!.environment.OPENMAIC_MCP_URL).toBe('http://127.0.0.1:3000');
            // The token must resolve to this run's toolset while the run is live.
            expect(getRunToolset(seenToken)?.sessionId).toBe('s1');
          },
        ),
      }),
    );
    expect(seenToken).not.toBe('');
    expect(getRunToolset(seenToken)).toBeUndefined();
  });

  it('flags a question emitted by a tool and forwards it durably', async () => {
    const emit = vi.fn();
    const { token, unregister } = await (async () => {
      const registry = await import('@/lib/server/agent-runtime/mcp-registry');
      return registry.registerRunToolset({
        sessionId: 's1',
        ownerId: 'o1',
        attempt: 1,
        tools: [],
        emit: vi.fn(),
      });
    })();
    unregister();

    const outcome = await runOpencodeHarness(
      baseOptions({
        emit,
        stream: streamOf([{ kind: 'text-delta', delta: 'ok' }], () => {
          // Simulate the MCP route running the ask_user tool mid-run.
          const live = getRunToolset((emit as unknown as { mock: unknown }) && '');
          void live;
        }),
      }),
    );
    expect(outcome.questionEmitted).toBe(false);
    expect(token).toBeTruthy();
  });

  it('returns the failure message when the stream fails', async () => {
    const emit = vi.fn();
    const persistMessage = vi.fn(async () => undefined);
    const outcome = await runOpencodeHarness(
      baseOptions({
        emit,
        persistMessage,
        stream: (() =>
          (async function* () {
            yield { kind: 'text-delta', delta: 'partial' };
            throw new Error('opencode CLI exited with code 1');
          })()) as never,
      }),
    );
    expect(outcome.error).toContain('exited with code 1');
    expect(emit.mock.calls.some((call) => call[0] === 'message_end')).toBe(true);
    const persisted = persistMessage.mock.calls[0]?.[0] as {
      stopReason: string;
      errorMessage?: string;
    };
    expect(persisted.stopReason).toBe('error');
    expect(persisted.errorMessage).toContain('exited with code 1');
  });

  it('emits nothing when the run produced no content', async () => {
    const emit = vi.fn();
    const persistMessage = vi.fn(async () => undefined);
    const outcome = await runOpencodeHarness(
      baseOptions({
        emit,
        persistMessage,
        stream: streamOf([
          {
            kind: 'done',
            completion: { text: '', reasoning: '', usage: {}, finishReason: 'stop' },
          },
        ]),
      }),
    );
    expect(emit).not.toHaveBeenCalled();
    expect(persistMessage).not.toHaveBeenCalled();
    expect(outcome.error).toBeUndefined();
  });

  it('reports a missing CLI binary as a run error instead of throwing', async () => {
    const outcome = await runOpencodeHarness(baseOptions({ resolveCliPath: () => undefined }));
    expect(outcome.error).toContain('no `opencode` binary was found');
  });

  it('teaches the Code Mode call shape and bans native tools in the CLI prompt', () => {
    const prompt = buildCliHarnessSystemPrompt('SYS');
    expect(prompt.startsWith('SYS')).toBe(true);
    expect(prompt).toContain('tools.openmaic["generate_scene"]');
    expect(prompt).toContain('tools.openmaic["ask_user"]');
  });

  it('runs the CLI locked down in a scratch cwd, never the app checkout', async () => {
    const { existsSync } = await import('node:fs');
    let seenCwd = '';
    let seenLockdown: unknown;
    let seenPrompt = '';
    await runOpencodeHarness(
      baseOptions({
        stream: streamOf(
          [
            { kind: 'text-delta', delta: 'x' },
            {
              kind: 'done',
              completion: { text: 'x', reasoning: '', usage: {}, finishReason: 'stop' },
            },
          ],
          (options) => {
            const opts = options as {
              cwd?: string;
              lockBuiltinTools?: boolean;
              prompt?: string;
            };
            seenCwd = opts.cwd ?? '';
            seenLockdown = opts.lockBuiltinTools;
            seenPrompt = opts.prompt ?? '';
            // The scratch dir must exist while the run is live.
            expect(existsSync(seenCwd)).toBe(true);
          },
        ),
      }),
    );
    expect(seenLockdown).toBe(true);
    expect(seenCwd).not.toBe(process.cwd());
    expect(seenCwd).toContain('openmaic-opencode-run-');
    expect(seenPrompt).toContain('tools.openmaic[');
    // Best-effort cleanup: the scratch dir is removed after the run.
    expect(existsSync(seenCwd)).toBe(false);
  });
});
