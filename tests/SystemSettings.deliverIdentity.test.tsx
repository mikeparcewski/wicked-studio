// crew#549 — the deliver identity on the System page.
//
// The deliver phase pushed under whatever credential the daemon resolved at push time; the only
// pin was an env var nothing in the product showed or checked against the credential git uses.
// The setting is a LOGIN (never a token — the daemon serves the login and no secret), the field
// mirrors the daemon's rule client-side because a bad login refuses EVERY delivery, and the
// daemon's own 400 lands at the field rather than in the page banner.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
});

describe('SystemSettings — deliver identity', () => {
  it('renders the persisted login, and says "not pinned" when there is none', async () => {
    vi.mocked(client.api.getSettings).mockResolvedValue({
      settings: { graphNodeLimit: 150, deliverIdentityLogin: 'release-bot' } as never,
    });
    render(<SystemSettings />);
    const input = await screen.findByLabelText('Deliver identity (GitHub login)');
    await waitFor(() => expect(input).toHaveValue('release-bot'));
    expect(input).toHaveAttribute('placeholder', 'not pinned');
  });

  it('saves through PUT /settings', async () => {
    const user = userEvent.setup();
    const updated = vi
      .spyOn(client.api, 'updateSettings')
      .mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
    render(<SystemSettings />);

    const input = await screen.findByLabelText('Deliver identity (GitHub login)');
    await user.type(input, 'release-bot');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updated).toHaveBeenCalledWith({ deliverIdentityLogin: 'release-bot' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('mirrors the daemon rule: anything that is not a login shows the inline hint', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    const input = await screen.findByLabelText('Deliver identity (GitHub login)');

    await user.type(input, 'release bot');
    expect(screen.getByTestId('deliver-identity-invalid')).toHaveTextContent(
      'Must be empty or a GitHub login',
    );
    // Empty is valid — it means "not pinned", which the description spells out.
    await user.clear(input);
    expect(screen.queryByTestId('deliver-identity-invalid')).toBeNull();
    // A plain login is accepted.
    await user.type(input, 'release-bot');
    expect(screen.queryByTestId('deliver-identity-invalid')).toBeNull();
  });

  it("shows the daemon's 400 inline at the field, not in the page banner", async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'updateSettings').mockRejectedValue(
      new Error('API 400: deliverIdentityLogin must be a GitHub login'),
    );
    render(<SystemSettings />);
    const input = await screen.findByLabelText('Deliver identity (GitHub login)');
    await user.type(input, 'nope');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const inline = await screen.findByTestId('deliver-identity-error');
    expect(inline).toHaveTextContent('API 400: deliverIdentityLogin must be a GitHub login');
  });

  it('the description says what it checks, and that it is never a token', async () => {
    render(<SystemSettings />);
    await screen.findByLabelText('Deliver identity (GitHub login)');
    const text = document.body.textContent ?? '';
    expect(text).toContain("the credential git would use for the remote's host");
    expect(text).toContain('A login, never a token');
  });
});
