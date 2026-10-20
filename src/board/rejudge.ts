/**
 * Re-running the judge of a gate no judge could rule on (crew api-types 0.134.0, wicked-core
 * `rejudge`). The engine parks a unit at a `judge_unavailable` escalation when every eligible judge
 * seat failed as a seat (signed out, out of quota, its image would not build). That gate has three
 * different ways forward, and the card must say which is which:
 *
 *  - **Re-run the judge** (`{approve: true, action: 'rejudge'}`): a judge drawn again by the engine's
 *    own selection checks the same work. The step does not run again, and the result goes through the
 *    ordinary gate, so a REJECT, a failed floor or another seatless judge stops here again. Offered
 *    only when crew's gate read says a judge seat is eligible now (`GateInfo.rejudge.available`).
 *  - **Approve as your own judgment** (a plain approve): the OPERATOR judges the work as it stands. It
 *    counts, and the gate and the delivery say "judged by operator". No independent check runs.
 *  - **Send back** / **Stop**: as on any review gate.
 *
 * Studio pins an older `wicked-crew-api-types`, so the offer's shape is typed here and read null-safe.
 */

/** One run seat that cannot judge the work now, and why (the engine's words). */
export interface RejudgeMissingSeat {
  seat: string;
  reason: string;
}

/** `GET /runs/:id/gate`'s `rejudge` (api-types 0.134.0). */
export interface RejudgeOffer {
  available: boolean;
  eligible: string[];
  missing: RejudgeMissingSeat[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The offer off a gate read, or `null` when it carries none (another gate, an older daemon). */
export function rejudgeOfferOf(info: unknown): RejudgeOffer | null {
  const raw = isRecord(info) ? info['rejudge'] : undefined;
  if (!isRecord(raw) || typeof raw['available'] !== 'boolean') return null;
  const eligible = Array.isArray(raw['eligible']) ? raw['eligible'].filter((s): s is string => typeof s === 'string' && s !== '') : [];
  const missing = Array.isArray(raw['missing'])
    ? raw['missing'].flatMap((m) => (isRecord(m) && typeof m['seat'] === 'string' && typeof m['reason'] === 'string' ? [{ seat: m['seat'], reason: m['reason'] }] : []))
    : [];
  return { available: raw['available'] && eligible.length > 0, eligible, missing };
}

/** The wire action of the re-run. */
export const REJUDGE_ACTION = 'rejudge';
export const REJUDGE_LABEL = 'Re-run the judge';
export function rejudgeTitle(offer: RejudgeOffer, name: (seat: string) => string = (s) => s): string {
  const who = offer.eligible.map(name).join(', ');
  return `Have ${who === '' ? 'an eligible helper' : who} check the work as it stands. The step does not run again; if the check fails, the step stops here again.`;
}

/** At a judge-unavailable gate a plain approve IS the operator's judgment (wicked-core `judge_by_operator`). */
export const OPERATOR_JUDGMENT_LABEL = 'Approve as your own judgment';
export const OPERATOR_JUDGMENT_TITLE =
  'You judge the work as it stands: it counts, and this gate and the delivery say "judged by operator". No independent check runs.';

/** "pi (benched for this run: quota exhausted)" — the seats that cannot judge, for the card's line. */
export function missingSeatsLine(offer: RejudgeOffer, name: (seat: string) => string = (s) => s): string {
  return offer.missing.map((m) => `${name(m.seat)} (${m.reason})`).join('; ');
}
