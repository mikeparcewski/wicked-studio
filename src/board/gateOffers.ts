/**
 * The actions the ENGINE's gate lists, read off the gate's own options text (studio#1102).
 *
 * `wicked-crew-api-types` 0.205.0 has no complete action-list field on a gate (only `choices`, `rejudge`
 * and `skipQe`), so the prompt's options clause is the one place the engine names an arm like
 * ``action `operator_judgment` ``. A card offers an arm because the gate's list names it, never because
 * of the wording around it: the engine may rephrase an option's explanation (a lift changes the retry
 * sentence) without the arm going away.
 *
 * The options are the engine's LAST options clause: the quoted refusal comes first and can itself quote
 * an options clause, so only text after the last start marker counts, and a clause quoted inside a
 * failure is therefore never an offer.
 */

import type { GateInfo } from '../api/types.js';

const ACTION = /\(action\s+`([a-z_]+)`/g;

/** The action names the engine lists in the options that begin at the LAST occurrence of `optionsStart`. */
export function enginePromptActions(prompt: string | undefined, optionsStart: string): string[] {
  if (prompt === undefined) return [];
  const at = prompt.lastIndexOf(optionsStart);
  if (at < 0) return [];
  const found: string[] = [];
  for (const m of prompt.slice(at).matchAll(ACTION)) {
    if (m[1] !== undefined && !found.includes(m[1])) found.push(m[1]);
  }
  return found;
}

/** One answer the gate lists, by its wire token: `approve`, `reject`, or a `GateDecision.action`
 *  (`operator_judgment`, `skip_qe`, `rejudge`, `request_changes`). Wording, consequence and the rationale
 *  box belong to the card that draws it (`offerChoice`); WHICH answers exist belongs here. */
export interface GateOffer {
  action: string;
}

export const OFFER_APPROVE = 'approve';
export const OFFER_REJECT = 'reject';
/** A free-text gate's one answer: the operator's words. */
export const OFFER_ANSWER = 'answer';

/** Where a refused hand-over's options begin (wicked-core `deliver_refusal_prompt`). */
const REFUSAL_OPTIONS_START = 'Approve to re-run the deliver phase now';

/**
 * The answers a REFUSED HAND-OVER lists, in the engine's order: approve (re-run the deliver phase), every
 * `(action ...)` arm its options name, reject. The named arms are read from the engine's last options clause.
 * Approve and reject are the engine's two arms on every refused hand-over (studio#403: approve re-runs, reject
 * cancels), so they never depend on how the options are worded and the row is never left without Stop.
 */
export function refusalOffers(gate: { prompt: string | undefined } & GateOfferSource): GateOffer[] {
  const actions = enginePromptActions(gate.prompt, REFUSAL_OPTIONS_START).filter((a) => a !== OFFER_APPROVE && a !== OFFER_REJECT);
  const offers: GateOffer[] = [{ action: OFFER_APPROVE }, ...actions.map((action) => ({ action })), { action: OFFER_REJECT }];
  return withSkipQe(offers, gate.skipQe);
}

/** The slice of a gate read that names answers beyond the plain pair (api-types `GateInfo`). */
export interface GateOfferSource {
  /** `GateInfo.choices`, plus `null`: studio's own free-text marker on `OpenGate` (api-types has no such value). */
  choices?: GateInfo['choices'] | null | undefined;
  skipQe?: GateInfo['skipQe'] | null | undefined;
}

/**
 * The answers a plain gate lists: EVERY token its payload's `choices` names (`undefined` = the two the daemon always accepts), plus
 * the in-place QE skip when crew's gate read carries `skipQe` (api-types 0.146.0), before the closing reject.
 */
export function gateOffers(gate: GateOfferSource): GateOffer[] {
  // `null` is the free-text contract (the answer is words, not approve or reject): never given a default pair.
  if (gate.choices === null) return [{ action: OFFER_ANSWER }];
  const listed = gate.choices ?? [OFFER_APPROVE, OFFER_REJECT];
  const offers: GateOffer[] = [...new Set(listed)].map((action) => ({ action }));
  return withSkipQe(offers, gate.skipQe);
}

/** crew's in-place QE skip (api-types 0.146.0 `GateInfo.skipQe`), listed before the closing reject. */
function withSkipQe(offers: GateOffer[], skipQe: GateOfferSource['skipQe']): GateOffer[] {
  if (skipQe === undefined || skipQe === null || offers.some((o) => o.action === skipQe.action)) return offers;
  const at = offers.findIndex((o) => o.action === OFFER_REJECT);
  return [...offers.slice(0, at < 0 ? offers.length : at), { action: skipQe.action }, ...offers.slice(at < 0 ? offers.length : at)];
}

/** The offers as the wire tokens they would send, for comparison. */
export const offerActions = (offers: readonly GateOffer[]): string[] => offers.map((o) => o.action);

export const OFFER_REQUEST_CHANGES = 'request_changes';

/** The wire token a decision sends: its `action`, else approve / reject. */
export function decisionAction(d: { approve?: boolean; action?: string } | null | undefined): string | null {
  if (d === null || d === undefined) return null;
  return d.action ?? (d.approve === true ? OFFER_APPROVE : OFFER_REJECT);
}

/**
 * The answers a session row's gate lists: its payload's `choices` (else the plain pair), `request_changes` only
 * where the engine accepts it (a creator at or before the gate: it refuses it otherwise, studio#627), and every
 * action the engine names for THIS gate — what the adapters read off its prompt and its structured offers
 * (`retry_qe`, `rejudge`, `operator_judgment`, `skip_qe`, the escalation arms). A row draws an answer only if it
 * is in this list, so its template can no longer put one on a gate that does not list it.
 */
export function rowOffers(gate: GateOfferSource, sendBack: boolean, named: readonly string[]): GateOffer[] {
  const base = gate.choices === undefined || gate.choices === null
    ? [OFFER_APPROVE, ...(sendBack ? [OFFER_REQUEST_CHANGES] : []), OFFER_REJECT]
    : gate.choices.filter((v) => v !== OFFER_REQUEST_CHANGES || sendBack);
  return withSkipQe([...new Set([...base, ...named])].map((action) => ({ action })), gate.skipQe);
}
