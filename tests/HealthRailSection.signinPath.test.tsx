import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useConnectionStore } from '../src/store/connection.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';

/**
 * studio#467: the sign-in panel printed the worker home's absolute path. The line reads `~/…` in the
 * default layer; what Copy carries is the line as the daemon gave it (Amendment 5: studio shows the
 * command, the operator runs it — no terminal here).
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

const { HealthRailSection } = await import('../src/components/HealthRailSection.js');

const openSignIn = async (): Promise<void> => {
  render(<HealthRailSection open onToggle={() => undefined} />);
  const moves = await screen.findAllByTestId('rail-seat-move');
  fireEvent.click(within(moves.find((m) => m.getAttribute('data-seat') === 'pi')!).getByTestId('rail-seat-move-button'));
  await screen.findByTestId('signin-line');
};

beforeEach(() => {
  useConnectionStore.setState({ status: 'connected' });
  useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
});
afterEach(() => cleanup());

describe('the sign-in panel never prints the home directory in the default layer', () => {
  it('the line reads ~/…; Copy carries the line as given (Amendment 5: the panel shows, the operator runs)', async () => {
    await openSignIn();
    expect(screen.getByTestId('signin-line')).toHaveTextContent('PI_CONFIG_DIR="~/.wicked-worker/pi" pi login');
    expect(screen.getByRole('dialog').textContent).not.toContain('/Users/reel-operator');
    expect(screen.getByTestId('copy-command')).toHaveAttribute('aria-label', 'copy the sign-in command for Pi');
    expect(screen.getByTestId('copy-command').getAttribute('title') ?? '').not.toContain('/Users/reel-operator');
    expect(screen.getByTestId('copy-command')).toHaveAttribute('data-command', LINE);
  });

  it('with technical details on, the full path shows', async () => {
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
    await openSignIn();
    expect(screen.getByTestId('signin-line')).toHaveTextContent(LINE);
  });
});
