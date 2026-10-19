// S16a-2c: a run's session address with #governance (the MCP usage page's link) opens that run's
// Governance on arrival — in the run page's one panel (src/board/runPanelModel.ts), no sheet over it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView } from './factories.js';
import { useRunPanel, resetRunPanel } from '../src/store/runPanel.js';

beforeEach(() => {
  useSheets.setState({ open: null });
  useRunEventStore.setState({ byRun: { r1: [] } });
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
  // The open Governance item loads the run's acceptance (and, without it, the claims): answer both
  // here, and each test waits for that load, so nothing settles after jsdom's teardown.
  vi.spyOn(client.api, 'getRunAcceptance').mockRejectedValue(new Error('404'));
  vi.spyOn(client.api, 'listClaims').mockResolvedValue({ claims: [] } as never);
});
afterEach(() => { cleanup(); localStorage.removeItem('studio.runDetailsOpen'); window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

describe('S16a-2c — #governance on a run session', () => {
  it('opens the run panel on its Governance (Checks and evidence), even on the app’s first page', async () => {
    localStorage.setItem('studio.runDetailsOpen', 'false');
    resetRunPanel();
    window.history.replaceState(null, '', '/s/run%3Ar1#governance');
    render(<SessionPage sessionId="run:r1" runs={[makeView({ id: 'r1', status: 'completed' })]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    expect(useSheets.getState().open).toBeNull();
    expect(useRunPanel.getState().focus).toMatchObject({ section: 'checks', item: 'governance' });
    // The panel this browser remembered closed opens for the link.
    expect(screen.getByTestId('host-panel')).toBeTruthy();
    expect(screen.queryByTestId('run-details-handle')).toBeNull();
    // A link opening it is not the operator's choice: the remembered close stands.
    expect(localStorage.getItem('studio.runDetailsOpen')).toBe('false');
    const item = screen.getAllByTestId('run-panel-item').find((i) => i.dataset['item'] === 'governance')!;
    expect(item).toHaveAttribute('data-open', 'true');
    // GovernanceAudit's load settles inside the test (it used to land after teardown).
    await waitFor(() => expect(client.api.listClaims).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Loading governance claims…')).toBeNull());
  });

  it('without the hash the sheet stays closed', () => {
    window.history.replaceState(null, '', '/s/run%3Ar1');
    render(<SessionPage sessionId="run:r1" runs={[makeView({ id: 'r1', status: 'completed' })]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    expect(useSheets.getState().open).toBeNull();
  });
});

describe('S16a-2d — a run address not in the index yet says so honestly', () => {
  it('a just-launched run says it shows up shortly (no run id), never "Nothing in this session"', async () => {
    window.history.replaceState(null, '', '/s/run%3Ar-new');
    const { useCapabilities } = await import('../src/store/capabilities.js');
    useCapabilities.setState({ loaded: true } as never);
    render(<SessionPage sessionId="run:r-new" runs={[]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    const line = await screen.findByTestId('session-run-pending');
    expect(line).toHaveTextContent('A run that just started shows up here in a few seconds.');
    expect(line).not.toHaveTextContent('r-new');
    expect(screen.queryByText(/Nothing in this session/)).toBeNull();
  });
});
