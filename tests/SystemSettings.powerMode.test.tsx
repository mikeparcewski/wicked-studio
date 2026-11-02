/**
 * DES-POWER-MODE §2: Settings → "Power mode for new jobs: On" — the default of the New job switch. Shown only on a
 * daemon that runs power mode (`capabilities.powerMode`); absent = on; Save patches `powerModeDefault`.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { SystemSettings } from '../src/components/SystemSettings.js';
import { useCapabilities } from '../src/store/capabilities.js';

vi.mock('../src/components/Terminal.js', () => ({ Terminal: () => <div data-testid="mock-terminal" /> }));

let update: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  update = vi.fn((patch: Record<string, unknown>) => Promise.resolve({ settings: { graphNodeLimit: 150, ...patch } }));
  vi.spyOn(client.api, 'updateSettings').mockImplementation(update as never);
});
afterEach(() => { cleanup(); useCapabilities.setState({ loaded: false, powerMode: false }); });

async function mount(settings: Record<string, unknown>): Promise<void> {
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: { graphNodeLimit: 150, ...settings } } as never);
  render(<SystemSettings />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe('Settings — Power mode for new jobs', () => {
  it('is not shown on a daemon without power mode', async () => {
    useCapabilities.setState({ loaded: true, powerMode: false });
    await mount({});
    expect(screen.queryByTestId('power-mode-default-toggle')).toBeNull();
  });

  it('reads On when the daemon has no value (the shipped default), and Save sends powerModeDefault: false when turned off', async () => {
    useCapabilities.setState({ loaded: true, powerMode: true });
    await mount({});
    const sw = await screen.findByTestId('power-mode-default-toggle');
    expect(sw.getAttribute('aria-checked')).toBe('true');
    expect(sw.textContent).toContain('Power mode for new jobs: On');
    fireEvent.click(sw);
    expect(sw.textContent).toContain('Power mode for new jobs: Off');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(update).toHaveBeenCalledWith({ powerModeDefault: false });
  });

  it('reads Off when the daemon says so', async () => {
    useCapabilities.setState({ loaded: true, powerMode: true });
    await mount({ powerModeDefault: false });
    expect((await screen.findByTestId('power-mode-default-toggle')).getAttribute('aria-checked')).toBe('false');
  });
});
