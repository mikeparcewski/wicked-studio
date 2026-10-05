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
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * The severity / set-aside / subject readings below are studio's own.
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

import type { ConsiderationRule, ConsiderationSetAside, ConsiderationCitation, Consideration } from 'wicked-crew-api-types';
export type { ConsiderationRule, ConsiderationSetAside, ConsiderationCitation, Consideration };

export type ConsiderationSeverity = 'info' | 'warn' | 'error' | 'critical';

export type SetAsideReason = 'out_of_scope' | 'replaced' | 'retired' | 'not_confirmed';

export type ConsiderationSubject =
  | { kind: 'chat'; chat_id: string; turn_id: string }
  | { kind: 'unit'; run_id: string; ord: number; attempt: number };

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
