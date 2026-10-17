// General settings (`/system`): the settings path from `GET /settings.path` (crew 0.7.36; absent ⇒ said,
// never a fabricated home-relative literal). Since 2026-10-16 the page has no agents block (operator:
// "General settings page doesn't need 'agents' block anymore"): sign-in, sign-out and which agents new
// work uses live on the Agents tab (tests/agentModalNewWork.test.tsx), and the page reads no roster.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { SystemSettings } from '../src/components/SystemSettings.js';
import * as client from '../src/api/client.js';

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('General settings', () => {
  it('has no agents block and asks for no roster', async () => {
    const roster = vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
    vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId('view-settings')).toBeInTheDocument());
    expect(screen.queryByText('Helpers and sign-in')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save CLI defaults' })).toBeNull();
    expect(document.querySelector('[data-testid^="seat-signin-"], [data-testid^="seat-logout-"], [data-testid^="seat-freetier-"]')).toBeNull();
    expect(roster).not.toHaveBeenCalled();
  });

  it('names the settings path the daemon reports; says so when the daemon does not report one', async () => {
    const spy = vi.spyOn(client.api, 'getSettings').mockResolvedValue(
      { settings: { graphNodeLimit: 150 }, path: '/srv/wicked/state/system-settings.json' } as Awaited<ReturnType<typeof client.api.getSettings>>,
    );
    const { unmount } = render(<SystemSettings />);
    await waitFor(() => expect(screen.getByText('/srv/wicked/state/system-settings.json')).toBeInTheDocument());
    expect(screen.queryByText(/does not report the path/)).toBeNull();
    unmount();

    spy.mockResolvedValue({ settings: { graphNodeLimit: 150 } });
    render(<SystemSettings />);
    await waitFor(() => expect(screen.getByTestId("settings-path")).toHaveTextContent("Studio's service does not report its settings file location."));
    expect(screen.getByTestId("settings-path").tagName).toBe("DETAILS");
    expect(screen.queryByText(/wicked-core\/settings\.json/)).toBeNull(); // the hard-coded literal is gone
  });
});
