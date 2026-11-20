import { describe, expect, it } from 'vitest';
import * as contract from '../src/board/gateContract.js';
import { describeDecision } from '../src/board/undoQueue.js';
import { gateOption, noteOption } from '../src/board/askModel.js';

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
