/**
 * wicked-core judge fallback (operator ruling 2026-10-14): a gate judged by a FALLBACK seat carries the engine's
 * line on its receipt (`assurance.judgeFallbacks[].label`). The verdict card (Peek, the gate row) shows that line
 * in place of a plain "judge: <seat>", and the delivery who-line keeps every other judge's plain words.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { fallbackLabelOf, gateVerdict } from '../src/components/gateVerdictModel.js';
import { receiptOf, receiptWords } from '../src/board/assuranceModel.js';

const label = "judge: agy (fallback; codex benched: codex cannot work in this run's worktree on this host)";

function evaluated(assurance: Record<string, unknown>): CoreEvent {
  return {
    type: 'gateEvaluated', session: 'r1', ord: 3, criterion: 'the fix is right', hasDeterministicFloor: true,
    deterministicPass: true, agentVerdict: 'pass', agentReasoning: 'PASS', evaluatorPass: null,
    evaluatorPolicies: [], denialReason: null, denial: null, combined: true, judgeCli: 'agy', judgeDistinct: true,
    assurance: {
      mode: 'full', required: ['judge'], ran: ['judge'], skipped: [], creator: 'claude', evaluator: null,
      judge: 'agy', tree: null, attempt: 0, ...assurance,
    },
  } as unknown as CoreEvent;
}

afterEach(cleanup);

describe('the verdict card names a fallback judge by the engine line', () => {
  it('reads the label off the receipt, null-safely', () => {
    expect(fallbackLabelOf({ judgeFallbacks: [{ seat: 'agy', preferred: ['codex'], reason: 'x', label }] })).toBe(label);
    expect(fallbackLabelOf({ judgeFallbacks: [{ label: ' ' }, null] })).toBeNull();
    expect(fallbackLabelOf(null)).toBeNull();
    expect(fallbackLabelOf({})).toBeNull();
  });

  it('shows the line in place of "judge: agy", and the plain seat for the run\'s own judge', () => {
    const fb = gateVerdict([evaluated({ judgeFallbacks: [{ seat: 'agy', preferred: ['codex'], reason: 'x', label }] })], 3)!;
    expect(fb.judgeFallback).toBe(label);
    render(<GateVerdict view={fb} phase="fix" />);
    const seat = screen.getByTestId('gate-verdict-judge-seat');
    expect(seat.textContent).toContain(label);
    expect(seat.getAttribute('data-judge-fallback')).toBe('true');
    cleanup();
    const own = gateVerdict([evaluated({})], 3)!;
    expect(own.judgeFallback).toBeNull();
    render(<GateVerdict view={own} phase="fix" />);
    expect(screen.getByTestId('gate-verdict-judge-seat').textContent).toContain('judge: agy');
  });
});

describe('the delivery who-line keeps every other judge', () => {
  it('a run judged by pi on one gate and by fallback agy on another names both', () => {
    const r = receiptOf({
      mode: 'full', required: ['judge'], ran: ['judge'], skipped: [], creator: 'claude', evaluator: null,
      judge: 'pi, agy', tree: null, attempt: 0, judgeFallbacks: [{ seat: 'agy', preferred: ['codex'], reason: 'x', label }],
    })!;
    const who = receiptWords(r).who!;
    expect(who).toContain('judged by pi');
    expect(who).not.toContain('judged by pi, agy');
    expect(who).toContain(label);
  });
});
