// studio#1383: after a Decline at the MCP install's consent (studio#1364), the session header says "Not installed" and
// the thread "Delivered, not installed", but the run panel beside them still said the job was cancelled, three times:
// the Now section's summary ("Cancelled"), its status line ("Cancelled · 3 of 4 done") and the workflow pill. The engine
// cancels the run on any gate's reject (core actor: the Reject path runs cancel_run), so the session's status stays
// `cancelled`; the panel reads the decline the same way the header does (`useConsentDecline`). A plain Stop keeps
// Cancelled. The audit lines are crew's `gate.decided` (packages/crew/src/api/routes.ts, `audit.record('gate.decided',
// …)`), as tests/jobPassage.outcomes.test.tsx serves them.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'run-1';
const PR = 'https://github.com/acme/notes-mcp/pull/7';
const INSTALL_CMD = ['bash', '-c', 'exec "${WICKED_GARDEN_ROOT:?}/scripts/wicked-garden" run scripts/mcp/install.py --from-run --target "${WICKED_CONSENT_CHOICE:?}" --json'];
const PLAN_CMD = ['bash', '-c', 'exec "${WICKED_GARDEN_ROOT:?}/scripts/wicked-garden" run scripts/mcp/install.py --from-run --dry-run --json'];

/** The mcp-server job's last steps (crew's builtin def): the build and its delivery done, the install not run. */
function mcpRun(consentStep: 'install' | 'publish' = 'install'): SessionView {
  return makeView({ id: RUN, status: 'cancelled', workflow_id: 'mcp-server', unit_ix: 3, delivery: 'delivered', deliverUrl: PR } as never, [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'build', role: 'creator', assigned_cli: 'claude' }),
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 1, status: 'done', phase_ref: 'deliver', stage: 'deliver' as never }),
    makeUnit({ id: `${RUN}:install-plan`, session_id: RUN, ord: 2, status: 'done', phase_ref: 'install-plan', tool_cmd: PLAN_CMD as never }),
    makeUnit({ id: `${RUN}:${consentStep}`, session_id: RUN, ord: 3, status: 'pending', phase_ref: consentStep, gate: 'consent_before' as never,
      ...(consentStep === 'install' ? { tool_cmd: INSTALL_CMD as never } : {}) }),
  ]);
}

const human = { id: 'operator', kind: 'human' };
const decline = { ts: 900, action: 'gate.decided', actor: human, runId: RUN, detail: { approve: false, choice: 'reject', ord: 3, status: 'cancelled' } };
const stop = { ts: 900, action: 'run.cancelled', actor: human, runId: RUN, detail: { reason: 'not needed any more' } };
let audit: unknown[] = [];

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  useGateStore.setState({ gates: {}, approaching: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {}, baseNotices: {}, endedRead: {}, endedDone: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(client.api, 'getAudit').mockImplementation(() => Promise.resolve({ entries: audit } as never));
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function panel(view: SessionView): Promise<void> {
  await act(async () => { render(<RunTab runs={[view]} sessionId="chat-j" title="An MCP server for Acme Notes" />); });
  await waitFor(() => expect(useProvenanceStore.getState().cancelStories[RUN]).toBeDefined());
}

/** The panel's three status words: the Now summary, the status line, the workflow pill. */
function words(): string[] {
  const now = screen.getAllByTestId('run-panel-section').find((s) => s.dataset['section'] === 'now')!;
  return [now.querySelector('[data-testid="run-panel-summary"]')!.textContent ?? '', screen.getByTestId('run-tab-status').textContent ?? '', screen.getByTestId('run-tab-pill').textContent ?? ''];
}

describe('studio#1383: the run panel after a consent Decline', () => {
  it('says Not installed (with the step count), never Cancelled', async () => {
    audit = [decline];
    await panel(mcpRun());
    await waitFor(() => expect(words()).toEqual(['Not installed', 'Not installed · 3 of 4 done', 'Not installed']));
    expect(screen.getByTestId('run-tab-now').textContent).not.toContain('Cancelled');
  });

  it('a declined consent step that is not the install says Declined', async () => {
    audit = [decline];
    await panel(mcpRun('publish'));
    await waitFor(() => expect(words()).toEqual(['Declined', 'Declined · 3 of 4 done', 'Declined']));
  });

  it('a plain Stop still says Cancelled', async () => {
    audit = [stop];
    await panel(mcpRun());
    await waitFor(() => expect(words()).toEqual(['Cancelled', 'Cancelled · 3 of 4 done', 'Cancelled']));
  });

  it('until the ended audit read answers, the panel says only Ended (never a Cancelled that a Decline replaces)', async () => {
    let answer!: (v: unknown) => void;
    vi.mocked(client.api.getAudit).mockImplementation(() => new Promise((r) => { answer = r; }) as never);
    await act(async () => { render(<RunTab runs={[mcpRun()]} sessionId="chat-j" title="An MCP server for Acme Notes" />); });
    expect(words()).toEqual(['Ended', 'Ended · 3 of 4 done', 'Ended']);
    await act(async () => { answer({ entries: [decline] }); });
    await waitFor(() => expect(words()).toEqual(['Not installed', 'Not installed · 3 of 4 done', 'Not installed']));
  });

  it('a live read from before the end (no rejection yet) is not the answer: Ended until the ended read, then Cancelled for a Stop', async () => {
    // The live read a running page made: its story holds no rejection, and the ended read is still to come.
    useProvenanceStore.setState({ byRun: { [RUN]: { state: 'unknown' } }, cancelStories: { [RUN]: { rejectNote: null, sendBackNote: null, rejected: null, engineTimedOut: false, stop: null } } } as never);
    let answer!: (v: unknown) => void;
    vi.mocked(client.api.getAudit).mockImplementation(() => new Promise((r) => { answer = r; }) as never);
    await act(async () => { render(<RunTab runs={[mcpRun()]} sessionId="chat-j" title="An MCP server for Acme Notes" />); });
    expect(words()).toEqual(['Ended', 'Ended · 3 of 4 done', 'Ended']);
    await act(async () => { answer({ entries: [stop] }); });
    await waitFor(() => expect(words()).toEqual(['Cancelled', 'Cancelled · 3 of 4 done', 'Cancelled']));
  });
});
