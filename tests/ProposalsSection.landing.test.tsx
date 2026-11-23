import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * studio#1337: crew answers a policy approve 200 even when the rule did not land (`landing.outcome: "failed"`, the
 * proposal still pending). The card must never say "Approved" then: it says the rule did not land and why (crew's
 * `landing.error`), keeps the proposal, and offers what crew names: Reject, or approve it for every project
 * (`reach: "operator"`).
 *
 * The failed answer is crew's own shape: `landFailed` in crew packages/crew/src/api/routes.ts (the `POST
 * /proposals/:id/approve` route, ~:10836-10850), with the error the train-12 cert recorded on a proof daemon.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

const { ProposalsSection } = await import('../src/components/ProposalsSection.js');
const { landingFailure } = await import('../src/api/proposals.js');
type Proposal = import('../src/api/proposals.js').Proposal;

const RULE = 'Any change to sum in src/math.js must keep test/math.test.js passing';
const POL: Proposal = {
  id: '01a1de4c-0989-7d21-9bba-590ee23f11c5',
  kind_type: 'policy:conformance',
  payload: { reach: 'project', rule: RULE, severity: 'error' },
  facets: { project: 'tiny-math', repo: 'tiny-math-cert' },
  provenance: { run_id: 'run-capture', run_agent: 'claude' },
  state: 'pending',
  created_at: 1_700_000_000,
};
const ERROR = 'the policy proposal\'s reach is one project (repo `tiny-math-cert`), but it names no known project (its project facet is "tiny-math") and the run that filed it is in no project; steering rules are scoped by project, so it would land as a rule for every project — reject it, or accept it with reach "operator" if it is meant for every project (the proposal is still pending)';
const FAILED = { outcome: 'handed_off', payload: POL.payload, landing: { outcome: 'failed', error: ERROR } };
const LANDED = { outcome: 'handed_off', payload: POL.payload, landing: { outcome: 'landed', ruleId: 'proposal:01a1de4c', reach: 'operator', steering_type: 'conformance' } };

/** crew's wire: a failed landing leaves the proposal pending; an operator-reach approve lands it and approves it. */
function wire(): Array<{ path: string; body: unknown }> {
  let pending = [POL];
  const calls: Array<{ path: string; body: unknown }> = [];
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const s = String(path);
    const body = init?.body !== undefined ? JSON.parse(init.body) as unknown : undefined;
    calls.push({ path: s, body });
    if (s.endsWith('/approve')) {
      if ((body as { reach?: string } | undefined)?.reach === 'operator') { pending = []; return Promise.resolve(LANDED); }
      return Promise.resolve(FAILED);
    }
    if (s.endsWith('/reject')) { pending = []; return Promise.resolve({ ok: true }); }
    return Promise.resolve({ proposals: pending });
  });
  return calls;
}

beforeEach(() => { apiFetch.mockReset(); });

describe('landingFailure', () => {
  it('reads crew\'s failed landing, and nothing else', () => {
    expect(landingFailure(FAILED)).toBe(ERROR);
    expect(landingFailure(LANDED)).toBeNull();
    expect(landingFailure({ outcome: 'promoted', active_id: 'm-1' })).toBeNull();
    expect(landingFailure({ outcome: 'handed_off', payload: {} })).toBeNull();
    expect(landingFailure({ outcome: 'handed_off', payload: {}, landing: { outcome: 'failed' } })).toBe('crew could not land the rule');
  });
});

describe('Steering > Proposed: a policy whose rule did not land (studio#1337)', () => {
  it('never says Approved; the card stays, says why and offers Reject or Approve for every project', async () => {
    const calls = wire();
    const onDecision = vi.fn();
    render(<ProposalsSection kind="policy" heading="Rule proposals" onDecision={onDecision} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('proposal-approve'));

    const why = await screen.findByTestId('proposal-not-landed');
    expect(why).toHaveTextContent('the rule did not land, so no rule was added');
    expect(why).toHaveTextContent('it names no known project');
    expect(screen.getByTestId('proposals-section-note')).toHaveTextContent(/^Not approved, its rule did not land: Any change/);
    expect(screen.getByTestId('proposals-section-note')).not.toHaveTextContent(/^Approved/);
    // The proposal is still pending: its card stays, with crew's two ways forward.
    const card = screen.getByTestId('proposal-card');
    expect(within(card).getByTestId('proposal-reject')).toBeEnabled();
    expect(within(card).queryByTestId('proposal-approve')).toBeNull();
    expect(onDecision).not.toHaveBeenCalled();

    await user.click(within(card).getByTestId('proposal-approve-everywhere'));
    await waitFor(() => expect(screen.getByTestId('proposals-section-note')).toHaveTextContent(`Approved: ${RULE.slice(0, 20)}`));
    expect(calls.filter((c) => c.path.endsWith('/approve')).map((c) => c.body)).toEqual([undefined, { reach: 'operator' }]);
    expect(onDecision).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('proposal-card')).toBeNull());
  });

  it('Reject still rejects a proposal whose rule did not land', async () => {
    const calls = wire();
    render(<ProposalsSection kind="policy" heading="Rule proposals" />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('proposal-approve'));
    await screen.findByTestId('proposal-not-landed');
    await user.click(screen.getByTestId('proposal-reject'));
    await waitFor(() => expect(screen.getByTestId('proposals-section-note')).toHaveTextContent(/^Rejected: /));
    expect(calls.some((c) => c.path.endsWith('/reject'))).toBe(true);
  });
});
