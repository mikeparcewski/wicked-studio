import type { Project, SessionView } from '../api/types.js';
import type { SystemSnapshot } from '../api/system.js';
import type { BoardProject } from '../hooks/useBoardModel.js';
import type { RailGroup } from './deskModel.js';
import { endedAtMs, finishedAtMs } from './needsYou.js';
import type { SessionState } from './sessionModel.js';
import { countWord } from './deskHome.js';

export interface ProjectRow {
  project: Project;
  repos: string[];
  counts: Record<SessionState, number>;
  latestMs: number;
  /** When each of its runs finished (unix millis), for "N finished this week"; unfinished runs are absent. */
  finishedMs: number[];
  /** Its runs' ids (a ranked crew's needs-you list is matched against them). */
  runIds: string[];
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
    const finishedMs: number[] = [];
    const runIds: string[] = [];
    for (const session of sessions) {
      counts[session.state]++;
      for (const id of session.runIds) {
        runIds.push(id);
        const run = runById.get(id);
        if (run === undefined) continue;
        const ended = endedAtMs(run) ?? finishedAtMs(run);
        if (ended !== null && ended !== undefined) finishedMs.push(ended);
        const created = (run.session as unknown as { created_at?: unknown }).created_at;
        latestMs = Math.max(latestMs, endedAtMs(run) ?? finishedAtMs(run) ?? (typeof created === 'number' ? created * 1000 : 0));
      }
    }
    return { project, repos: itemById.get(project.id)?.repoNames ?? [], counts, latestMs: sessions.length === 0 ? project.updated_at : latestMs, finishedMs, runIds };
  }).sort((a, b) => b.latestMs - a.latestMs || a.project.name.localeCompare(b.project.name));
}

export function filterProjectRows(rows: readonly ProjectRow[], name: string): ProjectRow[] {
  const term = name.trim().toLocaleLowerCase();
  return rows.filter((row) => row.project.name.toLocaleLowerCase().includes(term));
}

const WEEK_MS = 7 * 86_400_000;

/** A project card's state: who it waits on, or whether it is moving. */
export interface ProjectCardWords {
  /** "1 needs you", "On track", "Quiet". */
  state: string;
  tone: 'gate' | 'ok' | 'quiet';
  /** One sentence: what is running, what finished this week, what failed, or when it last moved. */
  sentence: string;
}

/**
 * The Projects list's card words (the operator-approved mockup `ui-v2-projects`), from the project's own
 * runs: "N needs you" while any of its jobs waits on you, "On track" while one is working, else "Quiet".
 * `known` false (the runs read has not answered) says nothing about the jobs, never "Nothing running".
 */
export function projectCardWords(row: ProjectRow, now: number, known: boolean, ago: (ms: number) => string, ranked: ReadonlySet<string> | null = null): ProjectCardWords {
  const { working, blocked } = row.counts;
  const waiting = projectWaiting(row, ranked);
  const state = waiting > 0 ? { state: `${waiting} ${waiting === 1 ? 'needs' : 'need'} you`, tone: 'gate' as const }
    : working > 0 ? { state: 'On track', tone: 'ok' as const } : { state: 'Quiet', tone: 'quiet' as const };
  if (!known) return { ...state, state: waiting > 0 || working > 0 ? state.state : '', sentence: 'Reading its jobs…' };
  const jobs = Object.values(row.counts).reduce((a, b) => a + b, 0);
  if (jobs === 0) return { ...state, sentence: 'No jobs yet.' };
  const week = row.finishedMs.filter((t) => now - t <= WEEK_MS).length;
  const running = working === 0 ? 'Nothing running' : `${countWord(working)} ${working === 1 ? 'job' : 'jobs'} running`;
  const parts = [running, week > 0 ? `${week} finished this week` : null, blocked > 0 ? `${blocked} failed` : null].filter((x): x is string => x !== null);
  const head = `${parts.join(', ')}.`;
  return { ...state, sentence: week === 0 && working === 0 && row.latestMs > 0 ? `${head} Last activity ${ago(row.latestMs)}.` : head };
}

/** The Projects page's sentence: "Three projects. One needs you." */
export function projectsSentence(rows: readonly ProjectRow[], known: boolean, ranked: ReadonlySet<string> | null = null): string {
  const n = rows.length;
  if (n === 0) return 'No projects yet. A project keeps the jobs and repositories that belong together.';
  const head = `${countWord(n)} ${n === 1 ? 'project' : 'projects'}.`;
  if (!known) return head;
  const k = rows.filter((r) => projectWaiting(r, ranked) > 0).length;
  return k === 0 ? `${head} Nothing needs you.` : `${head} ${countWord(k)} ${k === 1 ? 'needs' : 'need'} you.`;
}

/**
 * How many of a project's jobs need you. A ranked crew (api-types 0.140.0) says it: its needs-you list's
 * runs (`rankedNeedRunIds`) that are this project's. An older crew: the board's own "waiting" sessions.
 */
export function projectWaiting(row: ProjectRow, ranked: ReadonlySet<string> | null): number {
  if (ranked === null) return row.counts.waiting;
  return new Set(row.runIds.filter((id) => ranked.has(id))).size;
}

/** The runs a ranked crew's needs-you list names (each item's run, and the runs it holds), or null
 *  when the snapshot is not ranked (an older crew, or no snapshot yet). */
export function rankedNeedRunIds(snapshot: SystemSnapshot | null): Set<string> | null {
  if (snapshot === null || snapshot.ranked !== true) return null;
  const ids = new Set<string>();
  for (const a of snapshot.attention) {
    if (a.panel !== 'runs') continue;
    if (a.runId != null) ids.add(a.runId);
    for (const id of a.blockedRunIds ?? []) ids.add(id);
  }
  return ids;
}
