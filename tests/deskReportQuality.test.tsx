import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SessionView } from '../src/api/types.js';
import { workFingerprint } from '../src/board/deskModel.js';
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
vi.mock('../src/hooks/useReportRecord.js', () => ({
  useReportRecord: (days: readonly number[]) => ({ phase: 'done', reads: new Map(days.map((d) => [d, recordState.truncated ? { truncated: true, seats: [] } : { truncated: false, seats: [] }])) }),
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
  render(<DeskV2 runs={runs} runsLoaded needRows={[]} now={NOW} navigate={vi.fn()} view="report" search="?tab=report"
    {...(projectId === undefined ? {} : { projectId })} />);
}

const ended = (id: string, days: number, project = 'p1'): SessionView => {
  const v = run(id, days + 1, project);
  (v.session as { ended_at?: number }).ended_at = (NOW - days * DAY) / 1000;
  return v;
};

function expectQe(value: string | null, note: string): void {
  const block = screen.getByTestId('report-qe');
  if (value !== null) expect(block.querySelector('.wk-rep-big')).toHaveTextContent(value);
  expect(block).toHaveTextContent(note);
}

describe('Report (ui-v2): quality and honesty', () => {
  it.each([undefined, 'p1'])('a truncated record draws no spend and claims no total (Desk/project %s)', (projectId) => {
    recordState.truncated = true;
    report([ended('older', 2), ended('newer', 1)], projectId);
    expect(screen.getByTestId('report-tile-spend').querySelector('.wk-rep-tile-value')).toHaveTextContent('—');
    expect(screen.getByTestId('report-tile-spend')).toHaveTextContent('Couldn’t read spend for this period');
    expect(screen.getByTestId('report-cost')).toHaveTextContent('Couldn’t read spend for every day of this period');
    expect(screen.queryByTestId('report-spend-chart')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-tile-firstpass').querySelector('.wk-rep-tile-value')).toHaveTextContent('—');
  });

  it('reads the QE verdicts of the jobs that finished in the period, newest first, with the work fingerprint', () => {
    const runs = [ended('older', 2), ended('outside', 9), ended('newer', 1)];
    report(runs);
    expect(qualityMock).toHaveBeenLastCalledWith(['newer', 'older'], workFingerprint(runs));
    expectQe('1 of 2', 'passed acceptance, of the finished jobs with a verdict');
    fireEvent.click(screen.getByTestId('report-period-30'));
    expect(qualityMock).toHaveBeenLastCalledWith(['newer', 'older', 'outside'], workFingerprint(runs));
  });

  it('says nothing while the verdicts are being read', () => {
    qualityMock.mockReturnValue({ tally: null, failed: 0, capped: false });
    report([ended('a', 1)]);
    expect(screen.getByTestId('report-qe').querySelector('.wk-rep-big')).toBeNull();
    expect(screen.getByTestId('report-qe')).not.toHaveTextContent('No QE verdict');
  });

  it.each([
    { read: 0, recorded: 0, passed: 0, failed: 2, capped: false, value: null, note: 'Couldn’t read the verdicts.' },
    { read: 1, recorded: 1, passed: 1, failed: 1, capped: false, value: '1 of 1', note: '1 couldn’t be read' },
    { read: 20, recorded: 3, passed: 2, failed: 0, capped: true, value: '2 of 3', note: 'the newest 20 jobs read' },
    { read: 2, recorded: 0, passed: 0, failed: 0, capped: false, value: null, note: 'No QE verdict recorded for these jobs.' },
    { read: 30, recorded: 25, passed: 20, failed: 0, capped: false, value: '80%', note: 'passed acceptance' },
  ])('says "$note"', ({ read, recorded, passed, failed, capped, value, note }) => {
    qualityMock.mockReturnValue({ tally: { read, recorded, passed }, failed, capped });
    report([ended('a', 1), ended('b', 2)]);
    expectQe(value, note);
  });

  it('with no job finished it says so, never 0%', () => {
    qualityMock.mockReturnValue({ tally: { read: 0, recorded: 0, passed: 0 }, failed: 0, capped: false });
    report([]);
    expectQe(null, 'No job finished in this period.');
    expect(screen.getByTestId('report-qe')).not.toHaveTextContent('0%');
  });
});

describe('Desk tabs', () => {
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

describe('Desk views after the sidebar regroup (ui-v2, 2026-10-26): pages on the Desk, tabs on a project', () => {
  const props = (navigate = vi.fn()) => ({ runs: [], runsLoaded: true, needRows: [], now: NOW, navigate });

  it('a project page shows every view as a tab, in the sidebar\'s names, with no More menu', () => {
    const navigate = vi.fn();
    render(<DeskV2 {...props(navigate)} projectId="p1" search="" />);
    const tabs = within(screen.getByTestId('desk-tabs')).getAllByRole('tab').map((t) => t.textContent);
    expect(tabs).toEqual(['Work', 'Jobs', 'Repositories', 'Report', 'Understand', 'Steering', 'Memory', 'Agents', 'Evaluate']);
    expect(tabs).toEqual(DESK_TABS.map((t) => t.label));
    expect(screen.queryByTestId('desk-tabs-more')).toBeNull();
    fireEvent.click(screen.getByTestId('desk-tab-steer'));
    expect(navigate).toHaveBeenLastCalledWith('/projects/p1?tab=steer');
  });

  it('Needs you in full is a page of its own (/needs, the landing\'s "N more waiting"); a project page has no such tab', () => {
    const navigate = vi.fn();
    const { rerender } = render(<DeskV2 {...props(navigate)} view="inbox" search="" />);
    expect(screen.getByTestId('desk-inbox-view')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Needs you');
    expect(screen.queryByTestId('desk-tabs')).toBeNull();
    rerender(<DeskV2 {...props(navigate)} search="?tab=inbox" projectId="p1" />);
    expect(screen.queryByTestId('desk-inbox-view')).not.toBeInTheDocument();
    expect(screen.getByTestId('desk-tab-work')).toHaveAttribute('aria-selected', 'true');
  });

  it.each([['work', null], ['runs', 'Jobs'], ['report', 'Report'], ['understand', 'Understand']] as const)('the global %s view is a page: no tabs, titled %s', (view, title) => {
    render(<DeskV2 {...props()} view={view} search="?tab=memory" />);
    expect(screen.queryByTestId('desk-tabs')).toBeNull();
    // No tab names a Desk view (a page's own tabs, like the inbox's folders, are its business).
    for (const t of DESK_TABS) expect(screen.queryByRole('tab', { name: t.label })).toBeNull();
    // `?tab=` on a global page means nothing any more (App redirects the old addresses first).
    expect(screen.getByTestId('desk')).toHaveAttribute('data-tab', view);
    // Home is the landing: its greeting is its title (home v2); the others carry the page's one name.
    if (title === null) expect(screen.getByTestId('desk-work')).toHaveAttribute('data-home', 'v2');
    // One title: the calm page's own (the Desk's header would be a second h1 above it).
    else expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
  });
});
