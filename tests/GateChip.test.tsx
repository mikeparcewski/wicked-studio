import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectCard } from '../src/components/ProjectCard.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { Project, SessionStatus } from '../src/api/types.js';
import * as client from '../src/api/client.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

/**
 * Answerable gate chips on the board (DES-MERGE-001 §6.2 slice 7). These pin the
 * ACs that need no browser: a simple gate answered inline WITHOUT navigating, the
 * in-flight/error contract of §3.3, the double-submit guard, and a complex gate
 * (§7.11) deep-linking to the thread's gate message instead of pretending a
 * fixed-height card can hold it.
 */

const RUN = 'run-7';
const PROJECT = 'proj-7';

const project: Project = {
  id: PROJECT, name: 'the merge', description: null, status: 'active',
  scope: `project:${PROJECT}`, created_at: 1, updated_at: 1,
};

function item(status: SessionStatus = 'awaiting_human'): BoardProject {
  return {
    project,
    repo: null,
    runs: [makeView({ id: RUN, status, unit_ix: 0 }, [makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, stage: 'build' })])],
    docs: [],
    attachedAt: {},
    attention: status === 'awaiting_human' ? 'gate' : 'running',
    // Slice-1 score fields: the chip is driven by run status + the gate store,
    // so a nominal score/band is enough to typecheck.
    score: 100,
    band: 'needs-you',
    signal: null,
  };
}

function openGate(over: Partial<OpenGate> = {}): void {
  useGateStore.setState({
    gates: { [RUN]: { runId: RUN, ord: 0, prompt: 'Approve the acceptance criteria?', lifecycle: 'open', receivedAt: Date.now(), ...over } },
  });
}

const card = (navigate = vi.fn(), status: SessionStatus = 'awaiting_human'): typeof navigate => {
  render(<ProjectCard item={item(status)} navigate={navigate} />);
  return navigate;
};

describe('board gate chips (§1.4 — answerable, not a badge)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    // The decision state is module-shared since slice H (gateActions.ts) —
    // reset it so one test's answered gate never bleeds into the next.
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  });

  it('a waiting simple gate renders approve/reject ON the card', () => {
    openGate();
    card();
    expect(screen.getByTestId(`gate-approve-${RUN}`)).toBeEnabled();
    expect(screen.getByTestId(`gate-reject-${RUN}`)).toBeEnabled();
  });

  it('a run that is not waiting has no chip at all', () => {
    card(vi.fn(), 'executing');
    expect(screen.queryByTestId(`gate-approve-${RUN}`)).toBeNull();
  });

  it('approve posts the decision and does NOT navigate', async () => {
    const user = userEvent.setup();
    openGate();
    const navigate = card();
    await user.click(screen.getByTestId(`gate-approve-${RUN}`));
    expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: true });
    expect(navigate).not.toHaveBeenCalled();
    // The gate is pruned locally; the card then follows the run's status (slice 6).
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    expect(screen.getByTestId(`gate-answered-${RUN}`)).toHaveTextContent('approved');
  });

  it('reject posts {approve:false}', async () => {
    const user = userEvent.setup();
    openGate();
    card();
    await user.click(screen.getByTestId(`gate-reject-${RUN}`));
    expect(client.api.confirmGate).toHaveBeenCalledWith(RUN, { approve: false });
  });

  it('the card reflects the run advancing in place — the chip goes with the status', async () => {
    const user = userEvent.setup();
    openGate();
    const { rerender } = render(<ProjectCard item={item()} navigate={vi.fn()} />);
    await user.click(screen.getByTestId(`gate-approve-${RUN}`));
    // What a `resumed` frame does: the run list reconciles off `awaiting_human`.
    rerender(<ProjectCard item={item('executing')} navigate={vi.fn()} />);
    expect(screen.queryByTestId(`gate-approve-${RUN}`)).toBeNull();
    expect(screen.getByTestId('run-chip')).toHaveAttribute('data-status', 'executing');
  });

  it('disables the chip in flight and never double-submits', async () => {
    const user = userEvent.setup();
    let release = (): void => {};
    vi.spyOn(client.api, 'confirmGate').mockReturnValue(
      new Promise((resolve) => { release = () => resolve({ status: 'ok' }); }),
    );
    openGate();
    card();
    const approve = screen.getByTestId(`gate-approve-${RUN}`);
    await user.click(approve);
    expect(approve).toBeDisabled();
    expect(screen.getByTestId(`gate-reject-${RUN}`)).toBeDisabled();
    // A click on a disabled button is dropped by the DOM; the guard covers the
    // programmatic path too (a queued event landing after the first POST opened).
    approve.click();
    await act(async () => { release(); });
    expect(screen.getByTestId(`gate-answered-${RUN}`)).toBeInTheDocument();
    expect(client.api.confirmGate).toHaveBeenCalledTimes(1);
  });

  it('names the failure on the chip and re-enables it — clicking again is the retry (§3.3)', async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'confirmGate')
      .mockRejectedValueOnce(new Error('409 gate already decided'))
      .mockResolvedValueOnce({ status: 'ok' });
    openGate();
    card();
    await user.click(screen.getByTestId(`gate-approve-${RUN}`));
    const error = await screen.findByTestId(`gate-error-${RUN}`);
    expect(error).toHaveTextContent('409 gate already decided');
    expect(screen.getByTestId(`gate-approve-${RUN}`)).toBeEnabled();
    await user.click(screen.getByTestId(`gate-approve-${RUN}`));
    expect(client.api.confirmGate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(`gate-answered-${RUN}`)).toBeInTheDocument();
  });

  it('a complex gate deep-links to the thread instead of answering inline (§7.11)', async () => {
    const user = userEvent.setup();
    openGate({ choices: ['ship it', 'rework the plan', 'split the slice'] });
    const navigate = card();
    expect(screen.queryByTestId(`gate-approve-${RUN}`)).toBeNull();
    const open = screen.getByTestId(`gate-open-${RUN}`);
    expect(open).toHaveAttribute('href', `/p/${PROJECT}/build/${RUN}#gate`);
    await user.click(open);
    expect(navigate).toHaveBeenCalledWith(`/p/${PROJECT}/build/${RUN}#gate`);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
  });

  it('a gate that demands free text is complex too', () => {
    openGate({ choices: null });
    card();
    expect(screen.queryByTestId(`gate-approve-${RUN}`)).toBeNull();
    expect(screen.getByTestId(`gate-open-${RUN}`)).toBeInTheDocument();
  });

  it('a gate whose prompt the daemon lost is still answerable inline (§3.3 known limit)', () => {
    useGateStore.setState({ gates: {} });
    card();
    expect(screen.getByTestId(`gate-approve-${RUN}`)).toBeEnabled();
  });
});
