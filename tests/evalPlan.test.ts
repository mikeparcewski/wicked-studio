import { describe, expect, it } from 'vitest';
import type { EvalRunSummary, SessionView } from '../src/api/types.js';
import type { DefaultEvalSuiteScore } from '../src/api/defaultEvals.js';
import { behavioursFromJob, corpusName, evalRecommendations, pastRunPills, pastRunTitle, samplesOf, scrubPaths, splitTranscript } from '../src/board/evalPlan.js';

const NOW = Date.UTC(2026, 9, 30, 12);
const S = (n: number): number => Math.floor(NOW / 1000) - n * 86_400;

function run(over: Partial<EvalRunSummary> & Pick<EvalRunSummary, 'id'>): EvalRunSummary {
  return {
    created_at: S(9), actor: 'op', corpus: null, type_filter: null, rule_store: 's', degraded: null,
    summary: { total: 0, caught: 0, gaps: 0, false_positives: 0 }, per_type: {}, ...over,
  } as EvalRunSummary;
}

function job(id: string, status: string, endedDaysAgo: number, units: Array<{ ord: number; status: string; stage?: string; description?: string; denial_reason?: string | null }> = []): SessionView {
  return {
    session: { id, status, created_at: S(endedDaysAgo + 1), ended_at: S(endedDaysAgo), problem: `job ${id}` },
    units: units.map((u) => ({ id: `${id}-${u.ord}`, session_id: id, ord: u.ord, description: u.description ?? `step ${u.ord}`, stage: u.stage ?? 'build', status: u.status, denial_reason: u.denial_reason ?? null, phase_ref: null })),
  } as unknown as SessionView;
}

function suite(id: DefaultEvalSuiteScore['suite'], value: number | null, n: number): DefaultEvalSuiteScore {
  const slice = { cases: n, agreement: { k: Math.round((value ?? 0) * n), n, value, tooFew: n < 5 } };
  return { suite: id, title: id, real: slice, synthetic: slice, combined: slice, model: { cases: 0, agreement: { k: 0, n: 0, value: null, tooFew: true } }, trend: { word: 'steady', previous: null, previousRunId: null }, notes: [] } as unknown as DefaultEvalSuiteScore;
}

describe('Evaluate · Recommended to run', () => {
  it('never run: run every type, and why', () => {
    const recs = evalRecommendations({ history: [], ruleCount: 22, judge: null, runs: [], now: NOW });
    expect(recs[0]).toMatchObject({ key: 'first', act: { kind: 'run-all' } });
    expect(recs[0]!.why).toContain('22 rules in force');
  });

  it('leads with the weakest type in past results, then this week\'s failed jobs, then the weakest judgment', () => {
    const history = [
      run({ id: 'a', created_at: S(9), per_type: { development: { total: 24, caught: 18, gaps: 6, false_positives: 0 }, security: { total: 12, caught: 12, gaps: 0, false_positives: 0 } } }),
      run({ id: 'b', created_at: S(20), per_type: { testing: { total: 10, caught: 9, gaps: 1, false_positives: 0 } } }),
    ];
    const runs = [job('f1', 'failed', 2), job('f2', 'failed', 3), job('old', 'failed', 12), job('ok', 'completed', 1)];
    const judge = { suites: [suite('qe-verdict', 0.29, 17), suite('needs-you', 0.95, 40), suite('recall', 0.1, 2)], at: NOW - 16 * 60_000 };
    const recs = evalRecommendations({ history, ruleCount: 22, judge, runs, now: NOW });
    expect(recs.map((r) => r.key)).toEqual(['weak:development', 'failed-jobs', 'judge:qe-verdict']);
    expect(recs[0]!.why).toMatch(/^6 bad behaviours slipped through last time/);
    expect(recs[0]!.meta).toBe('Last run 9 days ago · 6 gaps of 24');
    expect(recs[1]!.act).toEqual({ kind: 'from-jobs', runIds: ['f1', 'f2'] });
    expect(recs[1]!.label).toBe('Use those 2 jobs');
    // Too few cases never reads as a rate: recall (2 cases) is not the weakest.
    expect(recs[2]!.why).toBe('QE verdicts agree only 29% with what really happened. Worth a fresh look.');
    expect(recs[2]!.label).toBe('Run QE verdicts');
    expect(recs[2]!.meta).toBe('17 cases · last run 16 min ago');
  });

  it('fills with never-run types and rules nothing tests', () => {
    const history = [run({ id: 'a', per_type: { development: { total: 4, caught: 4, gaps: 0, false_positives: 0 } }, rule_coverage: { exercised: 3, unexercised: [{ rule_id: 'R1' }, { rule_id: 'R2' }] } as unknown as NonNullable<EvalRunSummary['rule_coverage']> })];
    const recs = evalRecommendations({ history, ruleCount: 5, judge: null, runs: [], now: NOW });
    expect(recs.map((r) => r.key)).toEqual(['never:architecture', 'unexercised']);
    expect(recs[0]!.title).toBe('6 kinds of rule');
    expect(recs[1]).toMatchObject({ act: { kind: 'bring' } });
    expect(recs[1]!.why).toContain('2 rules in force were not exercised');
  });
});

describe('Evaluate · Bring your own', () => {
  it('splits a transcript by speaker turn and paragraph, unmarked, at most 40', () => {
    const d = splitTranscript('User: please fix the login bug\nAssistant: I pushed straight to main.\nIt was faster.\n\nok\n\nUser: and the changelog please');
    expect(d.map((x) => x.description)).toEqual(['User: please fix the login bug', 'Assistant: I pushed straight to main. It was faster.', 'User: and the changelog please']);
    expect(d.every((x) => x.kind === null && x.keep)).toBe(true);
    expect(splitTranscript(Array.from({ length: 60 }, (_, i) => `paragraph number ${i}`).join('\n\n'))).toHaveLength(40);
  });

  it('a job\'s finished steps: accepted is good, sent back is bad with why; paths never ride', () => {
    const v = job('abcdef123456', 'failed', 1, [
      { ord: 1, status: 'done', stage: 'build', description: 'Write the fix' },
      { ord: 2, status: 'rejected', stage: 'test', description: 'Run the tests', denial_reason: 'skipped /home/someone/x/test.ts' },
      { ord: 3, status: 'pending' },
    ]);
    const d = behavioursFromJob(v);
    expect(d.map((x) => [x.id, x.kind, x.type])).toEqual([['abcdef12-1', 'good', 'development'], ['abcdef12-2', 'bad', 'testing']]);
    expect(d[1]!.why).toBe('review sent it back: skipped <path>');
    expect(JSON.stringify(d)).not.toContain('/home/');
    expect(scrubPaths('C:\\Users\\me\\a.ts and /home/x/y')).toBe('<path> and <path>');
  });

  it('only kept, marked behaviours are imported, with unique ids', () => {
    const d = splitTranscript('first behaviour here\n\nsecond behaviour here\n\nthird behaviour here');
    d[0]!.kind = 'bad'; d[1]!.kind = 'good'; d[1]!.keep = false;
    const s = samplesOf(d, 'mine');
    expect(s).toEqual([{ id: 'mine-t1', description: 'first behaviour here', kind: 'bad', steering_type: 'development', signals: { content: 'first behaviour here' } }]);
    expect(corpusName('  Payments Incidents!! ', 'x')).toBe('payments-incidents');
    expect(corpusName('***', 'fallback')).toBe('fallback');
  });
});

describe('Evaluate · Past runs', () => {
  it('names what a run covered, and its outcome as pills', () => {
    expect(pastRunTitle({ type_filter: null, corpus: null })).toBe('All types · built-in behaviours');
    expect(pastRunTitle({ type_filter: 'security', corpus: 'evals:payments-incidents' })).toBe('Security · “payments-incidents” (yours)');
    expect(pastRunPills({ total: 64, caught: 56, gaps: 6, false_positives: 1 }).map((p) => p.text)).toEqual(['56 caught', '6 slipped through', '1 false alarm']);
    expect(pastRunPills({ total: 12, caught: 12, gaps: 0, false_positives: 0 })).toHaveLength(1);
  });
});
