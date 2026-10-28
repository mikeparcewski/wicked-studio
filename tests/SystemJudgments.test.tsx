import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { DefaultEvalRate, DefaultEvalReport, DefaultEvalSlice, DefaultEvalSuiteScore } from '../src/api/defaultEvals.js';
import { driftLine, driftLines, judgeRow, judgeSentence, rateWords } from '../src/board/defaultEvalModel.js';
import { SystemJudgments } from '../src/components/steer/SystemJudgments.js';

/**
 * "How well the system judges" on Evaluate (DES-DEFAULT-EVALS-001 §7): crew's default-eval report in words.
 * Too few cases never reads as a rate; real and synthetic are named apart; a crew without the routes says so.
 */

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

function wire(handlers: Record<string, (body: unknown) => Promise<unknown>>): void {
  apiFetch.mockImplementation((path: unknown, init?: { body?: string }) => {
    const h = handlers[String(path)];
    if (h !== undefined) return h(init?.body === undefined ? undefined : JSON.parse(init.body));
    return Promise.reject(new ApiError(404, 'Not Found'));
  });
}

const rate = (k: number, n: number, lo: number | null = null, hi: number | null = null): DefaultEvalRate => ({
  k, n, value: n === 0 ? null : k / n, lo, hi, tooFew: n < 5,
});
const slice = (k: number, n: number, extra: Partial<DefaultEvalSlice> = {}): DefaultEvalSlice => ({
  cases: n, unscored: 0, agreement: rate(k, n, n >= 5 ? 0.64 : null, n >= 5 ? 0.9 : null), perClass: [], ...extra,
});
const EMPTY = slice(0, 0);

function suite(over: Partial<DefaultEvalSuiteScore>): DefaultEvalSuiteScore {
  return {
    suite: 'floor-class', title: 'Floor decisions', real: slice(28, 35), synthetic: { ...EMPTY, cases: 2, unscored: 2 },
    combined: slice(28, 35), model: EMPTY, trend: { word: 'first-run', previous: null, previousRunId: null }, notes: [], ...over,
  };
}

const REPORT: DefaultEvalReport = {
  id: 'r1',
  createdAt: '2026-10-27T06:00:00Z',
  project: null,
  suites: [
    suite({}),
    suite({ suite: 'steering', title: 'Steering', real: slice(0, 2), combined: slice(0, 2), synthetic: EMPTY }),
    suite({
      suite: 'needs-you', title: 'Needs you', real: slice(66, 108), combined: { ...slice(66, 108), pairs: { precision: rate(0, 0), recall: rate(0, 3) } }, synthetic: EMPTY,
      bySurface: { home: slice(9, 27), 'nerve-center': slice(22, 27) }, trend: { word: 'regressed', previous: 0.8, previousRunId: 'r0' },
    }),
  ],
  drift: [{ suite: 'floor-class', inputKey: 'floor:base_red:repo_checks', axis: 'project', observed: { 'wicked-core': ['base_red'], 'wicked-e2e': ['boundary_deny'] }, caseIds: ['a', 'b'] }],
  counts: { real: 145, synthetic: 2, modelLabelled: 0, unscored: 2, baseline: 0 },
  minimums: { rate: 5, calibration: 20 },
};

describe('the words', () => {
  it('never says a rate below the minimum', () => {
    expect(rateWords(rate(2, 2))).toBe('Too few cases to tell (2)');
    expect(rateWords(rate(0, 0))).toBe('No cases yet');
    expect(rateWords(rate(28, 35, 0.64, 0.9))).toBe('80% agree (64%–90%)');
  });

  it('names real and synthetic apart, and says what was not scored', () => {
    const r = judgeRow(REPORT.suites[0]!);
    expect(r.words).toBe('80% agree (64%–90%) · 35 cases');
    expect(r.split).toBe('Real 28 of 35 right · synthetic 2 not scored');
    expect(r.trend).toBeNull();
    expect(r.tone).toBe('warn');
  });

  it('a regression is red and says so; per-answerer figures and merging are in the detail', () => {
    const r = judgeRow(REPORT.suites[2]!);
    expect(r.tone).toBe('fail');
    expect(r.trend).toBe('Worse than last time');
    expect(r.detail).toContain('Home: 9 of 27 right');
    expect(r.detail).toContain('Merging: 0 of 3 pairs that are one cause were put together');
  });

  it('says drift and the sentence in plain words', () => {
    expect(driftLine(REPORT.drift[0]!)).toBe('Floor decisions, a floor whose checks say base red: wicked-core says base red; wicked-e2e says boundary deny');
    expect(driftLine({ ...REPORT.drift[0]!, observed: { a: ['base_red', 'boundary_deny'], b: ['base_red', 'boundary_deny'], c: ['base_red'] } })).toBe(
      'Floor decisions, a floor whose checks say base red: a and b say base red or boundary deny; c says base red',
    );
    const needs = { suite: 'needs-you' as const, inputKey: 'needs:7f4e149f', axis: 'surface' as const, caseIds: [], observed: { codex: ['not'], home: ['count'], 'needs-page': ['count'], 'nerve-center': ['count'] } };
    expect(driftLine(needs)).toBe('What needs you, run 7f4e149f: codex leaves it out; Home, the Needs you page and Nerve Center count it');
    const many = driftLines(Array.from({ length: 10 }, () => needs), 8);
    expect(many.lines).toHaveLength(8);
    expect(many.more).toBe(2);
    expect(judgeSentence(REPORT)).toBe('145 real cases from your runs, 2 synthetic. Every project.');
    expect(judgeSentence({ ...REPORT, project: 'wicked-core', counts: { ...REPORT.counts, real: 256, baseline: 108 } })).toBe(
      '148 real cases from your runs, 108 from the shipped baseline, 2 synthetic. Project wicked-core.',
    );
  });
});

describe('SystemJudgments', () => {
  beforeEach(() => {
    apiFetch.mockReset();
  });

  it('reads the newest report and shows one row per suite; a row opens its detail', async () => {
    wire({
      '/testing/default-evals': async () => ({ runs: [{ id: 'r1', createdAt: REPORT.createdAt, project: null }] }),
      '/testing/default-evals/r1': async () => ({ report: REPORT, cases: [] }),
    });
    render(<SystemJudgments />);
    const rows = await screen.findAllByTestId('evaluate-judgment-row');
    expect(rows.map((r) => r.getAttribute('data-suite'))).toEqual(['floor-class', 'steering', 'needs-you']);
    expect(within(rows[1]!).getByTestId('evaluate-judgment-words').textContent).toMatch(/^Too few cases to tell \(2\)/);
    await userEvent.click(rows[2]!);
    expect(screen.getByTestId('evaluate-judgment-detail').textContent).toMatch(/Nerve Center: 22 of 27 right/);
    expect(screen.getAllByTestId('evaluate-drift-line')).toHaveLength(1);
    // The scope is a quiet segment beside the one action: all projects, or one.
    expect(screen.getByTestId('evaluate-judgments-scope-all').getAttribute('aria-checked')).toBe('true');
  });

  it('a project chosen in the segment scopes the run', async () => {
    let sent: unknown = null;
    const withProjects = { ...REPORT, suites: [{ ...REPORT.suites[0]!, byProject: { 'repo-a': slice(5, 5), 'repo-b': slice(4, 5) } }] };
    wire({
      '/testing/default-evals': async () => ({ runs: [{ id: 'r1', createdAt: REPORT.createdAt, project: null }] }),
      '/testing/default-evals/r1': async () => ({ report: withProjects, cases: [] }),
      '/testing/default-evals/run': async (body) => { sent = body; return withProjects; },
    });
    render(<SystemJudgments />);
    await userEvent.click(await screen.findByTestId('evaluate-judgments-scope-repo-b'));
    await userEvent.click(screen.getByTestId('evaluate-judgments-check'));
    await screen.findAllByTestId('evaluate-judgment-row');
    expect(sent).toEqual({ project: 'repo-b' });
  });

  it('Check now posts the scope and the baseline choice, then shows the new report', async () => {
    let sent: unknown = null;
    wire({
      '/testing/default-evals': async () => ({ runs: [] }),
      '/testing/default-evals/run': async (body) => {
        sent = body;
        return REPORT;
      },
    });
    render(<SystemJudgments />);
    expect(await screen.findByTestId('evaluate-judgments-empty')).toBeTruthy();
    expect(screen.getByTestId('evaluate-judgments-check').textContent).toBe('Run evals');
    expect(screen.getByTestId('evaluate-judgments-when').textContent).toBe('Not run yet.');
    // The baseline is a secondary option, behind Options.
    await userEvent.click(screen.getByTestId('evaluate-judgments-options-toggle'));
    await userEvent.click(screen.getByTestId('evaluate-judgments-baseline'));
    await userEvent.click(screen.getByTestId('evaluate-judgments-check'));
    expect(await screen.findAllByTestId('evaluate-judgment-row')).toHaveLength(3);
    expect(sent).toEqual({ baseline: true });
    expect(screen.getByTestId('evaluate-judgments-when').textContent).toMatch(/^Last run .* · 145 real cases from your runs/);
  });

  it('a crew without the default evals says so, quietly', async () => {
    wire({});
    render(<SystemJudgments />);
    expect((await screen.findByTestId('evaluate-judgments-absent')).textContent).toMatch(/does not score its own judgments yet/);
  });
});
