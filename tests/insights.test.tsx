/**
 * Run insights (crew DES-RUNS-REVIEW-001 §7): the `insights` adapter hands the plugin content with no ids or paths
 * (ED-3) and keeps the anchor → recommendation map host-side; the plugin's trend lines carry interval bands and
 * grey, labelled small samples; the Nerve Center / Report line; Build & settings' Schedules (on/off, cadence, Run it
 * now, last review); where Accept lands.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { InsightsResponse, WorkflowSchedule } from '../src/api/insights.js';

const insights = vi.fn();
const schedules = vi.fn();
const saveSchedule = vi.fn();
const runNow = vi.fn();
vi.mock('../src/api/insights.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/insights.js')>()),
  insightsApi: {
    insights: () => insights(),
    schedules: () => schedules(),
    saveSchedule: (id: string, b: unknown) => saveSchedule(id, b),
    runNow: (id: string) => runNow(id),
    accept: vi.fn(),
    dismiss: vi.fn(),
  },
}));
vi.mock('../src/store/projects.js', () => {
  const state = { projects: [{ id: 'p1', name: 'Kestrel' }], load: async () => undefined };
  return { useProjectsStore: (pick: (s: typeof state) => unknown) => pick(state) };
});

const { InsightsAdapter, viewOf, scrub } = await import('../src/editors/insightsAdapter.js');
const { trendSvg, formatMetric, TREND_METRICS } = await import('../src/plugins/wicked-insights/plugin.js');
const { insightsLineWords, InsightsLine } = await import('../src/components/insights/InsightsLine.js');
const { SchedulesSection, scheduleLine } = await import('../src/components/insights/SchedulesSection.js');
const { acceptPath } = await import('../src/components/insights/InsightsPage.js');
const { sessionPath } = await import('../src/board/sessionModel.js');

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const RUN_ID = '6f11390c-aaaa-bbbb-cccc-1234567890ab';
const METRICS: InsightsResponse['metrics'] = [
  { id: 'pass_rate', label: 'Pass rate', kind: 'rate', unit: 'ratio', higherIsBetter: true },
  { id: 'spend', label: 'Spend per run', kind: 'median', unit: 'usd', higherIsBetter: false },
];
function response(): InsightsResponse {
  const review = (i: number, n: number) => ({
    runId: `review-${i}`,
    trigger: 'schedule' as const,
    scheduleId: 'review-recent-work',
    launchedAt: new Date(Date.UTC(2026, 9, 20 + i * 2)).toISOString(),
    endedAt: new Date(Date.UTC(2026, 9, 20 + i * 2, 1)).toISOString(),
    status: 'completed' as const,
    window: { startMs: Date.UTC(2026, 9, 18 + i * 2), endMs: Date.UTC(2026, 9, 20 + i * 2) },
    baselineWindows: [],
    projectIds: [],
    summary: 'Six runs failed; the rest passed. See /home/someone/.wicked/reviews/x.',
    interpreted: true,
    totals: { runs: n },
    series: [
      { metric: 'pass_rate' as const, window: { n, value: 0.8, interval: { lo: 0.6, hi: 0.9 } }, baseline: { n: 20, value: 0.9, interval: null }, verdict: n < 5 ? 'too-few' as const : 'no-change' as const },
      { metric: 'spend' as const, window: { n, value: 2, interval: { lo: 1.5, hi: 3 } }, baseline: { n: 20, value: 8, interval: null }, verdict: 'improved' as const },
    ],
    improvements: [{ metric: 'spend' as const, segment: 'all', line: 'Spend per run, all runs: $2.00, n=12, against $8.00 before (n=20).' }],
    regressions: [],
    recommendations: [{
      id: `review-${i}:resolve-stale`, candidate: 'resolve-stale', kind: 'resolve-stale' as const, title: 'Resolve 6 runs nobody closed',
      evidence: { line: '6 runs failed and were neither retried nor archived.', runs: [{ id: RUN_ID, title: 'Fix the export button' }], n: 6 },
      expectedEffect: 'A clean run list.', confidence: 'medium' as const, changeMind: 'If they are parked on purpose.', impact: 12, basis: 'pattern' as const,
      action: { runs: [RUN_ID] }, state: 'new' as const, reason: null, decidedAt: null, proposalId: null, proposalError: null,
    }],
    watching: [],
    error: null,
  });
  return { reviews: [review(1, 12), review(0, 3)], newRecommendations: 2, running: false, lastReview: null, metrics: METRICS, minSample: 5 };
}

describe('the insights adapter (what the plugin is handed)', () => {
  it('hands content with no run ids or paths, and keeps the anchor → recommendation map for the host', () => {
    const { view, anchors } = viewOf(response());
    const text = JSON.stringify(view);
    expect(text).not.toContain(RUN_ID);
    expect(text).not.toContain('review-1');
    expect(text).not.toContain('/home/');
    expect(view.reviews[0]?.recommendations[0]?.anchor).toBe('v0r0');
    expect(view.reviews[0]?.recommendations[0]?.runs).toEqual(['Fix the export button']);
    expect(anchors.get('v0r0')?.id).toBe('review-1:resolve-stale');
    expect(scrub('see ~/x and https://a.b/c')).toBe('see … and …');
  });

  it('builds one point per review, oldest first, and marks a sample under the minimum as small', () => {
    const { view } = viewOf(response());
    const pass = view.trends.find((t) => t.metric === 'pass_rate');
    expect(pass?.points.map((p) => p.n)).toEqual([3, 12]);
    expect(pass?.points.map((p) => p.small)).toEqual([true, false]);
  });

  it('is read-only, and a reload is a new version the plugin re-reads', async () => {
    const a = new InsightsAdapter(response());
    expect(a.artifact().readonly).toBe(true);
    expect(await a.write()).toMatchObject({ error: 'refused' });
    expect(a.reload(response())).toBe(2);
    expect((await a.read() as { version: number }).version).toBe(2);
    expect(a.recommendationAt('v9r9')).toBeUndefined();
  });
});

describe('the plugin\'s trend lines', () => {
  it('draw an interval band and grey, labelled points below the minimum sample', () => {
    const { view } = viewOf(response());
    const svg = trendSvg(view.trends.find((t) => t.metric === 'spend')?.points ?? [], 'usd');
    expect(svg.querySelector('polygon.band')).not.toBeNull();
    expect(svg.querySelectorAll('circle.pt.small')).toHaveLength(1);
    expect(svg.querySelector('text.lbl')?.textContent).toBe('n=3');
    expect(svg.querySelector('circle.small title')?.textContent).toContain('too few runs to tell');
    expect(formatMetric('ratio', 0.42)).toBe('42%');
    expect(formatMetric('minutes', 150)).toBe('2.5 h');
    expect(TREND_METRICS).toEqual(['spend', 'pass_rate', 'override_rate', 'wait_on_people', 'unresolved_rate']);
  });
});

describe('the one calm line (Nerve Center, Report)', () => {
  it('says how many are new, links to Insights, and says nothing on a crew without reviews', async () => {
    expect(insightsLineWords(3, true)).toBe('3 new recommendations → Insights');
    expect(insightsLineWords(1, true)).toBe('1 new recommendation → Insights');
    expect(insightsLineWords(0, true)).toBe('No new recommendations · Insights →');
    expect(insightsLineWords(null, false)).toBeNull();
    insights.mockResolvedValue(response());
    const navigate = vi.fn();
    render(<InsightsLine navigate={navigate} testId="nc-insights-line" />);
    const link = await screen.findByText('2 new recommendations → Insights');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith('/insights');
    cleanup();
    insights.mockResolvedValue(null);
    render(<InsightsLine navigate={navigate} testId="nc-insights-line" />);
    await waitFor(() => expect(insights).toHaveBeenCalled());
    expect(screen.queryByTestId('nc-insights-line')).toBeNull();
  });
});

describe('Schedules (Build & settings)', () => {
  const row = (over: Partial<WorkflowSchedule> = {}): WorkflowSchedule => ({
    id: 'review-recent-work', workflow: 'review-recent-work', everyHours: 48, enabled: true, projectIds: [], repoRef: null, problem: null,
    nextDueAt: '2026-10-29T05:00:00.000Z', lastRunId: null, lastRunAt: null, lastOutcome: null, lastNote: null, failures: 0,
    createdAt: '2026-10-27T05:00:00.000Z', updatedAt: '2026-10-27T05:00:00.000Z',
    lastReview: { runId: 'r', launchedAt: '2026-10-27T05:00:00.000Z', endedAt: '2026-10-27T05:10:00.000Z', status: 'completed' },
    ...over,
  });

  it('shows the cadence, the next run and the last review, and saves on/off, cadence and projects', async () => {
    expect(scheduleLine(row())).toMatch(/^Every 2 days, next .* · last review .*, completed$/u);
    expect(scheduleLine(row({ enabled: false, lastReview: null }))).toBe('Off (every 2 days when on) · no review yet');
    schedules.mockResolvedValue([row()]);
    saveSchedule.mockImplementation(async (_id: string, b: Record<string, unknown>) => ({ ...row(), ...b }));
    render(<SchedulesSection navigate={vi.fn()} />);
    const rowEl = await screen.findByTestId('schedule-row');
    expect(rowEl.textContent).toContain('Review recent work');
    expect(rowEl.textContent).toContain('All projects');
    fireEvent.change(screen.getByTestId('schedule-cadence'), { target: { value: '3' } });
    await waitFor(() => expect(saveSchedule).toHaveBeenCalledWith('review-recent-work', expect.objectContaining({ everyHours: 72, enabled: true })));
    fireEvent.click(screen.getByTestId('schedule-enabled'));
    await waitFor(() => expect(saveSchedule).toHaveBeenLastCalledWith('review-recent-work', expect.objectContaining({ enabled: false })));
  });

  it('Run it now starts it, and a refusal says crew\'s reason', async () => {
    schedules.mockResolvedValue([row()]);
    runNow.mockRejectedValueOnce(new Error('not started: another run is working (one governed run at a time)'));
    render(<SchedulesSection navigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('schedule-run-now'));
    expect(await screen.findByText(/Not started: not started: another run is working/u)).toBeTruthy();
    runNow.mockResolvedValueOnce({ runId: 'x', schedule: row() });
    fireEvent.click(screen.getByTestId('schedule-run-now'));
    expect(await screen.findByText(/Started\./u)).toBeTruthy();
  });

  it('says plainly when this crew has no schedules', async () => {
    schedules.mockResolvedValue(null);
    render(<SchedulesSection navigate={vi.fn()} />);
    expect(await screen.findByTestId('schedules-unsupported')).toBeTruthy();
  });
});

describe('where Accept lands', () => {
  const rec = response().reviews[0]!.recommendations[0]!;
  it('a proposal opens its approve queue, a setting its page, one run that run', () => {
    expect(acceptPath({ kind: 'proposal', proposalId: 'p' }, { ...rec, kind: 'steering-rule' })).toBe('/steering/proposals');
    expect(acceptPath({ kind: 'proposal', proposalId: 'p' }, { ...rec, kind: 'memory' })).toBe('/memory?view=proposals');
    expect(acceptPath({ kind: 'settings', section: 'seats' }, rec)).toBe('/agents');
    expect(acceptPath({ kind: 'runs', runIds: [RUN_ID] }, rec)).toBe(sessionPath(`run:${RUN_ID}`));
    expect(acceptPath({ kind: 'runs', runIds: [RUN_ID, 'b'] }, rec)).toBeNull();
  });
});
