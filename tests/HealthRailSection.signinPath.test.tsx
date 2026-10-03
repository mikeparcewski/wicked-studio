import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useConnectionStore } from '../src/store/connection.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';
import { ROSTER, WEEK } from './fixtures/seatWeek.js';

/**
 * studio#467: the sign-in panel printed the worker home's absolute path twice — in its "Running …"
 * sentence and as the shell's echo of the line. The sentence now reads `~/…` in the default layer,
 * and the terminal is told which home directory to draw as `~`. What RUNS is the line as given.
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
vi.mock('../src/components/Terminal.js', () => ({
  Terminal: ({ initialInput, concealHome }: { initialInput?: string; concealHome?: readonly string[] }) => (
    <pre data-testid="fake-terminal" data-conceal={JSON.stringify(concealHome ?? null)}>{initialInput}</pre>
  ),
}));

const { HealthRailSection } = await import('../src/components/HealthRailSection.js');

const openSignIn = async (): Promise<void> => {
  render(<HealthRailSection open onToggle={() => undefined} />);
  const moves = await screen.findAllByTestId('rail-seat-move');
  fireEvent.click(within(moves.find((m) => m.getAttribute('data-seat') === 'pi')!).getByTestId('rail-seat-move-button'));
  await screen.findByTestId('fake-terminal');
};

beforeEach(() => {
  useConnectionStore.setState({ status: 'connected' });
  useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
});
afterEach(() => cleanup());

describe('the sign-in panel never prints the home directory in the default layer', () => {
  it('the sentence reads ~/…, the terminal runs the line as given and is told what to draw as ~', async () => {
    await openSignIn();
    expect(screen.getByTestId('signin-line')).toHaveTextContent('PI_CONFIG_DIR="~/.wicked-worker/pi" pi login');
    expect(screen.getByRole('dialog').textContent).not.toContain('reel-operator" pi');
    const term = screen.getByTestId('fake-terminal');
    expect(term).toHaveTextContent(LINE);
    expect(term.getAttribute('data-conceal')).toBe('["/Users/reel-operator"]');
  });

  it('with technical details on, the full path shows and nothing is concealed', async () => {
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
    await openSignIn();
    expect(screen.getByTestId('signin-line')).toHaveTextContent(LINE);
    expect(screen.getByTestId('fake-terminal').getAttribute('data-conceal')).toBe('[]');
  });
});
