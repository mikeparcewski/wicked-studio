/**
 * studio#1493: a gate decision names the OPENING it was shown (`gateSeq`, core#1808, crew#1698). A gate that closed and
 * opened again at the same ord (an escalation's retry; wicked-core#2021's terminal gate after "Record it again") is
 * another opening, and crew refuses an answer naming the old one with 409 `gate_changed`. Studio sent no `gateSeq`, so a
 * view that missed the re-open frame (a backgrounded tab, a reconnect gap) answered the NEW opening as if it were the one
 * it showed. The frame is crew's own (tests/fixtures/j4-t17-judges-down-1974.json, crew 0.20.0's `awaitingHuman`); the
 * bodies are the wire crew reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from './fixtures/j4-t17-judges-down-1974.json';
import type { CoreEvent } from '../src/api/types.js';
import { commitGateDecision, commitGateReassign, useGateActionStore } from '../src/board/gateActions.js';
import { keepDraftedRules } from '../src/api/learn.js';
import { runBatchDecision, toggleBatchSelect, useBatchGateStore } from '../src/board/batchGates.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { beginGateRead, gateFromInfo, openingOf, useGateStore } from '../src/store/gates.js';

const frame = fixture.events.find((e) => e.type === 'awaitingHuman') as unknown as CoreEvent & { session: string; ord: number; gateSeq: number; prompt: string; gateKind: string };
const RUN = frame.session;

interface Sent { method: string; path: string; body: Record<string, unknown> }
let sent: Sent[] = [];
/** crew's answer to each request, by `METHOD path`; the default is a 200 `{status:'ok'}`. */
let answers: Record<string, () => Response> = {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sent = [];
  answers = {};
  setUndoWindowForTest(0);
  useGateActionStore.setState({ byGate: {} });
  useGateStore.setState({ gates: {} });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    sent.push({ method, path, body: init?.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown> });
    return Promise.resolve((answers[`${method} ${path}`] ?? (() => json(200, { status: 'ok', ord: frame.ord })))());
  }));
});
afterEach(() => { vi.unstubAllGlobals(); useGateStore.setState({ gates: {} }); });

const posts = (suffix: string) => sent.filter((s) => s.method === 'POST' && s.path === `/runs/${RUN}${suffix}`);

describe('a gate decision names the opening it was shown (studio#1493)', () => {
  it('IDENTITY REUSE: an answer to crew\'s own awaitingHuman frame sends that opening\'s gateSeq', async () => {
    useGateStore.getState().ingest(frame);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 5, gateSeq: 2 });
    await expect(commitGateDecision(RUN, { approve: true })).resolves.toBe('sent');
    expect(posts('/gate')).toHaveLength(1);
    expect(posts('/gate')[0]!.body).toMatchObject({ approve: true, ord: 5, gateSeq: 2 });
  });

  it('STALE READS: a view that missed the re-open names the old opening; crew refuses it, nothing is re-sent, the gate is read again', async () => {
    // The tab still holds opening 2; the gate closed and opened again at ord 5 as opening 3 while it was away.
    useGateStore.getState().ingest(frame);
    answers[`POST /runs/${RUN}/gate`] = () => json(409, { code: 'gate_changed', error: `gate_changed: run ${RUN}'s open gate is opening 3, not the one this answer was sent for (opening 2)` });
    answers[`GET /runs/${RUN}/gate`] = () => json(200, { runId: RUN, ord: 5, prompt: frame.prompt, lifecycle: 'open', receivedAt: '2026-11-27T12:00:00.000Z', gateKind: 'escalation', gateSeq: 3 });
    await expect(commitGateDecision(RUN, { approve: true })).rejects.toThrow();
    expect(posts('/gate').map((p) => p.body['gateSeq'])).toEqual([2]);
    await vi.waitFor(() => expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 5, gateSeq: 3 }));
  });

  it('SHARED/CACHED READS: a gate read naming another opening at the same ord is a new gate instance, not the cached one', () => {
    useGateStore.getState().ingest(frame);
    const shown = useGateStore.getState().gates[RUN]!;
    const read = gateFromInfo({ runId: RUN, ord: 5, prompt: frame.prompt, lifecycle: 'open', receivedAt: '2026-11-27T12:00:00.000Z', gateKind: 'escalation', gateSeq: 3 } as never);
    expect(read.gateSeq).toBe(3);
    expect(useGateStore.getState().applyGateRead(beginGateRead(RUN), read)).toBe(true);
    const now = useGateStore.getState().gates[RUN]!;
    expect(now.gateSeq).toBe(3);
    expect(now.receivedAt).not.toBe(shown.receivedAt);
  });

  it('a read of the SAME opening keeps the instance the live frame put there', () => {
    useGateStore.getState().ingest(frame);
    const shown = useGateStore.getState().gates[RUN]!;
    const read = gateFromInfo({ runId: RUN, ord: 5, prompt: frame.prompt, lifecycle: 'open', receivedAt: '2026-11-27T12:00:00.000Z', gateKind: 'escalation', gateSeq: 2 } as never);
    useGateStore.getState().applyGateRead(beginGateRead(RUN), read);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ gateSeq: 2, receivedAt: shown.receivedAt });
  });

  it('IDENTITY REUSE: the move-and-retry on a gate names its opening too', async () => {
    useGateStore.getState().ingest(frame);
    await expect(commitGateReassign(RUN, 'codex', 'Codex')).resolves.toBe('sent');
    expect(posts('/reassign')[0]!.body).toMatchObject({ cli: 'codex', ord: 5, gateSeq: 2 });
  });

  it('IDENTITY REUSE: landing kept drafted rules at a propose gate names its opening', async () => {
    useGateStore.getState().ingest(frame);
    await keepDraftedRules(RUN, ['r1']);
    expect(posts('/gate')[0]!.body).toMatchObject({ approve: true, keepRules: ['r1'], gateSeq: 2 });
  });

  it('IDENTITY REUSE: a batch answer names, per run, the opening each gate showed when the batch was decided', async () => {
    useBatchGateStore.setState({ selected: [], running: false, done: 0, total: 0, failures: [], lastDecision: null });
    useGateStore.getState().ingest(frame);
    toggleBatchSelect(RUN);
    await runBatchDecision({ approve: true });
    expect(posts('/gate')[0]!.body).toMatchObject({ approve: true, ord: 5, gateSeq: 2 });
  });

  it('the reassign control names the opening only of the gate at the step it moves (openingOf)', () => {
    useGateStore.getState().ingest(frame);
    expect(openingOf(RUN, 5)).toBe(2);
    expect(openingOf(RUN)).toBe(2);
    // Another step (an executing run's, not the gate's) names no opening; neither does a run with no gate here.
    expect(openingOf(RUN, 4)).toBeUndefined();
    expect(openingOf('another-run', 5)).toBeUndefined();
  });

  it('PARTIAL FAILURE: a daemon that names no opening (an older crew, a pre-field row\'s 0) gets no gateSeq at all', async () => {
    for (const seq of [undefined, 0, -1, 1.5, '2']) {
      sent = [];
      useGateActionStore.setState({ byGate: {} });
      useGateStore.setState({ gates: {} });
      const bare: Record<string, unknown> = { ...frame };
      delete bare['gateSeq'];
      useGateStore.getState().ingest((seq === undefined ? bare : { ...bare, gateSeq: seq }) as never);
      expect(useGateStore.getState().gates[RUN]?.gateSeq).toBeUndefined();
      await expect(commitGateDecision(RUN, { approve: true })).resolves.toBe('sent');
      expect(posts('/gate')[0]!.body).not.toHaveProperty('gateSeq');
    }
  });
});
