import type { AuditEntry, SessionView } from '../api/types.js';
import { endedAtMs, type ElicitationLite, type GateLite } from './needsYou.js';

/**
 * HANDOVER ON ARRIVAL (studio wave 2b, behaviour 1) — the pure half.
 *
 * The operator's visit clock (`lastSeenAt`, kept by `store/visit.ts`) and the arrival
 * rule live here, and so does the fold that turns "what happened while you were away"
 * into four sections in a FIXED order:
 *
 *   1. decisions — what waits on you NOW: open gates and MCP elicitations on live runs;
 *   2. broke     — runs that failed since you left;
 *   3. finished  — runs that completed since you left;
 *   4. system    — what the system did for you: audit entries whose actor is `system`
 *                  (the stall watchdog's `run.stall.*`), since you left.
 *
 * Clocks are the daemon's own: a run's `ended_at` (api-types 0.38, unix seconds), the
 * durable failure tail for a failure the wire has no `ended_at` for, the audit entry's
 * `ts`. A run with no clock is not counted as "since you left" — never dated with now.
 */

/** Default absence that earns a handover; `studio.handover.awayMinutes` overrides it. */
export const DEFAULT_AWAY_MINUTES = 30;

/** The persisted visit record. */
export interface VisitState {
  /** The last instant the operator was here (a visible studio tab), epoch ms. */
  lastSeenAt: number | null;
  /** An absence that earned a handover and has not been dismissed. */
  handover: { since: number; at: number } | null;
}

export const NO_VISIT: VisitState = { lastSeenAt: null, handover: null };

/**
 * Arrival: an absence of at least `thresholdMs` since `lastSeenAt` opens a handover. An
 * undismissed handover is extended, never replaced — its `since` keeps the earlier start,
 * so nothing that happened during the first absence drops out.
 */
export function arriveState(prev: VisitState, now: number, thresholdMs: number): VisitState {
  const away = prev.lastSeenAt !== null && now - prev.lastSeenAt >= thresholdMs;
  const handover = away
    ? { since: prev.handover?.since ?? (prev.lastSeenAt as number), at: now }
    : prev.handover;
  return { lastSeenAt: now, handover };
}

/** Never trust the stored setting: a positive number of minutes, else the default. */
export function sanitizeAwayMinutes(raw: unknown): number {
  const o = (raw !== null && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const m = o.awayMinutes;
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : DEFAULT_AWAY_MINUTES;
}

/** "14:05" — a 24-hour wall-clock stamp, zero-padded. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export type HandoverSectionKey = 'decisions' | 'broke' | 'finished' | 'system';

export const HANDOVER_ORDER: readonly HandoverSectionKey[] = ['decisions', 'broke', 'finished', 'system'];

export const HANDOVER_TITLES: Record<HandoverSectionKey, string> = {
  decisions: 'Decisions due',
  broke: 'What broke',
  finished: 'What finished',
  system: 'What the system did for you',
};

export interface HandoverItem {
  key: string;
  runId: string | null;
  /** The run's problem (or the action, for an entry with no run). */
  subject: string;
  text: string;
  at: number | null;
  /** Where the row links — the run's own surface. */
  path: string;
}

export interface HandoverSection {
  key: HandoverSectionKey;
  title: string;
  items: HandoverItem[];
  /** False when the section's wire could not answer (an absent audit read). */
  available: boolean;
}

export interface HandoverInputs {
  runs: readonly SessionView[];
  gates: Record<string, GateLite>;
  elicitations: Record<string, ElicitationLite>;
  /** Durable-log failure tails (the board model's backfill). */
  failedAt: Record<string, number>;
  /** run id → project id (the membership mirror). */
  projectIds: Record<string, string>;
  /** `GET /audit?since=` — null while unread or unsupported. */
  audit: readonly AuditEntry[] | null;
  since: number;
}

/** Plain words for the system actions crew's trail records (daemon + stall watchdog);
 *  an unknown action keeps its token rather than a guessed sentence. */
const SYSTEM_ACTION_TEXT: Record<string, string> = {
  'run.stall.detected': 'The stall watchdog noticed a silent worker',
  'run.turn.timedout': 'A worker turn hit its time ceiling and was stopped',
  'run.delivered': "Delivered the run's work",
  'run.launched': 'Launched a run',
};

/** System bookkeeping that is not an action taken for you — `run.ended` restates what
 *  "broke" and "finished" already say. */
const SYSTEM_BOOKKEEPING: ReadonlySet<string> = new Set(['run.ended']);

function systemText(e: AuditEntry): string {
  if (e.action === 'run.stall.escalated') {
    const d = (e.detail ?? {}) as Record<string, unknown>;
    if (d['action'] === 'reassign' && d['outcome'] === 'ok') return 'The stall watchdog reassigned a silent worker';
    if (d['outcome'] === 'exhausted') return 'The stall watchdog spent its recoveries and escalated a silent run to you';
    return 'The stall watchdog escalated a silent run to you';
  }
  return SYSTEM_ACTION_TEXT[e.action] ?? `System action: ${e.action}`;
}

function runPath(runId: string, projectId: string | undefined, hash = ''): string {
  return projectId !== undefined
    ? `/p/${encodeURIComponent(projectId)}/build/${encodeURIComponent(runId)}${hash}`
    : `/runs/${encodeURIComponent(runId)}${hash}`;
}

const TERMINAL: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export function handoverSections(inp: HandoverInputs): HandoverSection[] {
  const { runs, gates, elicitations, failedAt, projectIds, audit, since } = inp;
  const live = runs.filter((v) => v.session.archived_at == null);
  const byId = new Map(live.map((v) => [v.session.id, v]));
  const pidOf = (v: SessionView): string | undefined =>
    typeof v.session.project_id === 'string' && v.session.project_id !== 'default'
      ? v.session.project_id
      : projectIds[v.session.id];

  const decisions: HandoverItem[] = [];
  for (const v of live) {
    if (v.session.status !== 'awaiting_human') continue;
    const g = gates[v.session.id];
    decisions.push({
      key: `gate:${v.session.id}`,
      runId: v.session.id,
      subject: v.session.problem,
      text: g !== undefined ? `Gate: ${g.prompt}` : 'Gate: waiting on you',
      at: g?.receivedAt ?? null,
      path: runPath(v.session.id, pidOf(v), '#gate'),
    });
  }
  for (const [runId, e] of Object.entries(elicitations)) {
    const v = byId.get(runId);
    if (v === undefined || TERMINAL.has(v.session.status)) continue;
    const at = typeof e.receivedAt === 'number' ? e.receivedAt : Date.parse(e.receivedAt);
    decisions.push({
      key: `elicit:${runId}`,
      runId,
      subject: v.session.problem,
      text: `Question: ${e.message}`,
      at: Number.isFinite(at) ? at : null,
      path: runPath(runId, pidOf(v)),
    });
  }

  const broke: HandoverItem[] = [];
  const finished: HandoverItem[] = [];
  for (const v of live) {
    const id = v.session.id;
    if (v.session.status === 'failed') {
      const at = endedAtMs(v) ?? failedAt[id] ?? null;
      if (at === null || at < since) continue;
      broke.push({ key: `fail:${id}`, runId: id, subject: v.session.problem, text: 'Run failed', at, path: runPath(id, pidOf(v)) });
    } else if (v.session.status === 'completed') {
      const at = endedAtMs(v);
      if (at === null || at < since) continue;
      finished.push({ key: `done:${id}`, runId: id, subject: v.session.problem, text: 'Run completed', at, path: runPath(id, pidOf(v)) });
    }
  }

  // Filtered here too: a daemon predating `?since=` ignores the parameter and answers
  // the newest page of the whole trail.
  const system: HandoverItem[] = (audit ?? [])
    .filter((e) => e.actor?.kind === 'system' && e.ts >= since && !SYSTEM_BOOKKEEPING.has(e.action))
    .map((e) => {
      const v = e.runId !== undefined ? byId.get(e.runId) : undefined;
      return {
        key: `audit:${e.ts}:${e.action}:${e.runId ?? ''}`,
        runId: e.runId ?? null,
        subject: v?.session.problem ?? (e.runId !== undefined ? e.runId : e.action),
        text: systemText(e),
        at: e.ts,
        path: e.runId !== undefined ? runPath(e.runId, v !== undefined ? pidOf(v) : projectIds[e.runId]) : '/system',
      };
    });

  const newestFirst = (a: HandoverItem, b: HandoverItem): number =>
    (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.key.localeCompare(b.key);
  // Decisions: the longest-waiting first (the queue's own rule); the rest newest first.
  decisions.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.key.localeCompare(b.key));
  const items: Record<HandoverSectionKey, HandoverItem[]> = {
    decisions,
    broke: broke.sort(newestFirst),
    finished: finished.sort(newestFirst),
    system: system.sort(newestFirst),
  };
  return HANDOVER_ORDER.map((key) => ({
    key,
    title: HANDOVER_TITLES[key],
    items: items[key],
    available: key !== 'system' || audit !== null,
  }));
}
