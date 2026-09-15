// System-page seat cards, the two UX changes (studio seat-card UX):
//   #1 a `not_required` seat (opencode) OFFERS its provider login like the others,
//      and its free-tier note moves to a small line BELOW the row.
//   #2 a "Log out" action DERIVED from the seat's own `login_invocation` (the roster
//      carries no logout field), run in the same PTY terminal as sign-in — no daemon
//      logout route exists (F-E2E-040), so this is symmetric command-in-terminal.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import type { RosterSeat } from '../src/api/types.js';

vi.mock('../src/components/Terminal.js', () => ({
  Terminal: (props: { cwd: string; cmd?: string[]; initialInput?: string }) => (
    <div
      data-testid="mock-terminal"
      data-cmd={props.cmd === undefined ? '' : props.cmd.join(' ')}
      data-initial-input={props.initialInput ?? ''}
    />
  ),
}));

function seat(overrides: Partial<RosterSeat> & Record<string, unknown> & { key: string }): RosterSeat {
  return { display_name: overrides.key, binary: overrides.key, enabled_for_council: true, ...overrides } as RosterSeat;
}

const ROSTER: RosterSeat[] = [
  // opencode: free tier, no account needed, but HAS a provider-login flow.
  seat({
    key: 'opencode',
    display_name: 'OpenCode',
    login_invocation: 'XDG_CONFIG_HOME=/w/opencode opencode auth login',
    auth: 'not_required',
    free_tier: 'OpenCode Zen free models (no account needed)',
  }),
  // signed in with an env-prefixed login flow → Log out (derived), no Sign in.
  seat({ key: 'codex', display_name: 'Codex', login_invocation: 'CODEX_HOME=/w/codex codex login', auth: 'signed_in' }),
  // signed out → Sign in only; nothing to log out of.
  seat({ key: 'agy', display_name: 'Antigravity', login_invocation: 'agy login', auth: 'signed_out' }),
  // login flow with no recognizable trailing `login` verb → no derivable logout.
  seat({ key: 'weird', display_name: 'Weird', login_invocation: 'weird auth', auth: 'signed_in' }),
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

  it('Sign in for opencode runs its login_invocation in the PTY terminal', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('OpenCode');

    await user.click(screen.getByRole('button', { name: 'Sign in OpenCode' }));
    expect(screen.getByRole('dialog', { name: 'Sign in — OpenCode' })).toBeInTheDocument();
    const term = screen.getByTestId('mock-terminal');
    expect(term).toHaveAttribute('data-cmd', '');
    expect(term).toHaveAttribute('data-initial-input', 'XDG_CONFIG_HOME=/w/opencode opencode auth login\n');
  });
});

describe('System — seat cards: #2 Log out (derived, command-in-terminal)', () => {
  it('offers Log out for a signed-in seat and for opencode, but not for a signed-out seat', async () => {
    render(<SystemSettings />);
    await screen.findByText('Codex');

    expect(screen.getByRole('button', { name: 'Log out Codex' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out OpenCode' })).toBeInTheDocument();
    // signed out → Sign in, nothing to log out of.
    expect(screen.queryByRole('button', { name: 'Log out Antigravity' })).toBeNull();
    // signed in but a signed-in seat gets no Sign in.
    expect(screen.queryByRole('button', { name: 'Sign in Codex' })).toBeNull();
  });

  it('does not offer Log out when the login line has no derivable logout verb', async () => {
    render(<SystemSettings />);
    await screen.findByText('Weird');
    expect(screen.queryByRole('button', { name: 'Log out Weird' })).toBeNull();
  });

  it('Log out runs the seat logout DERIVED from login_invocation (login → logout) in a terminal', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('Codex');

    await user.click(screen.getByRole('button', { name: 'Log out Codex' }));
    expect(screen.getByRole('dialog', { name: 'Log out — Codex' })).toBeInTheDocument();
    const term = screen.getByTestId('mock-terminal');
    expect(term).toHaveAttribute('data-cmd', '');
    // env prefix preserved, only the trailing `login` verb swapped.
    expect(term).toHaveAttribute('data-initial-input', 'CODEX_HOME=/w/codex codex logout\n');
  });

  it('Log out for opencode swaps `auth login` → `auth logout`, keeping the env prefix', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('OpenCode');

    await user.click(screen.getByRole('button', { name: 'Log out OpenCode' }));
    const term = screen.getByTestId('mock-terminal');
    expect(term).toHaveAttribute('data-initial-input', 'XDG_CONFIG_HOME=/w/opencode opencode auth logout\n');
  });
});
