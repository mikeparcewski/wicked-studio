import { isAskTurnRun } from './askTurn.js';
import type { AuditEntry, SessionView } from '../api/types.js';
import { endedAtMs, type ElicitationLite, type GateLite } from './needsYou.js';
import { standingOrderActionText } from './standingOrders.js';

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
 *   4. orders    — what your standing orders did (behaviour 10): each approve / hold /
 *                  queued message an order took, NAMED by the order. Present only when an
 *                  order acted — a quiet absence keeps the four sections it always had;
 *   5. system    — what the rest of the system did for you: audit entries whose actor is
 *                  `system` (the stall watchdog's `run.stall.*`), since you left.
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

export type HandoverSectionKey = 'decisions' | 'broke' | 'finished' | 'orders' | 'system';

export const HANDOVER_ORDER: readonly HandoverSectionKey[] = ['decisions', 'broke', 'finished', 'orders', 'system'];

export const HANDOVER_TITLES: Record<HandoverSectionKey, string> = {
  decisions: 'Decisions due',
  broke: 'What broke',
  finished: 'What finished',
  orders: 'What your standing orders did',
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
  /** The audit-trail line behind an item the system or an order did — shown as its receipt. */
  audit?: { action: string; actor: string; ts: number; detail?: Record<string, unknown> };
}

/** A section's wire: `loading` while its read is in flight, `failed` when the daemon
 *  could not answer — never the same thing (a slow read is not "cannot say"). */
export type HandoverSectionState = 'ready' | 'loading' | 'failed';

export interface HandoverSection {
  key: HandoverSectionKey;
  title: string;
  items: HandoverItem[];
  state: HandoverSectionState;
}

export interface HandoverInputs {
  runs: readonly SessionView[];
  gates: Record<string, GateLite>;
  elicitations: Record<string, ElicitationLite>;
  /** Durable-log failure tails (the board model's backfill). */
  failedAt: Record<string, number>;
  /** run id → project id (the membership mirror). */
  projectIds: Record<string, string>;
  /** `GET /audit?since=`: the entries, `'loading'` while in flight, null when it failed. */
  audit: readonly AuditEntry[] | 'loading' | null;
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
    if (isAskTurnRun(v.session)) continue; // studio#588: an ask's turn gate is not a decision
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
  const orders: HandoverItem[] = [];
  const system: HandoverItem[] = [];
  for (const e of Array.isArray(audit) ? audit : []) {
    if (e.actor?.kind !== 'system' || e.ts < since || SYSTEM_BOOKKEEPING.has(e.action)) continue;
    // Behaviour 10: an action a standing order took goes to its own section, naming the order.
    const byOrder = standingOrderActionText(e);
    const v = e.runId !== undefined ? byId.get(e.runId) : undefined;
    (byOrder !== undefined ? orders : system).push({
      key: `audit:${e.ts}:${e.action}:${e.runId ?? ''}`,
      runId: e.runId ?? null,
      subject: v?.session.problem ?? (e.runId !== undefined ? e.runId : e.action),
      text: byOrder ?? systemText(e),
      at: e.ts,
      path: e.runId !== undefined ? runPath(e.runId, v !== undefined ? pidOf(v) : projectIds[e.runId]) : '/system',
      audit: {
        action: e.action,
        actor: typeof e.actor?.id === 'string' ? e.actor.id : 'system',
        ts: e.ts,
        ...(e.detail != null && typeof e.detail === 'object' ? { detail: e.detail as Record<string, unknown> } : {}),
      },
    });
  }

  const newestFirst = (a: HandoverItem, b: HandoverItem): number =>
    (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.key.localeCompare(b.key);
  // Decisions: the longest-waiting first (the queue's own rule); the rest newest first.
  decisions.sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.key.localeCompare(b.key));
  const items: Record<HandoverSectionKey, HandoverItem[]> = {
    decisions,
    broke: broke.sort(newestFirst),
    finished: finished.sort(newestFirst),
    orders: orders.sort(newestFirst),
    system: system.sort(newestFirst),
  };
  return HANDOVER_ORDER.filter((key) => key !== 'orders' || orders.length > 0).map((key) => ({
    key,
    title: HANDOVER_TITLES[key],
    items: items[key],
    state: key !== 'system' || Array.isArray(audit) ? 'ready' : audit === 'loading' ? 'loading' : 'failed',
  }));
}

/**
 * THE STRIP (operator feedback: the four-column panel pushed every section off the page). The
 * handover is shown as ONE line of chips, each of which does something:
 *
 *   decisions — reveals those rows in the Needs You queue (their Open gate verb lives there);
 *   broke     — reveals those rows in the Needs You queue (their Retry verb lives there);
 *   finished  — an overlay of each finished run with its next use (Open, Draft update, Reuse);
 *   done      — an overlay of what your standing orders and the system did (orders + system),
 *               each with Open and its audit entry.
 */
export type HandoverChipKey = 'decisions' | 'broke' | 'finished' | 'done';

export const HANDOVER_CHIP_ORDER: readonly HandoverChipKey[] = ['decisions', 'broke', 'finished', 'done'];

/** How a chip reads: "3 decisions due", "1 broke", "2 finished", "3 done for you". */
export const HANDOVER_CHIP_NOUN: Record<HandoverChipKey, (n: number) => string> = {
  decisions: (n) => (n === 1 ? 'decision due' : 'decisions due'),
  broke: () => 'broke',
  finished: () => 'finished',
  done: () => 'done for you',
};

/** What a chip does when pressed: reveal rows in the queue, or open an overlay. */
export const HANDOVER_CHIP_ACTION: Record<HandoverChipKey, 'reveal' | 'overlay'> = {
  decisions: 'reveal',
  broke: 'reveal',
  finished: 'overlay',
  done: 'overlay',
};

export interface HandoverChip {
  key: HandoverChipKey;
  items: HandoverItem[];
  /** "done for you" keeps who acted: what your standing orders did, then what the system did. */
  groups: { key: HandoverSectionKey; title: string; items: HandoverItem[] }[];
  /** `loading` while any section behind it is in flight; `failed` when one cannot say. */
  state: HandoverSectionState;
}

/** The sections folded into the strip's four chips (orders + system → "done for you", newest first). */
export function handoverChips(sections: readonly HandoverSection[]): HandoverChip[] {
  const of = (keys: readonly HandoverSectionKey[]): HandoverSection[] => sections.filter((s) => keys.includes(s.key));
  const fold = (key: HandoverChipKey, secs: HandoverSection[]): HandoverChip => ({
    key,
    items: key === 'done'
      ? secs.flatMap((s) => s.items).sort((a, b) => (b.at ?? -Infinity) - (a.at ?? -Infinity) || a.key.localeCompare(b.key))
      : secs.flatMap((s) => s.items),
    groups: secs.filter((s) => s.items.length > 0).map((s) => ({ key: s.key, title: s.title, items: s.items })),
    state: secs.some((s) => s.state === 'loading') ? 'loading' : secs.some((s) => s.state === 'failed') ? 'failed' : 'ready',
  });
  return [
    fold('decisions', of(['decisions'])),
    fold('broke', of(['broke'])),
    fold('finished', of(['finished'])),
    fold('done', of(['orders', 'system'])),
  ];
}

/** Every item the handover lists right now, by key. */
export function listedKeys(sections: readonly HandoverSection[]): string[] {
  return sections.flatMap((s) => s.items.map((i) => i.key));
}

/**
 * Clearing on its own: once every item the handover has listed has been ACTED on (a verb pressed —
 * its Open gate or Retry in the queue, Open / Draft update / Reuse in an overlay, an audit entry
 * read) or RESOLVED (it is no longer listed — the gate was answered, the run archived), the
 * handover has nothing left to hand over. Never while a section is still being read, and never
 * before it has listed anything (an empty first fold may only mean the runs have not loaded).
 */
export function handoverSettled(
  sections: readonly HandoverSection[],
  everListed: readonly string[],
  acted: readonly string[],
): boolean {
  if (everListed.length === 0 || sections.some((s) => s.state === 'loading')) return false;
  const done = new Set(acted);
  return listedKeys(sections).every((k) => done.has(k));
}
