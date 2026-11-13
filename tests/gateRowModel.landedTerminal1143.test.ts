import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { APPROVE_COMPLETION_LABEL, RETRY_NOTE_LABEL, landedReviewAt, sessionGateChoices } from '../src/board/gateRowModel.js';
import { classifyRowGate } from '../src/board/questionRow.js';
import { makeUnit } from './factories.js';

// studio#1143: the run's own order after a capped review is landed — awaitingHuman review_adjudication → resumed →
// gateDecided allow:true → unitDone → awaitingHuman terminal, all at the same ord, with no gateEvaluated after the land.
const RUN = 'r-1143';
const ORD = 5;
const ADJ = 'Unit 5 verdict is NOT PASS again — round 3, after 2 send-backs to unit 4 (the rework cap is 2), so this gate adjudicates instead of sending it back. Approve = LAND WITH CARRIED ITEMS: the creator\'s work counts. Request changes = ONE MORE ROUND. Reject = STOP the run';
const TERMINAL = 'Approve completion after the final phase (unit 5)';
const FAIL_REASON = 'The empty state is missing\n- the retry button has no label\n- the title overflows at 390px';

const units = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'done', assigned_cli: 'pi' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: ORD, role: 'evaluator', status: 'done', assigned_cli: 'codex' }),
] as WorkUnit[];

const review: CoreEvent[] = [
  { type: 'unitDispatched', session: RUN, ord: ORD, ts: 1 },
  { type: 'gateEvaluated', session: RUN, ord: ORD, ts: 2, combined: false, denial: { source: 'evaluator_verdict', reason: FAIL_REASON } },
  { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 3, prompt: ADJ, gateKind: 'review_adjudication' },
] as unknown as CoreEvent[];
const landed: CoreEvent[] = [
  ...review,
  { type: 'resumed', session: RUN, ord: ORD, ts: 4 },
  { type: 'gateDecided', session: RUN, ord: ORD, ts: 4, allow: true },
  { type: 'unitDone', session: RUN, ord: ORD, ts: 5 },
  { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 6, prompt: TERMINAL, gateKind: 'terminal' },
] as unknown as CoreEvent[];

const terminal = (): OpenGate => ({ runId: RUN, ord: ORD, prompt: TERMINAL, gateKind: 'terminal', lifecycle: 'open', receivedAt: 6 });
const rowOf = (events: CoreEvent[], gate = terminal()) => sessionGateChoices({ runId: RUN, gate, units, events, pool: ['pi', 'codex'], roster: null })!;
const all = (m: ReturnType<typeof rowOf>) => [...m.choices, ...m.overflow];

describe('studio#1143 — the terminal card after Land with carried items', () => {
  it('offers Approve completion first and recommended, and nothing labelled as a retry', () => {
    const m = rowOf(landed);
    expect(m.choices[0]).toMatchObject({ key: 'approve', label: APPROVE_COMPLETION_LABEL, decision: { approve: true }, needsNote: false });
    expect(m.recommended).toBe(0);
    expect(m.choices.map((c) => c.key)).toEqual(['approve', 'stop']);
    for (const c of all(m)) {
      expect(c.label).not.toMatch(/retry|send back/i);
      expect(c.key).not.toBe('send-back');
    }
    expect(all(m).some((c) => c.label === RETRY_NOTE_LABEL)).toBe(false);
    expect(m.choices.find((c) => c.key === 'stop')?.decision).toEqual({ approve: false });
  });

  it('lists the carried items (the landed review\'s FAIL items) in its detail', () => {
    const m = rowOf(landed);
    expect(m.detailItems.join('\n')).toMatch(/retry button has no label/);
    expect(m.detailItems.join('\n')).toMatch(/title overflows at 390px/);
  });

  it('reads the whole verdict when the engine truncated the one in the log', () => {
    const cut = landed.map((e) => (e.type === 'gateEvaluated' ? ({ ...e, denial: { source: 'evaluator_verdict', reason: '…\n- the title overflows at 390px' } } as unknown as CoreEvent) : e));
    const m = sessionGateChoices({ runId: RUN, gate: terminal(), units, events: cut, pool: [], roster: null, fullVerdict: FAIL_REASON })!;
    expect(m.detailItems.join('\n')).toMatch(/retry button has no label/);
  });

  it('knows the gate kind from the log when the open gate carries none', () => {
    const bare: Partial<OpenGate> = terminal();
    delete bare.gateKind;
    expect(rowOf(landed, bare as OpenGate).choices[0]!.label).toBe(APPROVE_COMPLETION_LABEL);
  });
});

describe('studio#1143 — what stays as it was', () => {
  const noLand: CoreEvent[] = [
    ...review.slice(0, 2),
    { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 6, prompt: TERMINAL, gateKind: 'terminal' },
  ] as unknown as CoreEvent[];

  it('a terminal gate with no landed review keeps the escalation arms', () => {
    const m = rowOf(noLand);
    expect(m.reason).toBe('escalation');
    expect(all(m).map((c) => c.label)).not.toContain(APPROVE_COMPLETION_LABEL);
    expect(all(m).map((c) => c.label)).toContain(RETRY_NOTE_LABEL);
  });

  it('a review adjudication answered with a send-back (allow:false) is not a landing', () => {
    const sent = [...review, { type: 'gateDecided', session: RUN, ord: ORD, ts: 4, allow: false }, ...noLand.slice(2)] as unknown as CoreEvent[];
    expect(landedReviewAt(sent, ORD)).toBe(false);
    expect(all(rowOf(sent)).map((c) => c.label)).not.toContain(APPROVE_COMPLETION_LABEL);
  });

  it('a later adjudication reopens the question: the landing no longer counts', () => {
    const again = [...landed, { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 7, prompt: ADJ, gateKind: 'review_adjudication' }] as unknown as CoreEvent[];
    expect(landedReviewAt(again, ORD)).toBe(false);
  });

  it('the adjudication gate itself still lands with a note', () => {
    const gate: OpenGate = { runId: RUN, ord: ORD, prompt: ADJ, gateKind: 'review_adjudication', lifecycle: 'open', receivedAt: 3 };
    const m = rowOf(review, gate);
    expect(m.choices.map((c) => c.label)).not.toContain(APPROVE_COMPLETION_LABEL);
  });
});

describe('studio#1143 — the Desk row classifies the same gate the same way', () => {
  const classify = (events: CoreEvent[]) => classifyRowGate({ runId: RUN, gate: terminal(), units, events });

  it('answers the landed terminal in its row: Approve completion first and recommended, then Stop', () => {
    const c = classify(landed);
    expect(c.kind).toBe('answer');
    if (c.kind !== 'answer') return;
    expect(c.choices.map((x) => x.label)).toEqual([APPROVE_COMPLETION_LABEL, 'Stop']);
    expect(c.choices[0]!.decision).toEqual({ approve: true });
    expect(c.recommended).toBe(0);
  });

  it('a terminal gate with no landed review still opens the escalation card', () => {
    const noLand = [...landed.slice(0, 2), landed[landed.length - 1]!];
    expect(classify(noLand)).toEqual({ kind: 'card', reason: 'escalation' });
  });
});

describe('studio#1143 — newer same-ord activity after the land clears it', () => {
  const termFrame = landed[landed.length - 1]!;
  const afterLand = landed.slice(0, -1);
  const evaluated = { type: 'gateEvaluated', session: RUN, ord: ORD, ts: 5, combined: false, denial: { source: 'evaluator_verdict', reason: FAIL_REASON } } as unknown as CoreEvent;
  const escalated = { type: 'gateEscalated', session: RUN, ord: ORD, ts: 5, attempt: 1, condition: 'verdict_not_pass', denialSource: 'evaluator_verdict', verdictSummary: FAIL_REASON } as unknown as CoreEvent;
  const other = { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 5, prompt: 'Approve the step?', gateKind: 'def' } as unknown as CoreEvent;
  const classify = (events: CoreEvent[]) => classifyRowGate({ runId: RUN, gate: terminal(), units, events });

  for (const [name, newer] of [['a new gateEvaluated (FAIL)', evaluated], ['a new gateEscalated', escalated], ['a different non-terminal gate', other]] as const) {
    it(`land → ${name} → terminal: escalation arms, no Approve completion`, () => {
      const events = [...afterLand, newer, termFrame] as CoreEvent[];
      expect(landedReviewAt(events, ORD)).toBe(false);
      const m = rowOf(events);
      expect(m.reason).toBe('escalation');
      expect(all(m).map((c) => c.label)).not.toContain(APPROVE_COMPLETION_LABEL);
      expect(all(m).map((c) => c.label)).toContain(RETRY_NOTE_LABEL);
      expect(classify(events)).toEqual({ kind: 'card', reason: 'escalation' });
    });
  }

  it('the plain land → terminal case still offers Approve completion, recommended, with no retry label', () => {
    expect(landedReviewAt(landed, ORD)).toBe(true);
    const m = rowOf(landed);
    expect(m.choices[0]!.label).toBe(APPROVE_COMPLETION_LABEL);
    expect(m.recommended).toBe(0);
    expect(all(m).some((c) => /retry/i.test(c.label))).toBe(false);
    expect(classify(landed)).toMatchObject({ kind: 'answer', recommended: 0 });
  });
});

describe('studio#1143 — landing at a different ord does not count', () => {
  const OTHER = 4;
  // The adjudication and its allow:true sit at ord 4; the FAIL verdict and the terminal gate stay at ord 5.
  const elsewhere: CoreEvent[] = [
    { type: 'awaitingHuman', session: RUN, ord: OTHER, ts: 1, prompt: ADJ, gateKind: 'review_adjudication' },
    { type: 'gateDecided', session: RUN, ord: OTHER, ts: 2, allow: true },
    { type: 'gateEvaluated', session: RUN, ord: ORD, ts: 3, combined: false, denial: { source: 'evaluator_verdict', reason: FAIL_REASON } },
    { type: 'awaitingHuman', session: RUN, ord: ORD, ts: 4, prompt: TERMINAL, gateKind: 'terminal' },
  ] as unknown as CoreEvent[];

  it('sessionGateChoices: landing at a different ord does not count — the escalation arms stay, no Approve completion', () => {
    expect(landedReviewAt(elsewhere, ORD)).toBe(false);
    const m = rowOf(elsewhere);
    expect(m.reason).toBe('escalation');
    expect(all(m).map((c) => c.label)).not.toContain(APPROVE_COMPLETION_LABEL);
    expect(all(m).map((c) => c.label)).toContain(RETRY_NOTE_LABEL);
  });

  it('classifyRowGate: landing at a different ord does not count — the gate opens the escalation card', () => {
    expect(classifyRowGate({ runId: RUN, gate: terminal(), units, events: elsewhere })).toEqual({ kind: 'card', reason: 'escalation' });
  });
});
