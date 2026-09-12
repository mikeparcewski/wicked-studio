// Issue #219 — run header Archive control for terminal runs.
//
// Terminal runs can be archived (written off) from the run header. The control
// asks first, then calls api.archiveRun(id, true), then navigates back and
// refreshes the run index. Errors surface as role="alert"; live runs offer no
// Archive — only terminal ones can be written off.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  useGateStore.setState({ gates: {}, approaching: {} });
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
  vi.spyOn(client.api, 'archiveRun').mockResolvedValue({ runId: 'run-9', archived: true });
});

function terminalView(status: 'completed' | 'cancelled' | 'failed') {
  return makeView({ id: 'run-9', status, unit_ix: 0 }, [
    makeUnit({ id: 'run-9:u0', session_id: 'run-9', ord: 0, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  ]);
}

function renderPanel(view: ReturnType<typeof makeView>) {
  const onRefresh = vi.fn();
  const onNavigateBack = vi.fn();
  render(
    <ChatPanel view={view} onLaunched={vi.fn()} onNavigateBack={onNavigateBack} onRefresh={onRefresh} />,
  );
  return { onRefresh, onNavigateBack };
}

describe('run header Archive (#219)', () => {
  it.each(['completed', 'cancelled', 'failed'] as const)(
    'a %s run renders Archive in the header',
    (status) => {
      renderPanel(terminalView(status));
      const header = screen.getByTestId('run-header');
      const archive = screen.getByTestId('run-archive');
      expect(header.contains(archive)).toBe(true);
      expect(archive).toHaveTextContent('Archive');
      expect(client.api.archiveRun).not.toHaveBeenCalled();
    },
  );

  it('a live run offers no Archive — only terminal runs can be written off', () => {
    renderPanel(makeView({ id: 'run-9', status: 'executing', unit_ix: 0 }, []));
    expect(screen.queryByTestId('run-archive')).toBeNull();
    expect(screen.queryByTestId('run-archive-confirm')).toBeNull();
  });

  it('asks first — Keep closes the confirm and fires nothing', async () => {
    const user = userEvent.setup();
    const { onRefresh } = renderPanel(terminalView('completed'));
    await user.click(screen.getByTestId('run-archive'));
    const confirm = screen.getByTestId('run-archive-confirm');
    expect(confirm).toHaveTextContent(/Archive this run\?/);
    expect(screen.queryByTestId('run-archive')).toBeNull();
    await user.click(screen.getByTestId('run-archive-keep'));
    expect(screen.queryByTestId('run-archive-confirm')).toBeNull();
    expect(screen.getByTestId('run-archive')).toBeInTheDocument();
    expect(client.api.archiveRun).not.toHaveBeenCalled();
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('Escape inside the confirm is Keep', async () => {
    const user = userEvent.setup();
    renderPanel(terminalView('failed'));
    await user.click(screen.getByTestId('run-archive'));
    await user.keyboard('{Escape}');
    expect(screen.queryByTestId('run-archive-confirm')).toBeNull();
    expect(client.api.archiveRun).not.toHaveBeenCalled();
  });

  it('confirming POSTs archive=true, then refreshes and navigates back', async () => {
    const user = userEvent.setup();
    const { onRefresh, onNavigateBack } = renderPanel(terminalView('completed'));
    await user.click(screen.getByTestId('run-archive'));
    await user.click(screen.getByTestId('run-archive-yes'));
    await waitFor(() => expect(client.api.archiveRun).toHaveBeenCalledWith('run-9', true));
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onNavigateBack).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('run-archive-error')).toBeNull();
  });

  it('a refused archive surfaces the error with role=alert and keeps the confirm open', async () => {
    vi.mocked(client.api.archiveRun).mockRejectedValue(new Error('run is not terminal'));
    const user = userEvent.setup();
    const { onRefresh, onNavigateBack } = renderPanel(terminalView('completed'));
    await user.click(screen.getByTestId('run-archive'));
    await user.click(screen.getByTestId('run-archive-yes'));
    const err = await screen.findByTestId('run-archive-error');
    expect(err).toHaveTextContent('run is not terminal');
    expect(err).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('run-archive-confirm')).toBeInTheDocument();
    expect(onRefresh).not.toHaveBeenCalled();
    expect(onNavigateBack).not.toHaveBeenCalled();
  });
});
