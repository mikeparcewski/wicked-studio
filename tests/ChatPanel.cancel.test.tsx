import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';

/**
 * F-029 — a running run's page has a Cancel control OUTSIDE any gate. The
 * acceptance run sat in `distributing` (councils voting on the wrong repo) and
 * the only cancel on `/runs/:id` was `steering-cancel`, inside a gate card that
 * had not opened; the operator had to POST /runs/:id/cancel by hand.
 *
 *   - `run-cancel` renders in the header for EVERY non-terminal status;
 *   - it asks first (cancelling stops workers now): Keep running fires nothing;
 *   - confirming speaks the wire ONCE (`api.cancelRun(id)`) and refreshes;
 *   - a refusal stays on screen — never swallowed;
 *   - terminal runs offer no cancel (nothing actionable).
 */

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {}, approaching: {} });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
  vi.spyOn(client.api, 'cancelRun').mockResolvedValue({ status: 'cancelled' });
});

const liveView = (status: string) =>
  makeView({ id: 'run-9', status: status as never, unit_ix: 0 }, [
    makeUnit({ id: 'run-9:triage', session_id: 'run-9', ord: 1, stage: 'recon', status: 'pending' }),
  ]);

function renderPanel(view: ReturnType<typeof makeView>): { onRefresh: ReturnType<typeof vi.fn> } {
  const onRefresh = vi.fn();
  render(<ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={vi.fn()} onRefresh={onRefresh} />);
  return { onRefresh };
}

describe('run header Cancel (F-029)', () => {
  it.each(['planning', 'distributing', 'executing', 'awaiting_human'])(
    'a %s run renders Cancel run in the header, outside any gate card',
    (status) => {
      renderPanel(liveView(status));
      const header = screen.getByTestId('run-header');
      const cancel = screen.getByTestId('run-cancel');
      expect(header.contains(cancel)).toBe(true);
      expect(cancel).toHaveTextContent('Cancel run');
      // One click opens the confirm — the wire is untouched until then.
      expect(client.api.cancelRun).not.toHaveBeenCalled();
    },
  );

  it('the control does not depend on an open gate: distributing has no gate card, yet Cancel is there', () => {
    renderPanel(liveView('distributing'));
    expect(screen.queryByTestId('steering-gate')).toBeNull();
    expect(screen.queryByTestId('steering-cancel')).toBeNull();
    expect(screen.getByTestId('run-cancel')).toBeInTheDocument();
  });

  it('asks first — Keep running closes the confirm and fires nothing', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderPanel(liveView('distributing'));
    await user.click(screen.getByTestId('run-cancel'));
    const confirm = screen.getByTestId('run-cancel-confirm');
    expect(confirm).toHaveTextContent(/Cancel this run\?/);
    expect(screen.queryByTestId('run-cancel')).toBeNull();
    await user.click(screen.getByTestId('run-cancel-keep'));
    expect(screen.queryByTestId('run-cancel-confirm')).toBeNull();
    expect(screen.getByTestId('run-cancel')).toBeInTheDocument();
    expect(client.api.cancelRun).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('Escape inside the confirm is Keep running', async () => {
    const user = userEvent.setup();
    renderPanel(liveView('executing'));
    await user.click(screen.getByTestId('run-cancel'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('run-cancel-confirm')).toBeNull();
    expect(client.api.cancelRun).not.toHaveBeenCalled();
  });

  it('confirming POSTs /runs/:id/cancel exactly once and refreshes the run index', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderPanel(liveView('distributing'));
    await user.click(screen.getByTestId('run-cancel'));
    await user.click(screen.getByTestId('run-cancel-yes'));
    await waitFor(() => expect(client.api.cancelRun).toHaveBeenCalledTimes(1));
    expect(client.api.cancelRun).toHaveBeenCalledWith('run-9');
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    // The confirm closes; the header offers the control again until the
    // refreshed view arrives as terminal.
    await waitFor(() => expect(screen.queryByTestId('run-cancel-confirm')).toBeNull());
    expect(screen.queryByTestId('run-cancel-error')).toBeNull();
  });

  it('a refused cancel stays on screen with the daemon’s words — never silent', async () => {
    vi.mocked(client.api.cancelRun).mockRejectedValue(new Error('run is already terminal'));
    const user = userEvent.setup();
    const { onRefresh } = renderPanel(liveView('executing'));
    await user.click(screen.getByTestId('run-cancel'));
    await user.click(screen.getByTestId('run-cancel-yes'));
    const err = await screen.findByTestId('run-cancel-error');
    expect(err).toHaveTextContent('run is already terminal');
    expect(screen.getByTestId('run-cancel-confirm')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it.each(['completed', 'cancelled', 'failed'])('a %s run offers no cancel — nothing actionable', (status) => {
    renderPanel(makeView({ id: 'run-9', status: status as never }, [
      makeUnit({ id: 'run-9:triage', session_id: 'run-9', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
    ]));
    expect(screen.getByTestId('run-header')).toBeInTheDocument();
    expect(screen.queryByTestId('run-cancel')).toBeNull();
    expect(screen.queryByTestId('run-cancel-confirm')).toBeNull();
  });
});
