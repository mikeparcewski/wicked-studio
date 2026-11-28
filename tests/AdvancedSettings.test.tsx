import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AdvancedSettings } from '../src/components/AdvancedSettings.js';
import { SettingsPage } from '../src/components/SettingsPage.js';
import { readSettingsTab, settingsPath, SETTINGS_ADVANCED_PATH } from '../src/board/settingsTabs.js';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';

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
    expect(screen.getByText('Most changes apply to work that starts after you save. Work already running keeps its settings, except where a card says otherwise.')).toBeInTheDocument();
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
    vi.spyOn(client.api, 'updateSettings').mockRejectedValue(new ApiError(409, "seatMemory is set by this computer's environment (WICKED_SEAT_MEMORY)", { code: 'env_pinned', key: 'seatMemory', env: ['WICKED_SEAT_MEMORY'] }));
    render(<AdvancedSettings />);
    await user.type(await screen.findByRole('textbox', { name: 'Memory per helper' }), '8g');
    await user.click(screen.getByTestId('adv-save'));
    expect(await screen.findByTestId('adv-save-error')).toHaveTextContent('Studio could not save these settings.');
  });

  describe('cross-model review round 1', () => {
    it('typing past the range after a valid prefix withdraws the change: Save waits, and never sends the prefix', async () => {
      const user = userEvent.setup();
      const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
      render(<AdvancedSettings />);
      await user.type(await screen.findByRole('spinbutton', { name: 'Wait for an answer to a question' }), '120');
      await user.type(screen.getByRole('spinbutton', { name: 'Free disk to keep' }), '600'); // 6 and 60 were valid on the way
      expect(screen.getByRole('spinbutton', { name: 'Free disk to keep' })).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByTestId('adv-save')).toBeDisabled();
      expect(screen.getByTestId('adv-save-blocked')).toHaveTextContent('Fix the settings marked above before saving.');
      await user.clear(screen.getByRole('spinbutton', { name: 'Free disk to keep' }));
      await user.type(screen.getByRole('spinbutton', { name: 'Free disk to keep' }), '50');
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenCalledWith({ askTimeoutSecs: 120, floorMinFreeGb: 50 }));
    });

    it('an older field emptied while typing stays empty, and takes the new number', async () => {
      const user = userEvent.setup();
      vi.mocked(client.api.getSettings).mockResolvedValue(respond({ workerStallMinutes: 25 }));
      const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, workerStallMinutes: 20 } as never });
      render(<AdvancedSettings />);
      const field = await screen.findByRole('spinbutton', { name: 'Quiet before a stall is reported' });
      expect(field).toHaveValue(25);
      await user.clear(field);
      expect(field).toHaveValue(null);
      await user.type(field, '20');
      expect(field).toHaveValue(20);
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenCalledWith({ workerStallMinutes: 20 }));
    });

    it('"Use default" on an older key writes its default value, and the field shows it', async () => {
      const user = userEvent.setup();
      vi.mocked(client.api.getSettings).mockResolvedValue(respond({ workerStallMinutes: 25 }));
      const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, workerStallMinutes: 15 } as never });
      render(<AdvancedSettings />);
      await screen.findByRole('spinbutton', { name: 'Quiet before a stall is reported' });
      await user.click(screen.getByRole('button', { name: 'Use default: Quiet before a stall is reported' }));
      expect(screen.getByRole('spinbutton', { name: 'Quiet before a stall is reported' })).toHaveValue(15);
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenCalledWith({ workerStallMinutes: 15 }));
    });

    it("the daemon's 409 for a key pinned since the page loaded: the row turns pinned, the change is dropped, the rest saves next time", async () => {
      const user = userEvent.setup();
      const pinned = { seatMemory: { env: ['WICKED_SEAT_MEMORY'], value: '5g' } };
      const refusal = new ApiError(409, "seatMemory is set by this computer's environment (WICKED_SEAT_MEMORY); change it there",
        { error: "seatMemory is set by this computer's environment (WICKED_SEAT_MEMORY); change it there", code: 'env_pinned', key: 'seatMemory', env: ['WICKED_SEAT_MEMORY'] });
      const updated = vi.spyOn(client.api, 'updateSettings').mockRejectedValueOnce(refusal).mockResolvedValue({ settings: { graphNodeLimit: 150, askTimeoutSecs: 120 } as never });
      render(<AdvancedSettings />);
      await user.type(await screen.findByRole('textbox', { name: 'Memory per helper' }), '8g');
      await user.type(screen.getByRole('spinbutton', { name: 'Wait for an answer to a question' }), '120');
      vi.mocked(client.api.getSettings).mockResolvedValue(respond({}, pinned));
      await user.click(screen.getByTestId('adv-save'));
      expect(await screen.findByTestId('adv-save-error')).toHaveTextContent('Studio could not save these settings. Nothing was changed.');
      await waitFor(() => expect(screen.getByTestId('adv-seatMemory')).toHaveAttribute('data-pinned', 'true'));
      expect(screen.getByRole('textbox', { name: 'Memory per helper' })).toHaveValue('5g');
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenLastCalledWith({ askTimeoutSecs: 120 }));
    });

    it('a save with no answer is not called refused: it says the outcome is unknown', async () => {
      const user = userEvent.setup();
      vi.spyOn(client.api, 'updateSettings').mockRejectedValue(new TypeError('Failed to fetch'));
      render(<AdvancedSettings />);
      await user.type(await screen.findByRole('spinbutton', { name: 'Wait for an answer to a question' }), '120');
      await user.click(screen.getByTestId('adv-save'));
      const err = await screen.findByTestId('adv-save-error');
      expect(err).toHaveTextContent('Studio could not confirm the save.');
      expect(err).not.toHaveTextContent('Nothing was changed');
    });

    it('a daemon that answers 200 without keeping a key (older than these settings) is said, never "Saved"', async () => {
      const user = userEvent.setup();
      vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
      render(<AdvancedSettings />);
      await user.type(await screen.findByRole('spinbutton', { name: 'Longest chat answer' }), '900');
      await user.click(screen.getByTestId('adv-save'));
      expect(await screen.findByTestId('adv-not-kept')).toHaveTextContent('The daemon did not keep one of these settings.');
      expect(screen.queryByRole('status')).toBeNull();
    });

    it('pinned rows show the value in force: inherit pinned is On with its alert; numbers and sizes show the environment value', async () => {
      vi.mocked(client.api.getSettings).mockResolvedValue(respond({ seatMemory: '8g', unitTimeoutSecs: 600 }, {
        inheritOperatorCliConfig: { env: ['WICKED_WORKER_INHERIT_OPERATOR_CONFIG'], value: '0' },
        unitTimeoutSecs: { env: ['WICKED_UNIT_TIMEOUT_SECS'], value: '14400' },
        seatMemory: { env: ['WICKED_SEAT_MEMORY'], value: '5g' },
      }));
      render(<AdvancedSettings />);
      const toggle = await screen.findByRole('switch', { name: "Use this computer's CLI settings in helpers" });
      expect(toggle).toHaveAttribute('aria-checked', 'true');
      expect(toggle).toBeDisabled();
      expect(screen.getByTestId('adv-inherit-warning')).toHaveAttribute('role', 'alert');
      expect(screen.getByRole('spinbutton', { name: 'Longest helper turn' })).toHaveValue(240);
      expect(screen.getByRole('textbox', { name: 'Memory per helper' })).toHaveValue('5g');
    });

    it('network None saves the mode the daemon turns into an empty allowlist (gateway only)', async () => {
      const user = userEvent.setup();
      const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, seatNetwork: 'none' } as never });
      render(<AdvancedSettings />);
      await user.click(await screen.findByRole('radio', { name: 'None' }));
      expect(screen.getByTestId('adv-network-none-note')).toHaveTextContent('Helpers reach only the model service.');
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenCalledWith({ seatNetwork: 'none' }));
    });

    it('nothing can be edited while a save is in flight', async () => {
      const user = userEvent.setup();
      let finish: (v: unknown) => void = () => undefined;
      vi.spyOn(client.api, 'updateSettings').mockReturnValue(new Promise((r) => { finish = r; }) as never);
      render(<AdvancedSettings />);
      await user.type(await screen.findByRole('spinbutton', { name: 'Wait for an answer to a question' }), '120');
      await user.click(screen.getByTestId('adv-save'));
      expect(screen.getByRole('spinbutton', { name: 'Longest chat answer' })).toBeDisabled();
      expect(screen.getByRole('switch', { name: "Use this computer's CLI settings in helpers" })).toBeDisabled();
      finish({ settings: { graphNodeLimit: 150, askTimeoutSecs: 120 } });
      await waitFor(() => expect(screen.getByRole('spinbutton', { name: 'Longest chat answer' })).toBeEnabled());
    });

    it('a repository list that failed to load is said, with a retry, never "no repositories"', async () => {
      const user = userEvent.setup();
      vi.mocked(client.api.listRepos).mockRejectedValueOnce(new TypeError('Failed to fetch'));
      render(<AdvancedSettings />);
      expect(await screen.findByTestId('adv-identities-failed')).toHaveTextContent('Studio could not load the repositories');
      expect(screen.queryByText('No repositories are registered.')).toBeNull();
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('textbox', { name: 'Push account for wicked-crew' })).toBeInTheDocument();
    });

    it("the daemon's own rules: a trailer token starts with a letter, at most 10 lines; a loopback address is refused", async () => {
      const user = userEvent.setup();
      render(<AdvancedSettings />);
      const trailers = await screen.findByRole('textbox', { name: 'Commit trailers' });
      await user.type(trailers, '1x: value');
      expect(screen.getByTestId('adv-deliverTrailers-invalid')).toBeInTheDocument();
      await user.clear(trailers);
      await user.type(trailers, Array.from({ length: 11 }, (_, i) => `Note-${i}: x`).join('{enter}'));
      expect(screen.getByTestId('adv-deliverTrailers-toomany')).toHaveTextContent('At most 10 lines; this has 11.');
      await user.clear(trailers);
      await user.type(screen.getByRole('textbox', { name: 'Public Studio address' }), 'http://localhost:7701');
      expect(screen.getByTestId('adv-publicOrigin-invalid')).toBeInTheDocument();
      expect(screen.getByTestId('adv-save')).toBeDisabled();
    });

    it('choosing "Collect and summarize" (the default) clears the key', async () => {
      const user = userEvent.setup();
      vi.mocked(client.api.getSettings).mockResolvedValue(respond({ runLearnings: 'off' }));
      const updated = vi.spyOn(client.api, 'updateSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } as never });
      render(<AdvancedSettings />);
      await user.click(await screen.findByRole('radio', { name: 'Collect and summarize' }));
      expect(screen.queryByTestId('adv-runLearnings-default')).toBeNull();
      await user.click(screen.getByTestId('adv-save'));
      await waitFor(() => expect(updated).toHaveBeenCalledWith({ runLearnings: null }));
    });
  });
});
