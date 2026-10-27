import type { RunLiveness, SystemAttention, SystemRun } from '../api/system.js';
import type { SystemStore } from '../store/systemSnapshot.js';

/**
 * NERVE CENTER'S VERDICT (DES-SYSTEM-VIEW, "The rail entry"): green, yellow or red, and the worst
 * item in words. Pure, so the rule is pinned by tests:
 *
 *  - green ONLY over a successful, fresh read with nothing in attention — a read that failed, has
 *    not answered yet, or is older than {@link STALE_MS} is yellow "can't reach crew", never green;
 *  - red when something blocks work (an attention item at level red), yellow when something needs
 *    a look but work still flows.
 *
 * Against a crew with the snapshot, attention is crew's `attention[]`. Against an older crew it is
 * folded here from what that crew can say: `/health`, the governance block of `/diagnostics`, the
 * socket, and the needs-you count the Desk already shows.
 */

/** An answer older than this is stale: the tile says it can't reach crew, never green. */
export const STALE_MS = 75_000;

export type NerveTone = 'green' | 'yellow' | 'red';

/** Why the tile reads what it reads: `fresh` is the only state that can be green. */
export type NerveRead = 'fresh' | 'checking' | 'failed' | 'stale';

export interface NerveState {
  tone: NerveTone;
  read: NerveRead;
  /** The worst item, in words ("gateway down", "all clear", "can't reach crew"). */
  words: string;
  /** Every item, worst first (the dashboard's Needs attention strip). */
  attention: SystemAttention[];
}

export const CANT_REACH = "can't reach crew";
export const ALL_CLEAR = 'all clear';
export const CHECKING = 'checking crew';

type Signals = Pick<SystemStore, 'mode' | 'health' | 'healthAt' | 'healthError' | 'snapshot' | 'snapshotAt' | 'snapshotError' | 'governance' | 'governanceAt'>;

const item = (id: string, level: SystemAttention['level'], panel: SystemAttention['panel'], text: string, reason: string | null, remedy: string | null, action: SystemAttention['action'] = null): SystemAttention =>
  ({ id, level, panel, text, reason, remedy, action });

/** Red first, then yellow; within a level the order given (crew orders by how much work it blocks). */
export function worstFirst(items: readonly SystemAttention[]): SystemAttention[] {
  return [...items.filter((a) => a.level === 'red'), ...items.filter((a) => a.level !== 'red')];
}

/**
 * The studio-side items no crew can know: the live socket. Said in both modes.
 */
function socketItems(ws: 'connecting' | 'connected' | 'disconnected'): SystemAttention[] {
  return ws === 'disconnected'
    ? [item('studio-socket', 'yellow', 'infra', 'live updates paused', 'Studio lost its live connection to crew, so pages stop updating on their own.', 'It reconnects by itself. Reload the page if it does not.')]
    : [];
}

/** An older crew's attention, folded from what it can say (the old Health dot's signals, plus the
 *  needs-you count). */
export function fallbackAttention(s: Signals, waitingOnYou: number): SystemAttention[] {
  const out: SystemAttention[] = [];
  const g = s.governance;
  if (g.kind === 'ok' && g.governance.store === null) {
    out.push(item('governance-store', 'red', 'governance', 'no evidence store', 'Crew found no governance store, so check results wait in a holding file and are not recorded.', 'See Governance below, then restart crew once its state home is fixed.'));
  }
  if (g.kind === 'ok') {
    for (const f of g.governance.findings.filter((x) => x.severity === 'error')) {
      out.push(item(`governance-${f.kind}`, 'red', 'governance', 'governance problem', f.message, 'See Governance below.'));
    }
  }
  if (s.health !== null && s.health.status !== undefined && s.health.status !== 'ok') {
    out.push(item('crew-status', 'yellow', 'infra', `crew reports ${s.health.status}`, `Crew answered its health check with "${s.health.status}".`, 'See Infra below.'));
  }
  if (g.kind === 'error') out.push(item('governance-read', 'yellow', 'governance', "governance can't be read", g.message, 'Re-check, or see Governance below.', { kind: 'recheck', target: 'governance' }));
  if (g.kind === 'ok') {
    for (const f of g.governance.findings.filter((x) => x.severity === 'warning')) {
      out.push(item(`governance-${f.kind}`, 'yellow', 'governance', 'governance warning', f.message, 'See Governance below.'));
    }
  }
  if (waitingOnYou > 0) {
    out.push(item('waiting-on-you', 'yellow', 'runs', waitingOnYou === 1 ? '1 thing waits on you' : `${waitingOnYou} things wait on you`, 'Work is held until you answer.', 'Open the Desk and answer it.'));
  }
  return out;
}

/** The verdict. `now` is the caller's clock, so staleness moves while nothing else does. */
export function nerveState(s: Signals, ws: 'connecting' | 'connected' | 'disconnected', waitingOnYou: number, now: number): NerveState {
  const unreachable = (read: NerveRead, why: string): NerveState => {
    const reach = item('crew-unreachable', 'yellow', 'infra', CANT_REACH, why, 'Check that crew is running, then Re-check.', { kind: 'recheck', target: 'crew' });
    return { tone: 'yellow', read, words: CANT_REACH, attention: [reach, ...socketItems(ws)] };
  };
  const checking = (): NerveState => ({ tone: 'yellow', read: 'checking', words: CHECKING, attention: [] });

  if (s.healthError !== null) return unreachable('failed', `Crew's health check failed: ${s.healthError}`);
  if (s.healthAt === null) return checking();
  if (now - s.healthAt > STALE_MS) return unreachable('stale', 'Crew has not answered for a while; the last answer is too old to trust.');

  let attention: SystemAttention[];
  if (s.mode === 'system') {
    if (s.snapshotError !== null) return unreachable('failed', `Crew's system snapshot could not be read: ${s.snapshotError}`);
    if (s.snapshotAt === null || s.snapshot === null) return checking();
    if (now - s.snapshotAt > STALE_MS) return unreachable('stale', "Crew's system snapshot is too old to trust.");
    if (s.snapshot.ranked === true) return rankedState(s.snapshot.attention, s.snapshot.unresolved?.length ?? 0, s.snapshot.unresolvedSpendUsd ?? null, socketItems(ws));
    attention = worstFirst([...s.snapshot.attention, ...socketItems(ws)]);
  } else if (s.mode === 'fallback') {
    if (s.governance.kind === 'unread') return checking();
    // The governance answer must be as fresh as the health one (a read that failed keeps no clock).
    if (s.governance.kind !== 'error' && (s.governanceAt === null || now - s.governanceAt > STALE_MS)) {
      return unreachable('stale', "Crew's governance answer is too old to trust.");
    }
    attention = worstFirst([...fallbackAttention(s, waitingOnYou), ...socketItems(ws)]);
  } else {
    return checking();
  }
  const top = attention[0];
  if (top === undefined) return { tone: 'green', read: 'fresh', words: ALL_CLEAR, attention };
  return { tone: top.level === 'red' ? 'red' : 'yellow', read: 'fresh', words: top.text, attention };
}

/** Dollars in words ("$12.40", "$0.42"). */
export function spendWords(usd: number): string {
  return `$${usd >= 100 ? Math.round(usd).toLocaleString() : usd.toFixed(2)}`;
}

/** "16 jobs to resolve · $4.20 spent" (no spend said when none is known). */
export function toResolveWords(n: number, usd: number | null): string {
  return `${n} ${n === 1 ? 'job' : 'jobs'} to resolve${usd !== null && usd > 0 ? ` · ${spendWords(usd)} spent` : ''}`;
}

/**
 * A ranked crew's verdict (api-types 0.140.0): `attention` IS the needs-you list, in crew's order
 * (never re-sorted here), and the tile says how many and the first. Green only when nothing holds
 * work up AND nothing is left unresolved; unresolved work alone is yellow, in its own words.
 */
function rankedState(items: readonly SystemAttention[], unresolved: number, spend: number | null, socket: SystemAttention[]): NerveState {
  const attention = [...items, ...socket];
  const top = items[0] ?? socket[0];
  if (top === undefined) {
    if (unresolved > 0) return { tone: 'yellow', read: 'fresh', words: toResolveWords(unresolved, spend), attention };
    return { tone: 'green', read: 'fresh', words: ALL_CLEAR, attention };
  }
  const tone: NerveTone = attention.some((a) => a.level === 'red') ? 'red' : 'yellow';
  const words = items.length > 1 ? `${items.length} need you · ${top.text}` : top.text;
  return { tone, read: 'fresh', words, attention };
}

/** The tile's state word for an accessible name ("Nerve Center: gateway down, work is blocked"). */
export function toneWord(tone: NerveTone): string {
  return tone === 'green' ? 'nothing needs you' : tone === 'yellow' ? 'needs a look' : 'work is blocked';
}

const LIVENESS_ORDER: Record<RunLiveness, number> = { waiting_on_you: 0, held: 1, stalled: 2, quiet: 3, working: 4 };

export const LIVENESS_WORD: Record<RunLiveness, string> = {
  waiting_on_you: 'waiting on you',
  held: 'held',
  stalled: 'stalled',
  quiet: 'quiet',
  working: 'working',
};

/** Unfinished runs, worst first — crew's order (api-types 0.136.0): waiting on you, held, stalled, quiet,
 *  working; oldest evidence first within. */
export function runsWorstFirst(runs: readonly SystemRun[]): SystemRun[] {
  return [...runs].sort((a, b) => (LIVENESS_ORDER[a.liveness] - LIVENESS_ORDER[b.liveness]) || ((a.lastEventAt ?? 0) - (b.lastEventAt ?? 0)));
}

/** A percentage (0..100) in words; `null` stays "—". */
export function percent(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}%`;
}

/** A duration in words: "42 s", "3.5 min", "1.2 h"; `null` stays "—". */
export function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)} min`;
  return `${(ms / 3_600_000).toFixed(1)} h`;
}
