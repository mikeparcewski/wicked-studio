import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { IntakePlan } from '../src/components/IntakePlan.js';
import { makeUnit } from './factories.js';

/** studio#429: the run-level gate's card must not call a launch's lone neutral unit "the plan". */
describe('IntakePlan — a lone unplanned step is said as one', () => {
  it('the daemon says the launch was free text, and its one unit is neutral: "One unplanned step"', () => {
    render(<IntakePlan runId="r1" identityKind="free_text" units={[makeUnit({ id: 'r1:u1', session_id: 'r1', ord: 1, stage: 'test', role: 'neutral' } as never)]} clis={['claude']} />);
    expect(screen.getByTestId('intake-plan-head')).toHaveTextContent('One unplanned step — no PA scope, no review, no delivery');
  });
  it('codex on #429: a missing workflow def is not provenance — without the daemon\'s word, nothing is claimed', () => {
    render(<IntakePlan runId="r3" units={[makeUnit({ id: 'r3:u1', session_id: 'r3', ord: 1, stage: 'test', role: 'neutral' } as never)]} clis={['claude']} />);
    expect(screen.getByTestId('intake-plan-head')).toHaveTextContent('The plan you are approving — 1 phase');
  });
  it('a planned run keeps "The plan you are approving — N phases"', () => {
    render(<IntakePlan runId="r2" units={[
      makeUnit({ id: 'r2:build', session_id: 'r2', ord: 1, stage: 'build', role: 'creator' } as never),
      makeUnit({ id: 'r2:review', session_id: 'r2', ord: 2, stage: 'review', role: 'evaluator' } as never),
    ]} clis={['claude']} />);
    expect(screen.getByTestId('intake-plan-head')).toHaveTextContent('The plan you are approving — 2 phases');
  });
});
