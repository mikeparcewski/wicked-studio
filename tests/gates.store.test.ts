import { describe, it, expect, beforeEach } from 'vitest';
import { choicesOf, isSimpleGate, useGateStore, type OpenGate } from '../src/store/gates.js';
import type { CoreEvent } from '../src/api/types.js';

const gate = (over: Partial<OpenGate> = {}): OpenGate =>
  ({ runId: 'run-1', ord: 0, prompt: '?', lifecycle: 'open', receivedAt: 0, ...over });

describe('simple vs. complex gates (§7.11 — ≤2 choices and no free text)', () => {
  it('the plain workflow gate is simple — its two answers are approve and reject', () => {
    expect(isSimpleGate(gate())).toBe(true);
  });

  it('an uncached gate is simple: the prompt was lost, not the two answers', () => {
    expect(isSimpleGate(undefined)).toBe(true);
  });

  it.each([
    ['two named choices', ['approve', 'send back'], true],
    ['three named choices', ['ship', 'rework', 'split'], false],
    ['free text (null options)', null, false],
  ])('%s → simple=%s', (_label, choices, simple) => {
    expect(isSimpleGate(gate({ choices: choices as string[] | null }))).toBe(simple);
  });

  it('reads either spelling off the payload, and nothing off the prompt text', () => {
    expect(choicesOf({ choices: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(choicesOf({ options: ['a', 'b', 'c'] })).toEqual(['a', 'b', 'c']);
    expect(choicesOf({ options: null })).toBeNull();
    expect(choicesOf({ freeText: true })).toBeNull();
    // A prompt that merely LISTS things is not a payload that offers choices.
    expect(choicesOf({ prompt: 'Pick one: a, b or c' })).toBeUndefined();
  });
});

const reset = (): void => useGateStore.setState({ gates: {}, approaching: {} });

describe('gate cache (§3.3 — event-sourced, self-healing, keyed by run id)', () => {
  beforeEach(reset);

  it('opens a gate from an awaitingHuman frame', () => {
    useGateStore.getState().ingest({
      type: 'awaitingHuman',
      session: 'run-1',
      ord: 2,
      prompt: 'Proceed?',
    } as CoreEvent);
    const gate = useGateStore.getState().gates['run-1'];
    expect(gate).toMatchObject({ runId: 'run-1', ord: 2, prompt: 'Proceed?', lifecycle: 'open' });
  });

  it('ignores an awaitingHuman frame missing the prompt or ord', () => {
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-1' } as CoreEvent);
    expect(useGateStore.getState().gates['run-1']).toBeUndefined();
  });

  it.each(['resumed', 'sessionCompleted', 'runCancelled', 'sessionFailed'])(
    'prunes the gate on a %s frame',
    (type) => {
      useGateStore.setState({
        gates: { 'run-1': { runId: 'run-1', ord: 1, prompt: 'x', lifecycle: 'open', receivedAt: 0 } },
      });
      useGateStore.getState().ingest({ type, session: 'run-1' } as CoreEvent);
      expect(useGateStore.getState().gates['run-1']).toBeUndefined();
    },
  );

  it('ignores frames with no run scope (e.g. heartbeat)', () => {
    useGateStore.getState().ingest({ type: 'heartbeat' } as CoreEvent);
    expect(Object.keys(useGateStore.getState().gates)).toHaveLength(0);
  });

  it('captures the answer shape a payload names (§7.11)', () => {
    useGateStore.getState().ingest({
      type: 'awaitingHuman', session: 'run-1', ord: 0, prompt: 'Which plan?',
      choices: ['ship', 'rework', 'split'],
    } as CoreEvent);
    expect(useGateStore.getState().gates['run-1']?.choices).toEqual(['ship', 'rework', 'split']);
  });

  it('leaves `choices` absent for the plain workflow gate the daemon sends today', () => {
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-1', ord: 0, prompt: 'Proceed?' } as CoreEvent);
    expect(useGateStore.getState().gates['run-1']).not.toHaveProperty('choices');
  });

  it('gateEscalated opens the APPROACHING preview — the wire spells the field `condition` (slice BA)', () => {
    useGateStore.getState().ingest({
      type: 'gateEscalated', session: 'run-1', ord: 2,
      condition: 'All acceptance criteria demonstrably verified',
    } as CoreEvent);
    expect(useGateStore.getState().approaching['run-1']).toMatchObject({
      runId: 'run-1', ord: 2, condition: 'All acceptance criteria demonstrably verified',
    });
    // The gate itself has NOT posted — the preview is not an open gate.
    expect(useGateStore.getState().gates['run-1']).toBeUndefined();
  });

  it('a gateEscalated missing ord or condition is dropped, never a half-record', () => {
    useGateStore.getState().ingest({ type: 'gateEscalated', session: 'run-1', ord: 2 } as CoreEvent);
    useGateStore.getState().ingest({ type: 'gateEscalated', session: 'run-1', condition: 'x' } as CoreEvent);
    expect(useGateStore.getState().approaching['run-1']).toBeUndefined();
  });

  it('awaitingHuman retires the preview AND opens the gate — the §1.3 posture switch', () => {
    useGateStore.getState().ingest({
      type: 'gateEscalated', session: 'run-1', ord: 2, condition: 'criterion',
    } as CoreEvent);
    useGateStore.getState().ingest({
      type: 'awaitingHuman', session: 'run-1', ord: 2, prompt: 'Proceed?',
    } as CoreEvent);
    expect(useGateStore.getState().approaching['run-1']).toBeUndefined();
    expect(useGateStore.getState().gates['run-1']).toMatchObject({ runId: 'run-1', ord: 2 });
  });

  it.each(['gateDecided', 'resumed', 'sessionCompleted', 'runCancelled', 'sessionFailed'])(
    'the preview retires on a %s frame — a superseded signal never lingers',
    (type) => {
      useGateStore.getState().ingest({
        type: 'gateEscalated', session: 'run-1', ord: 0, condition: 'criterion',
      } as CoreEvent);
      useGateStore.getState().ingest({ type, session: 'run-1' } as CoreEvent);
      expect(useGateStore.getState().approaching['run-1']).toBeUndefined();
    },
  );

  it('an unrelated run-scoped frame leaves the store untouched (same state identity)', () => {
    useGateStore.getState().ingest({
      type: 'gateEscalated', session: 'run-1', ord: 0, condition: 'criterion',
    } as CoreEvent);
    const before = useGateStore.getState();
    useGateStore.getState().ingest({ type: 'unitDispatched', session: 'run-1', ord: 1 } as CoreEvent);
    expect(useGateStore.getState()).toBe(before);
  });

  it('reconcile keeps only still-awaiting runs (self-healing)', () => {
    useGateStore.setState({
      gates: {
        'run-1': { runId: 'run-1', ord: 1, prompt: 'a', lifecycle: 'open', receivedAt: 0 },
        'run-2': { runId: 'run-2', ord: 1, prompt: 'b', lifecycle: 'open', receivedAt: 0 },
      },
    });
    useGateStore.getState().reconcile(['run-1']); // run-2 no longer awaiting
    expect(useGateStore.getState().gates['run-1']).toBeDefined();
    expect(useGateStore.getState().gates['run-2']).toBeUndefined();
  });
});
