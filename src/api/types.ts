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

import type { DeliverRunResult, DeliverTargetResponse, RunAcceptanceWalkthrough, RunAcceptanceSummary, InteractiveDocDeleteLedgerReport, InteractiveDocDeleteResponse } from 'wicked-crew-api-types';
export type { DeliverRunResult, DeliverTargetResponse, RunAcceptanceWalkthrough, RunAcceptanceSummary, InteractiveDocDeleteLedgerReport, InteractiveDocDeleteResponse };

export type * from 'wicked-crew-api-types';

// ── Delivery wire (crew#393 — api-types 0.18.0) ──────────────────────────────
//
// `DeliverRunResult` and `DeliverTargetResponse` come from the contract package (pin 0.92.0,
// ASK-S1). `RunDeliveryState`, `SessionDelivery`, `SessionWithDelivery` and `LaunchBodyWithDeliver`
// stay: they are studio's tolerant readings of the delivery field across the 0.11–0.18 wire
// reshape (`src/components/delivery.ts` still reads the legacy object off an older daemon).

/**
 * `AgentSession.delivery` (crew#393; api-types 0.18.0) — the run's delivery
 * state, derived at DTO assembly on BOTH `GET /runs` and `GET /runs/:id`:
 *
 *  - `'delivered'` — a PR was opened for this run (by the deliver phase, or
 *    post-hoc via `POST /runs/:id/deliver`); `deliverUrl` carries the PR URL.
 *  - `'pushed'`    — (api-types 0.69.0, N1) the run's branch was PUSHED and that
 *    is the whole delivery: the origin is not a GitHub host gh can resolve, so no
 *    PR could be opened. `deliverBranch` + `deliverRemote` say what is where.
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
export type RunDeliveryState = 'delivered' | 'pushed' | 'stranded' | 'vacuous' | 'none';

/** The LEGACY 0.11.0–0.17.0 object spelling of `session.delivery` (crew#321).
 *  Gone from the 0.18.0 wire; kept only so the derivation can read the url off
 *  an older daemon instead of crashing on it. */
export interface SessionDelivery {
  kind: 'pull_request';
  url: string;
}

/** `AgentSession` as the daemon sends it: 0.18.0's string + `deliverUrl`, or the
 *  legacy 0.11–0.17 object, or neither (≤0.10). See {@link RunDeliveryState}. */
export type SessionWithDelivery = Omit<AgentSession, 'delivery' | 'deliverUrl'> & {
  // Widen (not intersect) `delivery`: api-types now types it as the string union, but the
  // derivation still TOLERATES the legacy 0.11–0.17 object at runtime — an intersection would
  // narrow the object branch to `never`. `Omit`-then-re-add keeps both wire forms readable.
  delivery?: RunDeliveryState | SessionDelivery | null;
  /** The delivered PR's URL — present exactly when `delivery === 'delivered'`. */
  deliverUrl?: string;
  /** N1: the pushed run branch — present exactly when `delivery === 'pushed'`. */
  deliverBranch?: string;
  /** N1: the remote it is on (userinfo removed) — present exactly when `delivery === 'pushed'`. */
  deliverRemote?: string;
};

/**
 * `LaunchRunBody` with 0.18.0's widened `deliver`. `'pr'` appends the hardened
 * deliver phase; `'none'` explicitly declines (the completed run reads
 * `delivery: 'stranded'` on the wire, recoverable via `POST /runs/:id/deliver`);
 * OMITTED lets the daemon decide — a repo-scoped code-work launch defaults to
 * `'pr'` (flippable by the daemon's `deliverDefault` setting), everything else
 * to `'none'`. `'none'` is additive at 0.18.0: older daemons 400 on it, so the
 * composer only sends the key where it would have been licensed to send `'pr'`.
 * `deliverGate: 'human' | 'auto'` (F-E2E-030; api-types 0.37.0) needs no hand-declaration: it rides
 * `LaunchRunBody` itself and survives the `Omit` — `tests/deliverGateWire.test.ts` pins it.
 */
export type LaunchBodyWithDeliver = Omit<LaunchRunBody, 'deliver'> & {
  deliver?: 'pr' | 'none';
  /**
   * Ad-hoc campaign attach (wicked-studio#27; api-types 0.19.0): file this run onto an
   * EXISTING campaign's surface. Provenance only — the run executes byte-identically, never
   * becomes a DAG node. Validated at launch, loudly: unknown campaign = 404 (nothing
   * launched); a pre-0.19 daemon 400s naming the field. Mutually exclusive with `groupLabel`
   * (both ⇒ 400). Hand-declared here like `deliver` — delete on the ≥0.19 api-types bump.
   */
  campaignId?: string;
  /**
   * Ad-hoc label grouping (wicked-studio#27; api-types 0.19.0): runs launched with the same
   * label form one `RunGroup` on `GET /campaigns` — created on first use, 1–200 chars.
   * Mutually exclusive with `campaignId`. Echoed as `AgentSession.group_label`.
   */
  groupLabel?: string;
  /**
   * A user-composed plan (DES-TEAMING-002 T3; api-types 0.45.0+): ordered catalog steps and the
   * predicted `touch` set. Mutually exclusive with `workflow`. `LaunchPlan` is the contract's (re-exported
   * by `./teamPlan.ts`); this widening stays because `LaunchBodyWithDeliver` is studio's tolerant launch
   * body across the 0.11–0.18 `deliver` reshape.
   */
  plan?: import('./teamPlan.js').LaunchPlan;
};

// ── GET /repos/:id/deliver-target (R3, ship-prove-3) ──────────────────────────
//
// `DeliverTargetResponse` is the contract's (imported at the top of this file).
// Where a delivering launch on the repo would push, read by the SAME origin preflight
// the deliver gate card uses (crew#730); `sentence` is that card's own target
// sentence for a run not yet started. A daemon without the route answers 404 —
// the client reads that as `null` ("could not say"), never as an origin.

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

/**
 * Per plan step, whether a sealed walkthrough proves it (DES-walkthrough-proof §4.9; api-types 0.75.0,
 * WT-W2): `checked` / `failed` / `claimed` / `owned_by_you`, computed by crew at every read, never
 * stored. The one declaration is `./walkthrough.ts` (WT-U1 mirrored it for the WalkthroughView's
 * `steps`); the acceptance read serves the same shape.
 */
export type { WalkthroughCheckState, WalkthroughStepState } from './walkthrough.js';

/** The subset of `GET /runs/:id/acceptance` studio reads. */
export interface RunAcceptanceView {
  runId: string;
  gate: AcceptanceGate;
  /** Absent on daemons older than the conformance section (crew < 0.8). */
  conformance?: AcceptanceConformance;
  /** WT-W2 (crew ≥ 0.7.47): absent before it, and absent when the requirement names no walkthrough step. */
  walkthrough?: RunAcceptanceWalkthrough;
  /** WT-W3 (crew ≥ 0.7.48): absent before it. */
  summary?: RunAcceptanceSummary;
}

// ── DELETE /projects/:id/interactive/docs/:doc (crew#338 / studio#119) ────────
//
// `InteractiveDocDeleteLedgerReport` / `InteractiveDocDeleteResponse` are the contract's (imported
// at the top of this file); the notes below describe the wire they name.

