import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

describe('ChatPanel unit outputs in the main panel (crew#272)', () => {
  it('auto-renders each completed unit output as a primary block, in ord order', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockImplementation(
      async (_id: string, unitKey: string) => ({ output: `output of ${unitKey}` }),
    );
    render(
      <ChatPanel
        view={makeView({ status: 'completed' }, [
          // Deliberately out of ord order — the panel must sort by ord.
          makeUnit({ id: 'run-1:build', ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude' }),
          makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
        ])}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );

    // Outputs load with NO click and render in the main flow (crew#272).
    const first = await screen.findByTestId('unit-output-1');
    const second = await screen.findByTestId('unit-output-2');
    expect(await within(first).findByText('output of survey')).toBeInTheDocument();
    expect(await within(second).findByText('output of build')).toBeInTheDocument();

    // The header carries the phase name + the unit's status.
    expect(first).toHaveTextContent('survey');
    expect(first).toHaveTextContent('done');
    expect(second).toHaveTextContent('build');

    // ord order in the DOM: unit 1's block precedes unit 2's.
    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The output endpoint was addressed by the phase-id unit key.
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 'survey');
    expect(client.api.getUnitOutput).toHaveBeenCalledWith('run-1', 'build');
  });

  it('falls back to the stage as the phase name for a free-text (u<ord>) unit', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'free-text result' });
    render(
      <ChatPanel
        view={makeView({ status: 'completed' }, [
          makeUnit({ id: 'run-1:u0', ord: 0, stage: 'build', status: 'done' }),
        ])}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    const block = await screen.findByTestId('unit-output-0');
    expect(await within(block).findByText('free-text result')).toBeInTheDocument();
    // 'u0' is not a phase name — the stage is the closest thing a free-text unit has.
    expect(block).toHaveTextContent('build');
    expect(block).not.toHaveTextContent('u0');
  });

  it('hides and re-shows the output via the toggle (secondary layer)', async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'collapsible body' });
    render(
      <ChatPanel
        view={makeView({ status: 'completed' }, [
          makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done' }),
        ])}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(await screen.findByText('collapsible body')).toBeInTheDocument();

    await user.click(screen.getByTestId('unit-output-toggle-1'));
    expect(screen.queryByText('collapsible body')).not.toBeInTheDocument();
    // The header (phase name + status) stays even while the body is collapsed.
    expect(screen.getByTestId('unit-output-1')).toHaveTextContent('survey');

    await user.click(screen.getByTestId('unit-output-toggle-1'));
    expect(await screen.findByText('collapsible body')).toBeInTheDocument();
  });

  it('renders the daemon-stated reason when a done unit has no stored output', async () => {
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({
      output: null,
      outputUnavailable: 'Unit 1 is recorded as done (approved) but the transcript read returned nothing.',
    });
    render(
      <ChatPanel
        view={makeView({ status: 'completed' }, [
          makeUnit({ id: 'run-1:survey', ord: 1, stage: 'recon', status: 'done' }),
        ])}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/recorded as done \(approved\) but the transcript read returned nothing/),
    ).toBeInTheDocument();
  });
});
