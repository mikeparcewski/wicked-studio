import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';
import { useViewPrefsStore } from '../src/store/viewPrefs.js';

/**
 * CLI SIGN-IN IS OBVIOUS (DES-STUDIO-REBUILD-001 Amendment 5, decision 5). Wherever a helper is
 * signed out, "Sign in" opens one plain-words panel: which CLI, the ONE command to run in a terminal
 * (the roster's `login_invocation` — the daemon's own line, carrying the worker home it runs the
 * seat from; never guessed), a Copy button, and "I've signed in — check again" that re-reads the
 * seat. Studio never performs the login itself. A seat whose line the daemon did not send gets an
 * honest sentence, not an invented command.
 */

const LINE = 'CODEX_HOME="/Users/reel-operator/.wicked-worker/codex" codex login';
const OUT: RosterSeat = { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, signed_in: false, auth: 'signed_out', login_invocation: LINE, health: { status: 'active', since: '2026-10-04T00:00:00Z' } } as RosterSeat;
const IN: RosterSeat = { ...OUT, signed_in: true, auth: 'signed_in' } as RosterSeat;

let rosterAnswer: RosterSeat[] = [OUT];
const getRoster = vi.fn(() => Promise.resolve({ roster: rosterAnswer }));
vi.mock('../src/api/client.js', () => ({
  api: { getRoster: () => getRoster() },
  apiFetch: () => Promise.resolve({}),
}));

const { SignInPanel, signInWords } = await import('../src/components/SignInPanel.js');
const { clearCachedRoster, getCachedRoster } = await import('../src/store/rosterCache.js');

beforeEach(() => {
  rosterAnswer = [OUT];
  clearCachedRoster();
  getRoster.mockClear();
  useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: false } }));
  Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } });
});
afterEach(cleanup);

describe('the panel', () => {
  it('names the CLI, shows the one command (home as ~ in the default layer), offers Copy of the line as given', () => {
    render(<SignInPanel seat={OUT} onClose={() => {}} />);
    const panel = screen.getByTestId('signin-panel');
    expect(panel).toHaveAttribute('data-seat', 'codex');
    expect(screen.getByRole('dialog')).toHaveTextContent('Sign in — Codex');
    expect(screen.getByTestId('signin-line')).toHaveTextContent('CODEX_HOME="~/.wicked-worker/codex" codex login');
    expect(panel.textContent).not.toContain('/Users/reel-operator');
    // Plain words: what to do, where, and that studio will not do it.
    expect(panel.textContent).toMatch(/terminal/i);
    expect(panel.textContent).toMatch(/Studio (can’t|can't|cannot|never) sign in for you/i);
    const copy = screen.getByTestId('copy-command');
    // The clipboard gets the raw line; the button's name and tooltip never print the home directory.
    expect(copy).toHaveAttribute('aria-label', 'copy the sign-in command for Codex');
    expect(copy.getAttribute('title') ?? '').not.toContain('/Users/reel-operator');
    expect(copy).toHaveAttribute('data-command', LINE);
    fireEvent.click(copy);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(LINE);
    // Never a terminal that runs it.
    expect(screen.queryByTestId('agent-terminal')).toBeNull();
  });

  it('with technical details on, the full line shows', () => {
    useViewPrefsStore.setState((s) => ({ prefs: { ...s.prefs, technical_details: true } }));
    render(<SignInPanel seat={OUT} onClose={() => {}} />);
    expect(screen.getByTestId('signin-line')).toHaveTextContent(LINE);
  });

  it('"I’ve signed in — check again" re-reads the roster; still out says so; back in says so, deposits the roster and reports it', async () => {
    const onChecked = vi.fn();
    render(<SignInPanel seat={OUT} onClose={() => {}} onChecked={onChecked} />);
    fireEvent.click(screen.getByTestId('signin-check'));
    await waitFor(() => expect(screen.getByTestId('signin-result')).toHaveAttribute('data-state', 'signed-out'));
    expect(screen.getByTestId('signin-result').textContent).toMatch(/still signed out/i);
    expect(getRoster).toHaveBeenCalledTimes(1);
    expect(onChecked).toHaveBeenCalledWith(rosterAnswer, false);

    rosterAnswer = [IN];
    fireEvent.click(screen.getByTestId('signin-check'));
    await waitFor(() => expect(screen.getByTestId('signin-result')).toHaveAttribute('data-state', 'signed-in'));
    expect(screen.getByTestId('signin-result').textContent).toMatch(/signed in/i);
    expect(getCachedRoster()).toBe(rosterAnswer);
    expect(onChecked).toHaveBeenLastCalledWith(rosterAnswer, true);
  });

  it('a read that fails says so and keeps the command on screen', async () => {
    getRoster.mockImplementationOnce(() => Promise.reject(new Error('daemon away')));
    render(<SignInPanel seat={OUT} onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('signin-check'));
    await waitFor(() => expect(screen.getByTestId('signin-result')).toHaveAttribute('data-state', 'failed'));
    expect(screen.getByTestId('signin-result').textContent).toContain('daemon away');
    expect(screen.getByTestId('signin-line')).toBeInTheDocument();
  });

  it('a seat the daemon sent no line for: an honest sentence, no command, no Copy', () => {
    const noLine = { ...OUT, login_invocation: undefined } as unknown as RosterSeat;
    render(<SignInPanel seat={noLine} onClose={() => {}} />);
    expect(screen.queryByTestId('signin-line')).toBeNull();
    expect(screen.queryByTestId('copy-command')).toBeNull();
    expect(screen.getByTestId('signin-panel').textContent).toMatch(/didn’t say how|did not say how/i);
    expect(screen.getByTestId('signin-check')).toBeInTheDocument();
  });

  it('signInWords: the sentence for a seat, by its CLI', () => {
    expect(signInWords(OUT).cli).toBe('Codex');
    expect(signInWords(OUT).line).toBe(LINE);
    expect(signInWords({ ...OUT, display_name: '' } as RosterSeat).cli).toBe('codex');
    expect(signInWords({ ...OUT, login_invocation: '' } as RosterSeat).line).toBeNull();
  });
});
