import { describe, expect, it } from 'vitest';
import type { Project, SessionView } from '../src/api/types.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { RailGroup } from '../src/board/deskModel.js';
import { type ProjectRow, filterProjectRows, projectCardWords, projectRows, projectsSentence, projectWaiting } from '../src/board/projectsModel.js';
import { projectHomeSentence } from '../src/board/projectHome.js';

const project = (id: string, updated_at: number): Project => ({ id, name: id, description: '', status: 'active', updated_at } as Project);
const run = (id: string, created_at: number, ended_at?: number): SessionView => ({ session: { id, created_at, ended_at }, units: [] } as unknown as SessionView);

describe('S17a project rows', () => {
  it('includes empty projects, excludes default, orders by run clock and filters by name', () => {
    const projects = [project('default', 3000), project('scratch', 2000), project('Alpha', 1000)];
    const groups: RailGroup[] = [{ projectId: 'Alpha', name: 'Alpha', sessions: [
      { id: 'run:r1', runId: 'r1', runIds: ['r1'], title: 'A', state: 'blocked', badge: 0, line: '', path: '/s/run:r1', status: { word: 'Failed', tone: 'fail' }, at: 4000, launchedAt: 1000, tag: null },
    ], more: [] }];
    const items = [{ project: projects[2], repoNames: ['Studio API'] }] as BoardProject[];
    const rows = projectRows(projects, items, groups, [run('r1', 1, 4)]);
    expect(rows.map((row) => row.project.id)).toEqual(['Alpha', 'scratch']);
    expect(rows[0]).toMatchObject({ repos: ['Studio API'], counts: { blocked: 1, working: 0 }, latestMs: 4000 });
    expect(rows[1]).toMatchObject({ repos: [], counts: { blocked: 0 }, latestMs: 2000 });
    expect(filterProjectRows(rows, 'ALP').map((row) => row.project.id)).toEqual(['Alpha']);
  });
});

describe('the Projects cards and a project home say only what the runs say', () => {
  const NOW = Date.UTC(2026, 9, 27, 12);
  const row = (counts: Partial<Record<'working' | 'waiting' | 'done' | 'blocked' | 'quiet', number>>, extra: Partial<ProjectRow> = {}): ProjectRow => ({
    project: { id: 'p', name: 'P', status: 'active' } as Project, repos: [], latestMs: NOW - 3 * 86_400_000, finishedMs: [], runIds: [],
    counts: { working: 0, waiting: 0, done: 0, blocked: 0, quiet: 0, ...counts }, ...extra,
  });
  const ago = (): string => '3 days ago';
  it('N needs you, On track, Quiet; the sentence counts the running and the week', () => {
    expect(projectCardWords(row({ waiting: 1, working: 2 }, { finishedMs: [NOW - 86_400_000, NOW - 9 * 86_400_000] }), NOW, true, ago))
      .toEqual({ state: '1 needs you', tone: 'gate', sentence: 'Two jobs running, 1 finished this week.' });
    expect(projectCardWords(row({ working: 1 }), NOW, true, ago)).toMatchObject({ state: 'On track', tone: 'ok', sentence: 'One job running.' });
    expect(projectCardWords(row({ done: 3, blocked: 1 }), NOW, true, ago)).toEqual({ state: 'Quiet', tone: 'quiet', sentence: 'Nothing running, 1 failed. Last activity 3 days ago.' });
    expect(projectCardWords(row({}), NOW, true, ago).sentence).toBe('No jobs yet.');
    // Before the runs read answers: no verdict about the jobs.
    expect(projectCardWords(row({ done: 3 }), NOW, false, ago)).toMatchObject({ state: '', sentence: 'Reading its jobs…' });
  });

  it('a ranked crew decides who needs you; the page and home sentences', () => {
    const r = row({ waiting: 3 }, { runIds: ['a', 'b', 'c'] });
    expect(projectWaiting(r, null)).toBe(3);
    expect(projectWaiting(r, new Set(['b', 'z']))).toBe(1);
    expect(projectsSentence([r, row({})], true)).toBe('Two projects. One needs you.');
    expect(projectsSentence([r, row({})], true, new Set())).toBe('Two projects. Nothing needs you.');
    expect(projectHomeSentence({ known: true, waiting: 1, running: 2, repos: 4 })).toBe('One thing needs you. Two jobs are running across four repositories.');
    expect(projectHomeSentence({ known: true, waiting: 0, running: 0, repos: 6 })).toBe('Nothing needs you. Nothing is running.');
  });
});
