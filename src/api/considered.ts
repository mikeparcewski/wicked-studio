/**
 * "Considered · set aside · cited (unchecked)" (DES-DECISION-CAPTURE §4.7, slice DC-S7; crew
 * api-types 0.85.0): what the seats were GIVEN to consider for one chat turn or one run step, what
 * was set aside, and what they cited.
 *
 *   GET /chats/:id/turns/:turnId/considered            → Consideration   (operator+; 404: no such turn)
 *   GET /runs/:id/units/:unitKey/considered?attempt=   → Consideration   (operator+; 404: no such unit)
 *
 * The words the operator sees are DC §3 B10: "2 of your rules considered · 1 set aside · cited 1
 * (unchecked)". A CITED rule is "cited by the step — unchecked": the step wrote `[rule:<id>]` and the
 * id is in force here; whether it kept to the rule is not checked by anything (DES-rule-check will
 * say). A compliance verdict is therefore never shown (B4), and a citation is never summed into a
 * kept-to count. An invented or out-of-scope id is an `unverified` citation.
 *
 * `source` says how the in-force set was read: the engine's project-aware `considerRules`, the
 * global rules alone on an engine without it (`global-only`), or no read at all (`unavailable`).
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * Hand-mirrored from crew api-types 0.85.0 because studio's installed `wicked-crew-api-types`
 * predates it — delete these declarations and re-export from the contract package when studio
 * bumps to it (the `./decisions.ts` precedent).
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
import type { SteeringType } from './steering.js';

export type ConsiderationSeverity = 'info' | 'warn' | 'error' | 'critical';

export interface ConsiderationRule {
  id: string;
  statement: string;
  severity: ConsiderationSeverity;
  steering_type?: SteeringType;
  /** Present on a project-scoped rule. */
  project?: string;
}

export type SetAsideReason = 'out_of_scope' | 'replaced' | 'retired' | 'not_confirmed';

export interface ConsiderationSetAside {
  id: string;
  statement: string;
  /** The engine's reasons, plus crew's `not_confirmed`: a decision offered for this project, not yet remembered. */
  reason: SetAsideReason;
}

export interface ConsiderationCitation {
  id: string;
  /** The seat (`cliKey`) or the unit id that wrote it. */
  by: string;
  /** `unchecked` = in force and cited — not checked for compliance; `unverified` = not an in-force rule here. */
  status: 'unchecked' | 'unverified';
  label: string;
}

export type ConsiderationSubject =
  | { kind: 'chat'; chat_id: string; turn_id: string }
  | { kind: 'unit'; run_id: string; ord: number; attempt: number };

export interface Consideration {
  subject: ConsiderationSubject;
  /** `considered:<chat>:<turn>` or `considered:<run>:<ord>:<attempt>` — the bus fact's idempotency key. */
  key: string;
  project_id: string | null;
  /** Severity-ordered (critical → info). */
  considered: ConsiderationRule[];
  set_aside: ConsiderationSetAside[];
  cited: ConsiderationCitation[];
  source: 'considerRules' | 'global-only' | 'unavailable';
}

const enc = (s: string): string => encodeURIComponent(s);

export const consideredApi = {
  turn: (chatId: string, turnId: string) =>
    apiFetch<Consideration>(`/chats/${enc(chatId)}/turns/${enc(turnId)}/considered`),
  unit: (runId: string, ord: number, attempt = 0) =>
    apiFetch<Consideration>(`/runs/${enc(runId)}/units/${enc(String(ord))}/considered?attempt=${attempt}`),
};

/** The store's key for a turn's or a unit's Consideration (the same shape as crew's fact key). */
export function turnConsideredKey(chatId: string, turnId: string): string {
  return `considered:${chatId}:${turnId}`;
}
export function unitConsideredKey(runId: string, ord: number, attempt = 0): string {
  return `considered:${runId}:${ord}:${attempt}`;
}

/** A daemon before DC-S7 has no `/considered` (Fastify 404 / 501): the lines draw nothing. */
export function isConsideredUnsupported(e: unknown): boolean {
  return isRouteUnsupported(e);
}
