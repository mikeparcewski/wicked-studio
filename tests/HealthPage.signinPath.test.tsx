import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useConnectionStore } from '../src/store/connection.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';

/**
 * studio#467: the sign-in panel printed the worker home's absolute path. In the agent modal
 * (DES-seats-page §4.2) the command reads `$HOME/…` — it expands inside the command's double quotes,
 * `~` would not — and what Copy carries is the line as the daemon gave it (studio shows the command,
 * the operator runs it — no terminal here).
 */
const LINE = 'PI_CONFIG_DIR="/Users/reel-operator/.wicked-worker/pi" pi login';

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.7.0', ping: 'pong' }),
    getRoster: () => Promise.resolve({ roster: ROSTER.map((s) => (s.key === 'pi' ? { ...s, login_invocation: LINE } : s)) }),
    getSeatRecord: () => Promise.resolve(WEEK),
    upsertConformanceRule: () => Promise.resolve({ status: 'ok' }),
  },
  apiFetch: () => Promise.resolve({}),
}));

// The old /health page's cards now live in Nerve Center's panels (DES-SYSTEM-VIEW); these suites pin them there.
const { NerveCenterPage: HealthPage } = await import('../src/components/nerve/NerveCenterPage.js');
const { resetSystemStore } = await import('../src/store/systemSnapshot.js');

const openSignIn = async (): Promise<void> => {
  render(<HealthPage />);
  const moves = await screen.findAllByTestId('rail-seat-move');
  fireEvent.click(within(moves.find((m) => m.getAttribute('data-seat') === 'pi')!).getByTestId('rail-seat-move-button'));
  await screen.findByTestId('agents-command');
};
const shown = (): string => (screen.getByTestId('agents-command').textContent ?? '');

beforeEach(() => {
  resetSystemStore();
  useConnectionStore.setState({ status: 'connected' });
  useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
});
afterEach(() => cleanup());

describe('the agent modal never prints the home directory in the default layer', () => {
  it('the command reads $HOME/…; Copy carries the line as given', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await openSignIn();
    expect(shown()).toBe('PI_CONFIG_DIR="$HOME/.wicked-worker/pi" pi login');
    expect(screen.getByRole('dialog').textContent).not.toContain('/Users/reel-operator');
    const copy = screen.getAllByTestId('agents-copy')[0]!;
    expect(copy).toHaveAttribute('aria-label', 'Copy the sign-in command');
    expect(copy.outerHTML).not.toContain('/Users/reel-operator');
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(LINE);
  });

  it('with technical details on, the command still reads $HOME (a command to retype, not a path to read)', async () => {
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
    await openSignIn();
    expect(shown()).toBe('PI_CONFIG_DIR="$HOME/.wicked-worker/pi" pi login');
  });
});
