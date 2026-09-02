# DES-CAMPAIGN-001 — campaign grouping on the orchestrator board

**Status:** DRAFT — complete, ready for review
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

> **Reality note (2026-09, #27 remainder).** The wire crew ACTUALLY shipped (crew#342 + the
> api-types 0.19.0 additions) superseded §1.4's crew-side label store: `GET /campaigns` serves
> the ENGINE campaign (`id`/`def`/`node_status`/`node_run_id` + daemon-joined `node_delivery`/
> `attached_runs`) beside ad-hoc `RunGroup`s (`groups`), and launch-time attach is
> `LaunchRunBody.campaignId` XOR `groupLabel` on `POST /runs` (404 unknown campaign, 400 both).
> Studio's surface (`src/api/campaigns.ts`, `board/campaignStats.ts`, `CampaignsPage`,
> `CampaignScoreboard`, the composer's Group control) is written against THAT contract —
> verified against a daemon built from the crew branch. §1.4(b)–(e)/§2.3's shapes are the
> historical design, kept for the rationale (§3's board UX, §3.3 denominator honesty, §1.5's
> probe), which still governs.

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

---

## 2 Launch threading

How the label gets from a text field to a card. The short version: **it rides REST the whole
way and never touches the event stream.** §2.4 defends that.

### 2.1 The path, end to end

```
ChatInput (studio)                POST /api/v1/runs { problem, projectId?, campaign? }
   │                                        │
   │                                        ▼
   │                              LaunchSchema (.strict) — grammar-checked, 400 on a bad label
   │                                        │
   │                              adapter.launchRun(input)  ← `campaign` is NOT passed down;
   │                                        │                  the engine never learns of it
   │                                        ▼
   │                              ── post-commit, beside the existing projects block ──
   │                              campaigns.file(runId, label, Date.now())   → durable JSON store
   │                              audit.record('run.launched', actor, { detail: { campaign } })
   │                                        │
   │                                     201 { runId }
   ▼                                        │
useRuns.refresh()  ◄── /ws lifecycle frame ─┘   (already happens; 400 ms debounced)
   │
   ├─ GET /runs        → live SessionView[]        (existing)
   └─ GET /campaigns   → CampaignSummary[]         (new, same tick)
                │
                ▼
        useCampaignModel → CampaignBand → CampaignCard
                                │
                                └─ per-run narration from the SHARED runtime store, by run id
                                   (useRunHeadline — no new subscription, no second socket)
```

The engine is not on this path. `campaign` is consumed entirely by crew's HTTP layer, exactly
as `projectId`'s *audit* record and *membership index* write are today — with the difference
that `projectId` also flows into `LaunchOptions` and this does not.

### 2.2 Where the operator types it

`src/components/ChatInput.tsx` gains a **Campaign** field in the launch form, beside the
workflow/entity-mode controls:

- An `<input list=…>` combobox over a `<datalist>` of the ids in the campaign list the board
  already holds. **Picking is the first-class path; typing is the fallback** — that ordering is
  the only defence this design has against §1.2's typo-forks-a-campaign failure.
- **Empty by default, always.** It is *not* sticky per project and *not* remembered like
  `lastMode`. A remembered label silently files unrelated work into a finished effort, and the
  operator's only signal would be a wrong number on a card they were not looking at. The cost of
  forgetting is one pick; the cost of remembering wrong is a corrupted denominator.
- **Pre-filled only when the launch was started from a campaign surface.** The campaign card and
  the campaign detail page both carry an "Add a run" action that navigates to
  `/p/:projectId/build?campaign=<id>`; the launch form reads that query param and pre-fills. This
  is the one path where the label arrives without being typed, and it is one the operator
  explicitly took.
- **Absent — not disabled — when the daemon does not support campaigns** (§1.5 rule 3).
- On submit: `if (label) body.campaign = label;`. Never `""`.

`GET /campaigns` returns *every* campaign including finished ones, so the datalist can offer a
completed label. That is deliberate: filing a follow-up fix into the campaign it belongs to is a
normal thing to want, and hiding finished labels would make it impossible.

### 2.3 Filing a run that already launched

`PUT /campaigns/:id/runs { runIds }` (§1.4e). The label is written into the same store with
`filed_at = now` rather than the launch time, and `CampaignRun.filed_at` carries that
distinction rather than back-dating it.

Surfaced in slice 4 from two places: a multi-select on `/runs`, and a "File runs into this
campaign" control on the campaign detail page. Rejection is all-or-nothing (one unknown run id
404s the whole body) so a typo in a list of eighteen never half-files the effort.

A run may belong to **at most one campaign**. Filing a run that already carries a different
label overwrites it and the response says which label it replaced; there is no multi-label
model, because "n of m landed" has no meaning if a run can be in two denominators.

### 2.4 What the event stream carries — and what it does not

**Existing frames carry nothing campaign-related, and this design adds nothing to them.**

The temptation is obvious and the pattern is right there: `MembershipIndex` already tags every
`/ws` frame with `project_id` (`server.ts:370`), and a `CampaignIndex` tagging `campaign` would
be a forty-line mirror of it. It is still the wrong call for v1, for one reason:

> The board learns about campaign membership **from REST, on a tick it already runs.** Every
> lifecycle frame (`sessionStarted`, `unitDone`, `awaitingHuman`, …) already triggers
> `useRuns.refresh()`; `GET /campaigns` rides that same debounced tick. A run launched into a
> campaign by another client, or by the CLI, appears on the campaign card within one debounce
> window — with no frame tag, no index to hydrate, and no second thing that can drift from the
> store.

Tagging the stream would buy nothing the REST join does not already deliver, and would add a
second representation of the join that can disagree with the first. A cache that is only ever
*read* alongside the truth it caches is not a cache; it is a bug waiting for a hydrate to fail.

**What narration the card shows, and where it comes from.** Nothing new. `unitOutputDelta` and
the structured lifecycle frames already land in the shared runtime store keyed by **run id**
(`src/store/runtime.ts`), and `useRunHeadline(view)` already reduces them to one line at the
board's altitude (DES-MERGE-001 §3.4(b)). A campaign card holds `SessionView`s it selected out
of the board's run list, so it calls the same hook and gets the same line — one socket, one
store, no polling, per DES-MERGE-001 §3.5.

**The condition that would earn a `campaign` tag on frames.** A surface that must *filter the
live stream* by campaign without holding the join first — a campaign-scoped transcript, or a
campaign card that renders runs the board's run list does not contain (archived, or another
daemon's). If that lands, the addition is `campaign?: string` on `CoreEvent` plus a
`CampaignIndex` mirroring `MembershipIndex`, and it is additive to everything here.

---

## 3 Board UX

### 3.1 The constraint being satisfied

DES-MERGE-001 §1.4 fixed three properties of the home board that this feature must not break:

1. a **total attention order over projects** — `gate > failing > running > drafts > quiet`;
2. a **20-card legibility budget** — fixed card height (`CARD_H = 352`), virtualized grid,
   *"no card that grows with run count"*;
3. **live, not polled** — cards update in place off the page's one socket.

A campaign is not a project, and the naive move — mixing campaign cards into the project grid —
breaks (1) and (2) at once. So:

### 3.2 A band, not a card in the grid

```
┌─────────────┬──────────────────────────────────────────────────────────────────┐
│  rail       │  CAMPAIGNS  (2 active)                                    [ ⌃ ]  │
│             │  ┌───────────────────────┐ ┌───────────────────────┐             │
│             │  │ DES-MERGE-001         │ │ estate-0.15 rollout   │  2 more ›   │
│             │  │ ▓▓▓▓▓▓▓▓▓░░░ 15 of 18 │ │ ▓▓▓░░░░░░ 2 of 6 so far│            │
│             │  │ ● executing — …       │ │ ⏸ gate: approve AC-3  │            │
│             │  │ studio · crew         │ │ estate               │             │
│             │  └───────────────────────┘ └───────────────────────┘             │
│             │  ────────────────────────────────────────────────────────────    │
│             │  PROJECTS · sorted by what needs you first                       │
│             │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │
│             │  │ project card │ │ project card │ │ project card │   (unchanged)│
└─────────────┴──────────────────────────────────────────────────────────────────┘
```

**Why a band above the grid, and not an entry in it:**

- **A multi-project campaign has no seat in a project-sorted grid.** Placing it under one of its
  projects is arbitrary; placing it under each is three cards for one effort — precisely the
  scatter this feature exists to remove.
- **The attention sort would stop meaning anything.** `sortByAttention` is a total order over a
  homogeneous set. "Is a gate-waiting campaign above a gate-waiting project?" has no principled
  answer, and any answer we picked would make the sort key a lie in half the cases.
- **The 20-card budget survives by construction.** The band is a horizontally-scrolling row of
  fixed-height cards, so it costs a **fixed** slice of vertical space no matter how many
  campaigns exist — 4 rendered, then `N more ›`. `HomeBoard`'s windowing math is untouched: the
  grid keeps its own scroller and its `rows * rowH` height, and the band sits outside it. The
  slice-5 e2e assertion on `data-rendered` holds unchanged, which is how we prove it.
- **Collapsible, and collapsed-state is remembered** (`localStorage`, same shape as `lastMode`).
  An operator with no campaigns sees the band **not at all** — zero active campaigns renders
  nothing, not an empty-state card. This is the one place the board's *"a card is never a dead
  tile"* rule does not apply, because the band is not a card: an empty campaign band would be a
  permanent advertisement on the most valuable surface in the app.

**What counts as active** (and therefore appears in the band): any campaign with at least one
non-terminal run, **or** with `landed < denominator`. A campaign whose runs are all terminal and
whose denominator is met drops out of the band and stays reachable at `/campaigns`. A campaign
that failed stays in the band until the operator resolves it — `failed > 0` with no live run is
an attention state, not a finished one.

### 3.3 Campaign card anatomy

Fixed height **148 px** — shorter than `CARD_H`, because a campaign card is a *progress
readout*, not a launcher. It carries four regions and one action.

| Region | Content | Source |
|---|---|---|
| **Header** | attention dot · title (or id) · project chips (2 + `+N`) | `CampaignSummary` |
| **Progress** | `"15 of 18 landed"` + a segmented bar: landed / failed / awaiting / running / not-started | `counts` + `expected` |
| **Live** | newest narration line for up to **2** active runs; `N more running` beyond that | `useRunHeadline` per run — the shared runtime store |
| **Attention** | a `GateChip` per gate-waiting run (max 2), and a failed-run row that links to the run | gate store + run list |
| **Landed** | the newest 2 PR links, `all N ›` to the detail page | `prs[]` |
| **Action** | `Add a run` → `/p/:projectId/build?campaign=<id>` | §2.2 |

The rules that keep it honest:

- **The denominator names itself.** `expected` set ⇒ `"15 of 18 landed"`. `expected` null ⇒
  `"15 of 17 landed so far"` — the trailing *so far* is not decoration, it is the statement that
  the denominator can grow (§1.2). A surface that renders both identically is lying about which
  one it has.
- **Archived runs are stated, never dropped.** `counts.archived > 0` ⇒ the progress line carries
  `(3 archived)`. They stay in `filed` and in `landed`; what the card cannot do is show their
  live narration, so it says how many it is not showing rather than silently shrinking.
- **Every line is informative or actionable** (DES-MERGE-001 §3.3). The live region shows
  `useRunHeadline`'s `<phase> — <what>`, which always carries a subject; a gate renders as an
  answerable `GateChip`, not a badge; a failed run renders with the run link adjacent. There is
  no state in which this card shows a spinner, a bare count with no subject, or an error with no
  next action — which is DES-MERGE-001 §3.7's heuristic, and slice 3's assertion.
- **Nothing on the card grows with run count.** Two live lines, two gate chips, two PR links,
  two project chips; everything else is an overflow count. Same discipline as `ProjectCard`, for
  the same reason.
- **Gates are answerable from the band.** A simple gate (§7.11's ≤2-choices heuristic) is
  approved inline via the existing `GateChip`, with no navigation; a complex one deep-links into
  the thread. Inherited wholesale — `GateChip` already takes `runId` + `projectId`, both of
  which the campaign card holds.

### 3.4 A campaign that spans several projects

It renders **once**, in the band, with a chip per project (2 shown, `+N` beyond). Its runs
continue to appear on their own project cards as run chips, unchanged.

That is a deliberate duplication, and the justification is that the two surfaces answer
different questions:

| Surface | Question | Unit |
|---|---|---|
| Project card | *What is happening in this project?* | runs, docs, chats — everything the project holds |
| Campaign card | *How far along is this effort?* | progress against a denominator, across project lines |

Neither is a list of the other, and neither is derivable from the other — a project card can
never show "15 of 18" (it holds 9 of the runs), and a campaign card can never show the project's
documents. Deduplicating them would mean deleting one of the two questions.

The project chips are links to `/p/:projectId`, so the campaign card is also the fastest route
*into* the project a blocked slice lives in — the traversal the operator actually performs when
a campaign card turns yellow.

### 3.5 Routes

| Route | Surface | Notes |
|---|---|---|
| `/` | the band + the existing project grid | band hidden when no campaign is active |
| `/campaigns` | every campaign, active and finished, newest-updated first | the escape hatch, exactly as `/runs` is for the grid |
| `/campaigns/:id` | one campaign: every run as a row (status, project, PR, narration), plus the `title`/`expected` editor and the file-existing-runs control | §4.4 |

These slot into the existing `Panel` union (`'campaigns' | 'campaign-detail'`) with the same
parse shape `repos` / `repo-detail` already use in `src/hooks/useRoute.ts`. No change to the
`/p/:projectId/:mode` parse, which runs ahead of the panel parse and is untouched.

---

## 4 Insight surface

### 4.1 The endpoints

| Method | Path | Returns | Called by |
|---|---|---|---|
| `GET` | `/api/v1/campaigns` | `{ campaigns: CampaignSummary[] }` — newest-updated first, **always 200**, `[]` on an empty store (§1.5 rule 2) | the board, on `useRuns`' existing debounced tick; also the §1.5 support probe |
| `GET` | `/api/v1/campaigns/:id` | `CampaignDetail` — 404 on an unknown label | `/campaigns/:id` |
| `PUT` | `/api/v1/campaigns/:id` | `{ campaign: Campaign }` — sets `title` / `expected`; 404 on an unknown label (metadata never *creates* a campaign; only a run does) | the detail page's editor |
| `PUT` | `/api/v1/campaigns/:id/runs` | `{ campaign: Campaign; filed: number }` — files existing runs; 404 if any run id is unknown, nothing filed | `/runs` multi-select, detail page |

No `POST /campaigns` and no `DELETE`. A campaign is minted by its first run and has no
independent existence; a campaign with no runs is not a thing this system needs to represent.
(Un-filing is `PUT /campaigns/<other>/runs`, or — deliberately absent in v1 — nothing. §6.)

### 4.2 The split: what crew answers vs what studio derives

The division is not "server does data, client does display". It follows one rule:

> **Crew owns the join and everything that depends on runs the client cannot see. Studio owns
> everything derived from the live run list it already holds.**

**Crew answers, and studio must not recompute:**

- **The join itself** (`runIds`, `projectIds`) — crew is the only holder. `projectIds` comes from
  the membership index crew already maintains, so it costs a map lookup per run.
- **`counts`** — computed server-side over the **full filed set, including archived runs**. This
  is the one that looks like it should be client-side and must not be. `GET /runs` excludes
  archived runs by default (`crew#265`), so a client-derived `landed` would *drop* every landed
  run the operator wrote off — and a long campaign is exactly the thing whose early runs get
  archived. The number would shrink as the effort progressed. Remembering what the run list
  forgets is the campaign's entire job; delegating it to the run list defeats it.
- **`prs`** — see §4.3; it needs stored unit output the board would otherwise fetch N times.

**Studio derives, and crew must not send:**

- **Live run status, narration, and gate state.** All three are already live client-side: the
  board holds `SessionView[]` and the shared runtime + gate stores hold the rest. A server-side
  copy would be a second source of truth for a value the same page is already rendering from the
  first, and the two would visibly disagree in the ~400 ms between a frame and a refetch.
- **Attention/sort position of a campaign card** — a pure function of the statuses studio holds,
  identical in spirit to `deriveAttention`.
- **The rendered progress string and bar** — `counts` + `expected` in, `"15 of 18 landed"` out.
  The denominator choice (§3.3) is a display rule and belongs where the display is.

`CampaignDetail.runs[].status` is a deliberate exception, and labelled as one in the type: it is
a **snapshot**, present so the detail page can render a row for an archived run the client's list
does not contain. Live rows on that page still read the run list. Where both exist, the run list
wins.

### 4.3 PR links

The deliver phase prints the PR URL as the last line of the `deliver` unit's stored output
(`crew#293`). Crew resolves it; studio never does.

ASSUMPTION[external-transform] library=gh (GitHub CLI) transform=`gh pr create --head <branch> --fill` prints the created pull request's HTML URL as the last line of stdout, which crew's deliver script captures with `| tail -1` confidence=known :: crew reads the last line of the deliver unit's stored output and accepts it as `CampaignPr.url` ONLY if it parses as an absolute `https://` URL whose path contains `/pull/<n>`; anything else (a gh hint line, an auth warning, a changed output format in a future gh release) yields no `prs` entry, so the card renders "landed, no PR link" rather than a wrong link. The URL is stored verbatim — never normalized, rewritten, or reconstructed from parts.

Cost control, because the board calls the list endpoint on a debounced lifecycle tick:

- **Resolved once, cached forever.** A terminal run's PR URL never changes. Crew resolves it on
  the first `GET /campaigns*` *after* the run reaches a terminal status and writes the result
  (URL, or a sentinel meaning "resolved to nothing") into the campaign store beside the join.
  Subsequent reads are a map lookup.
- **Never resolved for a non-terminal run** — the deliver phase has not run yet, so a read would
  cost I/O to learn nothing.
- **Capped at the newest 20 per campaign**, with `prsTruncated: true` when the cap bites. The cap
  is *reported*, not silent: a surface that says "all 24 ›" while holding 20 is lying about what
  the link opens.

### 4.4 The detail page

`/campaigns/:id` is where the campaign stops being a summary. One row per run: status, project,
problem line, the live narration line for runs that are in flight, the PR link for runs that
landed, and an `archived` marker for runs the board cannot show. Plus the two write affordances
— the `title`/`expected` editor (`PUT /campaigns/:id`) and file-existing-runs
(`PUT /campaigns/:id/runs`).

It is deliberately a **table, not a graph**. There is no dependency information in this model to
draw edges from (§1.2), and drawing a plausible-looking DAG from launch order would be inventing
structure the system does not have. `CampaignDagStub` stays a stub for exactly that reason (§6).

---

## 5 Slice plan

### 5.0 Ground rules and release sequencing

Inherits DES-MERGE-001 §6.0 verbatim, with the LOC budget tightened: **≤300 LOC of production
diff per slice** (tests excluded from the count, never from the PR), each slice independently
mergeable and revertable, acceptance criteria written as Playwright assertions against
`data-testid` selectors in `e2e/studio_standalone_test.py`, and every slice's AC includes
DES-MERGE-001 §3.7's heuristic where a working state is visible. Merge protocol per the
ecosystem CLAUDE.md: branch, open PR, wait 6–8 minutes for the bots and CI, address comments,
then merge.

**The contract lands before its consumers.** Non-negotiable ordering:

```
1. api-types 0.7.0 cut + published        (wicked-crew/packages/crew-api-types)
      ├── campaign? on LaunchRunBody
      ├── Campaign, CampaignSummary, CampaignCounts, CampaignPr,
      │   CampaignDetail, CampaignRun, UpdateCampaignBody, AttachCampaignRunsBody
      └── deliver?: 'pr' folded in (its own NOTE says to fold it when 0.7.0 cuts)
                    │
2. crew depends on ^0.7.0 ──────────► slice 1 (crew: store + routes)
                    │
3. studio bumps ^0.5.1 → ^0.7.0 ────► slices 2, 3, 4 (studio)
```

Slice 1's PR contains **both** the api-types cut and the crew implementation, in that commit
order, because `tests/wire-contract.test.ts` proves at compile time that every body the published
contract lets a client send is a body crew's zod schemas accept — the two must move together or
that guard fails. The publish (`release-api-types.yml`) fires on the tag, before studio's bump.

Studio's `^0.5.1 → ^0.7.0` bump rides **slice 2** — the first studio slice that needs the new
types. Slices 3 and 4 need no further bump.

### 5.1 Slice 1 — the contract, crew's campaign store, and the read surface

*(`wicked-crew`; ~275 LOC production)*

- **api-types 0.7.0** as listed in §5.0 (~90 LOC, all declarations).
- `src/campaigns/store.ts` — `CampaignStore`: durable JSON at `~/.wicked-crew/campaigns.json`
  (`WICKED_CREW_CAMPAIGNS` override), atomic write (tmp + rename), tolerant per-row read, modelled
  directly on `ProjectSettingsStore`. Holds `{ id, title, expected, created_at, updated_at,
  runs: { runId: { filed_at, prUrl? } } }`. (~90)
- `LaunchSchema` gains `campaign: z.string().regex(LABEL).optional()`; the post-commit block
  beside the existing `projects.index.set(...)` files the run and adds `campaign` to the
  `run.launched` audit detail. (~15)
- `src/api/campaign-routes.ts` — the four routes of §4.1, `counts` computed over the full filed
  set from `sessions_detail`, `projectIds` from the membership index, and the lazy-once PR
  resolution of §4.3. (~80)

**AC** (HTTP-level, in the standalone harness — no UI yet):

1. Launch two runs with `campaign: "DES-X"` → `GET /campaigns` returns one row with
   `counts.filed === 2` and both run ids in `runIds`.
2. `campaign: "DES X!"` → **400**, and `GET /runs` proves no run was launched.
3. Two runs in `DES-X` filed into *different* projects → that row's `projectIds` has both, in
   first-seen order.
4. `PUT /campaigns/DES-X { expected: 18 }` → the row reports `expected: 18`; **restart the
   daemon** → it still does (durability, not just in-memory state).
5. `PUT /campaigns/DES-X/runs { runIds: [<existing run>, "nope"] }` → **404**, and
   `counts.filed` is unchanged (all-or-nothing).
6. `GET /campaigns` on a daemon with an empty store → **`200 { campaigns: [] }`**, never 404 —
   the discriminator §1.5's probe depends on.
7. Archive a landed run (`POST /runs/:id/archive`) → it disappears from `GET /runs` but
   `counts.landed` and `counts.archived` both still count it (§4.2's whole argument).
8. A run whose deliver phase printed a PR URL → `prs[0].url` is that line verbatim; a run whose
   last output line is not a `/pull/<n>` URL → no `prs` entry (§4.3).

### 5.2 Slice 2 — launch threading in studio

*(`wicked-studio`; ~170 LOC production)*

- `package.json`: `wicked-crew-api-types` `^0.5.1 → ^0.7.0`.
- `src/api/client.ts`: `listCampaigns`, `getCampaign`, `updateCampaign`, `attachCampaignRuns`.
  (~35)
- `src/store/campaigns.ts`: the support probe (§1.5) plus the campaign list, refetched on the
  same tick as `useRuns`. Three states — `unknown | supported | unsupported` — never a boolean,
  so "not probed yet" cannot render as "not supported". (~60)
- `src/components/ChatInput.tsx`: the Campaign combobox of §2.2 — datalist over known ids,
  empty by default, pre-filled from `?campaign=`, absent when unsupported, omitted from the body
  when blank. (~75)

**AC:**

1. Against a daemon that 404s `/campaigns`, the launch form renders **no** campaign field
   (`campaign-field` absent, not disabled) and a launch still succeeds.
2. Against a supporting daemon, the field renders; the datalist offers a label created by an
   earlier run.
3. Typing `DES-X` and launching → `GET /campaigns` files that run under `DES-X`.
4. Submitting with the field blank sends **no** `campaign` key (asserted on the request body,
   not the outcome) and the launch succeeds.
5. Navigating to `/p/<id>/build?campaign=DES-X` pre-fills the field with `DES-X`.
6. §3.7: with the field focused and empty, the form still states what it will launch and offers
   the control that launches it.

### 5.3 Slice 3 — the campaign band on the board

*(`wicked-studio`; ~280 LOC production)*

- `src/hooks/useCampaignModel.ts`: join `CampaignSummary[]` to the board's live `SessionView[]`,
  derive attention, select the runs each card renders. (~85)
- `src/components/CampaignCard.tsx`: §3.3's anatomy at a fixed 148 px, reusing `useRunHeadline`,
  `GateChip`, and `LiveEdge`. (~145)
- `src/components/CampaignBand.tsx`: the collapsible fixed-height row, 4 rendered + `N more ›`,
  hidden entirely at zero active campaigns, collapsed state in `localStorage`. (~50)
- `HomeBoard.tsx`: mount the band above the grid scroller. (~5 — the grid's windowing math is
  deliberately untouched.)

**AC:**

1. One campaign of three runs (1 landed, 1 gate-waiting, 1 executing) with `expected: 3` →
   `campaign-card` renders above `project-board` showing **"1 of 3 landed"**.
2. With `expected` cleared → the same card reads **"1 of 3 landed so far"** (§3.3's denominator
   honesty — two different strings, asserted separately).
3. **Live, on one socket:** while the page sits on `/` and never reloads, a `unitOutputDelta`
   for the executing run updates that card's headline within 2 s, and the project card below is
   untouched (the slice-6 assertion shape, applied to the band).
4. The gate-waiting run's chip is **answerable inline** — approve with no navigation, and the
   card's counts move on the next tick.
5. A campaign whose runs span two projects renders **once** with both project chips, and each
   project's own card still shows its run chip (§3.4's deliberate duplication, asserted from
   both sides).
6. **The 20-card budget holds:** with 20 projects *and* an active campaign band,
   `project-board`'s `data-rendered` is unchanged from the slice-5 assertion and the board stays
   inside the viewport.
7. Zero active campaigns → no `campaign-band` element at all.
8. §3.7: every state of the card answers "what is it doing, and what can I do?" — no bare count
   without a subject, no gate without a control.

### 5.4 Slice 4 — `/campaigns`, `/campaigns/:id`, and filing existing runs

*(`wicked-studio`; ~255 LOC production)*

- `useRoute.ts`: `'campaigns' | 'campaign-detail'` on the `Panel` union + parse. (~15)
- `src/components/CampaignsPage.tsx`: every campaign, active and finished. (~70)
- `src/components/CampaignDetailPage.tsx`: §4.4's table + the `title`/`expected` editor + the
  file-existing-runs control. (~140)
- `RunList.tsx`: a multi-select → "File into campaign…". (~25)
- `InsightRail.tsx` / `CampaignDagStub.tsx`: correct the stub's now-false claim that core has no
  campaign primitive, and point it at `/campaigns/:id`. It stays a stub (§6). (~5)

**AC:**

1. `/campaigns` lists a finished campaign that the band correctly omits (the escape hatch does
   what it exists for).
2. `/campaigns/:id` shows one row per run including an **archived** run marked as such, with the
   PR link on the landed row.
3. Setting `expected` in the editor changes the band's card string on the next tick, with no
   reload.
4. Selecting two runs on `/runs` and filing them into `DES-X` moves `counts.filed` by two, and
   the band's card reflects it.
5. A campaign id that does not exist → the page states that in words and offers `/campaigns`,
   not a spinner (§3.7).

### 5.5 Sequencing notes

- **Slice 1 is a hard prerequisite for 2–4** and is the only cross-repo one. It is also entirely
  invisible to users, so it can land and bake while studio work is written against it.
- **Slices 3 and 4 are independent after slice 2** and can proceed in parallel by different
  authors: 3 touches the board, 4 touches routes and pages.
- **No slice is irreversible.** Reverting slice 3 leaves labels being recorded and readable at
  `/campaigns`; reverting slice 1 leaves the daemon rejecting an unknown field, which slice 2's
  probe already handles as "unsupported". There is no state in this plan where a revert loses an
  operator's data — the store file survives every revert and is re-read by the next install.

---

## 6 Out of scope (named so they aren't assumed)

**Authoring a core campaign DAG from studio.** Dependency edges, `max_concurrency`,
`FailurePolicy`, campaign-level pause/cancel/retry — all of core's DES-CAMPAIGN-001. It needs
the napi binding that does not exist (§1.1). The forward path is §1.3: when it lands, the
scheduler writes the same `campaign` label onto the runs it dispatches, and this surface renders
them with no change.

**The campaign DAG visualization.** `CampaignDagStub` stays a stub. Slice 4 corrects its stale
comment and links it to the detail table; it does not draw a graph. There is no edge data in
this model, and inferring one from launch order would be inventing structure the system does not
have (§4.4).

**Retro-editing a campaign's history.** Un-filing a run, deleting a campaign, merging two
campaigns after a typo fork (§1.2). Filing a run into a *different* campaign already overwrites
the label, which covers the typo case at the cost of a manual pass; the rest waits for a real
operator ask.

**Multi-campaign runs.** A run belongs to at most one campaign (§2.3). "n of m landed" has no
meaning if a run can sit in two denominators.

**Campaign-level governance.** Campaign gates, a campaign acceptance verdict, a campaign-scoped
evidence bundle. Governance is a property of a *run* in this platform, and re-deriving "done"
for an effort from its runs' evidence is a wicked-crew acceptance-gate question, not a board
question.

**Nested campaigns / campaigns of campaigns.** One level. An effort large enough to need two is
an effort that needs the DAG.

**Cross-daemon campaigns.** The store is one daemon's file. A campaign whose runs live on two
daemons is part of the remote-runner story (DES-MERGE-001 §7.9), not this one.

**Campaign-scoped narration or transcript.** The band shows per-run headlines from the existing
store (§2.4). A merged campaign-wide transcript is the surface that would earn a `campaign` tag
on `/ws` frames; §2.4 names the condition.
