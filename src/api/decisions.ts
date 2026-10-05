/**
 * Decision capture's wire (DES-DECISION-CAPTURE §4.6, slices DC-S4a / DC-S4b; crew api-types
 * 0.80.0 and 0.84.0): what the operator decided in their own words, derived into a rule crew can
 * remember, and the one landing path for remembering, undoing, dismissing, widening and
 * "same as my rule".
 *
 *   GET  /decisions?project=&chat=&run=&state=&since=   → { decisions: DecisionView[], mode }
 *   POST /decisions/:id/remember   { scope?, steering_type?, statement? } → { rule_id, proposal_id }
 *   POST /decisions/:id/undo        → { ok }      (the rule is RETIRED, never deleted)
 *   POST /decisions/:id/dismiss     { reason } → { ok }
 *   POST /decisions/:id/widen       → { rule_id }  (one project-less successor supersedes the same rule everywhere)
 *   POST /decisions/:id/same        { same } → resolves a `maybe-restated` decision
 *
 * /ws: `chatDecisions { chat, turn_id, items }` (the decisions recorded from ONE operator turn, once
 * every seat answered) and `decisionChanged { id, state, rule_id?, project_id }` (ids only — words
 * are never on the bus). The transcript (`GET /chats/:id`) carries the same items as a `decisions`
 * record folded onto the turn's `user` record, so a reload restores every line.
 *
 * ORIGIN (`origin.words`) comes ONLY from crew's ledger through these views: a proposal payload
 * carries just the decision id, so a forged payload has no words to show (§4.2.4).
 *
 * ── CONTRACT ───────────────────────────────────────────────────────────────────────────────────
 * Types come from `wicked-crew-api-types` (pin 0.92.0, ASK-S1); the hand-mirrored copies that lived
 * here while the pin lagged are gone.
 * `DecisionsMode`, `DecisionsFilter` and `ChatDecisionsRecord` below are studio's own readings.
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
/** `WICKED_DECISIONS`: `off` records nothing; `ledger` records and labels (no chips, no auto); `on` offers and auto-remembers. */
import type { DecisionType, DecisionHost, DecisionTemplateId, DecisionRoute, DecisionState, DecisionDismissReason, DecisionView, ListDecisionsResponse, RememberDecisionBody, RememberDecisionResponse, ChatDecisionsFrame, DecisionChangedFrame } from 'wicked-crew-api-types';
export type { DecisionType, DecisionHost, DecisionTemplateId, DecisionRoute, DecisionState, DecisionDismissReason, DecisionView, ListDecisionsResponse, RememberDecisionBody, RememberDecisionResponse, ChatDecisionsFrame, DecisionChangedFrame };

export type DecisionsMode = 'off' | 'ledger' | 'on';

/** The transcript record a reader folds onto the turn's `user` record (api-types 0.84.0). */
export interface ChatDecisionsRecord {
  at: number;
  turnId: string;
  kind: 'decisions';
  items: DecisionView[];
}

export interface DecisionsFilter {
  project?: string;
  chat?: string;
  run?: string;
  state?: DecisionState;
  /** Epoch ms: only decisions recorded at or after it. */
  since?: number;
}

function query(f: DecisionsFilter): string {
  const q = new URLSearchParams();
  if (f.project !== undefined) q.set('project', f.project);
  if (f.chat !== undefined) q.set('chat', f.chat);
  if (f.run !== undefined) q.set('run', f.run);
  if (f.state !== undefined) q.set('state', f.state);
  if (f.since !== undefined) q.set('since', String(f.since));
  const s = q.toString();
  return s === '' ? '' : `?${s}`;
}

const j = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const id = (d: string): string => encodeURIComponent(d);

export const decisionsApi = {
  list: (f: DecisionsFilter = {}) => apiFetch<ListDecisionsResponse>(`/decisions${query(f)}`),
  remember: (d: string, body: RememberDecisionBody = {}) => apiFetch<RememberDecisionResponse>(`/decisions/${id(d)}/remember`, j(body)),
  undo: (d: string) => apiFetch<{ ok: boolean }>(`/decisions/${id(d)}/undo`, { method: 'POST' }),
  dismiss: (d: string, reason: DecisionDismissReason) => apiFetch<{ ok: boolean }>(`/decisions/${id(d)}/dismiss`, j({ reason })),
  widen: (d: string) => apiFetch<{ rule_id: string }>(`/decisions/${id(d)}/widen`, { method: 'POST' }),
  same: (d: string, same: boolean) => apiFetch<{ ok?: boolean }>(`/decisions/${id(d)}/same`, j({ same })),
};

/** A daemon before DC-S4a has no `/decisions` (404 / 501): the capture surfaces draw nothing. */
export function isDecisionsUnsupported(e: unknown): boolean {
  return isRouteUnsupported(e);
}

/** The Rules page (`/rules`, DES-STUDIO-REBUILD-001 §5.4, slice S12) — the Desk face of the rules. */
export const RULES_PATH = '/rules';

/** The Rules page address of one landed rule — `/rules/:ruleId`, the rule open on the page (S12).
 *  The steering grid still deep-links the same rule by `/steering/policies?rule=`. */
export function rulePath(ruleId: string): string {
  return `${RULES_PATH}/${encodeURIComponent(ruleId)}`;
}
