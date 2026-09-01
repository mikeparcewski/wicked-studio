import type { GovernanceClaim, SessionView } from '../api/types.js';
import type { SteeringRule } from '../api/steering.js';
import { steeringTypeOf, type SteeringType } from '../api/steering.js';
import type { WikiRuleEvidenceRow } from '../api/wiki.js';
import type { StatDelta } from './windowStats.js';

/**
 * The STEERING USAGE folds (the Steering landing's when/how/success band) — pure
 * derivations over wires the app already speaks, pinned by unit test:
 *
 *  - `GET /governance/claims` — every recorded gate evaluation (`GovernanceClaim`), with a
 *    REAL clock (`evaluated_at`, unix seconds) and a decision. The when/how record.
 *  - the AW-23 scoreboard's `evidence.per_rule` — which RULES the enforcement record cites
 *    (denial claims + governs evidence); zero everywhere = dead weight.
 *  - the one `GET /runs` list — the governed-runs join (claim scopes name their run).
 *
 * WINDOW HONESTY: claims carry real timestamps, so the window is TEMPORAL (last N days vs
 * the previous N). A delta renders only when the record PROVES a full prior window exists —
 * the oldest claim must predate the prior window's start; otherwise `previous: null`
 * ("—", never a fabricated 0%). Zero history keeps `current: 0, previous: null`.
 */

export const USAGE_WINDOW_DAYS = 7;
const DAY_MS = 24 * 3_600_000;

/** The slice of a claim these folds read (full `GovernanceClaim` satisfies it). */
export type ClaimLite = Pick<GovernanceClaim, 'decision' | 'evaluated_at' | 'scope'>;

export interface UsageWindows {
  /** Gate evaluations: claims recorded in the current window vs the previous. */
  evaluations: StatDelta;
  /** Denials issued in the same windows. */
  denials: StatDelta;
  /** Current-window decision split. */
  allow: number;
  deny: number;
  conditions: number;
  /** Daily evaluation counts across the current window, oldest first. */
  spark: number[];
}

export function usageWindows(claims: ClaimLite[], now: number): UsageWindows {
  const windowMs = USAGE_WINDOW_DAYS * DAY_MS;
  const curStart = now - windowMs;
  const prevStart = now - 2 * windowMs;
  let oldest = Infinity;
  let cur = 0;
  let prev = 0;
  let curDeny = 0;
  let prevDeny = 0;
  let allow = 0;
  let deny = 0;
  let conditions = 0;
  const spark = new Array<number>(USAGE_WINDOW_DAYS).fill(0);
  for (const c of claims) {
    const at = c.evaluated_at * 1000;
    if (at < oldest) oldest = at;
    if (at >= curStart && at <= now) {
      cur += 1;
      if (c.decision === 'deny') { curDeny += 1; deny += 1; }
      else if (c.decision === 'allow_with_conditions') conditions += 1;
      else allow += 1;
      const bucket = Math.min(USAGE_WINDOW_DAYS - 1, Math.floor((at - curStart) / DAY_MS));
      spark[bucket] = (spark[bucket] ?? 0) + 1;
    } else if (at >= prevStart && at < curStart) {
      prev += 1;
      if (c.decision === 'deny') prevDeny += 1;
    }
  }
  // The prior bucket counts only when the record PROVES it was fully observed: the oldest
  // claim predates the prior window. A record that starts mid-window cannot distinguish
  // "no evaluations then" from "nothing was recorded yet" — so no delta, never a lie.
  const priorProven = oldest !== Infinity && oldest <= prevStart;
  return {
    evaluations: { current: cur, previous: priorProven ? prev : null },
    denials: { current: curDeny, previous: priorProven ? prevDeny : null },
    allow,
    deny,
    conditions,
    spark,
  };
}

// ── The governed-runs join ────────────────────────────────────────────────────────────────────

/**
 * The run id a claim's scope names. The engine's run grammar is
 * `wicked-agent/<runId>/<entity…>`; older writers used the bare run id (both spellings are
 * read by GovernanceAudit — the same two here). A scope that is neither yields itself, which
 * simply never joins.
 */
export function runIdOfScope(scope: string): string {
  if (scope.startsWith('wicked-agent/')) {
    const seg = scope.split('/')[1];
    return seg !== undefined && seg !== '' ? seg : scope;
  }
  return scope;
}

export interface GovernedRuns {
  /** Non-archived runs with ≥1 recorded gate evaluation. */
  governed: number;
  total: number;
  /** governed/total, or `null` when there are no runs to divide by. */
  pct: number | null;
}

export function governedRuns(claims: ClaimLite[], runs: SessionView[]): GovernedRuns {
  const claimed = new Set(claims.map((c) => runIdOfScope(c.scope)));
  const live = runs.filter((v) => v.session.archived_at == null);
  const governed = live.filter((v) => claimed.has(v.session.id)).length;
  return {
    governed,
    total: live.length,
    pct: live.length === 0 ? null : Math.round((governed / live.length) * 100),
  };
}

// ── Rule usage — top-fired vs dead weight ─────────────────────────────────────────────────────

export interface RuleUsage {
  /** ACTIVE rules with zero enforcement evidence (no denial claims, no governs evidence). */
  unusedIds: string[];
  /** The most-cited active rule, or `null` when nothing has fired. */
  topFired: { ruleId: string; total: number } | null;
  /** Active rules with ANY evidence. */
  firedCount: number;
  /** The steering type holding the most unused rules — where the click-through lands. */
  unusedHomeType: SteeringType | null;
}

export function ruleUsage(rules: SteeringRule[], perRule: WikiRuleEvidenceRow[]): RuleUsage {
  const evidence = new Map(perRule.map((r) => [r.rule_id, r.denial_claims + r.governs_evidence]));
  const active = rules.filter((r) => r.retired !== true);
  const unusedIds: string[] = [];
  let top: { ruleId: string; total: number } | null = null;
  let firedCount = 0;
  const unusedByType = new Map<SteeringType, number>();
  for (const r of active) {
    const total = evidence.get(r.id) ?? 0;
    if (total === 0) {
      unusedIds.push(r.id);
      const t = steeringTypeOf(r);
      unusedByType.set(t, (unusedByType.get(t) ?? 0) + 1);
    } else {
      firedCount += 1;
      if (top === null || total > top.total) top = { ruleId: r.id, total };
    }
  }
  let unusedHomeType: SteeringType | null = null;
  let best = 0;
  for (const [t, n] of unusedByType) {
    if (n > best) { best = n; unusedHomeType = t; }
  }
  return { unusedIds, topFired: top, firedCount, unusedHomeType };
}
