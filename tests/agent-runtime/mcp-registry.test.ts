import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import {
  callRunTool,
  getRunToolset,
  listRunTools,
  registerRunToolset,
} from '@/lib/server/agent-runtime/mcp-registry';

function tool(
  overrides: Partial<AgentTool<never, never>> & { name: string },
): AgentTool<never, never> {
  return {
    label: overrides.name,
    description: `does ${overrides.name}`,
    parameters: { type: 'object', properties: { text: { type: 'string' } } },
    execute: vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
      details: { ran: overrides.name },
    })),
    ...overrides,
  } as unknown as AgentTool<never, never>;
}

function entry(tools: AgentTool<never, never>[]) {
  return { sessionId: 's1', ownerId: 'o1', attempt: 1, tools, emit: vi.fn() };
}

describe('mcp-registry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('publishes a toolset under a fresh token and revokes it', () => {
    const first = registerRunToolset(entry([tool({ name: 'create_stage' })]));
    const second = registerRunToolset(entry([tool({ name: 'create_stage' })]));
    expect(first.token).not.toBe(second.token);
    expect(getRunToolset(first.token)?.sessionId).toBe('s1');
    first.unregister();
    expect(getRunToolset(first.token)).toBeUndefined();
    second.unregister();
  });

  it('lists tools in the MCP descriptor shape', () => {
    const { token, unregister } = registerRunToolset(
      entry([tool({ name: 'generate_scene' }), tool({ name: 'ask_user' })]),
    );
    const entryNow = getRunToolset(token)!;
    expect(listRunTools(entryNow)).toEqual([
      {
        name: 'generate_scene',
        description: 'does generate_scene',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
      {
        name: 'ask_user',
        description: 'does ask_user',
        inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
      },
    ]);
    unregister();
  });

  it('executes a tool and returns its text content plus details', async () => {
    const { token, unregister } = registerRunToolset(entry([tool({ name: 'create_stage' })]));
    const result = await callRunTool(getRunToolset(token)!, 'create_stage', { text: 'x' });
    expect(result.isError).toBe(false);
    expect(result.content).toEqual([{ type: 'text', text: 'ok' }]);
    expect(result.details).toEqual({ ran: 'create_stage' });
    unregister();
  });

  it('applies prepareArguments before executing', async () => {
    const prepareArguments = vi.fn(() => ({ text: 'coerced' }) as never);
    const execute = vi.fn(async () => ({
      content: [{ type: 'text' as const, text: 'done' }],
      details: undefined,
    }));
    const { token, unregister } = registerRunToolset(
      entry([tool({ name: 'patch_stage', prepareArguments, execute })]),
    );
    await callRunTool(getRunToolset(token)!, 'patch_stage', { text: 5 });
    expect(prepareArguments).toHaveBeenCalledWith({ text: 5 });
    expect(execute.mock.calls[0]?.[1]).toEqual({ text: 'coerced' });
    unregister();
  });

  it('turns a throwing tool into an error result the model can recover from', async () => {
    const { token, unregister } = registerRunToolset(
      entry([
        tool({
          name: 'generate_scene',
          execute: vi.fn(async () => {
            throw new Error('lease lost');
          }) as never,
        }),
      ]),
    );
    const onToolCall = vi.fn();
    const registered = getRunToolset(token)!;
    registered.onToolCall = onToolCall;
    const result = await callRunTool(registered, 'generate_scene', {});
    expect(result).toEqual({
      content: [{ type: 'text', text: 'lease lost' }],
      isError: true,
    });
    expect(onToolCall).toHaveBeenCalledWith('generate_scene', true);
    unregister();
  });

  it('answers an unknown tool with an error result instead of throwing', async () => {
    const { token, unregister } = registerRunToolset(entry([tool({ name: 'a' })]));
    const result = await callRunTool(getRunToolset(token)!, 'nope', {});
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Unknown tool: nope');
    unregister();
  });

  it('counts tool calls for the settlement frame', async () => {
    const onToolCall = vi.fn();
    const registered = {
      ...entry([tool({ name: 'a' })]),
      createdAt: Date.now(),
      onToolCall,
    };
    const { token, unregister } = registerRunToolset(entry([tool({ name: 'a' })]));
    getRunToolset(token)!.onToolCall = onToolCall;
    await callRunTool(getRunToolset(token)!, 'a', {});
    expect(onToolCall).toHaveBeenCalledWith('a', false);
    expect(registered.onToolCall).toBe(onToolCall);
    unregister();
  });
});
