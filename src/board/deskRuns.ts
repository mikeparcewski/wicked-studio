import type { SessionView } from '../api/types.js';
import { agentsOf, leadAgentOf, outcomeOf, projectOf, refineRuns, workflowOf, type Outcome, type Refine } from './deskInsights.js';
import { needRunId } from './deskModel.js';
import { repoNameOf } from './deskWords.js';
import type { NeedRow } from './needsYou.js';
import { createdAtMs } from './windowStats.js';

/**
 * THE JOBS PAGE (the Desk's Runs view, calm v2, operator 2026-10-26: "needs more whitespace — easy to
 * scan — think humans, we get overwhelmed easy"). One filter on the face, Active or Finished; each row
 * is a job title, one muted line (repo · agent · step x of y) and one status word. Search, the refine
 * bar (range, project, agent, workflow), a finer status and All time sit behind "Search and filter".
 * Pure: the page renders what this returns. The outcome under the word is the one Report charts
 * (`outcomeOf`), so a run is "Failed" here exactly when it is in the chart.
 */

/** The page's one filter. Active = a job still moving or waiting on a person; Finished = every job that ended (finished, answered, failed or stopped). */
export type JobGroup = 'active' | 'finished';

export const JOB_GROUPS: readonly { value: JobGroup; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'finished', label: 'Finished' },
];

/** The word on a row's right. "Needs a decision" = a job held by something a person must settle (a
 *  gate with evidence to weigh, a stall, an orphan, a stranded delivery), not a plain approval. */
export type JobWord = 'Working' | 'Waiting on you' | 'Needs a decision' | 'Finished' | 'Answered' | 'Failed' | 'Stopped' | 'Unknown';
export type JobTone = 'run' | 'gate' | 'warn' | 'ok' | 'fail' | 'quiet';

const TONE: Record<JobWord, JobTone> = {
  Working: 'run', 'Waiting on you': 'gate', 'Needs a decision': 'warn',
  Finished: 'ok', Answered: 'ok', Failed: 'fail', Stopped: 'quiet', Unknown: 'quiet',
};
// An unmapped status (`Unknown`) is not known to have ended, so it stays with the active jobs and never counts as ended.
const ACTIVE_WORDS: ReadonlySet<JobWord> = new Set(['Working', 'Waiting on you', 'Needs a decision', 'Unknown']);

/** The finer status behind "Search and filter" (per group: the words that group can hold). */
export type RunStatusFilter = 'all' | 'working' | 'waiting' | 'decision' | 'finished' | 'failed' | 'stopped';

export const RUN_STATUS_FILTERS: Readonly<Record<JobGroup, readonly { value: RunStatusFilter; label: string }[]>> = {
  active: [
    { value: 'all', label: 'Any' },
    { value: 'working', label: 'Working' },
    { value: 'waiting', label: 'Waiting on you' },
    { value: 'decision', label: 'Needs a decision' },
  ],
  finished: [
    { value: 'all', label: 'Any' },
    { value: 'finished', label: 'Finished' },
    { value: 'failed', label: 'Failed' },
    { value: 'stopped', label: 'Stopped' },
  ],
};

const OF_FILTER: Record<Exclude<RunStatusFilter, 'all'>, readonly JobWord[]> = {
  working: ['Working'],
  waiting: ['Waiting on you'],
  decision: ['Needs a decision'],
  finished: ['Finished', 'Answered'],
  failed: ['Failed'],
  stopped: ['Stopped'],
};

/** What a needs-you row asks of a run's person: an answer (a plain approval, a question, a steer) or a decision. */
export type NeedHold = 'answer' | 'decision';

/**
 * Per run, what Needs you holds it for. A simple gate (the queue's `approval` group: approve or not,
 * no evidence to weigh), a question and a steer request ask for an answer; every other gate (a
 * delivery, a failed verdict, a floor, a high-impact plan) and a stall, orphan or stranded delivery
 * need a decision. A failed run's row is not a hold: its word is Failed. Decision outranks answer.
 */
export function needHolds(rows: readonly NeedRow[]): Map<string, NeedHold> {
  const out = new Map<string, NeedHold>();
  for (const r of rows.flatMap((x) => x.members ?? [x])) {
    const id = needRunId(r);
    if (id === null || r.kind === 'failed-run') continue;
    const hold: NeedHold = (r.kind === 'gate' && r.groupKey === 'approval') || r.kind === 'elicitation' || r.kind === 'steer-request' ? 'answer' : 'decision';
    if (out.get(id) !== 'decision') out.set(id, hold);
  }
  return out;
}

/** A run's word: its outcome, sharpened by what Needs you holds it for while it is still open. */
export function jobWord(outcome: Outcome | null, hold: NeedHold | undefined): JobWord {
  if (outcome === 'Working' || outcome === 'Waiting on you') {
    if (hold === 'decision') return 'Needs a decision';
    if (hold === 'answer') return 'Waiting on you';
    return outcome;
  }
  return outcome ?? 'Unknown';
}

export interface RunRow {
  id: string;
  title: string;
  /** The chart's outcome word (Report's), kept for `data-outcome`. */
  outcome: Outcome | 'Unknown';
  word: JobWord;
  tone: JobTone;
  group: JobGroup;
  project: string;
  /** The registry's repo name, when the run names one plainly. */
  repo: string | null;
  workflow: string;
  agents: string[];
  /** Who is on it: the current step's agent while it moves, else the one that did most of it. */
  agent: string | null;
  stepsDone: number;
  steps: number;
  /** ms; null = no start clock. */
  startedAt: number | null;
  /** ms; null = still open. */
  endedAt: number | null;
}

export interface RunsView {
  rows: RunRow[];
  /** Counts over every job the refine bar keeps (not the group, status or search), so the sentence never moves with a chip. */
  stats: { active: number; working: number; waiting: number; decision: number; finished: number; failed: number; stopped: number; ended: number; inWindow: number };
  /** Finished jobs in scope with no start clock (left out of a time window). */
  undated: number;
  /** How many more finished jobs All time would show (older, undated or archived); 0 when All time is on. */
  beyond: number;
}

function rowOf(v: SessionView, title: (v: SessionView) => string, holds: ReadonlyMap<string, NeedHold>): RunRow {
  const units = v.units ?? [];
  const ended = (v.session as { ended_at?: number | null }).ended_at;
  const outcome = outcomeOf(v);
  const word = jobWord(outcome, holds.get(v.session.id));
  const group: JobGroup = ACTIVE_WORDS.has(word) ? 'active' : 'finished';
  const current = units.find((u) => u.status !== 'done');
  const now = group === 'active' && typeof current?.assigned_cli === 'string' && current.assigned_cli !== '' ? current.assigned_cli : null;
  const agents = agentsOf(v);
  return {
    id: v.session.id,
    title: title(v),
    outcome: outcome ?? 'Unknown',
    word,
    tone: TONE[word],
    group,
    project: projectOf(v),
    repo: repoNameOf(v),
    workflow: workflowOf(v).label,
    agents,
    agent: now !== null && agents.includes(now) ? now : leadAgentOf(v),
    stepsDone: units.filter((u) => u.status === 'done').length,
    steps: units.length,
    startedAt: createdAtMs(v),
    endedAt: typeof ended === 'number' ? ended * 1000 : null,
  };
}

/** Lower-case words of a row that a search matches (title, id, workflow, repo, project and agent names). */
function haystack(r: RunRow, names: { project: (id: string) => string; agent: (cli: string) => string }): string {
  return [r.title, r.id, r.workflow, r.repo ?? '', names.project(r.project), ...r.agents.map(names.agent)].join(' ').toLowerCase();
}

const newestFirst = (a: RunRow, b: RunRow): number => (b.startedAt ?? 0) - (a.startedAt ?? 0);

/**
 * The page's rows. Active jobs ignore the time window (a job started six weeks ago and still running
 * is still active) but honour project, agent and workflow; finished jobs keep the window unless All
 * time is on. Archived jobs only show under All time.
 */
export function runsView(runs: readonly SessionView[], refine: Refine, opts: {
  group: JobGroup; status: RunStatusFilter; query: string; now: number; allTime?: boolean;
  title: (v: SessionView) => string; names: { project: (id: string) => string; agent: (cli: string) => string };
  holds?: ReadonlyMap<string, NeedHold>;
}): RunsView {
  const { group, status, query, now, title, names, allTime = false } = opts;
  const holds = opts.holds ?? new Map<string, NeedHold>();
  const everyDate = refineRuns(runs, refine, now, true).kept.map((v) => rowOf(v, title, holds));
  const active = everyDate.filter((r) => r.group === 'active' && !archived(runs, r.id));
  const windowed = refineRuns(runs, refine, now, false);
  const finishedWin = windowed.kept.map((v) => rowOf(v, title, holds)).filter((r) => r.group === 'finished');
  const finishedAll = everyDate.filter((r) => r.group === 'finished');
  const finished = allTime ? finishedAll : finishedWin;
  const count = (rs: readonly RunRow[], w: readonly JobWord[]): number => rs.filter((r) => w.includes(r.word)).length;
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== '');
  const rows = (group === 'active' ? active : finished)
    .filter((r) => status === 'all' || (OF_FILTER[status]?.includes(r.word) ?? false))
    .filter((r) => { if (words.length === 0) return true; const h = haystack(r, names); return words.every((w) => h.includes(w)); })
    .sort(newestFirst);
  return {
    rows,
    stats: {
      active: active.length,
      working: count(active, OF_FILTER.working),
      waiting: count(active, OF_FILTER.waiting),
      decision: count(active, OF_FILTER.decision),
      finished: count(finished, OF_FILTER.finished),
      failed: count(finished, OF_FILTER.failed),
      stopped: count(finished, OF_FILTER.stopped),
      ended: finished.length,
      inWindow: windowed.kept.length,
    },
    undated: windowed.undated,
    beyond: allTime ? 0 : finishedAll.length - finishedWin.length,
  };
}

function archived(runs: readonly SessionView[], id: string): boolean {
  const v = runs.find((x) => x.session.id === id);
  return v !== undefined && v.session.archived_at != null;
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
/** A count as words read in a sentence: "one", "twelve", then digits. */
function said(n: number, lead = false): string {
  const w = WORDS[n] ?? String(n);
  return lead ? w : w.toLowerCase();
}

/**
 * The one sentence under "Jobs": what is live, then what ended in the window.
 *  "One running, one waiting on you. Twelve finished in the last 30 days, two failed."
 *  "Nothing is running. Three finished in the last 7 days." / "No jobs yet."
 * `null` stats = the run list has not been read: never a zero verdict. `any` = studio holds any job at all.
 */
export function jobsSentence(stats: RunsView['stats'] | null, window: string, any: boolean): string {
  if (stats === null) return 'Reading your jobs…';
  if (!any) return 'No jobs yet. Start one and it shows here.';
  const live = [
    stats.working > 0 ? `${said(stats.working)} running` : null,
    stats.waiting > 0 ? `${said(stats.waiting)} waiting on you` : null,
    stats.decision > 0 ? `${said(stats.decision)} ${stats.decision === 1 ? 'needs' : 'need'} a decision` : null,
  ].filter((x): x is string => x !== null);
  const first = live.length === 0 ? 'Nothing is running.' : `${cap(live.join(', '))}.`;
  if (stats.ended === 0) return `${first} None ended in ${window}.`;
  const done = stats.finished > 0 ? `${said(stats.finished, true)} finished in ${window}` : `None finished in ${window}`;
  const bad = [stats.failed > 0 ? `${said(stats.failed)} failed` : null, stats.stopped > 0 ? `${said(stats.stopped)} stopped` : null].filter((x): x is string => x !== null);
  return `${first} ${done}${bad.length > 0 ? `, ${bad.join(', ')}` : ''}.`;
}

function cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }

/**
 * A row's muted line: where (the repo, else the project when the page shows several, else the
 * workflow), who, and how far ("step 3 of 9"; a finished job says when it ended instead).
 */
export function jobLine(r: RunRow, { agentName, projectName, showProject, ago }: {
  agentName: (cli: string) => string; projectName: (id: string) => string; showProject: boolean; ago: (ms: number) => string;
}): string {
  const where = r.repo ?? (showProject && r.project !== 'default' ? projectName(r.project) : r.workflow);
  const who = r.agent === null ? null : agentName(r.agent);
  const at = Math.min(r.steps, r.stepsDone + 1);
  const how = r.group === 'active'
    ? (r.steps === 0 ? 'planning' : `step ${at} of ${r.steps}`)
    : r.word === 'Failed' && r.steps > 0
      ? `stopped at step ${at} of ${r.steps}${r.endedAt !== null ? ` · ${ago(r.endedAt)}` : ''}`
      : r.endedAt !== null ? ago(r.endedAt) : r.startedAt !== null ? `started ${ago(r.startedAt)}` : null;
  return [where, who, how].filter((x): x is string => x !== null && x !== '').join(' · ');
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
