import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildOpencodeRunArgs,
  createOpencodeAccumulator,
  extractOpencodeStdoutError,
  foldOpencodeJsonEvent,
  isOpencodeCliAvailable,
  OPENCODE_CLI_TIMEOUT_MS,
  OPENCODE_SESSION_TITLE,
  parseOpencodeJsonOutput,
  resolveOpencodeCliPath,
  toOpencodeModelRef,
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
});

describe('buildOpencodeRunArgs', () => {
  it('builds a non-interactive JSON run with attribution title', () => {
    expect(buildOpencodeRunArgs('mimo-v2.6-flash-free', 'Say OK')).toEqual([
      'run',
      '--format',
      'json',
      '--model',
      'opencode/mimo-v2.6-flash-free',
      '--title',
      OPENCODE_SESSION_TITLE,
      'Say OK',
    ]);
    expect(OPENCODE_SESSION_TITLE).toBe('openmaic-llm');
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

  it("treats a tool-calls finish with answer text as a completed turn", () => {
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
