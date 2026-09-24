import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildOpencodeConfigJson,
  buildOpencodeRunArgs,
  createOpencodeAccumulator,
  describeOpencodeFailure,
  extractOpencodeStderrError,
  extractOpencodeStdoutError,
  foldOpencodeJsonEvent,
  isOpencodeCliAvailable,
  isOpencodeModelRef,
  isRetryableOpencodeError,
  listOpencodeModels,
  OPENCODE_CLI_TIMEOUT_MS,
  OPENCODE_MAX_ATTACHMENTS,
  OPENCODE_MODELS_TIMEOUT_MS,
  OPENCODE_SESSION_TITLE,
  parseOpencodeJsonOutput,
  parseOpencodeModelsOutput,
  prepareOpencodeConfigDir,
  prepareOpencodeScratchDir,
  resolveOpencodeCliPath,
  runOpencodePrompt,
  streamOpencodePrompt,
  toOpencodeModelRef,
  writeOpencodeAttachments,
} from '@/lib/ai/opencode-cli';

// Real `--format json` output captured from:
//   opencode run --format json -m opencode/muse-spark-1.3-contributor-free "Reply with exactly: OK"
const REAL_RUN_OUTPUT = [
  '{"type":"step_start","timestamp":1790166723209,"sessionID":"ses_abc","part":{"id":"prt_1","sessionID":"ses_abc","messageID":"msg_1","type":"step-start"}}',
  '{"type":"text","timestamp":1790166723895,"sessionID":"ses_abc","part":{"id":"prt_2","sessionID":"ses_abc","messageID":"msg_1","type":"text","text":"OK","time":{"start":1790166723889,"end":1790166723895}}}',
  '{"type":"step_finish","timestamp":1790166723905,"sessionID":"ses_abc","part":{"id":"prt_3","sessionID":"ses_abc","messageID":"msg_1","type":"step-finish","reason":"stop","cost":0,"tokens":{"input":7752,"output":11,"reasoning":46,"cache":{"read":0,"write":0}}}}',
].join('\n');

describe('toOpencodeModelRef', () => {
  it('prefixes bare model ids with opencode/', () => {
    expect(toOpencodeModelRef('muse-spark-1.3-contributor-free')).toBe(
      'opencode/muse-spark-1.3-contributor-free',
    );
  });

  it('normalizes an already-prefixed ref to a single segment', () => {
    expect(toOpencodeModelRef('opencode/mimo-v2.6-flash-free')).toBe(
      'opencode/mimo-v2.6-flash-free',
    );
  });

  it('preserves the opencode-go paid-tier prefix', () => {
    expect(toOpencodeModelRef('opencode-go/deepseek-v4.1-flash')).toBe(
      'opencode-go/deepseek-v4.1-flash',
    );
  });

  it('normalizes a foreign provider prefix to the free-tier last segment', () => {
    expect(toOpencodeModelRef('anthropic/claude-opus-5')).toBe('opencode/claude-opus-5');
  });
});

describe('isOpencodeModelRef', () => {
  it('accepts both tier refs and rejects bare prefixes or foreign refs', () => {
    expect(isOpencodeModelRef('opencode/big-pickle')).toBe(true);
    expect(isOpencodeModelRef('opencode-go/deepseek-v4-pro')).toBe(true);
    expect(isOpencodeModelRef('opencode/')).toBe(false);
    expect(isOpencodeModelRef('opencode-go/')).toBe(false);
    expect(isOpencodeModelRef('anthropic/claude-opus-5')).toBe(false);
  });
});

describe('parseOpencodeModelsOutput', () => {
  it('parses one provider/model ref per line, preserving order and deduping', () => {
    const stdout = [
      'opencode-go/deepseek-v4-pro',
      'opencode/big-pickle',
      '',
      '  opencode/muse-spark-1.3-contributor-free  ',
      'opencode/big-pickle',
      'not-a-model-ref',
      'Available models:',
    ].join('\n');
    expect(parseOpencodeModelsOutput(stdout)).toEqual([
      'opencode-go/deepseek-v4-pro',
      'opencode/big-pickle',
      'opencode/muse-spark-1.3-contributor-free',
    ]);
  });

  it('strips ANSI colour codes from piped output', () => {
    expect(parseOpencodeModelsOutput('\u001b[32mopencode/big-pickle\u001b[0m')).toEqual([
      'opencode/big-pickle',
    ]);
  });
});

describe('listOpencodeModels', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it('runs `<cli> models` and returns the parsed refs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-models-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(
      fake,
      '#!/bin/sh\nprintf "opencode/big-pickle\\nopencode/mimo-v2.6-flash-free\\n"\n',
      { mode: 0o755 },
    );

    await expect(listOpencodeModels({ cliPath: fake })).resolves.toEqual([
      'opencode/big-pickle',
      'opencode/mimo-v2.6-flash-free',
    ]);
    expect(OPENCODE_MODELS_TIMEOUT_MS).toBe(30_000);
  });

  it('rejects with the exit code when the listing command fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-models-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(fake, '#!/bin/sh\necho "boom" >&2\nexit 3\n', { mode: 0o755 });

    await expect(listOpencodeModels({ cliPath: fake })).rejects.toThrow(/exited with code 3/);
  });

  it('rejects when no CLI binary is available', async () => {
    process.env = { PATH: '/nonexistent-dir-xyz', HOME: '/nonexistent-home-xyz' };
    delete process.env.OPENCODE_CLI_PATH;
    await expect(listOpencodeModels()).rejects.toThrow(/no `opencode` binary/i);
  });
});

describe('buildOpencodeRunArgs', () => {
  it('builds a non-interactive JSON run with attribution title', () => {
    expect(buildOpencodeRunArgs('mimo-v2.6-flash-free', 'Say OK')).toEqual([
      'run',
      '--format',
      'json',
      '--print-logs',
      '--model',
      'opencode/mimo-v2.6-flash-free',
      '--title',
      OPENCODE_SESSION_TITLE,
      'Say OK',
    ]);
    expect(OPENCODE_SESSION_TITLE).toBe('openmaic-llm');
  });

  it('keeps a Go-tier ref intact on the run command', () => {
    expect(buildOpencodeRunArgs('opencode-go/deepseek-v4.1-flash', 'p')).toEqual([
      'run',
      '--format',
      'json',
      '--print-logs',
      '--model',
      'opencode-go/deepseek-v4.1-flash',
      '--title',
      OPENCODE_SESSION_TITLE,
      'p',
    ]);
  });

  it('runs a private server when a per-run MCP config is injected', () => {
    expect(buildOpencodeRunArgs('m', 'p', { standalone: true })).toEqual([
      'run',
      '--standalone',
      '--format',
      'json',
      '--print-logs',
      '--model',
      'opencode/m',
      '--title',
      OPENCODE_SESSION_TITLE,
      'p',
    ]);
  });

  it('requests thinking blocks and attaches files when asked', () => {
    expect(
      buildOpencodeRunArgs('m', 'p', {
        standalone: true,
        thinking: true,
        files: ['/tmp/a.png', '/tmp/b.jpg'],
      }),
    ).toEqual([
      'run',
      '--standalone',
      '--format',
      'json',
      '--thinking',
      '--print-logs',
      '--file',
      '/tmp/a.png',
      '--file',
      '/tmp/b.jpg',
      '--model',
      'opencode/m',
      '--title',
      OPENCODE_SESSION_TITLE,
      'p',
    ]);
  });
});

describe('parseOpencodeJsonOutput', () => {
  it('extracts text and step_finish usage from a real CLI transcript', () => {
    const result = parseOpencodeJsonOutput(REAL_RUN_OUTPUT);
    expect(result.text).toBe('OK');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 7752,
      outputTokens: 11,
      reasoningTokens: 46,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(result.errorMessage).toBeUndefined();
  });

  it('concatenates multi-delta text and ignores log noise', () => {
    const result = parseOpencodeJsonOutput(
      [
        'log line without json',
        '{"type":"text","part":{"type":"text","text":"Hello"}}',
        '{"type":"text","part":{"type":"text","text":" world"}}',
        '',
      ].join('\n'),
    );
    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
  });

  it('maps a length finish reason', () => {
    const result = parseOpencodeJsonOutput(
      '{"type":"step_finish","part":{"reason":"length","tokens":{"input":10,"output":5}}}',
    );
    expect(result.finishReason).toBe('length');
  });

  it('treats a tool-calls finish with answer text as a completed turn', () => {
    // Real CLI shape when its own agent loop used tools: every step_finish
    // carries reason tool-calls. pi never sees those calls (this transport
    // drops caller tools), so the accumulated text IS the turn's answer.
    const result = parseOpencodeJsonOutput(
      [
        '{"type":"text","part":{"type":"text","text":"Rencana kelas fotosintesis."}}',
        '{"type":"step_finish","part":{"reason":"tool-calls","tokens":{"input":7752,"output":11}}}',
      ].join('\n'),
    );
    expect(result.text).toBe('Rencana kelas fotosintesis.');
    expect(result.finishReason).toBe('stop');
  });

  it('keeps a textless tool-calls finish as a loud failure', () => {
    const result = parseOpencodeJsonOutput(
      '{"type":"step_finish","part":{"reason":"tool-calls","tokens":{"input":7752,"output":0}}}',
    );
    expect(result.finishReason).toBe('other');
  });

  it('maps a step error reason to error', () => {
    const result = parseOpencodeJsonOutput(
      '{"type":"step_finish","part":{"reason":"error","tokens":{"input":1,"output":1}}}',
    );
    expect(result.finishReason).toBe('error');
  });

  it('treats an unknown finish reason with answer text as completed', () => {
    const result = parseOpencodeJsonOutput(
      [
        '{"type":"text","part":{"type":"text","text":"Rencana."}}',
        '{"type":"step_finish","part":{"reason":"some-future-reason","tokens":{"input":1,"output":1}}}',
      ].join('\n'),
    );
    expect(result.finishReason).toBe('stop');
  });

  it('keeps an unknown finish reason without answer text as a loud failure', () => {
    const result = parseOpencodeJsonOutput(
      '{"type":"step_finish","part":{"reason":"some-future-reason","tokens":{"input":1,"output":0}}}',
    );
    expect(result.finishReason).toBe('other');
  });

  it('captures error events', () => {
    const result = parseOpencodeJsonOutput('{"type":"error","message":"boom"}');
    expect(result.finishReason).toBe('error');
    expect(result.errorMessage).toBe('boom');
  });

  it('returns empty text on empty output', () => {
    const result = parseOpencodeJsonOutput('');
    expect(result.text).toBe('');
    expect(result.finishReason).toBe('stop');
  });
});

describe('extractOpencodeStdoutError', () => {
  it('returns the CLI-reported message from stdout error events', () => {
    expect(
      extractOpencodeStdoutError(
        [
          '{"type":"text","part":{"type":"text","text":"hi"}}',
          '{"type":"error","message":"Rate limited, retry later"}',
        ].join('\n'),
      ),
    ).toBe('Rate limited, retry later');
  });

  it('prefers the last error event and reads part.message', () => {
    expect(
      extractOpencodeStdoutError(
        [
          '{"type":"step_error","part":{"message":"first"}}',
          'not json',
          '{"type":"message_error","part":{"message":"second"}}',
        ].join('\n'),
      ),
    ).toBe('second');
  });

  it('returns undefined when stdout carries no error event', () => {
    expect(extractOpencodeStdoutError(REAL_RUN_OUTPUT)).toBeUndefined();
    expect(extractOpencodeStdoutError('')).toBeUndefined();
  });

  it('truncates long messages', () => {
    const long = `{"type":"error","message":"${'x'.repeat(600)}"}`;
    expect(extractOpencodeStdoutError(long)?.length).toBeLessThanOrEqual(501);
  });
});

describe('isRetryableOpencodeError', () => {
  it('retries non-zero exits and CLI-reported errors', () => {
    expect(isRetryableOpencodeError(new Error('opencode CLI exited with code 1'))).toBe(true);
    expect(
      isRetryableOpencodeError(new Error('opencode CLI exited with code 1 (CLI reported: boom)')),
    ).toBe(true);
    expect(isRetryableOpencodeError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isRetryableOpencodeError(new Error('fetch failed'))).toBe(true);
  });

  it('never retries aborts, timeouts, or a missing binary', () => {
    const abort = new Error('Operation aborted');
    abort.name = 'AbortError';
    expect(isRetryableOpencodeError(abort)).toBe(false);
    expect(isRetryableOpencodeError(new Error('opencode CLI timed out after 100 ms'))).toBe(false);
    expect(isRetryableOpencodeError(new Error('no `opencode` binary was found. Install it'))).toBe(
      false,
    );
    expect(isRetryableOpencodeError(undefined)).toBe(false);
  });
});

describe('describeOpencodeFailure', () => {
  it('adds the rate-limit hint and the keyed-provider escape hatch', () => {
    const message = describeOpencodeFailure(
      'opencode CLI exited with code 1: AI.Error: Rate limit exceeded. Please try again later.',
    );
    expect(message).toContain('rate-limits');
    expect(message).toContain('OPENAI_API_KEY');
  });

  it('passes a plain failure through unchanged', () => {
    expect(describeOpencodeFailure('opencode CLI exited with code 1')).toBe(
      'opencode CLI exited with code 1',
    );
  });

  it('names an empty failure', () => {
    expect(describeOpencodeFailure('   ')).toBe('opencode CLI run failed with no output');
  });

  it('explains a mid-run server shutdown instead of surfacing a bare exit code', () => {
    const message = describeOpencodeFailure(
      'opencode CLI exited with code 1 (CLI reported: Session interrupted: shutdown)',
    );
    expect(message).toContain('--standalone');
    expect(message).toContain('scratch');
  });

  it('points an MCP connect failure at the bridge URL and the registry', () => {
    const message = describeOpencodeFailure(
      'opencode CLI exited with code 1: timestamp=2026-09-24T02:17:50.783Z level=WARN run=498cedb2 message="mcp connect failed" server=openmaic status.error="tool list failed: HTTP 404"',
    );
    expect(message).toContain('OPENMAIC_MCP_BASE_URL');
    expect(message).toContain('/api/agent/mcp/[token]');
  });
});

describe('buildOpencodeConfigJson / prepareOpencodeConfigDir', () => {
  it('wires MCP servers into the CLI config shape', () => {
    const config = buildOpencodeConfigJson([
      {
        name: 'openmaic',
        command: ['node', '/app/scripts/opencode-mcp-bridge.mjs'],
        environment: { OPENMAIC_SESSION: 's1' },
        codemode: false,
      },
    ]);
    expect(config).toEqual({
      mcp: {
        openmaic: {
          type: 'local',
          command: ['node', '/app/scripts/opencode-mcp-bridge.mjs'],
          environment: { OPENMAIC_SESSION: 's1' },
          codemode: false,
          enabled: true,
          disabled: false,
        },
      },
    });
  });

  it('omits codemode when the caller does not pin it', () => {
    const config = buildOpencodeConfigJson([{ name: 'x', command: ['a'] }]) as {
      mcp: Record<string, Record<string, unknown>>;
    };
    expect(config.mcp.x).not.toHaveProperty('codemode');
    expect(config.mcp.x.type).toBe('local');
  });

  it('writes a private config dir and cleans it up', () => {
    const { dir, cleanup } = prepareOpencodeConfigDir([{ name: 'x', command: ['a'] }]);
    expect(existsSync(join(dir, 'opencode.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8'))).toEqual({
      mcp: { x: { type: 'local', command: ['a'], enabled: true, disabled: false } },
    });
    cleanup();
    expect(existsSync(dir)).toBe(false);
    // Idempotent: a second cleanup must not throw.
    expect(() => cleanup()).not.toThrow();
  });

  it('locks CLI built-ins out when requested, including the native question tool', () => {
    const { dir, cleanup } = prepareOpencodeConfigDir([{ name: 'x', command: ['a'] }], {
      lockBuiltinTools: true,
    });
    const config = JSON.parse(readFileSync(join(dir, 'opencode.json'), 'utf8')) as {
      tools: Record<string, boolean>;
    };
    expect(config.tools.question).toBe(false);
    expect(config.tools.write).toBe(false);
    expect(config.tools.edit).toBe(false);
    // `read` and `shell` stay enabled: the Console gateway rejects free-tier
    // models with 403 when either is disabled (bisected per-flag on v2.0.15).
    expect(config.tools).not.toHaveProperty('read');
    expect(config.tools).not.toHaveProperty('shell');
    // `execute` stays enabled: on this CLI build it is the only path to MCP tools.
    expect(config.tools).not.toHaveProperty('execute');
    cleanup();
  });
});

describe('writeOpencodeAttachments', () => {
  it('materializes attachment bytes with safe names and extensions', async () => {
    const { rmSync } = await import('node:fs');
    const dir = mkdtempSync(join(tmpdir(), 'opencode-attachments-test-'));
    try {
      const paths = writeOpencodeAttachments(
        [
          { mediaType: 'image/png', data: new Uint8Array([1, 2, 3]) },
          { filename: '../../evil.png', mediaType: 'image/png', data: new Uint8Array([4]) },
        ],
        dir,
      );
      expect(paths).toHaveLength(2);
      expect(paths[0].endsWith('.png')).toBe(true);
      expect(readFileSync(paths[0])).toEqual(Buffer.from([1, 2, 3]));
      // Path traversal in the hint must not escape the run directory.
      expect(paths[1].startsWith(dir)).toBe(true);
      expect(paths[1]).not.toContain('..');
      expect(OPENCODE_MAX_ATTACHMENTS).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('foldOpencodeJsonEvent', () => {
  it('accumulates reasoning deltas separately from text', () => {
    const acc = createOpencodeAccumulator();
    foldOpencodeJsonEvent(acc, { type: 'reasoning', part: { text: 'hmm' } });
    const { textDelta } = foldOpencodeJsonEvent(acc, {
      type: 'text',
      part: { type: 'text', text: 'OK' },
    });
    expect(textDelta).toBe('OK');
    expect(acc.text).toBe('OK');
    expect(acc.reasoning).toBe('hmm');
  });

  it('folds a CLI tool_use part into a tool call', () => {
    const acc = createOpencodeAccumulator();
    const { tool } = foldOpencodeJsonEvent(acc, {
      type: 'tool_use',
      part: {
        id: 'call-1',
        tool: 'grep',
        state: { status: 'completed', input: { pattern: 'x' }, output: 'hit' },
      },
    });
    expect(tool).toEqual({
      id: 'call-1',
      name: 'grep',
      input: { pattern: 'x' },
      output: 'hit',
      status: 'completed',
    });
    expect(acc.toolCalls).toHaveLength(1);
  });

  it('upserts repeated events for the same call id', () => {
    const acc = createOpencodeAccumulator();
    foldOpencodeJsonEvent(acc, {
      type: 'tool_use',
      part: { id: 'call-1', tool: 'read', state: { status: 'running' } },
    });
    foldOpencodeJsonEvent(acc, {
      type: 'tool_use',
      part: { id: 'call-1', tool: 'read', state: { status: 'completed', output: 'done' } },
    });
    expect(acc.toolCalls).toHaveLength(1);
    expect(acc.toolCalls[0]).toMatchObject({ status: 'completed', output: 'done' });
  });

  it('exposes tool calls on a parsed completion', () => {
    const result = parseOpencodeJsonOutput(
      [
        '{"type":"text","part":{"type":"text","text":"hasil"}}',
        '{"type":"tool_use","part":{"id":"c1","tool":"openmaic_create_stage","state":{"status":"completed","input":{"title":"Fotosintesis"},"output":"ok"}}}',
      ].join('\n'),
    );
    expect(result.toolCalls).toEqual([
      {
        id: 'c1',
        name: 'openmaic_create_stage',
        input: { title: 'Fotosintesis' },
        output: 'ok',
        status: 'completed',
      },
    ]);
  });

  it('omits toolCalls when the run made none', () => {
    expect(parseOpencodeJsonOutput(REAL_RUN_OUTPUT).toolCalls).toBeUndefined();
  });
});

describe('resolveOpencodeCliPath', () => {
  const envBackup = { ...process.env };

  afterEach(() => {
    process.env = { ...envBackup };
    vi.unstubAllEnvs();
  });

  it('prefers an explicit path when it exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-cli-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(fake, '#!/bin/sh\n');
    expect(resolveOpencodeCliPath(fake)).toBe(fake);
  });

  it('returns undefined when nothing matches', () => {
    process.env = { PATH: '/nonexistent-dir-xyz', HOME: '/nonexistent-home-xyz' };
    delete process.env.OPENCODE_CLI_PATH;
    expect(resolveOpencodeCliPath()).toBeUndefined();
    expect(isOpencodeCliAvailable()).toBe(false);
  });

  it('honors OPENCODE_CLI_PATH', () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-cli-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(fake, '#!/bin/sh\n');
    process.env = { PATH: '/nonexistent-dir-xyz', HOME: '/nonexistent-home-xyz' };
    vi.stubEnv('OPENCODE_CLI_PATH', fake);
    expect(resolveOpencodeCliPath()).toBe(fake);
    expect(isOpencodeCliAvailable()).toBe(true);
  });

  it('exposes a 15-minute default timeout', () => {
    expect(OPENCODE_CLI_TIMEOUT_MS).toBe(15 * 60 * 1000);
  });
});

describe('prepareOpencodeScratchDir', () => {
  it('creates a dir outside the server checkout and cleans it up', () => {
    const { dir, cleanup } = prepareOpencodeScratchDir();
    try {
      expect(dir).toContain('openmaic-opencode-run-');
      expect(dir).not.toBe(process.cwd());
      expect(existsSync(dir)).toBe(true);
    } finally {
      cleanup();
    }
    expect(existsSync(dir)).toBe(false);
    expect(() => cleanup()).not.toThrow();
  });
});

describe('extractOpencodeStderrError', () => {
  const GIT_NOISE = [
    'timestamp=2026-09-24T01:07:10.804Z level=INFO run=32fa907c message="spawning process" command=git args="[\\"--git-dir\\",\\"snap\\",\\"--work-tree\\",\\"/content/KelasKA\\",\\"diff-files\\",\\"--name-only\\"]" cwd=/content/KelasKA role=server',
    'timestamp=2026-09-24T01:07:36.959Z level=INFO run=32fa907c message="watcher stopped" path=/content/KelasKA/AGENTS.md type=file role=server',
    'timestamp=2026-09-24T01:07:36.978Z level=INFO run=32fa907c message="watcher stopped" path=/content/KelasKA type=entries role=server',
  ].join('\n');

  it('drops git snapshot and watcher INFO noise', () => {
    expect(extractOpencodeStderrError(GIT_NOISE)).toBeUndefined();
  });

  it('keeps a real error line instead of snapshot spam', () => {
    const message = extractOpencodeStderrError(
      `${GIT_NOISE}\nAI.Error: Rate limit exceeded. Please try again later.`,
    );
    expect(message).toContain('Rate limit exceeded');
    expect(message).not.toContain('diff-files');
    expect(message).not.toContain('--work-tree');
  });

  it('returns undefined for empty input', () => {
    expect(extractOpencodeStderrError('')).toBeUndefined();
    expect(extractOpencodeStderrError('   \n  ')).toBeUndefined();
  });
});

describe('runOpencodePrompt isolation', () => {
  it('runs standalone in a scratch cwd, never the server checkout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    const record = join(dir, 'record.txt');
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        `echo "ARGS:$@" >> "${record}"`,
        `echo "CWD:$(pwd)" >> "${record}"`,
        `echo "PWD:$PWD" >> "${record}"`,
        'printf \'{"type":"text","part":{"type":"text","text":"OK"}}\\n{"type":"step_finish","part":{"reason":"stop","tokens":{"input":1,"output":1}}}\\n\'',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const completion = await runOpencodePrompt({
      cliPath: fake,
      modelId: 'muse-spark-1.3-contributor-free',
      prompt: 'Say OK',
      maxAttempts: 1,
    });
    expect(completion.text).toBe('OK');

    const recorded = readFileSync(record, 'utf8');
    expect(recorded).toContain('--standalone');
    const cwdLine = recorded.split('\n').find((line) => line.startsWith('CWD:')) ?? '';
    const seenCwd = cwdLine.slice('CWD:'.length);
    expect(seenCwd).toContain('openmaic-opencode-run-');
    expect(seenCwd).not.toBe(process.cwd());
    // The CLI resolves its session directory from PWD (v2 `run.ts`), so PWD
    // must track the scratch cwd — an inherited server PWD would drag the run
    // back into the checkout with its snapshot/watcher state.
    const pwdLine = recorded.split('\n').find((line) => line.startsWith('PWD:')) ?? '';
    expect(pwdLine.slice('PWD:'.length)).toBe(seenCwd);
    // Best-effort cleanup: the scratch dir is removed after the run.
    expect(existsSync(seenCwd)).toBe(false);
  });

  it('respects an explicit cwd (the harness scratch dir)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    const record = join(dir, 'record.txt');
    const explicit = mkdtempSync(join(tmpdir(), 'openmaic-opencode-run-'));
    try {
      writeFileSync(
        fake,
        [
          '#!/bin/sh',
          `echo "ARGS:$@" >> "${record}"`,
          `echo "CWD:$(pwd)" >> "${record}"`,
          'printf \'{"type":"text","part":{"type":"text","text":"OK"}}\\n{"type":"step_finish","part":{"reason":"stop","tokens":{"input":1,"output":1}}}\\n\'',
          'exit 0',
          '',
        ].join('\n'),
        { mode: 0o755 },
      );

      await runOpencodePrompt({
        cliPath: fake,
        modelId: 'm',
        prompt: 'p',
        cwd: explicit,
        maxAttempts: 1,
      });
      const recorded = readFileSync(record, 'utf8');
      expect(recorded).toContain(explicit);
      // An explicit cwd belongs to the caller: the transport must not delete it.
      expect(existsSync(explicit)).toBe(true);
    } finally {
      const { rmSync } = await import('node:fs');
      rmSync(explicit, { recursive: true, force: true });
    }
  });

  it('surfaces the stdout-reported cause instead of git snapshot spam', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        'printf \'{"type":"error","message":"Session interrupted: shutdown"}\\n\'',
        'echo \'timestamp=2026-09-24T01:07:36.846Z level=INFO run=32fa907c message="spawning process" command=git args="[\\"--work-tree\\",\\"/content/KelasKA\\",\\"diff-files\\"]" cwd=/content/KelasKA role=server\' >&2',
        'exit 1',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    await expect(
      runOpencodePrompt({ cliPath: fake, modelId: 'm', prompt: 'p', maxAttempts: 1 }),
    ).rejects.toThrow(/Session interrupted: shutdown/);
    await expect(
      runOpencodePrompt({ cliPath: fake, modelId: 'm', prompt: 'p', maxAttempts: 1 }).catch(
        (err: Error) => err.message,
      ),
    ).resolves.not.toContain('diff-files');
  });
});

describe('streamOpencodePrompt isolation', () => {
  it('streams standalone from a scratch cwd with filtered failures', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    const record = join(dir, 'record.txt');
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        `echo "ARGS:$@" >> "${record}"`,
        `echo "CWD:$(pwd)" >> "${record}"`,
        'printf \'{"type":"text","part":{"type":"text","text":"Hi"}}\\n{"type":"step_finish","part":{"reason":"stop","tokens":{"input":1,"output":1}}}\\n\'',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const events = [];
    for await (const event of streamOpencodePrompt({
      cliPath: fake,
      modelId: 'm',
      prompt: 'p',
      maxAttempts: 1,
    })) {
      events.push(event);
    }
    expect(events.some((event) => event.kind === 'text-delta')).toBe(true);
    const recorded = readFileSync(record, 'utf8');
    expect(recorded).toContain('--standalone');
    expect(recorded).toContain('openmaic-opencode-run-');
  });

  it('yields reasoning deltas when the CLI emits thinking blocks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        'printf \'{"type":"reasoning","part":{"text":"hmm"}}\\n{"type":"text","part":{"type":"text","text":"OK"}}\\n{"type":"step_finish","part":{"reason":"stop","tokens":{"input":1,"output":1,"reasoning":1}}}\\n\'',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const events = [];
    for await (const event of streamOpencodePrompt({
      cliPath: fake,
      modelId: 'm',
      prompt: 'p',
      thinking: true,
      maxAttempts: 1,
    })) {
      events.push(event);
    }
    expect(events).toContainEqual({ kind: 'reasoning-delta', delta: 'hmm' });
    expect(events).toContainEqual({ kind: 'text-delta', delta: 'OK' });
    const done = events.find((event) => event.kind === 'done');
    expect((done as { completion: { reasoning: string } }).completion.reasoning).toBe('hmm');
  });

  it('locks built-ins and passes attachments even with no MCP servers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-isolation-test-'));
    const fake = join(dir, 'opencode');
    const record = join(dir, 'record.txt');
    writeFileSync(
      fake,
      [
        '#!/bin/sh',
        `echo "ARGS:$@" >> "${record}"`,
        `cat "$OPENCODE_CONFIG_DIR/opencode.json" >> "${record}"`,
        'printf \'{"type":"text","part":{"type":"text","text":"OK"}}\\n{"type":"step_finish","part":{"reason":"stop","tokens":{"input":1,"output":1}}}\\n\'',
        'exit 0',
        '',
      ].join('\n'),
      { mode: 0o755 },
    );

    const completion = await runOpencodePrompt({
      cliPath: fake,
      modelId: 'm',
      prompt: 'p',
      thinking: true,
      lockBuiltinTools: true,
      attachments: [{ mediaType: 'image/png', data: new Uint8Array([137, 80]) }],
      maxAttempts: 1,
    });
    expect(completion.text).toBe('OK');
    const recorded = readFileSync(record, 'utf8');
    // A text-only run matches a keyed LLM call: thinking on, one --file, and
    // the CLI built-ins locked out via a private config dir.
    expect(recorded).toContain('--thinking');
    expect(recorded).toContain('--file');
    expect(recorded).toContain('"write":false');
    expect(recorded).toContain('"question":false');
    expect(recorded).not.toContain('"read":false');
  });
});
