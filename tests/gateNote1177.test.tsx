import { describe, expect, it } from 'vitest';
import * as contract from '../src/board/gateContract.js';
import { describeDecision } from '../src/board/undoQueue.js';
import { gateOption, noteOption } from '../src/board/askModel.js';
import { listedOnlyChoices, sessionGateChoices, type GateRowChoice } from '../src/board/gateRowModel.js';
import { replyChoiceOf } from '../src/components/session/GateRow.js';
import type { OpenGate } from '../src/store/gates.js';

describe('studio#1177: one note composer policy', () => {
  it.each([
    ['none', { box: false, optional: false }],
    ['optional', { box: true, optional: true }],
    ['required', { box: true, optional: false }],
  ] as const)('%s maps to its composer behavior', (note, expected) => {
    expect(contract.noteAsk(note)).toEqual(expected);
  });
  it.each([
    ['none', {}],
    ['optional', { needsReason: true, reasonOptional: true }],
    ['required', { needsReason: true }],
  ] as const)('%s maps to its ask option fields', (note, expected) => {
    expect(noteOption(note)).toEqual(expected);
  });
  it('a listed reject does not ask a reason', () => {
    const [choice] = contract.choicesForAction({ action: 'reject', intent: 'cancel', note: 'none' }, String);
    expect(gateOption(choice!, {}).needsReason).toBeUndefined();
  });
  it('an empty send-back omits amend', () => {
    expect(contract.listedGateAnswer('request_changes', '', 1)).toEqual({ approve: false, action: 'request_changes', ord: 1 });
  });
  it('a send-back with no words is not previewed as carrying a note', () => {
    expect(describeDecision({ approve: false, action: 'request_changes' } as never).preview).toBe('The run rewinds to its last creator phase and redoes it.');
    expect(describeDecision({ approve: false, action: 'request_changes', amend: 'fix it' } as never).preview).toBe('The run rewinds to its last creator phase and redoes it with your note.');
  });
});

describe('studio#1177: review folds', () => {
  const gate = (over: Partial<OpenGate> = {}): OpenGate => ({ runId: 'r', ord: 1, prompt: 'Your answer?', lifecycle: 'open', receivedAt: 1, ...over });
  const choice = (key: string, note: GateRowChoice['note']): GateRowChoice => ({ key, label: key, decision: { approve: false, action: 'request_changes' } as never, note, title: '' });

  it('a kept free-text control takes the listed note (optional), not its template note', () => {
    const m = sessionGateChoices({ runId: 'r', gate: gate({ choices: null }), units: [], events: [], pool: [], roster: null, rerun: null, fullVerdict: null,
      actions: [{ action: 'approve', intent: 'continue', note: 'optional' }] });
    expect(m?.reason).toBe('free-text');
    expect(m?.choices.map((c) => [c.key, c.note])).toEqual([['free-text-send', 'optional']]);
  });

  it('the dock reply box never answers through a choice the engine takes without words', () => {
    expect(replyChoiceOf([choice('send-back', 'none'), choice('steer', 'required')])?.key).toBe('steer');
    expect(replyChoiceOf([choice('send-back', 'none')])).toBeNull();
    expect(replyChoiceOf([choice('send-back', 'optional')])?.key).toBe('send-back');
  });

  it('a failed events read draws the list alone: nothing recommended, nothing marked default', () => {
    const m = listedOnlyChoices(gate({ gateKind: 'consent', recommended: 0 }), [
      { action: 'approve', intent: 'continue', note: 'none' },
      { action: 'consent:full', intent: 'consent_choice', note: 'none' },
      { action: 'reject', intent: 'stop', note: 'none' },
    ], null);
    expect(m.recommended).toBeNull();
    expect([...m.choices, ...m.overflow].map((c) => c.key)).toEqual(['approve', 'choice:consent:full', 'stop']);
    expect([...m.choices, ...m.overflow].some((c) => c.isDefault === true || c.writes !== undefined)).toBe(false);
  });
});
