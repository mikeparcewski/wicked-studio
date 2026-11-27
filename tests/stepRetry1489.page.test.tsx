/**
 * studio#1489: the header and the Now panel say a step failed and is being tried again (the page half; the reader's own
 * tests are tests/stepRetry1489.test.tsx). This file imports nothing new, so on main it fails on what the page says.
 *
 * The record is train-17 cert J6 v3 run B: the run's whole log as GET /runs/:id/events served it
 * (tests/fixtures/j6-t17-step-retry-1489.json). Step 1 failed at attempt 0 (seq 1590, workerError), the triage judge
 * said retry (1592), and attempt 1 ran (1593) until it finished (1679). The page said only "No output for N min".
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { useSheets } from '../src/store/sheets.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { makeUnit, makeView } from './factories.js';
import certLog from './fixtures/j6-t17-step-retry-1489.json';

const CERT = certLog as unknown as { runId: string; events: Array<Record<string, unknown>> };
const RUN = CERT.runId;
const MIN = 60_000;
const upTo = (seq: number) => CERT.events.filter((e) => (e['seq'] as number) <= seq && e['type'] !== 'workerStalled');
/** The log as the page held it at the cert's shot (10 min into attempt 1), its clock moved so that is now. */
const atShot = (now: number) => {
  const log = upTo(1595);
  const shift = now - 10 * MIN - Math.max(...log.map((e) => e['ts'] as number));
  return log.map((e) => ({ ...e, ts: (e['ts'] as number) + shift }));
};
const run = (status = 'executing', u1: 'distributed' | 'done' = 'distributed') => makeView({ id: RUN, status: status as never, unit_ix: 0, problem: 'Extract the business rules', created_at: 1_700_000_000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: u1, phase_ref: 'domain-run', stage: 'recon', assigned_cli: 'bash' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, status: 'distributed', phase_ref: 'domain-graph', stage: 'build', assigned_cli: 'wicked-core' }),
]);

describe('studio#1489: the page says it', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_795_800_000_000);
    localStorage.removeItem(RUN_PANEL_KEY);
    resetRunPanel();
    useSheets.setState({ open: null, pointed: null, stopping: {} } as never);
    useCapabilities.setState({ loaded: true } as never);
    useGateStore.setState({ gates: {}, approaching: {} });
    useTeamPlanStore.setState({ byRun: {}, refs: {} });
    setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
    vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
    useRunEventStore.setState({ byRun: { [RUN]: atShot(Date.now()) as never } });
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('the Now panel: its word and pill name the retry, and its sentence says which step failed and why', async () => {
    await act(async () => { render(<RunTab runs={[run()]} sessionId="chat-1" title="Extract the rules" />); });
    expect(screen.getByTestId('run-tab-pill').textContent).toBe('Trying again · attempt 2 · no output for 10 min');
    const line = screen.getByTestId('run-tab-status').textContent ?? '';
    expect(line).toMatch(/ failed \(a helper could not finish it\); trying it again · attempt 2 · no output for 10 min · 0 of 2 done$/u);
    expect(document.body.textContent).not.toContain('checker');
  });

  it('the header: "Trying again · attempt 2 · no output for 10 min", not only "No output for 10 min"', async () => {
    await act(async () => { render(<SessionPage sessionId={`run:${RUN}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />); });
    expect(screen.getAllByTestId('session-status')[0]!.textContent).toBe('Trying again · attempt 2 · no output for 10 min');
  });

  it('once the retry finished (the run view says the step is done), the page says no retry', async () => {
    await act(async () => { render(<RunTab runs={[run('executing', 'done')]} sessionId="chat-1" title="Extract the rules" />); });
    expect(screen.getByTestId('run-tab-pill').textContent).not.toContain('Trying again');
    expect(screen.getByTestId('run-tab-status').textContent).not.toContain('trying it again');
  });
});
