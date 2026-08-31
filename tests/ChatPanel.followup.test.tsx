// Usability review 2026-08-31 finding #8 (DES-RUN-NARRATOR §7): the composer
// says what it does, per run state. A TERMINAL run's footer is a labelled
// follow-up bar (collapsed launch form behind one action) — never the bare
// "What do you need built?" form that read as maybe-steering-this-run. Live
// runs keep steer/inject primacy.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  useRunEventStore.setState({ byRun: {} });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'out' });
});

function renderStatus(status: 'completed' | 'failed' | 'executing' | 'awaiting_human', extra: Record<string, unknown> = {}): void {
  render(
    <ChatPanel
      view={makeView({ status, unit_ix: 0, ...extra }, [
        makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: status === 'executing' ? 'distributed' : 'done', assigned_cli: 'claude' }),
      ])}
      onLaunched={vi.fn()}
      onNavigateBack={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

describe('composer labeling per run state (#8)', () => {
  it('a COMPLETED run gets the collapsed follow-up bar — no launch form, no gate chip', () => {
    renderStatus('completed');
    expect(screen.getByTestId('followup-bar')).toHaveTextContent('This run is finished — steering is closed.');
    expect(screen.getByTestId('followup-open')).toHaveTextContent('Start a follow-up run');
    // The ambiguous full composer is GONE from the dead run's footer.
    expect(screen.queryByPlaceholderText('What do you need built?')).not.toBeInTheDocument();
  });

  it('expanding the follow-up reveals the launch form under the explicit label', async () => {
    renderStatus('failed');
    await userEvent.click(screen.getByTestId('followup-open'));
    expect(screen.getByTestId('followup-label')).toHaveTextContent(/Start a follow-up run.*a NEW run, separate from this one/);
    expect(await screen.findByPlaceholderText('What do you need built?')).toBeInTheDocument();
    // And it collapses back.
    await userEvent.click(screen.getByTestId('followup-close'));
    expect(screen.queryByPlaceholderText('What do you need built?')).not.toBeInTheDocument();
    expect(screen.getByTestId('followup-bar')).toBeInTheDocument();
  });

  it('names the project when the dead run is filed in one', () => {
    renderStatus('completed', { project_id: 'proj-9' });
    expect(screen.getByTestId('followup-open')).toHaveTextContent('Start a follow-up run in this project');
  });

  it('an EXECUTING run keeps the inject composer (steering a live run, labelled as such)', () => {
    renderStatus('executing');
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
    expect(screen.getByTestId('steering-live-chip')).toHaveTextContent('steering live run');
    expect(screen.queryByTestId('followup-bar')).not.toBeInTheDocument();
  });

  it('an AWAITING_HUMAN run keeps the steer composer next to the approval dock', () => {
    renderStatus('awaiting_human');
    const steer = screen.getByPlaceholderText(/send steering guidance/i);
    const dock = screen.getByTestId('approval-dock');
    expect(steer).toBeInTheDocument();
    // The dock (the decision) PRECEDES the steer composer (the words) — one glance covers both.
    expect(dock.compareDocumentPosition(steer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByTestId('followup-bar')).not.toBeInTheDocument();
  });
});
