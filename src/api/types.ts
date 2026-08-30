/**
 * Boundary types for the wicked-crew daemon's `/api/v1` JSON surface + the
 * verbatim CoreEvent WS frames.
 *
 * The studio is a separate package with no dependency on the daemon; it speaks
 * daemon-owned shapes over REST/WS. Those shapes are now defined ONCE, in the
 * shared contract package `wicked-crew-api-types`, which the daemon's route
 * layer compiles against too — this module is a pure re-export so the studio's
 * many `./types.js` importers keep working while the hand-copied mirror that
 * used to live here (and could drift from the daemon silently) is gone
 * (task #84). Optional/index-signature fields keep the shapes forward-additive
 * (DES-STUDIO-001 §5.1); no `any` at the boundary.
 */

import type { AgentSession } from 'wicked-crew-api-types';

export type * from 'wicked-crew-api-types';


/**
 * `AgentSession.delivery` — the server-carried PR reference (CREW-UX-8,
 * wicked-crew#321), declared HERE and nowhere else because studio's installed
 * `wicked-crew-api-types` is STALE at 0.8.0 and the field ships in a later
 * version. This is the ONE hand-written shape in this module, and it is a
 * temporary one: **delete both declarations below and read `delivery` straight
 * off `AgentSession`** the moment studio bumps to the api-types version that
 * carries it.
 *
 * Read it as `session.delivery?.url` (see `src/components/delivery.ts`): the
 * field is absent on every daemon shipping today, so the surface falls back to
 * the single per-run transcript fetch and lights up — link on the project rows,
 * zero fetches in the right panel — the day the server starts sending it, with
 * no adoption work here. `kind` is the whole concession to a future second kind
 * of deliverable, and it is free.
 */
export interface SessionDelivery {
  kind: 'pull_request';
  url: string;
}

/** `AgentSession` as the post-#321 daemon sends it. See {@link SessionDelivery}. */
export type SessionWithDelivery = AgentSession & { delivery?: SessionDelivery | null };

// ── GET /runs/:id/acceptance (AW-14 / AW-18 — arch-R13a + R16) ────────────────
//
// Hand-declared, same contract as SessionDelivery above: `wicked-crew-api-types`
// does not carry the acceptance view (it is daemon-owned, `qe/acceptance.ts`),
// so studio declares the SUBSET it reads. Every field optional-or-null-tolerant
// where the daemon may predate the conformance section (crew < 0.8): a missing
// `conformance` means "older daemon", and the surface must fall back — never
// invent a guardrailed claim the wire did not make.

/** A wiki/conformance rule cited by a claim's `conform:` obligation. */
export interface AcceptanceRuleCitation {
  /** `Critical` | `Error` | `Warn` | `Info`. */
  severity: string;
  /** The conformance-rule id (`PAT-*` / `POL-*`) — the wiki rule the claim cites. */
  ruleId: string;
  statement: string;
}

/** One run-scoped governance decision, with its rule citations parsed daemon-side. */
export interface AcceptanceConformanceClaim {
  claimId: string;
  scope: string;
  phase: string;
  decision: 'allow' | 'deny' | 'allow_with_conditions';
  policyIds: string[];
  rules: AcceptanceRuleCitation[];
  obligations: string[];
  evaluator: string;
  /** Unix-seconds. */
  evaluatedAt: number;
  /** An advisory boundary-READ deny: blocked + audited, not unit-fatal. */
  advisory: boolean;
}

/** What the run's durable event log proved about governance being IN FORCE. */
export interface AcceptanceEnforcement {
  status: 'enforced' | 'unenforced' | 'ungoverned' | 'unverifiable';
  unenforced: { ord: number; attempt: number; cli: string; reason: string }[];
  armedUnits: number[];
  reason: string;
}

/** The conformance half of the acceptance view — served beside the QE gate. */
export interface AcceptanceConformance {
  claimsAvailable: boolean;
  claimsError?: string;
  claims: AcceptanceConformanceClaim[];
  denials: number;
  advisoryDenials: number;
  denied: boolean;
  enforcement: AcceptanceEnforcement;
  /** True ONLY when claims were readable, undenied, and enforcement verified. */
  guardrailed: boolean;
  summary: string;
}

/** The QE acceptance gate's deny-dominates resolution (unchanged wire, Phase 6a). */
export interface AcceptanceGate {
  required: boolean;
  satisfied: boolean;
  verdict: string | null;
  runStatus: string | null;
  reason: string;
}

/** The subset of `GET /runs/:id/acceptance` studio reads. */
export interface RunAcceptanceView {
  runId: string;
  gate: AcceptanceGate;
  /** Absent on daemons older than the conformance section (crew < 0.8). */
  conformance?: AcceptanceConformance;
}
