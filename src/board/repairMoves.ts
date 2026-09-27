import type { LaunchBodyWithDeliver, RosterSeat, SessionView } from '../api/types.js';
import type { GovernanceReplayOutcome } from '../api/governanceReplay.js';
import { ONBOARDING_WORKFLOW_ID } from './repoStats.js';

/**
 * Repair moves (studio Wave A, ideas 3 and 5): a number or a pile of alike rows that signals
 * trouble carries its own fix, and the fix states its consequence BEFORE it runs. Pure — the
 * hooks (`useRepairMoves`) do the posting; skins render these words.
 */

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "11 min" / "1 h 5 min" / "40 s" — a duration for a consequence line. */
export function durationWord(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 === 0 ? `${h} h` : `${h} h ${m % 60} min`;
}

// ── Idea 3: "Index all N repos" ───────────────────────────────────────────────

/** How long an onboarding run takes HERE, from the run history's own clocks. */
export interface OnboardEstimate {
  /** Median wall time of finished onboarding runs, or null when none is dated. */
  medianMs: number | null;
  /** How many finished, dated onboarding runs the median is over. */
  samples: number;
}

/** Median duration of completed onboarding runs that carry both `created_at` and `ended_at`
 *  (unix seconds). No sample → `medianMs: null`: the time is unknown, never guessed. */
export function onboardEstimate(runs: readonly SessionView[]): OnboardEstimate {
  const durations: number[] = [];
  for (const v of runs) {
    const s = v.session;
    if (s.workflow_id !== ONBOARDING_WORKFLOW_ID || s.status !== 'completed') continue;
    if (typeof s.created_at !== 'number' || typeof s.ended_at !== 'number') continue;
    const ms = (s.ended_at - s.created_at) * 1000;
    if (ms > 0) durations.push(ms);
  }
  if (durations.length === 0) return { medianMs: null, samples: 0 };
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  const medianMs = durations.length % 2 === 1 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
  return { medianMs, samples: durations.length };
}

/** The batch-onboard row's consequence line, shown before the click. */
export function batchOnboardConsequence(n: number, est: OnboardEstimate): string {
  // Short on purpose: the row shows it whole (it wraps) before the click.
  const launches = `Launches ${plural(n, 'onboarding run')}`;
  if (est.medianMs === null) return `${launches} · time unknown (none has finished here yet)`;
  return `${launches} · ~${durationWord(est.medianMs)} each (median of ${plural(est.samples, 'past onboard')})`;
}

export function batchOnboardLabel(n: number): string {
  return `Index all ${plural(n, 'repo')} ›`;
}

// ── Idea 5: the Failed tile's "Retry failed" ──────────────────────────────────

/** The failed runs a retry would relaunch: failed, unarchived, in the tile's window, and not
 *  already retried by a later run (`retry_of` names it) — a retried failure has its answer. */
export function retryableFailed(window: readonly SessionView[], all: readonly SessionView[]): SessionView[] {
  const retried = new Set(
    all.map((v) => v.session.retry_of).filter((id): id is string => typeof id === 'string' && id !== ''),
  );
  return window.filter(
    (v) => v.session.status === 'failed' && v.session.archived_at == null && !retried.has(v.session.id),
  );
}

/** A run's `human_confirm` in the launch body's string spelling. */
function confirmWire(hc: unknown): string | undefined {
  if (hc === 'none' || hc === 'all') return hc;
  if (typeof hc === 'object' && hc !== null && typeof (hc as { before?: unknown }).before === 'number') {
    return `before:${(hc as { before: number }).before}`;
  }
  return undefined;
}

/** How a failed run is relaunched: an onboarding run through its repo's onboard route (the route
 *  that owns that workflow), anything else through `POST /runs` with the same brief, workflow,
 *  repo, gates and project, and `retryOf` for lineage. Seats: `clisJson` is a JSON array of ROSTER
 *  SEAT objects (the composer's spelling), so the run's seat keys are mapped through `roster`; when
 *  no roster is at hand or none of its seats remain, the key is omitted and the daemon's roster
 *  default applies. A repo-scoped workflow run says
 *  `deliver: 'none'` explicitly — the daemon defaults an omitted key to a PR, and a batch retry
 *  must not open PRs the original launch may never have asked for. */
export type RetryLaunch =
  | { via: 'onboard'; repoId: string }
  | { via: 'runs'; body: LaunchBodyWithDeliver };

export function retryLaunchOf(v: SessionView, roster: readonly RosterSeat[] | null = null): RetryLaunch {
  const s = v.session;
  if (s.workflow_id === ONBOARDING_WORKFLOW_ID && typeof s.repo_ref === 'string' && s.repo_ref !== '') {
    return { via: 'onboard', repoId: s.repo_ref };
  }
  const body: LaunchBodyWithDeliver = { problem: s.problem, retryOf: s.id };
  const seats = (roster ?? []).filter((seat) => s.clis.includes(seat.key));
  if (seats.length > 0) body.clisJson = JSON.stringify(seats);
  if (s.entity_mode !== undefined) body.entityMode = s.entity_mode;
  const hc = confirmWire(s.human_confirm);
  if (hc !== undefined) body.humanConfirm = hc;
  if (typeof s.repo_ref === 'string' && s.repo_ref !== '') body.repoRef = s.repo_ref;
  if (typeof s.workflow_id === 'string' && s.workflow_id !== '') body.workflow = s.workflow_id;
  if (typeof s.project_id === 'string' && s.project_id !== '') body.projectId = s.project_id;
  if (body.repoRef !== undefined && body.workflow !== undefined) body.deliver = 'none';
  return { via: 'runs', body };
}

/** The Retry-failed preview's consequence line. */
export function retryConsequence(runs: readonly SessionView[], failedInWindow: number): string {
  const skipped = failedInWindow - runs.length;
  const head = runs.length === 0
    ? 'Nothing to retry'
    : `Relaunches ${plural(runs.length, 'run')} with the same brief, workflow, gates and seats (where the roster still has them); none opens a PR on its own`;
  return skipped > 0 ? `${head} · ${plural(skipped, 'failure')} already retried, skipped` : head;
}

// ── Idea 5: the Governed tile's "Replay" ──────────────────────────────────────

/** The dry run's preview words: what a replay would move, and what happens to what fails. */
export function replayPreviewLines(o: GovernanceReplayOutcome): string[] {
  if (o.read === 0) return ['The outbox is empty — nothing to replay.'];
  const lines = [`Would replay ${plural(o.read, 'dead-lettered event')} into the governance store.`];
  const reasons = Object.entries(o.fold?.byReason ?? {}).sort((a, b) => b[1] - a[1]);
  if (reasons.length > 0) lines.push(`Spooled because: ${reasons.map(([r, n]) => `${r} (${n})`).join(', ')}.`);
  lines.push('Events that land leave the outbox; any that fail stay quarantined there, nothing is lost.');
  if (o.blocker !== null) lines.push(`Cannot replay here: ${o.blocker}.`);
  return lines;
}

/** The replay's result words. */
export function replayResultLine(o: GovernanceReplayOutcome): string {
  const bits = [`${o.replayed} landed`];
  if (o.alreadyPresent !== null && o.alreadyPresent > 0) bits.push(`${o.alreadyPresent} already on the store`);
  bits.push(`${o.failed} still quarantined`);
  return `Replayed ${plural(o.read, 'event')}: ${bits.join(' · ')}`;
}
