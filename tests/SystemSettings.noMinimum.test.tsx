import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';

// J6 S5: a domain model has no share to reach, so Settings has no requirements minimum. crew (J6 M1) drops
// `requirementsGraph` from what it reads and stores; a crew from before M1 may still answer with one.

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

const OLDER_CREW = { graphNodeLimit: 150, requirementsGraph: { minCoveragePct: 65 } };

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: OLDER_CREW } as never);
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
});

describe('SystemSettings: no requirements minimum (J6 S5)', () => {
  it('shows no minimum field or words, even when an older crew still answers with one', async () => {
    render(<SystemSettings />);
    await screen.findByLabelText('Graph node limit');
    expect(screen.queryByTestId('settings-min-coverage')).not.toBeInTheDocument();
    expect(screen.queryByText(/minimum coverage/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/65%|requirements graph minimum/i);
  });

  it('a save sends only what was changed: never requirementsGraph', async () => {
    const user = userEvent.setup();
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 200 } } as never);
    render(<SystemSettings />);
    const field = await screen.findByLabelText('Graph node limit');
    fireEvent.change(field, { target: { value: '200' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    expect(updated).toHaveBeenCalledWith({ graphNodeLimit: 200 });
  });
});
