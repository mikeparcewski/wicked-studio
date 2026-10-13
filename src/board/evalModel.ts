import { STEERING_TYPES, STEERING_TYPE_LABELS, type SteeringType } from '../api/steering.js';
import type { EvalResult, EvalSummary } from '../api/testing.js';

/**
 * The Evaluate surface's folds (DES-steer-eval §3). Pure, over crew's eval report — the live
 * `POST /testing/evals/run` answer or a persisted `GET /testing/evals/:id` run, which carry the
 * same `results` rows (TESTING.md § The wire contract). Nothing here re-judges a sample: the
 * verdict is the engine's.
 */

export type Verdict = EvalResult['verdict'];

export interface TypeCoverage {
  type: SteeringType;
  total: number;
  /** The engine's "caught": `blocked` + `passed`. */
  caught: number;
  /** BAD samples a rule blocked — the protection figure. */
  blocked: number;
  /** GOOD samples left alone — also "caught", but they say nothing about protection. */
  passed: number;
  /** BAD samples in the type (the denominator for `blocked`). */
  bad: number;
  gaps: number;
  falsePositives: number;
}

function isType(s: string): s is SteeringType {
  return (STEERING_TYPES as readonly string[]).includes(s);
}

/** Caught / gap / false positive per steering type, from the result rows; types with no samples
 *  are dropped, the rest sorted by most samples (ties in the canonical type order). */
export function coverageByType(results: readonly EvalResult[]): TypeCoverage[] {
  const rows = new Map<SteeringType, TypeCoverage>();
  for (const r of results) {
    const t = r.sample.steering_type;
    if (!isType(t)) continue;
    const row = rows.get(t) ?? { type: t, total: 0, caught: 0, blocked: 0, passed: 0, bad: 0, gaps: 0, falsePositives: 0 };
    row.total += 1;
    if (r.sample.kind === 'bad') row.bad += 1;
    if (r.verdict === 'caught') {
      row.caught += 1;
      if (r.sample.kind === 'bad') row.blocked += 1; else row.passed += 1;
    }
    else if (r.verdict === 'gap') row.gaps += 1;
    else row.falsePositives += 1;
    rows.set(t, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total || STEERING_TYPES.indexOf(a.type) - STEERING_TYPES.indexOf(b.type));
}

export interface GapGroup {
  type: SteeringType;
  gaps: EvalResult[];
}

/** The gaps to close, grouped by steering type, the biggest group first. */
export function gapsByType(results: readonly EvalResult[]): GapGroup[] {
  const groups = new Map<SteeringType, EvalResult[]>();
  for (const r of results) {
    if (r.verdict !== 'gap' || !isType(r.sample.steering_type)) continue;
    const t = r.sample.steering_type;
    groups.set(t, [...(groups.get(t) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([type, gaps]) => ({ type, gaps }))
    .sort((a, b) => b.gaps.length - a.gaps.length || STEERING_TYPES.indexOf(a.type) - STEERING_TYPES.indexOf(b.type));
}

/**
 * What the Draft rules button hands the steering assistant: one plain request naming every
 * uncovered behaviour of the type. The operator reads it in the composer and sends it (or
 * edits it) — it is never sent on their behalf.
 */
export function draftRequest(type: SteeringType, gaps: readonly EvalResult[]): string {
  const lines = gaps.map((g) => `- ${g.sample.description}`);
  return `Draft ${STEERING_TYPE_LABELS[type]} rules that would block these behaviours (each is a gap in the last eval):\n${lines.join('\n')}`;
}

/** A rule's part in the last eval, read off the result rows. */
export type RuleEvalStatus = 'caught' | 'false-positive' | 'near-gap';

export const RULE_EVAL_WORDS: Record<RuleEvalStatus, string> = {
  caught: 'caught in last eval',
  'false-positive': 'false alarm in last eval',
  'near-gap': 'nearest rule to a gap',
};

/**
 * Per rule id: fired on a false positive (the urgent one) wins over fired on a caught bad sample,
 * which wins over being a gap's nearest rule. A rule the eval never touched has no entry — it is
 * not "passing", it is untested.
 */
export function ruleEvalStatus(results: readonly EvalResult[]): Map<string, RuleEvalStatus> {
  const out = new Map<string, RuleEvalStatus>();
  const rank: Record<RuleEvalStatus, number> = { 'false-positive': 3, caught: 2, 'near-gap': 1 };
  const put = (id: string, s: RuleEvalStatus): void => {
    const cur = out.get(id);
    if (cur === undefined || rank[s] > rank[cur]) out.set(id, s);
  };
  for (const r of results) {
    if (r.verdict === 'false_positive') r.fired.forEach((id) => put(id, 'false-positive'));
    else if (r.verdict === 'caught' && r.sample.kind === 'bad') r.fired.forEach((id) => put(id, 'caught'));
    else if (r.verdict === 'gap') (r.nearest_rules ?? []).forEach((n) => put(n.rule_id, 'near-gap'));
  }
  return out;
}

/**
 * Whether a run was judged against THIS daemon's rule store. Every persisted run names the store it
 * read (`rule_store`, the engine's `--db`); the daemon names its own in `GET /diagnostics`
 * (`stores[name = core.db]`). A run against another store (a test harness's temp copy, say) did not
 * judge the rules listed on Steer, so its numbers say nothing about them. `unknown` when either side
 * is missing (a run made in this tab carries no store; an older daemon has no diagnostics).
 */
export type StoreMatch = 'daemon' | 'other' | 'unknown';

export function storeMatch(runStore: string | null | undefined, daemonStore: string | null | undefined): StoreMatch {
  if (runStore == null || runStore === '' || daemonStore == null || daemonStore === '') return 'unknown';
  return runStore === daemonStore ? 'daemon' : 'other';
}

/** How many persisted runs were judged against this daemon's store, and how many against another. */
export function historyStores(history: readonly { rule_store?: string | null }[], daemonStore: string | null): { daemon: number; other: number; unknown: number } {
  const out = { daemon: 0, other: 0, unknown: 0 };
  for (const h of history) out[storeMatch(h.rule_store, daemonStore)] += 1;
  return out;
}

/** One plain caveat the Evaluate numbers carry (DES-steer-eval §3.2): said next to the numbers, never hidden. */
export interface EvalCaveat {
  key: 'no-bad-blocked' | 'few-effects' | 'other-store' | 'history-stores';
  text: string;
}

/**
 * What the latest numbers can and cannot say, in the order an operator should read them. Pure:
 * every input is the engine's or the daemon's own answer; nothing here re-judges a sample.
 *
 *  - "caught" counts a GOOD sample left alone as well as a BAD one blocked — when no bad one was
 *    blocked, the caught figure is all pass-throughs and says nothing about protection;
 *  - only rules with an effect can gate work, so only they can catch anything;
 *  - a run judged against another rule store says nothing about the rules in force here.
 */
export function evalCaveats(input: {
  summary: Pick<EvalSummary, 'total' | 'caught'>;
  results: readonly Pick<EvalResult, 'verdict' | 'sample'>[];
  totals: { live: number; gating: number; blocks: number } | null;
  store: StoreMatch;
  history: { daemon: number; other: number; unknown: number } | null;
}): EvalCaveat[] {
  const out: EvalCaveat[] = [];
  const bad = input.results.filter((r) => r.sample.kind === 'bad');
  const blocked = bad.filter((r) => r.verdict === 'caught').length;
  const passed = input.results.filter((r) => r.verdict === 'caught' && r.sample.kind === 'good').length;
  if (input.summary.caught > 0 && blocked === 0) {
    out.push({ key: 'no-bad-blocked', text: `All ${input.summary.caught} “caught” are good behaviours left alone. None of the ${bad.length} bad behaviours was blocked.` });
  } else if (passed > 0 && blocked > 0) {
    out.push({ key: 'no-bad-blocked', text: `${blocked} of ${bad.length} bad behaviours were blocked; the other ${passed} “caught” are good behaviours left alone.` });
  }
  if (input.totals !== null && input.totals.live > 0 && input.totals.gating < input.totals.live) {
    const { live, gating, blocks } = input.totals;
    const blockWords = blocks === 0 ? `and none of them blocks, so no bad behaviour can be caught yet`
      : `and ${blocks} of them ${blocks === 1 ? 'blocks' : 'block'}`;
    out.push({ key: 'few-effects', text: `Only ${gating} of ${live} rules in force carry an effect, ${blockWords}. The other ${live - gating} are guidance: helpers read them, but an eval can't see them.` });
  }
  if (input.store === 'other') {
    out.push({ key: 'other-store', text: 'This run was judged against a different rule store, not this daemon’s, so it did not test the rules listed on Steer. Run evals here to judge them.' });
  }
  if (input.history !== null && input.history.other > 0) {
    const n = input.history.daemon + input.history.other + input.history.unknown;
    out.push({ key: 'history-stores', text: `${input.history.other} of ${n} saved runs were judged against another rule store; ${input.history.daemon} against this daemon’s.` });
  }
  return out;
}
