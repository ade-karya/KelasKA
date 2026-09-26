import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildCliWarnings,
  buildOpencodeArgs,
  buildToolCallingInstructions,
  createOpencodeCliModel,
  createOpencodeStreamParser,
  findOpencodeBin,
  flattenPromptToText,
  parseToolCallsFromText,
  resetOpencodeBinCache,
  runOpencodeCli,
  toCliModelId,
  toolCallsAllowed,
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

  it('membangun argumen run ala open-design (json, auto, model, tanpa prompt argv)', () => {
    expect(buildOpencodeArgs('big-pickle')).toEqual([
      'run',
      '--format',
      'json',
      '--auto',
      '-m',
      'opencode/big-pickle',
    ]);
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

  it('warnings jujur: function tools didukung (tanpa warning), setting tetap diwarning', () => {
    const warnings = buildCliWarnings({
      prompt: [],
      temperature: 0.5,
      tools: [
        { type: 'function', name: 'catat_nilai' },
        { type: 'other', name: 'aneh' },
      ],
    });
    expect(warnings).toContainEqual(
      expect.objectContaining({ type: 'unsupported-setting', setting: 'temperature' }),
    );
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

  it('model LanguageModel mengembalikan teks + finish stop via doGenerate', async () => {
    const stub = writeStub('opencode', SUCCESS_STUB);
    vi.stubEnv('OPENCODE_BIN', stub);
    const model = createOpencodeCliModel('big-pickle');
    expect(model.provider).toBe('opencode');
    expect(model.modelId).toBe('big-pickle');
    const result = await (
      model as unknown as {
        doGenerate: (o: unknown) => Promise<{
          content: Array<{ type: string; text: string }>;
          finishReason: string;
          warnings: unknown[];
        }>;
      }
    ).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Sapa.' }] }],
      tools: [{ type: 'function', name: 'catat' }],
    });
    expect(result.content).toEqual([{ type: 'text', text: 'Halo dunia' }]);
    expect(result.finishReason).toBe('stop');
    // Function tool tidak lagi diwarning (didukung via envelope).
    expect(
      (result.warnings as Array<{ type: string }>).filter((w) => w.type === 'unsupported-tool'),
    ).toEqual([]);
  }, 30_000);

  it('doStream mengalirkan text-delta live lalu finish', async () => {
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

  it('parse: arguments string-JSON diterima; blok terakhir yang menang', () => {
    const parsed = parseToolCallsFromText(
      '```tool_calls\n{"tool_calls":[{"name":"a","arguments":{"x":1}}]}\n```\nlanjut\n```tool_calls\n{"tool_calls":[{"name":"a","arguments":"{\\"x\\":2}"}]}\n```',
      new Set(['a']),
    );
    expect(parsed?.calls).toEqual([{ name: 'a', args: { x: 2 } }]);
    expect(parsed?.leadingText).toContain('lanjut');
  });

  it('doGenerate dengan tools mengembalikan tool-call + finish tool-calls', async () => {
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
        finishReason: string;
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Kerjakan.' }] }],
      tools: [{ type: 'function', name: 'jawab', inputSchema: { type: 'object' } }],
    });
    expect(result.finishReason).toBe('tool-calls');
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'Siap, panggil tool dulu.' });
    expect(result.content[1]).toMatchObject({
      type: 'tool-call',
      toolName: 'jawab',
      input: '{"teks":"halo"}',
    });
    expect((result.content[1] as { toolCallId?: string }).toolCallId).toMatch(/^oc-/);
  }, 30_000);

  it('doGenerate toolChoice none mengabaikan envelope', async () => {
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
        finishReason: string;
      }>;
    };
    const result = await model.doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'Hai.' }] }],
      tools: [{ type: 'function', name: 'jawab' }],
      toolChoice: { type: 'none' },
    });
    expect(result.finishReason).toBe('stop');
    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
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
    expect(parts[parts.length - 1]).toMatchObject({ finishReason: 'tool-calls' });
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
