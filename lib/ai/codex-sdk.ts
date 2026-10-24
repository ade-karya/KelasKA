/**
 * Thin wrapper around `@openai/codex-sdk` so the OpenMAIC Pro Workbench can
 * drive a local Codex agent programmatically.
 *
 * Reference: https://learn.chatgpt.com/docs/codex-sdk
 *
 * The Codex SDK controls the local Codex CLI over JSON-RPC/stdio. It is a
 * server-side only capability (requires Node.js 18+ and a working `codex`
 * binary on PATH, or `codexPathOverride`).
 */

import { Codex, type CodexOptions, type ThreadOptions, type Turn } from '@openai/codex-sdk';

export { Codex };
export type { CodexOptions, ThreadOptions, Turn };

export interface CodexRunOptions {
  /** Options forwarded to the `Codex` constructor. */
  codexOptions?: CodexOptions;
  /** Options forwarded to `startThread()`. */
  threadOptions?: ThreadOptions;
  /** Abort the turn. */
  signal?: AbortSignal;
}

/**
 * Run a single prompt through a fresh Codex thread and return the completed
 * turn (including `finalResponse` and `usage`).
 */
export async function runCodexPrompt(
  prompt: string,
  options: CodexRunOptions = {},
): Promise<Turn> {
  const codex = new Codex(options.codexOptions);
  const thread = codex.startThread(options.threadOptions);
  return thread.run(prompt, options.signal ? { signal: options.signal } : undefined);
}

/**
 * Resume an existing Codex thread by id and run a follow-up prompt.
 */
export async function resumeCodexThread(
  threadId: string,
  prompt: string,
  options: CodexRunOptions = {},
): Promise<Turn> {
  const codex = new Codex(options.codexOptions);
  const thread = codex.resumeThread(threadId, options.threadOptions);
  return thread.run(prompt, options.signal ? { signal: options.signal } : undefined);
}

export function createCodexClient(options?: CodexOptions): Codex {
  return new Codex(options);
}