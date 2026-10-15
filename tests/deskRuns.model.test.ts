import { describe, expect, it } from 'vitest';
import { DEFAULT_REFINE, type Refine } from '../src/board/deskInsights.js';
import { durationWords, runsView, type RunStatusFilter } from '../src/board/deskRuns.js';
import { makeUnit } from './factories.js';
import { DAY, NOW, deskRun, names, outcomeRuns, title } from './fixtures/deskV2.js';

describe('Desk Runs model', () => {
  it('builds rows from wire seconds, identity and unit progress', () => {
    const run = deskRun('r1');
    run.units.push(makeUnit({ assigned_cli: 'claude', status: 'done' }));
    const view = runsView([run], DEFAULT_REFINE, 'all', '', NOW, title, names);
    expect(view.rows).toEqual([{
      id: 'r1', title: 'Fix r1', outcome: 'Finished', project: 'studio', workflow: 'Fix bug',
      agents: ['claude', 'codex'], stepsDone: 2, steps: 3,
      startedAt: NOW - DAY, endedAt: NOW - DAY + 120_000,
    }]);
  });

  it.each<[RunStatusFilter, string[]]>([
    ['all', ['working', 'finished', 'answered', 'failed', 'waiting', 'stopped']],
    ['working', ['working']], ['finished', ['finished', 'answered']], ['failed', ['failed']],
    ['waiting', ['waiting']], ['stopped', ['stopped']],
  ])('filters %s by outcome', (status, ids) => {
    expect(runsView(outcomeRuns(), DEFAULT_REFINE, status, '', NOW, title, names).rows.map((r) => r.id)).toEqual(ids);
  });

  it('AND matches case-insensitive words across title, workflow, project and agent names', () => {
    const runs = [deskRun('match', { problem: 'Repair pagination' }), deskRun('other', { problem: 'Repair navigation', project_id: 'crew' })];
    const search = (query: string) => runsView(runs, DEFAULT_REFINE, 'all', query, NOW, title, names).rows.map((r) => r.id);
    expect(search('  PAGINATION  bug STUDIO sonnet  ')).toEqual(['match']);
    expect(search('Repair Engine Codex')).toEqual(['other']);
    expect(search('pagination missing')).toEqual([]);
    expect(search('   ')).toEqual(['match', 'other']);
  });

  it('keeps stats stable across status and search, including searches with no matches', () => {
    const runs = outcomeRuns();
    const stats = { inWindow: 6, running: 1, waiting: 1, finished: 2, failed: 1, ended: 4 };
    for (const status of ['all', 'working', 'finished', 'failed'] as const) {
      for (const query of ['', 'failed', 'no such run']) {
        expect(runsView(runs, DEFAULT_REFINE, status, query, NOW, title, names).stats).toEqual(stats);
      }
    }
  });

  it('does not count a run Needs you holds as running (studio#805)', () => {
    const runs = outcomeRuns();
    const working = runsView(runs, DEFAULT_REFINE, 'all', '', NOW, title, names).rows.filter((r) => r.outcome === 'Working').map((r) => r.id);
    expect(working).toHaveLength(1);
    const view = runsView(runs, DEFAULT_REFINE, 'all', '', NOW, title, names, false, new Set(working));
    expect(view.stats.running).toBe(0);
    expect(view.stats.waiting).toBe(2);
    // It stays listed, as waiting on you: under Waiting, not under Running.
    expect(view.rows.find((r) => r.id === working[0])?.outcome).toBe('Waiting on you');
    const filtered = (status: RunStatusFilter) => runsView(runs, DEFAULT_REFINE, status, '', NOW, title, names, false, new Set(working)).rows.map((r) => r.id);
    expect(filtered('working')).not.toContain(working[0]);
    expect(filtered('waiting')).toContain(working[0]);
  });

  it.each<[Partial<Refine>, number]>([
    [{ days: 7 }, 2], [{ project: 'studio' }, 2], [{ agent: 'claude' }, 2], [{ workflow: 'fix-bug' }, 2],
    [{ days: 7, project: 'studio', agent: 'claude', workflow: 'fix-bug' }, 1],
  ])('stats follow refine %j', (refine, count) => {
    const recent = deskRun('recent', { status: 'failed' });
    const old = deskRun('old', { status: 'failed', created_at: (NOW - 15 * DAY) / 1000 });
    const other = deskRun('other', { status: 'failed', project_id: 'crew', run_identity: { kind: 'workflow', name: 'learn', user_plan: false, system: false } });
    other.units = [makeUnit({ assigned_cli: 'pi', status: 'done' })];
    const view = runsView([recent, old, other], { ...DEFAULT_REFINE, ...refine }, 'finished', 'unmatched', NOW, title, names);
    expect(view.rows).toEqual([]);
    expect(view.stats).toEqual({ inWindow: count, running: 0, waiting: 0, finished: 0, failed: count, ended: count });
  });

  it('sorts newest first and counts only undated runs in the refined scope', () => {
    const undated = deskRun('undated');
    const otherUndated = deskRun('other-undated', { project_id: 'crew' });
    const archived = deskRun('archived', { archived_at: NOW / 1000 });
    for (const run of [undated, otherUndated, archived]) delete run.session.created_at;
    const runs = [
      deskRun('old', { created_at: (NOW - 2 * DAY) / 1000 }),
      undated,
      deskRun('new', { created_at: (NOW - 60_000) / 1000 }),
      deskRun('outside', { created_at: (NOW - 31 * DAY) / 1000 }),
      otherUndated, archived,
    ];
    const view = runsView(runs, { ...DEFAULT_REFINE, project: 'studio' }, 'all', '', NOW, title, names);
    expect(view.rows.map((r) => r.id)).toEqual(['new', 'old']);
    expect(view.undated).toBe(1);
    expect(view.stats.inWindow).toBe(2);
  });
});

describe('durationWords', () => {
  it.each([
    [20_000, 'under a minute'], [4 * 60_000, '4 min'],
    [125 * 60_000, '2 h 5 min'], [120 * 60_000, '2 h'], [3 * DAY, '3 d'],
  ])('formats %i ms as %s', (elapsed, words) => {
    expect(durationWords({ startedAt: NOW - elapsed, endedAt: NOW }, NOW + DAY)).toBe(words);
  });

  it('measures an open run to now and leaves an undated duration unknown', () => {
    expect(durationWords({ startedAt: NOW - 125 * 60_000, endedAt: null }, NOW)).toBe('2 h 5 min');
    expect(durationWords({ startedAt: null, endedAt: NOW }, NOW)).toBeNull();
  });
});
