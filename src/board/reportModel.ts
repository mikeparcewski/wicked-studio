import type { SessionView } from '../api/types.js';
import type { SeatRecordResponse } from '../api/seatRecord.js';
import { deliveryOf } from '../components/delivery.js';
import { median } from './deskPulse.js';
import { seatDeltas, type Bucket, type SeatDelta } from './deskInsights.js';
import { createdAtMs } from './windowStats.js';

/**
 * THE REPORT (ui-v2, operator 2026-10-26: "report could be more detailed as they usually are … needs
 * more whitespace, easy to scan"): the pure model behind the Report page. Every figure is read off a
 * real crew field, and a figure crew does not serve is `null` (the page says "not tracked yet"):
 *
 *  - jobs finished, throughput, time to PR, by repository, shipped: `GET /runs`
 *    (`session.ended_at` / `created_at` unix seconds, `status`, `delivery` + `deliverUrl`, `repo_ref`);
 *  - passed first time, spend, by agent (steps, pass rate, cost): `GET /roster/record?days=N`, a
 *    window being the difference of two cumulative reads taken together (days=a minus days=b);
 *  - median step time and 429s per agent, floor outcomes, gates answered: `GET /system`
 *    (`clis[].stats`, `governance[]`), which crew counts for the last 7 days only.
 *
 * A period is [now - fromDays, now - toDays): whole days back from now, so its edges are the record's
 * own read edges and the two sources describe the same instants. Pure in every input, `now` included.
 */

export const DAY_MS = 86_400_000;
/** The agent record reaches 90 days back at most (`?days` is 1..90). */
export const RECORD_REACH_DAYS = 90;
/** The window crew's `/system` counts its stats and governance figures over. */
export const SYSTEM_WINDOW_DAYS = 7;

export type PeriodKind = '7' | '30' | 'custom';

export interface Period {
  kind: PeriodKind;
  /** The period starts this many whole days before now. */
  fromDays: number;
  /** ... and ends this many whole days before now (0 = now). */
  toDays: number;
}

export interface CustomRange { from: string; to: string }

/** Local midnight of a `YYYY-MM-DD` date, or null when it is not one. */
export function dateMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) || d.getDate() !== Number(m[3]) ? null : d.getTime();
}

/** `YYYY-MM-DD` of a moment, in local time. */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The custom range's limits: the oldest day the record reaches, and today. */
export function customLimits(now: number): { min: string; max: string } {
  return { min: isoDate(now - (RECORD_REACH_DAYS - 1) * DAY_MS), max: isoDate(now) };
}

/**
 * Why a custom range can't be shown, in words, or null when it can. The range is whole days, both
 * ends included, inside the record's 90 days.
 */
export function customProblem(r: CustomRange, now: number): string | null {
  const from = dateMs(r.from);
  const to = dateMs(r.to);
  if (from === null || to === null) return 'Pick both a start and an end date.';
  if (from > to) return 'The start date is after the end date.';
  const { min, max } = customLimits(now);
  if (r.from < min) return `The record reaches back 90 days: pick ${min} or later.`;
  if (r.to > max) return 'The end date is in the future.';
  return null;
}

/**
 * A period from the picker. A custom range is its calendar days, both included; each day is the 24 hours
 * ending at this time of day on that date (the record's own read edges), so Oct 13 – Oct 26 read at 9:52
 * is [Oct 12 9:52, Oct 26 9:52).
 */
export function periodOf(kind: PeriodKind, custom: CustomRange | null, now: number): Period | null {
  if (kind === '7') return { kind, fromDays: 7, toDays: 0 };
  if (kind === '30') return { kind, fromDays: 30, toDays: 0 };
  if (custom === null || customProblem(custom, now) !== null) return null;
  const today = dateMs(isoDate(now))!;
  // Rounded: a daylight-saving change makes one calendar day 23 or 25 hours.
  const span = Math.round((dateMs(custom.to)! - dateMs(custom.from)!) / DAY_MS) + 1;
  const toDays = Math.max(0, Math.round((today - dateMs(custom.to)!) / DAY_MS));
  return { kind, fromDays: Math.min(RECORD_REACH_DAYS, toDays + span), toDays };
}

export function spanDays(p: Period): number { return p.fromDays - p.toDays; }

/** The period just before, of the same length. */
export function previousOf(p: Period): Period {
  return { kind: p.kind, fromDays: p.fromDays + spanDays(p), toDays: p.fromDays };
}

export function periodBounds(p: Period, now: number): { start: number; end: number } {
  return { start: now - p.fromDays * DAY_MS, end: now - p.toDays * DAY_MS };
}

/** Daily buckets up to five weeks; weekly beyond (a 90-day span never draws ninety slivers). */
export function stepOf(p: Period): 1 | 7 { return spanDays(p) > 35 ? 7 : 1; }

/** The period's buckets, oldest first, each named by the date it ends on; the oldest weekly bucket is
 *  cut at the period's start. */
export function periodBuckets(p: Period, now: number): Bucket[] {
  const step = stepOf(p);
  const { start: floor } = periodBounds(p, now);
  const out: Bucket[] = [];
  for (let k = p.toDays; k < p.fromDays; k += step) {
    const end = now - k * DAY_MS;
    const start = Math.max(floor, end - step * DAY_MS);
    // A day is named by the date it ends on (the 24 hours up to this time of day on that date).
    const e = new Date(end);
    const label = e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = e.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const title = step === 1 ? `${e.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} (24 h to ${time})`
      : `Week to ${label}`;
    out.unshift({ start, end, label, title });
  }
  return out;
}

/** The days-back values of the period's bucket edges, newest first (`0` = now, which needs no read). */
export function bucketEdges(p: Period): number[] {
  const step = stepOf(p);
  const out: number[] = [];
  for (let k = p.toDays; k < p.fromDays; k += step) out.push(k);
  out.push(p.fromDays);
  return out;
}

/** Every `/roster/record?days=` read the page needs: the bucket edges, and the previous period's start
 *  when the record reaches it. */
export function recordReads(p: Period): number[] {
  const prev = previousOf(p);
  const days = new Set(bucketEdges(p).filter((d) => d > 0));
  if (prev.fromDays <= RECORD_REACH_DAYS) days.add(prev.fromDays);
  return [...days].sort((a, b) => a - b);
}

/** Cumulative record reads by days back; `0` is the empty record (nothing has happened since now). */
export type RecordReads = ReadonlyMap<number, SeatRecordResponse | null>;

const EMPTY_RECORD = { seats: [], truncated: false } as unknown as SeatRecordResponse;

function readAt(reads: RecordReads, days: number): SeatRecordResponse | null | undefined {
  return days === 0 ? EMPTY_RECORD : reads.get(days);
}

/** Tool seats take deterministic steps (the code graph, a shell): not agents. */
const TOOL_SEATS = new Set(['wicked-estate', 'bash']);

/** The record between two edges (`wide` days back minus `narrow`), per agent; null when a read is
 *  missing, failed or truncated (two capped reads can cover different runs: subtracting invents work). */
export function recordBetween(reads: RecordReads, wide: number, narrow: number): SeatDelta[] | null {
  const w = readAt(reads, wide);
  const n = readAt(reads, narrow);
  if (w === undefined || n === undefined || w === null || n === null || w.truncated || n.truncated) return null;
  return seatDeltas(w, n).filter((d) => !TOOL_SEATS.has(d.cli));
}

/** Spend of a set of agent deltas: null when someone worked and nothing carried a price. */
export function spendOfDeltas(ds: readonly SeatDelta[]): { usd: number; partial: boolean } | null {
  const priced = ds.filter((d) => d.costUsd !== null);
  const unpriced = ds.some((d) => d.costUsd === null && d.units > 0);
  if (priced.length === 0) return unpriced ? null : { usd: 0, partial: false };
  return { usd: round2(priced.reduce((a, d) => a + (d.costUsd as number), 0)), partial: unpriced };
}

/** Steps whose check passed on the first try, of the steps that were checked. */
export function firstPassOf(ds: readonly SeatDelta[]): { passed: number; gated: number; rate: number | null } {
  const passed = ds.reduce((a, d) => a + d.firstPass, 0);
  const gated = ds.reduce((a, d) => a + d.gated, 0);
  return { passed, gated, rate: gated === 0 ? null : passed / gated };
}

// ── Jobs (the run list) ───────────────────────────────────────────────────────────────────────

export type Ending = 'delivered' | 'finished' | 'failed' | 'stopped';
export const ENDINGS: readonly Ending[] = ['delivered', 'finished', 'failed', 'stopped'];
export const ENDING_LABEL: Record<Ending, string> = { delivered: 'Delivered', finished: 'Done, nothing to ship', failed: 'Failed', stopped: 'Stopped' };

/** How a job ended: delivered (a PR opened or its branch pushed), finished with nothing to ship (an
 *  answer, an onboarding), failed, or stopped. Null for a job that has not ended. */
export function endingOf(v: SessionView): Ending | null {
  const s = v.session.status;
  if (s === 'failed') return 'failed';
  if (s === 'cancelled') return 'stopped';
  if (s !== 'completed') return null;
  const d = deliveryOf(v).state;
  return d === 'delivered' || d === 'pushed' ? 'delivered' : 'finished';
}

export function endedAtMs(v: SessionView): number | null {
  const t = v.session.ended_at;
  return typeof t === 'number' && t > 0 ? t * 1000 : null;
}

/** The jobs that ended inside a period (by the daemon's own `ended_at`); archived jobs are left out,
 *  as on the rest of the Desk. `undated` counts ended jobs the wire gives no end time. */
export function endedIn(runs: readonly SessionView[], p: Period, now: number): { jobs: SessionView[]; undated: number } {
  const { start, end } = periodBounds(p, now);
  let undated = 0;
  const jobs = runs.filter((v) => {
    if (v.session.archived_at != null || endingOf(v) === null) return false;
    const at = endedAtMs(v);
    if (at === null) { undated += 1; return false; }
    return at >= start && at < end;
  });
  return { jobs, undated };
}

/** Jobs finished per bucket, one series per ending (fixed order). */
export function throughput(jobs: readonly SessionView[], buckets: readonly Bucket[]): { key: Ending; label: string; values: number[] }[] {
  const by = new Map<Ending, number[]>(ENDINGS.map((e) => [e, new Array<number>(buckets.length).fill(0)]));
  for (const v of jobs) {
    const e = endingOf(v);
    const at = endedAtMs(v);
    if (e === null || at === null) continue;
    const i = buckets.findIndex((b) => at >= b.start && at < b.end);
    if (i >= 0) by.get(e)![i]! += 1;
  }
  return ENDINGS.map((key) => ({ key, label: ENDING_LABEL[key], values: by.get(key)! }));
}

/** Start to end in minutes for a job, from the daemon's own clocks; null when either is missing. */
export function jobMinutes(v: SessionView): number | null {
  const s = createdAtMs(v);
  const e = endedAtMs(v);
  return s === null || e === null || e < s ? null : (e - s) / 60_000;
}

export function medianOf(xs: readonly number[]): number | null {
  return xs.length === 0 ? null : median([...xs].sort((a, b) => a - b));
}

/** Median start-to-PR time of the delivered jobs, in minutes (`ended_at` is when the deliver step,
 *  which opens the PR, finished); `n` = how many delivered jobs carry both clocks. */
export function timeToPr(jobs: readonly SessionView[]): { minutes: number | null; n: number } {
  const xs = jobs.filter((v) => endingOf(v) === 'delivered').map(jobMinutes).filter((m): m is number => m !== null);
  return { minutes: medianOf(xs), n: xs.length };
}

/** Ended well (delivered, or finished with nothing to ship), of the jobs that ended. */
export function passRateOf(jobs: readonly SessionView[]): { ok: number; ended: number; rate: number | null } {
  const ok = jobs.filter((v) => { const e = endingOf(v); return e === 'delivered' || e === 'finished'; }).length;
  return { ok, ended: jobs.length, rate: jobs.length === 0 ? null : ok / jobs.length };
}

export function repoOf(v: SessionView): string | null {
  const r = (v.session as { repo_ref?: unknown }).repo_ref;
  return typeof r === 'string' && r !== '' ? r : null;
}

export interface RepoRow {
  key: string;
  label: string;
  jobs: number;
  delivered: number;
  ok: number;
  passRate: number | null;
  medianMin: number | null;
  /** Crew has no per-repository spend yet (needs crew data): always null today. */
  spendUsd: number | null;
}

export function repoRows(jobs: readonly SessionView[]): RepoRow[] {
  const by = new Map<string, SessionView[]>();
  for (const v of jobs) {
    const k = repoOf(v) ?? '';
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  return [...by.entries()].map(([key, vs]) => {
    const pr = passRateOf(vs);
    return {
      key,
      label: key === '' ? 'No repository' : key,
      jobs: vs.length,
      delivered: vs.filter((v) => endingOf(v) === 'delivered').length,
      ok: pr.ok,
      passRate: pr.rate,
      medianMin: medianOf(vs.map(jobMinutes).filter((m): m is number => m !== null)),
      spendUsd: null,
    };
  }).sort((a, b) => b.jobs - a.jobs || a.label.localeCompare(b.label));
}

export interface ShippedRow {
  runId: string;
  title: string;
  repo: string | null;
  /** `pr` = a pull request was opened (its link in hand); `pushed` = the branch was pushed to a host
   *  that takes no PR; `delivered` = the deliver step passed but the wire named no link. */
  kind: 'pr' | 'pushed' | 'delivered';
  url: string | null;
  /** The PR's number, read off its link. */
  number: number | null;
  branch: string | null;
  endedAt: number | null;
}

/** The delivered jobs of the period, newest first. */
export function shippedRows(jobs: readonly SessionView[], title: (v: SessionView) => string): ShippedRow[] {
  return jobs.filter((v) => endingOf(v) === 'delivered').map((v): ShippedRow => {
    const d = deliveryOf(v);
    const n = d.url === null ? null : /\/pull\/(\d+)/.exec(d.url);
    return {
      runId: v.session.id,
      title: title(v),
      repo: repoOf(v),
      kind: d.state === 'pushed' ? 'pushed' : d.url !== null ? 'pr' : 'delivered',
      url: d.url,
      number: n === null ? null : Number(n[1]),
      branch: d.pushed?.branch ?? null,
      endedAt: endedAtMs(v),
    };
  }).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0));
}

// ── Agents ────────────────────────────────────────────────────────────────────────────────────

export interface SystemCliStats { key: string; name: string; medianMs: number | null; rateLimited: number | null }

export interface AgentReportRow {
  cli: string;
  label: string;
  units: number;
  gated: number;
  firstPass: number;
  passRate: number | null;
  costUsd: number | null;
  /** From `/system` (7 days only): null when the period is not those 7 days, or crew did not count it. */
  medianMs: number | null;
  rateLimited: number | null;
}

/** One row per agent that took a step in the period (or that `/system` counted), most steps first. */
export function agentReportRows(ds: readonly SeatDelta[], system: readonly SystemCliStats[] | null, systemApplies: boolean, name: (cli: string) => string): AgentReportRow[] {
  const sys = new Map((system ?? []).map((c) => [c.key, c]));
  return ds.filter((d) => d.units > 0 || d.gated > 0 || (d.costUsd ?? 0) > 0).map((d) => {
    const s = systemApplies ? sys.get(d.cli) : undefined;
    return {
      cli: d.cli,
      label: name(d.cli),
      units: d.units,
      gated: d.gated,
      firstPass: d.firstPass,
      passRate: d.gated === 0 ? null : d.firstPass / d.gated,
      costUsd: d.costUsd === null ? null : round2(d.costUsd),
      medianMs: s?.medianMs ?? null,
      rateLimited: s?.rateLimited ?? null,
    };
  }).sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
}

/** Spend per bucket, one series per agent (oldest bucket first); null when any edge read is unusable. */
export function spendPerBucket(reads: RecordReads, p: Period, name: (cli: string) => string): { key: string; label: string; values: number[] }[] | null {
  const edges = bucketEdges(p);
  const n = edges.length - 1;
  const by = new Map<string, number[]>();
  for (let k = 0; k < n; k += 1) {
    const ds = recordBetween(reads, edges[k + 1]!, edges[k]!);
    if (ds === null) return null;
    for (const d of ds) {
      if (d.costUsd === null || d.costUsd <= 0) continue;
      const row = by.get(d.cli) ?? new Array<number>(n).fill(0);
      row[n - 1 - k] = round2(d.costUsd);
      by.set(d.cli, row);
    }
  }
  return [...by.entries()]
    .sort((a, b) => sumOf(b[1]) - sumOf(a[1]))
    .map(([key, values]) => ({ key, label: name(key), values }));
}

// ── Changes against the previous period ───────────────────────────────────────────────────────

export interface Change {
  dir: 'up' | 'down' | 'flat';
  /** What the move means for you: more jobs is good, more spend or a slower PR is bad. */
  tone: 'good' | 'bad' | 'neutral';
  /** "12 more than the 7 days before", "same as the 7 days before". */
  text: string;
}

/** The change from `prev` to `cur`; null when either is unknown. `upIs` says which way is good;
 *  `zeroIsNone` (a count) says "none in the 7 days before" rather than "12 more" when there were none. */
export function changeOf(cur: number | null, prev: number | null, upIs: 'good' | 'bad', fmt: (abs: number) => string, before: string, words: readonly [string, string] = ['more', 'less'], zeroIsNone = false): Change | null {
  if (cur === null || prev === null) return null;
  const d = cur - prev;
  if (Math.abs(d) < 1e-9 || fmt(Math.abs(d)) === fmt(0)) return { dir: 'flat', tone: 'neutral', text: `same as ${before}` };
  const dir = d > 0 ? 'up' : 'down';
  const good = (dir === 'up') === (upIs === 'good');
  if (zeroIsNone && prev === 0) return { dir, tone: good ? 'good' : 'bad', text: `none in ${before}` };
  return { dir, tone: good ? 'good' : 'bad', text: `${fmt(Math.abs(d))} ${d > 0 ? words[0] : words[1]} than ${before}` };
}

/** "the 7 days before", "the 30 days before". */
export function beforeWords(p: Period): string {
  const n = spanDays(p);
  return n === 1 ? 'the day before' : `the ${n} days before`;
}

/** "Last 7 days", "Last 30 days", "Oct 3 – Oct 16". */
export function periodWords(p: Period, now: number): string {
  if (p.kind !== 'custom') return `Last ${p.fromDays} days`;
  const { end } = periodBounds(p, now);
  const f = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  // The calendar days picked: the first is the date the first 24 hours end on.
  const first = end - (spanDays(p) - 1) * DAY_MS;
  return spanDays(p) === 1 ? f(end) : `${f(first)} – ${f(end)}`;
}

export function sumOf(xs: readonly number[]): number { return xs.reduce((a, b) => a + b, 0); }
function round2(x: number): number { return Math.round(x * 100) / 100; }
