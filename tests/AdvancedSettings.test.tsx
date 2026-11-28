import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedSettings } from '../src/components/AdvancedSettings.js';
import { SettingsPage } from '../src/components/SettingsPage.js';
import { readSettingsTab, settingsPath, SETTINGS_ADVANCED_PATH } from '../src/board/settingsTabs.js';
import * as client from '../src/api/client.js';

/**
 * Settings → Advanced (crew#2013, DES-2013 §5): the settings that were environment variables only.
 * The payloads are the daemon's `GET /settings` shape (crew routes.ts: `{ settings, path, environment }`,
 * `environment` from env-settings.ts `pinnedEnvSettings`).
 */

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

type Response = Awaited<ReturnType<typeof client.api.getSettings>>;
const respond = (settings: Record<string, unknown>, environment?: Record<string, { env: string[]; value: string }>): Response =>
  ({ settings: { graphNodeLimit: 150, ...settings }, path: '~/.wicked-crew/settings.json', ...(environment !== undefined ? { environment } : {}) }) as unknown as Response;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getSettings').mockResolvedValue(respond({}));
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'repo-1', name: 'wicked-crew', root_path: '/r', default_branch: 'main', registered_at: 0 }] } as never);
});

describe('the Advanced tab', () => {
  it('is the third tab, on its own address', () => {
    expect(readSettingsTab('?tab=advanced')).toBe('advanced');
    expect(settingsPath('advanced')).toBe(SETTINGS_ADVANCED_PATH);
    render(<SettingsPage navigate={vi.fn()} search="?tab=advanced" />);
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['General', 'Theme', 'Advanced']);
    expect(screen.getByTestId('settings-panel')).toHaveAttribute('data-tab', 'advanced');
    expect(screen.getByText('Changes apply to work that starts after you save. Work already running keeps its settings.')).toBeInTheDocument();
  });

  it('shows the inherit warning always, emphasised once the switch is on, and saves true', async () => {
    const user = userEvent.setup();
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, inheritOperatorCliConfig: true } as never });
    render(<AdvancedSettings />);
    const warning = await screen.findByTestId('adv-inherit-warning');
    expect(warning).toHaveTextContent("helpers use this computer's own CLI settings, MCP servers and signed-in accounts");
    expect(warning).not.toHaveAttribute('role');
    await user.click(screen.getByRole('switch', { name: "Use this computer's CLI settings in helpers" }));
    expect(warning).toHaveAttribute('role', 'alert');
    await user.click(screen.getByTestId('adv-save'));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ inheritOperatorCliConfig: true }));
  });

  it('a row the environment pins is read-only, says so, and offers no default', async () => {
    vi.mocked(client.api.getSettings).mockResolvedValue(respond({ seatMemory: '8g' }, { seatMemory: { env: ['WICKED_SEAT_MEMORY'], value: '5g' } }));
    render(<AdvancedSettings />);
    const row = await screen.findByTestId('adv-seatMemory');
    expect(row).toHaveAttribute('data-pinned', 'true');
    expect(within(row).getByRole('textbox', { name: 'Memory per helper' })).toBeDisabled();
    expect(within(row).getByTestId('adv-seatMemory-pinned')).toHaveTextContent("Set by this computer's environment (WICKED_SEAT_MEMORY), so it can't be changed here: 5g");
    expect(within(row).queryByTestId('adv-seatMemory-default')).toBeNull();
  });

  it('minutes in the field are seconds on the wire; "Use default" sends null', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.getSettings).mockResolvedValue(respond({ askTimeoutSecs: 120 }));
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
    render(<AdvancedSettings />);
    const unit = await screen.findByRole('spinbutton', { name: 'Longest helper turn' });
    await user.type(unit, '30');
    await user.click(screen.getByTestId('adv-askTimeoutSecs-default'));
    await user.click(screen.getByTestId('adv-save'));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ unitTimeoutSecs: 1800, askTimeoutSecs: null }));
  });

  it('a value out of range is named at the field and never reaches the save', async () => {
    const user = userEvent.setup();
    render(<AdvancedSettings />);
    await user.type(await screen.findByRole('spinbutton', { name: 'Free disk to keep' }), '0');
    expect(screen.getByTestId('adv-floorMinFreeGb-input-invalid')).toHaveTextContent('Enter a whole number from 1 to 500.');
    expect(screen.getByTestId('adv-save')).toBeDisabled();
  });

  it('only-these-sites saves the mode and the host list; a bad host is named', async () => {
    const user = userEvent.setup();
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
    render(<AdvancedSettings />);
    await user.click(await screen.findByRole('radio', { name: 'Only these sites' }));
    const hosts = screen.getByRole('textbox', { name: 'Allowed sites' });
    await user.type(hosts, 'index.crates.io{enter}Bad Host');
    expect(screen.getByTestId('adv-seatEgressHosts-invalid')).toHaveTextContent('Bad Host');
    await user.clear(hosts);
    await user.type(hosts, 'index.crates.io{enter}*.npmjs.org');
    await user.click(screen.getByTestId('adv-save'));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ seatNetwork: 'allowlist', seatEgressHosts: ['index.crates.io', '*.npmjs.org'] }));
  });

  it('a pinned network row hides the choice', async () => {
    vi.mocked(client.api.getSettings).mockResolvedValue(respond({}, { seatNetwork: { env: ['WICKED_SEAT_NETWORK'], value: 'none' }, seatEgressHosts: { env: ['WICKED_SEAT_NETWORK'], value: 'none' } }));
    render(<AdvancedSettings />);
    const row = await screen.findByTestId('adv-seatNetwork');
    expect(row).toHaveAttribute('data-pinned', 'true');
    expect(within(row).queryByRole('radiogroup')).toBeNull();
    expect(screen.queryByTestId('adv-seatEgressHosts')).toBeNull();
  });

  it('one push account row per registered repository, saved as the whole map', async () => {
    const user = userEvent.setup();
    const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
    render(<AdvancedSettings />);
    await user.type(await screen.findByRole('textbox', { name: 'Push account for wicked-crew' }), 'octo');
    await user.click(screen.getByTestId('adv-save'));
    await waitFor(() => expect(updated).toHaveBeenCalledWith({ deliverIdentityByRepo: { 'repo-1': 'octo' } }));
  });

  it("a refused save (the daemon's 409 for a key pinned since the page loaded) is said, with the daemon's words", async () => {
    const user = userEvent.setup();
    vi.spyOn(client.api, 'updateSettings').mockRejectedValue(new Error("seatMemory is set by this computer's environment (WICKED_SEAT_MEMORY)"));
    render(<AdvancedSettings />);
    await user.type(await screen.findByRole('textbox', { name: 'Memory per helper' }), '8g');
    await user.click(screen.getByTestId('adv-save'));
    expect(await screen.findByTestId('adv-save-error')).toHaveTextContent('Studio could not save these settings.');
  });
});
