import { beforeEach, describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { useAskThreadStore } from '../src/store/askThread.js';

/**
 * ASK-S1 — the live side of an ask: the operator's turn deposited at the 202, the PA's reply as it
 * streams (`chatDelta` grows, `chatReply` REPLACES), the run learnt from the 202 / the reply, the
 * PA learnt from the frames, `chatClosed` dropping the chat. Frames are the relay's shapes
 * (crew `ask-relay.ts`, captured live 2026-10-05).
 */
const frame = (f: Record<string, unknown>): CoreEvent => f as unknown as CoreEvent;

beforeEach(() => useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {} }));

describe('the operator’s turn', () => {
  it('lands at once with its turn, run and step; the run is known as an ask path; a repeat is one turn', () => {
    useAskThreadStore.getState().sent('c1', { turnId: 't1', text: 'why no trim?', runId: 'r1', stepId: 'answer-1', at: 10 });
    useAskThreadStore.getState().sent('c1', { turnId: 't1', text: 'why no trim?', runId: 'r1', stepId: 'answer-1', at: 10 });
    const s = useAskThreadStore.getState();
    expect(s.turns['c1']).toStrictEqual([{ turnId: 't1', who: 'you', text: 'why no trim?', pending: false, ok: true, at: 10, runId: 'r1', stepId: 'answer-1' }]);
    expect(s.runByChat['c1']).toBe('r1');
    expect(s.runs.has('r1')).toBe(true);
  });

  it('without a path (older daemon) the turn still lands, with no run', () => {
    useAskThreadStore.getState().sent('c1', { turnId: 't1', text: 'hi', at: 10 });
    expect(useAskThreadStore.getState().runByChat['c1']).toBeUndefined();
    expect(useAskThreadStore.getState().runs.size).toBe(0);
  });
});

describe('the PA’s reply', () => {
  it('deltas grow one pending turn per (turn, seat); the reply replaces the text and finishes it; the PA is learnt', () => {
    const st = useAskThreadStore.getState();
    st.sent('c1', { turnId: 't1', text: 'q', runId: 'r1', at: 10 });
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'Let me ', turn_id: 't1' }));
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'read…', turn_id: 't1' }));
    let turns = useAskThreadStore.getState().turns['c1']!;
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ turnId: 't1', who: 'claude', text: 'Let me read…', pending: true });
    expect(useAskThreadStore.getState().replySeq['c1'] ?? 0).toBe(0);
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'greet() does not trim (src/greet.js:2).', ok: true, run_id: 'r1', ord: 1, turn_id: 't1' }));
    turns = useAskThreadStore.getState().turns['c1']!;
    expect(turns).toHaveLength(2);
    expect(turns[1]).toMatchObject({ who: 'claude', text: 'greet() does not trim (src/greet.js:2).', pending: false, ok: true, runId: 'r1', ord: 1 });
    expect(useAskThreadStore.getState().replySeq['c1']).toBe(1);
    expect(useAskThreadStore.getState().paByChat['c1']).toBe('claude');
    // A late delta after the reply changes nothing: the canonical text stands.
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'zzz', turn_id: 't1' }));
    expect(useAskThreadStore.getState().turns['c1']![1]!.text).toBe('greet() does not trim (src/greet.js:2).');
  });

  it('a reply with no deltas before it is one finished turn; a failed reply reads ok:false', () => {
    const st = useAskThreadStore.getState();
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'claude did not answer: timed_out', ok: false, run_id: 'r1', ord: 1, turn_id: 't1' }));
    expect(useAskThreadStore.getState().turns['c1']).toStrictEqual([
      expect.objectContaining({ who: 'claude', pending: false, ok: false, runId: 'r1', ord: 1 }),
    ]);
    expect(useAskThreadStore.getState().runs.has('r1')).toBe(true);
  });

  it('a frame without turn_id (a daemon predating the turn index) joins the newest operator turn', () => {
    const st = useAskThreadStore.getState();
    st.sent('c1', { turnId: 't1', text: 'q1', at: 1 });
    st.sent('c1', { turnId: 't2', text: 'q2', at: 2 });
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'A' }));
    expect(useAskThreadStore.getState().turns['c1']![2]).toMatchObject({ turnId: 't2', who: 'claude', text: 'A', pending: true });
  });

  it('frames of another chat, frames without a seat, and non-chat frames change nothing', () => {
    const st = useAskThreadStore.getState();
    const before = useAskThreadStore.getState();
    st.ingest(frame({ type: 'chatDelta', chat: '', cliKey: 'claude', text: 'x' }));
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', text: 'x' }));
    st.ingest(frame({ type: 'unitOutputDelta', session: 'r1', ord: 1, text: 'x' }));
    expect(useAskThreadStore.getState().turns).toBe(before.turns);
  });
});

describe('what the gate filter knows', () => {
  it('a plan.accepted with a creator step on an ask run ends the turn-gate regime; another run’s row is ignored', () => {
    const st = useAskThreadStore.getState();
    st.linkRun('c1', 'r1');
    st.recordTurnGate('r1', 2);
    expect(useAskThreadStore.getState().turnGates['r1']).toMatchObject({ ord: 2 });
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 9, event_type: 'wicked.team.plan.accepted', payload: { run_id: 'r-other', steps: [{ catalog: 'build', id: 'b' }] } } }));
    expect(useAskThreadStore.getState().creatorAccepted['r-other']).toBeUndefined();
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 10, event_type: 'wicked.team.plan.accepted', payload: { run_id: 'r1', steps: [{ catalog: 'understand', id: 'answer-1' }] } } }));
    expect(useAskThreadStore.getState().creatorAccepted['r1']).toBeUndefined();
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 11, event_type: 'wicked.team.plan.accepted', payload: { run_id: 'r1', steps: [{ catalog: 'understand', id: 'answer-1' }, { catalog: 'build', id: 'build-1' }] } } }));
    expect(useAskThreadStore.getState().creatorAccepted['r1']).toBe(true);
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined(); // spent: real work's gates follow
  });

  it('a recorded turn gate is spent when the run moves (resumed / terminal frames)', () => {
    const st = useAskThreadStore.getState();
    st.linkRun('c1', 'r1');
    st.recordTurnGate('r1', 1);
    st.ingest(frame({ type: 'resumed', session: 'r1', ord: 2 }));
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined();
  });

  it('a citations or decisions frame after the reply ticks the re-read (codex #6)', () => {
    const st = useAskThreadStore.getState();
    st.ingest(frame({ type: 'chatCitations', chat: 'c1', cliKey: 'claude', turn_id: 't1', verified: 1, unverifiable: 0, corrected: 0, unchecked: 0, items: [] }));
    expect(useAskThreadStore.getState().replySeq['c1']).toBe(1);
    st.ingest(frame({ type: 'chatDecisions', chat: 'c1', turn_id: 't1', items: [] }));
    expect(useAskThreadStore.getState().replySeq['c1']).toBe(2);
  });

  it('legacy frames with no turn_id and no operator turn fold into ONE pending bubble per seat, then one finished one (codex #5)', () => {
    const st = useAskThreadStore.getState();
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'A' }));
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'B' }));
    expect(useAskThreadStore.getState().turns['c1']).toHaveLength(1);
    expect(useAskThreadStore.getState().turns['c1']![0]).toMatchObject({ text: 'AB', pending: true });
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'AB', ok: true }));
    expect(useAskThreadStore.getState().turns['c1']).toHaveLength(1);
    expect(useAskThreadStore.getState().turns['c1']![0]).toMatchObject({ text: 'AB', pending: false });
    // The next reply of the same seat is its own bubble, keyed stably.
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'C' }));
    expect(useAskThreadStore.getState().turns['c1']).toHaveLength(2);
  });
});

describe('learning ask runs from the run DTOs (a fresh page)', () => {
  it('a chat-launched run whose every unit is an answer step is an ask path; a build run from a chat is not; a run with no chat is not', () => {
    useAskThreadStore.getState().learnRuns([
      { session: { id: 'r-ask', chat_id: 'c1' }, units: [{ description: 'answer-1 — why?' }, { description: 'answer-2 — and?' }] },
      { session: { id: 'r-build', chat_id: 'c2' }, units: [{ description: 'answer-1 — why?' }, { description: 'build-1 — trim' }] },
      { session: { id: 'r-solo', chat_id: null }, units: [{ description: 'answer-1 — why?' }] },
      { session: { id: 'r-empty', chat_id: 'c3' }, units: [] },
    ]);
    const s = useAskThreadStore.getState();
    expect([...s.runs]).toStrictEqual(['r-ask']);
    expect(s.runByChat).toStrictEqual({ c1: 'r-ask' });
  });
});

describe('the end', () => {
  it('chatClosed and drop forget the chat’s turns and run link; the run stays known as an ask path', () => {
    const st = useAskThreadStore.getState();
    st.sent('c1', { turnId: 't1', text: 'q', runId: 'r1', at: 1 });
    st.ingest(frame({ type: 'chatClosed', chat: 'c1' }));
    expect(useAskThreadStore.getState().turns['c1']).toBeUndefined();
    expect(useAskThreadStore.getState().runByChat['c1']).toBeUndefined();
    expect(useAskThreadStore.getState().runs.has('r1')).toBe(true);
    st.sent('c2', { turnId: 't1', text: 'q', runId: 'r2', at: 1 });
    useAskThreadStore.getState().drop('c2');
    expect(useAskThreadStore.getState().turns['c2']).toBeUndefined();
  });
});
