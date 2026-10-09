// S16a-2c: a run's session address with #governance (the MCP usage page's link) opens that run's
// ⋯ sheet on its Governance tab on arrival — the run page's rule, said on the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView } from './factories.js';

beforeEach(() => {
  useSheets.setState({ open: null });
  useRunEventStore.setState({ byRun: { r1: [] } });
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); vi.restoreAllMocks(); });

describe('S16a-2c — #governance on a run session', () => {
  it('opens the run’s sheet on its Governance tab', () => {
    window.history.replaceState(null, '', '/s/run%3Ar1#governance');
    render(<SessionPage sessionId="run:r1" runs={[makeView({ id: 'r1', status: 'completed' })]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    expect(useSheets.getState().open).toStrictEqual({ ref: { kind: 'session', sessionId: 'run:r1' }, tab: 'governance' });
  });

  it('without the hash the sheet stays closed', () => {
    window.history.replaceState(null, '', '/s/run%3Ar1');
    render(<SessionPage sessionId="run:r1" runs={[makeView({ id: 'r1', status: 'completed' })]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
    expect(useSheets.getState().open).toBeNull();
  });
});
