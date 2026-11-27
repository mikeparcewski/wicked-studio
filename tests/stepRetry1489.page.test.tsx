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

  it('codex r1: a running checks floor keeps its own words over a retry (header and Now)', async () => {
    const floor = { type: 'unitOutputDelta', session: RUN, ord: 1, attempt: 1, ts: Date.now() - 2 * MIN,
      text: "\nrepo checks floor (creator): running the repository's own checks — 5 min; now `test` on the change (pass 1 of `test`), 3 min in\n" };
    useRunEventStore.setState({ byRun: { [RUN]: [...atShot(Date.now()), floor] as never } });
    await act(async () => { render(<SessionPage sessionId={`run:${RUN}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />); });
    expect(screen.getAllByTestId('session-status')[0]!.textContent).toMatch(/^Running checks/u);
    cleanup();
    await act(async () => { render(<RunTab runs={[run()]} sessionId="chat-1" title="Extract the rules" />); });
    expect(document.body.textContent).not.toContain('Trying again');
    expect(screen.getByTestId('run-tab-status').textContent).not.toContain('trying it again');
  });

  it('studio#1497: an open gate wins over the retry words while the run view still says executing (header and Now)', async () => {
    // The gate arrives the way the socket delivers it: the engine's awaitingHuman frame, in the cert log's own shape
    // (seq 1361), folded by the gate store's ingest. The run view has not caught up (still executing).
    const frame = CERT.events.find((e) => e['seq'] === 1361)!;
    const gate = Object.fromEntries(Object.entries(frame).filter(([k]) => k !== 'seq'));
    act(() => { useGateStore.getState().ingest({ ...gate, gateKind: 'human_confirm', gateSeq: 2, ts: Date.now(), prompt: 'Confirm step 1 before it runs again' } as never); });
    expect(useGateStore.getState().gates[RUN]).toBeDefined();
    await act(async () => { render(<RunTab runs={[run()]} sessionId="chat-1" title="Extract the rules" />); });
    expect(screen.getByTestId('run-tab-pill').textContent).not.toContain('Trying again');
    expect(screen.getByTestId('run-tab-status').textContent).not.toContain('trying it again');
    expect(document.body.textContent).not.toContain('Trying again');
    cleanup();
    await act(async () => { render(<SessionPage sessionId={`run:${RUN}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />); });
    expect(screen.getAllByTestId('session-status')[0]!.textContent).not.toContain('Trying again');
  });

  it('studio#1500: with that open gate and the executing view, the pill, the Now word and the header say waiting, never Working', async () => {
    useRunEventStore.setState({ byRun: { [RUN]: [] as never } });
    const frame = CERT.events.find((e) => e['seq'] === 1361)!;
    const gate = Object.fromEntries(Object.entries(frame).filter(([k]) => k !== 'seq'));
    act(() => { useGateStore.getState().ingest({ ...gate, gateKind: 'human_confirm', gateSeq: 2, ts: Date.now(), prompt: 'Confirm step 1 before it runs' } as never); });
    await act(async () => { render(<RunTab runs={[run()]} sessionId="chat-1" title="Extract the rules" />); });
    expect(screen.getByTestId('run-tab-pill').textContent).toBe('Waiting on you');
    expect(screen.getByTestId('run-tab-status').textContent).toMatch(/^Waiting on you/u);
    expect(document.body.textContent).not.toContain('Working');
    cleanup();
    await act(async () => { render(<SessionPage sessionId={`run:${RUN}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />); });
    expect(screen.getAllByTestId('session-status')[0]!.textContent).toBe('Waiting');
    // No gate: the same executing view says Working, as before.
    cleanup();
    act(() => { useGateStore.setState({ gates: {}, approaching: {} }); });
    await act(async () => { render(<SessionPage sessionId={`run:${RUN}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />); });
    expect(screen.getAllByTestId('session-status')[0]!.textContent).toBe('Working');
  });

  it('once the retry finished (the run view says the step is done), the page says no retry', async () => {
    await act(async () => { render(<RunTab runs={[run('executing', 'done')]} sessionId="chat-1" title="Extract the rules" />); });
    expect(screen.getByTestId('run-tab-pill').textContent).not.toContain('Trying again');
    expect(screen.getByTestId('run-tab-status').textContent).not.toContain('trying it again');
  });
});
