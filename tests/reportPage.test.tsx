import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { SeatRecord, SeatRecordResponse, SessionView } from '../src/api/types.js';
import type { SystemSnapshot } from '../src/api/system.js';
import { ReportPage } from '../src/components/report/ReportPage.js';
import { useSystemStore } from '../src/store/systemSnapshot.js';

const NOW = new Date(2026, 9, 26, 9, 52).getTime();
const DAY = 86_400_000;

const mocks = vi.hoisted(() => ({ cur: null as unknown, wide: null as unknown, asked: [] as number[][] }));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/hooks/useQualityChecks.js', () => ({ useQualityChecks: () => ({ tally: { read: 3, recorded: 2, passed: 2 }, failed: 0, capped: false }) }));
vi.mock('../src/hooks/useReportRecord.js', () => ({
  // Every edge up to 7 days back answers `cur`; older edges answer `wide` (the 14-day read).
  useReportRecord: (days: readonly number[]) => { mocks.asked.push([...days]); return { phase: 'done', reads: new Map(days.map((d) => [d, d <= 7 ? mocks.cur : mocks.wide])) }; },
}));
vi.mock('../src/store/systemSnapshot.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/store/systemSnapshot.js')>();
  return { ...original, useSystemPoll: () => undefined };
});

function seat(cli: string, units: number, gated: number, firstPass: number, costUsd: number | null): SeatRecord {
  return { cli, units, gated, firstPass, rework: 0, stalls: 0, benched: 0, benchReasons: {}, costUsd, costedUsage: costUsd === null ? 0 : 1, byPhase: {} };
}
const rec = (seats: SeatRecord[]): SeatRecordResponse => ({ days: 7, since: 0, until: NOW, runsRead: 1, truncated: false, seats });

function job(id: string, over: Record<string, unknown> = {}): SessionView {
  return { session: { id, title: `Job ${id}`, problem: `Job ${id}`, status: 'completed', delivery: 'none', created_at: (NOW - DAY - 3_600_000) / 1000, ended_at: (NOW - DAY) / 1000, repo_ref: 'wicked-core', ...over }, units: [] } as unknown as SessionView;
}

const snapshot = {
  checkedAt: NOW, attention: [], runs: [], infra: [],
  clis: [{ key: 'claude', name: 'Claude Code', statsDays: 7, medianMs: 120_000, rateLimited: 3 }],
  governance: [
    { key: 'floor_outcomes', name: 'Floor outcomes', value: '6', state: 'ok', detail: null, remedy: null, breakdown: null, counts: { passed: 4, failed: 1, timed_out: 1, not_run: 0 }, since: NOW - 7 * DAY },
    { key: 'gates_answered', name: 'Gates answered', value: '9', state: 'ok', detail: null, remedy: null, breakdown: null, counts: { byYou: 5, byJudges: 4 }, since: NOW - 7 * DAY },
  ],
} as unknown as SystemSnapshot;

function page(runs: SessionView[], projectId?: string): void {
  render(<ReportPage runs={runs} runsShown now={NOW} navigate={vi.fn()} agentName={(c) => (c === 'claude' ? 'Claude Code' : c)} pathOfRun={(id) => `/runs/${id}`} work="w"
    {...(projectId !== undefined ? { projectId } : {})} />);
}

const runs = (): SessionView[] => [
  job('pr', { delivery: 'delivered', deliverUrl: 'https://github.com/o/r/pull/12' }),
  job('answer', { repo_ref: 'tiny' }),
  job('fail', { status: 'failed' }),
  job('before', { ended_at: (NOW - 10 * DAY) / 1000, created_at: (NOW - 10 * DAY - 7_200_000) / 1000, delivery: 'delivered', deliverUrl: 'https://github.com/o/r/pull/9' }),
];

beforeEach(() => {
  mocks.asked = [];
  mocks.cur = rec([seat('claude', 8, 8, 6, 4), seat('codex', 2, 2, 2, null)]);
  mocks.wide = rec([seat('claude', 12, 12, 8, 10), seat('codex', 2, 2, 2, null)]);
  useSystemStore.setState({ mode: 'system', snapshot });
});
afterEach(() => { cleanup(); useSystemStore.setState({ mode: 'unknown', snapshot: null }); });

describe('Report page (ui-v2)', () => {
  it('leads with a title, one sentence and the period as the one control', () => {
    page(runs());
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Report');
    expect(screen.getByTestId('report-lede')).toHaveTextContent('Last 7 days: 3 jobs finished, 1 delivered, at least $4.00 spent.');
    expect(within(screen.getByTestId('report-period')).getAllByRole('radio').map((r) => r.textContent)).toEqual(['7 days', '30 days', 'Custom']);
    expect(screen.queryByTestId('desk-refine')).not.toBeInTheDocument();
  });

  it('headline numbers each carry their change against the period before, with the colour of good or bad', () => {
    page(runs());
    expect(screen.getByTestId('report-tile-finished')).toHaveTextContent('3');
    expect(screen.getByTestId('report-tile-finished-change')).toHaveAttribute('data-tone', 'good');
    expect(screen.getByTestId('report-tile-finished-change')).toHaveTextContent('2 more than the 7 days before');
    // 8 of 10 checked steps: a count under 20, and no change claimed on so few.
    expect(screen.getByTestId('report-tile-firstpass').querySelector('.wk-rep-tile-value')).toHaveTextContent('8 of 10');
    expect(screen.queryByTestId('report-tile-firstpass-change')).not.toBeInTheDocument();
    // Time to PR: 1 h now against 2 h before: faster is good.
    expect(screen.getByTestId('report-tile-ttp')).toHaveTextContent('1.0 h');
    expect(screen.getByTestId('report-tile-ttp-change')).toHaveAttribute('data-tone', 'good');
    // Spend is partial (codex has no price): no change is claimed.
    expect(screen.getByTestId('report-tile-spend').querySelector('.wk-rep-tile-value')).toHaveTextContent('≥ $4.00');
    expect(screen.queryByTestId('report-tile-spend-change')).not.toBeInTheDocument();
  });

  it('spend going up is said in the colour of bad', () => {
    mocks.cur = rec([seat('claude', 8, 8, 6, 9)]);
    mocks.wide = rec([seat('claude', 12, 12, 8, 12)]);
    page(runs());
    const change = screen.getByTestId('report-tile-spend-change');
    expect(change).toHaveAttribute('data-tone', 'bad');
    expect(change).toHaveTextContent('$6.00 more than the 7 days before');
  });

  it('every chart has a sentence and a data table behind it', () => {
    page(runs());
    const flow = screen.getByTestId('report-throughput-chart');
    expect(flow).toHaveTextContent('3 jobs finished: 1 delivered, 1 done with nothing to ship, 1 failed.');
    fireEvent.click(screen.getByTestId('report-throughput-chart-table-toggle'));
    const table = within(flow).getByRole('table');
    expect(within(table).getByRole('rowheader', { name: 'Delivered' })).toBeInTheDocument();
    expect(within(screen.getByTestId('report-spend-chart')).getByRole('table')).toBeInTheDocument();
  });

  it('quality shows QE acceptance, floor outcomes with overridden not tracked, and who answered the gates', () => {
    page(runs());
    expect(screen.getByTestId('report-qe')).toHaveTextContent('2 of 2');
    const floors = screen.getByTestId('report-floors');
    expect(floors).toHaveTextContent('4 of 6');
    expect(within(floors).getByTestId('report-not-tracked')).toHaveAttribute('data-feed', 'floor-overridden');
    expect(screen.getByTestId('report-gates')).toHaveTextContent('By you5');
    expect(screen.getByTestId('report-gates')).toHaveTextContent('By judges4');
  });

  it('crew’s 7-day counts are not shown for another period: they say so and offer the 7 days', () => {
    page(runs());
    fireEvent.click(screen.getByTestId('report-period-30'));
    const floors = screen.getByTestId('report-floors');
    expect(floors).toHaveTextContent('Crew counts floor outcomes for the last 7 days only.');
    expect(floors).not.toHaveTextContent('4 of 6');
    expect(within(screen.getByTestId('report-agents-table')).getAllByTestId('report-not-tracked').length).toBeGreaterThan(0);
    fireEvent.click(within(floors).getByRole('button', { name: 'Show the last 7 days' }));
    expect(screen.getByTestId('report-period-7')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('report-floors')).toHaveTextContent('4 of 6');
  });

  it('by agent: steps, pass rate, median step, 429s and cost; sortable', () => {
    page(runs());
    const table = screen.getByTestId('report-agents-table');
    const first = within(table).getAllByRole('row')[1]!;
    expect(first).toHaveTextContent('Claude Code');
    expect(first).toHaveTextContent('2.0 min');
    expect(first).toHaveTextContent('3');
    expect(first).toHaveTextContent('$4.00');
    expect(within(table).getAllByRole('row')[2]).toHaveTextContent('no price');
    fireEvent.click(screen.getByTestId('report-agents-table-sort-units'));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('codex');
    expect(within(table).getByRole('columnheader', { name: /Steps/ })).toHaveAttribute('aria-sort', 'ascending');
  });

  it('by repository: one row per repo with spend not tracked; spend per repository is not tracked', () => {
    page(runs());
    const table = screen.getByTestId('report-repos-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('wicked-core');
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('1 of 2');
    expect(within(table).getAllByTestId('report-not-tracked').every((n) => n.dataset.feed === 'spend-per-repo')).toBe(true);
    expect(within(screen.getByTestId('report-spend-repos')).getByTestId('report-not-tracked')).toHaveTextContent('Not tracked yet');
  });

  it('shipped lists the delivered PRs; whether they merged is not tracked', () => {
    page(runs());
    const rows = screen.getAllByTestId('report-shipped-row');
    expect(rows).toHaveLength(1);
    expect(within(rows[0]!).getByTestId('report-shipped-pr')).toHaveAttribute('href', 'https://github.com/o/r/pull/12');
    expect(rows[0]).toHaveTextContent('PR #12');
    expect(screen.getByTestId('report-shipped')).toHaveTextContent('Merged or closed:');
    expect(within(screen.getByTestId('report-shipped')).getByTestId('report-not-tracked')).toHaveAttribute('data-feed', 'pr-state');
  });

  it('a custom range reads its own edges and refuses one it cannot show', () => {
    page(runs());
    fireEvent.click(screen.getByTestId('report-period-custom'));
    fireEvent.change(screen.getByTestId('report-custom-from'), { target: { value: '2026-10-20' } });
    fireEvent.change(screen.getByTestId('report-custom-to'), { target: { value: '2026-10-22' } });
    expect(mocks.asked.at(-1)).toEqual([4, 5, 6, 7, 10]);
    expect(screen.getByTestId('report-lede')).toHaveTextContent(/^Oct 20 – Oct 22:/);
    fireEvent.change(screen.getByTestId('report-custom-from'), { target: { value: '2026-10-24' } });
    expect(screen.getByTestId('report-custom-note')).toHaveTextContent('The start date is after the end date.');
    expect(screen.getByTestId('report-custom-note')).toHaveAttribute('role', 'alert');
    // The last good period stays on screen.
    expect(screen.getByTestId('report-lede')).toHaveTextContent(/^Oct 20 – Oct 22:/);
  });

  it('work in no project has no record of its own: said, never $0', () => {
    page(runs(), 'default');
    expect(screen.getByTestId('report-tile-spend')).toHaveTextContent('spend is counted per project');
    expect(screen.getByTestId('report-tile-spend')).not.toHaveTextContent('$0');
    expect(screen.getByTestId('report-cost')).toHaveTextContent('Spend is counted per project');
  });
});
