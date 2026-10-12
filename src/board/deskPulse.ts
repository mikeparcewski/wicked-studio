import type { SessionView, WorkUnit } from '../api/types.js';
import { createdAtMs, createdAtSeries, createdAtWindow, deliveryCounts } from './windowStats.js';
import { jobTitle, jobTitleFull } from './deskWords.js';
import { relTime } from './relTime.js';
import { statusWord, type StatusTone } from './statusWords.js';

/**
 * THE DESK'S NUMBERS AND SENTENCES (DES-frontdoor concept A + B's opening sentence; operator ruling
 * 2026-10-12). Pure folds over what the app already holds — the run list (`GET /runs`, real
 * `created_at`/`ended_at` clocks, unix seconds), the needs-you rows, and one spend read — so the
 * Desk and the project dashboard cannot disagree on what a window, a delta or a duration means.
 *
 * Honesty: a run with no `created_at` is in no window (it is counted as left out, and said so); a
 * duration needs both clocks; a delta needs a real window before; nothing here invents a number.
 */

export type WindowDays = 7 | 30 | 90;
export const WINDOWS: readonly WindowDays[] = [7, 30, 90];

const DAY_MS = 86_400_000;

/** "the last 7 days" — the window in words. */
export function windowWords(days: WindowDays): string {
  return `the last ${days} days`;
}

export interface Pulse {
  started: { count: number; previous: number; series: number[] };
  failed: { count: number; overall: number; series: number[] };
  delivered: number;
  /** Median minutes from launch to finish of the window's finished jobs; null when none has both clocks. */
  typicalMin: number | null;
  /** How many finished jobs the median is over. */
  typicalOf: number;
  running: number;
  /** Runs left out of every window because the daemon recorded no launch time for them. */
  undated: number;
}

const live = (v: SessionView): boolean => v.session.archived_at == null;
/** Working: the engine is planning, handing out or running a step. */
const WORKING = new Set<string>(['planning', 'distributing', 'executing']);
const isWorking = (v: SessionView): boolean => WORKING.has(v.session.status);

export function pulse(runs: readonly SessionView[], days: WindowDays, now: number): Pulse {
  const all = runs.filter(live);
  const win = createdAtWindow([...all], days, now);
  const failedIn = win.current.filter((v) => v.session.status === 'failed');
  const finished = win.current
    .filter((v) => v.session.status === 'completed' && typeof v.session.ended_at === 'number' && typeof v.session.created_at === 'number')
    .map((v) => ((v.session.ended_at as number) - (v.session.created_at as number)) / 60)
    .filter((m) => m >= 0)
    .sort((a, b) => a - b);
  return {
    started: { count: win.current.length, previous: win.previous.length, series: createdAtSeries([...all], days, now) },
    failed: {
      count: failedIn.length,
      overall: all.filter((v) => v.session.status === 'failed').length,
      series: createdAtSeries(all.filter((v) => v.session.status === 'failed'), days, now),
    },
    delivered: deliveryCounts(win.current).delivered,
    typicalMin: finished.length === 0 ? null : median(finished),
    typicalOf: finished.length,
    running: all.filter(isWorking).length,
    undated: all.filter((v) => createdAtMs(v) === null).length,
  };
}

function median(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** "45 s", "13.2 min", "2.4 h", "3.1 days". */
export function durationWords(minutes: number): string {
  if (minutes < 1) return `${Math.max(1, Math.round(minutes * 60))} s`;
  if (minutes < 60) return `${minutes < 10 ? minutes.toFixed(1) : Math.round(minutes)} min`;
  const h = minutes / 60;
  if (h < 48) return `${h < 10 ? h.toFixed(1) : Math.round(h)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** "$11.24" — cents for small amounts, whole dollars past a thousand. */
export function moneyWords(usd: number): string {
  return usd >= 1000 ? `$${Math.round(usd).toLocaleString('en-US')}` : `$${usd.toFixed(2)}`;
}

// ── B's opening sentence ─────────────────────────────────────────────────────────────────────

export interface StoryInputs {
  days: WindowDays;
  started: number;
  /** Decisions waiting on you (the Desk's decision rows, members counted). */
  waiting: number;
  running: number;
  /** The open failure rows' runs (newest clock first is not required). */
  failures: readonly { projectName: string | null; at: number | null }[];
  /** Jobs that stopped moving and only a person moves (a stall, a lost worker): failure rows that are not failed runs. */
  stuck?: number;
  /** Proposals waiting on review; null = the read has not answered (said nothing about them). */
  reviews: number | null;
  now: number;
}

const n = (k: number, one: string, many: string): string => `${k} ${k === 1 ? one : many}`;

/**
 * The Desk's one deterministic sentence (concept B's intro, on A): what started, what waits on you,
 * what is running, what failed and where, and what waits on review — in that order, no model.
 * "2 jobs started in the last 7 days, and 2 are waiting for you. Nothing is running right now.
 *  3 jobs failed in My project 4 weeks ago and have not been retried. 81 proposals are waiting for review."
 */
export function deskStory(i: StoryInputs): string {
  const parts: string[] = [];
  const startedWords = i.started === 0 ? `No jobs started in ${windowWords(i.days)}` : `${n(i.started, 'job', 'jobs')} started in ${windowWords(i.days)}`;
  parts.push(i.waiting === 0
    ? `${startedWords}, and nothing is waiting for you.`
    : `${startedWords}, and ${i.waiting} ${i.waiting === 1 ? 'is' : 'are'} waiting for you.`);
  parts.push(i.running === 0 ? 'Nothing is running right now.' : `${n(i.running, 'job is', 'jobs are')} running now.`);
  if (i.failures.length > 0) {
    const projects = [...new Set(i.failures.map((f) => f.projectName))];
    const where = projects.length === 1 && projects[0] !== null ? ` in ${projects[0]}` : '';
    const clocks = i.failures.map((f) => f.at).filter((t): t is number => t !== null);
    const when = clocks.length > 0 ? ` ${i.failures.length === 1 ? '' : 'the latest '}${relTime(Math.max(...clocks), i.now)}` : '';
    parts.push(i.failures.length === 1
      ? `1 job failed${where}${when} and has not been retried.`
      : `${i.failures.length} jobs failed${where}${when ? `,${when},` : ''} and have not been retried.`);
  }
  if ((i.stuck ?? 0) > 0) parts.push(i.stuck === 1 ? '1 job has stopped moving and needs a look.' : `${i.stuck} jobs have stopped moving and need a look.`);
  if (i.reviews !== null && i.reviews > 0) parts.push(`${n(i.reviews, 'proposal is', 'proposals are')} waiting for review.`);
  return parts.join(' ');
}

// ── Jobs: lanes with step tracks ─────────────────────────────────────────────────────────────

export type StepMark = 'done' | 'fail' | 'gate' | 'run' | 'stopped' | 'todo';

export interface JobLane {
  runId: string;
  title: string;
  fullTitle: string;
  /** "My project · wicked-crew · 4 weeks ago" */
  context: string;
  steps: StepMark[];
  word: string;
  tone: StatusTone;
  path: string;
}

/** One mark per step: finished, failed, waiting on you, working, stopped, or not reached. */
export function stepMarks(v: SessionView): StepMark[] {
  const status = v.session.status;
  const marks = [...(v.units ?? [])].sort((a, b) => a.ord - b.ord).map((u: WorkUnit): StepMark => {
    if (u.status === 'done') return 'done';
    if (u.status === 'rejected') return 'fail';
    if (u.ord === v.session.unit_ix) {
      if (status === 'awaiting_human') return 'gate';
      if (WORKING.has(status)) return 'run';
      if (status === 'failed') return 'fail';
      if (status === 'cancelled') return 'stopped';
    }
    return 'todo';
  });
  // A job waiting on you shows where: the first step not reached is the one it waits before.
  if (status === 'awaiting_human' && !marks.includes('gate')) {
    const at = marks.indexOf('todo');
    if (at >= 0) marks[at] = 'gate';
    else marks.push('gate');
  }
  return marks;
}

/** The jobs that are on now, then the newest by launch, at most `max`. */
export function jobLanes(
  runs: readonly SessionView[],
  now: number,
  opts: { max: number; projectName: (id: string | null) => string | null; pathOf: (v: SessionView) => string },
): JobLane[] {
  const on = (v: SessionView): boolean => isWorking(v) || v.session.status === 'awaiting_human';
  const all = runs.filter(live);
  const ordered = [
    ...all.filter(on).sort((a, b) => (createdAtMs(b) ?? 0) - (createdAtMs(a) ?? 0)),
    ...all.filter((v) => !on(v) && createdAtMs(v) !== null).sort((a, b) => createdAtMs(b)! - createdAtMs(a)!),
  ].slice(0, opts.max);
  return ordered.map((v) => {
    const s = statusWord(v);
    const at = createdAtMs(v);
    const project = opts.projectName(typeof v.session.project_id === 'string' ? v.session.project_id : null);
    return {
      runId: v.session.id,
      title: jobTitle(v.session),
      fullTitle: jobTitleFull(v.session),
      context: [project, v.session.repo_ref, at !== null ? relTime(at, now) : null].filter((x): x is string => x !== null && x !== '').join(' · '),
      steps: stepMarks(v),
      word: s.word,
      tone: s.tone,
      path: opts.pathOf(v),
    };
  });
}

/** "The last job ended 4 weeks ago." — or null when no run carries an end clock. */
export function lastEndedWords(runs: readonly SessionView[], now: number): string | null {
  const ends = runs.map((v) => v.session.ended_at).filter((t): t is number => typeof t === 'number');
  return ends.length === 0 ? null : `The last job ended ${relTime(Math.max(...ends) * 1000, now)}.`;
}

// ── What happened (the narrator feed, run-level) ─────────────────────────────────────────────

export interface Story {
  key: string;
  runId: string;
  title: string;
  fullTitle: string;
  verb: string;
  tone: StatusTone;
  at: number;
  /** "3 steps done · by Claude Code" */
  detail: string;
  /** Alike stories folded into this one (the same job title and the same outcome, back to back). */
  count: number;
}

/**
 * The newest stories, one per thing that happened to a job: it started, it finished, it failed, it
 * was cancelled. A job waiting on you tells no story here — it is in Needs you (DES-frontdoor §4
 * requirement 4: the same item is never said twice on one screen).
 */
export function stories(
  runs: readonly SessionView[],
  opts: { max: number; helperName: (cli: string) => string | null; waitingRunIds?: ReadonlySet<string> },
): Story[] {
  const out: Story[] = [];
  for (const v of runs.filter(live)) {
    const s = v.session;
    if (opts.waitingRunIds?.has(s.id) === true || s.status === 'awaiting_human') continue;
    const done = (v.units ?? []).filter((u) => u.status === 'done').length;
    const helpers = [...new Set((v.units ?? []).map((u) => u.assigned_cli).filter((c): c is string => typeof c === 'string' && c !== ''))]
      .map(opts.helperName).filter((x): x is string => x !== null);
    const detail = [done > 0 ? n(done, 'step done', 'steps done') : null, helpers.length > 0 ? `by ${helpers.slice(0, 2).join(', ')}${helpers.length > 2 ? ` and ${helpers.length - 2} more` : ''}` : null]
      .filter((x): x is string => x !== null).join(' · ');
    const base = { runId: s.id, title: jobTitle(s), fullTitle: jobTitleFull(s), detail };
    const ended = typeof s.ended_at === 'number' ? s.ended_at * 1000 : null;
    if (ended !== null && (s.status === 'completed' || s.status === 'failed' || s.status === 'cancelled')) {
      const verb = s.status === 'completed' ? 'finished' : s.status === 'failed' ? 'failed' : 'was cancelled';
      const tone: StatusTone = s.status === 'completed' ? 'ok' : s.status === 'failed' ? 'fail' : 'quiet';
      out.push({ ...base, key: `end:${s.id}`, verb, tone, at: ended, count: 1 });
    }
    const started = createdAtMs(v);
    if (started !== null && (ended === null || isWorking(v))) {
      out.push({ ...base, key: `start:${s.id}`, verb: 'started', tone: 'run', at: started, count: 1 });
    }
  }
  // A burst of the same job with the same outcome is one story with a count (concept B's fold).
  const folded: Story[] = [];
  for (const st of out.sort((a, b) => b.at - a.at)) {
    const prev = folded[folded.length - 1];
    if (prev !== undefined && prev.title === st.title && prev.verb === st.verb) { prev.count += 1; continue; }
    folded.push({ ...st });
  }
  return folded.slice(0, opts.max);
}

/** Sum a daily series into `size`-day buckets, oldest first (a 60-day series as 9 weekly bars). */
export function coarsen(series: readonly number[], size: number): number[] {
  const out: number[] = [];
  const offset = series.length % size;
  if (offset > 0) out.push(series.slice(0, offset).reduce((a, b) => a + b, 0));
  for (let i = offset; i < series.length; i += size) out.push(series.slice(i, i + size).reduce((a, b) => a + b, 0));
  return out;
}

// ── Projects at a glance ─────────────────────────────────────────────────────────────────────

export interface ProjectGlance {
  id: string;
  name: string;
  jobs: number;
  waiting: number;
  failed: number;
  series: number[];
}

export function projectGlances(
  runs: readonly SessionView[],
  projects: readonly { id: string; name: string; status?: string }[],
  now: number,
  days = 60,
): ProjectGlance[] {
  const all = runs.filter(live);
  const pid = (v: SessionView): string => (typeof v.session.project_id === 'string' && v.session.project_id !== '' ? v.session.project_id : 'default');
  const rows = projects.filter((p) => p.status !== 'archived').map((p) => {
    const mine = all.filter((v) => pid(v) === p.id);
    return {
      id: p.id,
      name: p.id === 'default' ? 'Not in a project' : p.name,
      jobs: mine.length,
      waiting: mine.filter((v) => v.session.status === 'awaiting_human').length,
      failed: mine.filter((v) => v.session.status === 'failed').length,
      series: createdAtSeries(mine, days, now),
    };
  });
  // Real projects first (most jobs first), the unfiled shelf last.
  return rows.sort((a, b) => Number(a.id === 'default') - Number(b.id === 'default') || b.jobs - a.jobs || a.name.localeCompare(b.name));
}

/** "48 jobs · 2 waiting · 1 failed" */
export function glanceFacts(g: ProjectGlance): string {
  return [n(g.jobs, 'job', 'jobs'), g.waiting > 0 ? `${g.waiting} waiting` : null, g.failed > 0 ? `${g.failed} failed` : null]
    .filter((x): x is string => x !== null).join(' · ');
}

export { DAY_MS };
