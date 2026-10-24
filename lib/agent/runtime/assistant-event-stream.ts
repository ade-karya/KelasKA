/**
 * Shared pi `AssistantMessageEventStream` implementation for the OpenMAIC
 * StreamFn transports (`stream-fn.ts` for HTTP, `codex-stream-fn.ts` for the
 * Codex SDK).
 *
 * pi-ai exports the stream as a *type* only (the
 * `createAssistantMessageEventStream` factory is not re-exported from the
 * package root), so this is a structurally identical queue — mirrors pi-ai
 * utils/event-stream.ts.
 */
import type { AssistantMessage, AssistantMessageEvent } from '@earendil-works/pi-ai';

export const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export class AssistantEventStream {
  private queue: AssistantMessageEvent[] = [];
  private waiting: ((r: IteratorResult<AssistantMessageEvent>) => void)[] = [];
  private done = false;
  private started = false;
  private resolveFinal!: (m: AssistantMessage) => void;
  private finalPromise: Promise<AssistantMessage>;

  constructor() {
    this.finalPromise = new Promise((resolve) => {
      this.resolveFinal = resolve;
    });
  }

  push(event: AssistantMessageEvent): void {
    if (this.done) return;
    if (event.type === 'start') this.started = true;
    if (event.type === 'done') {
      this.done = true;
      this.resolveFinal(event.message);
    } else if (event.type === 'error') {
      this.done = true;
      this.resolveFinal(event.error);
    }
    const waiter = this.waiting.shift();
    if (waiter) waiter({ value: event, done: false });
    else this.queue.push(event);
  }

  fail(error: unknown): void {
    if (this.done) return;
    const message: AssistantMessage = {
      role: 'assistant',
      content: [],
      api: 'unknown' as AssistantMessage['api'],
      provider: 'unknown' as AssistantMessage['provider'],
      model: 'maic-connector',
      usage: { ...EMPTY_USAGE },
      stopReason: 'error',
      errorMessage:
        error instanceof Error && error.message.trim()
          ? error.message
          : typeof error === 'string' && error.trim()
            ? error
            : 'LLM stream error',
      timestamp: Date.now(),
    };
    if (!this.started) this.push({ type: 'start', partial: message });
    this.push({ type: 'error', reason: 'error', error: message });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    for (;;) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else if (this.done) {
        return;
      } else {
        const r = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) =>
          this.waiting.push(resolve),
        );
        if (r.done) return;
        yield r.value;
      }
    }
  }

  result(): Promise<AssistantMessage> {
    return this.finalPromise;
  }
}
