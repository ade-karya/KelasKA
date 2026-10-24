/**
 * Discover the models available to the logged-in Codex account via the
 * `codex app-server` JSON-RPC `model/list` method. This is the only way to
 * learn which models the account can use; the CLI has no `models` subcommand.
 *
 * Server-side only.
 */
import { spawn } from 'node:child_process';

import { resolveCodexBinary } from './codex-sdk';

export interface CodexDiscoveredModel {
  id: string;
  displayName: string;
  description: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  hidden: boolean;
}

let cache: { at: number; models: CodexDiscoveredModel[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

export function invalidateCodexModelCache(): void {
  cache = null;
}

export async function listCodexModels(force = false): Promise<CodexDiscoveredModel[]> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const binary = resolveCodexBinary();
  if (!binary) return cache?.models ?? [];

  return new Promise<CodexDiscoveredModel[]>((resolve) => {
    const child = spawn(binary, ['app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '';
    let done = false;
    const finish = (models: CodexDiscoveredModel[]) => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
      cache = { at: Date.now(), models };
      resolve(models);
    };

    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      // Process complete JSON lines.
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 2 && msg.result && Array.isArray(msg.result.data)) {
            const models: CodexDiscoveredModel[] = msg.result.data
              .filter((m: { hidden?: boolean }) => !m.hidden)
              .map((m: Record<string, unknown>) => ({
                id: String(m.id ?? m.model ?? ''),
                displayName: String(m.displayName ?? m.id ?? ''),
                description: String(m.description ?? ''),
                reasoningEfforts: Array.isArray(m.supportedReasoningEfforts)
                  ? (m.supportedReasoningEfforts as Array<{ reasoningEffort?: string }>)
                      .map((e) => e.reasoningEffort)
                      .filter((x): x is string => typeof x === 'string')
                  : [],
                defaultReasoningEffort:
                  typeof m.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : null,
                hidden: Boolean(m.hidden),
              }));
            finish(models);
          }
        } catch {
          // not a complete JSON message; wait for more
        }
      }
    });

    child.stderr.on('data', () => {
      // ignore
    });
    child.on('error', () => finish(cache?.models ?? []));
    child.on('close', () => {
      if (!done) finish(cache?.models ?? []);
    });

    const send = (o: unknown) => child.stdin.write(JSON.stringify(o) + '\n');
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'openmaic', version: '1.0' }, capabilities: {} } });
    setTimeout(() => send({ jsonrpc: '2.0', method: 'initialized', params: {} }), 300);
    setTimeout(() => send({ jsonrpc: '2.0', id: 2, method: 'model/list', params: {} }), 600);
    // Hard timeout.
    setTimeout(() => finish(cache?.models ?? []), 12_000);
  });
}
