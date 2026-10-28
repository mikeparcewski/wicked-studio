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
const words = await import('../src/editors/insightsWords.js');
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

describe('everyday words on the face, the detail behind "Why we think this"', () => {
  const base = response().reviews[0]!.recommendations[0]!;
  const judge = { ...base, candidate: 'setting-judge-wicked-e2e', kind: 'setting' as const, title: 'Sign in a second agent so a distinct judge can review',
    evidence: { ...base.evidence, line: 'A "judge_unavailable" escalation was overridden by a person in 5 runs on wicked-e2e.', n: 5 } };
  const reg = (metric: 'override_rate' | 'wait_on_people', value: number, baseline: number, unit = 'ratio') => ({ ...base, candidate: `regression-${metric}-all`, kind: 'issue' as const,
    title: 'x got worse for all runs', changeMind: 'If the work itself changed (bigger tasks in this window), the baseline is not comparable: watch one more window.',
    evidence: { line: 'Runs with an override, all runs: 75% (95% CI 41%–93%), n=8, against 12% before (n=34).', runs: [], metric, segment: 'all', n: 8, value, baseline, interval: { lo: 0.41, hi: 0.93 } }, unit });
  const M = [...METRICS, { id: 'override_rate' as const, label: 'Runs with an override', kind: 'rate' as const, unit: 'ratio' as const, higherIsBetter: false },
    { id: 'wait_on_people' as const, label: 'Time waiting on people', kind: 'median' as const, unit: 'minutes' as const, higherIsBetter: false }];

  it('a stop for no independent reviewer reads as a person standing in for the reviewer, with no engine ids', () => {
    const p = words.plainRecommendation(judge, M);
    expect(p.say).toBe('In 5 runs on wicked-e2e a person had to stand in for the reviewer.');
    expect(`${p.title} ${p.say} ${p.effect}`).not.toMatch(/judge_unavailable|n=\d|CI/u);
    expect(p.verb).toBe('Change a setting');
    expect(p.effect).toBe('Reviews come from a different agent, so nobody has to stand in.');
    expect(`${p.effect} ${p.changeMind}`).not.toMatch(/judge|seat|fallback/u);
    expect(p.confidence).toBe('Medium');
    expect(words.plainText('A "judge_unavailable" stop, n=8 (95% CI 41%–93%)')).toBe('A no independent reviewer stop, 8 runs (likely between 41% and 93%)');
  });

  it('a regression says it in one sentence; the interval and the sample only under Why; each has its own falsifier', () => {
    const o = words.plainRecommendation(reg('override_rate', 0.75, 0.12), M);
    expect(o.say).toBe('In 6 of 8 runs a person had to override a stop, up from 12% of runs before.');
    expect(o.say).not.toMatch(/likely|CI|n=/u);
    expect(o.why.join(' ')).toContain('likely between 41% and 93%');
    expect(o.verb).toBe('File an issue');
    const w = words.plainRecommendation(reg('wait_on_people', 24, 0), M);
    expect(w.say).toBe('A typical run now waits 24 min for a person, up from 0 min.');
    expect(w.changeMind).not.toBe(o.changeMind);
    // The seat's own wording, when the review was interpreted, is kept.
    expect(words.plainRecommendation(reg('wait_on_people', 24, 0), M, true).changeMind).toContain('If the work itself changed');
  });

  it('the header is one sentence', () => {
    const r = response().reviews[0]!;
    expect(words.reviewSentence({ ...r, window: { startMs: Date.UTC(2026, 9, 25, 12), endMs: Date.UTC(2026, 9, 27, 12) }, totals: { runs: 15 },
      improvements: [r.improvements[0]!], recommendations: Array.from({ length: 5 }, () => r.recommendations[0]!) }))
      .toBe('15 runs reviewed (Oct 25\u201327). One thing got better, five could improve.');
    const { view } = viewOf(response());
    expect(view.reviews[0]?.footnote).toBeNull();
    expect(viewOf({ ...response(), reviews: [{ ...response().reviews[0]!, interpreted: false }] }).view.reviews[0]?.footnote).toMatch(/Worded by crew/u);
  });
});

describe('the plugin\'s trend lines', () => {
  it('draw an interval band and grey, labelled points below the minimum sample', () => {
    const { view } = viewOf(response());
    const svg = trendSvg(view.trends.find((t) => t.metric === 'spend')?.points ?? [], 'usd');
    expect(svg.querySelector('polygon.band')).not.toBeNull();
    expect(svg.querySelectorAll('circle.pt.small')).toHaveLength(1);
    // No "n=" labels on the points: the grey dot says "too few", its tooltip says how many.
    expect(svg.querySelector('text.lbl')).toBeNull();
    expect(svg.querySelector('circle.small title')?.textContent).toContain('from 3 runs, too few to tell');
    expect(svg.querySelectorAll('text.axis')).toHaveLength(2);
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
