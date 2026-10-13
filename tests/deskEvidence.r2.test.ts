import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { RosterSeat, SeatRecord, SeatRecordResponse, SessionStatus } from '../src/api/types.js';
import { api } from '../src/api/client.js';
import {
  agentRows, bucketsOf, callouts, DEFAULT_REFINE, governanceOf, jobSeries, outcomeOf,
  outcomeRows, recentlyEnded, seatDeltas, spendSeries, spendTotals, uncheckedFallbacks, workflowOf, workflowRows,
} from '../src/board/deskInsights.js';
import { compareAgents, compareJobs, compareProjects } from '../src/board/deskCompare.js';
import { runsView } from '../src/board/deskRuns.js';
import { statusWord } from '../src/board/statusWords.js';
import { resetDeskRecord, useDeskRecord, useDeskRecordByProject } from '../src/hooks/useDeskRecord.js';
import { DAY, NOW, deskRun, names, title } from './fixtures/deskV2.js';

vi.mock('../src/api/client.js', () => ({ api: { getSeatRecord: vi.fn() } }));

const seat = (cli: string, overrides: Partial<SeatRecord> = {}): SeatRecord => ({
  cli, units: 2, gated: 0, firstPass: 0, rework: 0, stalls: 0, benched: 0, benchReasons: {},
  costUsd: 12, costedUsage: 4, byPhase: {}, ...overrides,
});
const record = (overrides: Partial<SeatRecordResponse> = {}): SeatRecordResponse => ({
  days: 7, since: NOW - 7 * DAY, until: NOW, runsRead: 1, truncated: false,
  seats: [seat('claude')], ...overrides,
});
const roster = (governance_class: RosterSeat['governance_class']): RosterSeat[] => [
  { key: 'claude', governance_class } as RosterSeat,
];

beforeEach(() => { resetDeskRecord(); vi.mocked(api.getSeatRecord).mockReset(); });
afterEach(cleanup);

describe('Desk evidence review fixes', () => {
  // Enumerated from the published SessionStatus contract; adding a state requires a mapping here.
  const outcomes = {
    planning: 'Working', distributing: 'Working', executing: 'Working', awaiting_human: 'Waiting on you',
    completed: 'Finished', cancelled: 'Stopped', failed: 'Failed',
  } satisfies Record<SessionStatus, string>;

  it.each(Object.entries(outcomes))('maps published %s to %s', (status, expected) => {
    const v = deskRun('r', { status: status as SessionStatus });
    expect(outcomeOf(v)).toBe(expected);
    expect(statusWord(v).word).toBe(status === 'cancelled' ? 'Cancelled' : expected);
    if (expected === 'Working') expect(statusWord(v).tone).toBe('run');
  });

  it('keeps distributing and unknown statuses out of ended counts on every Desk model', () => {
    const distributing = deskRun('distributing', { status: 'distributing' });
    const unknown = deskRun('unknown', { status: 'future_status' as SessionStatus });
    const completed = deskRun('completed');
    const runs = [distributing, unknown, completed];
    expect(statusWord(unknown)).toEqual({ word: 'Unknown', tone: 'quiet' });
    expect(outcomeOf(unknown)).toBeNull();
    expect(outcomeOf(deskRun('paused', { status: 'paused' as SessionStatus }))).toBeNull();
    expect(recentlyEnded(runs, title, 5).map((r) => r.runId)).toEqual(['completed']);
    const list = runsView(runs, DEFAULT_REFINE, 'all', '', NOW, title, names);
    expect(list.stats).toMatchObject({ running: 1, ended: 1 });
    expect(list.rows.find((r) => r.id === 'unknown')?.outcome).toBe('Unknown');
    expect(workflowRows(runs)[0]).toMatchObject({ finished: 1, stopped: 0, open: 2, successRate: 1 });
    expect(agentRows(record(), runs, names, [])[0]).toMatchObject({ jobsEnded: 1, jobsFinished: 1 });
    expect(jobSeries(runs, bucketsOf(7, NOW), 'outcome', names).map((s) => s.key)).toEqual(['Finished', 'Working']);
    expect(outcomeRows(runs, 'workflow', names)[0]?.counts).toMatchObject({ Finished: 1, Working: 1, Stopped: 0 });
    const projects = compareProjects(['studio'], runs, names.project);
    expect(projects.cards[0]?.cells[projects.rows.indexOf('Finished')]?.text).toBe('1 of 1');
    const jobs = compareJobs([unknown], title, names.agent, () => null);
    expect(jobs.cards[0]?.cells[jobs.rows.indexOf('Outcome')]?.text).toBe('Unknown');
  });

  it('groups named presets with workflows and keeps unknown launches apart from free text', () => {
    const preset = deskRun('preset', { run_identity: { kind: 'preset', name: 'capture-learnings', user_plan: false, system: false } });
    const workflow = deskRun('workflow', { run_identity: { kind: 'workflow', name: 'capture-learnings', user_plan: false, system: false } });
    const unknown = deskRun('unknown', { run_identity: { kind: 'unknown', name: null, user_plan: false, system: false } });
    const free = deskRun('free', { run_identity: { kind: 'free_text', name: null, user_plan: false, system: false } });
    expect(workflowOf(preset)).toEqual({ key: 'capture-learnings', label: 'Capture learnings' });
    expect(workflowOf(unknown)).toEqual({ key: 'unknown', label: 'Unknown workflow' });
    const legacy = deskRun('legacy');
    delete legacy.session.run_identity;
    expect(workflowOf(legacy)).toEqual(workflowOf(unknown));
    expect(workflowOf(free)).toEqual({ key: 'free_text', label: 'Free-text job' });
    expect(workflowRows([preset, workflow, unknown, free]).map((r) => [r.key, r.jobs])).toEqual([
      ['capture-learnings', 2], ['free_text', 1], ['unknown', 1],
    ]);
    expect(runsView([preset, unknown, free], { ...DEFAULT_REFINE, workflow: 'capture-learnings' }, 'all', '', NOW, title, names).rows.map((r) => r.id)).toEqual(['preset']);
  });

  it('divides cost by priced usage records, labels it accurately, and retains strict best marks', () => {
    const rows = agentRows(record({ seats: [seat('claude'), seat('codex', { units: 100, costUsd: 16 })] }), [], names, []);
    expect(rows.find((r) => r.cli === 'claude')?.costPerPricedUse).toBe(3);
    const compare = () => compareAgents(rows, (cli) => governanceOf(cli, {}, []), () => 'red');
    const view = compare();
    const idx = view.rows.indexOf('Cost per priced use');
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(view.cards.find((c) => c.id === 'claude')?.cells[idx]).toMatchObject({ text: '$3.00', best: true, title: 'Cost divided by priced usage records.' });
    expect(view.cards.find((c) => c.id === 'codex')?.cells[idx]?.best).toBe(false);
    expect(view.differ.join(' ')).toContain('cheapest per priced use');
    rows[0]!.costPerPricedUse = rows[1]!.costPerPricedUse;
    expect(compare().cards.some((c) => c.cells[idx]?.best)).toBe(false);
  });

  it('omits spend buckets rather than subtracting capped run sets', () => {
    const full = record();
    const partial = record({ truncated: true });
    expect(seatDeltas(partial, full)).toEqual([]);
    expect(seatDeltas(full, partial)).toEqual([]);
    for (const reads of [[partial, full], [full, partial]]) {
      expect(spendSeries(reads, null, names)).toBeNull();
      expect(spendTotals(reads, null)).toBeNull();
    }
    expect(spendTotals([full], null)).toEqual([12]);
  });

  it('propagates any truncated cumulative read through the hook, including cached reads', async () => {
    vi.mocked(api.getSeatRecord).mockImplementation(async (days) => record({ days: days ?? 7, truncated: days === 1 }));
    const hook = renderHook(() => useDeskRecord(7, 1, null, 'work'));
    expect(hook.result.current).toMatchObject({ phase: 'loading', truncated: false });
    await waitFor(() => expect(hook.result.current.phase).toBe('done'));
    expect(hook.result.current.truncated).toBe(true);
    expect(hook.result.current.window?.truncated).toBe(false);
    const cached = renderHook(() => useDeskRecord(7, 1, null, 'work'));
    await waitFor(() => expect(cached.result.current.truncated).toBe(true));
    expect(api.getSeatRecord).toHaveBeenCalledTimes(7);
  });

  it('propagates project truncation while leaving complete projects usable', async () => {
    vi.mocked(api.getSeatRecord).mockImplementation(async (days, project) => record({ days: days ?? 7, ...(project === undefined ? {} : { project }), truncated: project === 'capped' && days === 1 }));
    const { result } = renderHook(() => useDeskRecordByProject(7, 1, ['full', 'capped'], 'work', true));
    expect(result.current.truncated).toBe(false);
    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(result.current.truncated).toBe(true);
    expect(spendTotals(result.current.byProject.get('capped')!, null)).toBeNull();
    expect(spendTotals(result.current.byProject.get('full')!, null)).not.toBeNull();
  });

  it('does not invent truncation for failed reads or complete reads', async () => {
    vi.mocked(api.getSeatRecord).mockResolvedValue(record());
    const full = renderHook(() => useDeskRecord(7, 1, null, 'full'));
    await waitFor(() => expect(full.result.current.phase).toBe('done'));
    expect(full.result.current.truncated).toBe(false);
    vi.mocked(api.getSeatRecord).mockRejectedValue(new Error('read failed'));
    const failed = renderHook(() => useDeskRecord(7, 1, null, 'failed'));
    await waitFor(() => expect(failed.result.current.phase).toBe('error'));
    expect(failed.result.current).toMatchObject({ window: null, truncated: false });
  });

  it('keeps unread or failed diagnostics unknown even for a capable roster seat', () => {
    expect(governanceOf('claude', null, roster('acp_input_governance'))).toEqual({ word: 'checks not read yet', tone: null, unchecked: 0 });
    expect(callouts({ agents: [], workflows: [], acp: null, openFailures: 0, days: 7 })).toEqual([]);
    expect(governanceOf('claude', {}, roster('acp_input_governance')).word).toBe('can check every action');
    expect(governanceOf('claude', {}, roster('os_sandbox')).word).toBe('can keep writes in a sandbox');
  });

  it('excludes deliberate enforced routing from unchecked counts and labels diagnostics scope', () => {
    const routed = { fallbacks: 7, kinds: { governance_requires_wrapped: 3, read_only_requires_wrapped: 4 } };
    expect(uncheckedFallbacks(routed)).toBe(0);
    expect(governanceOf('claude', { claude: routed }, roster('acp_input_governance')).word).toBe('can check every action');
    expect(callouts({ agents: [], workflows: [], acp: { claude: routed }, openFailures: 0, days: 7 })).toEqual([]);
    const mixed = { fallbacks: 15, kinds: { ...routed.kinds, binary_unavailable: 1, session_died: 2, auth_required: 1, auth_failed: 1, unauthenticated: 1, future_kind: 2 } };
    expect(uncheckedFallbacks(mixed)).toBe(8);
    // A fallback with no kind in the breakdown still counts (total minus the deliberate kinds).
    expect(uncheckedFallbacks({ fallbacks: 3, kinds: {} })).toBe(3);
    expect(uncheckedFallbacks({ fallbacks: 5, kinds: { governance_requires_wrapped: 2 } })).toBe(3);
    expect(governanceOf('claude', { claude: mixed }, []).word).toContain('8 times across all recorded runs (studio-wide)');
    const tips = callouts({ agents: [], workflows: [], acp: { claude: mixed }, openFailures: 0, days: 7, scoped: true });
    expect(tips[0]?.title).toContain('8 times across all recorded runs (studio-wide)');
    expect(tips[0]?.why).not.toMatch(/requires wrapped/);
    expect(tips[0]?.why).toContain('all recorded runs across studio');
    const rows = agentRows(record({ seats: [seat('claude'), seat('codex')] }), [], names, []);
    const compare = compareAgents(rows, (cli) => governanceOf(cli, { claude: mixed }, []), () => 'red');
    expect(compare.differ.join(' ')).toContain('across all recorded runs (studio-wide)');
  });
});
