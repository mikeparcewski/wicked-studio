import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The shared snapshot read (store/systemSnapshot.ts), with deferred answers (review on #901):
 *  - one tick is published at once — a fresh /health never sits beside a /system or /diagnostics read
 *    still in flight (that would show a stale green as fresh);
 *  - a Re-check during a read supersedes it: the earlier answer is not shown, and the Re-check's own
 *    promise settles with the new read.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

let healthQ: Deferred<unknown>[] = [];
let systemQ: Deferred<unknown>[] = [];
let diagQ: Deferred<unknown>[] = [];
const take = (q: Deferred<unknown>[]): Promise<unknown> => { const d = deferred<unknown>(); q.push(d); return d.promise; };

vi.mock('../src/api/client.js', () => ({
  api: { getHealth: () => take(healthQ) },
  apiFetch: (path: string) => (path === '/system' ? take(systemQ) : take(diagQ)),
}));

const { resetSystemStore, useSystemStore } = await import('../src/store/systemSnapshot.js');
const { nerveState } = await import('../src/board/nerveCenter.js');

const flush = async (): Promise<void> => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
const verdict = () => nerveState(useSystemStore.getState(), 'connected', 0, Date.now());
const GOOD_GOV = { store: { path: '/x', source: 'flag' }, records: { total: 1, sinceBoot: 1 }, deadletters: { path: null, count: 0, byType: {}, byReason: {}, timestamped: 0, untimestamped: 0, oldestTs: null, newestTs: null, truncated: false, legacyOutbox: null }, findings: [] };
const SNAP = (attention: unknown[]) => ({ checkedAt: new Date().toISOString(), budgetMs: 1, tookMs: 1, level: attention.length ? 'red' : 'green', attention, clis: [], runs: [], infra: [], governance: [] });
const RED = { id: 'infra:gateway', severity: 'red', source: 'infra', title: 'gateway down', reason: 'r', remedy: 'm', blocks: 1, target: { kind: 'infra', key: 'gateway' }, action: null };

beforeEach(() => { healthQ = []; systemQ = []; diagQ = []; resetSystemStore(); });
afterEach(() => { resetSystemStore(); });

describe('one tick, published at once', () => {
  it('an older crew: a fresh /health is not shown until /diagnostics answers', async () => {
    const p = useSystemStore.getState().refresh();
    await flush();
    healthQ[0]!.resolve({ status: 'ok', version: '0.15.9', capabilities: {} });
    await flush();
    // /diagnostics still in flight: nothing published yet, so never green.
    expect(useSystemStore.getState().healthAt).toBeNull();
    expect(verdict().tone).not.toBe('green');
    diagQ[0]!.resolve({ governance: GOOD_GOV });
    await p;
    expect(useSystemStore.getState()).toMatchObject({ mode: 'fallback', governance: { kind: 'ok' } });
    expect(verdict()).toMatchObject({ tone: 'green', read: 'fresh' });
  });

  it('a crew with the snapshot: after an outage, a fresh /health beside a pending /system keeps the yellow', async () => {
    let p = useSystemStore.getState().refresh();
    await flush();
    healthQ[0]!.resolve({ status: 'ok', capabilities: { system: true } });
    await flush();
    systemQ[0]!.resolve(SNAP([]));
    await p;
    expect(verdict().tone).toBe('green');
    // An outage: /health fails.
    p = useSystemStore.getState().refresh();
    await flush();
    healthQ[1]!.reject(new Error('Failed to fetch'));
    await p;
    expect(verdict()).toMatchObject({ tone: 'yellow', read: 'failed' });
    // Crew answers /health again, but /system hangs: still yellow while it is in flight…
    p = useSystemStore.getState().refresh();
    await flush();
    healthQ[2]!.resolve({ status: 'ok', capabilities: { system: true } });
    await flush();
    expect(verdict()).toMatchObject({ tone: 'yellow', read: 'failed' });
    // …and still yellow when it fails.
    systemQ[1]!.reject(new Error('no answer after 10 s'));
    await p;
    expect(verdict()).toMatchObject({ tone: 'yellow', read: 'failed' });
  });
});

describe('Re-check supersedes a read in flight', () => {
  it('the earlier read\'s answer is not shown; the Re-check settles with the new read', async () => {
    const first = useSystemStore.getState().refresh();
    await flush();
    // The first read saw the all-clear before the click…
    healthQ[0]!.resolve({ status: 'ok', capabilities: { system: true } });
    await flush();
    const recheck = useSystemStore.getState().refresh({ force: true });
    await flush();
    systemQ[0]!.resolve(SNAP([]));
    await first;
    // …but a Re-check came after it started: its green is never shown.
    expect(useSystemStore.getState().snapshotAt).toBeNull();
    expect(verdict().tone).not.toBe('green');
    await flush();
    healthQ[1]!.resolve({ status: 'ok', capabilities: { system: true } });
    await flush();
    systemQ[1]!.resolve(SNAP([RED]));
    await recheck;
    expect(verdict()).toMatchObject({ tone: 'red', words: 'a service is down' });
  });

  it('a plain poll during a read shares it (no second request)', async () => {
    const a = useSystemStore.getState().refresh();
    const b = useSystemStore.getState().refresh();
    expect(b).toBe(a);
    await flush();
    expect(healthQ).toHaveLength(1);
    healthQ[0]!.reject(new Error('x'));
    await a;
  });
});
