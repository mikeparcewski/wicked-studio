import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import type { RosterSeat } from '../src/api/types.js';

// The real Terminal drags in xterm.js (no jsdom renderer) and opens a PTY on
// mount; the seats section only needs to prove the terminal is MOUNTED with the
// right stdin payload, so stub it and inspect its props.
vi.mock('../src/components/Terminal.js', () => ({
  Terminal: (props: { cwd: string; cmd?: string[]; initialInput?: string }) => (
    <div
      data-testid="mock-terminal"
      data-cwd={props.cwd}
      data-cmd={props.cmd === undefined ? '' : props.cmd.join(' ')}
      data-initial-input={props.initialInput ?? ''}
    />
  ),
}));

function seat(overrides: Partial<RosterSeat> & { key: string }): RosterSeat {
  return {
    display_name: overrides.key,
    binary: overrides.key,
    enabled_for_council: true,
    ...overrides,
  };
}

const ROSTER: RosterSeat[] = [
  // Signed in, has a login flow → status ✓, NO sign-in button.
  seat({ key: 'claude', display_name: 'Claude Code', login_invocation: 'claude login', signed_in: true }),
  // Not signed in, has a login flow → red status + sign-in button.
  seat({ key: 'codex', display_name: 'Codex', login_invocation: 'codex auth login', signed_in: false }),
  // Unknowable (null) but has a login flow → neutral (no status), button offered.
  seat({ key: 'antigravity', display_name: 'Antigravity', login_invocation: 'antigravity login', signed_in: null }),
  // Not signed in but no known login flow → status only, no button.
  seat({ key: 'cursor', display_name: 'Cursor', signed_in: false }),
  // Field absent entirely (older daemon) → nothing.
  seat({ key: 'localonly', display_name: 'Local' }),
];

// This jsdom setup exposes no localStorage (components guard reads with try/catch);
// stub one so the default-CLI selection path behaves deterministically.
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

describe('SystemSettings — CLI seats & sign-in', () => {
  it('renders per-seat sign-in status: ✓ for true, "sign in needed" for false, nothing for null/absent', async () => {
    render(<SystemSettings />);
    await screen.findByText('Claude Code');

    expect(screen.getByTestId('seat-signin-claude')).toHaveTextContent('✓ signed in');
    expect(screen.getByTestId('seat-signin-codex')).toHaveTextContent('sign in needed');
    expect(screen.getByTestId('seat-signin-cursor')).toHaveTextContent('sign in needed');
    // null and absent produce NO marker at all.
    expect(screen.queryByTestId('seat-signin-antigravity')).toBeNull();
    expect(screen.queryByTestId('seat-signin-localonly')).toBeNull();
  });

  it('offers Sign in only when the seat has a login_invocation AND signed_in !== true', async () => {
    render(<SystemSettings />);
    await screen.findByText('Claude Code');

    // signed_in: false + invocation → button.
    expect(screen.getByRole('button', { name: 'Sign in Codex' })).toBeInTheDocument();
    // signed_in: null + invocation → button (state unknowable, let the operator re-auth).
    expect(screen.getByRole('button', { name: 'Sign in Antigravity' })).toBeInTheDocument();
    // signed_in: true → no button even with an invocation.
    expect(screen.queryByRole('button', { name: 'Sign in Claude Code' })).toBeNull();
    // No invocation → no button even when not signed in.
    expect(screen.queryByRole('button', { name: 'Sign in Cursor' })).toBeNull();
  });

  it('Sign in opens a terminal modal with NO cmd and the login line + newline as initial stdin', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('Claude Code');

    await user.click(screen.getByRole('button', { name: 'Sign in Codex' }));

    // Modal with the seat's name; terminal mounted inside it.
    expect(screen.getByRole('dialog', { name: 'Sign in — Codex' })).toBeInTheDocument();
    const term = screen.getByTestId('mock-terminal');
    // CONTRACT: login_invocation is a SHELL LINE — interactive login shell (no cmd),
    // the line + "\n" written into the PTY's stdin stream.
    expect(term).toHaveAttribute('data-cmd', '');
    expect(term).toHaveAttribute('data-initial-input', 'codex auth login\n');
  });

  it('the modal close button dismisses the sign-in terminal', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('Claude Code');

    await user.click(screen.getByRole('button', { name: 'Sign in Codex' }));
    expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('mock-terminal')).toBeNull());
  });

  it('clicking Sign in does not toggle the seat default-CLI checkbox', async () => {
    const user = userEvent.setup();
    render(<SystemSettings />);
    await screen.findByText('Claude Code');

    const row = screen.getByText('Codex').closest('div');
    const checkbox = row?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    const before = checkbox.checked;

    await user.click(screen.getByRole('button', { name: 'Sign in Codex' }));
    expect(checkbox.checked).toBe(before);
  });
});
