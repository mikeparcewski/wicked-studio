// F-7R2-007 / F-7R2-018 on the landing inbox's gate card — the same lever and the same
// verdict rule as the run page's card, from the same predicates.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import { reassignPolling } from '../src/components/ReassignControl.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { makeUnit, makeView } from './factories.js';
import type { CoreEvent, RosterSeat } from '../src/api/types.js';

const RUN = 'b86c14c1-7r2';
const PROMPT = 'Unit 3 failed and triage escalated: triage judge errored: triage judge failed (Failed):';
const POOL = ['claude', 'codex', 'pi'];
const UNITS = [
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u3`, session_id: RUN, ord: 3, stage: 'build', status: 'pending', assigned_cli: 'codex' }),
];
const EVENTS: CoreEvent[] = [
  { type: 'gateEvaluated', session: RUN, ord: 2, seq: 1, ts: 1, criterion: null, hasDeterministicFloor: false, deterministicPass: true,
    agentVerdict: null, agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [], denialReason: null, denial: null, combined: true },
  { type: 'awaitingHuman', session: RUN, ord: 3, seq: 2, ts: 2, prompt: PROMPT, reviewingOrd: null },
] as unknown as CoreEvent[];
const ROSTER: RosterSeat[] = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: false },
  { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true, signed_in: false },
];

const confirmGate = vi.hoisted(() => vi.fn(async () => ({})));
const reassignRun = vi.hoisted(() => vi.fn(async () => ({ status: 'ok', ord: 3, cli: 'claude' })));
const getRun = vi.hoisted(() => vi.fn());
const getRunEvents = vi.hoisted(() => vi.fn<(id: string) => Promise<{ events: unknown[] }>>(async () => ({ events: [] })));

vi.mock('../src/api/client.js', () => ({
  api: {
    confirmGate: (...a: unknown[]) => confirmGate(...(a as [])),
    injectMessage: vi.fn(async () => ({})),
    getRunEvents: (id: string) => getRunEvents(id),
    reassignRun: (...a: unknown[]) => reassignRun(...(a as [])),
    getRun: (...a: unknown[]) => getRun(...(a as [])),
    getRoster: async () => ({ roster: ROSTER }),
  },
}));

beforeEach(() => {
  reassignPolling.intervalMs = 1;
  confirmGate.mockClear();
  reassignRun.mockClear();
  getRun.mockReset();
  getRun.mockResolvedValue({ run: makeView({ id: RUN, status: 'executing', clis: POOL }, UNITS) });
  getRunEvents.mockReset();
  getRunEvents.mockImplementation(async (id) => ({ events: id === RUN ? EVENTS : [] }));
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 3, prompt: PROMPT, lifecycle: 'open', receivedAt: 1 } } });
  useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  clearCachedRoster();
  setCachedRoster(ROSTER);
});

function dash(): void {
  render(
    <CenterDashboard
      runs={[makeView({ id: RUN, problem: 'run the governed test', status: 'awaiting_human', unit_ix: 2, clis: POOL }, UNITS)]}
      onSelectRun={vi.fn()}
      onApproveGate={vi.fn()}
      onRejectGate={vi.fn()}
      navigate={vi.fn()}
    />,
  );
}

describe('the inbox gate card on a failure escalation', () => {
  it('F-7R2-018: renders no verdict block for unit 2 under the unit-3 escalation card', async () => {
    dash();
    const card = await screen.findByTestId('gate-inbox-card');
    await waitFor(() => expect(getRunEvents).toHaveBeenCalledTimes(1));
    await screen.findByTestId('steering-reassign-row');
    expect(within(card).queryByTestId('gate-verdict')).toBeNull();
  });

  it('F-7R2-007: offers Reassign to <seat> + retry from the run\'s pool minus the failed seat, and drives approve → reassign', async () => {
    dash();
    const card = await screen.findByTestId('gate-inbox-card');
    const row = await within(card).findByTestId('steering-reassign-row');
    expect(within(row).getAllByTestId('steering-reassign-option').map((o) => o.getAttribute('value'))).toEqual(['claude', 'pi']);
    expect(within(card).getByRole('button', { name: 'Approve (retry on codex)' })).toBeInTheDocument();

    fireEvent.click(within(row).getByTestId('steering-reassign'));
    await waitFor(() => expect(confirmGate).toHaveBeenCalledWith(RUN, { approve: true }));
    await waitFor(() => expect(reassignRun).toHaveBeenCalledWith(RUN, 'claude'));
    await waitFor(() => expect(useGateStore.getState().gates[RUN]).toBeUndefined());
  });
});
