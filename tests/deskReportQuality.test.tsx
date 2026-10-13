import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { DeskV2, DESK_TABS } from '../src/components/desk/DeskV2.js';
import { useQualityChecks } from '../src/hooks/useQualityChecks.js';
import { useProjectsStore } from '../src/store/projects.js';

const recordState = vi.hoisted(() => ({ truncated: false, projectTruncated: false, projectMap: new Map<string, unknown[]>() }));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/hooks/useQualityChecks.js', () => ({ useQualityChecks: vi.fn() }));
vi.mock('../src/hooks/useRoster.js', () => ({ useRoster: () => [] }));
vi.mock('../src/hooks/useDeskRecord.js', () => ({
  useDeskRecord: () => ({ phase: 'done', reads: recordState.truncated ? [{ truncated: true, seats: [] }] : [], window: null, truncated: recordState.truncated }),
  useDeskRecordByProject: () => ({ phase: 'done', byProject: recordState.projectMap, truncated: recordState.projectTruncated }),
}));
vi.mock('../src/hooks/useWindowSpend.js', () => ({ useWindowSpend: () => ({ phase: 'done', current: 0, previous: null, partial: false }) }));
vi.mock('../src/hooks/useStandingOrders.js', () => ({ useStandingOrders: () => ({ state: null }) }));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({}) }));

const NOW = Date.UTC(2026, 9, 13);
const DAY = 86_400_000;
const run = (id: string, days: number, project = 'p1'): SessionView => ({
  session: { id, status: 'completed', created_at: (NOW - days * DAY) / 1000, project_id: project, run_identity: { kind: 'workflow', name: 'bug' } },
  units: [],
} as unknown as SessionView);
const qualityMock = vi.mocked(useQualityChecks);

beforeEach(() => {
  recordState.truncated = false;
  recordState.projectTruncated = false;
  recordState.projectMap = new Map();
  // Every API-backed hook used by this report is mocked; reject any unexpected fetch locally.
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected fetch in Desk test'))));
  useProjectsStore.setState({ projects: [], load: vi.fn(async () => {}) });
  qualityMock.mockReset();
  qualityMock.mockReturnValue({ tally: { read: 2, recorded: 2, passed: 1 }, failed: 0, capped: false });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function report(runs = [run('older', 2), run('newer', 1)], projectId?: string): void {
  render(<DeskV2 runs={runs} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()} search="?tab=report"
    {...(projectId === undefined ? {} : { projectId })} />);
}

function expectQuality(value: string, note: string): void {
  const tile = screen.getByTestId('desk-stat-quality');
  expect(tile.querySelector('.wk-stat-value')).toHaveTextContent(value);
  expect(tile.querySelector('.wk-stat-note')).toHaveTextContent(note);
}

describe('Report quality checks', () => {
  it.each([undefined, 'p1'])('labels truncated spend on Desk/project %s and omits unknown buckets', (projectId) => {
    recordState.truncated = true;
    report(undefined, projectId);
    const spend = screen.getByTestId('desk-viz-spend');
    expect(spend).toHaveTextContent('Partial: the agent record left out older runs');
    expect(spend).toHaveTextContent('Spend buckets affected by truncated reads are unknown and omitted');
    expect(screen.queryByTestId('desk-chart-spend')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-stat-spend').querySelector('.wk-stat-value')).toHaveTextContent('—');
  });

  it('labels truncation when spend is grouped by project', () => {
    recordState.projectTruncated = true;
    report();
    fireEvent.click(screen.getByTestId('desk-groupby-project'));
    expect(screen.getByTestId('desk-viz-spend')).toHaveTextContent('Partial: the agent record left out older runs');
    expect(screen.queryByTestId('desk-chart-spend')).not.toBeInTheDocument();
  });

  it('by project, a truncated project is left out while complete projects with spend still draw', () => {
    recordState.projectTruncated = true;
    // p1 complete with $5 in its one bucket; p2's read was capped (truncated).
    recordState.projectMap = new Map<string, unknown[]>([
      ['p1', [{ truncated: false, seats: [{ cli: 'claude', costUsd: 5, units: 1 }] }]],
      ['p2', [{ truncated: true, seats: [{ cli: 'claude', costUsd: 9, units: 1 }] }]],
    ]);
    report([run('older', 2), run('newer', 1), run('other', 1, 'p2')]);
    fireEvent.click(screen.getByTestId('desk-groupby-project'));
    const spend = screen.getByTestId('desk-viz-spend');
    expect(spend).toHaveTextContent('Partial: the agent record left out older runs');
    // The complete project draws; the stat says the total is partial rather than a plain verdict.
    expect(screen.getByTestId('desk-chart-spend')).toBeInTheDocument();
    expect(screen.getByTestId('desk-stat-spend').querySelector('.wk-stat-note')).toHaveTextContent('Partial');
  });

  it.each([undefined, 'p1'])('shows the quality tile on the Desk/project %s', (projectId) => {
    report(undefined, projectId);
    expect(within(screen.getByTestId('desk-stats')).getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByTestId('desk-stat-quality')).toHaveTextContent('Quality checks passed');
    expectQuality('1 of 2', 'checks passed of those recorded');
    expect(qualityMock).toHaveBeenLastCalledWith(['newer', 'older'], '0');
  });

  it('uses the refined window, newest first, and the work fingerprint', () => {
    const runs = [run('older', 2), run('outside', 31), run('newer', 1)];
    runs[2]!.units = [{ status: 'done', seat: 'claude' } as unknown as NonNullable<SessionView['units']>[number]];
    report(runs);
    expect(qualityMock).toHaveBeenLastCalledWith(['newer', 'older'], '1');
    fireEvent.change(screen.getByTestId('desk-refine-project'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByTestId('desk-range-7'));
    expect(qualityMock).toHaveBeenLastCalledWith(['newer', 'older'], '1');
  });

  it('has a null value and reading note while checks are being read', () => {
    qualityMock.mockReturnValue({ tally: null, failed: 0, capped: false });
    report();
    expectQuality('…', 'Reading checks…');
    expect(screen.getByTestId('desk-stat-quality').querySelector('.wk-stat-value')).toHaveAttribute('aria-busy', 'true');
  });

  it.each([
    { read: 0, recorded: 0, passed: 0, failed: 2, capped: false, note: 'Checks could not be read' },
    { read: 1, recorded: 1, passed: 1, failed: 1, capped: false, note: '1 could not be read; of the rest' },
    { read: 1, recorded: 0, passed: 0, failed: 1, capped: false, note: '1 could not be read; none recorded for the rest' },
    { read: 20, recorded: 3, passed: 2, failed: 0, capped: true, note: 'of the newest 20 jobs' },
    { read: 20, recorded: 0, passed: 0, failed: 0, capped: true, note: 'no checks recorded for the newest 20 jobs' },
    { read: 2, recorded: 0, passed: 0, failed: 0, capped: false, note: 'no checks recorded for these 2 jobs' },
  ])('preserves the note "$note"', ({ read, recorded, passed, failed, capped, note }) => {
    qualityMock.mockReturnValue({ tally: { read, recorded, passed }, failed, capped });
    report();
    expectQuality(recorded === 0 ? '—' : `${passed} of ${recorded}`, note);
    expect(screen.getByTestId('desk-stat-quality').querySelector('.wk-stat-value')).not.toHaveAttribute('aria-busy');
  });

  it.each([
    { runs: [], note: 'no jobs in the last 30 days' },
    { runs: [run('one', 1)], note: 'no checks recorded for these 1 job' },
  ])('preserves the empty/singular note "$note"', ({ runs, note }) => {
    qualityMock.mockReturnValue({ tally: { read: runs.length, recorded: 0, passed: 0 }, failed: 0, capped: false });
    report(runs);
    expectQuality('—', note);
  });

  it('gives Desk links roving focus, navigates by keyboard, and labels every selected panel', () => {
    const navigate = vi.fn();
    const props = { runs: [], runsLoaded: true, needRows: [], now: NOW, navigate, projectId: 'p1' };
    const { rerender } = render(<DeskV2 {...props} search="?tab=report" />);
    const tabs = within(screen.getByTestId('desk-tabs')).getAllByRole('tab');
    expect(tabs.filter((t) => t.tabIndex === 0)).toEqual([screen.getByTestId('desk-tab-report')]);
    const selected = screen.getByTestId('desk-tab-report');
    selected.focus();
    fireEvent.keyDown(selected, { key: 'End' });
    const last = tabs.at(-1)!;
    expect(last).toHaveFocus();
    expect(navigate).toHaveBeenLastCalledWith(last.getAttribute('href'));
    fireEvent.keyDown(last, { key: 'ArrowRight' });
    expect(tabs[0]).toHaveFocus();
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1');
    for (const tab of DESK_TABS) {
      if (tab.id === 'work') continue;
      rerender(<DeskV2 {...props} search={`?tab=${tab.id}`} />);
      const active = screen.getByTestId(`desk-tab-${tab.id}`);
      const panel = screen.getByRole('tabpanel', { name: tab.label });
      expect(active).toHaveAttribute('aria-controls', panel.id);
      expect(panel).toHaveAttribute('aria-labelledby', active.id);
    }
  });
});
