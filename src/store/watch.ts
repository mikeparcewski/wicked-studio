import { create } from 'zustand';
import type { SessionView } from '../api/types.js';
import {
  WATCH_CLEARED, WATCH_RAISED, type WatchAnchor, type WatchFeedResponse, type WatchFinding, type WatchFindingCleared,
  type WatchKind, type WatchSeverity,
} from '../api/watch-wire.js';

/**
 * THE WATCHTOWER'S FOLD (DES-TRIGGER-REGISTRY-001 §4.10, slice TR-W8). Pure reducers, keyed by stable
 * ids, over four inputs — the shell that renders them is DES-studio-rebuild S14:
 *
 *  1. watch findings: `/ws` `watchEvent` frames, and `GET /watch` on a late join (keyed by
 *     `watch_id`); a `cleared` row turns its finding Fixed (resolved), Dismissed, or folds it into
 *     the roll-up that replaced it. A clearing that arrives before its raise is kept and applied.
 *  2. the stall watchdog's frames (`workerStalled`, `workerStallEscalated`): a Gone quiet row per
 *     quiet period, which turns Fixed the moment the run speaks again or the watchdog recovered it.
 *  3. `teamEvent` frames of `wicked.team.finding.*` (keyed by `finding_id`). A watch flag on the same
 *     (run, ord, attempt, path) attaches to it as `corroboratedBy`, never a second row.
 *  4. the run list studio already reads: a run that finished (Finished) and one the daemon says
 *     delivered (Delivered).
 *
 * What it never does: turn a watch row into a needs-you row (the needs-you fold is untouched and
 * stays the one count), or write a sentence from model prose (the sentences are the registry's
 * templates, or this file's).
 */

export type WatchRowState = 'open' | 'fixed' | 'dismissed' | 'done';
export type WatchRowSource = 'watch' | 'watchdog' | 'team' | 'run';

export interface WatchRow {
  /** Stable: `watch_id`, `team:<finding_id>`, `quiet:<run>:<n>`, `finished:<run>`, `delivered:<run>`. */
  id: string;
  source: WatchRowSource;
  kind: WatchKind;
  runId: string | null;
  projectId: string | null;
  sentence: string;
  /** Unix millis the row was raised. */
  at: number;
  state: WatchRowState;
  /** The line under a cleared row ("Fixed", "Dismissed by …", "Moving again"). */
  stateLine: string | null;
  severity: WatchSeverity | null;
  /** `"gate"`: one quiet line on the open gate's row and card, never a row of its own. */
  attach: 'gate' | null;
  anchor: WatchAnchor | null;
  /** How many later rows a roll-up stands for. */
  rolledUp: number;
  /** Rows that say the same thing about the same place (a watch flag on a team finding). */
  corroboratedBy: string[];
  /** Hidden from the feed: folded into another row (a roll-up replaced it, or it corroborates one). */
  foldedInto: string | null;
  /** For corroboration: the place a finding or flag names. */
  place: { ord: number | null; attempt: number | null; path: string } | null;
  /** The unit ord the row is about (a gate-attached row: the gate's), when it names one. */
  ord: number | null;
  /** A watch row's emit class: only a `flag` corroborates a team finding. */
  emit: 'finding' | 'flag' | 'proposal' | null;
}

export interface WatchFold {
  rows: Record<string, WatchRow>;
  /** Clearings whose raise has not arrived yet (a late-join page, an out-of-order relay). */
  pendingClears: Record<string, WatchFindingCleared>;
  /** Quiet periods per run: the open quiet row's id, if any. */
  quietOpen: Record<string, string>;
  quietSeq: Record<string, number>;
}

export const EMPTY_WATCH: WatchFold = { rows: {}, pendingClears: {}, quietOpen: {}, quietSeq: {} };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function placeOf(runId: string | null, ord: number | null, attempt: number | null, path: string | null): WatchRow['place'] {
  return runId === null || path === null ? null : { ord, attempt, path };
}

function samePlace(a: WatchRow, b: WatchRow): boolean {
  return a.runId !== null && a.runId === b.runId && a.place !== null && b.place !== null
    && a.place.path === b.place.path && a.place.ord === b.place.ord && a.place.attempt === b.place.attempt;
}

/** Attach a watch flag to a team finding on the same place (either may arrive first). */
function corroborate(rows: Record<string, WatchRow>, row: WatchRow): Record<string, WatchRow> {
  const out = { ...rows, [row.id]: row };
  for (const other of Object.values(rows)) {
    if (other.id === row.id || !samePlace(other, row)) continue;
    const team = row.source === 'team' ? row : other.source === 'team' ? other : null;
    const isFlag = (r: WatchRow): boolean => r.source === 'watch' && r.emit === 'flag';
    const flag = isFlag(row) ? row : isFlag(other) ? other : null;
    if (team === null || flag === null) continue;
    out[team.id] = { ...out[team.id]!, corroboratedBy: [...new Set([...out[team.id]!.corroboratedBy, flag.id])] };
    out[flag.id] = { ...out[flag.id]!, foldedInto: team.id };
  }
  return out;
}

function applyClear(row: WatchRow, c: WatchFindingCleared): WatchRow {
  switch (c.reason) {
    case 'resolved': return { ...row, state: 'fixed', stateLine: 'Fixed' };
    case 'dismissed': return { ...row, state: 'dismissed', stateLine: `Dismissed by ${c.dismissed_by}` };
    case 'rolled_up': return { ...row, foldedInto: c.replaced_by };
    default: return row;
  }
}

// ── 1. watch findings ─────────────────────────────────────────────────────────────────────

export function foldFinding(fold: WatchFold, f: WatchFinding): WatchFold {
  const prev = fold.rows[f.watch_id];
  let row: WatchRow = {
    id: f.watch_id, source: 'watch', kind: f.watch_kind, runId: f.run_id, projectId: f.project_id ?? null,
    sentence: f.sentence, at: f.at, state: prev?.state ?? 'open', stateLine: prev?.stateLine ?? null,
    severity: f.severity, attach: f.attach, anchor: f.anchor, rolledUp: f.rolled_up,
    corroboratedBy: prev?.corroboratedBy ?? [], foldedInto: prev?.foldedInto ?? null,
    place: placeOf(f.run_id, f.ord, f.attempt, str(f.facts['path'])),
    ord: f.ord, emit: f.kind,
  };
  const pending = fold.pendingClears[f.watch_id];
  const pendingClears = { ...fold.pendingClears };
  if (pending !== undefined) { row = applyClear(row, pending); delete pendingClears[f.watch_id]; }
  return { ...fold, rows: corroborate(fold.rows, row), pendingClears };
}

export function foldCleared(fold: WatchFold, c: WatchFindingCleared): WatchFold {
  const row = fold.rows[c.watch_id];
  if (row === undefined) return { ...fold, pendingClears: { ...fold.pendingClears, [c.watch_id]: c } };
  return { ...fold, rows: { ...fold.rows, [c.watch_id]: applyClear(row, c) } };
}

/** A late join's page: findings, then their clearings (as the live frames would have folded). */
export function foldFeed(fold: WatchFold, resp: WatchFeedResponse): WatchFold {
  let out = fold;
  for (const f of resp.findings ?? []) out = foldFinding(out, f);
  for (const c of resp.cleared ?? []) out = foldCleared(out, c);
  return out;
}

/** A `/ws` `watchEvent` frame. Anything else is not this input. */
export function foldWatchFrame(fold: WatchFold, frame: Record<string, unknown>): WatchFold {
  if (frame['type'] !== 'watchEvent') return fold;
  const ev = frame['event'] as { event_type?: unknown; payload?: unknown } | undefined;
  if (ev === undefined || typeof ev.payload !== 'object' || ev.payload === null) return fold;
  if (ev.event_type === WATCH_RAISED) return foldFinding(fold, ev.payload as WatchFinding);
  if (ev.event_type === WATCH_CLEARED) return foldCleared(fold, ev.payload as WatchFindingCleared);
  return fold;
}

// ── 2. the stall watchdog ─────────────────────────────────────────────────────────────────

function minutes(ms: number): string {
  const m = Math.max(1, Math.round(ms / 60_000));
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/** Watchdog frames and the run's next word. `at` is when the frame was seen (frames carry no clock). */
export function foldWatchdog(fold: WatchFold, event: Record<string, unknown>, at: number): WatchFold {
  const runId = str(event['session']);
  if (runId === null) return fold;
  const type = event['type'];
  const open = fold.quietOpen[runId];
  if (type === 'workerStalled') {
    if (open !== undefined) return fold; // one row per quiet period
    const n = (fold.quietSeq[runId] ?? 0) + 1;
    const id = `quiet:${runId}:${n}`;
    // The daemon's frame carries `quietForMs`; the engine's PTY-path event shares the tag with `stalledSecs`.
    const quiet = num(event['quietForMs']) ?? (num(event['stalledSecs']) ?? 0) * 1000;
    const ord = num(event['ord']);
    const row: WatchRow = {
      id, source: 'watchdog', kind: 'quiet', runId, projectId: null,
      sentence: `Nothing new from this run in ${minutes(quiet)}`, at, state: 'open', stateLine: null,
      severity: null, attach: null, anchor: { run_id: runId, ord, attempt: null, at }, rolledUp: 0,
      corroboratedBy: [], foldedInto: null, place: null, ord, emit: null,
    };
    return {
      ...fold, rows: { ...fold.rows, [id]: row },
      quietOpen: { ...fold.quietOpen, [runId]: id }, quietSeq: { ...fold.quietSeq, [runId]: n },
    };
  }
  if (open === undefined) return fold;
  const row = fold.rows[open]!;
  const close = (patch: Partial<WatchRow>): WatchFold => {
    const quietOpen = { ...fold.quietOpen };
    delete quietOpen[runId];
    return { ...fold, rows: { ...fold.rows, [open]: { ...row, ...patch } }, quietOpen };
  };
  if (type === 'workerStallEscalated') {
    const action = event['action'];
    const outcome = event['outcome'];
    if (action === 'reassign' && outcome === 'ok') {
      const cli = str(event['cli']);
      return close({ state: 'fixed', stateLine: cli !== null ? `Restarted on ${cli}` : 'Restarted' });
    }
    // Still quiet, and a human should look: the needs-you fold carries that; the row says it.
    return { ...fold, rows: { ...fold.rows, [open]: { ...row, stateLine: 'Studio could not get it moving again' } } };
  }
  // Any other word from the run re-arms the watchdog: the quiet period is over.
  return close({ state: 'fixed', stateLine: 'Moving again' });
}

// ── 3. team findings ──────────────────────────────────────────────────────────────────────

/** A `/ws` `teamEvent` frame carrying `wicked.team.finding.raised` / `.settled`. */
export function foldTeamFrame(fold: WatchFold, frame: Record<string, unknown>): WatchFold {
  if (frame['type'] !== 'teamEvent') return fold;
  const ev = frame['event'] as { event_type?: unknown; payload?: Record<string, unknown> } | undefined;
  const p = ev?.payload;
  if (p === undefined || p === null) return fold;
  const findingId = str(p['finding_id']);
  if (findingId === null) return fold;
  const id = `team:${findingId}`;
  if (ev!.event_type === 'wicked.team.finding.raised') {
    const runId = str(p['run_id']);
    const path = str(p['path']);
    const line = num(p['line']);
    const severity = p['severity'] === 'high' ? 'high' : 'medium';
    const where = path === null ? 'the change' : line !== null && line > 0 ? `${path}:${line}` : path;
    const prev = fold.rows[id];
    const row: WatchRow = {
      id, source: 'team', kind: 'problem', runId, projectId: str(frame['project_id']),
      sentence: `A reviewer raised a ${severity === 'high' ? 'serious problem' : 'problem'} in ${where}`,
      at: num(p['at']) ?? 0, state: prev?.state ?? 'open', stateLine: prev?.stateLine ?? null,
      severity, attach: null,
      anchor: runId === null ? null : { run_id: runId, ord: num(p['ord']), attempt: num(p['attempt']), at: num(p['at']) ?? 0 },
      rolledUp: 0, corroboratedBy: prev?.corroboratedBy ?? [], foldedInto: null,
      place: placeOf(runId, num(p['ord']), num(p['attempt']), path),
      ord: num(p['ord']), emit: null,
    };
    return { ...fold, rows: corroborate(fold.rows, row) };
  }
  if (ev!.event_type === 'wicked.team.finding.settled') {
    const row = fold.rows[id];
    if (row === undefined) return fold;
    const status = p['status'];
    const settled: Partial<WatchRow> = status === 'withdrawn' ? { state: 'dismissed', stateLine: 'Withdrawn by the reviewer' }
      : status === 'superseded' ? { state: 'fixed', stateLine: 'Fixed' }
        : { stateLine: 'The reviewer stands by it' };
    return { ...fold, rows: { ...fold.rows, [id]: { ...row, ...settled } } };
  }
  return fold;
}

// ── 4. the run list: Finished, Delivered ──────────────────────────────────────────────────

const sessionProject = (v: SessionView): string | null => {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  return typeof p === 'string' && p !== '' ? p : null;
};

export function foldRuns(fold: WatchFold, runs: readonly SessionView[], projectOf?: (runId: string) => string | null): WatchFold {
  const rows = { ...fold.rows };
  let changed = false;
  // A run's rows that arrived without a project (watchdog frames, team findings) take the run's
  // project from the run list, so a project-filtered feed keeps them (Copilot).
  const projectOfRun = new Map<string, string>();
  for (const v of runs) {
    const pid = projectOf?.(v.session.id) ?? sessionProject(v);
    if (pid !== null) projectOfRun.set(v.session.id, pid);
  }
  for (const r of Object.values(rows)) {
    if (r.projectId !== null || r.runId === null) continue;
    const pid = projectOfRun.get(r.runId);
    if (pid !== undefined) { rows[r.id] = { ...r, projectId: pid }; changed = true; }
  }
  for (const v of runs) {
    const s = v.session as unknown as { id: string; status: string; ended_at?: number; delivery?: unknown };
    const at = typeof s.ended_at === 'number' ? s.ended_at * 1000 : null;
    if (s.status !== 'completed' || at === null) continue;
    const base = {
      source: 'run' as const, runId: s.id, projectId: projectOf?.(s.id) ?? sessionProject(v), at, state: 'done' as const, stateLine: null,
      severity: null, attach: null, anchor: { run_id: s.id, ord: null, attempt: null, at }, rolledUp: 0,
      corroboratedBy: [], foldedInto: null, place: null, ord: null, emit: null,
    };
    const finished = `finished:${s.id}`;
    if (rows[finished] === undefined) { rows[finished] = { ...base, id: finished, kind: 'done', sentence: 'Finished' }; changed = true; }
    const delivered = `delivered:${s.id}`;
    if ((s.delivery === 'delivered' || s.delivery === 'pushed') && rows[delivered] === undefined) {
      rows[delivered] = { ...base, id: delivered, kind: 'delivery', sentence: s.delivery === 'delivered' ? 'Delivered' : 'Delivered as a pushed branch' };
      changed = true;
    }
  }
  return changed ? { ...fold, rows } : fold;
}

// ── Reads ─────────────────────────────────────────────────────────────────────────────────

/** The feed: newest first, folded rows and gate lines left out, filtered by project and kind. */
export function watchFeed(fold: WatchFold, filter: { project?: string | null; kind?: WatchKind | null } = {}): WatchRow[] {
  return Object.values(fold.rows)
    .filter((r) => r.foldedInto === null && r.attach !== 'gate')
    .filter((r) => filter.project == null || r.projectId === filter.project)
    .filter((r) => filter.kind == null || r.kind === filter.kind)
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
}

/** The one quiet line on a run's open gate, or null (an absent check renders nothing). With the
 *  gate's `ord`, only a finding raised on THAT gate (or one naming no ord) — never an older gate's. */
export function gateLine(fold: WatchFold, runId: string, ord?: number | null): string | null {
  const rows = Object.values(fold.rows)
    .filter((r) => r.runId === runId && r.attach === 'gate' && r.state === 'open' && r.foldedInto === null)
    .filter((r) => ord === undefined || ord === null || r.ord === null || r.ord === ord)
    .sort((a, b) => b.at - a.at);
  return rows[0]?.sentence ?? null;
}

/** "Jump in": the run page, at the row's moment. */
export function jumpPath(row: Pick<WatchRow, 'anchor' | 'runId'>): string | null {
  const a = row.anchor;
  const runId = a?.run_id ?? row.runId;
  if (runId === null) return null;
  const at = a === null ? '' : `?jump=${a.ord ?? ''}:${a.attempt ?? ''}:${a.at}`;
  return `/runs/${encodeURIComponent(runId)}${at}`;
}

/** `?jump=ord:attempt:at` → its parts, or null. */
export function parseJump(search: string): { ord: number | null; attempt: number | null; at: number } | null {
  const raw = new URLSearchParams(search).get('jump');
  if (raw === null) return null;
  const [o, a, t] = raw.split(':');
  const at = Number(t);
  if (!Number.isFinite(at)) return null;
  const n = (s: string | undefined): number | null => (s === undefined || s === '' || !Number.isFinite(Number(s)) ? null : Number(s));
  return { ord: n(o), attempt: n(a), at };
}

/** "Not checked on this run: scope (no declared scope)" — null when every entry checked. */
export function coverageLine(coverage: WatchFeedResponse['coverage'], label: (entryId: string) => string = (e) => e): string | null {
  const not = (coverage ?? []).filter((c): c is { entry_id: string; state: 'not_checked'; reason: string } => c.state === 'not_checked');
  if (not.length === 0) return null;
  return `Not checked on this run: ${not.map((c) => `${label(c.entry_id)} (${c.reason})`).join(', ')}`;
}

// ── The store ─────────────────────────────────────────────────────────────────────────────

interface WatchStore {
  fold: WatchFold;
  /** The late-join read failed for a reason other than "this daemon has no registry": said, never
   *  read as an empty feed (the adoption-seam rule, `api/errors.ts` `isRouteUnsupported`). */
  feedError: string | null;
  /** Every `/ws` frame: watch, team and watchdog inputs; everything else is a cheap miss. */
  ingest: (frame: { type: string } & Record<string, unknown>) => void;
  hydrate: (resp: WatchFeedResponse) => void;
  failFeed: (error: string | null) => void;
  runs: (runs: readonly SessionView[], projectOf?: (runId: string) => string | null) => void;
  reset: () => void;
}

export const useWatchStore = create<WatchStore>((set, get) => ({
  fold: EMPTY_WATCH,
  feedError: null,
  ingest: (frame) => {
    const before = get().fold;
    let next = before;
    if (frame.type === 'watchEvent') next = foldWatchFrame(next, frame);
    else if (frame.type === 'teamEvent') next = foldTeamFrame(next, frame);
    else if (typeof frame['session'] === 'string') next = foldWatchdog(next, frame, Date.now());
    if (next !== before) set({ fold: next });
  },
  hydrate: (resp) => set({ fold: foldFeed(get().fold, resp), feedError: null }),
  failFeed: (error) => set({ feedError: error }),
  runs: (runs, projectOf) => {
    const next = foldRuns(get().fold, runs, projectOf);
    if (next !== get().fold) set({ fold: next });
  },
  reset: () => set({ fold: EMPTY_WATCH, feedError: null }),
}));
