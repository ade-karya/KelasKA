/**
 * The shipped example (`openmaic.example.yml`) and every `openmaic.yml` block
 * in the documentation and READMEs must parse with the real schema, so the
 * examples cannot drift from what the server accepts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseModelConfig, type ConfigEnv } from '@/lib/server/model-config/openmaic-yml';

const ROOT = path.resolve(__dirname, '../../..');

const DOCS = path.join(ROOT, 'packages/docs/content/docs');

/** A value for every `${VAR}` the text references, as if the environment set them. */
function envFor(text: string): ConfigEnv {
  const env: Record<string, string> = {};
  for (const [, name] of text.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) env[name] = 'set';
  return env;
}

interface Block {
  where: string;
  text: string;
}

/**
 * Fenced YAML blocks that are openmaic.yml: in the docs, those titled
 * `openmaic.yml`; in the READMEs (no titles), those that declare a preset.
 */
function openmaicBlocks(file: string, { titled }: { titled: boolean }): Block[] {
  const source = fs.readFileSync(file, 'utf-8');
  const blocks: Block[] = [];
  for (const match of source.matchAll(/^```ya?ml([^\n]*)\n([\s\S]*?)^```/gm)) {
    const [, info, text] = match;
    const isConfig = titled ? /title="openmaic\.yml"/.test(info) : /^\s*preset:/m.test(text);
    if (!isConfig) continue;
    const line = source.slice(0, match.index).split('\n').length;
    blocks.push({ where: `${path.relative(ROOT, file)}:${line}`, text });
  }
  return blocks;
}

describe('openmaic.yml examples', () => {
  it('openmaic.example.yml parses with the schema', () => {
    const text = fs.readFileSync(path.join(ROOT, 'openmaic.example.yml'), 'utf-8');
    const config = parseModelConfig(text, { file: 'openmaic.example.yml', env: envFor(text) });
    expect(config.slots?.llm).toBeDefined();
    expect(Object.keys(config.providers ?? {})).not.toHaveLength(0);
  });

  const docs = fs
    .readdirSync(DOCS)
    .filter((name) => name.endsWith('.mdx'))
    .flatMap((name) => openmaicBlocks(path.join(DOCS, name), { titled: true }));
  const readmes = ['README.md', 'README-zh.md'].flatMap((name) =>
    openmaicBlocks(path.join(ROOT, name), { titled: false }),
  );

  it('the documentation has openmaic.yml examples to check', () => {
    expect(docs.length).toBeGreaterThan(0);
    expect(readmes.length).toBeGreaterThan(0);
  });

  it('allows a thinking effort on the agent slot only through a local transport', () => {
    const config = (agent: string) =>
      [
        'providers:',
        '  openai:',
        '    preset: openai',
        '    apiKey: ${OPENAI_API_KEY}',
        '    models: [gpt-5.5]',
        '  codex:',
        '    preset: codex',
        '    models: [gpt-5.6-codex]',
        'slots:',
        '  agent:',
        agent,
      ].join('\n');

    // An HTTP transport cannot combine reasoning effort with function tools.
    expect(() =>
      parseModelConfig(config('    model: openai:gpt-5.5\n    thinking: { effort: high }'), {
        file: 'inline',
        env: { OPENAI_API_KEY: 'set' },
      }),
    ).toThrow(/cannot set a thinking effort/);

    // A local transport carries the effort as a prompt instruction/CLI flag.
    expect(() =>
      parseModelConfig(
        config(
          '    model: codex:gpt-5.6-codex\n    api: codex-sdk\n    thinking: { effort: high }',
        ),
        { file: 'inline', env: { OPENAI_API_KEY: 'set' } },
      ),
    ).not.toThrow();
  });

  it.each([...docs, ...readmes].map((block) => [block.where, block.text]))(
    '%s parses with the schema',
    (where, text) => {
      expect(() => parseModelConfig(text, { file: where, env: envFor(text) })).not.toThrow();
    },
  );
});
