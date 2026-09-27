// D10 / D11 (dogfood 2026-09-27): a `plan_approval` gate decides the PLAN. The card shows why the
// plan scored as it did (score, band, the score's reasons, what the floor added) instead of the
// scope step's verdict wall; it offers approve, approve with an edited plan, and reject — never
// "Approve + steer", which the daemon refuses there ("takes an edited plan, not amend text").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { teamPlanApi, type RunTeamResponse } from '../src/api/teamPlan.js';
import { dedupePromptClauses, floorAddedText, planGateOf } from '../src/board/planModel.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { useGateStore } from '../src/store/gates.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';

const SHA_A = '3071a7632882ade840e3c73772eaf44288c6b4c3';
const SHA_B = 'e9d64e746433a8db220597d6030772163ce984b9';

/** The rig's run 1a22f803 at its plan gate (GET /runs/:id/team, trimmed): the PA scoped, the
 *  stale code graph failed the score closed at 100, the floor added three phases. */
function highRiskTeam(decided = false): RunTeamResponse {
  return {
    rows: [
      { event_id: 617, event_type: 'wicked.team.plan.proposed', payload: {
        kind: 'initial', steps: [
          { catalog: 'understand', id: 'pa-scope' }, { catalog: 'understand', id: 'understand' },
          { catalog: 'design', id: 'design' }, { catalog: 'produce', id: 'produce' },
          { catalog: 'critique', id: 'critique' }, { catalog: 'review', id: 'review' },
          { catalog: 'deliver', id: 'deliver' },
        ] } },
      { event_id: 618, event_type: 'wicked.team.path.scored', payload: {
        score: 100, reasons: [`fail closed at 100: graph indexed at ${SHA_A} is not the run base ${SHA_B}`] } },
    ],
    units: [
      { ord: 1, rows: [
        { event_id: 600, event_type: 'wicked.team.gate.opened', payload: { kind: 'unit_review', gate_id: 'g-1' } },
        { event_id: 601, event_type: 'wicked.team.gate.decided', payload: { kind: 'unit_review', gate_id: 'g-1' } },
      ] },
      { ord: 2, rows: [
        { event_id: 619, event_type: 'wicked.team.gate.opened', payload: {
          kind: 'plan_approval', gate_id: 'g-3', ord: 2, plan_rev: 2, band: '70-100', high_risk: true,
          mode: 'manual', reason: 'manual_mode', diff: { from_rev: 1, added: ['test_plan', 'architecture', 'security_review'] } } },
        ...(decided ? [{ event_id: 620, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g-3' } }] : []),
      ] },
    ],
  };
}

const PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 70-100; manual mode): understand → test_plan → design → produce. Approve, approve with an edited plan, or reject.';

beforeEach(() => {
  vi.restoreAllMocks();
  usePlanGateStore.setState({ byRun: {} });
  useGateStore.setState({ gates: {} });
  resetPlanCatalog();
});

describe('planGateOf — the open plan gate off GET /runs/:id/team', () => {
  it('reads score, band, reasons (commits shortened), floor additions and the edit seed', () => {
    const v = planGateOf(highRiskTeam());
    expect(v).not.toBeNull();
    expect(v).toMatchObject({
      gateId: 'g-3', ord: 2, planRev: 2, band: '70-100', highRisk: true, reason: 'manual_mode', score: 100,
      floorAdded: ['test_plan', 'architecture', 'security_review'],
      // pa-scope is the engine's (authoring it is refused); deliver is the launch's own step.
      editSeed: ['understand', 'design', 'produce', 'critique', 'review'],
    });
    expect(v!.reasons).toEqual(['fail closed at 100: graph indexed at 3071a76 is not the run base e9d64e7']);
    expect(floorAddedText(v!)).toBe('The floor added test_plan, architecture, security_review: band 70-100 requires them.');
  });

  it('a decided plan gate is not open; a unit gate is never a plan gate', () => {
    expect(planGateOf(highRiskTeam(true))).toBeNull();
    expect(planGateOf({ rows: [], units: [] })).toBeNull();
  });

  it('says "manual mode" once', () => {
    expect(dedupePromptClauses(PROMPT)).toContain('(manual mode; band 70-100)');
  });
});

describe('SteeringGate on a plan_approval gate', () => {
  it('shows why the plan is high risk, no steer path, and no scope verdict', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue(highRiskTeam());
    render(<SteeringGate runId="run-plan" ord={2} prompt={PROMPT} />);

    const summary = await screen.findByTestId('plan-gate-summary');
    await waitFor(() => expect(summary.dataset.state).toBe('ready'));
    expect(screen.getByTestId('plan-gate-score')).toHaveTextContent('Score 100 · band 70-100 · high risk');
    expect(screen.getByTestId('plan-gate-reason')).toHaveTextContent('graph indexed at 3071a76 is not the run base e9d64e7');
    expect(screen.getByTestId('plan-gate-floor')).toHaveTextContent('band 70-100 requires them');
    expect(screen.getByTestId('steering-prompt').textContent).toContain('(manual mode; band 70-100)');
    expect(screen.getByTestId('steering-prompt').textContent).not.toMatch(/manual mode.*manual mode/);
    expect(screen.queryByTestId('steering-approve-steer')).toBeNull();
    expect(screen.queryByTestId('steering-amend')).toBeNull();
    expect(screen.queryByTestId('gate-verdict')).toBeNull();
    expect(screen.getByTestId('steering-gate').dataset.gateKind).toBe('plan_approval');
  });

  it('approve with an edited plan sends {approve:true, plan} seeded from the held plan', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue(highRiskTeam());
    vi.spyOn(teamPlanApi, 'catalog').mockResolvedValue({ entries: [
      'understand', 'design', 'produce', 'critique', 'review', 'test', 'deliver',
    ].map((id) => ({ id, kind: 'build', role: 'neutral', gate: 'auto', gate_type: null, executes_code: false,
      executor: id === 'deliver' ? 'tool' : 'agent', validator_pin: null, pinned: false, evidence_floor: false,
      skill_ref: null, description: null })) as never });
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(<SteeringGate runId="run-plan-edit" ord={2} prompt={PROMPT} />);
    await waitFor(() => expect(screen.getByTestId('plan-gate-summary').dataset.state).toBe('ready'));

    await user.click(screen.getByTestId('plan-gate-edit-open'));
    await waitFor(() => expect(screen.getByTestId('phase-picker').dataset.catalogState).toBe('ready'));
    // The launch's deliver step is never authored in an edit.
    expect(screen.queryByRole('button', { name: '+ deliver' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '+ test' }));
    await user.click(screen.getByTestId('plan-gate-approve-edited'));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const [, decision] = confirm.mock.calls[0]!;
    expect(decision).toMatchObject({
      approve: true,
      plan: { steps: [
        { catalog: 'understand' }, { catalog: 'design' }, { catalog: 'produce' },
        { catalog: 'critique' }, { catalog: 'review' }, { catalog: 'test' },
      ] },
    });
    expect('amend' in (decision as object)).toBe(false);
  });

  it('reject is the bare reject, whatever a draft note holds', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue(highRiskTeam());
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    render(<SteeringGate runId="run-plan-rej" ord={2} prompt={PROMPT} guidance="focus on the API" />);
    await waitFor(() => expect(screen.getByTestId('plan-gate-summary').dataset.state).toBe('ready'));
    await userEvent.click(screen.getByTestId('steering-reject'));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith('run-plan-rej', expect.objectContaining({ approve: false })));
    expect('amend' in (confirm.mock.calls[0]![1] as object)).toBe(false);
  });
});

describe('the bottom composer at a plan gate', () => {
  it('sends a plain team message (inject), never a gate answer', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue(highRiskTeam());
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    const inject = vi.spyOn(client.api, 'injectMessage').mockResolvedValue({ status: 'ok' });
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(<ChatInput runId="run-plan-msg" runStatus="awaiting_human" onLaunched={vi.fn()} />);

    const box = screen.getByTestId('gate-composer');
    await waitFor(() => expect(box.dataset.mode).toBe('team-message'));
    expect(box.getAttribute('placeholder')).not.toMatch(/approves gate/);
    await user.type(box, 'keep the API stable');
    await user.click(screen.getByRole('button', { name: 'Send →' }));
    await waitFor(() => expect(inject).toHaveBeenCalledWith('run-plan-msg', 'keep the API stable', 'all'));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('a unit gate keeps the steer composer', async () => {
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    render(<ChatInput runId="run-unit" runStatus="awaiting_human" onLaunched={vi.fn()} />);
    await waitFor(() => expect(teamPlanApi.team).toHaveBeenCalled());
    expect(screen.getByTestId('gate-composer').dataset.mode).toBe('steer');
  });
});

// codex on #352: a reload or late join knows no gate kind until the team read answers. Until then
// nothing may steer the gate — it may be a plan gate, whose daemon refuses amend text.
describe('a gate whose kind is not known yet fails closed', () => {
  it('the card keeps Approve + steer disabled while the team read is pending', async () => {
    let answer: (t: RunTeamResponse) => void = () => undefined;
    vi.spyOn(teamPlanApi, 'team').mockReturnValue(new Promise((res) => { answer = res; }));
    const user = userEvent.setup();
    render(<SteeringGate runId="run-kind-pending" ord={2} prompt="Approve unit 2?" />);
    await user.type(screen.getByTestId('steering-amend'), 'focus on the API');
    expect(screen.getByTestId('steering-approve-steer')).toBeDisabled();
    answer({ rows: [], units: [] });
    await waitFor(() => expect(screen.getByTestId('steering-approve-steer')).toBeEnabled());
  });

  it('the bottom composer decides the kind before it sends: a plan gate gets a team message', async () => {
    let answer: (t: RunTeamResponse) => void = () => undefined;
    vi.spyOn(teamPlanApi, 'team').mockReturnValue(new Promise((res) => { answer = res; }));
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    const inject = vi.spyOn(client.api, 'injectMessage').mockResolvedValue({ status: 'ok' });
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ ok: true } as never);
    const user = userEvent.setup();
    render(<ChatInput runId="run-kind-late" runStatus="awaiting_human" onLaunched={vi.fn()} />);
    await user.type(screen.getByTestId('gate-composer'), 'keep the API stable');
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    answer(highRiskTeam());
    await waitFor(() => expect(inject).toHaveBeenCalledWith('run-kind-late', 'keep the API stable', 'all'));
    expect(confirm).not.toHaveBeenCalled();
  });
});
