/**
 * "Approve as your own judgment" at a FAILED REPO-CHECKS FLOOR's gate (crew api-types 0.135.0,
 * wicked-core `operator_judgment`, operator ruling 2026-10-21).
 *
 * When a step's repository checks fail and the evidence shows the failures are not the work's (load
 * flakes in files it never touched, reds the floor misread), Send back and Retry only loop: the same
 * floor fails the same way. The operator's way on is the judgment a judge-unavailable gate already
 * takes, recorded the same way, behind its own wire action because a plain approve at a floor gate
 * is a retry: `{approve: true, action: 'operator_judgment', amend: <rationale>}`.
 *
 *  - The rationale is required: the box opens empty and Send stays off until it holds words; crew
 *    refuses a blank one (400) and the engine again.
 *  - The consequence is said first, before the box: it overrides the failed floor; it is recorded on
 *    the run and the delivery ("floor overridden by operator"); QE acceptance is still required.
 *  - Offered only where the engine's prompt names the arm (action `operator_judgment`): the engine
 *    writes that clause exactly where it would take the answer (a repo-checks floor on an agent step,
 *    no other layer of the gate denying), so the card never offers a choice the daemon refuses.
 *
 * Studio pins an older `wicked-crew-api-types`, so the wire shapes are typed here and read null-safe.
 */

import { enginePromptActions } from './gateOffers.js';

export const FLOOR_OVERRIDE_ACTION = 'operator_judgment';
/** The choice key on the gate row. */
export const FLOOR_OVERRIDE_KEY = 'operator-judgment';
/** The consequence, said before the rationale box and as the choice's hover — first, in these words. */
export const FLOOR_OVERRIDE_CONSEQUENCE = 'Overrides the failed floor; recorded on the run and delivery; QE acceptance still required.';
export const FLOOR_OVERRIDE_TITLE = `${FLOOR_OVERRIDE_CONSEQUENCE} Write why the failed checks are not this work's; the step does not run again.`;
export const FLOOR_OVERRIDE_PLACEHOLDER = "Why the failed checks are not this work's (load flakes in untouched files, failures the base shares)…";
export const FLOOR_OVERRIDE_SEND = 'Approve with this rationale';
/** The engine's label, as every surface shows it. */
export const FLOOR_OVERRIDDEN_LABEL = 'Floor overridden by operator';

/** The engine's offer clause (wicked-core `floor_override_offer`), verbatim. */
const OFFER_CLAUSE = 'judge it yourself with a written rationale when the evidence shows the failures are not the work\'s '
  + '(action `operator_judgment`: it overrides the failed floor, labelled "floor overridden by operator" on the run and the '
  + 'delivery; every other layer still denies and QE acceptance is still required),';
/** The engine's closing option: every escalation prompt ends its options with it, AFTER the quoted
 *  failure text (`reason_head`), so its LAST occurrence is the engine's own. */
const CLOSER = 'or reject to cancel the run';
const ws = (t: string): string => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
/** The offer only counts as the engine's options, immediately before the engine's own closer. */
const OFFER_AT_CLOSER = new RegExp(`${ws(OFFER_CLAUSE)}\\s*${ws(CLOSER)}$`);

/** What the offer is corroborated by: the gate's own verdict (`gateVerdictFor`), null-safe. */
export interface FloorOverrideEvidence {
  ord?: number | null;
  outcome?: string;
  denial?: { source?: string | null; reason?: string | null } | null;
}

/** Whether the engine offers the override at THIS gate. Both must hold:
 *  - the gate's own verdict is a failed repo-checks floor for this gate's ord (the only gate the
 *    engine takes the arm at), and
 *  - the engine's clause sits right before the engine's LAST "or reject to cancel the run": the quoted
 *    failure text comes before the engine's options and is cut to its first line (240 chars), so text
 *    stripping cannot isolate it, but position can (studio#869 reviews). */
export function offersFloorOverride(prompt: string | undefined, verdict?: FloorOverrideEvidence | null, gateOrd?: number): boolean {
  if (prompt === undefined) return false;
  if (verdict === undefined || verdict === null || typeof gateOrd !== 'number' || verdict.ord !== gateOrd || verdict.outcome !== 'fail') return false;
  const source = verdict.denial?.source;
  if (source !== 'repo_checks' && source !== 'repo_checks_timeout') return false;
  const last = prompt.lastIndexOf(CLOSER);
  return last >= 0 && OFFER_AT_CLOSER.test(prompt.slice(0, last + CLOSER.length));
}

/** The engine's words when a red base cannot be told apart from the change (wicked-core `base_red_unseparated`):
 *  retrying or fixing loops on failures the change did not cause, so the override is the way through. */
const OVERRIDE_IS_THE_PATH = "the operator's floor override is the path through";

/** Whether the engine names the override as THE way through this failed floor: a check it classed
 *  `base_red_unseparated`, or its own words saying so. The card then suggests the override, never a retry
 *  or a fix (rig 0.15.8: "Retry this step with a note" was marked suggested over exactly that).
 *  A floor that also holds a known regression is never suggested away — the override would override the
 *  regression too (pr-xreview on studio#899). */
export function engineNamesFloorOverride(
  verdict: { floor?: { checks: readonly { classification: string | null; regressions: readonly string[]; exitCode: number | null }[] } | null; denial?: { reason?: string | null } | null } | null | undefined,
  summary?: string | null,
): boolean {
  const floor = verdict?.floor;
  if (floor !== null && floor !== undefined && floor.checks.length > 0) {
    if (floor.checks.some((c) => c.classification === 'regression' || c.regressions.length > 0)) return false;
    return floor.checks.some((c) => c.classification === 'base_red_unseparated');
  }
  // No floor record in hand: the engine's own words, unless they also name a regression.
  return [summary, verdict?.denial?.reason].some((t) => typeof t === 'string' && t.includes(OVERRIDE_IS_THE_PATH) && !/\[regression\b/.test(t));
}

/** Where the engine's deliver refusal options begin (wicked-core `deliver_refusal_prompt`). They follow the
 *  quoted refusal, so their LAST occurrence is the engine's own. */
const DELIVER_OPTIONS_START = 'Approve to re-run the deliver phase now';

/** Whether the gate's own action list (the engine's options at a REFUSED HAND-OVER: the deliver phase's
 *  re-verify failed on the tree it would ship) names the operator's judgment. Read from the list, not from
 *  the wording around the arm (studio#1102: an after-lift prompt words the retry differently). There is no
 *  repo-checks gate verdict there (the deliver unit's denial is `deliver_refusal`), so position
 *  corroborates: only the engine's last options count, never a clause quoted inside the refusal. The
 *  engine refuses an answer it does not take (409, gate left open). */
export function offersDeliverFloorOverride(prompt: string | undefined): boolean {
  return enginePromptActions(prompt, DELIVER_OPTIONS_START).includes(FLOOR_OVERRIDE_ACTION);
}

/** `OperatorJudgment.floorOverride` off the wire (api-types 0.135.0), or `null`. */
export interface FloorOverrideView {
  layer: string;
  resultId: string;
  label: string;
  /** The unit and attempt whose failed floor was overridden (the wire's `ord` / `attempt`, else read off
   *  `resultId` — `<run>:unit-<ord>:attempt-<n>:<layer>`); `null` when neither says. */
  ord: number | null;
  attempt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Where an override was made, in words (operator 2026-10-29: no raw result ids on the face): "the Fix step's checks
 * (attempt 2)". `stepOf` names a unit by its ord (the plan's word); without one, "step 2".
 */
export function overrideWhere(o: Pick<FloorOverrideView, 'ord' | 'attempt' | 'layer'>, stepOf: (ord: number) => string | null): string {
  const name = o.ord !== null ? stepOf(o.ord) : null;
  const what = o.layer === 'repo_checks' || o.layer === '' ? 'checks' : o.layer.replace(/_/g, ' ');
  const at = name !== null ? `the ${name} step’s ${what}` : o.ord !== null ? `step ${o.ord}’s ${what}` : `the ${what}`;
  return o.attempt !== null ? `${at} (attempt ${o.attempt + 1})` : at;
}

export function floorOverrideOf(v: unknown): FloorOverrideView | null {
  if (!isRecord(v)) return null;
  const label = typeof v['label'] === 'string' && v['label'].trim() !== '' ? v['label'].trim() : 'floor overridden by operator';
  const resultId = typeof v['resultId'] === 'string' ? v['resultId'] : '';
  const at = /:unit-(\d+):attempt-(\d+):/.exec(resultId);
  const int = (x: unknown, fallback: string | undefined): number | null =>
    typeof x === 'number' && Number.isInteger(x) ? x : fallback !== undefined ? Number(fallback) : null;
  return {
    layer: typeof v['layer'] === 'string' ? v['layer'] : 'repo_checks',
    resultId,
    label,
    ord: int(v['ord'], at?.[1]),
    attempt: int(v['attempt'], at?.[2]),
  };
}

/**
 * The engine's word on the timeout gate's targeted re-run (wicked-core#1392): its denial text offers
 * "re-run with the targeted tests (`<source>`)" when the floor names a targeted command, and says
 * "none is declared, so a targeted re-run is not offered" when it names none — in which case the engine
 * refuses the `targeted` answer. An older prompt says neither: `unknown`, and the card keeps the choice.
 *
 * The quoted failure text (the denial reason) is removed first; a phrase then only counts inside the options'
 * tail: the last 500 characters before the engine's last closer ("or reject to cancel the run").
 * Both phrases at once is no reading (`unknown`).
 */
export type TargetedOffer = { state: 'declared' | 'unknown' } | { state: 'unavailable'; reason: string };

const TARGETED_DECLARED = /re-run with the targeted tests\s*\(`[^`]+`\)/;
const TARGETED_NONE = /none is declared, so a targeted re-run is not offered/;
const OPTIONS_TAIL = 500;

export function targetedOfferIn(prompt: string | undefined, denialReason?: string | null): TargetedOffer {
  if (prompt === undefined) return { state: 'unknown' };
  // The quoted failure is the gate's own denial reason (first line, cut to 240 chars): take it out first, so a phrase
  // inside it can never read as the engine's option, however short the prompt.
  const head = typeof denialReason === 'string' ? (denialReason.split('\n')[0] ?? '').slice(0, 240) : '';
  const body = head !== '' ? prompt.split(head).join(' ') : prompt;
  const last = body.lastIndexOf(CLOSER);
  if (last < 0) return { state: 'unknown' };
  const tail = body.slice(Math.max(0, last + CLOSER.length - OPTIONS_TAIL), last + CLOSER.length);
  const declared = TARGETED_DECLARED.test(tail);
  const none = TARGETED_NONE.test(tail);
  if (declared === none) return { state: 'unknown' };
  return declared
    ? { state: 'declared' }
    : { state: 'unavailable', reason: 'No targeted test command is declared for this repository, so the engine does not offer a targeted re-run.' };
}
