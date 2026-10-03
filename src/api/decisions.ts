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
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * Hand-mirrored from crew api-types 0.80.0 / 0.84.0 because studio's installed
 * `wicked-crew-api-types` predates them — delete these declarations and re-export from the
 * contract package when studio bumps to it (the `./demo.ts` precedent).
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';
import type { SteeringType } from './steering.js';

export type DecisionType = 'rule' | 'correction' | 'scope' | 'exception' | 'choice' | 'confirmation' | 'none';
export type DecisionHost = 'studio-chat' | 'gate' | 'elicitation' | 'inject' | 'capture' | 'claude-code';
/** The deterministic templates (`derive.ts`). Only `T1-always` and `T2-never` can auto-remember. */
export type DecisionTemplateId = 'T1-always' | 'T2-never' | 'T3-before' | 'T4-prefer' | 'T5-must' | 'T6-only' | 'in-your-words';
/** How the derivation routed a decision (§4.4): the first that applies wins. */
export type DecisionRoute = 'ledger' | 'offer' | 'auto' | 'restated' | 'maybe-restated' | 'conflict';
/** The latest outcome of a decision. `recorded` = no outcome yet (ledger-only, or still landing). */
export type DecisionState = 'recorded' | 'offered' | 'remembered' | 'undone' | 'dismissed' | 'restated' | 'widened' | 'landing_failed';
export type DecisionDismissReason = 'not-a-rule' | 'one-off' | 'wrong-type' | 'wrong-scope' | 'not-the-same' | 'undone';
/** `WICKED_DECISIONS`: `off` records nothing; `ledger` records and labels (no chips, no auto); `on` offers and auto-remembers. */
export type DecisionsMode = 'off' | 'ledger' | 'on';

export interface DecisionView {
  id: string;
  /** Epoch ms the words were recorded. */
  at: number;
  project_id: string | null;
  host: DecisionHost;
  origin: {
    actor: { id: string; kind: 'human'; trust: string };
    auth_mode: 'off' | 'required';
    run_id?: string;
    ord?: number;
    gate_id?: string;
    elicitation_id?: string;
    chat_id?: string;
    turn_id?: string;
    /** The verbatim words (masked where a secret was found; then `redacted: true`). */
    words: string;
    /** A bare gate approve/reject or a picked elicitation option, when there were no words. */
    choice?: string;
    words_source: 'typed' | 'operator-files' | 'cli-transcript';
    redacted: boolean;
  };
  /** The derived rule: the statement crew would remember, never the model's paraphrase. */
  derived: {
    statement: string | null;
    polarity: 'do' | 'dont' | null;
    key: string | null;
    scope: 'project' | 'everywhere';
    steering_type: SteeringType;
    template: DecisionTemplateId | null;
    exclusions: string[];
  };
  route: DecisionRoute;
  state: DecisionState;
  /** How it was remembered (present once `remembered`). */
  how?: 'auto' | 'chip' | 'needs-you';
  proposal_id?: string;
  rule_id?: string;
  /** The in-force rule this restates (`restated`) or contradicts (`conflict`). */
  restates_rule_id?: string;
  conflicts_rule_id?: string;
  /** Edits the operator made at Remember; ORIGIN keeps the original words. */
  edits?: { statement?: string; scope?: 'project' | 'everywhere'; steering_type?: SteeringType };
  /** The loud reason a landing failed (`landing_failed`). */
  error?: string;
  /** B8: the same rule decided in ≥ 2 projects — "Make it apply everywhere". */
  widen?: { projects: string[] };
}

export interface ListDecisionsResponse {
  decisions: DecisionView[];
  mode: DecisionsMode;
}

export interface RememberDecisionBody {
  scope?: 'project' | 'everywhere';
  steering_type?: SteeringType;
  statement?: string;
}

export interface RememberDecisionResponse {
  rule_id: string;
  proposal_id: string;
  project?: string;
}

/** `/ws`: the decisions recorded from ONE chat turn's operator message (DC-S4b). */
export interface ChatDecisionsFrame {
  type: 'chatDecisions';
  chat: string;
  turn_id: string;
  items: DecisionView[];
  project_id?: string;
}

/** `/ws`: a decision's state changed (ids only, no words). */
export interface DecisionChangedFrame {
  type: 'decisionChanged';
  id: string;
  state: DecisionState;
  rule_id?: string;
  project_id: string | null;
}

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

/** The Rules page address of one landed rule (the policies grid opens it by `?rule=`). */
export function rulePath(ruleId: string): string {
  return `/steering/policies?rule=${encodeURIComponent(ruleId)}`;
}
