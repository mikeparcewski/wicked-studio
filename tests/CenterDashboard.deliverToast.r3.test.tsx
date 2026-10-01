// R1/R3 (ship-prove-3; Copilot on studio#400): approving a deliver gate from the landing inbox
// toasts the SAME card sentence the run page's gate does — what this push does on this origin —
// never a generic pull-request promise on a local origin.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import { UndoToasts } from '../src/components/UndoToasts.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-local-deliver';
const CARD =
  `Pushes branch wicked/${RUN} to origin (/srv/proof/remote.git) — a local path, so no pull request can be opened against it: unless another remote in this checkout is a GitHub repository gh resolves, the pushed branch IS the delivery.`;
const PROMPT = 'Approve delivery before unit 4 runs.';

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(null);
  usePlanGateStore.setState({ byRun: {} });
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } } });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
});

describe('the inbox approve on a deliver gate (R1/R3)', () => {
  it('toasts the gate card sentence, not "resumes" and not a pull-request promise', async () => {
    const units = [
      makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 3, status: 'done' }),
      makeUnit({
        id: `${RUN}:deliver`, session_id: RUN, ord: 4, status: 'pending',
        description: `deliver — add the truncate helper ||| ${CARD} Push identity: none configured — pushes as whatever login gh holds.`,
      }),
    ];
    render(
      <>
        <CenterDashboard
          runs={[makeView({ id: RUN, problem: 'add the truncate helper', status: 'awaiting_human', unit_ix: 3 }, units)]}
          onSelectRun={vi.fn()}
          onApproveGate={vi.fn()}
          onRejectGate={vi.fn()}
          navigate={vi.fn()}
        />
        <UndoToasts />
      </>,
    );
    const card = await screen.findByTestId('gate-inbox-card');
    await userEvent.click(within(card).getByRole('button', { name: 'Approve' }));
    const toast = await screen.findByTestId('undo-toast');
    expect(toast).toHaveTextContent('no pull request can be opened against it');
    expect(toast).not.toHaveTextContent('opens a pull request');
    expect(toast).not.toHaveTextContent('The run resumes past this gate');
  });
});
