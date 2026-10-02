import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';
import { DEFAULT_VIEW_PREFS, useViewPrefsStore } from '../src/store/viewPrefs.js';

/**
 * DES-studio-rebuild S3 — Settings › "Show technical details" (DESIGN-simple §4, simple-21):
 * one switch, off by default, saved on its own as `studio.view` through `PUT /settings`
 * (outside the page's Save button, like the Runs row), and honest when a daemon drops it.
 */

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

async function settleMount(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}

async function flipAndSettle(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('tech-details-toggle'));
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'putViewSettings').mockImplementation((prefs) =>
    Promise.resolve({ settings: { graphNodeLimit: 150, 'studio.view': prefs } }),
  );
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: true, persist: 'unknown' });
});

afterEach(() => {
  cleanup();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

describe('SystemSettings — Show technical details (S3)', () => {
  it('is a labelled switch, off by default, with a plain description', async () => {
    render(<SystemSettings />);
    await settleMount();
    const toggle = screen.getByTestId('tech-details-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    expect(toggle).toHaveAccessibleName('Show technical details');
    expect(screen.getByTestId('view-settings')).toHaveTextContent(/ids, versions and helper names in small grey type/i);
  });

  it('turning it on saves `studio.view` = { technical_details: true } through PUT /settings', async () => {
    render(<SystemSettings />);
    await settleMount();
    await flipAndSettle();
    expect(client.api.putViewSettings).toHaveBeenCalledTimes(1);
    expect(client.api.putViewSettings).toHaveBeenCalledWith({ technical_details: true });
    expect((screen.getByTestId('tech-details-toggle') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByTestId('tech-details-unsaved')).toBeNull();
  });

  it('a daemon that drops the key says so instead of looking saved', async () => {
    vi.mocked(client.api.putViewSettings).mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    await settleMount();
    await flipAndSettle();
    expect(screen.getByTestId('tech-details-unsaved')).toHaveTextContent(/not stored by this daemon/i);
  });
});
