import type { Project, SessionView } from '../api/types.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import type { RailGroup } from './deskModel.js';
import { endedAtMs, finishedAtMs } from './needsYou.js';
import type { SessionState } from './sessionModel.js';

export interface ProjectRow {
  project: Project;
  repos: string[];
  counts: Record<SessionState, number>;
  latestMs: number;
}

/** One row per real project, including projects without runs or members. */
export function projectRows(projects: readonly Project[], items: readonly BoardProject[], groups: readonly RailGroup[], runs: readonly SessionView[]): ProjectRow[] {
  const itemById = new Map(items.map((item) => [item.project.id, item]));
  const groupById = new Map(groups.map((group) => [group.projectId, group]));
  const runById = new Map(runs.map((run) => [run.session.id, run]));
  return projects.filter((project) => project.id !== 'default').map((project) => {
    const counts: Record<SessionState, number> = { working: 0, waiting: 0, done: 0, blocked: 0, quiet: 0 };
    const sessions = groupById.get(project.id)?.sessions ?? [];
    let latestMs = 0;
    for (const session of sessions) {
      counts[session.state]++;
      for (const id of session.runIds) {
        const run = runById.get(id);
        if (run === undefined) continue;
        const created = (run.session as unknown as { created_at?: unknown }).created_at;
        latestMs = Math.max(latestMs, endedAtMs(run) ?? finishedAtMs(run) ?? (typeof created === 'number' ? created * 1000 : 0));
      }
    }
    return { project, repos: itemById.get(project.id)?.repoNames ?? [], counts, latestMs: sessions.length === 0 ? project.updated_at : latestMs };
  }).sort((a, b) => b.latestMs - a.latestMs || a.project.name.localeCompare(b.project.name));
}

export function filterProjectRows(rows: readonly ProjectRow[], name: string): ProjectRow[] {
  const term = name.trim().toLocaleLowerCase();
  return rows.filter((row) => row.project.name.toLocaleLowerCase().includes(term));
}
