import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';

// Terminal drags in xterm.js; this suite never opens it, but SystemSettings
// imports it at module level, so stub it out of the graph.
vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
});

describe('SystemSettings — worker config root', () => {
  it('renders the field with the persisted value and the ~/.wicked-worker placeholder', async () => {
    vi.mocked(client.api.getSettings).mockResolvedValue({
      settings: { graphNodeLimit: 150, worker_config_root: '/srv/workers' },
    });
    render(<SystemSettings />);

    const input = await screen.findByLabelText('Worker config root');
    await waitFor(() => expect(input).toHaveValue('/srv/workers'));
    expect(input).toHaveAttribute('placeholder', '~/.wicked-worker');
  });

  it('saves through PUT /settings alongside the existing settings path', async () => {
    const user = userEvent.setup();
    const updated = vi
      .spyOn(client.api, 'updateSettings')
      .mockResolvedValue({ settings: { graphNodeLimit: 150, worker_config_root: '/abs/workers' } });
    render(<SystemSettings />);

    const input = await screen.findByLabelText('Worker config root');
    await user.type(input, '/abs/workers');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updated).toHaveBeenCalledWith({ worker_config_root: '/abs/workers' }),
    );
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('mirrors the daemon rule client-side: a relative path shows the inline hint', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);

    const input = await screen.findByLabelText('Worker config root');
    await user.type(input, 'relative/path');

    expect(screen.getByTestId('worker-root-invalid')).toHaveTextContent(
      'Must be empty or an absolute path.',
    );

    // Emptying the field clears the mirror hint (empty is valid).
    await user.clear(input);
    expect(screen.queryByTestId('worker-root-invalid')).toBeNull();
  });

  it("shows the daemon's 400 inline at the field, not in the page banner", async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'updateSettings').mockRejectedValue(
      new Error('API 400: worker_config_root must be empty or an absolute path'),
    );
    render(<SystemSettings />);

    const input = await screen.findByLabelText('Worker config root');
    await user.type(input, 'not-absolute');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const inline = await screen.findByTestId('worker-root-error');
    expect(inline).toHaveTextContent('API 400: worker_config_root must be empty or an absolute path');
  });
});
