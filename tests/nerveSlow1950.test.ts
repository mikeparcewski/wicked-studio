import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * wicked-crew#1950 (residual): on a loaded host the Nerve Center said "Can't reach crew: health check failed: no answer
 * after 10 s" while crew answered `GET /health` in 4-30 ms. The browser holds a few sockets per origin over HTTP/1.1,
 * so the page's own slow reads (/diagnostics, /system, /runs ...) queued studio's /health past its 10 s bound. A read
 * that fails ONLY on studio's bound, while crew answered something else during the same tick, is "slow", never "can't
 * reach". Everything here goes through the real client (`apiFetch`) over a stubbed `fetch`.
 */

type Deferred = { promise: Promise<Response>; resolve: (r: Response) => void; reject: (e: unknown) => void };
function deferred(): Deferred {
  let resolve!: (r: Response) => void; let reject!: (e: unknown) => void;
  const promise = new Promise<Response>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Every request in flight, by path under /api/v1. */
let pending: Array<{ path: string; d: Deferred }> = [];
const take = (path: string): Deferred => {
  // The newest: an abandoned read that ran out of time may still be queued under the same path.
  const i = pending.map((p) => p.path).lastIndexOf(path);
  if (i < 0) throw new Error(`no request in flight for ${path}: ${pending.map((p) => p.path).join(', ')}`);
  return pending.splice(i, 1)[0]!.d;
};
const json = (body: unknown, status = 200): Response => status === 304 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const { resetSystemStore, useSystemStore, READ_TIMEOUT_MS } = await import('../src/store/systemSnapshot.js');
const { nerveState, CANT_REACH } = await import('../src/board/nerveCenter.js');
const { overviewSentence } = await import('../src/board/nerveOverview.js');
const { headline } = await import('../src/components/nerve/NerveCenterPage.js');
const { STALE_MS } = await import('../src/board/nerveCenter.js');
const { apiFetch } = await import('../src/api/client.js');

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
/** Let studio's bound run out on whatever is still queued (a first failed read gets one more, studio#931), until `p` settles. */
async function settle(p: Promise<void>): Promise<void> {
  let done = false;
  void p.then(() => { done = true; });
  for (let i = 0; i < 4 && !done; i++) await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS);
  await p;
}
const verdict = () => nerveState(useSystemStore.getState(), 'connected', 0, Date.now());
const SNAP = { checkedAt: new Date().toISOString(), budgetMs: 1, tookMs: 1, level: 'green', attention: [], clis: [], runs: [], infra: [], governance: [] };
const SYSTEM_HEALTH = { status: 'ok', version: '0.20.1', capabilities: { system: true } };

/** Another read of the page (the Desk's run list), answered while the Nerve Center's read is queued. */
async function otherReadAnswers(status = 200): Promise<void> {
  const read = apiFetch('/runs').catch(() => undefined);
  await flush();
  take('/runs').resolve(json({ runs: [] }, status));
  await read;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  pending = [];
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const d = deferred();
    pending.push({ path: String(url).replace(/^.*\/api\/v1/, '').split('?')[0]!, d });
    return d.promise;
  }));
  resetSystemStore();
});
afterEach(() => {
  resetSystemStore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('crew#1950: a read that only ran out of studio\'s time while crew answered is slow, not unreachable', () => {
  it('/health queued past 10 s while another read answered: "crew is slow to answer", never "can\'t reach crew"', async () => {
    const p = useSystemStore.getState().refresh();
    await flush();
    await otherReadAnswers();
    await settle(p);
    const v = verdict();
    expect(v.words).not.toBe(CANT_REACH);
    expect(v).toMatchObject({ tone: 'yellow', read: 'slow', words: 'crew is slow to answer' });
    expect(v.attention[0]).toMatchObject({ id: 'crew-slow', action: { kind: 'recheck' } });
    // Nothing is published from the evidence: no health answer, no snapshot, never fresh. The failure stays recorded as
    // one, so every other reader of the store (voice, the ranked needs, the report) treats it as a failed read.
    expect(useSystemStore.getState()).toMatchObject({ health: null, healthAt: null, snapshot: null, healthError: 'no answer after 10 s' });
  });

  it('/system queued past 10 s after this tick\'s /health answered: slow, and the old snapshot is not passed off as fresh', async () => {
    let p = useSystemStore.getState().refresh();
    await flush();
    take('/health').resolve(json(SYSTEM_HEALTH));
    await flush();
    take('/system').resolve(json(SNAP));
    await p;
    expect(verdict()).toMatchObject({ tone: 'green', read: 'fresh' });
    const before = useSystemStore.getState().snapshotAt;
    await vi.advanceTimersByTimeAsync(5_000);
    p = useSystemStore.getState().refresh();
    await flush();
    take('/health').resolve(json(SYSTEM_HEALTH));
    await flush();
    await settle(p);
    expect(verdict()).toMatchObject({ tone: 'yellow', read: 'slow', words: 'crew is slow to answer' });
    expect(useSystemStore.getState().snapshotAt).toBe(before);
    // The failed snapshot read stays a failed read for every other reader.
    expect(useSystemStore.getState().snapshotError).toBe('no answer after 10 s');
  });

  it('a slow spell past what the Nerve Center trusts says how old the last full answer is, and is still never fresh', async () => {
    let p = useSystemStore.getState().refresh();
    await flush();
    take('/health').resolve(json(SYSTEM_HEALTH));
    await flush();
    take('/system').resolve(json(SNAP));
    await p;
    await vi.advanceTimersByTimeAsync(STALE_MS + 60_000);
    p = useSystemStore.getState().refresh();
    await flush();
    take('/health').resolve(json(SYSTEM_HEALTH));
    await settle(p);
    const v = verdict();
    expect(v).toMatchObject({ tone: 'yellow', read: 'slow' });
    expect(v.attention[0]!.reason).toMatch(/Its last full answer is 2 min old\./);
  });

  it('the Nerve Center page headline says slow, not unreachable', () => {
    expect(headline({ tone: 'yellow', read: 'slow', words: 'crew is slow to answer', attention: [] })).toBe('Crew is slow to answer — what you see below may be out of date.');
  });

  it('the overview sentence says crew is slow, not that it cannot be reached', () => {
    expect(overviewSentence({ read: 'slow' } as Parameters<typeof overviewSentence>[0], [], 0)).toMatchObject({ lead: 'Crew is slow to answer.', tone: 'warn' });
  });

  it('a later read that lands clears it', async () => {
    let p = useSystemStore.getState().refresh();
    await flush();
    await otherReadAnswers();
    await settle(p);
    expect(verdict().read).toBe('slow');
    p = useSystemStore.getState().refresh();
    await flush();
    take('/health').resolve(json(SYSTEM_HEALTH));
    await flush();
    take('/system').resolve(json(SNAP));
    await p;
    expect(verdict()).toMatchObject({ tone: 'green', read: 'fresh' });
  });
});

describe('crew#1950: what still says "can\'t reach crew"', () => {
  it('a timeout with no other answer from crew', async () => {
    const p = useSystemStore.getState().refresh();
    await settle(p);
    expect(verdict()).toMatchObject({ read: 'failed', words: CANT_REACH });
  });

  it('an answer that landed BEFORE the read began is not evidence', async () => {
    await otherReadAnswers();
    await vi.advanceTimersByTimeAsync(1_000);
    const p = useSystemStore.getState().refresh();
    await settle(p);
    expect(verdict()).toMatchObject({ read: 'failed', words: CANT_REACH });
  });

  it('a network error, even while crew answered another read', async () => {
    const p = useSystemStore.getState().refresh();
    await flush();
    await otherReadAnswers();
    take('/health').reject(new TypeError('Failed to fetch'));
    await settle(p);
    expect(verdict()).toMatchObject({ read: 'failed', words: CANT_REACH });
  });

  it('an HTTP error from /health, even while crew answered another read', async () => {
    const p = useSystemStore.getState().refresh();
    await flush();
    await otherReadAnswers();
    take('/health').resolve(json({ error: 'boom' }, 500));
    await settle(p);
    expect(verdict()).toMatchObject({ read: 'failed', words: CANT_REACH });
  });

  it.each([502, 401, 304])('a %s (a gateway, an auth proxy, a cache) is not crew answering', async (status) => {
    const p = useSystemStore.getState().refresh();
    await flush();
    await otherReadAnswers(status);
    await settle(p);
    expect(verdict()).toMatchObject({ read: 'failed', words: CANT_REACH });
  });
});
