/**
 * Plan refusals in the operator's words (studio#665, wicked-core#854 / #846). The engine's refusal
 * text is `<token>: <detail>` (`PlanRefusal` Display; the token is api-types' `PlanRefusalToken`),
 * carried verbatim on `wicked.team.plan.refused.reason`, on a launch / preview error, and inside
 * the `error` frame of a run the refusal FAILS mid-run (a held testing rule fired by the diff
 * re-score). The token is matched, never the prose; a token this table does not word returns
 * `null` and the caller shows the engine's text.
 */

const TOKEN = /\b(security_review_on_non_code_plan|writes_nothing_on_code)\b/;

/** The held rule a refusal names (`… (rule TST-1002 requires it) …`), or null. */
export function refusingRule(reason: string): string | null {
  return /\brule ([A-Za-z0-9_.:-]+) requires it\b/.exec(reason)?.[1] ?? null;
}

/** The operator-facing sentence for a refusal whose token this table knows, else `null`. */
export function planRefusalWords(reason: string): string | null {
  const token = TOKEN.exec(reason)?.[1];
  if (token === 'security_review_on_non_code_plan') {
    const rule = refusingRule(reason);
    return `a security review was asked for on a run that writes no code${rule !== null ? ` (rule ${rule} requires it)` : ''} — its code-evidence check could never pass`;
  }
  if (token === 'writes_nothing_on_code') {
    return 'a step marked “writes nothing” is on a phase that changes code';
  }
  return null;
}
