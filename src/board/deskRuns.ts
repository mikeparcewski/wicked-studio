import type { SessionView } from '../api/types.js';
import { agentsOf, outcomeOf, projectOf, refineRuns, workflowOf, type Outcome, type Refine } from './deskInsights.js';
import { createdAtMs } from './windowStats.js';

/**
 * THE DESK'S RUNS TAB (operator 2026-10-13): every run in the refine window as one list, with a
 * stat row and a status filter. Pure: the tab renders what this returns. The outcome word is the
 * one Report charts (`outcomeOf`), so a run is "Failed" in the list exactly when it is in the chart.
 */

export type RunStatusFilter = 'all' | 'working' | 'waiting' | 'finished' | 'failed' | 'stopped';

export const RUN_STATUS_FILTERS: readonly { value: RunStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'working', label: 'Running' },
  { value: 'waiting', label: 'Waiting on you' },
  { value: 'finished', label: 'Finished' },
  { value: 'failed', label: 'Failed' },
  { value: 'stopped', label: 'Stopped' },
];

const OF_FILTER: Record<Exclude<RunStatusFilter, 'all'>, readonly Outcome[]> = {
  working: ['Working'],
  waiting: ['Waiting on you'],
  finished: ['Finished', 'Answered'],
  failed: ['Failed'],
  stopped: ['Stopped'],
};

export interface RunRow {
  id: string;
  title: string;
  outcome: Outcome | 'Unknown';
  project: string;
  workflow: string;
  agents: string[];
  stepsDone: number;
  steps: number;
  /** ms; null = no start clock. */
  startedAt: number | null;
  /** ms; null = still open. */
  endedAt: number | null;
}

export interface RunsView {
  rows: RunRow[];
  /** Every run the filters (not the status or search) keep, so the tiles do not move with the status chip. */
  stats: { inWindow: number; running: number; waiting: number; finished: number; failed: number; ended: number };
  /** Runs in scope that have no start clock (left out of a time window). */
  undated: number;
  /** How many more runs All time would show (older, undated or archived); 0 when All time is on. */
  beyond: number;
}

function rowOf(v: SessionView, title: (v: SessionView) => string): RunRow {
  const units = v.units ?? [];
  const ended = (v.session as { ended_at?: number | null }).ended_at;
  return {
    id: v.session.id,
    title: title(v),
    outcome: outcomeOf(v) ?? 'Unknown',
    project: projectOf(v),
    workflow: workflowOf(v).label,
    agents: agentsOf(v),
    stepsDone: units.filter((u) => u.status === 'done').length,
    steps: units.length,
    startedAt: createdAtMs(v),
    endedAt: typeof ended === 'number' ? ended * 1000 : null,
  };
}

/** Lower-case words of a row that a search matches (title, id, workflow, project and agent names). */
function haystack(r: RunRow, names: { project: (id: string) => string; agent: (cli: string) => string }): string {
  return [r.title, r.id, r.workflow, names.project(r.project), ...r.agents.map(names.agent)].join(' ').toLowerCase();
}

export function runsView(runs: readonly SessionView[], refine: Refine, status: RunStatusFilter, query: string, now: number,
  title: (v: SessionView) => string, names: { project: (id: string) => string; agent: (cli: string) => string }, allTime = false): RunsView {
  const { kept, undated } = refineRuns(runs, refine, now, allTime);
  // How many more an All time view would hold (older, undated or archived): the switch says so.
  const beyond = allTime ? 0 : refineRuns(runs, refine, now, true).kept.length - kept.length;
  const all = kept.map((v) => rowOf(v, title));
  const count = (o: readonly Outcome[]): number => all.filter((r) => o.some((word) => word === r.outcome)).length;
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  const rows = all
    .filter((r) => status === 'all' || OF_FILTER[status].some((word) => word === r.outcome))
    .filter((r) => { if (words.length === 0) return true; const h = haystack(r, names); return words.every((w) => h.includes(w)); })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  return {
    rows,
    stats: {
      inWindow: all.length,
      running: count(OF_FILTER.working),
      waiting: count(OF_FILTER.waiting),
      finished: count(OF_FILTER.finished),
      failed: count(OF_FILTER.failed),
      ended: count([...OF_FILTER.finished, ...OF_FILTER.failed, ...OF_FILTER.stopped]),
    },
    undated,
    beyond,
  };
}

/** A run's duration words: "4 min", "2 h 5 min", "3 d"; null when it has no start. */
export function durationWords(r: Pick<RunRow, 'startedAt' | 'endedAt'>, now: number): string | null {
  if (r.startedAt === null) return null;
  const min = Math.max(0, Math.round(((r.endedAt ?? now) - r.startedAt) / 60_000));
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h${min % 60 > 0 ? ` ${min % 60} min` : ''}`;
  return `${Math.round(h / 24)} d`;
}
