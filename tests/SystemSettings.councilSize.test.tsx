import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

describe('SystemSettings — council size', () => {
  it('selects 3 when the daemon has no councilSize', async () => {
    render(<SystemSettings />);

    const group = await screen.findByTestId('settings-council-size');
    expect(group).toHaveAccessibleName('Council size');
    expect(within(group).getByRole('radio', { name: '3' })).toHaveAttribute('aria-checked', 'true');
    expect(within(group).getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByText('How many helpers review each decision; they are picked at random.')).toBeInTheDocument();
  });

  it.each([2, 7, 9])('shows the saved councilSize %i, including values outside 1..5', async (councilSize) => {
    const settings = { graphNodeLimit: 150, councilSize };
    vi.mocked(client.api.getSettings).mockResolvedValue({ settings });
    render(<SystemSettings />);

    const group = await screen.findByTestId('settings-council-size');
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: String(councilSize) })).toHaveAttribute('aria-checked', 'true'),
    );
    expect(within(group).getAllByRole('radio')).toHaveLength(councilSize > 5 ? 6 : 5);
    expect(within(group).getAllByRole('radio', { checked: true })).toHaveLength(1);
  });

  it('clicking 5 then Save sends the numeric councilSize through the settings write', async () => {
    const user = userEvent.setup();
    // api-types 0.109.0 carries councilSize; the pinned contract does not yet, so the saved body is
    // a variable (no excess-property check) rather than a literal.
    const saved = { graphNodeLimit: 150, councilSize: 5 };
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: saved });
    render(<SystemSettings />);

    const group = await screen.findByTestId('settings-council-size');
    await user.click(within(group).getByRole('radio', { name: '5' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updated).toHaveBeenCalledWith({ councilSize: 5 }));
    expect(within(group).getByRole('radio', { name: '5' })).toHaveAttribute('aria-checked', 'true');
  });
});
