// System-page seat cards, the two UX changes (studio seat-card UX):
//   #1 a `not_required` seat (opencode) OFFERS its provider login like the others,
//      and its free-tier note moves to a small line BELOW the row.
//   #2 "Log out" calls the daemon's route (crew 0.8.9 `POST /seats/:cli/logout`, crew#615), which
//      runs the engine roster's own `logout_invocation` in a PTY; studio builds no command. Offered
//      when the roster names a logout for a seat with a session to end; a 404 hides it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { RosterSeat } from '../src/api/types.js';

// The mock opens the terminal the way the real one does on mount: through `open` when given.
vi.mock('../src/components/Terminal.js', async () => {
  const { useEffect } = await import('react');
  return {
    Terminal: (props: { cwd: string; cmd?: string[]; initialInput?: string; open?: (c: number, r: number) => Promise<{ id: string }>; onOpenError?: (e: unknown) => void }) => {
      useEffect(() => {
        if (props.open === undefined) return;
        props.open(100, 30).then(
          ({ id }) => document.querySelector('[data-testid="mock-terminal"]')?.setAttribute('data-terminal-id', id),
          (e: unknown) => props.onOpenError?.(e),
        );
      }, []); // eslint-disable-line react-hooks/exhaustive-deps -- opens once, like the real terminal
      return (
        <div
          data-testid="mock-terminal"
          data-cmd={props.cmd === undefined ? '' : props.cmd.join(' ')}
          data-initial-input={props.initialInput ?? ''}
          data-opens-itself={props.open === undefined ? 'false' : 'true'}
        />
      );
    },
  };
});

function seat(overrides: Partial<RosterSeat> & Record<string, unknown> & { key: string }): RosterSeat {
  return { display_name: overrides.key, binary: overrides.key, enabled_for_council: true, ...overrides } as RosterSeat;
}

const ROSTER: RosterSeat[] = [
  // opencode: free tier, no account needed, but HAS a provider-login flow.
  seat({
    key: 'opencode',
    display_name: 'OpenCode',
    login_invocation: 'XDG_CONFIG_HOME=/w/opencode opencode auth login',
    logout_invocation: 'XDG_CONFIG_HOME=/w/opencode opencode auth logout',
    auth: 'not_required',
    free_tier: 'OpenCode Zen free models (no account needed)',
  }),
  // signed in with an env-prefixed login flow → Log out (derived), no Sign in.
  seat({ key: 'codex', display_name: 'Codex', login_invocation: 'CODEX_HOME=/w/codex codex login', logout_invocation: 'CODEX_HOME=/w/codex codex logout', auth: 'signed_in' }),
  // signed out → Sign in only; nothing to log out of.
  seat({ key: 'agy', display_name: 'Antigravity', login_invocation: 'agy login', auth: 'signed_out' }),
  // signed in, but the roster names no logout (copilot, pi, agy document none) → no Log out.
  seat({ key: 'weird', display_name: 'Weird', login_invocation: 'weird auth login', auth: 'signed_in' }),
];

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
  stubLocalStorage();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: ROSTER });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('System — seat cards: #1 opencode login + free-tier note', () => {
  it('offers a provider Sign in for a not_required seat and moves the free tier below the row', async () => {
    render(<SystemSettings />);
    await screen.findByText('OpenCode');

    // The action is offered (previously suppressed for not_required seats).
    expect(screen.getByRole('button', { name: 'Sign in OpenCode' })).toBeInTheDocument();
    // The status word is terse; the free tier is NOT in it.
    expect(screen.getByTestId('seat-signin-opencode')).toHaveTextContent('no sign-in needed');
    expect(screen.getByTestId('seat-signin-opencode')).not.toHaveTextContent('OpenCode Zen');
    // The free tier is its own small line below.
    expect(screen.getByTestId('seat-freetier-opencode')).toHaveTextContent('OpenCode Zen free models (no account needed)');
  });

  it('Sign in for opencode opens the plain-words panel with its login_invocation (Amendment 5) — no terminal', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('OpenCode');

    await user.click(screen.getByRole('button', { name: 'Sign in OpenCode' }));
    expect(screen.getByRole('dialog', { name: 'Sign in — OpenCode' })).toBeInTheDocument();
    expect(screen.getByTestId('signin-line')).toHaveTextContent('XDG_CONFIG_HOME=/w/opencode opencode auth login');
    expect(screen.getByTestId('copy-command')).toHaveAttribute('data-command', 'XDG_CONFIG_HOME=/w/opencode opencode auth login');
    expect(screen.getByTestId('signin-check')).toBeInTheDocument();
    expect(screen.queryByTestId('mock-terminal')).toBeNull();
  });
});

describe('System — seat cards: #2 Log out through the daemon route (crew#615)', () => {
  it('offers Log out for a signed-in seat and for opencode, but not for a signed-out seat', async () => {
    render(<SystemSettings />);
    await screen.findByText('Codex');

    expect(screen.getByRole('button', { name: 'Log out Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out OpenCode' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Log out Antigravity' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign in Codex' })).toBeNull();
  });

  it('does not offer Log out when the roster names no logout for the seat', async () => {
    render(<SystemSettings />);
    await screen.findByText('Weird');
    expect(screen.queryByRole('button', { name: 'Log out Weird' })).toBeNull();
  });

  it('Log out calls POST /seats/:cli/logout and drives the terminal it answers — nothing typed by studio', async () => {
    const logout = vi.spyOn(client.api, 'seatLogout').mockResolvedValue({ terminalId: 't-42', cli: 'codex', action: 'logout' });
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('Codex');

    await user.click(screen.getByRole('button', { name: 'Log out Codex' }));
    expect(screen.getByRole('dialog', { name: 'Log out — Codex' })).toBeInTheDocument();
    const term = screen.getByTestId('mock-terminal');
    expect(term).toHaveAttribute('data-opens-itself', 'true');
    expect(term).toHaveAttribute('data-initial-input', '');
    await waitFor(() => expect(term).toHaveAttribute('data-terminal-id', 't-42'));
    expect(logout).toHaveBeenCalledExactlyOnceWith('codex', { cols: 100, rows: 30 });
    expect(screen.getByTestId('seat-logout-line')).toHaveTextContent('CODEX_HOME=/w/codex codex logout');
  });

  it('a 404 (no logout for that seat) closes the panel and hides the button', async () => {
    vi.spyOn(client.api, 'seatLogout').mockRejectedValue(new ApiError(404, 'no logout for seat opencode'));
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('OpenCode');

    await user.click(screen.getByRole('button', { name: 'Log out OpenCode' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Log out — OpenCode' })).toBeNull());
    expect(screen.queryByRole('button', { name: 'Log out OpenCode' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log out Codex' })).toBeInTheDocument();
  });
});
