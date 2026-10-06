import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

/**
 * studio#513 — Notifications: with the browser's permission already DENIED the page names it on
 * load ("permission blocked in browser settings — the studio cannot re-ask"). Picking Desktop then
 * calls `Notification.requestPermission()`, which resolves "default" (no prompt is shown) while
 * `Notification.permission` stays "denied"; the page used the request's result as the state, so the
 * line disappeared and the radio snapped back to Off with no explanation — the one moment the user
 * asked for the permission. Now the state is read from `Notification.permission` after the request,
 * and a request that ends without a grant keeps (or states) the reason: blocked stays "blocked"; a
 * dismissed prompt says the browser did not grant it and how to be asked again.
 */

vi.mock('../src/api/client.js', () => ({
  api: {
    getAppearanceSettings: vi.fn(),
    putNotifSettings: vi.fn().mockResolvedValue({ settings: {} }),
  },
}));

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => FakeNotification.permission);
}
vi.stubGlobal('Notification', FakeNotification);

const { NotificationSettings } = await import('../src/components/NotificationSettings.js');
const { DEFAULT_NOTIF_PREFS, useNotifPrefsStore } = await import('../src/store/notifPrefs.js');

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockReset();
  useNotifPrefsStore.setState({ prefs: DEFAULT_NOTIF_PREFS, loaded: true });
});
afterEach(cleanup);

describe('a request that does not end in granted (studio#513)', () => {
  it('blocked in the browser: requestPermission resolves "default" but permission stays denied — the line stays', async () => {
    FakeNotification.permission = 'denied';
    FakeNotification.requestPermission.mockResolvedValue('default');
    render(<NotificationSettings />);
    expect(screen.getByTestId('notif-permission').textContent).toContain('blocked in browser settings');
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('notif-off')).toBeChecked();
    expect(useNotifPrefsStore.getState().prefs.desktop).toBe(false);
    const line = screen.getByTestId('notif-permission');
    expect(line.textContent).toContain('blocked in browser settings');
    expect(line.dataset.state).toBe('denied');
  });

  it('a dismissed prompt: permission stays "default" — say the browser did not grant it, and how to be asked again', async () => {
    FakeNotification.requestPermission.mockResolvedValue('default');
    render(<NotificationSettings />);
    expect(screen.queryByTestId('notif-permission')).toBeNull();
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(screen.getByTestId('notif-off')).toBeChecked();
    const line = screen.getByTestId('notif-permission');
    expect(line.textContent).toMatch(/did not grant/i);
    expect(line.textContent).toMatch(/pick Desktop again/i);
    expect(line.dataset.state).toBe('dismissed');
  });

  it('picking Desktop again re-asks; a grant clears the dismissed line', async () => {
    FakeNotification.requestPermission.mockResolvedValueOnce('default');
    render(<NotificationSettings />);
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(screen.getByTestId('notif-permission').dataset.state).toBe('dismissed');
    FakeNotification.requestPermission.mockResolvedValueOnce('granted');
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('notif-permission').dataset.state).toBe('granted');
    expect(useNotifPrefsStore.getState().prefs.desktop).toBe(true);
  });

  it('clicking Off — already checked after the failed request — clears the dismissed line (codex round 1)', async () => {
    FakeNotification.requestPermission.mockResolvedValue('default');
    render(<NotificationSettings />);
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(screen.getByTestId('notif-permission').dataset.state).toBe('dismissed');
    expect(screen.getByTestId('notif-off')).toBeChecked();
    await act(async () => { screen.getByTestId('notif-off').click(); });
    expect(screen.queryByTestId('notif-permission')).toBeNull();
  });

  it('a decisive denial from the prompt itself still reads as blocked', async () => {
    FakeNotification.requestPermission.mockResolvedValue('denied');
    render(<NotificationSettings />);
    await act(async () => { screen.getByTestId('notif-desktop').click(); });
    expect(screen.getByTestId('notif-permission').dataset.state).toBe('denied');
    expect(screen.getByTestId('notif-permission').textContent).toContain('blocked in browser settings');
  });
});
