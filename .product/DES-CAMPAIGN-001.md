# DES-CAMPAIGN-001 — campaign grouping on the orchestrator board

**Status:** DRAFT — §0–§1 complete
**Date:** 2026-08-20
**Issue:** mikeparcewski/wicked-studio#27
**Scope:** Design only. No implementation.
**Repos in scope:** `wicked-studio` (this repo), `wicked-crew` (control plane, `/api/v1` + `/ws`,
and the `wicked-crew-api-types` contract package it publishes). **Not** `wicked-core` — §1.3
explains why keeping the engine off the critical path is the point of the chosen design.

> **Naming collision, stated up front.** `wicked-core/src/campaign.rs` carries its own
> `DES-CAMPAIGN-001` — the dependency-aware DAG *scheduler*. This document is the wicked-studio
> `DES-CAMPAIGN-001` and is about a *grouping surface*. Where the two must be distinguished below,
> the engine's is written **core's DES-CAMPAIGN-001**. §1.3 and §6 say exactly how they relate.

---

## 0 The problem

DES-MERGE-001 §1.2/§1.4 built the orchestrator board: one card per **project**, sorted by
attention needed, live over the page's one `/ws` socket, legible at ~20 cards. It answers
*"which project needs me?"*.

It does not answer *"how far along is the whole effort?"* — and that turned out to be the
question the operator asked most while executing DES-MERGE-001 itself. That merge ran as 18
governed runs: one per slice, several in parallel, some in `wicked-crew` and some here. The only
whole-of-effort views were the design document's slice list (hand-maintained prose) and `/runs`
(a flat, cross-project, chronological list that knows nothing about the effort). Neither is a
surface; both are bookkeeping the operator did by hand.

Three concrete gaps, in the order they hurt:

1. **No denominator.** "Slice 15 completed" is a fact about a run. "15 of 18 landed" is a fact
   about the effort, and nothing in the system holds it.
2. **The board scatters a campaign across cards.** Runs for a cross-repo effort land on two or
   three different project cards. Their relationship to each other exists only in the operator's
   head.
3. **Attention is per-project, not per-effort.** A gate waiting on slice 12 sorts the
   *wicked-studio* card up. It does not say *the merge campaign is blocked*, which is the fact
   that decides what the operator does next.

### 0.1 What exists today (verified, not assumed)

| Fact | Where | Consequence for this design |
|---|---|---|
| The board holds the full live `SessionView[]` and re-reads `GET /runs` (400 ms debounce) on every lifecycle frame | `src/hooks/useRuns.ts` | run **status** is already live client-side; a second server-side source of status would be a source of disagreement |
| Runs join projects through the **membership table** (`crew.run` / `crew.chat`), because `AgentSession` carries no project id | `src/hooks/useBoardModel.ts:16`, api-types `AgentSession` | a campaign join must be a *new* join; it cannot ride the session row |
| The daemon tags `/ws` frames with `project_id` from an in-memory `MembershipIndex` hydrated from the engine at boot | `wicked-crew/packages/crew/src/projects/membership-index.ts`, `src/api/server.ts:370` | the exact pattern a run→campaign index would copy — and the reason it is *not needed* in v1 (§2.4) |
| `LaunchSchema` is `.strict()` | `wicked-crew/packages/crew/src/api/routes.ts:137` | an unknown `campaign` field on an older daemon is a **400 on every launch**, not a degraded feature — this drives §1.5 |
| Crew already keeps a durable crew-side JSON store for a field the engine has no column for, explicitly to keep a `wicked-core` release off the critical path | `wicked-crew/packages/crew/src/projects/settings.ts` (`ProjectSettingsStore`, DES-MERGE-001 §7.1) | the precedent — and the storage shape — for a campaign store |
| The deliver phase's PR URL is the **last line** of the `deliver` unit's stored output | `wicked-crew/packages/crew/src/core/deliver.ts` (`crew#293`) | "landed PR links" are derivable today, with no new run-side plumbing |
| `wicked-crew-api-types` is types-only, zero runtime; published at 0.6.0; studio pins `^0.5.1` | `packages/crew-api-types/package.json`, studio `package.json:68` | additive optional fields are non-breaking; the release sequencing in §5 is a real constraint, not ceremony |

---

## 1 The campaign entity/contract

### 1.1 Option A — surface core's campaign nodes

`wicked-core/src/campaign.rs` is 1,871 lines of finished, tested work: `CampaignDef`
(nodes, dependency edges, `FailurePolicy`, `max_concurrency`), a live `Campaign`
(`node_status`, `node_run_id`, `node_attempt`, pending HITL and failure gates), persistence as
one estate node round-trip, crash-resume, and twelve `CoreEvent` variants
(`CampaignLaunched`, `CampaignNodeReady|Started|AwaitingHuman|Completed|Failed|Blocked`,
`CampaignPaused|Completed|Failed|Cancelled`) already mapped to tagged JSON in
`event_to_json`.

It is genuinely good, and it is genuinely unreachable from here:

- **No napi binding exists.** `crates/wicked-core-ts/src/lib.rs` exposes nine `#[napi]` methods;
  none is a campaign verb. `Core::launch_campaign` is Rust-only. `src/event.rs:1023` says so in
  as many words: *"binding surface (launchCampaign etc.) is a separate follow-on task."* The
  crew daemon is JS. It cannot launch, read, or resume a campaign today, and `grep -i campaign`
  over `packages/crew/src` returns three prose comments and zero code.
- **Campaign nodes are unfiled by construction.** `RunSpec::to_launch_spec` hardcodes
  `project_id: None`, with the comment *"Campaign nodes are unfiled in v1."* Every run a core
  campaign dispatches would therefore be invisible to the project board — this design would
  *remove* a surface before adding one. Fixing it is another engine change.
- **The DAG is authored up front; the operator's campaign is not.** A `CampaignDef` is
  validated and persisted whole at launch, and there is no command to add a node to a running
  campaign. But the DES-MERGE-001 campaign was launched one slice at a time, over days, as each
  slice's design settled — with slices merged (11+12, §7.3) and re-sequenced mid-flight. The
  model that fits the operator's actual behaviour is *label runs as you launch them*, and the
  DAG model structurally cannot express it.
- **Four repos, in sequence, before one pixel moves:** wicked-core (binding + `project_id`
  passthrough) → `wicked-core-ts` npm release → wicked-crew (adapter + routes) → api-types →
  wicked-studio.

Option A is the right way to *run* a planned DAG. It is the wrong way to *see* an effort that is
already in flight.

### 1.2 Option B — a launch-time label

One optional string on `POST /api/v1/runs`. Crew records the run→label join in a durable
crew-side store, exposes it as a small read surface, and studio groups by it. No engine change,
no new event, no scheduler.

Costs, stated honestly:

- **A label is not a plan.** It cannot express dependencies, concurrency caps, or a failure
  policy, and it will never dispatch anything. Everything about *ordering* stays the operator's
  job, exactly as it is today.
- **The denominator is not free.** A pure label knows only how many runs have been *filed so
  far*, so "6 of 9" would become "6 of 10" the moment a tenth run launched — a progress readout
  that moves backwards. §1.4 fixes this with an operator-declared `expected`, and §3.3 makes the
  card state which denominator it is using rather than pretending.
- **Typos fork a campaign.** `DES-MERGE-001` and `DES-MERGE-01` are two campaigns. §2.2's
  launch field is a picker over known labels first and free text second, and §1.4 constrains the
  grammar so the failure is at least visible.
- **Nothing enforces membership.** A run can be labelled into a campaign it has no business in.
  This is a label, and labels are advisory. That is the trade.

### 1.3 Decision

**Option B.** The campaign entity is a **launch-time label owned by crew**, not a projection of
core's campaign nodes.

The reasoning, in one line: *the thing missing is a view, and Option A pays for a scheduler
before it delivers a view — one the operator's own working pattern cannot use.*

**This is not a fork of core's DES-CAMPAIGN-001; it is the surface it will land on.** The
forward path is named now so it cannot be discovered later as a contradiction:

- The label's field name is **`campaign`**, matching the field name core's `Campaign*` events
  already carry (`CampaignLaunched { campaign: String }`). Identity is a string in both models.
- When the napi binding lands, the daemon's campaign launcher writes the **same** join for every
  run the scheduler dispatches: `campaign = <the core campaign id>`. Core's DAG then becomes an
  additional **authoring mode** feeding a grouping surface that already exists, not a second
  grouping concept competing with this one.
- Nothing in §3's board UX reads a node, an edge, or a `NodeStatus`. Every field it reads
  (`campaign`, run status, run id, project id) is available in both models. The card does not
  change when the scheduler arrives; it gains a DAG *view* beside it (§6).

The one thing this decision forecloses is *authoring* a dependency graph from studio. §6 names
that as out of scope, on purpose.

### 1.4 The `wicked-crew-api-types` additions, exactly

Target release: **0.7.0** (see §5.0 for sequencing). All additions are new optional fields and
new interfaces; nothing existing changes shape, so the cut is non-breaking for every consumer
pinned at `^0.6.0`.

**(a) `LaunchRunBody` gains one field.**

```ts
export interface LaunchRunBody {
  problem: string;
  sessionId?: string;
  clisJson?: string;
  entityMode?: EntityMode;
  humanConfirm?: string;
  repoRef?: string;
  workflow?: string;
  projectId?: string;
  deliver?: 'pr';
  /**
   * DES-CAMPAIGN-001 §1 — file this run into a CAMPAIGN: an operator-chosen label that groups
   * the sibling runs of one multi-run effort (`"DES-MERGE-001"`). Orthogonal to `projectId`: a
   * campaign may span several projects, and a project holds runs from several campaigns.
   *
   * Grammar: `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Case is PRESERVED and compared
   * CASE-SENSITIVELY — the label is an id the operator types, not a search term. A label that
   * does not match is a 400 and the run does NOT launch (never a silently unfiled campaign,
   * mirroring `projectId`'s rule).
   *
   * Unknown labels are CREATED on first use — a campaign has no create step, which is what
   * makes it usable mid-effort. Omit for a run that belongs to no campaign.
   */
  campaign?: string;
}
```

> `deliver?: 'pr'` is already listed above because 0.7.0 also folds it in — it shipped
> daemon-side in the 0.6.0 workspace copy with a `NOTE for the next api-types release` on it
> (`crew#293`). This design's cut is that release; leaving it unfolded would be a second drift.

**(b) The campaign record.**

```ts
/**
 * A campaign — the launch-time label that groups the sibling runs of one effort
 * (DES-CAMPAIGN-001 §1.3). Held CREW-SIDE (`~/.wicked-crew/campaigns.json`), not in the engine:
 * the same reasoning as `ProjectSettingsStore` (DES-MERGE-001 §7.1) — a campaign must not put a
 * wicked-core release on the critical path of a board surface. If it ever earns an engine
 * record, this store is the migration source and the wire shape below does not move.
 */
export interface Campaign {
  /** The label itself; `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`. Minted by first use, never by a create call. */
  id: string;
  /** Operator-set display title; `null` ⇒ surfaces render the id. */
  title: string | null;
  /**
   * Operator-declared total run count for the effort (>= 1), or `null` when undeclared.
   * The DENOMINATOR of "n of m landed" — see §3.3 for what a surface must show when it is null.
   */
  expected: number | null;
  /** Unix millis — the first launch that used this label. */
  created_at: number;
  /** Unix millis — the newest launch filed here, or the newest metadata write. */
  updated_at: number;
  [k: string]: unknown;
}
```

**(c) The list row — `GET /campaigns`.**

```ts
/** One row of `GET /campaigns` — the campaign, its join, and its server-derived counts. */
export interface CampaignSummary {
  campaign: Campaign;
  /** Every run filed under this label, newest launch first. INCLUDES archived runs (§4.2). */
  runIds: string[];
  /** The projects those runs are filed into, deduped, in first-seen order. A campaign may span several (§3.4). */
  projectIds: string[];
  counts: CampaignCounts;
  /** Landed runs that opened a PR, newest first (§4.3). Capped server-side; `prsTruncated` says so. */
  prs: CampaignPr[];
  prsTruncated: boolean;
}

/**
 * Run counts over the campaign's FULL filed set, including archived runs — computed server-side
 * for the reason in §4.2 (the client's run list is archive-filtered, so a client-derived
 * denominator shrinks when the operator archives a landed run).
 * `filed === landed + failed + cancelled + running + awaitingHuman + other`.
 */
export interface CampaignCounts {
  filed: number;
  landed: number;
  failed: number;
  cancelled: number;
  /** `planning | distributing | executing`. */
  running: number;
  awaitingHuman: number;
  /** Any status the daemon could not classify — never folded into another bucket. */
  other: number;
  /** How many of `filed` are archived. Reported so a surface can explain a gap it cannot show. */
  archived: number;
}

/** A landed run's pull request (§4.3). */
export interface CampaignPr {
  runId: string;
  /** The PR URL as the deliver phase printed it, kept verbatim; absent when it did not parse. */
  url: string;
}
```

**(d) The detail response — `GET /campaigns/:id`.**

```ts
/** `GET /campaigns/:id` — the summary plus a per-run roll-up the list route is too hot to carry. */
export interface CampaignDetail {
  campaign: Campaign;
  runs: CampaignRun[];
  counts: CampaignCounts;
}

/** One run's place in a campaign. Status is a SNAPSHOT — live status stays the run list's job (§4.2). */
export interface CampaignRun {
  runId: string;
  /** The run's status at read time; `null` when the engine no longer holds the run. */
  status: SessionStatus | null;
  /** The project this run is filed into, or `null` for an unfiled run. */
  projectId: string | null;
  problem: string;
  /** Unix millis — when the label was attached (launch time, or attach time for a back-filled run). */
  filed_at: number;
  /** The PR this run opened, when it opened one. */
  prUrl?: string;
  /** True when the run is archived and therefore absent from the default `GET /runs` list. */
  archived: boolean;
}
```

**(e) The two write bodies.**

```ts
/** `PUT /campaigns/:id` — set the display title and/or the declared run total. */
export interface UpdateCampaignBody {
  /** `""` clears the title back to `null`. */
  title?: string;
  /** `>= 1`, or `null` to clear the declared total back to "unknown". */
  expected?: number | null;
}

/**
 * `PUT /campaigns/:id/runs` — file ALREADY-LAUNCHED runs into this campaign (§2.3).
 *
 * Load-bearing, not a convenience: the effort that produced issue #27 was six runs deep before
 * anyone knew it was a campaign. Without this, a campaign can only ever be declared before its
 * first run, which is the one moment an operator never knows it.
 */
export interface AttachCampaignRunsBody {
  /** Run ids to file. Unknown ids are rejected (404) — the whole body, so a typo never half-files. */
  runIds: string[];
}
```

**(f) `CoreEvent` — unchanged.** No frame gains a `campaign` field in this design. §2.4 states
why, and names the condition that would earn one.

### 1.5 Back-compat, both directions

**api-types → consumers.** Types-only, zero runtime, all additions optional. A consumer pinned
at `^0.6.0` compiles unchanged; one that bumps to `^0.7.0` sees new optional fields and new
interfaces it can ignore.

**Studio → an older daemon.** This is the sharp edge, and it is not symmetric with the usual
"optional field is forward-additive" story. `LaunchSchema` is `.strict()`: a daemon predating
this work rejects an unknown `campaign` key with a **400**, so a studio bundle that always sends
the field breaks *every launch*, campaign or not. The bundled case (crew serves studio's `dist`)
cannot drift, but the standalone case can and is a supported configuration —
`e2e/studio_standalone_test.py` exists to prove it, and `VITE_API_HOST` exists to enable it.

The rule, therefore:

1. **Probe once, on board mount:** `GET /campaigns`. `200` ⇒ supported. `404` ⇒ unsupported (an
   older daemon has no such route). Any other status ⇒ treat as unsupported and say so once.
2. **`200 []` is the "no campaigns yet" answer, never a 404.** The route must exist and return an
   empty array on an empty store, so that `404` unambiguously means *this daemon predates
   campaigns* — the probe's whole discriminator.
3. **Unsupported ⇒ the launch form omits the field entirely and the request omits the key.** Not
   a disabled control: a disabled control teaches the user the feature exists here, and it does
   not. (This is the one place §1.3 of DES-MERGE-001's "disable, don't hide" rule is inverted on
   purpose — that rule is about *modes of this app*, and this is a *capability of the server*.)
4. **An empty string is never sent.** `campaign: ""` fails the grammar and would 400; the client
   omits the key.

No version string is parsed anywhere. The probe is a route probe because a route is the thing
whose presence actually matters.
