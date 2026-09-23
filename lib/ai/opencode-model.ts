/**
 * OpenCode CLI language model (AI SDK v3 spec).
 *
 * Adapts the local `opencode` binary (see `lib/ai/opencode-cli.ts`) to the
 * `LanguageModel` interface the rest of OpenMAIC consumes (`callLLM` /
 * `streamLLM` in `lib/ai/llm.ts`, and through them the Pro workbench pi
 * loop in `lib/agent/runtime/stream-fn.ts`).
 *
 * Two deliberate limitations of this transport, both surfaced honestly in the
 * catalog (`tools: false`, no thinking capability):
 *
 * - **Text-only.** `opencode run` executes its *own* agent loop with its own
 *   tools; it never returns tool *calls* for OpenMAIC's pi loop to execute.
 *   Tool definitions sent by callers are therefore dropped (with an
 *   `unsupported` warning). Plain generation — scene content, outlines,
 *   Q&A, grading — works; agentic course building that depends on
 *   OpenMAIC-side tool calls degrades to a text answer.
 * - **No per-call sampling controls.** The CLI exposes no temperature /
 *   max-tokens flags, so those options are accepted and ignored.
 *
 * This module itself is client-safe: the Node-only transport it loads
 * (`lib/ai/opencode-cli.ts`) contains no static `node:*` imports — builtins
 * are resolved via `process.getBuiltinModule` — so bundling it into the
 * settings UI never pulls `node:child_process` into the browser.
 */

import type { LanguageModel } from 'ai';
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  OPENCODE_CLI_TIMEOUT_MS,
  OPENCODE_PROVIDER_ID,
  resolveOpencodeCliPath,
  type OpencodeCompletion,
  type OpencodeFinishReason,
} from './opencode-cli';

export interface OpencodeCliModelOptions {
  modelId: string;
  /** Explicit binary path (precedence over `OPENCODE_CLI_PATH` and `PATH`). */
  cliPath?: string;
  /** Wall-clock budget per call. Defaults to `OPENCODE_CLI_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * Render an AI SDK v3 prompt to the single plain-text message `opencode run`
 * accepts. History is preserved as a role-labeled transcript so multi-turn
 * workbench sessions keep their context even though every call spawns a fresh
 * CLI session. Exported for unit tests.
 */
export function opencodePromptToText(prompt: LanguageModelV3Prompt): string {
  const sections: string[] = [];
  for (const message of prompt) {
    if (message.role === 'system') {
      sections.push(`[system]\n${message.content}`);
      continue;
    }
    const parts: string[] = [];
    for (const part of message.content) {
      if (part.type === 'text') parts.push(part.text);
      else if (part.type === 'reasoning') parts.push(`[thinking]\n${part.text}`);
      else if (part.type === 'tool-call')
        parts.push(
          `[tool call ${part.toolName} ${part.toolCallId}]\n${
            typeof part.input === 'string' ? part.input : JSON.stringify(part.input)
          }`,
        );
      else if (part.type === 'tool-result') {
        const output = part.output;
        const text =
          output.type === 'text' || output.type === 'error-text'
            ? output.value
            : output.type === 'execution-denied'
              ? `(execution denied${output.reason ? `: ${output.reason}` : ''})`
              : JSON.stringify(output.value);
        parts.push(`[tool result ${part.toolName} ${part.toolCallId}]\n${text}`);
      } else if (part.type === 'tool-approval-response') {
        parts.push(
          `[tool approval ${part.approvalId}: ${part.approved ? 'approved' : 'denied'}${part.reason ? ` (${part.reason})` : ''}]`,
        );
      }
      // File parts reference URLs the CLI cannot fetch; note their presence
      // so the model knows content was omitted rather than empty.
      else if (part.type === 'file') parts.push('[attached file omitted: text-only transport]');
    }
    const body = parts.filter(Boolean).join('\n');
    if (message.role === 'user') sections.push(`[user]\n${body}`);
    else if (message.role === 'assistant') sections.push(`[assistant]\n${body}`);
    else if (message.role === 'tool') sections.push(`[tool]\n${body}`);
  }
  return sections.join('\n\n');
}

function toV3Usage(completion: OpencodeCompletion): LanguageModelV3Usage {
  const input = completion.usage.inputTokens;
  const output = completion.usage.outputTokens;
  return {
    inputTokens: { total: input, noCache: input, cacheRead: 0, cacheWrite: 0 },
    outputTokens: {
      total: output,
      text: output,
      reasoning: completion.usage.reasoningTokens,
    },
  };
}

function toUnifiedFinishReason(
  reason: OpencodeFinishReason,
): 'stop' | 'length' | 'error' | 'other' {
  if (reason === 'stop' || reason === 'length' || reason === 'error') return reason;
  return 'other';
}

async function loadTransport(): Promise<typeof import('./opencode-cli')> {
  // Plain dynamic import (no `webpackIgnore`): the bundler follows it so the
  // module resolves inside the compiled server output. This stays safe for the
  // client bundle because `opencode-cli.ts` itself contains no static `node:*`
  // imports (see `nodeBuiltins()` there).
  return import('./opencode-cli');
}

function resolveCliOrThrow(explicitPath?: string): string {
  const cliPath = explicitPath?.trim() || resolveOpencodeCliPath();
  if (!cliPath) {
    throw new Error(
      'OpenCode CLI provider is selected but no `opencode` binary was found. ' +
        'Install it (see https://opencode.ai) or set OPENCODE_CLI_PATH to its location.',
    );
  }
  return cliPath;
}

/** Build an AI SDK v3 language model backed by the local OpenCode CLI. */
export function createOpencodeCliModel(opts: OpencodeCliModelOptions): LanguageModel {
  const timeoutMs = opts.timeoutMs ?? OPENCODE_CLI_TIMEOUT_MS;
  return {
    specificationVersion: 'v3',
    provider: OPENCODE_PROVIDER_ID,
    modelId: opts.modelId,
    supportedUrls: {},
    doGenerate: async (options: LanguageModelV3CallOptions) => {
      const transport = await loadTransport();
      const cliPath = resolveCliOrThrow(opts.cliPath);
      const warnings =
        options.tools && options.tools.length > 0
          ? [
              {
                type: 'unsupported' as const,
                feature: 'tool-call',
                details:
                  'opencode-cli runs its own agent loop and returns text only; ' +
                  'caller tool definitions were not forwarded.',
              },
            ]
          : [];
      const completion = await transport.runOpencodePrompt({
        cliPath,
        modelId: opts.modelId,
        prompt: opencodePromptToText(options.prompt),
        timeoutMs,
        abortSignal: options.abortSignal,
      });
      return {
        content: [{ type: 'text' as const, text: completion.text }],
        finishReason: {
          unified: toUnifiedFinishReason(completion.finishReason),
          raw: completion.finishReason,
        },
        usage: toV3Usage(completion),
        warnings,
      };
    },
    doStream: async (options: LanguageModelV3CallOptions) => {
      const transport = await loadTransport();
      const cliPath = resolveCliOrThrow(opts.cliPath);
      const warnings =
        options.tools && options.tools.length > 0
          ? [
              {
                type: 'unsupported' as const,
                feature: 'tool-call',
                details:
                  'opencode-cli runs its own agent loop and returns text only; ' +
                  'caller tool definitions were not forwarded.',
              },
            ]
          : [];
      const prompt = opencodePromptToText(options.prompt);
      const modelId = opts.modelId;
      const textId = 'opencode-text-0';
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings });
          controller.enqueue({ type: 'text-start', id: textId });
          try {
            for await (const event of transport.streamOpencodePrompt({
              cliPath,
              modelId,
              prompt,
              timeoutMs,
              abortSignal: options.abortSignal,
            })) {
              if (event.kind === 'text-delta') {
                controller.enqueue({ type: 'text-delta', id: textId, delta: event.delta });
              } else if (event.kind === 'tool') {
                // The CLI executed this tool inside its own loop (a built-in, or
                // an MCP tool). The AI SDK's provider stream has no part for
                // "provider ran a tool", so it is not forwarded here — callers
                // that need the tool transcript consume `streamOpencodePrompt`
                // directly (see the CLI-native harness plan).
              } else {
                const completion = event.completion;
                // A CLI-reported failure arrives with exit 0 as an `error`
                // finish: surface it as a stream error carrying the real cause
                // instead of a `finish` part whose message the runner cannot
                // see (it would degrade to "LLM stream finished with error").
                if (completion.finishReason === 'error') {
                  controller.enqueue({
                    type: 'error',
                    error: new Error(
                      completion.errorMessage || `opencode CLI run failed for model "${modelId}"`,
                    ),
                  });
                } else {
                  controller.enqueue({ type: 'text-end', id: textId });
                  controller.enqueue({
                    type: 'finish',
                    usage: toV3Usage(completion),
                    finishReason: {
                      unified: toUnifiedFinishReason(completion.finishReason),
                      raw: completion.finishReason,
                    },
                  });
                }
              }
            }
          } catch (err) {
            controller.enqueue({ type: 'error', error: err });
          } finally {
            controller.close();
          }
        },
      });
      return { stream };
    },
  } as LanguageModel;
}
