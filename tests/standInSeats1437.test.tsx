/**
 * studio#1437 (W12; the live proof wicked-core#1930 F8 asks for): a seated stand-in is named as one everywhere
 * studio names a seat. Fixture: the recorded wire of run b0ade71f (train 14), where the engine seated `claude~1`
 * (review) and `claude~2` (judge) and studio 0.16.18 still said "claude~1 reviews".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import fixture from './fixtures/run-b0ade71f-standin.json';
import type { SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import * as sheets from '../src/store/sheets.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';
import { seatedStandIns, helperNamer, standInLine } from '../src/board/standIn.js';
import { cliLabel, seatKeyName, seatLabel } from '../src/board/seatNames.js';
import { seatResponder } from '../src/board/responder.js';
import { seatName } from '../src/board/gateHeadline.js';
import { handoffRow } from '../src/board/powerMode.js';
import { sandboxOwner } from '../src/components/denialCopy.js';
import { assuranceKind, deliveryReceiptOf, passedWord, receiptOf, receiptWords, skipReasonWord, type AssuranceReceipt } from '../src/board/assuranceModel.js';
import { GateVerdict } from '../src/components/GateVerdict.js';
import { authorWord, seenByWords } from '../src/plugins/wicked-phase-report/workingDoc.js';
import { gateVerdict } from '../src/components/gateVerdictModel.js';
import { toRow } from '../src/editors/runEvents.js';
import { standInBase } from '../src/board/seatNames.js';
import type { CoreEvent } from '../src/api/types.js';
import type { HandoffStep } from '../src/api/power.js';

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return { ...original, api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }) } };
});

const FIXTURE = fixture as unknown as { run: SessionView; events: CoreEvent[] };
const RUN = FIXTURE.run;
const ROSTER = [{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }];
const REVIEW = "Claude Code stood in for the review, using Claude Code's default model: only Claude Code was signed in";
const JUDGE = "Claude Code stood in for the judge, using Claude Code's default model: only Claude Code was signed in";
const BARE = /\bclaude~\d/;

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  sheets.useSheets.setState({ open: null, pointed: null, stopping: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  setCachedRoster(ROSTER);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('studio#1437: a seated stand-in is named as one (run b0ade71f)', () => {
  it('reads both stand-ins from the run wire, each with the engine\'s own sentence', () => {
    const seats = seatedStandIns(RUN, ROSTER);
    expect(seats.get('claude~1')).toEqual({ key: 'claude~1', name: 'Claude Code (stand-in)', label: REVIEW, role: 'evaluator' });
    expect(seats.get('claude~2')).toEqual({ key: 'claude~2', name: 'Claude Code (stand-in)', label: JUDGE, role: 'judge' });
  });

  it('the session\'s unkeyed sentence labels a reviewer stand-in only when it can be only one', () => {
    const session = { assurance: { standInLabel: REVIEW, standIns: [{ key: 'claude~1', display: 'Claude Code', role: 'evaluator' }, { key: 'codex~2', display: 'Codex', role: 'evaluator' }] } };
    const two = seatedStandIns({ session, units: [] }, ROSTER);
    expect(two.get('claude~1')?.label).toBeNull();
    expect(two.get('codex~2')?.label).toBeNull();
    expect(two.get('codex~2')?.name).toBe('Codex (stand-in)');
    const one = seatedStandIns({ session: { assurance: { standInLabel: REVIEW, standIns: [session.assurance.standIns[0]] } }, units: [] }, ROSTER);
    expect(one.get('claude~1')?.label).toBe(REVIEW);
  });

  it('a program path is never a stand-in, whatever it ends with', () => {
    expect(standInBase('/tmp/check~1')).toBeNull();
    expect(standInBase('C:\\tools\\check~1')).toBeNull();
    expect(sandboxOwner('/tmp/check~1', ROSTER)).not.toMatch(/stand-in/);
    expect(standInBase('claude~1')).toBe('claude');
  });

  it('a receipt names the stand-in reviewer and judge, and never says no judge ran or only automatic checks', () => {
    const unit = (ord: number): unknown => (RUN.units.find((u) => u.ord === ord) as unknown as { assurance: unknown }).assurance;
    const build = receiptOf(unit(2))!;
    expect(build.standIns).toEqual([{ role: 'judge', seat: 'claude~2', label: JUDGE }]);
    expect(assuranceKind(build)).toBe('same-seat');
    expect(passedWord(build)).not.toBe('No judge ran');
    const review = receiptOf(unit(3))!;
    expect(assuranceKind(review)).toBe('same-seat');
    expect(passedWord(review)).toBe('Passed, judged by a stand-in');
    const words = receiptWords(review, true);
    expect(words.who).toContain('evaluated by Claude Code (stand-in)');
    expect(words.who).toContain('judged by Claude Code (stand-in)');
    expect(words.who).toContain('a stand-in, not a different helper');
    expect(words.who).not.toMatch(/separate seat|claude~/);
  });

  it('the gate verdict names the stand-in judge from the roles, not the legacy "claude, not distinct"', () => {
    const view = gateVerdict(FIXTURE.events, 3)!;
    expect(view.judgeCli).toBe('claude~2');
    expect(view.judgeDistinct).toBeNull();
    expect(view.judgeStandIn).toBe(JUDGE);
    const { container } = render(<GateVerdict view={view} phase="review" />);
    const text = container.textContent ?? '';
    expect(text).toContain('judge: Claude Code (stand-in)');
    expect(text).toContain(`${JUDGE}: a stand-in, not a different helper`);
    expect(text).not.toMatch(/same seat|single default runner|claude~/);
  });

  it('a delivery that mixes a stand-in gate with an ordinary one names both, and keeps a real missing judge', () => {
    const mixed: AssuranceReceipt = {
      mode: 'full', required: ['distinct_evaluator', 'judge'], ran: ['distinct_evaluator', 'judge'], skipped: [], creator: 'claude', evaluator: 'codex', judge: 'pi', tree: null, attempt: 0,
      standIns: [{ role: 'evaluator', seat: 'claude~1', label: REVIEW }, { role: 'judge', seat: 'claude~2', label: JUDGE }],
    };
    const who = receiptWords(mixed, true).who ?? '';
    expect(who).toContain('evaluated by codex, Claude Code (stand-in)');
    expect(who).toContain('judged by pi, Claude Code (stand-in)');
    // A stand-in-judged gate and a gate whose judge erred: "in part" whichever comes first.
    const standInGate = (u: unknown) => u;
    const judged = { ord: 1, assurance: { mode: 'full', required: ['judge'], ran: ['pinned_validator'], skipped: [{ instrument: 'judge', reason: 'stand_in', detail: JUDGE }], creator: 'claude', evaluator: null, judge: null, tree: null, attempt: 0, roles: [{ role: 'judge', seat: 'claude~2', filled: 'stand_in', state: 'answered', standIn: { cli: 'claude~2', label: JUDGE } }] } };
    const erred = { ord: 2, assurance: { mode: 'full', required: ['judge'], ran: ['pinned_validator'], skipped: [{ instrument: 'judge', reason: 'error', detail: 'the judge timed out' }], creator: 'claude', evaluator: null, judge: null, tree: null, attempt: 0 } };
    for (const units of [[judged, { ...erred, ord: 2 }], [{ ...erred, ord: 1 }, { ...judged, ord: 2 }]]) {
      const view = { session: { id: 'r', status: 'executing' }, units: units.map(standInGate) } as unknown as SessionView;
      const r = deliveryReceiptOf(view, [], null)!;
      expect(passedWord(r)).toBe('Judged in part');
    }
  });

  it('an answered stand-in is something that checked, even with nothing else run', () => {
    const r: AssuranceReceipt = { mode: 'full', required: ['judge'], ran: [], skipped: [{ instrument: 'judge', reason: 'stand_in', detail: null }], creator: 'claude', evaluator: null, judge: null, tree: null, attempt: 0, standIns: [{ role: 'judge', seat: 'claude~2', label: JUDGE }] };
    expect(passedWord(r)).toBe('Passed, judged by a stand-in');
    expect(passedWord({ ...r, standIns: undefined, skipped: [] })).toBe('Nothing verified');
  });

  it('an unlabelled stand-in still shows, by its name and role', () => {
    const seats = seatedStandIns({ session: { assurance: { standIns: [{ key: 'claude~2', display: 'Claude Code', role: 'judge' }] } }, units: [] }, ROSTER);
    expect(standInLine(seats.get('claude~2')!)).toBe('Claude Code (stand-in) stood in for the judge');
  });

  it('the phase report\'s own words name a stand-in author and recipient', () => {
    expect(authorWord({ kind: 'agent', id: 'agent:claude~1' })).toBe('Claude Code (stand-in) (agent)');
    const words = seenByWords({ engine: true, version: 1, sections: ['goal'], cut: [], at: 1, error: null, seenBy: [{ recipient: 'unit', cli: 'claude~1', ord: 3 }] }, () => 'Review');
    expect(words).toContain('Review (Claude Code (stand-in))');
    expect(words).not.toMatch(/claude~/);
  });

  it('the phase report keeps the stand-in seat and names it', () => {
    const distributed = FIXTURE.events.find((e) => e.type === 'unitDistributed')!;
    const row = toRow(distributed, RUN.session.id, 0, 'x', (cli) => seatKeyName(cli, ROSTER, () => null));
    expect(row?.data).toMatchObject({ seat: 'claude~1', seatName: 'Claude Code (stand-in)' });
    // A numbered roster instance's stand-in keeps its seat too.
    const numbered = toRow({ ...distributed, cli: 'codex#2~1' } as CoreEvent, RUN.session.id, 0, 'z', (cli) => seatKeyName(cli, ROSTER, () => null));
    expect(numbered?.data).toMatchObject({ seat: 'codex#2~1', seatName: 'Codex (2) (stand-in)' });
    const stepped = FIXTURE.events.find((e) => e.type === 'powerHandoffStepped')!;
    expect(toRow(stepped, RUN.session.id, 0, 'y', (cli) => seatKeyName(cli, ROSTER, () => null))?.data).toMatchObject({ seat: 'claude~1', seatName: 'Claude Code (stand-in)' });
  });

  it('every shared namer says "(stand-in)" and never the bare key, for the reviewer and the judge', () => {
    for (const key of ['claude~1', 'claude~2']) {
      expect(seatKeyName(key, ROSTER)).toBe('Claude Code (stand-in)');
      expect(seatKeyName(key, null)).toBe('Claude Code (stand-in)');
      expect(cliLabel(key)).toBe('Claude Code (stand-in)');
      expect(seatLabel({ key })).toBe('Claude Code (stand-in)');
      expect(helperNamer(ROSTER)(key)).toBe('Claude Code (stand-in)');
      expect(seatResponder(key, ROSTER).name).toBe('Claude Code (stand-in)');
      expect(seatName(key, null)).toBe('Claude Code (stand-in)');
      expect(seatName(key, 'Claude Code')).toBe('Claude Code (stand-in)');
      expect(sandboxOwner(key, ROSTER)).toBe('Claude Code (stand-in)');
    }
    // An ordinary seat keeps its name.
    expect(seatKeyName('claude', ROSTER)).toBe('Claude Code');
    expect(seatResponder('claude', ROSTER).name).toBe('Claude Code');
  });

  it('the hand-off row names the stand-in reviewer and never says "on its own seat"', () => {
    const steps = (RUN.session as unknown as { power: { handoff: { steps: HandoffStep[] } } }).power.handoff.steps;
    const review = steps.filter((s) => s.step === 'review').at(-1)!;
    expect(review.seat).toBe('claude~1');
    const row = handoffRow(review, 'standard', (cli) => seatResponder(cli, ROSTER).name);
    expect(row.who).toBe('Claude Code (stand-in)');
    expect(row.role).toBe('a stand-in review, not a different helper');
    expect(row.role).not.toMatch(/own seat/);
  });

  it('a receipt\'s stand_in skip reads as a stand-in', () => {
    expect(skipReasonWord('stand_in')).toBe('a stand-in checked instead');
  });

  it('the run panel names the stand-in and shows the engine\'s words for the review and the judge', async () => {
    let result!: ReturnType<typeof render>;
    await act(async () => { result = render(<RunTab runs={[RUN]} sessionId="chat-1" title="Stand-in job" />); });
    const helpers = screen.getByTestId('run-tab-glance-helpers').textContent ?? '';
    expect(helpers).toContain('Claude Code (stand-in)');
    expect(helpers).not.toMatch(BARE);
    const standIns = screen.getByTestId('run-tab-glance-standins').textContent ?? '';
    expect(standIns).toContain(REVIEW);
    expect(standIns).toContain(JUDGE);
    const toggle = screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === 'agents')!;
    if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
    const agent = screen.getAllByTestId('run-tab-agent').find((li) => li.dataset['cli'] === 'claude~1')!;
    expect(agent.textContent).toContain('Claude Code (stand-in)');
    expect(agent.textContent).toContain(REVIEW);
    // The judge stand-in has no step of its own and is still listed, with its sentence.
    const judge = screen.getAllByTestId('run-tab-agent').find((li) => li.dataset['cli'] === 'claude~2')!;
    expect(judge.textContent).toContain('Claude Code (stand-in) judges');
    expect(judge.textContent).toContain(JUDGE);
    // The rule receipt's reviewer reading (POL-2101 on this run) names the stand-in.
    const checks = screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === 'checks')!;
    if (checks.getAttribute('aria-expanded') !== 'true') fireEvent.click(checks);
    const reviewerReading = screen.queryAllByTestId('assurance-rule-reviewer').map((e) => e.textContent ?? '').join(' ');
    expect(reviewerReading).toContain('Claude Code (stand-in)');
    expect(reviewerReading).not.toMatch(BARE);
    // One name once on the Helpers line.
    expect(helpers.split('Claude Code (stand-in)').length - 1).toBe(1);
    // Helpers and spend (the spend line's unmetered seats included) never shows the bare key. The operator's own
    // skip note on this run quotes "claude~2" and is shown verbatim, so the whole page is not asserted.
    const agents = screen.getByTestId('run-tab-agents').textContent ?? '';
    expect(agents).not.toMatch(BARE);
    expect(screen.getByTestId('run-tab-spend').textContent).toContain('Claude Code (stand-in) not metered');
    expect(result.container.textContent ?? '').toContain('Claude Code (stand-in)');
  });
});
