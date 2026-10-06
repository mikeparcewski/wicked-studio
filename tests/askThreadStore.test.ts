import { beforeEach, describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore } from '../src/store/gates.js';

/**
 * ASK-S1 — the live side of an ask: the operator's turn deposited at the 202, the PA's reply as it
 * streams (`chatDelta` grows, `chatReply` REPLACES), the run learnt from the 202 / the reply, the
 * PA learnt from the frames, `chatClosed` dropping the chat. Frames are the relay's shapes
 * (crew `ask-relay.ts`, captured live 2026-10-05).
 */
const frame = (f: Record<string, unknown>): CoreEvent => f as unknown as CoreEvent;

beforeEach(() => {
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useCapabilities.setState({ loaded: true, askPath: true });
  useGateStore.setState({ gates: {}, approaching: {} });
});

describe('under the capability only (codex r2 #3)', () => {
  it('without askPath nothing is an ask path: learnRuns and a reply’s run_id teach no run, and the gate store draws every gate', () => {
    useCapabilities.setState({ askPath: false });
    const st = useAskThreadStore.getState();
    st.learnRuns([{ session: { id: 'r1', chat_id: 'c1' }, units: [{ description: 'answer-1 — q' }] }]);
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'x', ok: true, turn_id: 't1', run_id: 'r1', ord: 1 }));
    expect(useAskThreadStore.getState().runs.size).toBe(0);
    expect(useAskThreadStore.getState().runByChat['c1']).toBeUndefined();
    expect(useAskThreadStore.getState().turns['c1']).toHaveLength(1); // the reply is still a turn
    // Even a run this client once knew as a path: a def gate on an older daemon is drawn, not recorded.
    useAskThreadStore.setState({ runs: new Set(['r9']) });
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r9', ord: 1, gateKind: 'def', prompt: 'Approve unit 1 before it runs' }));
    expect(useGateStore.getState().gates['r9']).toMatchObject({ ord: 1 });
    expect(useAskThreadStore.getState().turnGates['r9']).toBeUndefined();
  });
});

describe('stale turn gates (codex r2 #2)', () => {
  it('reconcileTurnGates drops the record of a run that no longer waits, or that waits at another unit than the record’s', () => {
    const st = useAskThreadStore.getState();
    st.linkRun('c1', 'r1'); st.linkRun('c2', 'r2'); st.linkRun('c3', 'r3'); st.linkRun('c4', 'r4');
    st.recordTurnGate('r1', 1); st.recordTurnGate('r2', 1); st.recordTurnGate('r3', 1); st.recordTurnGate('r4', 1);
    st.reconcileTurnGates([
      { id: 'r2', status: 'awaiting_human', cursorOrd: 1 },   // still there: kept
      { id: 'r3', status: 'awaiting_human', cursorOrd: 3 },   // waits at a LATER unit (a transition missed): stale
      { id: 'r4', status: 'awaiting_human', cursorOrd: null }, // the cursor is unknown: kept (the gate read re-classifies it)
      { id: 'r1', status: 'executing', cursorOrd: 2 },        // moved on: stale
    ]);
    const g = useAskThreadStore.getState().turnGates;
    expect(g['r1']).toBeUndefined();
    expect(g['r2']).toMatchObject({ ord: 1 });
    expect(g['r3']).toBeUndefined();
    expect(g['r4']).toMatchObject({ ord: 1 });
  });

  it('answer ords are learnt from the runs list, the reply’s ord and step.claimed — and a gate is the turn gate only at one of them (codex r3 #1)', () => {
    const st = useAskThreadStore.getState();
    st.learnRuns([{ session: { id: 'r1', chat_id: 'c1' }, units: [{ description: 'answer-1 — q', ord: 1 }, { description: 'answer-2 — more', ord: 2 }] }]);
    expect(useAskThreadStore.getState().answerOrds['r1']).toStrictEqual([1, 2]);
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'x', ok: true, turn_id: 't3', run_id: 'r1', ord: 3 }));
    expect(useAskThreadStore.getState().answerOrds['r1']).toStrictEqual([1, 2, 3]);
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 30, event_type: 'wicked.team.step.claimed', payload: { run_id: 'r1', ord: 4, attempt: 0, by: 'claude', step_id: 'answer-4' } } }));
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 31, event_type: 'wicked.team.step.claimed', payload: { run_id: 'r1', ord: 5, attempt: 0, by: 'codex', step_id: 'research-1' } } }));
    expect(useAskThreadStore.getState().answerOrds['r1']).toStrictEqual([1, 2, 3, 4]);
    // The gate store: a def gate at unit 5 (the research step) is drawn; the terminal gate at unit 4 is the turn.
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r1', ord: 5, gateKind: 'def', prompt: 'Approve unit 5 before it runs' }));
    expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 5 });
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined();
    useGateStore.setState({ gates: {}, approaching: {} });
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r1', ord: 4, gateKind: 'terminal', prompt: 'Approve the output of unit 4' }));
    expect(useGateStore.getState().gates['r1']).toBeUndefined();
    expect(useAskThreadStore.getState().turnGates['r1']).toMatchObject({ ord: 4 });
  });

  it('a plan that mixes research or build steps between the answers is still an ask path; only the answer units are turn-gate ords (codex r4 #2)', () => {
    const st = useAskThreadStore.getState();
    st.learnRuns([{ session: { id: 'r1', chat_id: 'c1' }, units: [{ description: 'answer-1 — q', ord: 1 }, { description: 'research-1 — check the migration', ord: 2 }, { description: 'answer-2 — and?', ord: 3 }] }]);
    expect(useAskThreadStore.getState().runs.has('r1')).toBe(true);
    expect(useAskThreadStore.getState().answerOrds['r1']).toStrictEqual([1, 3]);
    // A chat-launched run with no answer step at all (a build from a chat) is not a path.
    st.learnRuns([{ session: { id: 'r2', chat_id: 'c2' }, units: [{ description: 'build — fix it', ord: 1 }] }]);
    expect(useAskThreadStore.getState().runs.has('r2')).toBe(false);
    // The fold's claimed answer steps teach a linked run its ords; an unknown run teaches nothing.
    st.linkRun('c3', 'r3');
    st.learnAnswerOrds('r3', [2, 4]);
    st.learnAnswerOrds('r-unknown', [1]);
    expect(useAskThreadStore.getState().answerOrds['r3']).toStrictEqual([2, 4]);
    expect(useAskThreadStore.getState().answerOrds['r-unknown']).toBeUndefined();
  });

  it('a gate cached before the run was known as an ask path is reclassified once the runs list says so (codex r3 #2)', () => {
    // The frame came first (no run knowledge yet): it is drawn.
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r1', ord: 1, gateKind: 'terminal', prompt: 'Approve the output of unit 1 (answer-1) — the plan is complete.' }));
    expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 1 });
    // The runs list arrives and classifies the run; the cached gate becomes the recorded turn gate.
    useAskThreadStore.getState().learnRuns([{ session: { id: 'r1', chat_id: 'c1' }, units: [{ description: 'answer-1 — q', ord: 1 }] }]);
    useGateStore.getState().reclassifyAskGates();
    expect(useGateStore.getState().gates['r1']).toBeUndefined();
    expect(useAskThreadStore.getState().turnGates['r1']).toMatchObject({ ord: 1 });
    // Without the capability nothing is reclassified.
    useCapabilities.setState({ askPath: false });
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r1', ord: 1, gateKind: 'terminal', prompt: 'Approve the output of unit 1' }));
    useGateStore.getState().reclassifyAskGates();
    expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 1 });
  });

  it('a real gate landing on the run clears its recorded turn gate — the live frame and the late-join read alike', () => {
    const st = useAskThreadStore.getState();
    st.linkRun('c1', 'r1');
    useAskThreadStore.setState({ answerOrds: { r1: [1] } });
    st.recordTurnGate('r1', 1);
    useGateStore.getState().ingest(frame({ type: 'awaitingHuman', session: 'r1', ord: 2, gateKind: 'deliver', prompt: 'Deliver unit 2 as a PR?' }));
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined();
    expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 2 });
    useGateStore.setState({ gates: {}, approaching: {} });
    st.recordTurnGate('r1', 1);
    useGateStore.getState().setGate({ runId: 'r1', ord: 3, prompt: 'Approve plan rev 2 before unit 3 runs: build-1 → review.', lifecycle: 'open', receivedAt: 1 });
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined();
    expect(useGateStore.getState().gates['r1']).toMatchObject({ ord: 3 });
    // The turn gate itself, read late with no kind, is still recorded and not drawn.
    useGateStore.setState({ gates: {}, approaching: {} });
    useGateStore.getState().setGate({ runId: 'r1', ord: 1, prompt: 'Approve the output of unit 1 (answer-1) — the plan is complete.', lifecycle: 'open', receivedAt: 1 });
    expect(useAskThreadStore.getState().turnGates['r1']).toMatchObject({ ord: 1 });
    expect(useGateStore.getState().gates['r1']).toBeUndefined();
  });

  it('creator knowledge is positive only: marking twice is one fact, and nothing resets it (codex r2 #1)', () => {
    const st = useAskThreadStore.getState();
    st.linkRun('c1', 'r1'); st.recordTurnGate('r1', 1);
    st.markCreatorAccepted('r1'); st.markCreatorAccepted('r1');
    expect(useAskThreadStore.getState().creatorAccepted['r1']).toBe(true);
    expect(useAskThreadStore.getState().turnGates['r1']).toBeUndefined();
    expect('setCreatorAccepted' in useAskThreadStore.getState()).toBe(false);
  });
});

describe('a re-pick (codex r2 #6)', () => {
  it('retires the old PA’s half-typed bubble and its late frames; a failed attempt drops the pending bubble, the seat may try again', () => {
    const st = useAskThreadStore.getState();
    st.sent('c1', { turnId: 't1', text: 'q', runId: 'r1', stepId: 'answer-1' });
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'I thi', turn_id: 't1' }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude')).toHaveLength(1);
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 20, event_type: 'wicked.team.path.repicked', payload: { run_id: 'r1', ord: 1, attempt: 0, from: 'claude', to: 'codex', reason: 'timed_out', pick_seq: 1 } } }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude')).toHaveLength(0);
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'nk', turn_id: 't1' }));
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'I think', ok: false, turn_id: 't1' }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude')).toHaveLength(0);
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'codex', text: 'The', turn_id: 't1' }));
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'codex', text: 'The answer.', ok: true, turn_id: 't1', run_id: 'r1', ord: 1 }));
    const codex = useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'codex');
    expect(codex).toHaveLength(1);
    expect(codex[0]).toMatchObject({ text: 'The answer.', pending: false });
    // Picked again (codex → claude): claude answers again — a re-pick retires the seat it leaves, not forever (r3 #4).
    st.sent('c1', { turnId: 't1b', text: 'and?', runId: 'r1', stepId: 'answer-1' });
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 22, event_type: 'wicked.team.path.repicked', payload: { run_id: 'r1', ord: 1, attempt: 1, from: 'codex', to: 'claude', reason: 'timed_out', pick_seq: 2 } } }));
    expect(useAskThreadStore.getState().retiredByChat['c1']).toStrictEqual(['codex']);
    st.ingest(frame({ type: 'chatReply', chat: 'c1', cliKey: 'claude', text: 'Back again.', ok: true, turn_id: 't1b', run_id: 'r1', ord: 1 }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude')).toHaveLength(1);
    // No re-pick (nobody else to pick): the attempt times out, the half-typed bubble goes, the same seat tries again.
    st.sent('c1', { turnId: 't2', text: 'again', runId: 'r1', stepId: 'answer-2' });
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'Hm', turn_id: 't2' }));
    st.ingest(frame({ type: 'teamEvent', event: { event_id: 21, event_type: 'wicked.team.step.completed', payload: { run_id: 'r1', ord: 2, attempt: 0, by: 'claude', step_id: 'answer-2', status: 'timed_out' } } }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude' && t.pending)).toHaveLength(0);
    st.ingest(frame({ type: 'chatDelta', chat: 'c1', cliKey: 'claude', text: 'Second try', turn_id: 't2' }));
    expect(useAskThreadStore.getState().turns['c1']!.filter((t) => t.who === 'claude' && t.pending)).toHaveLength(1);
  });
});

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
  it('a chat-launched run with an answer step is an ask path (one that continued into build included); a build run from a chat with no answer step is not; a run with no chat is not', () => {
    useAskThreadStore.getState().learnRuns([
      { session: { id: 'r-ask', chat_id: 'c1' }, units: [{ description: 'answer-1 — why?', ord: 1 }, { description: 'answer-2 — and?', ord: 2 }] },
      { session: { id: 'r-continued', chat_id: 'c2' }, units: [{ description: 'answer-1 — why?', ord: 1 }, { description: 'build-1 — trim', ord: 2 }] },
      { session: { id: 'r-build', chat_id: 'c4' }, units: [{ description: 'understand — read the code', ord: 1 }, { description: 'build-1 — trim', ord: 2 }] },
      { session: { id: 'r-solo', chat_id: null }, units: [{ description: 'answer-1 — why?', ord: 1 }] },
      { session: { id: 'r-empty', chat_id: 'c3' }, units: [] },
    ]);
    const s = useAskThreadStore.getState();
    expect([...s.runs]).toStrictEqual(['r-ask', 'r-continued']);
    expect(s.runByChat).toStrictEqual({ c1: 'r-ask', c2: 'r-continued' });
    // The continued run's build unit is never a turn-gate ord: a gate there is drawn.
    expect(s.answerOrds['r-continued']).toStrictEqual([1]);
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
