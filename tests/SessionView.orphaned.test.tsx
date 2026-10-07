/**
 * studio#545: an orphaned run (the daemon restarted mid-step and restored no worker — the engine's
 * `runOrphaned` report ends the trail) says so in the session thread and offers Resume, which posts
 * `POST /runs/:id/resume` and re-reads the trail; a run whose trail dispatched after the report, or
 * that is not executing, shows nothing.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../src/board/gateActions.js';
import { ORPHANED_LINE } from '../src/board/sessionModel.js';
import { RunBlock } from '../src/components/session/SessionView.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

const RUN = 'r-orphan';
const TRAIL: CoreEvent[] = [
  { type: 'sessionStarted', session: RUN, ts: 1_000, seq: 1 },
  { type: 'unitDispatched', session: RUN, ord: 1, attempt: 0, cli: 'claude', ts: 2_000, seq: 2 },
  { type: 'runOrphaned', session: RUN, ord: 1, ts: 9_000, seq: 3 },
];
const RESUMED: CoreEvent[] = [...TRAIL, { type: 'unitDispatched', session: RUN, ord: 1, attempt: 1, cli: 'claude', ts: 10_000, seq: 4 }];

function view(status: SessionView['session']['status'] = 'executing'): SessionView {
  return makeView({ id: RUN, status, problem: 'stranded work from another client' });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] } as never);
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: { [RUN]: IDLE_GATE_ACTION } });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => cleanup());

describe('RunBlock — the orphaned row (studio#545)', () => {
  it('a trail ending on the report: the row says so, names the step, and offers Resume; Resume posts and the row goes once the trail dispatched again', async () => {
    const read = vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: TRAIL });
    const resume = vi.spyOn(client.api, 'resumeRun').mockResolvedValue({ status: 'resumed' });
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    // The trail is read once (a late join) and the verdict drawn from it.
    const row = await screen.findByTestId('session-orphaned');
    expect(row.textContent).toContain(ORPHANED_LINE);
    expect(row.dataset['ord']).toBe('1');
    expect(screen.getAllByTestId('session-orphaned-resume')).toHaveLength(1);
    expect(screen.queryByTestId('session-gate-row')).toBeNull();

    read.mockResolvedValue({ events: RESUMED });
    fireEvent.click(screen.getByTestId('session-orphaned-resume'));
    await waitFor(() => expect(resume).toHaveBeenCalledWith(RUN));
    await waitFor(() => expect(screen.queryByTestId('session-orphaned')).toBeNull());
  });

  it('a failed Resume is said on the row, which stays', async () => {
    useRunEventStore.setState({ byRun: { [RUN]: TRAIL } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: TRAIL });
    vi.spyOn(client.api, 'resumeRun').mockRejectedValue(new Error('daemon away'));
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    fireEvent.click(await screen.findByTestId('session-orphaned-resume'));
    const err = await screen.findByTestId('session-orphaned-error');
    expect(err.textContent).toContain('daemon away');
    expect(screen.getByTestId('session-orphaned')).toBeDefined();
  });

  it('no row: a trail that dispatched after the report, a run that is not executing, a trail that could not be read', async () => {
    useRunEventStore.setState({ byRun: { [RUN]: RESUMED } });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: RESUMED });
    const a = render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.getByTestId('session-status-sentence')).toBeDefined());
    expect(screen.queryByTestId('session-orphaned')).toBeNull();
    a.unmount();

    useRunEventStore.setState({ byRun: { [RUN]: TRAIL } });
    const b = render(<RunBlock view={view('awaiting_human')} badge={0} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.getByTestId('session-status-sentence')).toBeDefined());
    expect(screen.queryByTestId('session-orphaned')).toBeNull();
    b.unmount();

    useRunEventStore.setState({ byRun: {} });
    vi.spyOn(client.api, 'getRunEvents').mockRejectedValue(new Error('no event log'));
    render(<RunBlock view={view()} badge={0} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.getByTestId('session-status-sentence')).toBeDefined());
    await new Promise<void>((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('session-orphaned')).toBeNull();
  });
});
