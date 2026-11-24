// studio#1382 (coord r2): a finished MCP-server job whose install registered nothing (garden's pending record: a token
// to add) said "Not registered" in the header, but the run panel beside it still said "Finished" twice: the Now row
// ("Finished · delivered · 4 of 4 done") and the workflow pill. The panel reads the same kept read of the install's
// record (outcomeReads.ts) as the header and the passage, so every surface agrees. The record is garden's own
// `install.py --json` output (tests/fixtures/mcp-install/*.json, as tests/jobPassage.outcomes.test.tsx serves it).
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import pendingRecord from './fixtures/mcp-install/pending.json';
import registeredRecord from './fixtures/mcp-install/registered.json';
import type { SessionView } from '../src/api/types.js';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { resetOutcomeReadsForTest } from '../src/components/session/outcomeReads.js';
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

/** The mcp-server job (crew's builtin def), every step done: built, delivered, planned and installed. */
function mcpRun(extra: Record<string, unknown> = {}): SessionView {
  return makeView({ id: RUN, status: 'completed', workflow_id: 'mcp-server', unit_ix: 3, delivery: 'delivered', deliverUrl: PR, ...extra } as never, [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'build', role: 'creator', assigned_cli: 'claude' }),
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 1, status: 'done', phase_ref: 'deliver', stage: 'deliver' as never }),
    makeUnit({ id: `${RUN}:install-plan`, session_id: RUN, ord: 2, status: 'done', phase_ref: 'install-plan', tool_cmd: PLAN_CMD as never }),
    makeUnit({ id: `${RUN}:install`, session_id: RUN, ord: 3, status: 'done', phase_ref: 'install', gate: 'consent_before' as never, tool_cmd: INSTALL_CMD as never }),
  ]);
}

let output: () => Promise<{ output: string | null }> = () => Promise.resolve({ output: null });
const record = (r: unknown) => () => Promise.resolve({ output: `staging acme-notes…\n${JSON.stringify(r)}\n` });

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  resetOutcomeReadsForTest();
  useGateStore.setState({ gates: {}, approaching: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  useProvenanceStore.setState({ byRun: {}, rejectNotes: {}, cancelStories: {}, baseNotices: {}, endedRead: {}, endedDone: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] } as never);
  vi.spyOn(client.api, 'getUnitOutput').mockImplementation(() => output() as never);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function panel(view: SessionView): Promise<void> {
  await act(async () => { render(<RunTab runs={[view]} sessionId="chat-j" title="An MCP server for Acme Notes" />); });
}

/** The panel's three status words: the Now summary, the status line, the workflow pill. */
function words(): string[] {
  const now = screen.getAllByTestId('run-panel-section').find((s) => s.dataset['section'] === 'now')!;
  return [now.querySelector('[data-testid="run-panel-summary"]')!.textContent ?? '', screen.getByTestId('run-tab-status').textContent ?? '', screen.getByTestId('run-tab-pill').textContent ?? ''];
}

describe('studio#1382: the run panel agrees with the header on what the install came to', () => {
  it('nothing registered: Not registered on the Now row, the status line and the pill, never Finished', async () => {
    output = record(pendingRecord);
    await panel(mcpRun());
    await waitFor(() => expect(words()[0]).toBe('Not registered'));
    const [, line, pill] = words();
    expect(line).toMatch(/^Not registered · /);
    expect(line).toContain('4 of 4 done');
    expect(pill).toBe('Not registered');
    expect(screen.getByTestId('run-tab-now').textContent).not.toContain('Finished');
    expect(client.api.getUnitOutput).toHaveBeenCalledTimes(1);
  });

  it('a failed install: Install failed on all three', async () => {
    output = record({ ok: false, error: 'the staged server failed its smoke: boom' });
    await panel(mcpRun());
    await waitFor(() => expect(words()[0]).toBe('Install failed'));
    expect(words()[1]).toMatch(/^Install failed · /);
    expect(words()[2]).toBe('Install failed');
  });

  it('a registered install stays Finished', async () => {
    output = record(registeredRecord);
    await panel(mcpRun());
    await waitFor(() => expect(client.api.getUnitOutput).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(words()[0]).toBe('Finished');
    expect(words()[1]).toMatch(/^Finished · /);
    expect(words()[2]).toBe('Finished');
  });

  it('an archived run keeps Archived, and reads nothing for the install', async () => {
    output = record(pendingRecord);
    await panel(mcpRun({ archived_at: 1_700_000_000 }));
    expect(words()[2]).toBe('Archived');
    expect(client.api.getUnitOutput).not.toHaveBeenCalled();
  });
});
