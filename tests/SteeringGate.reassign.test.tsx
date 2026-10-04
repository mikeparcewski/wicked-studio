// F-7R2-007 — the seat lever on a failure-escalation gate (the run page's card), and
// F-7R2-018 — no previous-phase verdict under a card about the unit that failed.
//
// The phase7-r2 rig: five "Unit N failed and triage escalated" gates; plain Approve re-dispatched
// the dead seat; recovery was `POST /runs/:id/reassign {cli:"claude"}` by hand, racing the
// re-dispatch window. The card now approves the retry, waits for the run to resume, then
// reassigns — every step stated; the roster's word on each seat labels the pick.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, RosterSeat } from '../src/api/types.js';
import { reassignPolling } from '../src/components/ReassignControl.js';
import { useUndoQueue } from '../src/board/undoQueue.js';
import { SteeringGate } from '../src/components/SteeringGate.js';
import { useAnnotationStore } from '../src/store/annotations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useSteeringStore } from '../src/store/steering.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'b86c14c1-7r2';
const PROMPT = 'Unit 3 failed and triage escalated: triage judge errored: triage judge failed (Failed):';
const POOL = ['claude', 'codex', 'pi', 'opencode'];
const UNITS = [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:u3`, session_id: RUN, ord: 3, stage: 'build', status: 'pending', assigned_cli: 'codex' }),
];
const EVENTS: CoreEvent[] = [
  { type: 'gateEvaluated', session: RUN, ord: 2, criterion: null, hasDeterministicFloor: false, deterministicPass: true,
    agentVerdict: null, agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [], denialReason: null, denial: null, combined: true },
  { type: 'gateDecided', session: RUN, ord: 2, allow: true },
  { type: 'unitDone', session: RUN, ord: 2 },
  { type: 'unitDispatched', session: RUN, ord: 3, cli: 'codex', attempt: 0 },
  { type: 'stepFailed', session: RUN, ord: 3, detail: 'codex exited 1' },
  { type: 'awaitingHuman', session: RUN, ord: 3, prompt: PROMPT, reviewingOrd: null },
] as unknown as CoreEvent[];
const ROSTER: RosterSeat[] = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true },
  { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
  { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
  { key: 'opencode', display_name: 'OpenCode', binary: 'opencode', enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: false },
];

function mount(onResolved = vi.fn()): ReturnType<typeof vi.fn> {
  render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} clis={POOL} onResolved={onResolved} />);
  return onResolved;
}

beforeEach(() => {
  vi.restoreAllMocks();
  reassignPolling.intervalMs = 1; // the resume wait polls in milliseconds here, not half-seconds
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 3, prompt: PROMPT, lifecycle: 'open', receivedAt: 1 } } });
  useAnnotationStore.setState({ drafts: {} });
  useSteeringStore.setState({ entries: [], seq: 0 });
  useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  clearCachedRoster();
  setCachedRoster(ROSTER);
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'reassignRun').mockResolvedValue({ status: 'ok', ord: 3, cli: 'claude' });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ROSTER });
});
afterEach(cleanup);

describe('F-7R2-018: the verdict block is about THIS unit', () => {
  it('renders no gate-verdict under the escalation card when unit 3 has no evaluation (unit 2\'s pass is not it)', () => {
    mount();
    expect(screen.getByTestId('steering-prompt')).toHaveTextContent('Unit 3 failed and triage escalated');
    expect(screen.queryByTestId('gate-verdict')).toBeNull();
  });
});

describe('F-7R2-007: Reassign to <seat> + retry', () => {
  it('offers only the run\'s other seats that can take the retry, and names the rest with the roster\'s word (studio#315); Approve names the dead seat it retries', () => {
    mount();
    const row = screen.getByTestId('steering-reassign-row');
    const options = within(row).getAllByTestId('steering-reassign-option');
    expect(options.map((o) => o.getAttribute('value'))).toEqual(['claude']);
    expect(options[0]!.textContent).toBe('Claude Code');
    // studio#315: a signed-out seat is not offered (run db708484 took one and lost the run) — named, not hidden.
    expect(screen.getByTestId('steering-reassign-withheld')).toHaveTextContent(
      'not offered: pi (no sign-in observed — may fail or be benched) · OpenCode (no sign-in observed — may fail or be benched)',
    );
    expect(screen.getByTestId('steering-reassign')).toHaveTextContent('Reassign to Claude Code + retry');
    expect(screen.getByTestId('steering-retry')).toHaveTextContent('Retry');
    expect(screen.getByTestId('steering-retry').getAttribute('title')).toContain('Re-dispatches the failed unit');
  });

  it('approves the retry, waits for the run to resume, then reassigns to the chosen seat — and resolves the gate', async () => {
    const statuses = ['awaiting_human', 'awaiting_human', 'executing'];
    vi.spyOn(client.api, 'getRun').mockImplementation(async () => ({
      run: makeView({ id: RUN, status: statuses.shift() as 'executing' ?? 'executing', clis: POOL }, UNITS),
    }));
    const onResolved = mount();
    // A steer typed on the card rides the approve.
    fireEvent.change(screen.getByTestId('steering-amend'), { target: { value: 'use the other seat' } });
    fireEvent.click(screen.getByTestId('steering-reassign'));

    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, expect.objectContaining({ approve: true, amend: 'use the other seat' })));
    await waitFor(() => expect(client.api.reassignRun).toHaveBeenCalledWith(RUN, 'claude'), { timeout: 3000 });
    expect(client.api.getRun).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.getByTestId('steering-reassign-row')).toHaveAttribute('data-phase', 'done'));
    expect(screen.getByTestId('steering-reassign-status')).toHaveTextContent('reassigned to Claude Code — the retry runs there');
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    const entry = useSteeringStore.getState().entries.at(-1);
    expect(entry).toMatchObject({ runId: RUN, action: 'reassign', cli: 'claude', ord: 3 });
  });

  it('studio#480: with no steer, the move is ONE call that carries the seat with the decision — the gate is never approved first', async () => {
    const getRun = vi.spyOn(client.api, 'getRun');
    const onResolved = mount();
    fireEvent.change(screen.getByTestId('steering-reassign-seat'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByTestId('steering-reassign'));
    await waitFor(() => expect(client.api.reassignRun).toHaveBeenCalledWith(RUN, 'claude'), { timeout: 3000 });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(getRun).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('steering-reassign-row')).toHaveAttribute('data-phase', 'done'));
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    expect(useSteeringStore.getState().entries.at(-1)).toMatchObject({ runId: RUN, action: 'reassign', cli: 'claude', ord: 3 });
  });

  it('studio#480: a refused move keeps the gate open and the card up — the daemon\'s sentence, a notice, and the move again', async () => {
    vi.spyOn(client.api, 'reassignRun')
      .mockRejectedValueOnce(new Error('the daemon refused this — cli "claude" is not in this run\'s seat pool'))
      .mockResolvedValueOnce({ status: 'ok', ord: 3, cli: 'claude' });
    const onResolved = mount();
    fireEvent.change(screen.getByTestId('steering-reassign-seat'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByTestId('steering-reassign'));

    const err = await screen.findByTestId('steering-reassign-error', {}, { timeout: 3000 });
    expect(err).toHaveTextContent('not in this run\'s seat pool');
    expect(screen.getByTestId('steering-reassign-row')).toHaveAttribute('data-approved', 'false');
    expect(screen.getByTestId('steering-reassign-status')).toHaveTextContent('nothing changed');
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    expect(useGateStore.getState().gates[RUN]).toBeDefined();
    expect(onResolved).not.toHaveBeenCalled();
    expect(useUndoQueue.getState().results.some((r) => r.kind === 'failed' && /not in this run/.test(r.text))).toBe(true);

    await act(async () => { fireEvent.click(screen.getByTestId('steering-reassign-retry')); });
    await waitFor(() => expect(client.api.reassignRun).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
  });

  it('with a steer, the approve carries it first; a reassign refused after it is said on the card AND as a notice, and is offered alone again', async () => {
    vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: makeView({ id: RUN, status: 'executing', clis: POOL }, UNITS) });
    vi.spyOn(client.api, 'reassignRun')
      .mockRejectedValueOnce(new Error('the daemon refused this — cli "claude" is not in this run\'s seat pool'))
      .mockResolvedValueOnce({ status: 'ok', ord: 3, cli: 'claude' });
    const onResolved = mount();
    fireEvent.change(screen.getByTestId('steering-amend'), { target: { value: 'use the other seat' } });
    fireEvent.change(screen.getByTestId('steering-reassign-seat'), { target: { value: 'claude' } });
    fireEvent.click(screen.getByTestId('steering-reassign'));

    const err = await screen.findByTestId('steering-reassign-error');
    expect(err).toHaveTextContent('not in this run\'s seat pool');
    expect(screen.getByTestId('steering-reassign-row')).toHaveAttribute('data-approved', 'true');
    expect(screen.getByTestId('steering-reassign-status')).toHaveTextContent('the retry was approved; the reassign did not land');
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    expect(useUndoQueue.getState().results.some((r) => r.kind === 'failed' && /reassign/i.test(r.text))).toBe(true);
    expect(onResolved).not.toHaveBeenCalled();

    await act(async () => { fireEvent.click(screen.getByTestId('steering-reassign-retry')); });
    await waitFor(() => expect(client.api.reassignRun).toHaveBeenCalledTimes(2));
    // The second attempt did NOT approve again.
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onResolved).toHaveBeenCalledTimes(1));
  });

  it('a run that ends before it resumes is said, not retried into (the steered path, which waits for the resume)', async () => {
    vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: makeView({ id: RUN, status: 'failed', clis: POOL }, UNITS) });
    mount();
    fireEvent.change(screen.getByTestId('steering-amend'), { target: { value: 'use the other seat' } });
    fireEvent.click(screen.getByTestId('steering-reassign'));
    const err = await screen.findByTestId('steering-reassign-error');
    expect(err).toHaveTextContent('the run is failed — nothing left to reassign');
    expect(client.api.reassignRun).not.toHaveBeenCalled();
  });

  it('no lever on a pre-run gate; an empty pool says so', () => {
    cleanup();
    vi.spyOn(client.api, 'getRun').mockRejectedValue(new Error('not in this case'));
    render(<SteeringGate runId={RUN} ord={3} prompt="Approve unit 3 before it runs: build — the intent" units={UNITS} clis={POOL} />);
    expect(screen.queryByTestId('steering-reassign-row')).toBeNull();
    expect(screen.getByTestId('steering-approve')).toHaveTextContent('Approve'); // non-escalation: standard layout
    expect(client.api.getRun).not.toHaveBeenCalled(); // a pre-run gate never reads the run for a pool
    cleanup();
    render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} clis={['codex']} />);
    expect(screen.getByTestId('steering-reassign-none')).toHaveTextContent('no other seat in this run\'s pool (only codex, which failed)');
  });

  it('a host without the run view (the author / testing-launch panels) reads the run ONCE for its pool on a failure escalation; a failed read offers no lever', async () => {
    const getRun = vi.spyOn(client.api, 'getRun').mockResolvedValue({ run: makeView({ id: RUN, status: 'awaiting_human', clis: POOL }, UNITS) });
    render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} />);
    const row = await screen.findByTestId('steering-reassign-row');
    expect(getRun).toHaveBeenCalledTimes(1);
    expect(getRun).toHaveBeenCalledWith(RUN);
    expect(within(row).getAllByTestId('steering-reassign-option').map((o) => o.getAttribute('value'))).toEqual(['claude']);
    cleanup();
    vi.spyOn(client.api, 'getRun').mockRejectedValue(new Error('offline'));
    render(<SteeringGate runId={RUN} ord={3} prompt={PROMPT} units={UNITS} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('steering-reassign-row')).toBeNull();
    expect(screen.getByTestId('steering-retry')).toBeInTheDocument(); // escalation layout even without pool
  });
});
