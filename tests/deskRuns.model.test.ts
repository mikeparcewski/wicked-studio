import { describe, expect, it } from 'vitest';
import { DEFAULT_REFINE, type Refine } from '../src/board/deskInsights.js';
import { durationWords, jobLine, jobsSentence, jobWord, needHolds, runsView, type JobGroup, type NeedHold, type RunStatusFilter } from '../src/board/deskRuns.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { makeUnit } from './factories.js';
import { markHeld } from '../src/board/heldRuns.js';
import { DAY, NOW, deskRun, names, outcomeRuns, title } from './fixtures/deskV2.js';

const view = (runs: Parameters<typeof runsView>[0], o: { group?: JobGroup; status?: RunStatusFilter; query?: string; refine?: Partial<Refine>; allTime?: boolean; holds?: Map<string, NeedHold> } = {}) =>
  runsView(runs, { ...DEFAULT_REFINE, ...o.refine }, { group: o.group ?? 'finished', status: o.status ?? 'all', query: o.query ?? '', now: NOW, title, names, ...(o.allTime !== undefined ? { allTime: o.allTime } : {}), ...(o.holds !== undefined ? { holds: o.holds } : {}) });
const ids = (v: ReturnType<typeof runsView>): string[] => v.rows.map((r) => r.id);

describe('Jobs model', () => {
  it('builds rows from wire seconds, identity and unit progress', () => {
    const run = deskRun('r1', { repo_ref: 'wicked-core' });
    run.units.push(makeUnit({ assigned_cli: 'claude', status: 'done' }));
    expect(view([run]).rows).toEqual([{
      id: 'r1', title: 'Fix r1', outcome: 'Finished', word: 'Finished', tone: 'ok', group: 'finished',
      project: 'studio', repo: 'wicked-core', workflow: 'Fix bug',
      agents: ['claude', 'codex'], agent: 'claude', stepsDone: 2, steps: 3,
      startedAt: NOW - DAY, endedAt: NOW - DAY + 120_000,
    }]);
  });

  it('splits jobs into Active (still moving or waiting on you) and Finished (every job that ended)', () => {
    expect(ids(view(outcomeRuns(), { group: 'active' }))).toEqual(['working', 'waiting']);
    expect(ids(view(outcomeRuns(), { group: 'finished' }))).toEqual(['finished', 'answered', 'failed', 'stopped']);
  });

  it.each<[JobGroup, RunStatusFilter, string[]]>([
    ['active', 'working', ['working']], ['active', 'waiting', ['waiting']], ['active', 'decision', []],
    ['finished', 'finished', ['finished', 'answered']], ['finished', 'failed', ['failed']], ['finished', 'stopped', ['stopped']],
  ])('%s: the finer status %s keeps only its words', (group, status, want) => {
    expect(ids(view(outcomeRuns(), { group, status }))).toEqual(want);
  });

  it('AND matches case-insensitive words across title, repo, workflow, project and agent names', () => {
    const runs = [deskRun('match', { problem: 'Repair pagination', repo_ref: 'tiny-math' }), deskRun('other', { problem: 'Repair navigation', project_id: 'crew' })];
    const search = (query: string) => ids(view(runs, { query }));
    expect(search('  PAGINATION  bug STUDIO sonnet  ')).toEqual(['match']);
    expect(search('tiny-math')).toEqual(['match']);
    expect(search('Repair Engine Codex')).toEqual(['other']);
    expect(search('pagination missing')).toEqual([]);
    expect(search('   ')).toEqual(['match', 'other']);
  });

  it('keeps the counts stable across the group, status and search, including searches with no matches', () => {
    const stats = { active: 2, working: 1, waiting: 1, decision: 0, finished: 2, failed: 1, stopped: 1, ended: 4, inWindow: 6 };
    for (const group of ['active', 'finished'] as const) {
      for (const status of ['all', 'working', 'finished', 'failed'] as const) {
        for (const query of ['', 'failed', 'no such run']) expect(view(outcomeRuns(), { group, status, query }).stats).toEqual(stats);
      }
    }
  });

  it('does not count a run Needs you holds as running (studio#805)', () => {
    const runs = outcomeRuns();
    const working = view(runs, { group: 'active', status: 'working' }).rows.map((r) => r.id);
    expect(working).toEqual(['working']);
    const held = markHeld(runs, new Set(working));
    const v = view(held, { group: 'active' });
    expect(v.stats.working).toBe(0);
    expect(v.stats.waiting).toBe(2);
    // It stays listed, as waiting on you: under Waiting, not under Working.
    expect(v.rows.find((r) => r.id === 'working')?.word).toBe('Waiting on you');
    expect(ids(view(held, { group: 'active', status: 'working' }))).not.toContain('working');
    expect(ids(view(held, { group: 'active', status: 'waiting' }))).toContain('working');
  });

  it('says "Needs a decision" for a run Needs you holds for something to settle, "Waiting on you" for an answer', () => {
    const holds = new Map<string, NeedHold>([['working', 'decision'], ['waiting', 'answer']]);
    const v = view(outcomeRuns(), { group: 'active', holds });
    expect(v.rows.map((r) => [r.id, r.word, r.tone])).toEqual([['working', 'Needs a decision', 'warn'], ['waiting', 'Waiting on you', 'gate']]);
    expect(v.stats).toMatchObject({ working: 0, waiting: 1, decision: 1 });
    expect(ids(view(outcomeRuns(), { group: 'active', status: 'decision', holds }))).toEqual(['working']);
    // An ended run keeps its own word whatever Needs you says about it.
    expect(jobWord('Failed', 'decision')).toBe('Failed');
  });

  it.each<[Partial<Refine>, number]>([
    [{ days: 7 }, 2], [{ project: 'studio' }, 2], [{ agent: 'claude' }, 2], [{ workflow: 'fix-bug' }, 2],
    [{ days: 7, project: 'studio', agent: 'claude', workflow: 'fix-bug' }, 1],
  ])('finished counts follow refine %j', (refine, count) => {
    const recent = deskRun('recent', { status: 'failed' });
    const old = deskRun('old', { status: 'failed', created_at: (NOW - 15 * DAY) / 1000 });
    const other = deskRun('other', { status: 'failed', project_id: 'crew', run_identity: { kind: 'workflow', name: 'learn', user_plan: false, system: false } });
    other.units = [makeUnit({ assigned_cli: 'pi', status: 'done' })];
    const v = view([recent, old, other], { refine, query: 'unmatched' });
    expect(v.rows).toEqual([]);
    expect(v.stats).toEqual({ active: 0, working: 0, waiting: 0, decision: 0, finished: 0, failed: count, stopped: 0, ended: count, inWindow: count });
  });

  it('shows an active job whenever it started; the range narrows only finished jobs', () => {
    const oldLive = deskRun('old-live', { status: 'executing', created_at: (NOW - 40 * DAY) / 1000 });
    const oldDone = deskRun('old-done', { created_at: (NOW - 40 * DAY) / 1000 });
    expect(ids(view([oldLive, oldDone], { group: 'active' }))).toEqual(['old-live']);
    expect(ids(view([oldLive, oldDone], { group: 'finished' }))).toEqual([]);
    expect(view([oldLive, oldDone], { group: 'finished' }).beyond).toBe(1);
    // An archived job is never active.
    expect(ids(view([deskRun('arch', { status: 'executing', archived_at: NOW / 1000 })], { group: 'active' }))).toEqual([]);
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
    const v = view(runs, { refine: { project: 'studio' } });
    expect(ids(v)).toEqual(['new', 'old']);
    expect(v.undated).toBe(1);
    expect(v.stats.inWindow).toBe(2);
  });
});

describe('needHolds', () => {
  const row = (key: string, kind: NeedRow['kind'], extra: Partial<NeedRow> = {}): NeedRow => ({ key, kind, severity: 1, stakes: 0, subject: key, text: key, subjectPath: '/', action: { kind: 'open', path: '/', label: 'Open' }, ...extra } as NeedRow);
  it('a simple approval, a question and a steer ask for an answer; every other gate, a stall and an orphan need a decision', () => {
    const holds = needHolds([
      row('gate:a', 'gate', { groupKey: 'approval' }), row('gate:b', 'gate'), row('elicit:c', 'elicitation'), row('steer:d', 'steer-request'),
      row('stalled:e', 'stalled-run'), row('orphaned:f', 'orphaned-run'), row('fail:g', 'failed-run'),
    ]);
    expect(Object.fromEntries(holds)).toEqual({ a: 'answer', b: 'decision', c: 'answer', d: 'answer', e: 'decision', f: 'decision' });
  });
  it('a decision outranks an answer on the same run, and a folded group counts its members', () => {
    const group = row('group:approval', 'gate', { members: [row('gate:x', 'gate', { groupKey: 'approval' })] });
    expect(Object.fromEntries(needHolds([group, row('stalled:x', 'stalled-run'), row('elicit:x', 'elicitation')]))).toEqual({ x: 'decision' });
  });
});

describe('jobsSentence', () => {
  const s = (o: Partial<ReturnType<typeof runsView>['stats']>) => ({ active: 0, working: 0, waiting: 0, decision: 0, finished: 0, failed: 0, stopped: 0, ended: 0, inWindow: 0, ...o });
  it('says what is live, then what ended in the window, in words', () => {
    expect(jobsSentence(s({ active: 2, working: 1, waiting: 1, finished: 12, ended: 12 }), 'the last 30 days', true)).toBe('One running, one waiting on you. Twelve finished in the last 30 days.');
    expect(jobsSentence(s({ active: 1, decision: 1, finished: 3, failed: 2, ended: 5 }), 'the last 7 days', true)).toBe('One needs a decision. Three finished in the last 7 days, two failed.');
    expect(jobsSentence(s({ finished: 0, failed: 1, ended: 1 }), 'the last 7 days', true)).toBe('Nothing is running. None finished in the last 7 days, one failed.');
    expect(jobsSentence(s({}), 'the last 30 days', true)).toBe('Nothing is running. None ended in the last 30 days.');
  });
  it('never claims a zero before the run list is read, and greets an empty studio', () => {
    expect(jobsSentence(null, 'the last 30 days', false)).toBe('Reading your jobs…');
    expect(jobsSentence(s({}), 'the last 30 days', false)).toMatch(/^No jobs yet/);
  });
});

describe('jobLine', () => {
  const opts = { agentName: names.agent, projectName: names.project, showProject: true, ago: () => '2 hours ago' };
  it('says where, who and how far for an active job', () => {
    const r = view([deskRun('w', { status: 'executing', repo_ref: 'wicked-core' })], { group: 'active' }).rows[0]!;
    expect(jobLine(r, opts)).toBe('wicked-core · Codex · step 2 of 2');
  });
  it('names the project, else the workflow, when the job names no repo; a finished job says when it ended', () => {
    const r = view([deskRun('f')]).rows[0]!;
    expect(jobLine(r, opts)).toBe('Studio Desk · Claude Sonnet · 2 hours ago');
    expect(jobLine(r, { ...opts, showProject: false })).toBe('Fix bug · Claude Sonnet · 2 hours ago');
    const failed = view([deskRun('x', { status: 'failed' })]).rows[0]!;
    expect(jobLine(failed, opts)).toBe('Studio Desk · Claude Sonnet · stopped at step 2 of 2 · 2 hours ago');
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
