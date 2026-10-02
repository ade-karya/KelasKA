import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyStopSequences,
  buildCliWarnings,
  buildOpencodeArgs,
  buildSamplingHints,
  buildThinkingHints,
  buildToolCallRepairInstructions,
  buildToolCallingInstructions,
  cliThinkingEffort,
  createOpencodeCliModel,
  createOpencodeStreamParser,
  estimateTokens,
  findOpencodeBin,
  flattenPromptToText,
  parseAndValidateToolCalls,
  parseToolCallsFromText,
  resetOpencodeBinCache,
  runOpencodeCli,
  toCliModelId,
  toolCallsAllowed,
  validateToolCallArgs,
} from '@/lib/ai/opencode-cli';

function writeStub(name: string, body: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-test-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

const SUCCESS_STUB = `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi
if [[ -n "$OPENCODE_STUB_STDIN_CAPTURE" ]]; then cat > "$OPENCODE_STUB_STDIN_CAPTURE"; else cat > /dev/null; fi
echo '{"type":"step_start","sessionID":"ses_test123"}'
echo '{"type":"text","part":{"text":"Halo "}}'
echo 'baris log non-JSON, harus diabaikan'
echo '{"type":"text","part":{"text":"dunia"}}'
echo '{"type":"tool_use","sessionID":"ses_test123","part":{"tool":"read","callID":"c1","state":{"status":"completed"}}}'
exit 0
`;

const ERROR_STUB = `#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi
cat > /dev/null
echo "FATA[0000] not logged in" >&2
exit 1
`;

describe('opencode-cli bridge (pola open-design runtimes/)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_STUB_STDIN_CAPTURE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
  });

  it('memetakan model id ke bentuk -m CLI (provider/model)', () => {
    expect(toCliModelId('big-pickle')).toBe('opencode/big-pickle');
    expect(toCliModelId('opencode/big-pickle')).toBe('opencode/big-pickle');
  });

  it('memetakan slug provider go (opencode-go/gpt-6-luna)', () => {
    expect(toCliModelId('gpt-6-luna', 'opencode-go')).toBe('opencode-go/gpt-6-luna');
    expect(toCliModelId('opencode-go/gpt-6-luna', 'opencode')).toBe('opencode-go/gpt-6-luna');
    expect(toCliModelId('big-pickle', 'opencode-go')).toBe('opencode-go/big-pickle');
    expect(buildOpencodeArgs('gpt-6-luna', 'opencode-go')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      'opencode-go/gpt-6-luna',
    ]);
  });

  it('runOpencodeCli meneruskan slug go ke argv CLI', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-argv-'));
    const argvPath = path.join(dir, 'argv');
    const stub = writeStub(
      'opencode-argv-capture',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'printf \'%s\\n\' "$@" > "$OPENCODE_STUB_ARGV_CAPTURE"\n' +
        'echo \'{"type":"text","part":{"text":"ok"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_ARGV_CAPTURE', argvPath);
    await runOpencodeCli({ modelId: 'gpt-6-luna', cliProvider: 'opencode-go', promptText: 'hi' });
    const argv = fs.readFileSync(argvPath, 'utf8').split('\n').filter(Boolean);
    expect(argv).toEqual(['run', '--format', 'json', '--auto', '-m', 'opencode-go/gpt-6-luna']);
    delete process.env.OPENCODE_STUB_ARGV_CAPTURE;
  });

  it('createOpencodeCliModel mewarisi slug provider registry', () => {
    const go = createOpencodeCliModel('gpt-6-luna', 'opencode-go') as unknown as {
      provider: string;
      modelId: string;
    };
    expect(go.provider).toBe('opencode-go');
    expect(go.modelId).toBe('gpt-6-luna');
    const def = createOpencodeCliModel('big-pickle') as unknown as { provider: string };
    expect(def.provider).toBe('opencode');
  });

  it('meratakan prompt SDK menjadi teks berlabel peran', () => {
    const text = flattenPromptToText([
      { role: 'system', content: [{ type: 'text', text: 'Kamu guru.' }] },
      { role: 'user', content: [{ type: 'text', text: 'Jelaskan fotosintesis.' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Baik.' }] },
      { role: 'user', content: [{ type: 'file', mediaType: 'image/png' }] },
      { role: 'user', content: [{ type: 'text', text: '   ' }] },
    ]);
    expect(text).toContain('[system]\nKamu guru.');
    expect(text).toContain('[user]\nJelaskan fotosintesis.');
    expect(text).toContain('[assistant]\nBaik.');
    expect(text).toContain('[lampiran image/png');
  });

  it('paritas riwayat: tool-call pertahankan argumen, tool-result tidak dipotong', () => {
    const longBody = 'x'.repeat(5000);
    const text = flattenPromptToText([
      {
        role: 'assistant',
        content: [{ type: 'tool-call', toolName: 'read', input: { path: 'SKILL.md' } }],
      },
      {
        role: 'tool',
        content: [{ type: 'tool-result', toolName: 'read', output: longBody }],
      },
    ]);
    // Argumen dipertahankan (bukan nama saja) — paritas pesan terstruktur ber-key.
    expect(text).toContain('[tool-call read');
    expect(text).toContain('SKILL.md');
    // Badan panjang (SKILL.md) utuh — dulu dipotong 2000 char.
    expect(text).toContain(longBody);
    expect(text.length).toBeGreaterThan(5000);
  });

  it('paritas sampling: hint prompt + stopSequences nyata + estimasi token', () => {
    expect(buildSamplingHints({ prompt: [] })).toBe('');
    const hints = buildSamplingHints({
      prompt: [],
      maxOutputTokens: 500,
      temperature: 0.1,
      stopSequences: ['STOP'],
    });
    expect(hints).toContain('500');
    expect(hints).toContain('deterministik');
    expect(hints).toContain('STOP');
    expect(applyStopSequences('halo STOP dunia', ['STOP'])).toBe('halo ');
    expect(applyStopSequences('halo dunia', ['STOP'])).toBe('halo dunia');
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('parser menoleransi baris non-JSON dan menangkap teks + sesi + tool', () => {
    const deltas: string[] = [];
    const sessions: string[] = [];
    const parser = createOpencodeStreamParser({
      onText: (d) => deltas.push(d),
      onSessionId: (s) => sessions.push(s),
    });
    parser.feed('{"type":"step_start","sessionID":"ses_1"}\n');
    parser.feed(
      '{"type":"text","part":{"text":"a"}}\nlog mentah\n{"type":"text","part":{"text":"b"}}\n',
    );
    parser.feed('{"type":"tool_use","part":{"tool":"bash","callID":"t9"}}\n{"incomplete": ');
    const result = parser.finish();
    expect(deltas).toEqual(['a', 'b']);
    expect(result.text).toBe('ab');
    expect(sessions).toEqual(['ses_1']);
    expect(result.sessionId).toBe('ses_1');
    expect(result.toolUses).toEqual([{ id: 't9', name: 'bash' }]);
    expect(result.error).toBeNull();
  });

  it('parser menangkap event error', () => {
    const parser = createOpencodeStreamParser();
    parser.feed('{"type":"session.error","message":"boom"}\n');
    expect(parser.finish().error).toBe('boom');
  });

  it('warnings paritas: sampling dipetakan ke prompt (tanpa warning), hanya seed + non-function diwarning', () => {
    const warnings = buildCliWarnings({
      prompt: [],
      temperature: 0.5,
      maxOutputTokens: 1000,
      stopSequences: ['STOP'],
      tools: [
        { type: 'function', name: 'catat_nilai' },
        { type: 'other', name: 'aneh' },
      ],
    });
    // Sampling yang dipetakan ke instruksi prompt TIDAK diwarning (paritas ber-key).
    expect(warnings.filter((w) => w.type === 'unsupported-setting')).toEqual([]);
    expect(warnings).toContainEqual(
      expect.objectContaining({
        type: 'unsupported-tool',
        tool: expect.objectContaining({ name: 'aneh' }),
      }),
    );
    expect(
      warnings.filter(
        (w) =>
          w.type === 'unsupported-tool' && (w.tool as { name?: string }).name === 'catat_nilai',
      ),
    ).toEqual([]);
    expect(buildCliWarnings({ prompt: [], seed: 42 })).toContainEqual(
      expect.objectContaining({ type: 'unsupported-setting', setting: 'seed' }),
    );
    expect(buildCliWarnings({ prompt: [] })).toEqual([]);
  });

  it('runOpencodeCli mengeksekusi stub, prompt via stdin, hasil teks tersambung', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    const capture = path.join(path.dirname(stub), 'stdin.txt');
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', capture);

    const result = await runOpencodeCli({ modelId: 'big-pickle', promptText: 'Jelaskan X.' });
    expect(result.text).toBe('Halo dunia');
    expect(result.sessionId).toBe('ses_test123');
    expect(result.toolUses).toEqual([{ id: 'c1', name: 'read' }]);
    // Prompt dikirim via stdin (bukan argv) — bukti file capture.
    expect(fs.readFileSync(capture, 'utf8')).toBe('Jelaskan X.');
  }, 30_000);

  it('runOpencodeCli melempar error deskriptif saat CLI gagal', async () => {
    const stub = writeStub('opencode-fail', ERROR_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    await expect(runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' })).rejects.toThrow(
      /exit 1.*not logged in.*opencode auth login/s,
    );
  }, 30_000);

  it('runOpencodeCli menandai kegagalan auth dengan statusCode 401 (fail-fast)', async () => {
    const stub = writeStub('opencode-fail', ERROR_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { statusCode?: number }).statusCode).toBe(401);
  }, 30_000);

  it('runOpencodeCli TIDAK menandai kegagalan non-auth dengan 401 (tetap bisa retry)', async () => {
    const stub = writeStub(
      'opencode-fail-generic',
      '#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\ncat > /dev/null\necho "boom: model overloaded, try again" >&2\nexit 2\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { statusCode?: number }).statusCode).toBeUndefined();
  }, 30_000);

  it('error event di stdout (bukan stderr) tetap muncul di pesan gagal', async () => {
    // opencode v2 melaporkan error sebagai event NDJSON di stdout lalu Exit 1
    // dengan stderr KOSONG. Dulu detail ini dibuang dan yang tampil hanya
    // "exit 1" + petunjuk auth, sehingga penyebab sebenarnya tak terlihat.
    const stub = writeStub(
      'opencode-no-route',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"error","sessionID":"ses_x","error":{"type":"provider.no-route","message":"Model unavailable: opencode/gpt-6-luna"}}\'\n' +
        'exit 1\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'gpt-6-luna', promptText: 'hi' }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('Model unavailable: opencode/gpt-6-luna');
    expect((err as Error).message).toContain('exit 1');
  }, 30_000);

  it('model tidak tersedia = 400 fail-fast, BUKAN 401 auth', async () => {
    const stub = writeStub(
      'opencode-no-route-2',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"error","error":{"type":"provider.no-route","message":"Model unavailable: opencode/typo"}}\'\n' +
        'exit 1\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'typo', promptText: 'hi' }).catch((e) => e);
    // Salah konfigurasi tidak akan tertolong oleh retry.
    expect((err as Error & { statusCode?: number }).statusCode).toBe(400);
    // Petunjuk auth hanya menyesatkan di sini; yang relevan = daftar model.
    expect((err as Error).message).not.toMatch(/opencode auth login/);
    expect((err as Error).message).toMatch(/opencode models/);
  }, 30_000);

  it('hint auth tetap muncul untuk kegagalan auth yang konsisten', async () => {
    const stub = writeStub('opencode-auth', ERROR_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' }).catch((e) => e);
    expect((err as Error).message).toMatch(/opencode auth login/);
    expect((err as Error & { statusCode?: number }).statusCode).toBe(401);
  }, 30_000);

  it('runOpencodeCli melempar petunjuk instal saat binary tidak ada', async () => {
    const emptyPath = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-empty-path-'));
    vi.stubEnv('OPENCODE_BIN', '/tidak/ada/opencode-xyz');
    vi.stubEnv('PATH', emptyPath);
    vi.stubEnv('HOME', emptyPath);
    await expect(runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' })).rejects.toThrow(
      /opencode\.ai\/v2\/install/,
    );
  }, 30_000);

  it('runOpencodeCli timeout membunuh proses (SIGKILL)', async () => {
    const stub = writeStub(
      'opencode-slow',
      '#!/usr/bin/env bash\nif [[ "$1" == "--version" ]]; then echo ok; exit 0; fi\ncat > /dev/null\nsleep 30\nexit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    await expect(
      runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi', timeoutMs: 300 }),
    ).rejects.toThrow(/timeout setelah 300ms/);
  }, 30_000);

  it('findOpencodeBin memakai OPENCODE_BIN dan memvalidasi via --version', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    // Sanity: stub benar-benar executable.
    expect(execFileSync(stub, ['--version']).toString()).toContain('opencode-test');
    expect(await findOpencodeBin()).toBe(stub);
  }, 30_000);

  it('model LanguageModel mengembalikan teks + finish stop via doGenerate (spec v3)', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle');
    expect(model.provider).toBe('opencode');
    expect(model.modelId).toBe('big-pickle');
    expect((model as unknown as { specificationVersion: string }).specificationVersion).toBe('v3');
    const result = await (
      model as unknown as {
        doGenerate: (o: unknown) => Promise<{
          content: Array<{ type: string; text: string }>;
          finishReason: { unified: string };
          usage: { inputTokens: { total: number }; outputTokens: { total: number } };
          warnings: unknown[];
        }>;
      }
    ).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Sapa.' }] }],
      tools: [{ type: 'function', name: 'catat' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'Halo dunia' }]);
    expect(result.finishReason).toMatchObject({ unified: 'stop' });
    // Usage diestimasi (bukan nol) agar paritas cost/compaction jalur ber-key.
    expect(result.usage.inputTokens.total).toBeGreaterThan(0);
    expect(result.usage.outputTokens.total).toBeGreaterThan(0);
    // Function tool tidak lagi diwarning (didukung via envelope).
    expect(
      (result.warnings as Array<{ type: string }>).filter((w) => w.type === 'unsupported-tool'),
    ).toEqual([]);
  }, 30_000);

  it('doStream mengalirkan text-delta live lalu finish v3', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doStream: (o: unknown) => Promise<{ stream: ReadableStream<Record<string, unknown>> }>;
    };
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Sapa.' }] }],
    });
    const parts: Record<string, unknown>[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const types = parts.map((p) => p.type);
    expect(types[0]).toBe('stream-start');
    expect(types).toContain('text-delta');
    expect(
      parts
        .filter((p) => p.type === 'text-delta')
        .map((p) => p.delta)
        .join(''),
    ).toBe('Halo dunia');
    expect(types[types.length - 1]).toBe('finish');
    expect(parts[parts.length - 1]).toMatchObject({
      finishReason: { unified: 'stop' },
    });
  }, 30_000);
});

describe('opencode-cli tool calling via envelope JSON', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
    delete process.env.OPENCODE_BIN;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
  });

  it('toolCallsAllowed false hanya untuk toolChoice none', () => {
    expect(toolCallsAllowed(undefined)).toBe(true);
    expect(toolCallsAllowed('auto')).toBe(true);
    expect(toolCallsAllowed('none')).toBe(false);
    expect(toolCallsAllowed({ type: 'none' })).toBe(false);
    expect(toolCallsAllowed({ type: 'tool', toolName: 'x' })).toBe(true);
  });

  it('instruksi memuat nama tool + skema + aturan pagar', () => {
    const text = buildToolCallingInstructions(
      [{ name: 'baca', description: 'Baca data', inputSchema: { type: 'object' } }],
      'auto',
    );
    expect(text).toContain('```tool_calls');
    expect(text).toContain('- baca: Baca data');
    expect(text).toContain('"type":"object"');
    expect(
      buildToolCallingInstructions([{ name: 'wajib' }], { type: 'tool', toolName: 'wajib' }),
    ).toContain('MUST emit a call to "wajib"');
  });

  it('parse: pagar eksplisit + teks pendahulu + multi-call', () => {
    const parsed = parseToolCallsFromText(
      'Baik, saya panggil dulu.\n```tool_calls\n{"tool_calls":[{"name":"a","arguments":{"x":1}},{"name":"b","arguments":{}}]}\n```',
      new Set(['a', 'b']),
    );
    expect(parsed?.leadingText).toBe('Baik, saya panggil dulu.');
    expect(parsed?.calls).toEqual([
      { name: 'a', args: { x: 1 } },
      { name: 'b', args: {} },
    ]);
  });

  it('parse: nama tak terdaftar dan args rusak dibuang; tanpa panggilan valid jadi null', () => {
    expect(
      parseToolCallsFromText(
        '```tool_calls\n{"tool_calls":[{"name":"asing","arguments":{}},{"name":"a","arguments":"bukan-json"}]}\n```',
        new Set(['a']),
      ),
    ).toBeNull();
    expect(parseToolCallsFromText('Halo dunia biasa.', new Set(['a']))).toBeNull();
    expect(parseToolCallsFromText('```json\n{"bukan":"envelope"}\n```', new Set(['a']))).toBeNull();
  });

  it('parse: arguments string-JSON diterima; SEMUA blok valid dipakai berurutan (paritas paralel native)', () => {
    const parsed = parseToolCallsFromText(
      '```tool_calls\n{"tool_calls":[{"name":"a","arguments":{"x":1}}]}\n```\nlanjut\n```tool_calls\n{"tool_calls":[{"name":"a","arguments":"{\\"x\\":2}"}]}\n```',
      new Set(['a']),
    );
    expect(parsed?.calls).toEqual([
      { name: 'a', args: { x: 1 } },
      { name: 'a', args: { x: 2 } },
    ]);
    // leadingText = teks sebelum blok PERTAMA (tengah antar-blok bukan narasi).
    expect(parsed?.leadingText).toBe('');
  });

  it('validateToolCallArgs: required/type/enum/additionalProperties; komposit dilewati', () => {
    const schema = {
      type: 'object',
      required: ['q'],
      properties: {
        q: { type: 'string' },
        n: { type: 'integer', enum: [1, 2] },
      },
      additionalProperties: false,
    };
    expect(validateToolCallArgs(schema, { q: 'halo', n: 1 })).toEqual([]);
    expect(validateToolCallArgs(schema, { n: 1 })[0]).toMatch(/\.q wajib diisi/);
    expect(validateToolCallArgs(schema, { q: 42 })[0]).toMatch(/bertipe string/);
    expect(validateToolCallArgs(schema, { q: 'x', n: 3 })[0]).toMatch(/salah satu dari/);
    expect(validateToolCallArgs(schema, { q: 'x', asing: 1 })[0]).toMatch(/tidak dikenal/);
    // Bersarang + array items ikut divalidasi.
    const nested = {
      type: 'object',
      properties: { daftar: { type: 'array', items: { type: 'object', required: ['id'] } } },
    };
    expect(validateToolCallArgs(nested, { daftar: [{ id: 1 }, {}] })[0]).toMatch(
      /daftar\[1\]\.id wajib diisi/,
    );
    // Skema komposit / bukan-objek tak pernah false-reject.
    expect(validateToolCallArgs({ anyOf: [{ type: 'string' }] }, { apa: 'saja' })).toEqual([]);
    expect(validateToolCallArgs(undefined, { apa: 'saja' })).toEqual([]);
    expect(validateToolCallArgs('bukan-skema', { apa: 'saja' })).toEqual([]);
  });

  it('parseAndValidateToolCalls: nama asing + schema error jadi diagnostics (bukan panggilan)', () => {
    const tools = [{ name: 'jawab', inputSchema: { type: 'object', required: ['teks'] } }];
    const parsed = parseAndValidateToolCalls(
      '```tool_calls\n{"tool_calls":[{"name":"asing","arguments":{}},{"name":"jawab","arguments":{}}]}\n```',
      tools,
    );
    expect(parsed.calls).toEqual([]);
    expect(parsed.attempted).toBe(true);
    expect(parsed.diagnostics.join(' | ')).toMatch(/tidak terdaftar/);
    expect(parsed.diagnostics.join(' | ')).toMatch(/wajib diisi/);
  });

  it('buildToolCallRepairInstructions memuat alasan + format fence', () => {
    const text = buildToolCallRepairInstructions(['tool "x" tidak terdaftar']);
    expect(text).toContain('```tool_calls');
    expect(text).toContain('tool "x" tidak terdaftar');
  });

  it('doGenerate dengan tools mengembalikan tool-call + finish tool-calls (v3)', async () => {
    const stub = writeStub(
      'opencode-envelope',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"step_start","sessionID":"ses_env"}\'\n' +
        'echo \'{"type":"text","part":{"text":"Siap, panggil tool dulu."}}\'\n' +
        'echo \'{"type":"text","part":{"text":"\\n```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"jawab\\",\\"arguments\\":{\\"teks\\":\\"halo\\"}}]}\\n```"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{
        content: Array<{ type: string; toolName?: string; input?: string; text?: string }>;
        finishReason: { unified: string };
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Kerjakan.' }] }],
      tools: [{ type: 'function', name: 'jawab', inputSchema: { type: 'object' } }],
    });
    expect(result.finishReason).toMatchObject({ unified: 'tool-calls' });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Siap, panggil tool dulu.' });
    expect(result.content[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'jawab',
      input: '{"teks":"halo"}',
    });
    expect((result.content[1] as { toolCallId?: string }).toolCallId).toMatch(/^oc-/);
  }, 30_000);

  it('doGenerate toolChoice none mengabaikan envelope (v3)', async () => {
    const stub = writeStub(
      'opencode-envelope-none',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"text","part":{"text":"```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"jawab\\",\\"arguments\\":{}}]}\\n```"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{
        content: Array<{ type: string }>;
        finishReason: { unified: string };
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hai.' }] }],
      tools: [{ type: 'function', name: 'jawab' }],
      toolChoice: { type: 'none' },
    });
    expect(result.finishReason).toMatchObject({ unified: 'stop' });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
  }, 30_000);

  it('doGenerate me-repair SEKALI bila fence pertama tak valid (lalu tool-calls)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-repair-'));
    const countFile = path.join(dir, 'count');
    const stub = writeStub(
      'opencode-repair',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'n=$(cat "$OPENCODE_STUB_COUNT" 2>/dev/null || echo 0)\n' +
        'n=$((n+1)); echo "$n" > "$OPENCODE_STUB_COUNT"\n' +
        'if [[ "$n" == "1" ]]; then\n' +
        '  echo \'{"type":"text","part":{"text":"```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"asing\\",\\"arguments\\":{}}]}\\n```"}}\'\n' +
        'else\n' +
        '  echo \'{"type":"text","part":{"text":"```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"jawab\\",\\"arguments\\":{\\"teks\\":\\"halo\\"}}]}\\n```"}}\'\n' +
        'fi\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_COUNT', countFile);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{
        content: Array<{ type: string; toolName?: string; input?: string }>;
        finishReason: { unified: string };
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Kerjakan.' }] }],
      tools: [{ type: 'function', name: 'jawab', inputSchema: { type: 'object' } }],
    });
    expect(result.finishReason).toMatchObject({ unified: 'tool-calls' });
    expect(result.content[0]).toMatchObject({
      type: 'tool-call',
      toolName: 'jawab',
      input: '{"teks":"halo"}',
    });
    expect(Number(fs.readFileSync(countFile, 'utf8').trim())).toBe(2);
    delete process.env.OPENCODE_STUB_COUNT;
  }, 30_000);

  it('doGenerate TIDAK me-repair jawaban teks biasa (hemat panggilan)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-norepair-'));
    const countFile = path.join(dir, 'count');
    const stub = writeStub(
      'opencode-norepair',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'n=$(cat "$OPENCODE_STUB_COUNT" 2>/dev/null || echo 0)\n' +
        'n=$((n+1)); echo "$n" > "$OPENCODE_STUB_COUNT"\n' +
        'echo \'{"type":"text","part":{"text":"Sudah selesai, tidak perlu tool."}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_COUNT', countFile);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{
        content: Array<{ type: string; text?: string }>;
        finishReason: { unified: string };
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hai.' }] }],
      tools: [{ type: 'function', name: 'jawab' }],
    });
    expect(result.finishReason).toMatchObject({ unified: 'stop' });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect(Number(fs.readFileSync(countFile, 'utf8').trim())).toBe(1);
    delete process.env.OPENCODE_STUB_COUNT;
  }, 30_000);

  it('prompt stdin: responseFormat JSON + tools memakai instruksi gabungan (fence utama)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-fmt-'));
    const stdinPath = path.join(dir, 'stdin');
    const stub = writeStub(
      'opencode-fmt',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > "$OPENCODE_STUB_STDIN_CAPTURE"\n' +
        'echo \'{"type":"text","part":{"text":"{\\"ok\\":true}"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', stdinPath);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string }> }>;
    };
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hai.' }] }],
      tools: [{ type: 'function', name: 'jawab' }],
      responseFormat: { type: 'json' },
    });
    const stdin = fs.readFileSync(stdinPath, 'utf8');
    expect(stdin).toContain('```tool_calls');
    expect(stdin).toContain('fence lebih utama');
    expect(stdin).not.toContain('Balas HANYA dengan JSON valid, tanpa teks lain di luar JSON.');
    delete process.env.OPENCODE_STUB_STDIN_CAPTURE;
  }, 30_000);

  it('doGenerate stopSequences memotong nyata (paritas ber-key)', async () => {
    const stub = writeStub(
      'opencode-stop',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"text","part":{"text":"halo STOP dunia"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hai.' }] }],
      stopSequences: ['STOP'],
    });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'halo ' });
  }, 30_000);

  it('doStream dengan tools memancarkan tool-call + finish tool-calls (envelope tidak bocor)', async () => {
    const stub = writeStub(
      'opencode-envelope-stream',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"text","part":{"text":"Proses.\\n```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"jawab\\",\\"arguments\\":{\\"n\\":1}}]}\\n```"}}\'\n' +
        'exit 0\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doStream: (o: unknown) => Promise<{ stream: ReadableStream<Record<string, unknown>> }>;
    };
    const { stream } = await model.doStream({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Kerjakan.' }] }],
      tools: [{ type: 'function', name: 'jawab' }],
    });
    const parts: Record<string, unknown>[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    const types = parts.map((p) => p.type);
    expect(types).toContain('tool-call');
    expect(types[types.length - 1]).toBe('finish');
    expect(parts[parts.length - 1]).toMatchObject({ finishReason: { unified: 'tool-calls' } });
    const toolCall = parts.find((p) => p.type === 'tool-call') as {
      toolName?: string;
      input?: string;
    };
    expect(toolCall.toolName).toBe('jawab');
    expect(toolCall.input).toBe('{"n":1}');
    // Envelope mentah tidak boleh bocor sebagai teks ke pengguna.
    const textOut = parts
      .filter((p) => p.type === 'text-delta')
      .map((p) => String(p.delta ?? ''))
      .join('');
    expect(textOut).not.toContain('tool_calls');
    expect(textOut).toContain('Proses.');
  }, 30_000);

  it('loop generateText penuh: tool dieksekusi SDK lalu model lanjut (uang muka multi-step)', async () => {
    const { generateText, stepCountIs, tool } = await import('ai');
    const { z } = await import('zod');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openmaic-opencode-looptest-'));
    const stub = path.join(dir, 'opencode');
    const counter = path.join(dir, 'counter');
    fs.writeFileSync(
      stub,
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        `n=$(cat "${counter}" 2>/dev/null || echo 0); echo $((n+1)) > "${counter}"\n` +
        'echo \'{"type":"step_start","sessionID":"ses_loop"}\'\n' +
        'if [[ "$n" == "0" ]]; then\n' +
        '  echo \'{"type":"text","part":{"text":"Panggil jawab.\\n```tool_calls\\n{\\"tool_calls\\":[{\\"name\\":\\"jawab\\",\\"arguments\\":{\\"teks\\":\\"halo\\"}}]}\\n```"}}\'\n' +
        'else\n' +
        '  echo \'{"type":"text","part":{"text":"selesai"}}\'\n' +
        'fi\n' +
        'exit 0\n',
      { mode: 0o755 },
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const seen: string[] = [];
    const result = await generateText({
      model: createOpencodeCliModel('big-pickle'),
      prompt: 'Mulai.',
      tools: {
        jawab: tool({
          description: 'Jawab sesuatu',
          inputSchema: z.object({ teks: z.string() }),
          execute: async ({ teks }) => {
            seen.push(teks);
            return `diterima:${teks}`;
          },
        }),
      },
      stopWhen: stepCountIs(3),
    });
    expect(seen).toEqual(['halo']);
    expect(result.text).toBe('selesai');
    expect(result.steps.length).toBe(2);
    expect(result.steps[0]?.toolCalls[0]).toMatchObject({ toolName: 'jawab' });
  }, 60_000);
});

describe('opencode-cli thinking variants (prompt-level, tanpa wire-param)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_STUB_STDIN_CAPTURE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
  });

  it('buildThinkingHints: tanpa effort tak ada hint; tiap varian ada instruksinya', () => {
    expect(buildThinkingHints(undefined)).toBe('');
    expect(buildThinkingHints('bogus')).toBe('');
    expect(buildThinkingHints('none')).toContain('LANGSUNG');
    expect(buildThinkingHints('low')).toContain('ringkas');
    expect(buildThinkingHints('medium')).toContain('Seimbangkan');
    expect(buildThinkingHints('high')).toContain('MENDALAM');
    expect(buildThinkingHints('max')).toContain('SEMAKSIMAL');
  });

  it('cliThinkingEffort membaca providerOptions.opencode (case-insensitive, tolak asing)', () => {
    expect(cliThinkingEffort({ prompt: [] })).toBeUndefined();
    expect(
      cliThinkingEffort({
        prompt: [],
        providerOptions: { opencode: { thinkingEffort: 'HIGH' } },
      }),
    ).toBe('high');
    expect(
      cliThinkingEffort({ prompt: [], providerOptions: { opencode: { thinkingEffort: 'bogus' } } }),
    ).toBeUndefined();
  });

  it('doGenerate menyalurkan varian thinking ke stdin sebagai [thinking]', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    const capture = path.join(path.dirname(stub), 'stdin-thinking.txt');
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', capture);

    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      providerOptions: { opencode: { thinkingEffort: 'high' } },
    });
    const stdin = fs.readFileSync(capture, 'utf8');
    expect(stdin).toContain('[thinking]');
    expect(stdin).toContain('MENDALAM');
    expect(stdin).toContain('Hi');
  }, 30_000);

  it('doGenerate tanpa varian thinking tidak menambah blok [thinking]', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    const capture = path.join(path.dirname(stub), 'stdin-nothinking.txt');
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', capture);

    const model = createOpencodeCliModel('big-pickle') as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
    });
    expect(fs.readFileSync(capture, 'utf8')).not.toContain('[thinking]');
  }, 30_000);
});

describe('opencode-cli native #variants (/variants TUI)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_STUB_STDIN_CAPTURE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
  });

  it('cliNativeVariant hanya untuk model+effort terverifikasi', async () => {
    const { cliNativeVariant, OPENCODE_NATIVE_VARIANTS } = await import('@/lib/ai/opencode-cli');
    expect(OPENCODE_NATIVE_VARIANTS['opencode:muse-spark-1.3-contributor-free']).toEqual([
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
    expect(cliNativeVariant('muse-spark-1.3-contributor-free', 'opencode', 'high')).toBe('high');
    // max ditolak CLI untuk muse-spark -> bukan varian natif (jatuh ke hint).
    expect(cliNativeVariant('muse-spark-1.3-contributor-free', 'opencode', 'max')).toBeUndefined();
    expect(cliNativeVariant('big-pickle', 'opencode', 'high')).toBeUndefined();
    // Inferensi keluarga Go: gpt-6-luna memakai set gaya OpenAI.
    expect(cliNativeVariant('gpt-6-luna', 'opencode-go', 'high')).toBe('high');
    expect(cliNativeVariant('gpt-6-luna', 'opencode-go', 'max')).toBeUndefined();
    expect(cliNativeVariant('kimi-k3', 'opencode-go', 'high')).toBeUndefined();
    expect(cliNativeVariant('big-pickle', 'opencode', undefined)).toBeUndefined();
  });

  it('buildOpencodeArgs menempel #variant pada -m', async () => {
    const { buildOpencodeArgs } = await import('@/lib/ai/opencode-cli');
    expect(buildOpencodeArgs('muse-spark-1.3-contributor-free', 'opencode', 'high')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      'opencode/muse-spark-1.3-contributor-free#high',
    ]);
    expect(buildOpencodeArgs('big-pickle', 'opencode')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      'opencode/big-pickle',
    ]);
  });

  it('doGenerate memakai -m#variant natif tanpa blok [thinking]', async () => {
    const stub = writeStub(
      'opencode',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'if [[ -n "$OPENCODE_STUB_ARGV_CAPTURE" ]]; then printf "%s\\n" "$@" > "$OPENCODE_STUB_ARGV_CAPTURE"; fi\n' +
        'if [[ -n "$OPENCODE_STUB_STDIN_CAPTURE" ]]; then cat > "$OPENCODE_STUB_STDIN_CAPTURE"; else cat > /dev/null; fi\n' +
        'echo \'{"type":"text","part":{"text":"ok"}}\'\n' +
        'exit 0\n',
    );
    const capture = path.join(path.dirname(stub), 'stdin-variant.txt');
    const argvCapture = path.join(path.dirname(stub), 'argv-variant.txt');
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', capture);
    vi.stubEnv('OPENCODE_STUB_ARGV_CAPTURE', argvCapture);

    const model = createOpencodeCliModel('muse-spark-1.3-contributor-free') as unknown as {
      doGenerate: (o: unknown) => Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }],
      providerOptions: { opencode: { thinkingEffort: 'high' } },
    });
    expect(result.content[0]).toMatchObject({ type: 'text' });
    const stdin = fs.readFileSync(capture, 'utf8');
    // Varian natif mengatur reasoning di sisi CLI: tanpa hint prompt.
    expect(stdin).not.toContain('[thinking]');
    expect(stdin).toContain('Hi');
    // ...tetapi -m membawa #variant natif.
    const argv = fs.readFileSync(argvCapture, 'utf8').split('\n').filter(Boolean);
    expect(argv).toContain('opencode/muse-spark-1.3-contributor-free#high');
  }, 30_000);
});

describe('opencode-cli variant fallback (inferensi keluarga meleset)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_STUB_STDIN_CAPTURE;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetOpencodeBinCache();
  });

  it('"Variant unavailable" diulang SEKALI tanpa #variant + hint prompt', async () => {
    const stub = writeStub(
      'opencode-variant-fallback',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'if [[ -n "$OPENCODE_STUB_STDIN_CAPTURE" ]]; then cat > "$OPENCODE_STUB_STDIN_CAPTURE"; else cat > /dev/null; fi\n' +
        // argv tercatat hanya saat gagal (bukti varian dipakai lalu dibuang).
        'if printf "%s\\n" "$@" | grep -q "#"; then\n' +
        '  echo \'{"type":"error","sessionID":"ses_v","error":{"type":"provider.no-route","message":"Variant unavailable for opencode-go/gpt-6-luna: high"}}\'\n' +
        '  if [[ -n "$OPENCODE_STUB_ARGV_CAPTURE" ]]; then printf "%s\\n" "$@" > "$OPENCODE_STUB_ARGV_CAPTURE"; fi\n' +
        '  exit 1\n' +
        'fi\n' +
        'echo \'{"type":"text","part":{"text":"ok-tanpa-varian"}}\'\n' +
        'exit 0\n',
    );
    const capture = path.join(path.dirname(stub), 'stdin-fallback.txt');
    const argvCapture = path.join(path.dirname(stub), 'argv-fallback.txt');
    vi.stubEnv('OPENCODE_BIN', stub);
    vi.stubEnv('OPENCODE_STUB_STDIN_CAPTURE', capture);
    vi.stubEnv('OPENCODE_STUB_ARGV_CAPTURE', argvCapture);

    const result = await runOpencodeCli({
      modelId: 'gpt-6-luna',
      cliProvider: 'opencode-go',
      promptText: 'Hi',
      variant: 'high',
    });
    expect(result.text).toBe('ok-tanpa-varian');
    // Upaya pertama memakai #variant ...
    expect(fs.readFileSync(argvCapture, 'utf8').split('\n').filter(Boolean)).toContain(
      'opencode-go/gpt-6-luna#high',
    );
    // ...lalu retry membawa hint prompt sebagai ganti.
    expect(fs.readFileSync(capture, 'utf8')).toContain('[thinking]');
  }, 30_000);

  it('tanpa variant tak ada retry (error model diteruskan apa adanya)', async () => {
    const stub = writeStub(
      'opencode-no-variant-fallback',
      '#!/usr/bin/env bash\n' +
        'if [[ "$1" == "--version" ]]; then echo "opencode-test 0.0.0"; exit 0; fi\n' +
        'cat > /dev/null\n' +
        'echo \'{"type":"error","sessionID":"ses_x","error":{"type":"provider.no-route","message":"Model unavailable: opencode/big-pickle"}}\'\n' +
        'exit 1\n',
    );
    vi.stubEnv('OPENCODE_BIN', stub);
    const err = await runOpencodeCli({ modelId: 'big-pickle', promptText: 'hi' }).catch((e) => e);
    expect((err as Error).message).toContain('Model unavailable');
  }, 30_000);
});
