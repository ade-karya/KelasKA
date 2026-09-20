import type { AfterToolCallContext, AfterToolCallResult } from '@earendil-works/pi-agent-core';

/** Budget source — v0 stub; wire to the credit/quota system later. */
export interface QuotaSource {
  remaining(): number;
}

const numberFromEnv = (value: string | undefined, fallback: number): number =>
  value ? Number(value) : fallback;

/** Default per-run token budget; `0` means unlimited. */
export const DEFAULT_RUN_TOKEN_BUDGET = 0;

/**
 * Per-run LLM token budget from `AGENT_RUN_TOKEN_BUDGET`. `0`/negative/NaN
 * all mean unlimited. Read per hook instance (i.e. per run — `build-agent.ts`
 * creates one hook per agent), never cached at module load.
 */
export function readRunTokenBudget(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = numberFromEnv(env.AGENT_RUN_TOKEN_BUDGET, DEFAULT_RUN_TOKEN_BUDGET);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

/**
 * Rough token estimate for one tool call: ~4 chars per token over the
 * arguments plus the executed result content. A floor of 1 keeps tight
 * budgets terminating even on tiny/empty payloads. This is a spend guard,
 * not billing — replace with provider-reported usage when available.
 */
export function estimateToolCallTokens(ctx: AfterToolCallContext): number {
  let chars = 0;
  try {
    const args = JSON.stringify(ctx.args ?? null) ?? '';
    const result = JSON.stringify(ctx.result ?? null) ?? '';
    chars = args.length + result.length;
  } catch {
    chars = 0;
  }
  return Math.max(1, Math.ceil(chars / 4));
}

export function makeQuotaHook(source: QuotaSource) {
  const budget = readRunTokenBudget();
  let spent = 0;
  return async (ctx: AfterToolCallContext): Promise<AfterToolCallResult | undefined> => {
    if (source.remaining() <= 0) return { terminate: true };
    if (!(budget > 0)) return undefined;
    spent += estimateToolCallTokens(ctx);
    if (spent >= budget) return { terminate: true };
    return undefined;
  };
}
