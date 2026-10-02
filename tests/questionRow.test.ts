// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { recommendedOf, type OpenGate } from '../src/store/gates.js';
import {
  INITIAL_PICK, chosenLine, classifyRowGate, pickKey, type RowPick,
} from '../src/board/questionRow.js';

/**
 * Answer a question in its Desk row (DES-STUDIO-REBUILD-001 §11 S5). Pure: which gates a row may
 * answer, its 2-4 choices, the keyboard model of §5.6 (rules 2 and 3), and the folded line.
 * Deliver, retry and escalation gates are NEVER answered in a row: they open their card.
 */

function gate(over: Partial<OpenGate> = {}): OpenGate {
  return { runId: 'r1', ord: 2, prompt: 'Review the change before it continues', lifecycle: 'open', receivedAt: 1, ...over };
}
function unit(ord: number, key: string, stage = 'build'): WorkUnit {
  return { id: `r1:${key}`, session_id: 'r1', ord, description: key, stage, status: 'pending' } as unknown as WorkUnit;
}
const UNITS = [unit(0, 'build'), unit(1, 'test'), unit(2, 'review', 'review'), unit(3, 'deliver')];

describe('classifyRowGate', () => {
  it('a plain approve/reject gate is answered in the row, with two choices', () => {
    const c = classifyRowGate({ runId: 'r1', gate: gate(), units: UNITS, events: [] });
    expect(c.kind).toBe('answer');
    if (c.kind !== 'answer') return;
    expect(c.choices.map((x) => [x.key, x.label, x.decision])).toEqual([
      ['approve', 'Approve', { approve: true }],
      ['reject', 'Reject', { approve: false }],
    ]);
    expect(c.recommended).toBeNull();
  });

  it('a plan approval gate is answered in the row ("Approve the plan" / "Not this plan")', () => {
    const c = classifyRowGate({ runId: 'r1', gate: gate({ gateKind: 'plan_approval' }), units: UNITS, events: [] });
    expect(c.kind === 'answer' && c.choices.map((x) => x.label)).toEqual(['Approve the plan', 'Not this plan']);
  });

  it('a deliver gate opens its card — by kind, or by the unit the gate is on', () => {
    expect(classifyRowGate({ runId: 'r1', gate: gate({ gateKind: 'deliver' }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'deliver' });
    expect(classifyRowGate({ runId: 'r1', gate: gate({ ord: 3 }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'deliver' });
  });

  it('an escalation gate opens its card (the triage spelling, or an evaluator NOT PASS on record)', () => {
    expect(classifyRowGate({ runId: 'r1', gate: gate({ prompt: 'Unit 2 failed and triage escalated: …' }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'escalation' });
    // The engine's own gate kind, even with no event log read and a payload naming no answers.
    expect(classifyRowGate({ runId: 'r1', gate: gate({ gateKind: 'escalation', choices: null }), units: UNITS, events: null }))
      .toEqual({ kind: 'card', reason: 'escalation' });
    const notPass = [{ type: 'gateEvaluated', session: 'r1', ord: 2, outcome: 'fail', denial: { source: 'evaluator_verdict', reason: 'VERDICT: FAIL' } }] as unknown as CoreEvent[];
    expect(classifyRowGate({ runId: 'r1', gate: gate(), units: UNITS, events: notPass }))
      .toEqual({ kind: 'card', reason: 'escalation' });
  });

  it('a retry gate (a refused launch) opens its card', () => {
    expect(classifyRowGate({ runId: 'r1', gate: gate({ prompt: 'Unit 2 (review) refused its environment: …' }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'retry' });
  });

  it('team pauses, free text and unknown gates open their card; no events yet is "checking"', () => {
    expect(classifyRowGate({ runId: 'r1', gate: gate({ gateKind: 'team_dispute' }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'team' });
    expect(classifyRowGate({ runId: 'r1', gate: gate({ choices: null }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'free-text' });
    expect(classifyRowGate({ runId: 'r1', gate: gate({ choices: ['a', 'b', 'c'] }), units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'choices' });
    expect(classifyRowGate({ runId: 'r1', gate: undefined, units: UNITS, events: [] }))
      .toEqual({ kind: 'card', reason: 'unknown' });
    expect(classifyRowGate({ runId: 'r1', gate: gate(), units: UNITS, events: null })).toEqual({ kind: 'checking' });
  });

  it('C3: a recommendation is carried only when the producer named one in range', () => {
    const c = classifyRowGate({ runId: 'r1', gate: gate({ recommended: 0 }), units: UNITS, events: [] });
    expect(c.kind === 'answer' && c.recommended).toBe(0);
    const out = classifyRowGate({ runId: 'r1', gate: gate({ recommended: 7 }), units: UNITS, events: [] });
    expect(out.kind === 'answer' && out.recommended).toBeNull();
    expect(recommendedOf({ recommended: 1 })).toBe(1);
    expect(recommendedOf({ recommended: -1 })).toBeUndefined();
    expect(recommendedOf({ recommended: '1' })).toBeUndefined();
    expect(recommendedOf({})).toBeUndefined();
  });
});

describe('the row keyboard (§5.6 rules 2 and 3)', () => {
  const n = 2;
  it('C3 absent: nothing preselected; Enter is inert until the operator moves', () => {
    let s: RowPick = INITIAL_PICK(null);
    expect(s.focus).toBeNull();
    let r = pickKey(s, 'Enter', n);
    expect(r.send).toBeNull();
    r = pickKey(s, 'ArrowDown', n);
    s = r.state;
    expect(s).toEqual({ focus: 0, moved: true });
    expect(pickKey(s, 'Enter', n).send).toBe(0);
  });
  it('C3 present: preselected visually only — Enter still inert until a move', () => {
    const s = INITIAL_PICK(0);
    expect(s).toEqual({ focus: 0, moved: false });
    expect(pickKey(s, 'Enter', n).send).toBeNull();
    const moved = pickKey(s, 'ArrowDown', n).state;
    expect(moved).toEqual({ focus: 1, moved: true });
    expect(pickKey(moved, 'Enter', n).send).toBe(1);
  });
  it('digits pick (and send) inside the control; out-of-range digits do nothing; arrows wrap', () => {
    expect(pickKey(INITIAL_PICK(null), '2', n).send).toBe(1);
    expect(pickKey(INITIAL_PICK(null), '3', n).send).toBeNull();
    expect(pickKey({ focus: 1, moved: true }, 'ArrowDown', n).state.focus).toBe(0);
    expect(pickKey({ focus: 0, moved: true }, 'ArrowUp', n).state.focus).toBe(1);
    expect(pickKey({ focus: 0, moved: true }, 'Home', n).state.focus).toBe(0);
    expect(pickKey({ focus: 0, moved: true }, 'End', n).state.focus).toBe(1);
  });
  it('Escape never answers (rule 5) and a letter is not the row\'s', () => {
    expect(pickKey({ focus: 0, moved: true }, 'Escape', n)).toEqual({ state: { focus: 0, moved: true }, send: null, handled: false });
    expect(pickKey({ focus: 0, moved: true }, 'a', n).handled).toBe(false);
  });
});

describe('the folded row', () => {
  it('"You chose Approve · Undo 9 s", then "You chose Approve · sending"', () => {
    expect(chosenLine('Approve', 9)).toBe('You chose Approve · Undo 9 s');
    expect(chosenLine('Approve', 0)).toBe('You chose Approve · sending');
  });
});
