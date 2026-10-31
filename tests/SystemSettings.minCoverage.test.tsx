import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';

// Operator ruling 2026-10-31: "Requirements graph minimum coverage: 80%", adjustable in Settings
// (crew `requirementsGraph.minCoveragePct`, api-types 0.156.0).

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
});

describe('SystemSettings — requirements graph minimum coverage', () => {
  it('shows 80% when the daemon has none set', async () => {
    render(<SystemSettings />);
    const field = await screen.findByTestId('settings-min-coverage');
    expect(field).toHaveAccessibleName('Requirements graph minimum coverage');
    expect(field).toHaveValue(80);
    expect(screen.getByText('Requirements graph minimum coverage')).toBeInTheDocument();
  });

  it('shows the saved value', async () => {
    const settings = { graphNodeLimit: 150, requirementsGraph: { minCoveragePct: 65 } };
    vi.mocked(client.api.getSettings).mockResolvedValue({ settings } as never);
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('settings-min-coverage')).toHaveValue(65));
  });

  it('a change is saved as requirementsGraph.minCoveragePct; out of range cannot be saved', async () => {
    const user = userEvent.setup();
    const saved = { graphNodeLimit: 150, requirementsGraph: { minCoveragePct: 90 } };
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: saved } as never);
    render(<SystemSettings />);
    const field = await screen.findByTestId('settings-min-coverage');
    await user.clear(field);
    await user.type(field, '150');
    expect(screen.getByTestId('settings-min-coverage-invalid')).toHaveTextContent('A whole percentage from 1 to 100.');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(field);
    await user.type(field, '90');
    expect(screen.queryByTestId('settings-min-coverage-invalid')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ requirementsGraph: { minCoveragePct: 90 } }));
    expect(screen.queryByTestId('settings-min-coverage-unsupported')).not.toBeInTheDocument();
  });

  it('a daemon from before the setting says so at the field instead of pretending it saved', async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'updateSettings').mockResolvedValue({
      settings: { graphNodeLimit: 150 },
      ignored: ['requirementsGraph'],
    } as never);
    render(<SystemSettings />);
    const field = await screen.findByTestId('settings-min-coverage');
    await user.clear(field);
    await user.type(field, '70');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByTestId('settings-min-coverage-unsupported')).toHaveTextContent(
      'doesn’t have this setting yet, so the minimum stays 80%',
    );
    expect(field).toHaveValue(80);
  });
});
