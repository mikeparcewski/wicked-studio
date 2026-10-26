import { describe, expect, it } from 'vitest';
import type { SeatRecord, SeatRecordResponse, SessionView } from '../src/api/types.js';
import {
  agentReportRows, bucketEdges, changeOf, customProblem, DAY_MS, endedIn, endingOf, firstPassOf, isoDate, periodBuckets, periodOf, periodWords,
  previousOf, recordBetween, recordReads, repoRows, shippedRows, spendOfDeltas, spendPerBucket, stepOf, throughput, timeToPr,
  type Period,
} from '../src/board/reportModel.js';

const NOW = new Date(2026, 9, 26, 9, 52).getTime();
const H = 3_600_000;

function job(id: string, over: Record<string, unknown> = {}): SessionView {
  return { session: { id, status: 'completed', delivery: 'none', created_at: (NOW - 2 * DAY_MS) / 1000, ended_at: (NOW - DAY_MS) / 1000, repo_ref: 'wicked-core', ...over }, units: [] } as unknown as SessionView;
}
function seat(cli: string, units: number, gated: number, firstPass: number, costUsd: number | null): SeatRecord {
  return { cli, units, gated, firstPass, rework: 0, stalls: 0, benched: 0, benchReasons: {}, costUsd, costedUsage: costUsd === null ? 0 : 1, byPhase: {} };
}
function rec(seats: SeatRecord[], truncated = false): SeatRecordResponse {
  return { days: 7, since: 0, until: NOW, runsRead: 1, truncated, seats };
}
const name = (c: string): string => c.toUpperCase();

describe('report periods', () => {
  it('7 and 30 days end now; the period before has the same length', () => {
    const p = periodOf('7', null, NOW)!;
    expect(p).toEqual({ kind: '7', fromDays: 7, toDays: 0 });
    expect(previousOf(p)).toEqual({ kind: '7', fromDays: 14, toDays: 7 });
    expect(periodWords(periodOf('30', null, NOW)!, NOW)).toBe('Last 30 days');
  });

  it('a custom range is its calendar days, both included, ending at this time of day', () => {
    const p = periodOf('custom', { from: '2026-10-13', to: '2026-10-26' }, NOW)!;
    expect(p).toEqual({ kind: 'custom', fromDays: 14, toDays: 0 });
    const q = periodOf('custom', { from: '2026-10-10', to: '2026-10-20' }, NOW)!;
    expect(q).toEqual({ kind: 'custom', fromDays: 17, toDays: 6 });
    expect(periodWords(q, NOW)).toMatch(/10.*20/);
    expect(periodOf('custom', { from: '2026-10-26', to: '2026-10-26' }, NOW)).toEqual({ kind: 'custom', fromDays: 1, toDays: 0 });
  });

  it('refuses a range it cannot show, and says why', () => {
    expect(customProblem({ from: '', to: '2026-10-26' }, NOW)).toMatch(/both/);
    expect(customProblem({ from: '2026-10-20', to: '2026-10-10' }, NOW)).toMatch(/after/);
    expect(customProblem({ from: '2026-07-01', to: '2026-10-10' }, NOW)).toMatch(/90 days/);
    expect(customProblem({ from: '2026-10-20', to: '2026-10-28' }, NOW)).toMatch(/future/);
    expect(periodOf('custom', { from: '2026-10-20', to: '2026-10-10' }, NOW)).toBeNull();
    expect(customProblem({ from: isoDate(NOW - 89 * DAY_MS), to: isoDate(NOW) }, NOW)).toBeNull();
  });

  it('buckets are days up to five weeks, weeks beyond, each named by the date it ends on', () => {
    const p: Period = { kind: '7', fromDays: 7, toDays: 0 };
    const b = periodBuckets(p, NOW);
    expect(b).toHaveLength(7);
    expect(b[6]!.end).toBe(NOW);
    expect(b[0]!.start).toBe(NOW - 7 * DAY_MS);
    expect(b[6]!.title).toMatch(/26/);
    const long: Period = { kind: 'custom', fromDays: 90, toDays: 0 };
    expect(stepOf(long)).toBe(7);
    expect(periodBuckets(long, NOW)).toHaveLength(13);
    expect(periodBuckets(long, NOW)[0]!.start).toBe(NOW - 90 * DAY_MS);
  });

  it('reads one record per edge plus the start of the period before, never past 90 days', () => {
    const p: Period = { kind: '7', fromDays: 7, toDays: 0 };
    expect(bucketEdges(p)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(recordReads(p)).toEqual([1, 2, 3, 4, 5, 6, 7, 14]);
    expect(recordReads({ kind: 'custom', fromDays: 60, toDays: 0 })).not.toContain(120);
    expect(Math.max(...recordReads({ kind: 'custom', fromDays: 90, toDays: 0 }))).toBe(90);
  });
});

describe('the record between two edges', () => {
  it('is the difference of two reads, tool seats dropped; a failed or capped read is unknown', () => {
    const reads = new Map<number, SeatRecordResponse | null>([
      [7, rec([seat('claude', 10, 8, 6, 5), seat('bash', 3, 3, 3, null)])],
      [14, rec([seat('claude', 15, 12, 8, 9)])],
    ]);
    const now7 = recordBetween(reads, 7, 0)!;
    expect(now7.map((d) => d.cli)).toEqual(['claude']);
    expect(firstPassOf(now7)).toEqual({ passed: 6, gated: 8, rate: 0.75 });
    expect(spendOfDeltas(now7)).toEqual({ usd: 5, partial: false });
    const prev = recordBetween(reads, 14, 7)!;
    expect(spendOfDeltas(prev)).toEqual({ usd: 4, partial: false });
    expect(recordBetween(new Map([[7, null]]), 7, 0)).toBeNull();
    expect(recordBetween(new Map([[7, rec([], true)]]), 7, 0)).toBeNull();
    expect(recordBetween(new Map(), 7, 0)).toBeNull();
  });

  it('spend is unknown (null) when someone worked and nothing carried a price; partial when some did', () => {
    expect(spendOfDeltas(recordBetween(new Map([[7, rec([seat('pi', 2, 0, 0, null)])]]), 7, 0)!)).toBeNull();
    expect(spendOfDeltas(recordBetween(new Map([[7, rec([seat('pi', 2, 0, 0, null), seat('claude', 1, 0, 0, 3)])]]), 7, 0)!)).toEqual({ usd: 3, partial: true });
    expect(spendOfDeltas([])).toEqual({ usd: 0, partial: false });
  });

  it('spend per bucket is drawn only when every edge is whole', () => {
    const p: Period = { kind: 'custom', fromDays: 2, toDays: 0 };
    const reads = new Map<number, SeatRecordResponse | null>([[1, rec([seat('claude', 1, 0, 0, 2)])], [2, rec([seat('claude', 2, 0, 0, 5)])]]);
    expect(spendPerBucket(reads, p, name)).toEqual([{ key: 'claude', label: 'CLAUDE', values: [3, 2] }]);
    reads.set(1, null);
    expect(spendPerBucket(reads, p, name)).toBeNull();
  });

  it('agent rows carry /system median and 429s only when the period is crew’s 7 days', () => {
    const ds = recordBetween(new Map([[7, rec([seat('codex', 4, 4, 3, 1.234), seat('agy', 0, 0, 0, null)])]]), 7, 0)!;
    const sys = [{ key: 'codex', name: 'Codex', medianMs: 60_000, rateLimited: 2 }];
    expect(agentReportRows(ds, sys, true, name)).toEqual([{ cli: 'codex', label: 'CODEX', units: 4, gated: 4, firstPass: 3, passRate: 0.75, costUsd: 1.23, medianMs: 60_000, rateLimited: 2 }]);
    expect(agentReportRows(ds, sys, false, name)[0]).toMatchObject({ medianMs: null, rateLimited: null });
  });
});

describe('jobs in a period', () => {
  const p: Period = { kind: '7', fromDays: 7, toDays: 0 };

  it('counts the jobs that ENDED in the period by how they ended; archived and unended are left out', () => {
    const runs = [
      job('pr', { delivery: 'delivered', deliverUrl: 'https://github.com/o/r/pull/12' }),
      job('push', { delivery: 'pushed', deliverBranch: 'wicked/x' }),
      job('answer'),
      job('fail', { status: 'failed' }),
      job('stop', { status: 'cancelled' }),
      job('old', { ended_at: (NOW - 9 * DAY_MS) / 1000 }),
      job('running', { status: 'executing', ended_at: undefined }),
      job('archived', { archived_at: 1 }),
      job('noclock', { ended_at: undefined }),
    ];
    const { jobs, undated } = endedIn(runs, p, NOW);
    expect(jobs.map((v) => v.session.id)).toEqual(['pr', 'push', 'answer', 'fail', 'stop']);
    expect(undated).toBe(1);
    expect(jobs.map(endingOf)).toEqual(['delivered', 'delivered', 'finished', 'failed', 'stopped']);
    const flow = throughput(jobs, periodBuckets(p, NOW));
    expect(flow.map((s) => [s.key, s.values.reduce((a, b) => a + b, 0)])).toEqual([['delivered', 2], ['finished', 1], ['failed', 1], ['stopped', 1]]);
  });

  it('time to PR is the median start-to-end of the delivered jobs', () => {
    const a = job('a', { delivery: 'delivered', created_at: (NOW - DAY_MS - 2 * H) / 1000 });
    const b = job('b', { delivery: 'delivered', created_at: (NOW - DAY_MS - 4 * H) / 1000 });
    const c = job('c', { created_at: (NOW - DAY_MS - 50 * H) / 1000 });
    expect(timeToPr([a, b, c])).toEqual({ minutes: 180, n: 2 });
    expect(timeToPr([c])).toEqual({ minutes: null, n: 0 });
  });

  it('by repository: jobs, delivered, pass rate (ended well of ended) and median; spend is not tracked', () => {
    const rows = repoRows([job('a', { delivery: 'delivered' }), job('b', { status: 'failed' }), job('c', { repo_ref: 'tiny' })]);
    expect(rows[0]).toMatchObject({ key: 'wicked-core', jobs: 2, delivered: 1, ok: 1, passRate: 0.5, spendUsd: null });
    expect(rows[1]).toMatchObject({ key: 'tiny', jobs: 1, ok: 1 });
  });

  it('shipped lists delivered jobs newest first with the PR number read off its link', () => {
    const rows = shippedRows([
      job('older', { delivery: 'delivered', deliverUrl: 'https://github.com/o/r/pull/7', ended_at: (NOW - 2 * DAY_MS) / 1000 }),
      job('newer', { delivery: 'pushed', deliverBranch: 'wicked/n' }),
      job('plain'),
    ], (v) => v.session.id);
    expect(rows.map((r) => [r.runId, r.kind, r.number, r.branch])).toEqual([['newer', 'pushed', null, 'wicked/n'], ['older', 'pr', 7, null]]);
  });
});

describe('changes against the period before', () => {
  it('says which way it moved and whether that is good', () => {
    expect(changeOf(10, 4, 'good', String, 'the 7 days before', ['more', 'fewer'])).toEqual({ dir: 'up', tone: 'good', text: '6 more than the 7 days before' });
    expect(changeOf(2, 4, 'good', String, 'the 7 days before', ['more', 'fewer'])).toEqual({ dir: 'down', tone: 'bad', text: '2 fewer than the 7 days before' });
    expect(changeOf(12, 4, 'bad', (d) => `$${d}`, 'x')!.tone).toBe('bad');
    expect(changeOf(4, 4, 'good', String, 'the 7 days before')).toEqual({ dir: 'flat', tone: 'neutral', text: 'same as the 7 days before' });
    expect(changeOf(5, 0, 'good', String, 'the 7 days before', ['more', 'fewer'], true)!.text).toBe('none in the 7 days before');
    expect(changeOf(null, 4, 'good', String, 'x')).toBeNull();
  });
});
