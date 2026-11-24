import { StrictMode } from 'react';
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
    expect(status.textContent).toBe('Off: nothing is set up to start Studio’s service on port 7701 when you sign in to this computer.');
    // codex r1: the install refuses while the hand-started service holds the port, and the page loses it meanwhile.
    expect(screen.getByTestId('start-on-login-howto').textContent).toMatch(/^First stop the service you started by hand \(in its terminal\): the install refuses while it holds port 7701/);
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
    // codex r1: crew reports the unit file, not that the service manager has it enabled.
    expect(status.textContent).toBe('On: a start-at-login service is set up for Studio’s service on port 7701.');
    expect(screen.getByTestId('start-on-login-unit').textContent).toContain('~/Library/LaunchAgents/com.wickedagile.wicked-crew.plist');
    expect(screen.getByTestId('start-on-login-command').textContent).toBe('wicked-crew serve --port 7701 --uninstall-service');
    // codex r1: removing it stops the service now (crew runs `launchctl bootout`), so the hand start for the port is given.
    expect(screen.getByTestId('start-on-login-howto').textContent).toContain('It also stops the service now');
    expect(screen.getByTestId('start-on-login-restart').textContent).toBe('wicked-crew serve --port 7701');
    expect(within(card()).getByRole('button', { name: 'copy wicked-crew serve --port 7701' })).toBeInTheDocument();
  });

  it('on (Linux, another port): the port and the unit are crew\'s', async () => {
    answer = () => Promise.resolve(LINUX_ON);
    render(<StartOnLoginSettings />);
    expect((await screen.findByTestId('start-on-login-status')).textContent).toContain('set up for Studio’s service on port 7741');
    expect(screen.getByTestId('start-on-login-unit').textContent).toContain('~/.config/systemd/user/wicked-crew-7741.service');
    expect(screen.getByTestId('start-on-login-command').textContent).toBe('wicked-crew serve --port 7741 --uninstall-service');
    expect(screen.getByTestId('start-on-login-restart').textContent).toBe('wicked-crew serve --port 7741');
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

  it('while Check again is out the button is held (Checking…), and its answer lands', async () => {
    let late: (v: StartOnLoginStatus) => void = () => undefined;
    render(<StartOnLoginSettings />);
    await screen.findByTestId('start-on-login-status');
    answer = () => new Promise((r) => { late = r; });
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    const btn = screen.getByTestId('start-on-login-reread');
    expect(btn).toBeDisabled();
    expect(btn.textContent).toBe('Checking…');
    expect(getStartOnLogin).toHaveBeenCalledTimes(2);
    late(DARWIN_ON);
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
  });

  it('codex r1: under StrictMode the mount reads once (the replayed effect finds the read out), and its answer lands', async () => {
    let first: (v: StartOnLoginStatus) => void = () => undefined;
    answer = () => new Promise((r) => { first = r; });
    render(<StrictMode><StartOnLoginSettings /></StrictMode>);
    expect(getStartOnLogin).toHaveBeenCalledTimes(1);
    first(DARWIN_ON);
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
  });

  it('agy r1: a failed Check again keeps the last answer, says so, and the next good read clears it', async () => {
    render(<StartOnLoginSettings />);
    await screen.findByTestId('start-on-login-status');
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    expect((await screen.findByTestId('start-on-login-reread-error')).textContent).toContain('This is what its service said last time.');
    expect(card()).toHaveAttribute('data-state', 'off');
    answer = () => Promise.resolve(DARWIN_ON);
    fireEvent.click(screen.getByTestId('start-on-login-reread'));
    await waitFor(() => expect(card()).toHaveAttribute('data-state', 'on'));
    expect(screen.queryByTestId('start-on-login-reread-error')).toBeNull();
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
