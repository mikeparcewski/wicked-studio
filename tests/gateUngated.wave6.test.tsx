import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { gateVerdict } from '../src/components/gateVerdictModel.js';
import { VerdictDetail } from '../src/components/VerdictDetail.js';
import { useRunEventStore } from '../src/store/events.js';
import {
  GATE_JUDGED_PASS,
  GATE_UNGATED_NO_FLOOR,
  GATE_UNGATED_WITH_FLOOR,
  W6_EVENTS,
  W6_RUN,
  W6_UNGATED_REASON,
  W6_UNITS,
} from './fixtures/wave6.js';

/**
 * The gate card and the run-page verdict card on the wave-6 wire (api-types 0.36.0
 * `gateEvaluated.ungated` / `ungatedReason` — F-7R2-005, F-7R2-017 studio half): the engine's own
 * word that no judge seat could be convened wins over the "no floor, no judge, no policy" fold, the
 * card reads "UNGATED — no eligible judge seat" (never PASS), the floor that DID run is still listed,
 * and a pre-0.36 frame keeps today's fold.
 */

const ev = (e: unknown): CoreEvent => e as CoreEvent;

afterEach(() => cleanup());

describe('gateVerdict — the fold', () => {
  it('`ungated: true` ⇒ outcome ungated even when a floor ran and the evaluator layer defaulted to allow', () => {
    const v = gateVerdict([ev(GATE_UNGATED_WITH_FLOOR)], 2)!;
    expect(v.outcome).toBe('ungated');
    expect(v.ungated).toBe(true);
    expect(v.ungatedReason).toBe(W6_UNGATED_REASON);
    expect(v.hasDeterministicFloor).toBe(true);
    expect(v.deterministicPass).toBe(true);
  });

  it('a judged pass on the same wire is a pass — `ungated: false`, reason null', () => {
    const v = gateVerdict([ev(GATE_JUDGED_PASS)], 4)!;
    expect(v.outcome).toBe('pass');
    expect(v.ungated).toBe(false);
    expect(v.ungatedReason).toBeNull();
    expect(v.judgeCli).toBe('codex');
  });

  it('a pre-0.36 frame reads `ungated: false` and the fold decides (no floor, no judge, no policy ⇒ ungated by the fold)', () => {
    const { ungated: _u, ungatedReason: _r, ...older } = GATE_UNGATED_NO_FLOOR;
    void _u; void _r;
    const v = gateVerdict([ev(older)], 4)!;
    expect(v.outcome).toBe('ungated');
    expect(v.ungated).toBe(false);
    expect(v.ungatedReason).toBeNull();
  });

  it('a denial stays a denial when the frame also says ungated', () => {
    const v = gateVerdict([ev({ ...GATE_UNGATED_WITH_FLOOR, combined: false, denialReason: 'typecheck exit 2' })], 2)!;
    expect(v.outcome).toBe('fail');
  });
});

describe('GateVerdict — the card', () => {
  it('reads "Evaluator verdict — author · UNGATED" and the engine\'s reason; the floor that ran is still listed; the judge axis is said not held', () => {
    const v = gateVerdict([...W6_EVENTS], 2)!;
    render(<GateVerdict view={v} phase="author" />);
    const card = screen.getByTestId('gate-verdict');
    expect(card).toHaveAttribute('data-verdict', 'ungated');
    expect(card).toHaveTextContent('Evaluator verdict — author · UNGATED');
    expect(card).not.toHaveTextContent('· PASS');
    const line = screen.getByTestId('gate-verdict-ungated');
    expect(line).toHaveAttribute('data-ungated-reason', W6_UNGATED_REASON);
    expect(line).toHaveTextContent(`UNGATED — ${W6_UNGATED_REASON}`);
    expect(line).toHaveTextContent('the repository checks above ran; no distinct judge reviewed the work');
    // The F-039 floor that DID run is listed — honesty in both directions.
    expect(screen.getByTestId('gate-verdict-floor')).toHaveAttribute('data-floor', 'pass');
    expect(screen.getByTestId('gate-verdict-check')).toHaveAttribute('data-check', 'typecheck');
    expect(screen.getByTestId('gate-verdict-layers')).toHaveTextContent('deterministic floor: pass · evaluator: default-allow (no policy applied)');
  });

  it('no floor and no judge: "no repository checks ran and no judge reviewed the work — approved by default, not verified"', () => {
    const v = gateVerdict([ev(GATE_UNGATED_NO_FLOOR)], 4)!;
    render(<GateVerdict view={v} phase="review" />);
    const line = screen.getByTestId('gate-verdict-ungated');
    expect(line).toHaveTextContent(`UNGATED — ${W6_UNGATED_REASON} · no repository checks ran and no judge reviewed the work — approved by default, not verified`);
    expect(screen.queryByTestId('gate-verdict-floor')).toBeNull();
  });

  it('a pre-0.36 ungated fold keeps today\'s sentence and carries no reason attribute', () => {
    const { ungated: _u, ungatedReason: _r, ...older } = GATE_UNGATED_NO_FLOOR;
    void _u; void _r;
    render(<GateVerdict view={gateVerdict([ev(older)], 4)!} phase="review" />);
    const line = screen.getByTestId('gate-verdict-ungated');
    expect(line).toHaveTextContent('nothing gated this phase — it was approved by default, not verified');
    expect(line).not.toHaveAttribute('data-ungated-reason');
    expect(line).not.toHaveTextContent('UNGATED —');
  });
});

describe('VerdictDetail — the run page\'s verdict card', () => {
  it('states UNGATED with the engine\'s reason under the layers line', () => {
    useRunEventStore.setState({ byRun: {} });
    useRunEventStore.getState().hydrate(W6_RUN, [...W6_EVENTS]);
    render(<VerdictDetail runId={W6_RUN} units={W6_UNITS} />);
    const line = screen.getByTestId('verdict-ungated');
    expect(line).toHaveAttribute('data-ungated-reason', W6_UNGATED_REASON);
    expect(line).toHaveTextContent(`UNGATED — ${W6_UNGATED_REASON}; evaluator ≠ creator was not held on this verdict`);
  });

  it('a judged pass renders no UNGATED line', () => {
    useRunEventStore.setState({ byRun: {} });
    useRunEventStore.getState().hydrate(W6_RUN, [ev(GATE_JUDGED_PASS)]);
    render(<VerdictDetail runId={W6_RUN} units={W6_UNITS} />);
    expect(screen.queryByTestId('verdict-ungated')).toBeNull();
  });
});
