import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/ai/opencode-cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/opencode-cli')>();
  return {
    ...actual,
    resolveOpencodeCliPath: vi.fn(() => '/mock/bin/opencode'),
    runOpencodePrompt: vi.fn(async () => ({
      text: 'OK',
      reasoning: '',
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      finishReason: 'stop' as const,
    })),
    streamOpencodePrompt: vi.fn(async function* () {
      yield { kind: 'text-delta' as const, delta: 'O' };
      yield { kind: 'text-delta' as const, delta: 'K' };
      yield {
        kind: 'done' as const,
        completion: {
          text: 'OK',
          reasoning: '',
          usage: {
            inputTokens: 10,
            outputTokens: 3,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          finishReason: 'stop' as const,
        },
      };
    }),
  };
});

import { createOpencodeCliModel, opencodePromptToText } from '@/lib/ai/opencode-model';
import { streamOpencodePrompt } from '@/lib/ai/opencode-cli';
import type { LanguageModelV3Prompt } from '@ai-sdk/provider';

describe('opencodePromptToText', () => {
  it('renders system and multi-turn history as a labeled transcript', () => {
    const prompt: LanguageModelV3Prompt = [
      { role: 'system', content: 'You are a tutor.' },
      { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
      { role: 'user', content: [{ type: 'text', text: 'Make a quiz' }] },
    ];
    expect(opencodePromptToText(prompt)).toBe(
      '[system]\nYou are a tutor.\n\n[user]\nHi\n\n[assistant]\nHello\n\n[user]\nMake a quiz',
    );
  });

  it('preserves tool-call/result context as labeled blocks', () => {
    const prompt: LanguageModelV3Prompt = [
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'tc-1',
            toolName: 'create_stage',
            input: { title: 'T' },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'tc-1',
            toolName: 'create_stage',
            output: { type: 'text', value: 'created' },
          },
        ],
      },
    ];
    const text = opencodePromptToText(prompt);
    expect(text).toContain('[tool call create_stage tc-1]');
    expect(text).toContain('[tool result create_stage tc-1]\ncreated');
  });
});

describe('createOpencodeCliModel', () => {
  it('exposes the AI SDK v3 shape with the opencode provider id', () => {
    const model = createOpencodeCliModel({ modelId: 'mimo-v2.6-flash-free' }) as unknown as {
      specificationVersion: string;
      provider: string;
      modelId: string;
    };
    expect(model.specificationVersion).toBe('v3');
    expect(model.provider).toBe('opencode');
    expect(model.modelId).toBe('mimo-v2.6-flash-free');
  });

  it('doGenerate returns text content with mapped usage', async () => {
    const model = createOpencodeCliModel({ modelId: 'mimo-v2.6-flash-free' }) as unknown as {
      doGenerate: (opts: { prompt: LanguageModelV3Prompt }) => Promise<{
        content: Array<{ type: string; text: string }>;
        finishReason: { unified: string; raw: string };
        usage: {
          inputTokens: { total: number };
          outputTokens: { total: number; text: number };
        };
        warnings: unknown[];
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say OK' }] }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'OK' }]);
    expect(result.finishReason).toEqual({ unified: 'stop', raw: 'stop' });
    expect(result.usage.inputTokens.total).toBe(10);
    expect(result.usage.outputTokens.total).toBe(3);
    expect(result.usage.outputTokens.text).toBe(3);
    expect(result.warnings).toEqual([]);
  });

  it('doGenerate warns when caller tools are dropped', async () => {
    const model = createOpencodeCliModel({ modelId: 'mimo-v2.6-flash-free' }) as unknown as {
      doGenerate: (opts: {
        prompt: LanguageModelV3Prompt;
        tools: Array<{ type: 'function'; name: string; inputSchema: unknown }>;
      }) => Promise<{ warnings: Array<{ type: string; feature: string }> }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      tools: [{ type: 'function', name: 'create_stage', inputSchema: {} }],
    });
    expect(result.warnings).toEqual([
      {
        type: 'unsupported',
        feature: 'tool-call',
        details: expect.stringContaining('text only'),
      },
    ]);
  });

  it('doStream emits the canonical v3 text stream', async () => {
    const model = createOpencodeCliModel({ modelId: 'mimo-v2.6-flash-free' }) as unknown as {
      doStream: (opts: { prompt: LanguageModelV3Prompt }) => Promise<{
        stream: ReadableStream<{ type: string; [k: string]: unknown }>;
      }>;
    };
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say OK' }] }],
    });
    const parts: Array<{ type: string; [k: string]: unknown }> = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts.map((p) => p.type)).toEqual([
      'stream-start',
      'text-start',
      'text-delta',
      'text-delta',
      'text-end',
      'finish',
    ]);
    expect(
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.delta)
        .join(''),
    ).toBe('OK');
    const finish = parts.find((p) => p.type === 'finish') as unknown as {
      finishReason: { unified: string };
      usage: { outputTokens: { total: number } };
    };
    expect(finish.finishReason.unified).toBe('stop');
    expect(finish.usage.outputTokens.total).toBe(3);
  });

  it('doStream surfaces a CLI-reported failure as a stream error', async () => {
    vi.mocked(streamOpencodePrompt).mockImplementationOnce(async function* () {
      yield {
        kind: 'done' as const,
        completion: {
          text: '',
          reasoning: '',
          usage: {
            inputTokens: 10,
            outputTokens: 0,
            reasoningTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
          },
          finishReason: 'error' as const,
          errorMessage: 'Rate limited, retry later',
        },
      };
    });
    const model = createOpencodeCliModel({ modelId: 'mimo-v2.6-flash-free' }) as unknown as {
      doStream: (opts: { prompt: LanguageModelV3Prompt }) => Promise<{
        stream: ReadableStream<{ type: string; [k: string]: unknown }>;
      }>;
    };
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Say OK' }] }],
    });
    const parts: Array<{ type: string; [k: string]: unknown }> = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const error = parts.find((p) => p.type === 'error') as unknown as { error: Error };
    expect(error.error.message).toBe('Rate limited, retry later');
    expect(parts.some((p) => p.type === 'finish')).toBe(false);
  });
});
