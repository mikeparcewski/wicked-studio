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

import type { AgentSession, LaunchRunBody } from 'wicked-crew-api-types';

export type * from 'wicked-crew-api-types';


// ── Delivery wire (crew#393 — api-types 0.18.0) ──────────────────────────────
//
// TODO(api-types 0.18.0): studio's installed `wicked-crew-api-types` is STALE at
// 0.8.0 and every declaration in this section ships in 0.18.0. Delete this whole
// section — `RunDeliveryState`, `SessionDelivery`, `SessionWithDelivery`,
// `DeliverRunResult`, `LaunchBodyWithDeliver` — and read the fields straight off
// `AgentSession` / `LaunchRunBody` the moment studio bumps to it.

/**
 * `AgentSession.delivery` (crew#393; api-types 0.18.0) — the run's delivery
 * state, derived at DTO assembly on BOTH `GET /runs` and `GET /runs/:id`:
 *
 *  - `'delivered'` — a PR was opened for this run (by the deliver phase, or
 *    post-hoc via `POST /runs/:id/deliver`); `deliverUrl` carries the PR URL.
 *  - `'stranded'`  — a COMPLETED repo-scoped run with no recorded PR whose
 *    worktree still exists on disk: reviewable work nobody lifted.
 *  - `'none'`      — everything else: repo-less runs, non-terminal runs,
 *    failed/cancelled runs, and completed runs whose worktree is gone.
 *
 * Always present on runs served by a 0.18.0+ daemon; absent from older servers.
 *
 * ⚠ WIRE RESHAPE (0.17.0 → 0.18.0, NOT additive): 0.11.0–0.17.0 spelled the
 * field as `delivery?: { kind: 'pull_request'; url: string }`. The object form
 * is GONE — the state moved into this string and the URL into `deliverUrl`. A
 * client reading `delivery?.url` must move to `deliverUrl`. Studio's derivation
 * (`src/components/delivery.ts`) still TOLERATES the legacy object from a
 * 0.11–0.17 daemon, which is why {@link SessionDelivery} survives below.
 */
export type RunDeliveryState = 'delivered' | 'stranded' | 'none';

/** The LEGACY 0.11.0–0.17.0 object spelling of `session.delivery` (crew#321).
 *  Gone from the 0.18.0 wire; kept only so the derivation can read the url off
 *  an older daemon instead of crashing on it. */
export interface SessionDelivery {
  kind: 'pull_request';
  url: string;
}

/** `AgentSession` as the daemon sends it: 0.18.0's string + `deliverUrl`, or the
 *  legacy 0.11–0.17 object, or neither (≤0.10). See {@link RunDeliveryState}. */
export type SessionWithDelivery = AgentSession & {
  delivery?: RunDeliveryState | SessionDelivery | null;
  /** The delivered PR's URL — present exactly when `delivery === 'delivered'`. */
  deliverUrl?: string;
};

/**
 * Response of `POST /runs/:id/deliver` (crew#393) — post-hoc delivery: lift a
 * COMPLETED repo-scoped run's stranded worktree into a PR with the SAME hardened
 * script the deliver phase runs. Idempotent — a delivered run answers 200 with
 * the same recorded `prUrl`. Failure is loud, never silent: 404 unknown run,
 * 409 not-completed / repo-less / worktree-gone / delivery-in-flight / the
 * script's own refusal (the error carries the script's own words), 500 when no
 * verifiable PR URL came back or the script could not be spawned.
 */
export interface DeliverRunResult {
  prUrl: string;
}

/**
 * `LaunchRunBody` with 0.18.0's widened `deliver`. `'pr'` appends the hardened
 * deliver phase; `'none'` explicitly declines (the completed run reads
 * `delivery: 'stranded'` on the wire, recoverable via `POST /runs/:id/deliver`);
 * OMITTED lets the daemon decide — a repo-scoped code-work launch defaults to
 * `'pr'` (flippable by the daemon's `deliverDefault` setting), everything else
 * to `'none'`. `'none'` is additive at 0.18.0: older daemons 400 on it, so the
 * composer only sends the key where it would have been licensed to send `'pr'`.
 */
export type LaunchBodyWithDeliver = Omit<LaunchRunBody, 'deliver'> & {
  deliver?: 'pr' | 'none';
};

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

// ── DELETE /projects/:id/interactive/docs/:doc (crew#338 / studio#119) ────────
//
// Hand-declared, same contract as SessionDelivery above: the installed
// `wicked-crew-api-types` is STALE at 0.8.x and these ship in a later version
// (the daemon's route layer compiles against the same names). **Delete both
// declarations and re-export the package's** the moment studio bumps to the
// api-types version that carries `InteractiveDocDeleteResponse`.

/** Crew's handoff-ledger half of a doc delete — what fell, or why nothing did. */
export interface InteractiveDocDeleteLedgerReport {
  /** True iff every ledger was swept without error. False with `skipped: true`
   *  on the refusal paths — the sweep deliberately did not run. */
  ok: boolean;
  /** Every replay-dedup row key actually dropped (`<doc>`, `<doc>:v<n>`, …).
   *  Empty ⇒ nothing was there — a never-drafted doc is a clean no-op here. */
  removed_keys: string[];
  /** The ledgers that could NOT be swept (`draft`|`edit`|`chat`|`demo`) and why.
   *  Present only when `ok` is false and the sweep actually ran. */
  errors?: { ledger: string; error: string }[];
  /** True ⇒ deliberately skipped (interactive refused/failed the retire, so
   *  crew's rows are still doing their job — nothing diverged). */
  skipped?: boolean;
}

/**
 * The governed delete's 200: interactive's own retire answer (relayed verbatim)
 * plus crew's ledger report — BOTH halves named, per the route's loud-on-partial
 * contract (its non-200s carry `error` + the same `ledger` report).
 */
export interface InteractiveDocDeleteResponse {
  /** The doc name (slug). */
  name: string;
  kind: 'doc' | 'html' | 'source' | 'demo';
  retired: true;
  /** True on a repeat delete — idempotent, with the ORIGINAL `retired_at` and no `event_id`. */
  already_retired: boolean;
  /** ISO-8601 retirement timestamp. */
  retired_at: string;
  /** Head version at retirement. */
  head: number;
  /** Lineage size at retirement. */
  versions: number;
  /** The `wicked.interactive.doc.retired` bus event id — first retire only. */
  event_id?: number;
  /** What crew dropped from its handoff ledgers. */
  ledger: InteractiveDocDeleteLedgerReport;
}
