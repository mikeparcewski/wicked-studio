/**
 * Plan refusals in the operator's words (studio#665, wicked-core#854 / #846). The engine's refusal
 * text is `<token>: <detail>` (`PlanRefusal` Display; the token is api-types' `PlanRefusalToken`),
 * carried verbatim on `wicked.team.plan.refused.reason`, on a launch / preview error, and inside
 * the `error` frame of a run the refusal FAILS mid-run (a held testing rule fired by the diff
 * re-score). The token is matched, never the prose; a token this table does not word returns
 * `null` and the caller shows the engine's text.
 */

/** The tokens this table words. */
const WORDED = new Set(['security_review_on_non_code_plan', 'writes_nothing_on_code']);

/**
 * The refusal token as the engine writes it: the FIRST `snake_case` segment of the `: `-joined
 * text that a detail follows. Context prefixes have spaces (`the plan is refused`, `run r1`) and
 * are skipped; the first token-shaped segment is the refusal's own, so a token-shaped step id
 * inside another refusal's detail (`unknown_catalog_entry: step inspect: writes_nothing_on_code: …`)
 * never matches.
 */
function leadingToken(text: string): string | null {
  const segs = text.split(': ');
  // The token always has a detail after it (`<token>: <detail>`): a token-shaped LAST segment is a
  // name (`unknown project: writes_nothing_on_code`), never a refusal.
  for (const seg of segs.slice(0, -1)) {
    const t = seg.trim();
    if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t)) return t;
  }
  return null;
}

/** The held rule a refusal names (`… (rule TST-1002 requires it) …`), or null. */
export function refusingRule(reason: string): string | null {
  return /\brule ([A-Za-z0-9_.:-]+) requires it\b/.exec(reason)?.[1] ?? null;
}

/** The operator-facing sentence for a refusal whose token this table knows, else `null`. */
export function planRefusalWords(reason: string): string | null {
  const lead = leadingToken(reason);
  const token = lead !== null && WORDED.has(lead) ? lead : null;
  if (token === 'security_review_on_non_code_plan') {
    const rule = refusingRule(reason);
    return `a security review was asked for on a run that writes no code${rule !== null ? ` (rule ${rule} requires it)` : ''} — its code-evidence check could never pass`;
  }
  if (token === 'writes_nothing_on_code') {
    return 'a step marked “writes nothing” is on a phase that changes code';
  }
  return null;
}
