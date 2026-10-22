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

/** Whether the engine offers the override at this gate: its prompt names the arm. */
export function offersFloorOverride(prompt: string | undefined): boolean {
  return prompt !== undefined && /\baction `operator_judgment`/.test(prompt);
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
