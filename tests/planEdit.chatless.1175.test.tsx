// studio#1175: a chatless run's plan card (`/s/run:<id>`, a Revise-this-PR run) offers Change something exactly where the
// engine lists `edit_plan`, and it opens the plan editor, for a fixed-workflow run too (the engine lists it at any plan gate
// whose unit has not run).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../src/board/gateActions.js';
import type { GateAction } from '../src/board/gateContract.js';
import { takesPlanEdit } from '../src/board/planOrder.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { RunBlock } from '../src/components/session/RunConversation.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { takeProposal } from './askGateHelpers.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-chatless-plan';
const act = (action: string, intent: string): GateAction => ({ action, intent, note: 'optional', needsPlanRev: true });
const APPROVE = act('approve', 'approve_plan');
const EDIT = act('edit_plan', 'edit_plan');
const BACK = act('request_changes', 'send_back');
const STOP = { action: 'reject', intent: 'stop', note: 'none' as const, needsPlanRev: true } satisfies GateAction;

function view() {
  // A fixed-workflow run: no `run_identity` of kind preset / user_plan.
  return makeView({ id: RUN, status: 'awaiting_human', problem: 'Revise this PR' } as never, [
    makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 1, status: 'pending', stage: 'build', role: 'creator', assigned_cli: 'claude' } as never),
  ]);
}
const gateWith = (actions: GateAction[]): OpenGate =>
  ({ runId: RUN, ord: 1, prompt: 'Approve plan rev 1.', lifecycle: 'open', receivedAt: Date.now(), gateKind: 'plan_approval', actions, actionsRead: true } as OpenGate);

beforeEach(() => {
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  useGateActionStore.setState({ byGate: { [RUN]: IDLE_GATE_ACTION } });
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ units: [], rows: [
    { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { kind: 'initial', steps: [{ id: 'fix', catalog: 'build' }, { id: 'review', catalog: 'review' }, { id: 'deliver', catalog: 'deliver' }] } },
    { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1, reason: 'manual_mode' } },
  ] } as never);
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false } as never);
  vi.spyOn(client.api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] } as never);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const mount = (actions: GateAction[]) => {
  useGateStore.setState({ gates: { [RUN]: gateWith(actions) }, approaching: {} });
  render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
};

describe('studio#1175: the plan card offers the editor exactly when edit_plan is listed', () => {
  it('edit_plan listed: Change something is drawn, and opening it shows the plan editor', async () => {
    mount([APPROVE, EDIT, BACK, STOP]);
    const edit = await screen.findByTestId('session-proposal-edit');
    expect(edit.textContent).toContain('Change something');
    takeProposal('session-proposal-edit');
    await waitFor(() => expect(screen.getByTestId('plan-order')).toBeTruthy());
    expect(screen.queryByTestId('plan-order-none')).toBeNull();
    expect(screen.getAllByTestId('plan-step')).toHaveLength(3);
  });

  it('edit_plan not listed: no Change something', async () => {
    mount([APPROVE, BACK, STOP]);
    await screen.findByTestId('session-proposal-option');
    await waitFor(() => expect(teamPlanApi.team).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('session-proposal-edit')).toBeNull();
  });

  it('a planned run at a gate that does not list edit_plan has no editor either (the list decides for every identity)', () => {
    const planned = makeView({ id: RUN, status: 'awaiting_human', run_identity: { kind: 'preset' } } as never, []);
    expect(takesPlanEdit(planned, gateWith([APPROVE, BACK, STOP]))).toBe(false);
    expect(takesPlanEdit(planned, gateWith([APPROVE, EDIT]))).toBe(true);
    // no list (an older daemon): the planned-run rule, as before
    expect(takesPlanEdit(planned, { gateKind: 'plan_approval' })).toBe(true);
    expect(takesPlanEdit(view(), { gateKind: 'plan_approval' })).toBe(false);
  });

  it('the held plan is unreadable (no team rows) on a fixed-workflow run: no control that would open nothing', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ units: [], rows: [] } as never);
    mount([APPROVE, EDIT, BACK, STOP]);
    await screen.findByTestId('session-proposal-option');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('session-proposal-edit')).toBeNull();
  });

  it('while a capable daemon\'s list is still being read the control waits', async () => {
    useCapabilities.setState({ gateActions: true } as never);
    const g = gateWith([]);
    delete (g as { actions?: unknown }).actions;
    delete (g as { actionsRead?: unknown }).actionsRead;
    useGateStore.setState({ gates: { [RUN]: g }, approaching: {} });
    vi.spyOn(client.api, 'getGate').mockReturnValue(new Promise(() => {}) as never);
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    await screen.findByTestId('session-proposal-option');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('session-proposal-edit')).toBeNull();
    useCapabilities.setState({ gateActions: false } as never);
  });
});
