import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { StartOnLoginStatus } from '../src/api/startOnLogin-wire.js';

/**
 * studio#1324: Settings > General > Start at login, over crew's `GET /api/v1/settings/start-on-login` (crew#1829,
 * `packages/crew/src/api/routes.ts` `settings/start-on-login`, body from `startOnLoginStatus` in
 * `packages/crew/src/api/start-on-login.ts`). The fixtures are crew's own answers, copied from its route tests
 * (`packages/crew/tests/start-on-login.test.ts`: the darwin pair at :44-49, linux at :53-55, other at :76).
 * Installing and removing stay CLI steps: the card shows the command, never runs it.
 */
const DARWIN_OFF: StartOnLoginStatus = {
  platform: 'darwin', port: 7701, installed: false, unit: null,
  installCommand: 'wicked-crew serve --port 7701 --install-service', uninstallCommand: 'wicked-crew serve --port 7701 --uninstall-service',
};
const DARWIN_ON: StartOnLoginStatus = { ...DARWIN_OFF, installed: true, unit: '~/Library/LaunchAgents/com.wickedagile.wicked-crew.plist' };
const LINUX_ON: StartOnLoginStatus = {
  platform: 'linux', port: 7741, installed: true, unit: '~/.config/systemd/user/wicked-crew-7741.service',
  installCommand: 'wicked-crew serve --port 7741 --install-service', uninstallCommand: 'wicked-crew serve --port 7741 --uninstall-service',
};
const OTHER: StartOnLoginStatus = { ...DARWIN_OFF, platform: 'other' };

let answer: () => Promise<StartOnLoginStatus>;
const getStartOnLogin = vi.fn(() => answer());

vi.mock('../src/api/client.js', () => ({ api: { getStartOnLogin: () => getStartOnLogin() } }));
const { StartOnLoginSettings } = await import('../src/components/StartOnLoginSettings.js');

beforeEach(() => { answer = () => Promise.resolve(DARWIN_OFF); getStartOnLogin.mockClear(); });
afterEach(cleanup);

const card = (): HTMLElement => screen.getByTestId('start-on-login-settings');

describe('the Start at login card', () => {
  it('off: says this port does not start at login and gives the install command to copy', async () => {
    render(<StartOnLoginSettings />);
    const status = await screen.findByTestId('start-on-login-status');
    expect(card()).toHaveAttribute('data-state', 'off');
    expect(status.textContent).toBe('Off: Studio’s service on port 7701 doesn’t start when you sign in to this computer.');
    const cmd = screen.getByTestId('start-on-login-command');
    expect(cmd.textContent).toBe('wicked-crew serve --port 7701 --install-service');
    expect(within(card()).getByRole('button', { name: 'copy wicked-crew serve --port 7701 --install-service' })).toBeInTheDocument();
    expect(screen.queryByTestId('start-on-login-unit')).toBeNull();
    // Read once; nothing is written.
    expect(getStartOnLogin).toHaveBeenCalledTimes(1);
  });

  it('on (macOS): says it starts at login, names the unit, and gives the remove command', async () => {
    answer = () => Promise.resolve(DARWIN_ON);
    render(<StartOnLoginSettings />);
    const status = await screen.findByTestId('start-on-login-status');
    expect(card()).toHaveAttribute('data-state', 'on');
    expect(status.textContent).toBe('On: Studio’s service on port 7701 starts when you sign in to this computer.');
    expect(screen.getByTestId('start-on-login-unit').textContent).toContain('~/Library/LaunchAgents/com.wickedagile.wicked-crew.plist');
    expect(screen.getByTestId('start-on-login-command').textContent).toBe('wicked-crew serve --port 7701 --uninstall-service');
  });

  it('on (Linux, another port): the port and the unit are crew\'s', async () => {
    answer = () => Promise.resolve(LINUX_ON);
    render(<StartOnLoginSettings />);
    expect((await screen.findByTestId('start-on-login-status')).textContent).toContain('port 7741 starts when you sign in');
    expect(screen.getByTestId('start-on-login-unit').textContent).toContain('~/.config/systemd/user/wicked-crew-7741.service');
    expect(screen.getByTestId('start-on-login-command').textContent).toBe('wicked-crew serve --port 7741 --uninstall-service');
  });

  it('another system: nothing is automated, and the command prints the steps', async () => {
    answer = () => Promise.resolve(OTHER);
    render(<StartOnLoginSettings />);
    const status = await screen.findByTestId('start-on-login-status');
    expect(card()).toHaveAttribute('data-state', 'manual');
    expect(status.textContent).toBe('Studio can’t set this computer to start its service when you sign in. This command prints the steps to set it up by hand:');
    expect(screen.getByTestId('start-on-login-command').textContent).toBe('wicked-crew serve --port 7701 --install-service');
  });

  it('a crew without the route (404 Not Found) says it can\'t report this', async () => {
    answer = () => Promise.reject(new ApiError(404, 'Not Found', { error: 'Not Found' }));
    render(<StartOnLoginSettings />);
    expect((await screen.findByTestId('start-on-login-unsupported')).textContent).toMatch(/can’t say whether it starts when you sign in\. Update wicked/);
    expect(card()).toHaveAttribute('data-state', 'unsupported');
  });

  it('a failed read says so with the error under Technical details, and Try again reads again', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    render(<StartOnLoginSettings />);
    const err = await screen.findByTestId('start-on-login-read-error');
    expect(err.textContent).toContain('Studio couldn’t read whether its service starts when you sign in.');
    answer = () => Promise.resolve(DARWIN_ON);
    fireEvent.click(screen.getByTestId('start-on-login-retry'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
    expect(getStartOnLogin).toHaveBeenCalledTimes(2);
  });

  it('Check again reads crew after the person ran the command in a terminal', async () => {
    render(<StartOnLoginSettings />);
    await screen.findByTestId('start-on-login-status');
    answer = () => Promise.resolve(DARWIN_ON);
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
  });

  it('a read answered after a newer one never overwrites it', async () => {
    let late: (v: StartOnLoginStatus) => void = () => undefined;
    render(<StartOnLoginSettings />);
    await screen.findByTestId('start-on-login-status');
    answer = () => new Promise((r) => { late = r; });
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    // The first Check again is still out: a second press is held, not a second read.
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    expect(getStartOnLogin).toHaveBeenCalledTimes(2);
    late(DARWIN_ON);
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
  });
});

describe('on the Settings page', () => {
  it('the General tab shows the card before Maintenance', async () => {
    vi.resetModules();
    vi.doMock('../src/components/SystemSettings.js', () => ({ SystemSettings: () => <div data-testid="mock-system" /> }));
    vi.doMock('../src/components/MaintenanceSettings.js', () => ({ MaintenanceSettings: () => <section data-testid="maintenance-settings" /> }));
    const { SettingsPage } = await import('../src/components/SettingsPage.js');
    render(<SettingsPage navigate={vi.fn()} search="" />);
    const panel = screen.getByTestId('settings-panel');
    const login = await within(panel).findByTestId('start-on-login-settings');
    const maint = within(panel).getByTestId('maintenance-settings');
    expect(login.compareDocumentPosition(maint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
