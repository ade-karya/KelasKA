/**
 * Agent event LISTEN/NOTIFY bus — hermetic unit test with a fake `pg.Client`.
 *
 * The bus's PG contract (real LISTEN/NOTIFY round-trip, reconnect fanout,
 * probe self-check) is covered by the `.pg.test.ts` suite when
 * PG_CONTRACT_URL is set; this suite pins the parts that are pure JS:
 *
 *  1. the wakeup payload route (session/owner) reaches the right subscriber
 *     and never leaks into another route;
 *  2. the self-check probe channel can never fake-wake a subscriber;
 *  3. `notifyDurableAgentEvent` queues `SELECT pg_notify` on the caller's
 *     transaction handle (same-transaction lossy wakeup) and silently skips
 *     an over-limit payload instead of poisoning the transaction;
 *  4. subscription lifecycle: unsubscribe removes the route from the
 *     registry;
 *  5. the connect deadline: a stalled event loop must not kill a connect whose
 *     socket is already established, while an unreachable server and a peer
 *     that goes silent still fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Notification as PgNotification } from 'pg';

const fake = vi.hoisted(() => {
  type Listener = (value?: unknown) => void;
  class FakeClient {
    static instances: FakeClient[] = [];
    /** Next constructed client never finishes connecting on its own. */
    static hangOnConnect = false;
    queryCalls: Array<{ text: string; params: unknown[] }> = [];
    socket = {
      destroyed: false,
      destroy: (error?: Error) => {
        this.socket.destroyed = true;
        this.failConnect(error ?? new Error('socket destroyed'));
      },
    };
    // pg exposes the socket under `client.connection.stream`; the connect
    // deadline reads exactly this shape.
    connection = { stream: this.socket };
    private listeners = new Map<string, Set<Listener>>();
    private hangOnConnect: boolean;
    private pendingConnect: { resolve: () => void; reject: (error: Error) => void } | null = null;
    ended = false;

    constructor(_config?: unknown) {
      this.hangOnConnect = FakeClient.hangOnConnect;
      FakeClient.instances.push(this);
    }

    async connect(): Promise<void> {
      if (!this.hangOnConnect) return;
      await new Promise<void>((resolve, reject) => {
        this.pendingConnect = { resolve, reject };
      });
    }

    /** Test hook: let a hanging connect finish, as a real handshake would. */
    finishConnect(): void {
      const pending = this.pendingConnect;
      this.pendingConnect = null;
      pending?.resolve();
    }

    private failConnect(error: Error): void {
      const pending = this.pendingConnect;
      this.pendingConnect = null;
      pending?.reject(error);
    }

    async query(text: string, params: unknown[] = []): Promise<{ rows: unknown[] }> {
      this.queryCalls.push({ text, params });
      return { rows: [] };
    }

    async end(): Promise<void> {
      this.ended = true;
    }

    on(event: string, listener: Listener): this {
      let set = this.listeners.get(event);
      if (!set) {
        set = new Set();
        this.listeners.set(event, set);
      }
      set.add(listener);
      return this;
    }

    /** Test hook: deliver a PostgreSQL notification to the registered listeners. */
    emitNotification(channel: string, payload: string): void {
      const notification = { channel, payload, processId: 1 } as PgNotification;
      for (const listener of this.listeners.get('notification') ?? []) listener(notification);
    }
  }
  return { FakeClient };
});

vi.mock('pg', () => ({ Client: fake.FakeClient }));

import {
  AGENT_EVENT_NOTIFY_CHANNEL,
  AGENT_EVENT_PROBE_CHANNEL,
  connectDeadlineExpired,
  hasAgentEventWakeupSubscriber,
  notifyDurableAgentEvent,
  startAgentEventNotifyBus,
  stopAgentEventNotifyBus,
  subscribeAgentEventWakeup,
} from '@/lib/server/agent-runtime/event-notify-bus';

/** A transaction handle shaped like the storage package's AgentSessionTransaction. */
function txProbe() {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  return {
    calls,
    query: async <TRow extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: unknown[] = [],
    ) => {
      calls.push({ text, params });
      return { rows: [] as TRow[] };
    },
  };
}

describe('agent event notify bus', () => {
  beforeEach(() => {
    fake.FakeClient.instances = [];
    fake.FakeClient.hangOnConnect = false;
    // The bus builds its dedicated LISTEN client from DATABASE_URL (the app
    // contract); the fake client never connects anywhere, the variable just
    // has to be present for the bus to construct it.
    process.env.DATABASE_URL = 'postgres://fake:fake@localhost:5432/fake';
  });

  afterEach(async () => {
    delete process.env.DATABASE_URL;
    vi.useRealTimers();
    await stopAgentEventNotifyBus();
  });

  it('wakes exactly the subscribers of the route a notification names', async () => {
    const handle = startAgentEventNotifyBus();
    await handle.connecting;

    const sessionWake = vi.fn();
    const otherWake = vi.fn();
    const ownerWake = vi.fn();
    const unsubscribeSession = subscribeAgentEventWakeup(
      { kind: 'session', sessionId: 'session-1' },
      sessionWake,
    );
    const unsubscribeOther = subscribeAgentEventWakeup(
      { kind: 'session', sessionId: 'session-2' },
      otherWake,
    );
    const unsubscribeOwner = subscribeAgentEventWakeup(
      { kind: 'owner', ownerId: 'owner-a' },
      ownerWake,
    );

    expect(hasAgentEventWakeupSubscriber({ kind: 'session', sessionId: 'session-1' })).toBe(true);
    const client = fake.FakeClient.instances.at(-1)!;
    // The probe channel is also listened; complete the startup self-check so no
    // 2s probe timer lingers.
    client.emitNotification(AGENT_EVENT_PROBE_CHANNEL, 'openmaic-agent-notify-selfcheck');

    client.emitNotification(
      AGENT_EVENT_NOTIFY_CHANNEL,
      JSON.stringify({ kind: 'session', sessionId: 'session-1' }),
    );
    expect(sessionWake).toHaveBeenCalledOnce();
    expect(otherWake).not.toHaveBeenCalled();
    expect(ownerWake).not.toHaveBeenCalled();

    unsubscribeSession();
    expect(hasAgentEventWakeupSubscriber({ kind: 'session', sessionId: 'session-1' })).toBe(false);
    client.emitNotification(
      AGENT_EVENT_NOTIFY_CHANNEL,
      JSON.stringify({ kind: 'session', sessionId: 'session-1' }),
    );
    expect(sessionWake).toHaveBeenCalledOnce();

    client.emitNotification(
      AGENT_EVENT_NOTIFY_CHANNEL,
      JSON.stringify({ kind: 'owner', ownerId: 'owner-a' }),
    );
    expect(ownerWake).toHaveBeenCalledOnce();
    unsubscribeOther();
    unsubscribeOwner();
  });

  it('never treats a probe notification or a malformed payload as a wakeup', async () => {
    const handle = startAgentEventNotifyBus();
    await handle.connecting;
    const wake = vi.fn();
    const unsubscribe = subscribeAgentEventWakeup({ kind: 'session', sessionId: 's' }, wake);
    const client = fake.FakeClient.instances.at(-1)!;
    client.emitNotification(AGENT_EVENT_PROBE_CHANNEL, 'openmaic-agent-notify-selfcheck');
    expect(wake).not.toHaveBeenCalled();

    client.emitNotification(AGENT_EVENT_NOTIFY_CHANNEL, '{not json');
    expect(wake).not.toHaveBeenCalled();

    client.emitNotification(AGENT_EVENT_NOTIFY_CHANNEL, '{"kind":"session"}');
    expect(wake).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('queues a session-route pg_notify on the caller transaction and skips over-limit payloads', async () => {
    const tx = txProbe();
    await notifyDurableAgentEvent(tx, { kind: 'session', sessionId: 'session-1' });
    expect(tx.calls).toEqual([
      {
        text: 'SELECT pg_notify($1, $2)',
        params: [AGENT_EVENT_NOTIFY_CHANNEL, '{"kind":"session","sessionId":"session-1"}'],
      },
    ]);

    // An over-limit route payload is skipped BEFORE the query: once PG raises
    // inside a transaction the transaction is aborted and no JS catch can save
    // it, so the length check must be pre-send (reference semantics).
    const big = txProbe();
    await expect(
      notifyDurableAgentEvent(big, { kind: 'session', sessionId: 'x'.repeat(8_001) }),
    ).resolves.toBeUndefined();
    expect(big.calls).toEqual([]);
  });

  it('keeps a connect alive while a stalled event loop has not spent its budget', async () => {
    // A blocked event loop makes a wall-clock timer fire LATE, not on time — and
    // Node cannot even report the socket as connected until the loop runs again.
    // pg's own connect timer fired regardless and killed the connection: the
    // spurious `timeout expired` plus needless reconnect this pins, seen on
    // every `next dev` boot because compiling the runtime modules blocks the
    // loop for longer than the budget.
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.FakeClient.hangOnConnect = true;

    const handle = startAgentEventNotifyBus();
    const client = fake.FakeClient.instances.at(-1)!;

    // One stall longer than the whole budget, then the loop is free again: the
    // deadline must survive it and the connect must still land.
    vi.setSystemTime(Date.now() + 12_000);
    await vi.advanceTimersByTimeAsync(250);
    expect(client.socket.destroyed).toBe(false);

    client.finishConnect();
    await vi.advanceTimersByTimeAsync(0);
    client.emitNotification(AGENT_EVENT_PROBE_CHANNEL, 'openmaic-agent-notify-selfcheck');
    await handle.connecting;

    // Usable, and never reconnected: no wakeup was lost to the stall.
    expect(fake.FakeClient.instances).toHaveLength(1);
    expect(client.queryCalls.map((call) => call.text)).toContain(
      `LISTEN ${AGENT_EVENT_NOTIFY_CHANNEL}`,
    );
  });

  it('still fails the connect once a healthy loop has given it the whole budget', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fake.FakeClient.hangOnConnect = true;

    startAgentEventNotifyBus();
    const client = fake.FakeClient.instances.at(-1)!;

    // On time, so this is what the budget exists for: a peer that never answers
    // must still fail and be retried.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.socket.destroyed).toBe(true);
  });

  it('measures the connect budget in event-loop time, with a wall-clock cap', () => {
    // Budget spent, loop healthy: an unreachable server, give up.
    expect(connectDeadlineExpired(10_000, 10_000)).toBe(true);
    // Budget barely spent because the loop was blocked: a stall is not the
    // connect's fault, so the connect is worth keeping.
    expect(connectDeadlineExpired(300, 12_000)).toBe(false);
    // A permanently saturated process still ends up failing the connect.
    expect(connectDeadlineExpired(300, 40_000)).toBe(true);
  });
});
