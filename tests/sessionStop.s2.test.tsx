// w8-qefix, rig 09:33Z (run 863167a2): an EXECUTING run's session showed no Stop, and under host
// load the page sat on its loading state with no way on; the lane had to cancel through the API.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useSheets } from '../src/store/sheets.js';
import { useRunEventStore } from '../src/store/events.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { makeView } from './factories.js';

beforeEach(() => {
  useSheets.setState({ open: null, stopping: {} } as never);
  useRunEventStore.setState({ byRun: { r1: [] } });
  useCapabilities.setState({ loaded: true } as never);
  vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

const page = (over: Partial<Parameters<typeof SessionPage>[0]> = {}): ReturnType<typeof render> => render(
  <SessionPage sessionId="run:r1" runs={[makeView({ id: 'r1', status: 'executing' })]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} {...over} />,
);

describe('an executing run can be stopped from its session', () => {
  it('a run session (not only a chat) shows Stop, which asks before it acts', () => {
    page();
    const stop = screen.getByTestId('session-stop');
    expect(stop).toHaveClass('wk-btn');
    fireEvent.click(stop);
    // One confirm step: nothing is stopped until the operator says so.
    expect(useSheets.getState().stopping['r1']).toBeUndefined();
    fireEvent.click(screen.getByTestId('session-stop-confirm'));
    expect(useSheets.getState().stopping['r1']).toBeDefined();
  });
  it('a finished run shows no Stop', () => {
    page({ runs: [makeView({ id: 'r1', status: 'completed' })] });
    expect(screen.queryByTestId('session-stop')).toBeNull();
  });
});

describe('a session whose runs read fails or stalls says so, with Retry', () => {
  it('a failed runs read is a StateBanner with Retry, never an endless skeleton', () => {
    const retry = vi.fn();
    page({ runs: [], runsLoaded: false, runsError: 'Failed to fetch', onRetryRuns: retry });
    const banner = screen.getByTestId('session-runs-error');
    expect(banner).toHaveTextContent('Studio can’t reach its service right now.');
    fireEvent.click(screen.getByTestId('session-runs-error-retry'));
    expect(retry).toHaveBeenCalledOnce();
  });
  it('a read still pending after 15 s says it is slow, with Retry', () => {
    vi.useFakeTimers();
    const retry = vi.fn();
    page({ runs: [], runsLoaded: false, onRetryRuns: retry });
    expect(screen.queryByTestId('session-runs-slow')).toBeNull();
    act(() => { vi.advanceTimersByTime(15_100); });
    expect(screen.getByTestId('session-runs-slow')).toHaveTextContent('taking longer than usual');
    fireEvent.click(screen.getByTestId('session-runs-slow-retry'));
    expect(retry).toHaveBeenCalledOnce();
  });
});
