import type { RosterSeat, SessionView } from '../api/types.js';
import type { SeatRecord, SeatRecordResponse } from '../api/seatRecord.js';
import { statusWord, type StatusWord } from './statusWords.js';
import { createdAtMs, wireDelivery } from './windowStats.js';
import { waitsOnYou } from './attention.js';
import { median } from './deskPulse.js';

/**
 * DESK V2 — the pure model behind the Desk's refine bar, charts, comparisons and callouts
 * (design/DES-desk-v2.md). Every number here is read off a real wire field:
 *
 *  - jobs, outcomes, workflows, projects, lead helpers: `GET /runs` (session.created_at / ended_at /
 *    status / run_identity / project_id, units[].assigned_cli / status);
 *  - spend, steps, first-pass, rework, benches: `GET /roster/record?days=N[&project=]` (by event time).
 *    A bucketed series is the difference of two cumulative windows read together (days=a minus days=b),
 *    so a bucket is exactly the record between those two instants — never an interpolation.
 *
 * Pure in every input including `now`. Nothing is invented: a value the wire does not carry is
 * `null`, and the component says "needs crew data" for it.
 */

export type RangeDays = 7 | 30 | 90;
export const RANGES: readonly RangeDays[] = [7, 30, 90];
export type GroupBy = 'outcome' | 'agent' | 'project' | 'workflow';
export const GROUP_BYS: readonly { value: GroupBy; label: string }[] = [
  { value: 'outcome', label: 'Outcome' },
  { value: 'agent', label: 'Agent' },
  { value: 'project', label: 'Project' },
  { value: 'workflow', label: 'Workflow' },
];

export interface Refine {
  days: RangeDays;
  /** A project id (`default` = not in a project), or null for every project. */
  project: string | null;
  /** A helper key (`claude`), or null for every helper. */
  agent: string | null;
  /** A workflow key (`bug`, `free_text`, `user_plan`), or null for every workflow. */
  workflow: string | null;
  groupBy: GroupBy;
}

export const DEFAULT_REFINE: Refine = { days: 30, project: null, agent: null, workflow: null, groupBy: 'outcome' };

const DAY_MS = 86_400_000;

/** Tool seats are not helpers: their steps are deterministic tools (the code graph, a shell). */
const TOOL_SEATS = new Set(['wicked-estate', 'bash']);

/** A run's workflow key and plain name. */
export function workflowOf(v: SessionView): { key: string; label: string } {
  const id = (v.session as { run_identity?: { kind?: string; name?: string | null } }).run_identity;
  if ((id?.kind === 'workflow' || id?.kind === 'preset') && typeof id.name === 'string' && id.name !== '') return { key: id.name, label: workflowLabel(id.name) };
  if (id?.kind === 'user_plan') return { key: 'user_plan', label: 'Your own plan' };
  if (id?.kind === 'free_text') return { key: 'free_text', label: 'Free-text job' };
  return { key: 'unknown', label: 'Unknown workflow' };
}

/** "capture-learnings" → "Capture learnings". */
export function workflowLabel(key: string): string {
  if (key === 'user_plan') return 'Your own plan';
  if (key === 'free_text') return 'Free-text job';
  if (key === 'unknown') return 'Unknown workflow';
  const words = key.replace(/[-_]+/g, ' ').trim();
  return words === '' ? key : words[0]!.toUpperCase() + words.slice(1);
}

/** A run's project id: `default` when it is filed nowhere. */
export function projectOf(v: SessionView): string {
  const p = v.session.project_id;
  return typeof p === 'string' && p !== '' ? p : 'default';
}

/** Every helper that took a step on the run (tool seats dropped). */
export function agentsOf(v: SessionView): string[] {
  const out: string[] = [];
  for (const u of v.units ?? []) {
    const c = u.assigned_cli;
    if (typeof c === 'string' && c !== '' && !TOOL_SEATS.has(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The run's LEAD helper: the one that took the most steps (ties: the first to take one), or null. */
export function leadAgentOf(v: SessionView): string | null {
  const n = new Map<string, number>();
  for (const u of v.units ?? []) {
    const c = u.assigned_cli;
    if (typeof c === 'string' && c !== '' && !TOOL_SEATS.has(c)) n.set(c, (n.get(c) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = 0;
  for (const [k, c] of n) if (c > most) { best = k; most = c; }
  return best;
}

export type Outcome = 'Finished' | 'Answered' | 'Failed' | 'Waiting on you' | 'Working' | 'Stopped';
export const OUTCOMES: readonly Outcome[] = ['Finished', 'Answered', 'Failed', 'Waiting on you', 'Working', 'Stopped'];

/** Published terminal states alone enter terminal buckets. Unknown statuses have no outcome;
 * an answered ask parked at its turn gate is "Answered" (it does not wait on you). */
export function outcomeOf(v: SessionView): Outcome | null {
  if (v.session.status === 'completed') return 'Finished';
  if (v.session.status === 'failed') return 'Failed';
  if (v.session.status === 'cancelled') return 'Stopped';
  if (v.session.status === 'awaiting_human' && !waitsOnYou(v.session)) return 'Answered';
  // Archiving is presentation, not a lifecycle outcome.
  const w: StatusWord = statusWord({ session: { ...v.session, archived_at: null } }).word;
  if (w === 'Waiting on you' || w === 'Working') return w;
  return null;
}

/** The runs the refine bar keeps: unarchived, launched in the window (by the real start clock),
 *  in the project / workflow, and touched by the helper. `undated` counts the ones left out. */
/**
 * The runs in the refine bar's view. `allTime` (the Runs tab's All time switch) drops the window and
 * keeps undated and archived runs too, so every job a project holds stays reachable.
 */
export function refineRuns(runs: readonly SessionView[], r: Refine, now: number, allTime = false): { kept: SessionView[]; undated: number } {
  const floor = now - r.days * DAY_MS;
  let undated = 0;
  const kept = runs.filter((v) => {
    if (!allTime && v.session.archived_at != null) return false;
    if (r.project !== null && projectOf(v) !== r.project) return false;
    if (r.workflow !== null && workflowOf(v).key !== r.workflow) return false;
    if (r.agent !== null && !agentsOf(v).includes(r.agent)) return false;
    if (allTime) return true;
    const at = createdAtMs(v);
    if (at === null) { undated += 1; return false; }
    return at >= floor && at < now;
  });
  return { kept, undated };
}

export interface Bucket { start: number; end: number; label: string; title: string }

export type Step = 1 | 7;

/** The bucket size for a window: daily for 7 days; for 30 days daily only when the work is spread over
 *  enough days to read as a series (four or more active days), else weekly; 90 days is always weekly.
 *  Sparse data never draws as a mostly empty axis of thirty slivers. */
export function stepFor(days: RangeDays, startsMs: readonly number[], now: number): Step {
  if (days === 7) return 1;
  if (days === 90) return 7;
  const active = new Set(startsMs.filter((t) => t >= now - days * DAY_MS && t < now).map((t) => Math.floor((now - t) / DAY_MS)));
  return active.size >= 4 ? 1 : 7;
}

/** The window's buckets, oldest first: `ceil(days / step)` of them; the oldest is cut at the window's start. */
export function bucketsOf(days: RangeDays, now: number, step: Step = days === 90 ? 7 : 1): Bucket[] {
  const n = Math.ceil(days / step);
  const floor = now - days * DAY_MS;
  const out: Bucket[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const end = now - i * step * DAY_MS;
    const start = Math.max(floor, end - step * DAY_MS);
    const d = new Date(start);
    const label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const title = step === 1 ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : `Week from ${label}`;
    out.push({ start, end, label, title });
  }
  return out;
}

/** The cumulative windows (whole days back from now) whose differences are the buckets (newest first). */
export function recordWindows(days: RangeDays, step: Step = days === 90 ? 7 : 1): number[] {
  const n = Math.ceil(days / step);
  // The record reaches 90 days at most: the 90-day range's oldest week is 6 days (said in the note).
  return Array.from({ length: n }, (_, k) => Math.min(days, 90, step * (k + 1)));
}

export interface Series { key: string; label: string; values: number[] }

export interface GroupNames {
  agent: (key: string) => string;
  project: (id: string) => string;
}

function groupKeyOf(v: SessionView, g: GroupBy): string | null {
  if (g === 'outcome') return outcomeOf(v);
  if (g === 'agent') return leadAgentOf(v) ?? 'none';
  if (g === 'project') return projectOf(v);
  return workflowOf(v).key;
}

function groupLabelOf(key: string, g: GroupBy, names: GroupNames): string {
  if (g === 'outcome') return key;
  if (g === 'agent') return key === 'none' ? 'Tools only' : names.agent(key);
  if (g === 'project') return names.project(key);
  return workflowLabel(key);
}

/** Jobs started per bucket, one series per group (largest first; outcome in its fixed order). */
export function jobSeries(kept: readonly SessionView[], buckets: readonly Bucket[], g: GroupBy, names: GroupNames): Series[] {
  const by = new Map<string, number[]>();
  for (const v of kept) {
    const at = createdAtMs(v);
    if (at === null) continue;
    const i = buckets.findIndex((b) => at >= b.start && at < b.end);
    if (i < 0) continue;
    const k = groupKeyOf(v, g);
    if (k === null) continue;
    const row = by.get(k) ?? new Array<number>(buckets.length).fill(0);
    row[i] = (row[i] ?? 0) + 1;
    by.set(k, row);
  }
  const keys = [...by.keys()];
  if (g === 'outcome') keys.sort((a, b) => OUTCOMES.indexOf(a as Outcome) - OUTCOMES.indexOf(b as Outcome));
  else keys.sort((a, b) => sum(by.get(b)!) - sum(by.get(a)!) || a.localeCompare(b));
  return keys.map((key) => ({ key, label: groupLabelOf(key, g, names), values: by.get(key)! }));
}

/** Count of runs per group and outcome: the outcome bars (one row per group). */
export function outcomeRows(kept: readonly SessionView[], g: Exclude<GroupBy, 'outcome'>, names: GroupNames): { key: string; label: string; counts: Record<Outcome, number>; total: number }[] {
  const rows = new Map<string, Record<Outcome, number>>();
  for (const v of kept) {
    const k = groupKeyOf(v, g);
    if (k === null) continue;
    const r = rows.get(k) ?? { Finished: 0, Answered: 0, Failed: 0, 'Waiting on you': 0, Working: 0, Stopped: 0 };
    const outcome = outcomeOf(v);
    if (outcome !== null) r[outcome] += 1;
    rows.set(k, r);
  }
  return [...rows.entries()]
    .map(([key, counts]) => ({ key, label: groupLabelOf(key, g, names), counts, total: OUTCOMES.reduce((a, o) => a + counts[o], 0) }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// ── The helper record (spend, steps, benches) ──────────────────────────────────────────────

/** A seat's numbers between two cumulative reads (`wide` minus `narrow`); null cost = unpriced. */
export interface SeatDelta { cli: string; units: number; gated: number; firstPass: number; rework: number; stalls: number; benched: number; costUsd: number | null }

function seatMap(res: SeatRecordResponse | null): Map<string, SeatRecord> {
  return new Map((res?.seats ?? []).map((s) => [s.cli, s]));
}

export function seatDeltas(wide: SeatRecordResponse | null, narrow: SeatRecordResponse | null): SeatDelta[] {
  // A capped read can cover a different set of runs; subtracting it invents a bucket.
  if (wide?.truncated || narrow?.truncated) return [];
  const w = seatMap(wide);
  const n = seatMap(narrow);
  const out: SeatDelta[] = [];
  for (const [cli, s] of w) {
    const m = n.get(cli);
    const d = (k: 'units' | 'gated' | 'firstPass' | 'rework' | 'stalls' | 'benched'): number => Math.max(0, (s[k] ?? 0) - (m?.[k] ?? 0));
    const cost = typeof s.costUsd === 'number' ? Math.max(0, s.costUsd - (typeof m?.costUsd === 'number' ? m.costUsd : 0)) : null;
    out.push({ cli, units: d('units'), gated: d('gated'), firstPass: d('firstPass'), rework: d('rework'), stalls: d('stalls'), benched: d('benched'), costUsd: cost });
  }
  return out;
}

/** Spend per bucket, one series per helper, from the cumulative reads (oldest bucket first).
 * `reads[k]` is the record for `recordWindows(days)[k]` days back. Null when a read failed or
 * was truncated: omit the series because the cumulative windows may cover different run sets. */
export function spendSeries(reads: readonly (SeatRecordResponse | null)[], agent: string | null, names: GroupNames): Series[] | null {
  if (reads.length === 0 || reads.some((r) => r === null || r.truncated)) return null;
  const n = reads.length;
  const by = new Map<string, number[]>();
  for (let k = 0; k < n; k += 1) {
    const wide = reads[k]!;
    const narrow = k === 0 ? null : reads[k - 1]!;
    for (const d of seatDeltas(wide, narrow)) {
      if (TOOL_SEATS.has(d.cli) || (agent !== null && d.cli !== agent)) continue;
      const row = by.get(d.cli) ?? new Array<number>(n).fill(0);
      // bucket index: k = 0 is the newest bucket; the series runs oldest first.
      if (d.costUsd !== null) row[n - 1 - k] = round2(d.costUsd);
      by.set(d.cli, row);
    }
  }
  return [...by.entries()]
    .filter(([, v]) => v.some((x) => x > 0))
    .sort((a, b) => sum(b[1]) - sum(a[1]))
    .map(([key, values]) => ({ key, label: names.agent(key), values }));
}

/** Price availability alongside the numeric buckets: zero-filled chart data alone cannot
 * distinguish no usage from usage without a price. Apply the same helper scope as spendSeries. */
export function spendAvailability(reads: readonly (SeatRecordResponse | null)[], agent: string | null): { unpriced: boolean; anyPriced: boolean } | null {
  if (reads.length === 0 || reads.some((r) => r === null || r.truncated)) return null;
  const seats = reads.flatMap((r) => r!.seats).filter((s) => !TOOL_SEATS.has(s.cli) && (agent === null || s.cli === agent));
  return {
    unpriced: seats.some((s) => s.costUsd === null && s.units > 0),
    anyPriced: seats.some((s) => typeof s.costUsd === 'number'),
  };
}

export interface AgentRow {
  cli: string;
  label: string;
  /** Steps taken in the window (record). */
  steps: number;
  /** Checked steps that passed their checks first time, of the checked ones; null when none was checked. */
  firstPassRate: number | null;
  gated: number;
  rework: number;
  stalls: number;
  benched: number;
  benchReasons: Record<string, number>;
  quotaHits: number;
  costUsd: number | null;
  /** Cost divided by priced usage records; null when none carried a price. */
  costPerPricedUse: number | null;
  /** Jobs (in the refined set) this helper took a step on, and how many of those finished. */
  jobs: number;
  jobsFinished: number;
  jobsFailed: number;
  /** Jobs it took a step on that ended (the success rate's denominator). */
  jobsEnded: number;
  /** Finished of the jobs that ended (finished, failed or stopped); null when none ended. */
  successRate: number | null;
  /** Jobs it led that were delivered (a PR or a push). */
  delivered: number;
}

export function agentRows(record: SeatRecordResponse | null, kept: readonly SessionView[], names: GroupNames, roster: readonly string[], workflow: string | null = null): AgentRow[] {
  // The seat record can scope by project, but cannot split its metrics by workflow.
  if (workflow !== null) return [];
  const seats = (record?.seats ?? []).filter((s) => !TOOL_SEATS.has(s.cli));
  const keys = new Set<string>([...seats.map((s) => s.cli), ...roster.filter((k) => !TOOL_SEATS.has(k))]);
  return [...keys].map((cli) => {
    const s = seats.find((x) => x.cli === cli);
    const mine = kept.filter((v) => agentsOf(v).includes(cli));
    const ended = mine.filter((v) => ['Finished', 'Answered', 'Failed', 'Stopped'].includes(outcomeOf(v) ?? ''));
    const finishedLike = (o: Outcome | null): boolean => o === 'Finished' || o === 'Answered';
    const finished = mine.filter((v) => finishedLike(outcomeOf(v))).length;
    const reasons = (s?.benchReasons ?? {}) as Record<string, number>;
    const quota = Object.entries(reasons).filter(([k]) => /quota/i.test(k)).reduce((a, [, n]) => a + n, 0);
    const cost = typeof s?.costUsd === 'number' ? s.costUsd : null;
    const costed = s?.costedUsage ?? 0;
    return {
      cli,
      label: names.agent(cli),
      steps: s?.units ?? 0,
      gated: s?.gated ?? 0,
      firstPassRate: s !== undefined && s.gated > 0 ? s.firstPass / s.gated : null,
      rework: s?.rework ?? 0,
      stalls: s?.stalls ?? 0,
      benched: s?.benched ?? 0,
      benchReasons: reasons,
      quotaHits: quota,
      costUsd: cost,
      costPerPricedUse: cost !== null && costed > 0 ? cost / costed : null,
      jobs: mine.length,
      jobsFinished: finished,
      jobsFailed: mine.filter((v) => outcomeOf(v) === 'Failed').length,
      jobsEnded: ended.length,
      successRate: ended.length > 0 ? finished / ended.length : null,
      delivered: mine.filter((v) => leadAgentOf(v) === cli && isDelivered(v)).length,
    };
  }).sort((a, b) => b.steps - a.steps || b.benched - a.benched || a.label.localeCompare(b.label));
}

function isDelivered(v: SessionView): boolean {
  const d = wireDelivery(v);
  return d === 'delivered' || d === 'pushed';
}

export interface WorkflowRow {
  key: string;
  label: string;
  jobs: number;
  finished: number;
  failed: number;
  stopped: number;
  open: number;
  successRate: number | null;
  /** Median minutes from start to end over the finished jobs; null when none finished with both clocks. */
  medianMin: number | null;
  avgSteps: number | null;
  delivered: number;
}

export function workflowRows(kept: readonly SessionView[]): WorkflowRow[] {
  const by = new Map<string, SessionView[]>();
  for (const v of kept) { const k = workflowOf(v).key; by.set(k, [...(by.get(k) ?? []), v]); }
  return [...by.entries()].map(([key, vs]) => {
    const o = vs.map(outcomeOf);
    const finished = o.filter((x) => x === 'Finished' || x === 'Answered').length;
    const failed = o.filter((x) => x === 'Failed').length;
    const stopped = o.filter((x) => x === 'Stopped').length;
    const ended = finished + failed + stopped;
    const mins = vs.filter((v) => outcomeOf(v) === 'Finished').map(durationMin).filter((m): m is number => m !== null).sort((a, b) => a - b);
    const steps = vs.map((v) => (v.units ?? []).length).filter((n) => n > 0);
    return {
      key, label: workflowLabel(key), jobs: vs.length, finished, failed, stopped, open: vs.length - ended,
      successRate: ended > 0 ? finished / ended : null,
      medianMin: mins.length === 0 ? null : median(mins),
      avgSteps: steps.length === 0 ? null : sum(steps) / steps.length,
      delivered: vs.filter(isDelivered).length,
    };
  }).sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label));
}

/** Start to end in minutes, from the wire's own clocks (both unix seconds); null when either is missing. */
export function durationMin(v: SessionView): number | null {
  const s = v.session as { created_at?: number | null; ended_at?: number | null };
  if (typeof s.created_at !== 'number' || typeof s.ended_at !== 'number' || s.ended_at < s.created_at) return null;
  return (s.ended_at - s.created_at) / 60;
}

// ── Improve-this callouts (evidence-backed only) ──────────────────────────────────────────

export interface Callout {
  id: string;
  tone: 'warn' | 'fail' | 'info';
  title: string;
  /** What the evidence says, in plain words. */
  why: string;
  /** What to do about it (only where the evidence implies the fix). */
  fix: string;
  evidence: { label: string; path: string };
}

export interface AcpFallbacks { [cli: string]: { fallbacks: number; kinds: Record<string, number> } }

/** Deliberate routing that keeps enforcement (the contract's two `*_requires_wrapped` kinds). */
export const ENFORCED_ROUTES: ReadonlySet<string> = new Set(['governance_requires_wrapped', 'read_only_requires_wrapped']);
/** The seat was benched for its account and the wrapped fallback was never attempted: nothing ran. */
export const BENCHED_KINDS: ReadonlySet<string> = new Set(['auth_failed', 'unauthenticated']);

/**
 * Deliberate wrapped routing preserves enforcement and a benched seat ran nothing; every other fallback
 * counts. Counted as the total minus those kinds, so a fallback whose kind is missing from the breakdown still counts.
 */
export function uncheckedFallbacks(f: AcpFallbacks[string] | undefined): number {
  if (f === undefined) return 0;
  const kinds = Object.entries(f.kinds ?? {});
  // Neither deliberate routing nor a benched seat ran anything without its checks.
  const enforced = kinds.reduce((n, [kind, count]) => n + (ENFORCED_ROUTES.has(kind) || BENCHED_KINDS.has(kind) ? count : 0), 0);
  const listed = kinds.reduce((n, [, count]) => n + count, 0);
  return Math.max(0, Math.max(f.fallbacks ?? 0, listed) - enforced);
}

/** The fallback kinds that ran a step without its checks (neither deliberate routing nor a bench). */
export function uncheckedKinds(f: AcpFallbacks[string]): string[] {
  return Object.entries(f.kinds ?? {}).filter(([kind, count]) => count > 0 && !ENFORCED_ROUTES.has(kind) && !BENCHED_KINDS.has(kind)).map(([kind]) => kind);
}

export function governanceOf(cli: string, acp: AcpFallbacks | null, roster: readonly RosterSeat[]): { word: string; tone: 'ok' | 'warn' | null; unchecked: number } {
  if (acp === null) return { word: 'checks not read yet', tone: null, unchecked: 0 };
  const n = uncheckedFallbacks(acp[cli]);
  if (n > 0) return { word: `ran unchecked ${n === 1 ? 'once' : `${n} times`} across all recorded runs (studio-wide)`, tone: 'warn', unchecked: n };
  const cls = roster.find((s) => s.key === cli)?.governance_class;
  if (cls === 'acp_input_governance') return { word: 'can check every action', tone: null, unchecked: 0 };
  if (cls === 'os_sandbox') return { word: 'can keep writes in a sandbox', tone: null, unchecked: 0 };
  return { word: 'checks not reported', tone: null, unchecked: 0 };
}

export const PARTIAL_RECORD_NOTE = 'Partial: the agent record left out older runs';
export const AGENT_WORKFLOW_NOTE = 'Agent numbers can’t be split by workflow yet: the agent record has no workflow filter (needs crew data).';

export function callouts(input: {
  agents: readonly AgentRow[];
  workflows: readonly WorkflowRow[];
  acp: AcpFallbacks | null;
  openFailures: number;
  days: RangeDays;
  /** A project page or a refined view still reads studio-wide diagnostics. */
  scoped?: boolean;
  /** Agent records and diagnostics cannot be split by workflow. */
  workflow?: string | null;
}): Callout[] {
  const out: Callout[] = [];
  const win = `in the last ${input.days} days`;
  const agents = input.workflow != null ? [] : input.agents;
  for (const a of agents) {
    if (a.benched === 0) continue;
    const [reason, n] = Object.entries(a.benchReasons).sort((x, y) => y[1] - x[1])[0] ?? ['', 0];
    const signedOut = /signed out/i.test(reason);
    const quota = /quota/i.test(reason);
    const timedOut = /timed out/i.test(reason);
    out.push({
      id: `bench:${a.cli}`,
      tone: 'warn',
      title: `${a.label} sat out ${a.benched} ${a.benched === 1 ? 'time' : 'times'} ${win}`,
      why: reason === '' ? 'Studio benched it; the record names no reason.' : `Most often: ${plainBench(reason)} (${n} of ${a.benched}).`,
      fix: signedOut ? 'Sign it in again; until then the other agents take its work.'
        : quota ? 'Its plan quota ran out; it rejoins when the quota resets or the plan is raised.'
          : timedOut ? 'It kept timing out in reviews; check that it answers quickly on this machine.'
            : 'Open its record to see each time it sat out.',
      evidence: { label: 'Agent record', path: '/health' },
    });
  }
  for (const [cli, f] of Object.entries(input.workflow != null ? {} : input.acp ?? {})) {
    const n = uncheckedFallbacks(f);
    if (n <= 0) continue;
    const name = input.agents.find((a) => a.cli === cli)?.label ?? cli;
    // Only the kinds that ran unchecked explain it: deliberate routing kept its checks, and a benched seat ran nothing.
    const causes = uncheckedKinds(f);
    out.push({
      id: `acp:${cli}`,
      tone: 'fail',
      title: `${name} ran without its governed connection ${n} ${n === 1 ? 'time' : 'times'} across all recorded runs${input.scoped ? ' (studio-wide)' : ''}`,
      why: `Its governed session could not start (${causes.length > 0 ? causes.map(plainFallback).join(', ') : 'no reason recorded'}), so the step ran on the plain fallback. These diagnostics cover all recorded runs across studio.`,
      fix: 'Reinstall or update its connector so its tool calls are checked again.',
      evidence: { label: 'Health', path: '/health' },
    });
  }
  if (input.openFailures > 0) {
    out.push({
      id: 'failures',
      tone: 'fail',
      title: `${input.openFailures} failed ${input.openFailures === 1 ? 'job was' : 'jobs were'} never retried`,
      why: 'Each one stopped at a failed step and nothing has run it again.',
      fix: 'Open each in Needs you: See why, then Retry or mark it done.',
      evidence: { label: 'Needs you', path: '#desk-inbox' },
    });
  }
  for (const w of input.workflows) {
    const ended = w.finished + w.failed + w.stopped;
    if (ended < 3 || w.successRate === null || w.successRate >= 0.5) continue;
    out.push({
      id: `wf:${w.key}`,
      tone: 'warn',
      title: `${w.label} finishes ${pct(w.successRate)} of the time`,
      why: `${w.finished} of ${ended} ended jobs finished ${win}; ${w.failed} failed, ${w.stopped} stopped.`,
      fix: 'Compare a failed run with a finished one below to see where they part.',
      evidence: { label: 'Every job', path: `/everything?tab=sessions` },
    });
  }
  for (const a of agents) {
    if (a.gated < 5 || a.firstPassRate === null || a.firstPassRate >= 0.7) continue;
    out.push({
      id: `rework:${a.cli}`,
      tone: 'info',
      title: `${a.label} passes its checks first time on ${pct(a.firstPassRate)} of steps`,
      why: `${a.gated - Math.round(a.firstPassRate * a.gated)} of ${a.gated} checked steps needed another go ${win}.`,
      fix: 'Give it the steps it passes first time, or tighten the instructions on the others.',
      evidence: { label: 'Agent record', path: '/health' },
    });
  }
  return out;
}

function plainBench(reason: string): string {
  if (/signed out/i.test(reason)) return 'signed out';
  if (/quota/i.test(reason)) return 'out of quota';
  const m = /benched by recent (?:councils|reviews) \((\d+) ([^)]+)\)/i.exec(reason);
  if (m !== null) return `${m[2]!.replace(/_/g, ' ')} in ${m[1]} recent reviews`;
  return reason.replace(/_/g, ' ');
}

function plainFallback(kind: string): string {
  if (kind === 'binary_unavailable') return 'its connector program was missing or would not start';
  return kind.replace(/_/g, ' ');
}

export function pct(x: number): string { return `${Math.round(x * 100)}%`; }
export function sum(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0); }
function round2(x: number): number { return Math.round(x * 100) / 100; }

// ── Happening now ──────────────────────────────────────────────────────────────────────────

export interface LiveRow {
  runId: string;
  title: string;
  word: StatusWord;
  tone: 'run' | 'gate';
  done: number;
  total: number;
  /** The step in hand: its stage word and the helper on it. */
  step: string | null;
  agent: string | null;
  startedAt: number | null;
}

const STAGE_WORDS: Record<string, string> = { recon: 'Looking around', build: 'Building', test: 'Testing', review: 'Reviewing', deliver: 'Delivering' };

export function liveRows(runs: readonly SessionView[], title: (v: SessionView) => string, heldByNeeds: ReadonlySet<string> = new Set()): LiveRow[] {
  return runs
    .filter((v) => v.session.archived_at == null)
    .map((v) => ({ v, sw: statusWord(v) }))
    // Happening = actually executing: a gate (it waits on you) and a run Needs you holds (a stall,
    // an orphan) are in Needs you, never "in hand".
    .filter(({ v, sw }) => sw.tone === 'run' && !heldByNeeds.has(v.session.id))
    .map(({ v, sw }) => {
      const units = v.units ?? [];
      const current = units.find((u) => u.status !== 'done');
      const stage = (current as { stage?: string } | undefined)?.stage;
      return {
        runId: v.session.id,
        title: title(v),
        word: sw.word,
        tone: sw.tone as 'run' | 'gate',
        done: units.filter((u) => u.status === 'done').length,
        total: units.length,
        step: current === undefined ? null : (stage !== undefined ? (STAGE_WORDS[stage] ?? workflowLabel(stage)) : null),
        agent: current?.assigned_cli ?? null,
        startedAt: createdAtMs(v),
      };
    })
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

export interface EndedRow { runId: string; title: string; outcome: Outcome; endedAt: number; agent: string | null }

export function recentlyEnded(runs: readonly SessionView[], title: (v: SessionView) => string, max: number): EndedRow[] {
  return runs
    .filter((v) => v.session.archived_at == null && typeof v.session.ended_at === 'number')
    .map((v) => ({ runId: v.session.id, title: title(v), outcome: outcomeOf(v), endedAt: (v.session.ended_at as number) * 1000, agent: leadAgentOf(v) }))
    .filter((r): r is EndedRow => r.outcome !== null && r.outcome !== 'Working' && r.outcome !== 'Waiting on you')
    .sort((a, b) => b.endedAt - a.endedAt)
    .slice(0, max);
}

/** All agents' spend per bucket (oldest first) from one project's cumulative reads;
 * null when a read failed or was truncated (the project's series is omitted). */
export function spendTotals(reads: readonly (SeatRecordResponse | null)[], agent: string | null): number[] | null {
  if (reads.length === 0 || reads.some((r) => r === null || r.truncated)) return null;
  const n = reads.length;
  const out = new Array<number>(n).fill(0);
  for (let k = 0; k < n; k += 1) {
    for (const d of seatDeltas(reads[k]!, k === 0 ? null : reads[k - 1]!)) {
      if (TOOL_SEATS.has(d.cli) || (agent !== null && d.cli !== agent)) continue;
      if (d.costUsd !== null) out[n - 1 - k] = round2((out[n - 1 - k] ?? 0) + d.costUsd);
    }
  }
  return out;
}
