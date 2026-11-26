/**
 * studio#1454 (cert-sweep, a governed `/plugin editor` run on a proof daemon):
 *  1. The install consent card drew the engine's ordinary answers (Approve, "Approve with a note for the next step",
 *     "Change what it must do…", Send back) beside the install's own choices. The engine lists them there
 *     (wicked-core `consent_actions`: every ordinary answer, the plan's choices spliced after the approve, then reject),
 *     but its plain approve IS the default install choice, already drawn and marked, and a steer or a send-back is not
 *     an install choice. The card draws the install's choices and Decline only.
 *  2. Details said "Changes: Not delivered" while the consent gate waited, though the deliver step had already opened
 *     the PR: crew records the PR url only once the run ends, so the panel reads the deliver step's own output (the one
 *     sanctioned per-run read, store/delivery.ts) as soon as that step is done.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { choiceTokens, type GateAction } from '../src/board/gateContract.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { makeUnit, makeView } from './factories.js';

const RUN = '29848ff9-f784-5b93-af2a-5d92371e649f';
const D = 'consent:daemon_1wBv_j9aaBj_oCiOi8nfU';
const OFF = 'consent:daemon-off_1wBv_j9aaBj_oCiOi8nfU';
// The run's own awaitingHuman frame for the consent gate (cert-sweep's browser cache of GET /runs/<id>/events, ord 9).
const FRAME = {
  type: 'awaitingHuman', session: RUN, ord: 9, gateKind: 'consent', recommended: 0,
  choices: [D, OFF, 'reject'],
  choiceLabels: { [D]: 'Install for this daemon', [OFF]: 'Install, turned off', reject: 'Decline' },
  prompt: 'Consent needed before unit 9 runs — nothing in it has run yet.',
} as unknown as CoreEvent;
// wicked-core src/actor/gate_actions.rs `consent_actions`: `answer_actions` (approve, amend_intent, request_changes,
// reject on this gate) with one `consent_choice` per plan choice spliced in after the approve.
const ACTIONS: GateAction[] = [
  { action: 'approve', intent: 'continue', note: 'optional' },
  { action: D, intent: 'consent_choice', note: 'none' },
  { action: OFF, intent: 'consent_choice', note: 'none' },
  { action: 'amend_intent', intent: 'amend_intent', note: 'required' },
  { action: 'request_changes', intent: 'send_back', note: 'optional' },
  { action: 'reject', intent: 'stop', note: 'none' },
] as GateAction[];
const gate = (): OpenGate => ({
  runId: RUN, ord: 9, prompt: 'Consent needed before unit 9 runs — nothing in it has run yet.', lifecycle: 'open', receivedAt: 1, gateKind: 'consent',
  choices: [D, OFF, 'reject'], recommended: 0, actions: ACTIONS,
} as OpenGate);
const UNITS = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 7, stage: 'build', status: 'done' }),
  makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 8, stage: 'build', phase_ref: 'deliver', status: 'done' }),
  makeUnit({ id: `${RUN}:install`, session_id: RUN, ord: 9, stage: 'build', status: 'pending', tool_cmd: ['bash', '-c', 'install'] as never }),
];

describe('studio#1454 (1): the install consent card draws the install choices and Decline only', () => {
  it('drops the engine\'s ordinary answers the consent gate also lists', () => {
    const m = sessionGateChoices({ runId: RUN, gate: gate(), units: UNITS, events: [FRAME], pool: ['claude'], roster: null, actions: ACTIONS })!;
    expect(m.reason).toBe('consent');
    expect(choiceTokens([...m.choices, ...m.overflow])).toEqual([D, OFF, 'reject']);
    expect([...m.choices, ...m.overflow].map((c) => c.label)).toEqual(['Install for this daemon', 'Install, turned off', 'Decline']);
  });

  it('keeps a plain Approve on a consent gate that lists no install choice of its own', () => {
    const plain = [{ action: 'approve', intent: 'continue', note: 'none' }, { action: 'reject', intent: 'stop', note: 'none' }] as GateAction[];
    const g = { ...gate(), choices: ['approve', 'reject'], actions: plain } as OpenGate;
    const m = sessionGateChoices({ runId: RUN, gate: g, units: UNITS, events: [], pool: ['claude'], roster: null, actions: plain })!;
    expect(choiceTokens([...m.choices, ...m.overflow])).toEqual(['approve', 'reject']);
  });
});

describe('studio#1454 (2): Details names the PR the deliver step opened while a later gate waits', () => {
  beforeEach(() => {
    localStorage.removeItem(RUN_PANEL_KEY);
    resetRunPanel();
    useGateStore.setState({ gates: {}, approaching: {} });
    useTeamPlanStore.setState({ byRun: {}, refs: {} });
    usePlanCatalog.setState({ catalog: 'ready', entries: [] });
    useRunEventStore.setState({ byRun: { [RUN]: [FRAME] } });
    useRunAcceptanceStore.setState({ byRun: {} });
    useDeliveryStore.setState({ byRun: {} });
    setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [FRAME] } as never);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('reads the deliver step\'s output and says the pull request, never "Not delivered"', async () => {
    const output = vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({
      output: 'Pushed wicked/29848ff9 to origin.\nhttps://github.com/acme/wicked-e2e-j6-plugins/pull/16\n',
    } as never);
    // crew's wire while the consent gate waits: no `deliverUrl` yet (it is recorded once the run ends).
    const view: SessionView = makeView({ id: RUN, status: 'awaiting_human', unit_ix: 2, repo_ref: 'j6-plugins', delivery: 'none' } as never, UNITS);
    await act(async () => { render(<RunTab runs={[view]} sessionId={`run:${RUN}`} title="Make an editor plugin" />); });
    await waitFor(() => expect(screen.getByTestId('run-tab-glance-changes')).toHaveTextContent('Pull request #16'));
    expect(output).toHaveBeenCalledWith(RUN, `${RUN}:deliver`);
    expect(document.body.textContent).not.toContain('Not delivered');
  });
});
