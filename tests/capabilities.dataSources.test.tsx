import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';

/**
 * `dataSources` from the real health decoder (codex on the sidebar delta, P3): crew's `capabilities.apps.uploads`
 * (DES-APPS-001 K1) turns it on; absent, false, a failed read and a read still out keep the sidebar entry hidden.
 */
const getHealth = vi.fn();
vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }),
}));
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_t, k) => (k === 'getHealth' ? getHealth : () => Promise.resolve({})) }),
  apiFetch: () => Promise.resolve({ servers: [], discovered: [] }),
}));

const { useCapabilities } = await import('../src/store/capabilities.js');
const { SessionRail } = await import('../src/components/desk/SessionRail.js');

beforeEach(() => {
  useCapabilities.setState({ loaded: false, dataSources: false });
  getHealth.mockReset();
});
afterEach(() => cleanup());

const health = (apps: unknown) => ({ status: 'ok', capabilities: apps === undefined ? {} : { apps } });

describe('dataSources from /health', () => {
  it.each([
    ['apps.uploads true', health({ query: false, actions: false, turns: false, publish: false, uploads: true, sourceCheck: false }), true],
    ['apps.uploads false (the app store without K1)', health({ query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false }), false],
    ['no apps (a crew before Apps)', health(undefined), false],
  ])('%s', async (_name, answer, expected) => {
    getHealth.mockResolvedValue(answer);
    await useCapabilities.getState().load();
    expect(useCapabilities.getState().dataSources).toBe(expected);
  });

  it('a failed read is false', async () => {
    getHealth.mockRejectedValue(new Error('daemon down'));
    await useCapabilities.getState().load();
    expect(useCapabilities.getState()).toMatchObject({ loaded: true, dataSources: false });
  });

  it('the rail asks for it, shows no entry while the read is out, and the entry once crew says so', async () => {
    // Other rail parts (the Nerve Center tile) read /health too: every read waits, then all answer.
    const answers: Array<(v: unknown) => void> = [];
    getHealth.mockImplementation(() => new Promise((r) => { answers.push(r); }));
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/sources" />);
    await waitFor(() => expect(getHealth).toHaveBeenCalled()); // the client is reached lazily
    expect(useCapabilities.getState().loaded).toBe(false);
    expect(screen.queryByTestId('nav-sources')).toBeNull();
    await act(async () => { for (const a of answers) a(health({ query: false, actions: false, turns: false, publish: false, uploads: true, sourceCheck: false })); });
    expect(screen.getByTestId('nav-sources')).toHaveAttribute('aria-current', 'page');
  });
});
