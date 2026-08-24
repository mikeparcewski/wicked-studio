import type { AuditEntry, CoreEvent, SessionView } from '../api/types.js';

/**
 * Chain assembly for the work chronicle (DES-UX-002 §3.2, slice BC — EC50):
 * runs group into episode chains by following the `retry_of` DTO echo
 * (api-types 0.8.0, CREW-UX-3 — the system-of-record lineage, never prompt
 * equality). Pure and unit-tested; the component renders what this derives.
 */

/** Run-level statuses that mean "still moving" (CenterDashboard's set). */
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'planning',
  'distributing',
  'executing',
  'awaiting_human',
]);

/**
 * Group a scoped run list into chains, O(n) over the list (§3.2's CLIENT
 * verdict): a run with no `retry_of` — or whose `retry_of` names a run OUTSIDE
 * the scope, the honest broken-lineage case — is a chain root; every run whose
 * `retry_of` names a member joins its parent's chain. Each chain is in lineage
 * order, root first; fan-out (two retries of one run) orders siblings by the
 * DTO's `attempt`, then flattens depth-first. A `retry_of` cycle (impossible
 * on the real wire — launch validates the target exists BEFORE the new id is
 * minted — but cheap to guard) terminates via the seen-set.
 */
export function assembleChains(runs: readonly SessionView[]): SessionView[][] {
  const byId = new Map(runs.map((v) => [v.session.id, v]));
  const children = new Map<string, SessionView[]>();
  const roots: SessionView[] = [];
  for (const v of runs) {
    const parent = v.session.retry_of;
    if (parent !== undefined && byId.has(parent)) {
      const siblings = children.get(parent) ?? [];
      siblings.push(v);
      children.set(parent, siblings);
    } else {
      roots.push(v);
    }
  }
  const chains: SessionView[][] = [];
  for (const root of roots) {
    const chain: SessionView[] = [];
    const stack: SessionView[] = [root];
    const seen = new Set<string>();
    while (stack.length > 0) {
      const cur = stack.pop() as SessionView;
      if (seen.has(cur.session.id)) continue;
      seen.add(cur.session.id);
      chain.push(cur);
      const kids = (children.get(cur.session.id) ?? [])
        .slice()
        .sort((a, b) => a.session.attempt - b.session.attempt);
      for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i] as SessionView);
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * §3.3's chain-status semantics, deny-of-ambiguity order: a still-moving
 * latest attempt makes the chain live (its own status word, so a gate reads
 * as a gate); else `completed` if ANY attempt completed (the episode
 * resolved); else `failed` when every attempt failed; else the latest
 * attempt's terminal status (cancelled chains say cancelled).
 */
export function chainStatus(chain: readonly SessionView[]): string {
  const latest = chain[chain.length - 1];
  if (latest === undefined) return 'unknown';
  if (ACTIVE_STATUSES.has(latest.session.status)) return latest.session.status;
  if (chain.some((v) => v.session.status === 'completed')) return 'completed';
  if (chain.every((v) => v.session.status === 'failed')) return 'failed';
  return latest.session.status;
}

/** Is any attempt of this chain still moving? (drives the default-expanded rule) */
export function chainInProgress(chain: readonly SessionView[]): boolean {
  return chain.some((v) => ACTIVE_STATUSES.has(v.session.status));
}

/**
 * The most recent COMPLETED run of the scope — the current-state strip's
 * subject (§3.3). "Most recent" by the membership attach clock (the one honest
 * per-run clock, `runIdentity.ts`); clock-less completed runs lose to dated
 * ones and fall back to list position. `null` = the strip's honest empty state
 * (EC53 — never a fabricated state).
 */
export function lastCompletedRun(
  runs: readonly SessionView[],
  attachedAt: Readonly<Record<string, number>>,
): SessionView | null {
  let best: SessionView | null = null;
  let bestClock = -Infinity;
  runs.forEach((v, ix) => {
    if (v.session.status !== 'completed') return;
    const clock = attachedAt[v.session.id] ?? ix - runs.length; // undated: positional, below any real clock
    if (clock >= bestClock) {
      best = v;
      bestClock = clock;
    }
  });
  return best;
}

/** Completed phases of a run — its done units (the house "phase n/N" vocabulary). */
export function completedPhases(v: SessionView): number {
  return v.units.filter((u) => u.status === 'done').length;
}

/** The last `gateEvaluated` criterion that PASSED (`combined === true`), else null. */
export function passedCriterion(events: readonly CoreEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.type === 'gateEvaluated' && ev.combined === true && typeof ev.criterion === 'string') {
      return ev.criterion;
    }
  }
  return null;
}

/** The last `workflowSelected` workflow id in the trail, else null. */
export function lastWorkflowSelected(events: readonly CoreEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (ev?.type === 'workflowSelected' && typeof ev.workflowId === 'string') return ev.workflowId;
  }
  return null;
}

/**
 * The guidance summary's rows (§3.3): `gate.decided` audit entries that carry
 * a non-empty `amend` AND address a run in this project's scope — the wire has
 * no `?projectId=` audit filter (§10), so the scope join is client-side over
 * the run ids the chronicle already holds. Newest-first order is the wire's;
 * capped at the last `max` amendments.
 */
export function guidanceAmendments(
  entries: readonly AuditEntry[],
  scopedRunIds: ReadonlySet<string>,
  max = 5,
): AuditEntry[] {
  return entries
    .filter((e) => {
      if (typeof e.runId !== 'string' || !scopedRunIds.has(e.runId)) return false;
      const amend = e.detail?.['amend'];
      return typeof amend === 'string' && amend.trim().length > 0;
    })
    .slice(0, max);
}
