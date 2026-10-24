/**
 * Codex SDK bridge settings and turn folding. Nothing here spawns a binary:
 * the client factory is only exercised through the injectable transport tests
 * (`tests/lib/agent/runtime/codex-stream-fn.test.ts`).
 */
import { afterEach, describe, expect, it } from 'vitest';

import type { ThreadEvent } from '@openai/codex-sdk';
import {
  CODEX_SDK_DEFAULT_MODEL,
  CODEX_SDK_DEFAULT_TIMEOUT_MS,
  codexSdkSettingsFromEnv,
  codexThreadOptions,
  collectCodexTurn,
  describeCodexSdkError,
} from '@/lib/ai/codex-sdk';

const ENV_KEYS = [
  'CODEX_API_KEY',
  'OPENAI_API_KEY',
  'CODEX_BASE_URL',
  'CODEX_PATH',
  'CODEX_MODEL',
  'OPENMAIC_CODEX_MODEL',
  'OPENMAIC_CODEX_WORKDIR',
  'OPENMAIC_CODEX_SANDBOX',
  'OPENMAIC_CODEX_TIMEOUT_MS',
] as const;

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

function events(...list: ThreadEvent[]): AsyncIterable<ThreadEvent> {
  return (async function* () {
    for (const event of list) yield event;
  })();
}

describe('codexSdkSettingsFromEnv', () => {
  it('defaults to the sandboxed transport and the documented constants', () => {
    const settings = codexSdkSettingsFromEnv();
    expect(settings.sandboxMode).toBe('read-only');
    expect(settings.timeoutMs).toBeUndefined();
    expect(CODEX_SDK_DEFAULT_MODEL).toBe('gpt-5.6-codex');
    expect(CODEX_SDK_DEFAULT_TIMEOUT_MS).toBe(900_000);
  });

  it('reads the deployment environment', () => {
    process.env.CODEX_API_KEY = 'sk-test';
    process.env.OPENAI_API_KEY = 'sk-fallback';
    process.env.CODEX_BASE_URL = 'https://example.test/v1';
    process.env.CODEX_PATH = '/opt/codex/bin/codex';
    process.env.CODEX_MODEL = 'gpt-5.5-codex';
    process.env.OPENMAIC_CODEX_WORKDIR = '/tmp/codex-work';
    process.env.OPENMAIC_CODEX_SANDBOX = 'workspace-write';
    process.env.OPENMAIC_CODEX_TIMEOUT_MS = '5000';

    expect(codexSdkSettingsFromEnv()).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://example.test/v1',
      codexPathOverride: '/opt/codex/bin/codex',
      model: 'gpt-5.5-codex',
      workingDirectory: '/tmp/codex-work',
      sandboxMode: 'workspace-write',
      timeoutMs: 5000,
    });
  });

  it('prefers OPENMAIC_CODEX_MODEL over CODEX_MODEL and ignores a bad timeout', () => {
    process.env.CODEX_MODEL = 'from-codex';
    process.env.OPENMAIC_CODEX_MODEL = 'from-openmaic';
    process.env.OPENMAIC_CODEX_TIMEOUT_MS = 'not-a-number';
    const settings = codexSdkSettingsFromEnv();
    expect(settings.model).toBe('from-openmaic');
    expect(settings.timeoutMs).toBeUndefined();
  });

  it('falls back to read-only for an unknown sandbox value', () => {
    process.env.OPENMAIC_CODEX_SANDBOX = 'yolo';
    expect(codexSdkSettingsFromEnv().sandboxMode).toBe('read-only');
  });

  it('lets explicit overrides win over the environment', () => {
    process.env.CODEX_MODEL = 'from-env';
    process.env.OPENMAIC_CODEX_SANDBOX = 'danger-full-access';
    expect(codexSdkSettingsFromEnv({ model: 'explicit', sandboxMode: 'read-only' })).toMatchObject({
      model: 'explicit',
      sandboxMode: 'read-only',
    });
  });
});

describe('codexThreadOptions', () => {
  it('pins a transport turn: no approvals, no network, no web search, no git check', () => {
    expect(codexThreadOptions({ model: 'gpt-5.6-codex', reasoningEffort: 'high' })).toEqual({
      sandboxMode: 'read-only',
      skipGitRepoCheck: true,
      approvalPolicy: 'never',
      networkAccessEnabled: false,
      webSearchMode: 'disabled',
      model: 'gpt-5.6-codex',
      modelReasoningEffort: 'high',
    });
  });

  it('omits model fields the settings do not set', () => {
    const options = codexThreadOptions({});
    expect(options).not.toHaveProperty('model');
    expect(options).not.toHaveProperty('modelReasoningEffort');
    expect(options).not.toHaveProperty('workingDirectory');
  });
});

describe('describeCodexSdkError', () => {
  it('turns a missing platform binary into an install hint', () => {
    expect(
      describeCodexSdkError(
        new Error('Unable to locate Codex CLI binaries for x86_64-unknown-linux-musl.'),
      ),
    ).toContain('Codex CLI is not installed for this platform');
  });

  it('turns an auth failure into a login hint', () => {
    const message = describeCodexSdkError(new Error('not logged in'));
    expect(message).toContain('Codex is not authenticated');
    expect(message).toContain('CODEX_API_KEY');
  });

  it('keeps an actionable upstream message verbatim', () => {
    expect(describeCodexSdkError(new Error('model gpt-x not found'))).toBe('model gpt-x not found');
  });

  it('has a message for a non-Error failure', () => {
    expect(describeCodexSdkError(undefined)).toBe('Codex turn failed');
  });
});

describe('collectCodexTurn', () => {
  it('folds items, the final message and usage into a turn', async () => {
    const turn = await collectCodexTurn(
      events(
        { type: 'thread.started', thread_id: 't1' },
        { type: 'turn.started' },
        { type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: 'think' } },
        { type: 'item.completed', item: { id: 'a1', type: 'agent_message', text: 'hello' } },
        {
          type: 'turn.completed',
          usage: {
            input_tokens: 10,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 5,
            reasoning_output_tokens: 2,
          },
        },
      ),
    );
    expect(turn.finalResponse).toBe('hello');
    expect(turn.items.map((item) => item.type)).toEqual(['reasoning', 'agent_message']);
    expect(turn.usage).toMatchObject({ input_tokens: 10, output_tokens: 5 });
  });

  it('throws on turn.failed with the actionable message', async () => {
    await expect(
      collectCodexTurn(events({ type: 'turn.failed', error: { message: 'unauthorized (401)' } })),
    ).rejects.toThrow('Codex is not authenticated');
  });

  it('throws on a fatal stream error', async () => {
    await expect(collectCodexTurn(events({ type: 'error', message: 'boom' }))).rejects.toThrow(
      'boom',
    );
  });
});
