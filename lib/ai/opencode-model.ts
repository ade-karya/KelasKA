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
 * Everything else matches a keyed provider: reasoning streams back through
 * the standard channel (`--thinking` is always requested), inline images are
 * attached with `--file` for vision-capable models, every run is isolated in
 * a scratch directory, and the CLI's own filesystem/network tools are locked
 * out so a plain generation call cannot act like an agent.
 *
 * This module itself is client-safe: the Node-only transport it loads
 * (`lib/ai/opencode-cli.ts`) contains no static `node:*` imports — builtins
 * are resolved via `process.getBuiltinModule` — so bundling it into the
 * settings UI never pulls `node:child_process` into the browser. File bytes
 * are decoded without Node APIs for the same reason; the transport writes
 * them to disk.
 */

import type { LanguageModel } from 'ai';
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import {
  OPENCODE_CLI_TIMEOUT_MS,
  OPENCODE_MAX_ATTACHMENTS,
  OPENCODE_PROVIDER_ID,
  resolveOpencodeCliPath,
  type OpencodeAttachment,
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
 *
 * File parts are labeled in place: inline images forwarded with `--file` (see
 * {@link extractOpencodeAttachments}) are announced as attachments so the
 * model looks at them; anything the CLI cannot take (remote URLs,
 * non-image types) keeps an honest omission note.
 */
export function opencodePromptToText(prompt: LanguageModelV3Prompt): string {
  const decisions = collectFileDecisions(prompt);
  let decisionCursor = 0;
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
      } else if (part.type === 'file') {
        const decision = decisions[decisionCursor++];
        if (decision?.kind === 'attach') {
          parts.push(
            `[attached image ${decision.index} (${decision.mediaType}): sent as a file attachment — refer to it directly]`,
          );
        } else {
          parts.push(`[attached file omitted: ${decision?.reason ?? 'unsupported file part'}]`);
        }
      }
    }
    const body = parts.filter(Boolean).join('\n');
    if (message.role === 'user') sections.push(`[user]\n${body}`);
    else if (message.role === 'assistant') sections.push(`[assistant]\n${body}`);
    else if (message.role === 'tool') sections.push(`[tool]\n${body}`);
  }
  return sections.join('\n\n');
}

/** Image media types the CLI can plausibly attach with `--file`. */
const ATTACHABLE_IMAGE_MEDIA = /^(image\/(?:png|jpeg|jpg|webp|gif|svg\+xml))$/i;

/** Looks like base64 (whitespace tolerated) rather than a URL or prose. */
const BASE64_LIKE = /^[A-Za-z0-9+/=\s]+$/;

type FileDecision =
  | { kind: 'attach'; index: number; filename?: string; mediaType: string; data: Uint8Array }
  | { kind: 'omit'; reason: string };

function decodeBase64Bytes(base64: string): Uint8Array | undefined {
  try {
    const bin = atob(base64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * Decide what happens to one v3 `file` part, in prompt order. Exported for
 * unit tests. Inline images become `--file` attachments; remote URLs (the CLI
 * cannot fetch them) and non-image types are honestly omitted.
 */
export function decideOpencodeFilePart(
  part: { filename?: string; mediaType: string; data: Uint8Array | string | URL },
  index: number,
): FileDecision {
  const mediaType = part.mediaType || 'application/octet-stream';
  if (!ATTACHABLE_IMAGE_MEDIA.test(mediaType)) {
    return { kind: 'omit', reason: `unsupported media type ${mediaType}` };
  }
  const { data } = part;
  if (data instanceof Uint8Array) {
    return { kind: 'attach', index, filename: part.filename, mediaType, data };
  }
  if (typeof data === 'string') {
    if (/^https?:\/\//i.test(data)) return { kind: 'omit', reason: 'remote URL (not fetched)' };
    const dataUrl = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(data);
    const encoded = dataUrl ? dataUrl[3] : data;
    if (!BASE64_LIKE.test(encoded)) return { kind: 'omit', reason: 'undecodable file data' };
    const bytes = decodeBase64Bytes(encoded);
    if (!bytes) return { kind: 'omit', reason: 'undecodable file data' };
    return {
      kind: 'attach',
      index,
      filename: part.filename,
      mediaType: dataUrl?.[1] || mediaType,
      data: bytes,
    };
  }
  return { kind: 'omit', reason: 'remote URL (not fetched)' };
}

function collectFileDecisions(prompt: LanguageModelV3Prompt): FileDecision[] {
  const decisions: FileDecision[] = [];
  let attached = 0;
  for (const message of prompt) {
    if (message.role === 'system') continue;
    for (const part of message.content) {
      if (part.type !== 'file') continue;
      if (attached >= OPENCODE_MAX_ATTACHMENTS) {
        decisions.push({
          kind: 'omit',
          reason: `attachment budget exceeded (max ${OPENCODE_MAX_ATTACHMENTS})`,
        });
        continue;
      }
      const decision = decideOpencodeFilePart(
        part as { filename?: string; mediaType: string; data: Uint8Array | string | URL },
        attached + 1,
      );
      if (decision.kind === 'attach') attached += 1;
      decisions.push(decision);
    }
  }
  return decisions;
}

/**
 * Extract the inline images of a v3 prompt as CLI `--file` attachments, in
 * prompt order (capped). Exported for unit tests; `opencodePromptToText`
 * announces exactly these files in the transcript.
 */
export function extractOpencodeAttachments(prompt: LanguageModelV3Prompt): OpencodeAttachment[] {
  const attachments: OpencodeAttachment[] = [];
  for (const decision of collectFileDecisions(prompt)) {
    if (decision.kind === 'attach') {
      attachments.push({
        filename: decision.filename,
        mediaType: decision.mediaType,
        data: decision.data,
      });
    }
  }
  return attachments;
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
        thinking: true,
        lockBuiltinTools: true,
        attachments: extractOpencodeAttachments(options.prompt),
        timeoutMs,
        abortSignal: options.abortSignal,
      });
      return {
        content: [
          ...(completion.reasoning
            ? [{ type: 'reasoning' as const, text: completion.reasoning }]
            : []),
          { type: 'text' as const, text: completion.text },
        ],
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
      const attachments = extractOpencodeAttachments(options.prompt);
      const modelId = opts.modelId;
      const textId = 'opencode-text-0';
      const reasoningId = 'opencode-reasoning-0';
      const stream = new ReadableStream({
        async start(controller) {
          controller.enqueue({ type: 'stream-start', warnings });
          controller.enqueue({ type: 'text-start', id: textId });
          let reasoningStarted = false;
          const endReasoning = () => {
            if (reasoningStarted) {
              reasoningStarted = false;
              controller.enqueue({ type: 'reasoning-end', id: reasoningId });
            }
          };
          try {
            for await (const event of transport.streamOpencodePrompt({
              cliPath,
              modelId,
              prompt,
              thinking: true,
              lockBuiltinTools: true,
              attachments,
              timeoutMs,
              abortSignal: options.abortSignal,
            })) {
              if (event.kind === 'text-delta') {
                controller.enqueue({ type: 'text-delta', id: textId, delta: event.delta });
              } else if (event.kind === 'reasoning-delta') {
                if (!reasoningStarted) {
                  reasoningStarted = true;
                  controller.enqueue({ type: 'reasoning-start', id: reasoningId });
                }
                controller.enqueue({
                  type: 'reasoning-delta',
                  id: reasoningId,
                  delta: event.delta,
                });
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
                  endReasoning();
                  controller.enqueue({
                    type: 'error',
                    error: new Error(
                      completion.errorMessage || `opencode CLI run failed for model "${modelId}"`,
                    ),
                  });
                } else {
                  endReasoning();
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
