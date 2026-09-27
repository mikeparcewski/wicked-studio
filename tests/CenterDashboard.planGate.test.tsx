// D11 on the landing inbox (codex on #352): a plan gate's card answers approve or reject in
// place, offers no steer, and links to the run page for the edited-plan answer.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { makeView } from './factories.js';

const RUN = 'r-plan-inbox';
const PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 70-100; manual mode): build → review.';

beforeEach(() => {
  vi.restoreAllMocks();
  usePlanGateStore.setState({ byRun: {} });
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' } } });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
});

describe('the inbox card on a plan gate', () => {
  it('offers approve, reject and "Edit the plan ›" (to the run page), never Approve + steer', async () => {
    const onSelectRun = vi.fn();
    render(
      <CenterDashboard
        runs={[makeView({ id: RUN, problem: 'produce the spec', status: 'awaiting_human', unit_ix: 1 })]}
        onSelectRun={onSelectRun}
        onApproveGate={vi.fn()}
        onRejectGate={vi.fn()}
        navigate={vi.fn()}
      />,
    );
    const card = await screen.findByTestId('gate-inbox-card');
    expect(within(card).queryByRole('button', { name: /steer/i })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    await userEvent.click(within(card).getByTestId('gate-inbox-edit-plan'));
    await waitFor(() => expect(onSelectRun).toHaveBeenCalledWith(RUN));
  });
});
