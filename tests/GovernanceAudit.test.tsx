import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { mergeRunModel } from '../src/hooks/useRunModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { makeView, makeUnit } from './factories.js';

// The J1 self-contradiction pin: on a run whose halt banner + Decisions panel
// carry a governance deny, the Governance panel must never read "No governance
// claims recorded for this run" — the two surfaces read DIFFERENT wires (the
// conformance claims store vs the run's own snapshot + event tail), and the
// panel has to state that split instead of contradicting the page.

const listClaims = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, prop) => {
      if (String(prop) === 'listClaims') return listClaims;
      return vi.fn().mockResolvedValue({});
    },
  }),
}));

import { GovernanceAudit, runRecordDecisions } from '../src/components/GovernanceAudit.js';

const DENIAL =
  'Governance DENIED unit 1 (review): the refactored middleware drops the token-refresh path';

/** A run shaped like the reproduced 61fcef-class page: gate deny in the tail,
 *  denial_reason on the unit, nothing on the claims wire. */
function deniedModel() {
  const snap = makeView({ id: 'r-auth', status: 'failed' }, [
    makeUnit({ ord: 0, status: 'done' }),
    makeUnit({ id: 'r-auth:u1', ord: 1, status: 'rejected', denial_reason: DENIAL }),
  ]);
  const events: CoreEvent[] = [{
    type: 'gateEvaluated', session: 'r-auth', ord: 1,
    criterion: 'the middleware refactor keeps every existing auth test green',
    hasDeterministicFloor: true, deterministicPass: true,
    agentVerdict: 'fail', agentReasoning: 'drops the token-refresh path',
    evaluatorPass: true, evaluatorPolicies: [],
    denialReason: DENIAL, combined: false,
  } as unknown as CoreEvent];
  return mergeRunModel(snap, events);
}

beforeEach(() => {
  listClaims.mockReset();
});

describe('runRecordDecisions — the run-record derivation', () => {
  it('collects gate denies and does not double-count the unit denial_reason that matches', () => {
    const decisions = runRecordDecisions(deniedModel());
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ ord: 1, source: 'gate', detail: DENIAL });
  });

  it('collects a snapshot denial_reason when no gate event survived', () => {
    const model = mergeRunModel(
      makeView({ id: 'r-x' }, [makeUnit({ ord: 2, denial_reason: 'denied: no evidence' })]),
      [],
    );
    expect(runRecordDecisions(model)).toEqual([
      { ord: 2, source: 'unit', detail: 'denied: no evidence' },
    ]);
  });

  it('collects hook denies and never collects approvals', () => {
    const model = mergeRunModel(makeView({ id: 'r-h' }, [makeUnit({ ord: 0 })]), [
      { type: 'governanceHookFired', session: 'run-1', ord: 0, attempt: 0,
        toolName: 'Write', decision: 'deny', denyingPolicy: 'pol-1' } as unknown as CoreEvent,
      { type: 'governanceHookFired', session: 'run-1', ord: 0, attempt: 0,
        toolName: 'Read', decision: 'allow' } as unknown as CoreEvent,
    ]);
    expect(runRecordDecisions(model)).toEqual([
      { ord: 0, source: 'hook', detail: 'Write denied by pol-1' },
    ]);
  });

  it('is empty for a run with no governance activity at all', () => {
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    expect(runRecordDecisions(model)).toEqual([]);
  });
});

describe('GovernanceAudit — non-contradiction on an empty claims wire', () => {
  it('names its own wire as empty AND surfaces the run-record deny, never the flat "no governance" copy', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    render(<GovernanceAudit model={deniedModel()} />);

    await waitFor(() => expect(screen.getByTestId('governance-wire-empty')).toBeInTheDocument());
    expect(screen.getByTestId('governance-wire-empty').textContent)
      .toMatch(/claims wire.*holds no claims/s);
    const record = screen.getByTestId('governance-run-record');
    expect(record.textContent).toContain('DENY');
    expect(record.textContent).toContain('unit #1');
    expect(record.textContent).toContain('token-refresh');
    expect(record.textContent).toContain('Decisions panel');
    // The contradiction sentence must be gone on this run.
    expect(screen.queryByText(/No governance claims recorded for this run/)).toBeNull();
  });

  it('keeps the honest empty state on a run with no governance activity anywhere', async () => {
    listClaims.mockResolvedValue({ claims: [] });
    const model = mergeRunModel(makeView({ id: 'r-clean' }, [makeUnit({ ord: 0 })]), []);
    render(<GovernanceAudit model={model} />);
    await waitFor(() =>
      expect(screen.getByText(/No governance claims recorded for this run/)).toBeInTheDocument());
    expect(screen.queryByTestId('governance-run-record')).toBeNull();
  });

  it('renders the claims themselves when the wire carries them (unchanged path)', async () => {
    listClaims.mockResolvedValue({ claims: [{
      claim_id: 'clm-1', scope: 'r-auth', phase: 'review', policy_ids: [],
      decision: 'deny', obligations: [], evaluated_context_ref: 'ctx',
      criteria: null, evaluator_identity: 'conformance', evaluated_at: 1,
    }] });
    render(<GovernanceAudit model={deniedModel()} />);
    await waitFor(() => expect(screen.getByText('DENY')).toBeInTheDocument());
    expect(screen.queryByTestId('governance-wire-empty')).toBeNull();
  });
});
