import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RunAcceptanceView, SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { RunRibbon, RunTab } from '../src/components/session/RunTab.js';
import * as chainLine from '../src/components/session/ChainLine.js';
import { chainFromUnits } from '../src/board/chainModel.js';
import { ORPHANED_LINE } from '../src/board/sessionModel.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import * as sheets from '../src/store/sheets.js';
import { makeUnit, makeView } from './factories.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';

/** Open one of the panel's folding sections (only Now and the state's own section start open). */
function openSection(id: string): void {
  const toggle = screen.getAllByTestId('run-panel-toggle').find((t) => t.dataset['section'] === id)!;
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}

vi.mock('../src/api/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/api/client.js')>();
  return {
    ...original,
    api: { ...original.api, getRunEvents: vi.fn().mockResolvedValue({ events: [] }) },
  };
});

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  sheets.useSheets.setState({ open: null, pointed: null, stopping: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code (judge)', binary: 'claude', enabled_for_council: true }]);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  // Catch accidental transport calls; all intentional reads use the mocks above or cached stores.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function tab(runs: SessionView[] = [makeView()]): Promise<ReturnType<typeof render>> {
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<RunTab runs={runs} sessionId="chat-1" title="Fix the widget" />); });
  return result;
}

function phases(status: SessionView['session']['status'] = 'executing'): SessionView {
  return makeView({ status, unit_ix: 1, workflow_id: 'mcp-server' }, [
    makeUnit({ ord: 0, stage: 'recon', status: 'done' }),
    makeUnit({ ord: 1, stage: 'build', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ ord: 2, stage: 'review', assigned_cli: 'codex' }),
  ]);
}

describe('RunTab', () => {
  it('shows the empty session without a picker', async () => {
    await tab([]);
    expect(screen.getByTestId('run-tab-empty')).toHaveTextContent('No run in this session yet.');
    expect(screen.queryByTestId('run-tab')).toBeNull();
    expect(screen.queryByTestId('run-tab-run-pick')).toBeNull();
  });

  it('chooses the newest live run over a newer finished run, and lists every run by title', async () => {
    await tab([
      makeView({ id: 'old', problem: 'Old work' }),
      makeView({ id: 'live', problem: 'Live work', status: 'awaiting_human' }),
      makeView({ id: 'finished', problem: 'Finished work', status: 'completed' }),
    ]);
    expect(screen.getByTestId('run-tab')).toHaveAttribute('data-run-id', 'live');
    expect(screen.getByRole('combobox', { name: 'Which run' })).toHaveValue('live');
    expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['Old work', 'Live work', 'Finished work']);
    fireEvent.change(screen.getByTestId('run-tab-run-pick'), { target: { value: 'finished' } });
    expect(screen.getByTestId('run-tab')).toHaveAttribute('data-run-id', 'finished');
    expect(screen.getByTestId('run-tab-workflow')).toHaveTextContent('Finished');
    expect(screen.queryByTestId('run-tab-stop')).toBeNull();
  });

  it('chooses the newest run when all runs are terminal', async () => {
    await tab([makeView({ id: 'old', status: 'completed' }), makeView({ id: 'new', status: 'failed' })]);
    expect(screen.getByTestId('run-tab')).toHaveAttribute('data-run-id', 'new');
  });

  it('omits the picker for one run and renders workflow, status and repo', async () => {
    await tab([makeView({ workflow_id: 'mcp-server', repo_ref: 'repo:widget' })]);
    expect(screen.queryByTestId('run-tab-run-pick')).toBeNull();
    expect(screen.getByTestId('run-tab-workflow')).toHaveTextContent('MCP server Working');
    expect(screen.getByTestId('run-tab-repo').querySelector('code')).toHaveTextContent('repo:widget');
  });

  it.each([null, '', '   '])('omits an empty repo ref (%s)', async (repo_ref) => {
    await tab([makeView({ repo_ref })]);
    expect(screen.queryByTestId('run-tab-repo')).toBeNull();
  });

  it('marks only the first running phase as now and shows done steps with a check', async () => {
    await tab([phases()]);
    const rows = screen.getAllByTestId('run-tab-phase');
    expect(rows.map((row) => row.getAttribute('data-state'))).toEqual(['done', 'running', 'todo']);
    expect(rows[0]).toHaveTextContent('✓');
    expect(rows[1]).toHaveAttribute('data-current', 'true');
    expect(rows[1]).toHaveTextContent('now');
    expect(rows.filter((row) => row.getAttribute('data-current') === 'true')).toHaveLength(1);
  });

  it('uses the first todo phase when a live run has no running phase', async () => {
    await tab([phases('awaiting_human')]);
    expect(screen.getAllByTestId('run-tab-phase')[1]).toHaveAttribute('data-current', 'true');
  });

  it('never marks an unfinished phase as now in a terminal run', async () => {
    await tab([phases('completed')]);
    expect(screen.getAllByTestId('run-tab-phase').every((row) => row.getAttribute('data-current') === 'false')).toBe(true);
  });

  it('shows checked phases with a check and prefers the first of multiple running phases', async () => {
    const view = phases();
    const chain = chainFromUnits(view);
    chain.steps[0]!.state = 'checked';
    chain.steps[2]!.state = 'running';
    vi.spyOn(chainLine, 'useRunChain').mockReturnValue({ chain, teamError: null, retry: vi.fn() });
    await tab([view]);
    const rows = screen.getAllByTestId('run-tab-phase');
    expect(rows[0]).toHaveAttribute('data-state', 'checked');
    expect(rows[0]).toHaveTextContent('✓');
    expect(rows[1]).toHaveAttribute('data-current', 'true');
    expect(rows[2]).toHaveAttribute('data-current', 'false');
  });

  it('says when phases and agents are absent', async () => {
    await tab();
    expect(screen.getByTestId('run-tab-phases')).toHaveTextContent('No phases yet.');
    expect(screen.getByTestId('run-tab-agents')).toHaveTextContent('No agent has been assigned yet.');
  });

  it('dedupes agents, uses roster names, aggregates roles and opens a helper sheet', async () => {
    await tab([makeView({}, [
      makeUnit({ ord: 0, assigned_cli: 'claude' }),
      makeUnit({ ord: 1, assigned_cli: 'claude', role: 'evaluator' }),
      makeUnit({ ord: 2, assigned_cli: 'codex' }),
      makeUnit({ ord: 3, assigned_cli: 'reviewer', stage: 'review' }),
      makeUnit({ ord: 4, assigned_cli: '' }),
      makeUnit({ ord: 5, assigned_cli: ' ' }),
    ])]);
    openSection('agents');
    const rows = screen.getAllByTestId('run-tab-agent');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('data-cli', 'claude');
    expect(rows[0]).toHaveTextContent('Claude Code reviews');
    expect(rows[1]).toHaveTextContent('codex builds');
    expect(rows[2]).toHaveTextContent('reviewer reviews');
    fireEvent.click(within(rows[0]!).getByRole('button', { name: 'Claude Code' }));
    expect(sheets.useSheets.getState().open?.ref).toEqual({ kind: 'helper', runId: 'run-1', cli: 'claude' });
  });

  it.each([['reviewer'], ['JUDGE'], ['evaluation']])('recognizes the %s role as reviews', async (role) => {
    await tab([makeView({}, [Object.assign(makeUnit({ assigned_cli: 'claude' }), { role })])]);
    expect(screen.getByTestId('run-tab-agent')).toHaveTextContent('reviews');
  });

  it.each([[12.345, '$12.35'], [0, '$0.00'], [undefined, 'Not reported'], [NaN, 'Not reported'], [Infinity, 'Not reported'], ['12', 'Not reported']])('renders spend %s as %s', async (cost, words) => {
    const view = makeView();
    Object.assign(view.session, { cost_usd: cost });
    await tab([view]);
    expect(screen.getByTestId('run-tab-spend')).toHaveTextContent(words as string);
  });

  it('renders a string acceptance summary, and a structured summary’s line (DES-CHAT-NATIVE-RUN: nothing the thread used to say is lost)', async () => {
    const acceptance = { runId: 'run-1', summary: 'All checks passed.' } as unknown as RunAcceptanceView;
    useRunAcceptanceStore.setState({ byRun: { 'run-1': acceptance } });
    await tab();
    expect(screen.getByTestId('run-tab-acceptance')).toHaveTextContent('All checks passed.');
    act(() => useRunAcceptanceStore.setState({ byRun: { 'run-1': { ...acceptance, summary: { required: true, satisfied: true, line: 'Checked', walkthrough: null } } } }));
    expect(screen.getByTestId('run-tab-acceptance')).toHaveTextContent('Checked');
  });

  it('rig 0.15.8: a floor the operator overrode reads "Overridden by you", never "Passed" — the deliver card\'s words', async () => {
    const view = makeView({ status: 'awaiting_human' }, [makeUnit({ ord: 2, stage: 'build', status: 'done', assigned_cli: 'claude' })]);
    Object.assign(view.session, { assurance: { mode: 'full', required: ['qe_acceptance'], floorOverrides: [{ at: 1, by: 'local (human)', note: 'base red',
      floorOverride: { layer: 'repo_checks', resultId: 'run-1:unit-2:attempt-0:repo_checks', ord: 2, attempt: 0, label: 'floor overridden by operator' } }] } });
    useRunEventStore.setState({ byRun: { 'run-1': [{ type: 'repoChecksEvaluated', session: 'run-1', ord: 2, attempt: 0, passed: false, criterion: '', skipped: [],
      checks: [{ name: 'test', argv: [], source: '', exitCode: 1, timedOut: false, spawnError: null, durationMs: 1, stdoutTail: '', stderrTail: '', classification: 'base_red_unseparated', preExisting: [], regressions: [], failureIds: [] }] }] } });
    useRunAcceptanceStore.setState({ byRun: { 'run-1': { runId: 'run-1', summary: { required: true, satisfied: true, line: 'Accepted: the checks this run had to pass have passed.', walkthrough: null } } as unknown as RunAcceptanceView } });
    await tab([view]);
    openSection('checks');
    const checks = screen.getAllByTestId('run-panel-section').find((s) => s.dataset['section'] === 'checks')!;
    expect(within(checks).getByTestId('run-panel-summary')).toHaveTextContent('Overridden by you');
    expect(within(checks).getByTestId('run-tab-overridden')).toHaveTextContent('Overridden by you: test failed on this change and its base.');
    expect(within(checks).queryByTestId('run-tab-acceptance')).toBeNull();
    expect(within(checks).getByTestId('run-panel-summary').textContent).not.toBe('Passed');
    // a required acceptance that has not passed leads over the override (pr-xreview #899)
    act(() => useRunAcceptanceStore.setState({ byRun: { 'run-1': { runId: 'run-1', summary: { required: true, satisfied: false, line: 'Not accepted yet: QE FAIL.', walkthrough: null } } as unknown as RunAcceptanceView } }));
    expect(within(checks).getByTestId('run-panel-summary')).toHaveTextContent('Not passed');
    expect(within(checks).getByTestId('run-tab-acceptance')).toHaveTextContent('Not accepted yet: QE FAIL.');
    expect(within(checks).getByTestId('run-tab-overridden')).toBeTruthy();
  });

  it('shows the exported orphan warning only while the event trail says it is orphaned', async () => {
    useRunEventStore.setState({ byRun: { 'run-1': [{ type: 'runOrphaned', session: 'run-1', ord: 1, ts: 123 }] } });
    await tab();
    expect(screen.getByTestId('run-tab-orphaned')).toHaveTextContent(ORPHANED_LINE);
    expect(screen.getByTestId('run-tab-orphaned')).toHaveAttribute('role', 'status');
    act(() => useRunEventStore.setState({ byRun: { 'run-1': [] } }));
    expect(screen.queryByTestId('run-tab-orphaned')).toBeNull();
  });

  it('shows the stranded warning for a completed delivery', async () => {
    await tab([makeView({ status: 'completed', delivery: 'stranded' })]);
    expect(screen.getByTestId('run-tab-stranded')).toHaveTextContent('Nobody has taken this work yet: its delivery card is in the thread.');
    expect(screen.getByTestId('run-tab-stranded')).toHaveAttribute('role', 'status');
  });

  it('holds what the ⋯ sheet held: its steps fold mounts on first open, in the panel (no sheet opens)', async () => {
    await tab([phases()]);
    expect(screen.queryByTestId('sheet-steps')).toBeNull();
    const item = screen.getAllByTestId('run-panel-item-toggle').find((t) => t.dataset['item'] === 'steps')!;
    expect(item).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(item);
    expect(item).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('sheet-step-row')).toHaveLength(3);
    expect(sheets.useSheets.getState().open).toBeNull();
  });

  it('keeps going without stopping, and calls stopRun only on confirmation', async () => {
    const stop = vi.spyOn(sheets, 'stopRun').mockImplementation((ids) => {
      sheets.useSheets.setState({ stopping: { [ids[0]!]: 1 } });
      return 1;
    });
    await tab();
    fireEvent.click(screen.getByTestId('run-tab-stop'));
    expect(screen.getByTestId('run-tab-stop-confirm-row')).toBeInTheDocument();
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('run-tab-stop-keep'));
    expect(screen.queryByTestId('run-tab-stop-confirm-row')).toBeNull();
    expect(stop).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('run-tab-stop'));
    fireEvent.click(screen.getByTestId('run-tab-stop-confirm'));
    expect(stop).toHaveBeenCalledExactlyOnceWith(['run-1'], '“Fix the widget”');
    expect(screen.queryByTestId('run-tab-stop-confirm-row')).toBeNull();
    expect(screen.getByTestId('run-tab-stop')).toBeDisabled();
    expect(screen.getByTestId('run-tab-stop')).toHaveTextContent('Stopping…');
  });

  it('discards a confirmation when the run picker changes', async () => {
    await tab([makeView({ id: 'one' }), makeView({ id: 'two' })]);
    fireEvent.click(screen.getByTestId('run-tab-stop'));
    fireEvent.change(screen.getByTestId('run-tab-run-pick'), { target: { value: 'one' } });
    expect(screen.queryByTestId('run-tab-stop-confirm-row')).toBeNull();
  });

  it.each(['completed', 'cancelled', 'failed'] as const)('hides Stop for a %s run', async (status) => {
    await tab([makeView({ status })]);
    expect(screen.queryByTestId('run-tab-stop')).toBeNull();
  });

  it('always includes plain code text in tech details and wraps the code download', async () => {
    await tab([makeView({ base_commit: 'abc123', clis: ['claude', 'codex'], codebase_archive: {
      url: '/archive/run-1.zip', sha256: 'abc1234567890123', bytes: 1024, source: 'branch',
      tree: 'abc123', commit: 'abc123', created_at: 123, trigger: 'run_end',
    } })]);
    openSection('changes');
    expect(screen.getByTestId('run-tab-tech').querySelector('summary')).toHaveTextContent('Tech details');
    expect([...screen.getByTestId('run-tab-tech').querySelectorAll('code')].map((code) => code.textContent)).toEqual(['run-1', 'abc123', 'claude, codex']);
    expect(within(screen.getByTestId('run-tab-download')).getByRole('link', { name: 'Download code (.zip)' })).toHaveAttribute('download', 'run-1-codebase.zip');
  });

  it('falls back to the primary after the selected run disappears', async () => {
    const result = await tab([makeView({ id: 'one' }), makeView({ id: 'two' })]);
    fireEvent.change(screen.getByTestId('run-tab-run-pick'), { target: { value: 'one' } });
    await act(async () => result.rerender(<RunTab runs={[makeView({ id: 'two' })]} sessionId="chat-1" title="Fix the widget" />));
    expect(screen.getByTestId('run-tab')).toHaveAttribute('data-run-id', 'two');
    expect(screen.queryByTestId('run-tab-run-pick')).toBeNull();
  });
});

describe('RunRibbon', () => {
  it('summarizes the primary workflow, current phase, distinct agents and spend as plain text (the panel draws the button)', async () => {
    const view = phases();
    Object.assign(view.session, { cost_usd: 1.25 });
    view.units.push(makeUnit({ ord: 3, assigned_cli: 'claude' }));
    await act(async () => render(<RunRibbon runs={[view, makeView({ id: 'finished', status: 'completed' })]} />));
    const line = screen.getByTestId('run-ribbon-line');
    expect(line).toHaveTextContent('MCP server · Build · 2 agents · $1.25');
    expect(line.tagName).toBe('SPAN');
  });

  it('uses the status without a current phase and omits unreported spend', async () => {
    await act(async () => render(<RunRibbon runs={[makeView({ status: 'completed', workflow_id: 'qe-author-tests' })]} />));
    expect(screen.getByTestId('run-ribbon-line').textContent).toBe('Write tests · Finished · 0 agents');
  });

  it('uses the next todo phase of a live run', async () => {
    await act(async () => render(<RunRibbon runs={[phases('awaiting_human')]} />));
    expect(screen.getByTestId('run-ribbon-line')).toHaveTextContent('MCP server · Build · 2 agents');
  });

  it('handles a session without runs', () => {
    render(<RunRibbon runs={[]} />);
    expect(screen.getByTestId('run-ribbon-line')).toHaveTextContent('No run in this session yet.');
  });
});
