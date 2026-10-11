import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

/**
 * The Notifications settings group (DES-FEEDBACK-002 §8.2, slice L): the
 * permission-gesture flow. EC25 is the hazard this file pins: rendering the
 * surface NEVER calls `Notification.requestPermission` — only the desktop
 * option's own click does, exactly once; `granted` persists the pref over the
 * settings wire, `denied` reverts the radio to Off and names the state
 * honestly ("blocked in browser settings").
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

const { api } = await import('../src/api/client.js');
const { NotificationSettings } = await import('../src/components/NotificationSettings.js');
const { DEFAULT_NOTIF_PREFS, useNotifPrefsStore } = await import('../src/store/notifPrefs.js');

const putNotif = vi.mocked(api.putNotifSettings);

beforeEach(() => {
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockClear();
  putNotif.mockClear();
  useNotifPrefsStore.setState({ prefs: DEFAULT_NOTIF_PREFS, loaded: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('studio#725: the two choices are the Segmented primitive, never bare browser radios', () => {
  it('renders one radiogroup of boxed options, Off selected', () => {
    render(<NotificationSettings />);
    const group = screen.getByRole('radiogroup', { name: 'Notifications' });
    expect(group.className).toContain('wk-segmented');
    expect(group.querySelector('input[type="radio"]')).toBeNull();
    expect(screen.getByTestId('notif-off').getAttribute('role')).toBe('radio');
    expect(screen.getByTestId('notif-off').getAttribute('aria-checked')).toBe('true');
  });
});

describe('EC25 — the permission gesture', () => {
  it('renders (default Off) without touching requestPermission', () => {
    render(<NotificationSettings />);
    expect(screen.getByRole('radiogroup', { name: 'Notifications' })).toBeInTheDocument();
    expect(screen.getByTestId('notif-off')).toBeChecked();
    expect(screen.getByTestId('notif-desktop')).not.toBeChecked();
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    // 'default' permission before opting in: no status line to report yet.
    expect(screen.queryByTestId('notif-permission')).toBeNull();
  });

  it('selecting the desktop option prompts exactly once; granted → pref on + persisted', async () => {
    vi.useFakeTimers();
    FakeNotification.requestPermission.mockResolvedValue('granted');
    render(<NotificationSettings />);

    await act(async () => {
      screen.getByTestId('notif-desktop').click();
    });
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(useNotifPrefsStore.getState().prefs.desktop).toBe(true);
    expect(screen.getByTestId('notif-desktop')).toBeChecked();
    expect(screen.getByTestId('notif-permission').textContent).toContain('allowed');

    // The pref rides the settings wire under the studio key (debounced).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(putNotif).toHaveBeenCalledWith({ desktop: true, chime: false });
  });

  it('denied → the radio reverts to Off and the state is named honestly', async () => {
    FakeNotification.requestPermission.mockResolvedValue('denied');
    render(<NotificationSettings />);

    await act(async () => {
      screen.getByTestId('notif-desktop').click();
    });
    expect(useNotifPrefsStore.getState().prefs.desktop).toBe(false);
    expect(screen.getByTestId('notif-off')).toBeChecked();
    expect(screen.getByTestId('notif-permission').textContent).toContain('blocked in browser settings');
  });

  it('an already-granted permission never re-prompts (the browser would throw it away)', async () => {
    FakeNotification.permission = 'granted';
    render(<NotificationSettings />);
    await act(async () => {
      screen.getByTestId('notif-desktop').click();
    });
    expect(FakeNotification.requestPermission).not.toHaveBeenCalled();
    expect(useNotifPrefsStore.getState().prefs.desktop).toBe(true);
  });
});

describe('the chime checkbox', () => {
  it('is disabled while desktop is Off, and toggles the pref when on', async () => {
    render(<NotificationSettings />);
    expect(screen.getByRole('switch', { name: 'Also play a chime' })).toBeDisabled();
    expect(screen.getByText('Choose Desktop notifications before enabling a chime.')).toBeInTheDocument();

    act(() => {
      useNotifPrefsStore.setState({ prefs: { desktop: true, chime: false } });
    });
    expect(screen.getByTestId('notif-chime')).toBeEnabled();
    await act(async () => {
      screen.getByTestId('notif-chime').click();
    });
    expect(useNotifPrefsStore.getState().prefs.chime).toBe(true);
  });
});

describe('codex r1 on studio#725: the Segmented primitive around a disabled option', () => {
  it('arrows skip a disabled option, and an enabled one keeps the tab stop', async () => {
    const { Segmented } = await import('../src/components/ui/Segmented.js');
    const onChange = vi.fn();
    render(<Segmented label="Mode" value="b" onChange={onChange}
      options={[{ value: 'a', label: 'A', testId: 'seg-a' }, { value: 'b', label: 'B', testId: 'seg-b', disabled: true }, { value: 'c', label: 'C', testId: 'seg-c' }]} />);
    expect(screen.getByTestId('seg-a').tabIndex).toBe(0);
    expect(screen.getByTestId('seg-b').tabIndex).toBe(-1);
    screen.getByTestId('seg-a').focus();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.keyDown(screen.getByTestId('seg-a'), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('c');
  });
});
