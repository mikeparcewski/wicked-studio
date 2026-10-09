// W1-S1: levers that cannot work (studio#315), the team-message receipt (studio#367) and the deliver
// approve's preview (studio#368).
//
// #315 shape 1 (F-RC2-003, run db708484): a launch refusal gated with "Reassign to <seat> + retry"
// over four unusable seats; the operator took it and the second, byte-identical refusal lost the
// run. Shape 2 (F-RC2-041): Send stayed enabled beside the composer's own "not council-eligible"
// warning for every selected seat, and the launch failed at distribution ("no eligible seat").
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { RosterSeat } from '../src/api/types.js';
import { retryBlocker, retryLaunchOf } from '../src/board/repairMoves.js';
import { deliverPreview, describeDecision, setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { ChatInput, teamReceiptLine } from '../src/components/ChatInput.js';
import { noCarryingSeatReason } from '../src/components/gateVerdictModel.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { clearCachedRoster } from '../src/store/rosterCache.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeView } from './factories.js';

const bag = (o: Record<string, unknown>): Partial<RosterSeat> => o as Partial<RosterSeat>;
function seat(key: string, extra: Partial<RosterSeat> = {}): RosterSeat {
  return { key, display_name: key, binary: key, enabled_for_council: true, health: { status: 'active', since: 'x' }, ...extra };
}
const INELIGIBLE = (key: string, reason: string): RosterSeat =>
  seat(key, { signed_in: true, ...bag({ auth: 'signed_in', council_eligible: false, council_ineligible_reason: reason }) });
const BENCHED = (key: string, message: string): RosterSeat =>
  seat(key, { signed_in: true, health: { status: 'inactive', since: 'x', message } });

function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(null);
  stubLocalStorage();
  useGateStore.setState({ gates: {} });
  usePlanGateStore.setState({ byRun: {} });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: {} });
  clearCachedRoster();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── #315 shape 2: the composer ────────────────────────────────────────────────

describe('studio#315 — Send with no seat that can take the work', () => {
  it('every selected seat benched or not council-eligible: Send is disabled and says why; Cmd+Enter posts nothing', async () => {
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({
      roster: [INELIGIBLE('claude', 'signed out'), BENCHED('opencode', 'quota exhausted'), INELIGIBLE('pi', '401 on the last ballot')],
    });
    const launch = vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'x' } as never);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const reason = await screen.findByTestId('launch-no-seat');
    expect(reason).toHaveTextContent('no selected seat can take this run');
    expect(reason).toHaveTextContent('claude: not council-eligible — signed out');
    expect(reason).toHaveTextContent('opencode: benched — quota exhausted');
    // The "the other seats carry the run" sentence would be false here.
    expect(screen.queryByTestId('ineligible-warning')).toBeNull();
    const box = screen.getByTestId('launch-problem');
    await user.type(box, 'fix the flaky test');
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    expect(screen.getByTestId('launch-submit').getAttribute('title')).toContain('No selected seat can take this run');
    expect(screen.queryByText(/Ready to send:/)).toBeNull();
    fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
    await act(async () => { await Promise.resolve(); });
    expect(launch).not.toHaveBeenCalled();
  });

  it('one seat that can carry the run keeps Send live (the others only warn)', async () => {
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({
      roster: [seat('claude', { signed_in: true }), INELIGIBLE('pi', '401 on the last ballot')],
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await screen.findByTestId('ineligible-warning');
    await user.type(screen.getByTestId('launch-problem'), 'fix the flaky test');
    expect(screen.queryByTestId('launch-no-seat')).toBeNull();
    expect(screen.getByTestId('launch-submit')).toBeEnabled();
  });

  it('the refusal is the wire\'s, never a guess: a cold roster or an unknown seat refuses nothing', () => {
    expect(noCarryingSeatReason(['claude'], null)).toBeNull();
    expect(noCarryingSeatReason(['claude'], [])).toBeNull();
    expect(noCarryingSeatReason(['claude', 'agy'], [INELIGIBLE('claude', 'x')])).toBeNull();
    expect(noCarryingSeatReason(['claude'], [INELIGIBLE('claude', 'x')])).toBe('claude: not council-eligible — x');
  });
});

describe('studio#315 — Retry on a run no seat can take', () => {
  const failed = makeView({ id: 'r-fail', status: 'failed', clis: ['claude', 'opencode'], problem: 'p' } as never, []);
  it('names the reason instead of relaunching', () => {
    const roster = [INELIGIBLE('claude', 'signed out'), BENCHED('opencode', 'quota')];
    expect(retryBlocker(failed, roster)).toBe(
      'not relaunched: no seat in its pool can take it (claude: not council-eligible — signed out · opencode: benched — quota)',
    );
  });
  it('a relaunch carries only the seats that can take the work', () => {
    const roster = [seat('claude', { signed_in: true }), BENCHED('opencode', 'quota')];
    expect(retryBlocker(failed, roster)).toBeNull();
    const plan = retryLaunchOf(failed, roster);
    expect(plan.via).toBe('runs');
    if (plan.via === 'runs') expect(JSON.parse(plan.body.clisJson ?? '[]').map((s: RosterSeat) => s.key)).toEqual(['claude']);
  });
});



// ── #367: the team-message receipt ────────────────────────────────────────────

describe('studio#367 — a team message at a plan gate gets a receipt', () => {
  it('after the inject lands, the composer says what was sent and where it goes; typing again clears it', async () => {
    useGateStore.setState({ gates: { 'run-plan': { runId: 'run-plan', ord: 2, prompt: 'Approve plan rev 2', lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' } } });
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    const inject = vi.spyOn(client.api, 'injectMessage').mockResolvedValue({ status: 'ok' });
    const user = userEvent.setup();
    render(<ChatInput runId="run-plan" runStatus="awaiting_human" onLaunched={vi.fn()} />);
    const box = screen.getByTestId('gate-composer');
    await waitFor(() => expect(box.dataset.mode).toBe('team-message'));
    await user.type(box, 'keep the API stable');
    await user.click(screen.getByRole('button', { name: 'Send →' }));
    await waitFor(() => expect(inject).toHaveBeenCalledWith('run-plan', 'keep the API stable', 'all'));
    const receipt = await screen.findByTestId('team-message-receipt');
    expect(receipt).toHaveTextContent('Sent to the team: "keep the API stable"');
    expect(receipt).toHaveTextContent('the plan gate stays open');
    // The emptied box itself carries it too — a tall gate card can push the hint line below the fold.
    expect(box.getAttribute('placeholder')).toContain('Sent to the team: "keep the API stable"');
    await user.type(box, 'x');
    expect(screen.queryByTestId('team-message-receipt')).toBeNull();
    expect(box.getAttribute('placeholder')).toBe('Message the team… (the plan gate stays open)');
  });

  it('a failed inject shows the error, never a receipt', async () => {
    useGateStore.setState({ gates: { 'run-plan': { runId: 'run-plan', ord: 2, prompt: 'Approve plan rev 2', lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' } } });
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] });
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'injectMessage').mockRejectedValue(new Error('run not executing'));
    const user = userEvent.setup();
    render(<ChatInput runId="run-plan" runStatus="awaiting_human" onLaunched={vi.fn()} />);
    const box = screen.getByTestId('gate-composer');
    await waitFor(() => expect(box.dataset.mode).toBe('team-message'));
    await user.type(box, 'hello');
    await user.click(screen.getByRole('button', { name: 'Send →' }));
    expect(await screen.findByText('run not executing')).toBeInTheDocument();
    expect(screen.queryByTestId('team-message-receipt')).toBeNull();
  });

  it('clips a long message', () => {
    expect(teamReceiptLine(`${'a'.repeat(80)}\n\nb`)).toContain(`"${'a'.repeat(59)}…"`);
  });
});

// ── #368: the deliver approve's preview ───────────────────────────────────────

describe('studio#368 — approving the deliver gate says it pushes and opens a PR', () => {
  it('describeDecision names the branch and repo for a deliver approve; other gates keep "resumes"', () => {
    const t = { branch: 'wicked/abc123', repo: 'wicked-crew' };
    expect(describeDecision({ approve: true }, 1, t).preview).toBe(
      'Pushes branch wicked/abc123 to the origin of wicked-crew, under the daemon\'s GitHub sign-in; a pull request opens only if that origin is a GitHub repository.',
    );
    expect(describeDecision({ approve: true, amend: 'squash it' }, 1, t).preview).toContain('carrying your note as guidance');
    expect(describeDecision({ approve: true }).preview).toBe('The run resumes past this gate.');
    expect(describeDecision({ approve: false }, 1, t).preview).toBe('The run is cancelled at this gate.');
    expect(deliverPreview({ branch: null, repo: null })).toBe('Pushes the run branch, under the daemon\'s GitHub sign-in; a pull request opens only if that origin is a GitHub repository.');
  });

});

