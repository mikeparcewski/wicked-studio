/**
 * wicked-crew#1982: Learn lands a steering-author run's kept rules from the DRAFT read, not from a gate read, so with no
 * gate in this tab's store the answer named no opening and crew bound whatever opening was open when it arrived. crew's
 * draft read now names the gate it was read at (`gateOrd`, `gateSeq`; crew#1995), and the answer sends them, so crew
 * refuses it (409 `gate_changed`) once that opening has closed and the gate re-opened, at the same ord too.
 *
 * The draft bodies are crew's writer's: `GET /governance/steering/author/:runId/draft` (wicked-crew
 * packages/crew/src/api/routes.ts, the draft handler's return: runId, ready, rules, source, then gateOrd and gateSeq
 * when ready and the record's rows show the gate).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSteeringDraft, keepDraftedRules } from '../src/api/learn.js';
import { useGateStore } from '../src/store/gates.js';

const RUN = 'steer-1982';
const RULE = { id: 'POL-0001', rule_type: 'policy', statement: 'never deploy on friday', severity: 'error', confidence: 0.9, targets: {}, provenance: { source: 'chat', source_kinds: [] }, steering_type: 'operations' };

interface Sent { method: string; path: string; body: Record<string, unknown> }
let sent: Sent[] = [];
let draftBody: Record<string, unknown> = {};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const gatePosts = () => sent.filter((s) => s.method === 'POST' && s.path === `/runs/${RUN}/gate`);

beforeEach(() => {
  sent = [];
  useGateStore.setState({ gates: {} });
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    sent.push({ method, path, body: init?.body === undefined ? {} : JSON.parse(String(init.body)) as Record<string, unknown> });
    if (method === 'GET' && path === `/governance/steering/author/${RUN}/draft`) return Promise.resolve(json(200, draftBody));
    return Promise.resolve(json(200, { status: 'completed', landing: { outcome: 'landed', ruleIds: ['POL-0001'] } }));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); useGateStore.setState({ gates: {} }); });

describe('Learn\'s kept rules name the gate opening their drafts were read at (crew#1982)', () => {
  it('IDENTITY REUSE: with no gate in this tab, the answer names the ord and opening the draft read named', async () => {
    draftBody = { runId: RUN, ready: true, rules: [RULE], source: 'deliverable', gateOrd: 2, gateSeq: 3 };
    const draft = await getSteeringDraft(RUN);
    await keepDraftedRules(RUN, ['POL-0001'], draft);
    expect(gatePosts()[0]!.body).toEqual({ approve: true, keepRules: ['POL-0001'], ord: 2, gateSeq: 3 });
  });

  it('STALE READS: the drafts the person reviewed win over a newer opening this tab has heard of', async () => {
    draftBody = { runId: RUN, ready: true, rules: [RULE], source: 'deliverable', gateOrd: 2, gateSeq: 3 };
    const draft = await getSteeringDraft(RUN);
    // The tab has since heard of a re-opened gate (opening 4) that the person has not reviewed drafts for.
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 2, gateSeq: 4, gateKind: 'phase', prompt: 'Review the drafted rules' } as never);
    await keepDraftedRules(RUN, ['POL-0001'], draft);
    expect(gatePosts()[0]!.body).toMatchObject({ ord: 2, gateSeq: 3 });
  });

  it('PARTIAL FAILURE: an engine that does not number openings: the ord only', async () => {
    draftBody = { runId: RUN, ready: true, rules: [RULE], source: 'deliverable', gateOrd: 2 };
    await keepDraftedRules(RUN, ['POL-0001'], await getSteeringDraft(RUN));
    expect(gatePosts()[0]!.body).toEqual({ approve: true, keepRules: ['POL-0001'], ord: 2 });
  });

  it('PARTIAL FAILURE: an older crew (no fields) keeps today\'s answer: the tab\'s own opening when it holds the gate, else none', async () => {
    draftBody = { runId: RUN, ready: true, rules: [RULE], source: 'deliverable' };
    await keepDraftedRules(RUN, ['POL-0001'], await getSteeringDraft(RUN));
    expect(gatePosts()[0]!.body).toEqual({ approve: true, keepRules: ['POL-0001'] });
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 2, gateSeq: 5, gateKind: 'phase', prompt: 'Review the drafted rules' } as never);
    await keepDraftedRules(RUN, ['POL-0001'], await getSteeringDraft(RUN));
    expect(gatePosts()[1]!.body).toEqual({ approve: true, keepRules: ['POL-0001'], gateSeq: 5 });
  });

  it('UNTRUSTED TEXT OUT: values that are not crew\'s integers are never sent', async () => {
    for (const bad of [{ gateOrd: -1, gateSeq: 0 }, { gateOrd: 1.5, gateSeq: 2.5 }, { gateOrd: '2', gateSeq: '3' }]) {
      sent = [];
      draftBody = { runId: RUN, ready: true, rules: [RULE], source: 'deliverable', ...bad };
      await keepDraftedRules(RUN, ['POL-0001'], await getSteeringDraft(RUN));
      expect(gatePosts()[0]!.body).toEqual({ approve: true, keepRules: ['POL-0001'] });
    }
  });
});
