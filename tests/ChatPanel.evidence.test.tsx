import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function renderRun(status: 'executing' | 'completed' | 'failed'): void {
  render(
    <ChatPanel
      view={makeView({ status }, [makeUnit({ ord: 0, status: 'done', assigned_cli: 'claude' })])}
      onLaunched={vi.fn()}
      onNavigateBack={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
}

describe('ChatPanel evidence export', () => {
  it('downloads the bundle for a finished run', async () => {
    const user = userEvent.setup();
    const download = vi.spyOn(client, 'downloadRunEvidence').mockResolvedValue();
    renderRun('completed');

    const button = screen.getByRole('button', { name: /export evidence/i });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(download).toHaveBeenCalledWith('run-1');
  });

  it('is disabled while the run is still executing', async () => {
    const download = vi.spyOn(client, 'downloadRunEvidence').mockResolvedValue();
    renderRun('executing');

    const button = screen.getByRole('button', { name: /export evidence/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/once the run finishes/i));
    expect(download).not.toHaveBeenCalled();
  });

  it('surfaces a failed export instead of silently doing nothing', async () => {
    const user = userEvent.setup();
    vi.spyOn(client, 'downloadRunEvidence').mockRejectedValue(new Error('API 500: store closed'));
    renderRun('failed');

    await user.click(screen.getByRole('button', { name: /export evidence/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export failed: API 500: store closed');
  });
});
