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

/** The engine's deliver refusal options (wicked-core `deliver_refusal_prompt`). They follow the quoted
 *  refusal, so their LAST occurrence is the engine's own. */
const DELIVER_OPTIONS = 'Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate),';
const DELIVER_OFFER = new RegExp(`^${ws(DELIVER_OPTIONS)}\\s*${ws(OFFER_CLAUSE)}\\s*${ws(CLOSER)}`);

/** Whether the engine offers the override at a REFUSED HAND-OVER (wicked-core: the deliver phase's own
 *  re-verify failed on the tree it would ship). There is no repo-checks gate verdict there (the
 *  deliver unit's denial is `deliver_refusal`), so position corroborates: the engine's clause sits
 *  right after the engine's last deliver options and right before its closer, never inside the quoted
 *  refusal. The engine refuses an answer it does not take (409, gate left open). */
export function offersDeliverFloorOverride(prompt: string | undefined): boolean {
  if (prompt === undefined) return false;
  const at = prompt.lastIndexOf('Approve to re-run the deliver phase now');
  return at >= 0 && DELIVER_OFFER.test(prompt.slice(at));
}

/** `OperatorJudgment.floorOverride` off the wire (api-types 0.135.0), or `null`. */
export interface FloorOverrideView {
  layer: string;
  resultId: string;
  label: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function floorOverrideOf(v: unknown): FloorOverrideView | null {
  if (!isRecord(v)) return null;
  const label = typeof v['label'] === 'string' && v['label'].trim() !== '' ? v['label'].trim() : 'floor overridden by operator';
  return {
    layer: typeof v['layer'] === 'string' ? v['layer'] : 'repo_checks',
    resultId: typeof v['resultId'] === 'string' ? v['resultId'] : '',
    label,
  };
}
