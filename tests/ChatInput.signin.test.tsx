import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { RosterSeat } from '../src/api/types.js';

function seat(overrides: Partial<RosterSeat> & { key: string }): RosterSeat {
  return {
    display_name: overrides.key,
    binary: overrides.key,
    enabled_for_council: true,
    ...overrides,
  };
}

// This jsdom setup exposes no localStorage (ChatInput guards reads with try/catch);
// stub one so the stored-default-selection path is exercisable.
function stubLocalStorage(): void {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  stubLocalStorage(); // empty store → default selection = enabled_for_council seats
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ChatInput seat sign-in warning (launch check)', () => {
  it('warns when a SELECTED seat has signed_in === false, naming only that seat', async () => {
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: true }),
        seat({ key: 'codex', signed_in: false }),
        seat({ key: 'antigravity' }), // absent → no warning contribution
        seat({ key: 'cursor', enabled_for_council: false, signed_in: false }), // not selected
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const warning = await screen.findByTestId('signin-warning');
    expect(warning).toHaveTextContent(
      "⚠ codex isn't signed in — runs routed there will fall back or fail. Sign in in Settings.",
    );
    expect(warning).not.toHaveTextContent('cursor');
    expect(warning).not.toHaveTextContent('antigravity');
    expect(warning).not.toHaveTextContent('claude');
  });

  it('navigates to Settings (/system) from the warning', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [seat({ key: 'codex', signed_in: false })],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} navigate={navigate} />);

    await screen.findByTestId('signin-warning');
    await user.click(screen.getByRole('button', { name: 'Open Settings' }));
    expect(navigate).toHaveBeenCalledWith('/system');
  });

  it('does NOT block the launch — Send stays available with the warning up', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [seat({ key: 'codex', signed_in: false })],
    });
    const launch = vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-1' });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await screen.findByTestId('signin-warning');

    await user.type(screen.getByTestId('launch-problem'), 'build the thing');
    const send = screen.getByTestId('launch-submit');
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
  });

  it('null / absent signed_in produces no warning', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: null }),
        seat({ key: 'antigravity' }),
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    // Prove the roster actually landed (seats visible in the popover) before
    // asserting the negative — otherwise "no warning yet" would pass vacuously.
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    await screen.findByTestId('launch-seat-claude');
    expect(screen.queryByTestId('signin-warning')).toBeNull();
  });

  it('a signed-out seat that is DESELECTED does not warn (stored default selection)', async () => {
    const user = userEvent.setup();
    localStorage.setItem('wicked_default_clis', JSON.stringify(['claude']));
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: true }),
        seat({ key: 'codex', signed_in: false }),
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    await screen.findByTestId('launch-seat-codex');
    expect(screen.queryByTestId('signin-warning')).toBeNull();

    // Selecting it flips the warning on — the check is selection-scoped, live.
    await user.click(screen.getByTestId('launch-seat-codex'));
    expect(await screen.findByTestId('signin-warning')).toHaveTextContent("codex isn't signed in");
  });

  it('marks the signed-out seat in the launch popover', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.getRoster).mockResolvedValue({
      roster: [
        seat({ key: 'claude', signed_in: true }),
        seat({ key: 'codex', signed_in: false }),
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await screen.findByTestId('signin-warning');

    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(await screen.findByTestId('seat-signin-codex')).toHaveTextContent('sign in needed');
    expect(screen.queryByTestId('seat-signin-claude')).toBeNull();
  });
});
