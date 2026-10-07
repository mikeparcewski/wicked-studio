import { describe, expect, it } from 'vitest';
import type { Project, SessionView } from '../src/api/types.js';
import type { BoardProject } from '../src/hooks/useBoardModel.js';
import type { RailGroup } from '../src/board/deskModel.js';
import { filterProjectRows, projectRows } from '../src/board/projectsModel.js';

const project = (id: string, updated_at: number): Project => ({ id, name: id, description: '', status: 'active', updated_at } as Project);
const run = (id: string, created_at: number, ended_at?: number): SessionView => ({ session: { id, created_at, ended_at }, units: [] } as unknown as SessionView);

describe('S17a project rows', () => {
  it('includes empty projects, excludes default, orders by run clock and filters by name', () => {
    const projects = [project('default', 3000), project('scratch', 2000), project('Alpha', 1000)];
    const groups: RailGroup[] = [{ projectId: 'Alpha', name: 'Alpha', sessions: [
      { id: 'run:r1', runId: 'r1', runIds: ['r1'], title: 'A', state: 'blocked', badge: 0, line: '', path: '/s/run:r1' },
    ] }];
    const items = [{ project: projects[2], repoNames: ['Studio API'] }] as BoardProject[];
    const rows = projectRows(projects, items, groups, [run('r1', 1, 4)]);
    expect(rows.map((row) => row.project.id)).toEqual(['Alpha', 'scratch']);
    expect(rows[0]).toMatchObject({ repos: ['Studio API'], counts: { blocked: 1, working: 0 }, latestMs: 4000 });
    expect(rows[1]).toMatchObject({ repos: [], counts: { blocked: 0 }, latestMs: 2000 });
    expect(filterProjectRows(rows, 'ALP').map((row) => row.project.id)).toEqual(['Alpha']);
  });
});
