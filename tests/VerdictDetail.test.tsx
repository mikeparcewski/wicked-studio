// Slice R (DES-UX-001 §1.3-2 / §1.5): the evaluator verdict card.
//
// A failed run's page used to answer "why did this fail" with a one-line
// rejection while the evaluator's record sat unrendered in the already-fetched
// event log. These tests pin the card's three contracts:
//
//   1. it states the DECIDING phase's record: criterion, agentVerdict +
//      agentReasoning, denialReason (`data-phase-ord` names the phase);
//   2. FINDING-025: empty `evaluatorPolicies` beside `evaluatorPass: true` is a
//      vacuous default-allow — labeled `data-vacuous="true"`, never an implied
//      enforced approval;
//   3. the retention empty state (steering-added): a log with NO `gateEvaluated`
//      entries renders `data-empty="true"` with the EXACT copy "no evaluator
//      record survives for this run" — never a blank card, never a fabricated
//      verdict.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictDetail } from '../src/components/VerdictDetail.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeUnit } from './factories.js';

const RUN = 'run-1';

const UNITS = [
  makeUnit({ id: 'run-1:survey', ord: 0, stage: 'recon', status: 'done' }),
  makeUnit({ id: 'run-1:review', ord: 1, stage: 'review', status: 'rejected', denial_reason: 'no reviewable substance' }),
];

/** A real-shape `gateEvaluated` deny (camelCase, per event_to_json). */
const DENY = {
  type: 'gateEvaluated',
  session: RUN,
  ord: 1,
  criterion: 'review artifacts exist and cite the diff',
  hasDeterministicFloor: true,
  deterministicPass: true,
  agentVerdict: 'deny',
  agentReasoning: 'The review phase produced no reviewable substance: no diff hunks were cited.',
  evaluatorPass: true,
  evaluatorPolicies: [] as string[],
  denialReason: 'phase produced no reviewable substance',
  combined: false,
};

describe('VerdictDetail — the evaluator verdict card (slice R)', () => {
  beforeEach(() => {
    useRunEventStore.setState({ byRun: {} });
  });

  it('states the deciding phase: criterion, agentVerdict + reasoning, denialReason', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [DENY] } });
    render(<VerdictDetail runId={RUN} units={UNITS} />);

    const card = screen.getByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-phase-ord', '1');
    expect(card).toHaveTextContent('review'); // the phase name, from the unit key
    expect(screen.getByTestId('verdict-criterion')).toHaveTextContent(
      'review artifacts exist and cite the diff',
    );
    expect(card).toHaveTextContent('The review phase produced no reviewable substance');
    expect(screen.getByTestId('verdict-denial')).toHaveTextContent(
      'denied: phase produced no reviewable substance',
    );
  });

  it('labels empty evaluatorPolicies beside evaluatorPass:true as the vacuous default-allow (FINDING-025)', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [DENY] } });
    render(<VerdictDetail runId={RUN} units={UNITS} />);

    const card = screen.getByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-vacuous', 'true');
    expect(card).toHaveTextContent('default-allow');
  });

  it('an ENFORCED evaluator pass (policies applied) is never labeled vacuous', () => {
    useRunEventStore.setState({
      byRun: { [RUN]: [{ ...DENY, evaluatorPolicies: ['policy-a', 'policy-b'] }] },
    });
    render(<VerdictDetail runId={RUN} units={UNITS} />);

    const card = screen.getByTestId('verdict-detail');
    expect(card).not.toHaveAttribute('data-vacuous');
    expect(card).not.toHaveTextContent('default-allow');
    expect(card).toHaveTextContent('2 policies');
  });

  it('the deciding record is the last DENY, not merely the last evaluation', () => {
    const earlierAllow = {
      ...DENY,
      ord: 0,
      agentVerdict: 'allow',
      agentReasoning: 'looks fine',
      denialReason: null,
      combined: true,
    };
    // Arrival order: deny (ord 1) between two allows — the deny decides.
    useRunEventStore.setState({ byRun: { [RUN]: [earlierAllow, DENY, { ...earlierAllow, ord: 0 }] } });
    render(<VerdictDetail runId={RUN} units={UNITS} />);

    expect(screen.getByTestId('verdict-detail')).toHaveAttribute('data-phase-ord', '1');
    expect(screen.getByTestId('verdict-denial')).toHaveTextContent('phase produced no reviewable substance');
  });

  it('retention empty state: no gateEvaluated in the log → the exact honest copy, never a blank card', () => {
    // A historical run's surviving log: lifecycle only, no evaluator record.
    useRunEventStore.setState({
      byRun: {
        [RUN]: [
          { type: 'sessionStarted', session: RUN },
          { type: 'sessionFailed', session: RUN },
        ],
      },
    });
    render(<VerdictDetail runId={RUN} units={UNITS} />);

    const card = screen.getByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-empty', 'true');
    expect(card).toHaveTextContent('no evaluator record survives for this run');
    // Never fabricated from the one-line status:
    expect(card).not.toHaveTextContent('denied:');
    expect(card).not.toHaveAttribute('data-phase-ord');
  });

  it('an entirely absent log renders the same empty dress (never blank)', () => {
    render(<VerdictDetail runId={RUN} units={UNITS} />);
    const card = screen.getByTestId('verdict-detail');
    expect(card).toHaveAttribute('data-empty', 'true');
    expect(card.textContent).not.toBe('');
  });
});
