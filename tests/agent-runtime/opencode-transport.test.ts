/**
 * Opencode → pi tool-call schema bridge.
 *
 * Regression test for the Pro workbench stall where the driver emitted the
 * workbench `read` tool with opencode's native spelling (`filePath`) instead
 * of pi's `NativeReadParams` (`path`), failing validation with "must have
 * required property path" and blocking class creation.
 */
import { describe, expect, it } from 'vitest';

import {
  composeOpencodePrompt,
  normalizeOpencodeToolCall,
} from '@/lib/server/agent-runtime/opencode-transport';

describe('normalizeOpencodeToolCall', () => {
  it('maps filePath to path for the read tool', () => {
    const out = normalizeOpencodeToolCall({
      id: 'r1',
      name: 'read',
      args: { filePath: '/skills/stage-design/SKILL.md' },
    });
    expect(out).toEqual({
      id: 'r1',
      name: 'read',
      args: { filePath: '/skills/stage-design/SKILL.md', path: '/skills/stage-design/SKILL.md' },
    });
  });

  it('keeps an explicit path untouched', () => {
    const call = { id: 'r1', name: 'read', args: { path: '/skills/x/SKILL.md' } };
    expect(normalizeOpencodeToolCall(call)).toBe(call);
  });

  it('ignores non-read tools and null', () => {
    const call = { id: 'c1', name: 'create_stage', args: { title: 'T' } };
    expect(normalizeOpencodeToolCall(call)).toBe(call);
    expect(normalizeOpencodeToolCall(null)).toBeNull();
  });

  it('ignores non-string filePath', () => {
    const call = { id: 'r1', name: 'read', args: { filePath: 42 } };
    expect(normalizeOpencodeToolCall(call)).toBe(call);
  });
});

describe('composeOpencodePrompt', () => {
  it('tells the model the read tool takes path', () => {
    const prompt = composeOpencodePrompt({
      systemPrompt: 'SYS',
      transcriptLines: [],
      tools: [{ name: 'read', description: 'd', parameters: {} }],
    });
    expect(prompt).toContain('`read` tool takes `path` (not `filePath`)');
    expect(prompt).toContain('NOW — THIS TURN:');
  });
});
