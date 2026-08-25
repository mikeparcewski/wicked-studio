import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';

/**
 * studio#123 — the Runs section of /system: one row, "Open a PR when a build
 * run finishes", default ON, persisted as `studio.composer` on the crew
 * settings wire (the `studio.notifications` contract). It saves itself, so the
 * page's Save button — which patches the daemon's own tunables — never touches
 * it, and a daemon that silently drops the key (wicked-crew#323) is reported
 * rather than rendered as saved.
 *
 * Fake timers + `act` around the 400ms debounce: the store's persist pattern,
 * tested the way BrandLearn tests the appearance store's.
 */

// Terminal drags in xterm.js; this suite never opens it, but SystemSettings
// imports it at module level, so stub it out of the graph.
vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

/** Let the mount's getSettings/getRoster promises land before asserting. */
async function settleMount(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

/** Flip the toggle and let the debounce + the PUT (+ its read-back) settle. */
async function flipAndSettle(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('deliver-pr-toggle'));
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'putComposerSettings').mockImplementation((prefs) =>
    Promise.resolve({ settings: { graphNodeLimit: 150, 'studio.composer': prefs } }),
  );
  useComposerPrefsStore.setState({
    prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown',
  });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('SystemSettings — Runs (#123)', () => {
  it('renders the Runs section with the toggle ON by default and an honest description', async () => {
    render(<SystemSettings />);
    await settleMount();

    const section = screen.getByTestId('runs-settings');
    expect(section).toHaveTextContent('Runs');
    expect(section).toHaveTextContent('Open a PR when a build run finishes');
    // Honest about what it does: pushes a branch, opens a PR, merge stays human.
    expect(section.textContent).toMatch(/pushes the run's branch/i);
    expect(section.textContent).toMatch(/opens a pull request/i);
    expect(section.textContent).toMatch(/Merging stays human/i);

    // Default ON — the fresh-install state, with nothing ever persisted.
    expect(screen.getByTestId('deliver-pr-toggle')).toBeChecked();
    expect(client.api.putComposerSettings).not.toHaveBeenCalled();
  });

  it('turning it off persists studio.composer with deliverPr: false', async () => {
    render(<SystemSettings />);
    await settleMount();
    await flipAndSettle();

    expect(screen.getByTestId('deliver-pr-toggle')).not.toBeChecked();
    // A stored false is a real false, not an unset key that re-defaults to ON.
    expect(client.api.putComposerSettings).toHaveBeenCalledExactlyOnceWith({ deliverPr: false });
    // The key read back out of the merged response — verified, not assumed.
    expect(useComposerPrefsStore.getState().persist).toBe('ok');
    expect(screen.queryByTestId('deliver-pr-unsaved')).toBeNull();
  });

  it('an unfixed daemon that drops the key (crew#323) says so instead of looking saved', async () => {
    // Pre-#323 PUT /settings: closed allowlist, silent discard, 200 with the
    // blob untouched. The read-back is the only proof, so the row reports it.
    vi.mocked(client.api.putComposerSettings).mockResolvedValue({
      settings: { graphNodeLimit: 150, workerStallMinutes: 10 },
    });
    render(<SystemSettings />);
    await settleMount();
    await flipAndSettle();

    expect(screen.getByTestId('deliver-pr-unsaved')).toHaveTextContent('applies to this session only');
    // The optimistic value still stands for this session — no silent revert,
    // and the write is not retried forever: one PUT answered the question.
    expect(screen.getByTestId('deliver-pr-toggle')).not.toBeChecked();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(client.api.putComposerSettings).toHaveBeenCalledTimes(1);
  });

  it('the row is outside the daemon settings patch — Save stays disabled', async () => {
    const updated = vi.spyOn(client.api, 'updateSettings');
    render(<SystemSettings />);
    await settleMount();
    await flipAndSettle();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updated).not.toHaveBeenCalled();
  });
});
