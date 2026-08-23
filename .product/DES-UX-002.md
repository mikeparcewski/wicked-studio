# DES-UX-002 — wicked-studio: the agentic terminal of the future (buildable design)

**Status:** DRAFT — design phase
**Date:** 2026-08-23
**Scope:** Design only. No implementation. This is the design-phase deliverable.
**Reads first:** `.product/BRIEF-UX-002.md` (the vision); `.product/DES-UX-001.md` (the
trust-spine design, the floor); `.product/DES-VISION-001.md` (token system §2, composition §1,
slice discipline §6); `.product/DES-FEEDBACK-003.md` (the five-path rail, bottom panel, narrative
landing — this round's substrate).

---

## 0 What this document is, and the law it obeys

This is the buildable design for the UX-002 reimagining: five new surfaces, five slices, and the
cross-repo prerequisites they depend on. Every section names its brief problem before designing
against it; every wire claim is one of:

- **EXISTS** — route/field verified at a file:line in crew src or api-types
- **CLIENT** — derivable from data the studio already holds, with no new daemon request
- **NEEDS-CREW-ENDPOINT** — a confirmed gap, specced in §8, never assumed, never invented

The brief's §6 protect-list is this document's §0 protect-list. Nothing below touches the
gate experience itself, the token system, the morning lede, or the five-path rail — these are
the substrate, not the subject.

### 0.1 Wire law (unchanged from DES-UX-001 §0.2)

> **Wire honesty is law.** No invented routes or fields; every data claim verified against the
> daemon source / `wicked-crew-api-types`; NEEDS-CREW items get their own flagged cross-repo
> slices with schemas specced before any client work; fixtures speak only real shapes; the
> real-bridge contract check must stay green and grow FATAL probes for any new wires.

### 0.2 The definition of done (from BRIEF-UX-002 §7)

The six conditions in the brief's DoD are this document's acceptance test. Slice-level DOM ACs
are necessary but not sufficient — the six conditions, re-tested cold against the live daemon,
are the gate.

---

## 1 The portfolio nerve center (home board v3)

**Brief (quoted):** *"The portfolio nerve center shows which projects have evidence approaching
a gate and which are accumulating evidence without needing the operator's attention."*

**What changes from DES-VISION-001 §1.3 (the current home board):** The attention-banded card
wall and live-feed sidebar are preserved exactly. This section extends the ACTIVE card's anatomy
and structures the live-feed sidebar without touching the attention model or motion grammar.

### 1.1 Current state

The ACTIVE card (NEEDS YOU band) renders:
- A 2px status bar (status color)
- Project name + mode icon row
- One narration line from `boardAttention.ts`
- Gate chip (if escalated) with Approve/Reject

The live-feed sidebar renders per-project blocks: colored dot + name + last 2 narration strings.

Neither surface shows: how far through the work a run is, which phase is active, or that a gate
is about to arrive (versus already arrived).

### 1.2 Wire verdicts

- **EXISTS** `CoreEvent.type = 'unitDispatched'` (`api-types, RecordedEvent`) — carries
  `session_id`, `unit_ix`, `ord` — the current unit's position in the plan.
- **EXISTS** `CoreEvent.type = 'unitPlanned'` — carries `description`, `stage` — the unit's
  description and stage kind.
- **EXISTS** `CoreEvent.type = 'gateEscalated'` — carries `criterion` — the gate's criterion
  text. This fires **before** the gate is visible to the operator, so "gate approaching" is
  literally the event.
- **EXISTS** `GET /runs/:id` → `SessionView` with `units: WorkUnit[]` — ordered units with
  `stage`, `status`, `description`, `ord` — the phase spine. `SessionView` is already fetched
  on run-detail mount; the home board can derive the active unit from live CoreEvents without
  a new fetch.
- **EXISTS** `/ws` CoreEvent relay — the studio already subscribes; `LiveFeed.tsx` proves the
  deltas arrive. The card enrichment reads the same store.
- **CLIENT** phase progress strip — derived client-side from the unit list (`units` ordered by
  `ord`, grouped by `stage`, current unit = the one whose `status === 'distributed'` or `=== 'pending'`
  with the lowest `ord` after the last `done`).

### 1.3 Design

**Active card enrichment — the phase progress strip.**

Below the narration line, above the gate chip (if present), the ACTIVE card gains a
**phase progress strip**: a horizontal row of 3–5 stage nodes, one per distinct `stage` value
in the run's unit plan (recon → build → review → test). The active stage glows
`--status-run-dim`; completed stages are `--status-done`; future stages are `--ink-dim`. Each
node is 8px × 8px, separated by 2px connectors. Overflow (>5 stages) collapses to
`n · 3 remaining` with an honest label.

Beneath the strip, a single mono line shows the current unit's description (truncated to
60 chars: `--font-mono --text-xs --ink-muted`). This replaces the generic narration line ONLY
for cards with an active run — cards with no active run keep the existing narration model.

**Gate-approaching signal.** When `gateEscalated` arrives for a project's active run, the card's
gate chip renders BEFORE the operator has been explicitly pinged — the chip switches from the
"approaching" posture (amber ring, no Approve/Reject buttons yet, criterion text in
`--ink-muted`) to the "awaiting" posture (full amber pill, buttons visible) on `gatePosted`.
This is a preview, not an action surface — it tells the operator which gate is coming so they can
compose a pre-gate annotation (§3) before the decision is demanded.

**Live feed sidebar enrichment.** Each project block in the live-feed sidebar gains structure:
- Line 1: `● project-name` (dot + name, colored by status — unchanged)
- Line 2: `phase n/N · stage-name` (mono, `--ink-muted`, derived from current unit)
- Line 3: The current unit's description, truncated (replacing a raw narration string)
- If a gate is approaching: `⏳ gate: {criterion, truncated to 40 chars}` in amber mono

The sidebar still shows all active projects (not just NEEDS YOU) — this is unchanged from the
vision.

### 1.4 Token usage

Phase strip nodes: `--status-run-dim` (active), `--status-done` (complete), `--ink-dim` (future),
`--surface-card` gap-fill. Criterion preview text: `--status-gate` on `--status-gate-dim` surface
— matching the gate chip vocabulary. No new semantic tokens.

### 1.5 DOM ACs

- With a fixture run in `executing` status with 5 ordered units (2 done, 1 active, 2 pending):
  the ACTIVE card renders `[data-testid="phase-strip"]` with 5 nodes; the active node carries
  `data-active="true"`; the 2 done nodes carry `data-complete="true"`.
- With a `gateEscalated` fixture event: the card renders `[data-testid="gate-approaching"]`
  with `data-criterion` populated BEFORE `gatePosted` fires; no Approve/Reject buttons visible
  in this pre-gate state.
- The current unit description renders in `[data-testid="active-unit-description"]` truncated
  to 60 chars; it updates within one frame cycle of a `unitDispatched` event.
- The live-feed sidebar block for the same project renders `[data-testid="feed-phase-line"]`
  showing `phase n/N · stage-name`.
- Request-tap: the card enrichment fires zero new HTTP requests beyond the existing
  run-detail subscription (all data from /ws relay + already-fetched SessionView).

---

## 2 Run evidence timeline

**Brief (quoted):** *"An operator can navigate a completed run's evidence timeline — reading
the routing decisions, evaluator reasoning, and amendment history in chronological order —
without opening a separate forensics session."*

### 2.1 Current state (post DES-UX-001)

The run detail renders: `FailureBanner` (headline) + `UnitList → WorkUnitDetail` (spine for all
terminal statuses) + `VerdictDetail` card (evaluator reasoning from `gateEvaluated` events) +
diff/files panels. This is the DES-UX-001 repair — unit transcripts are accessible, the
evaluator's reasoning is named, evidence links open the FileViewer. The information is
*accessible*; it is not yet *navigable*.

The unit spine is a vertical list ordered by `ord`. Reading a run's story requires: scrolling
the unit list, entering each unit's transcript, separately opening the VerdictDetail card.
There is no chronological thread that connects dispatch → output → gate → amendment → next phase.

### 2.2 Wire verdicts

- **EXISTS** `GET /runs/:id/events` → `RecordedEvent[]` (routes.ts:1207) — the full event log,
  ordered by `seq`. The following event types collectively constitute a run's timeline:
  - `sessionStarted` — run origin
  - `workflowSelected` — which workflow governs
  - `unitPlanned` — each unit enters the plan
  - `unitDispatched` — unit sent to a CLI (carries `attempt`, `assigned_cli`)
  - `unitOutputDelta` — live output chunks (retained per the probe)
  - `unitOutputCaptured` — transcript finalized
  - `gateEscalated` — gate raised to human
  - `unitReworkAmended` — amend text injected (carries `amendment`, `amended_description`)
  - `gateEvaluated` — verdict (carries `criterion`, `agentReasoning`, `denialReason`,
    `evaluatorPolicies`, `combined`)
  - `stepFailed` / `crashRecoveryRedrive` — worker failure events
- **EXISTS** `AgentSession.retry_of?` — lineage to the parent run; CLIENT can fetch and link.
- **CLIENT** phase grouping — no `phaseStarted`/`phaseEnded` event exists. Phases are derived
  by grouping `unitPlanned`/`unitDispatched` events by the corresponding `WorkUnit.stage`
  field (joined from the SessionView's `units` array). The CLIENT groups events by their unit's
  stage to form phase buckets. This is a client-side grouping operation, not a new wire.
- **NEEDS-CREW-ENDPOINT** explicit phase-boundary events (**CREW-UX-6**, §8.1): optional
  optimization — the current CLIENT derivation is correct but O(units × events). If the event
  log grows large (100+ events), the derivation should be O(events). A future CREW-UX-6 adds
  `phaseStarted`/`phaseEnded` events; this slice ships without it, noting the derivation cost.

### 2.3 Design

The run detail layout gains a **timeline mode**: a left-rail navigator (≈240px) + a detail panel
(remaining width). The existing UnitList/WorkUnitDetail spine remains accessible as a secondary
tab — operators who prefer the list view are not evicted. The default for the first mount is the
timeline view.

**The timeline rail.** A vertical timeline of event groupings in chronological order:

```
run-started       sessionStarted              HH:MM:SS
  ⌐ workflow      workflowSelected            workflow name
  ⌐ phase: recon                              derived bucket
      unit 1      unitDispatched              CLI name, attempt
        ✓ output  unitOutputCaptured          "view transcript"
      unit 2      unitDispatched
        ✓ output  unitOutputCaptured
  ⌐ phase: build
      unit 3      unitDispatched
        ✗ failed  stepFailed                  reason
        ↩ retry   crashRecoveryRedrive        attempt 2
        ✓ output  unitOutputCaptured
  ⌐ gate          gateEscalated → gateEval   criterion text
      verdict     gateEvaluated               pass/deny
      [if amend]  unitReworkAmended           amendment text
  ⌐ phase: review
      ...
run-ended         sessionStatus               terminal status
```

Each row is `--text-sm --font-mono --ink-muted` for event types; `--ink-body` for content.
Active/selected row: `--surface-raised` background. Failed events: `--status-fail-dim` left
border. Gate nodes: `--status-gate-dim` left border. Amendment nodes: `--accent-subtle` left
border.

**The detail panel.** Clicking any timeline row loads the row's detail into the right panel:
- `unitOutputCaptured` → the unit transcript (same render path as WorkUnitDetail, reused)
- `gateEvaluated` → the VerdictDetail card (same component, reused)
- `unitReworkAmended` → the amendment text + the amended unit description, side by side
- `stepFailed` → the failure reason + the crash context (from the event's fields)
- `sessionStarted` → the run's provenance line (audit entry, same as DES-UX-001 §3)

The panel is empty-stated with "select an event to see its detail" when nothing is selected.

**Linked retry chains.** If `AgentSession.retry_of` is set, the timeline's header row shows
"retry of {short-id}" as an `--accent` link; clicking navigates to the parent run's timeline.
This creates a navigable chain of retries without a new surface.

### 2.4 Token usage

Timeline rail: `--surface-rail` background, `--space-4` horizontal padding. Phase bucket
headers: `--ink-dim --text-2xs` uppercase labels — matching the window-label grammar from
DES-UX-001 §5.4. Status borders: reuse the `--status-*-dim` tokens already established.

### 2.5 DOM ACs

- With a fixture run having 8 events (sessionStarted, workflowSelected, 2× unitDispatched,
  2× unitOutputCaptured, gateEscalated, gateEvaluated with deny): the timeline rail renders
  `[data-testid="timeline"]` with 8 or more rows; phase headers group `unitDispatched` events
  by their unit's `stage`.
- Clicking a `unitOutputCaptured` row renders the transcript in `[data-testid="timeline-detail"]`
  within one frame cycle (no new HTTP request for already-fetched output — request-tap: zero
  additional `/units/*/output` fetches if the SessionView already loaded).
- Clicking a `gateEvaluated` row renders `[data-testid="verdict-detail"]` (the DES-UX-001
  component, reused — regression pin: the VerdictDetail test suite must still pass after
  the timeline integration).
- Clicking a `unitReworkAmended` row renders `[data-testid="amendment-diff"]` with the
  `amendment` text and the `amended_description` in a two-column layout.
- A fixture run with `retry_of` renders `[data-testid="retry-link"]` in the timeline header;
  clicking it navigates to the parent run's timeline (`location.pathname` assert).
- The existing UnitList tab remains accessible via `[data-testid="tab-unit-list"]` and renders
  unchanged (regression pin on the DES-UX-001 unit-spine ACs).

---

## 3 Work chronicle (project view)

**Brief (quoted):** *"A project's work chronicle shows retry chains as grouped episodes;
the operator understands the project's direction from the chronicle without reading individual
run details."*

### 3.1 Current state

The project Build tab (post DES-UX-001 slice S) shows a list of runs scoped to the project's
membership, with synthesized titles and timestamps (from DES-UX-001 §7.5). It is a list: flat,
ordered by attach time, treating each run as a peer.

Retry chains are invisible: run A and its retry B appear as two sibling rows with identical
intents and different short-ids. The relationship is in `retry_of` on the DTO; nothing renders it.

### 3.2 Wire verdicts

- **EXISTS** `GET /projects/:id/members` → membership run ids (routes.ts:8–10)
- **EXISTS** `AgentSession.retry_of?` (api-types 0.8.0) — the lineage link between runs;
  the CLIENT groups runs into chains by following the `retry_of` link.
- **EXISTS** `AgentSession.attempt` — the attempt ordinal within a chain.
- **EXISTS** `AgentSession.project_id?` (api-types 0.8.0) — confirmed present; the join
  from DES-UX-001 slice S is already in place.
- **CLIENT** chain assembly — the studio fetches runs by membership, then groups by following
  `retry_of` links: a run with no `retry_of` is the chain root; runs whose `retry_of` names
  an existing member are appended to the chain. O(n) pass over the membership list.

### 3.3 Design

The project Build tab becomes the **work chronicle**: runs are grouped into episode chains,
presented chronologically by chain root.

**Episode chain card.** A chain of one or more runs renders as a single expandable card:
- Header: intent (truncated problem), chain status (the terminal status of the latest run),
  total attempts (n attempt/s), total duration, date range (first attempt → last verdict).
- Collapsed state: one row, ~48px — the "quiet" posture for a resolved chain.
- Expanded state: each attempt listed beneath as a sub-row, ordered by `attempt` ascending.
  Sub-row: attempt ordinal (attempt #n), status badge, duration, short-id, "view timeline" link.
- The latest attempt is expanded by default for in-progress chains; all collapsed for resolved chains.

**Chain status semantics:** `completed` if any attempt completed; `failed` if all attempts
failed; `executing` if the latest attempt is running.

**The current state strip.** At the top of the chronicle (above the first chain), a strip shows
the "current state of this project's build work" — derived from the most recent completed run's
key events: the last `gateEvaluated` criterion that passed, the last `workflowSelected`, and
a count of completed phases. This is the CLIENT's best synthesis of "what did this project
accomplish?" without a new endpoint.

Exact copy format: `Last completed run: {short-title} · {N} phases · {date}`. No fabrication —
if no completed run exists, the strip says "No completed run yet — this project's first successful
build will appear here."

**Pre-launch guidance summary.** At the bottom of the chronicle, a `[data-testid="guidance-summary"]`
panel shows the operator's last 5 gate amendments for this project (from `GET /audit?action=gate.decided`
filtered client-side to runs in the project's membership). Each amendment is one line:
`{run short-id} · {phase: criterion} · "{amendment text}"`. A "use in next run" action
opens the composer with the amendment text pre-populated in the steer field. This is the
CLIENT-SIDE guidance history — no new endpoint; the audit fetch is gesture-gated (the panel
loads when the operator scrolls to or explicitly opens it).

### 3.4 Token usage

Episode chain card: `--surface-card` collapsed, `--surface-raised` when expanded (matching the
existing project card vocabulary). Chain status badge: reuses `--status-*` tokens. Amendment
lines: `--ink-muted --font-mono --text-xs`. Pre-launch panel: `--surface-raised` with an
`--accent-subtle` left border (marking operator-authored content).

### 3.5 DOM ACs

- With a fixture project whose membership contains 3 runs where run B has `retry_of === run A`
  and run C is standalone: the chronicle renders 2 chain cards (one AB chain, one C card).
  Chain AB's header shows `attempt 2`; its sub-rows list attempt 1 and attempt 2 in order.
- Chain AB's sub-row for attempt 2 renders `[data-testid="attempt-row"][data-attempt="2"]`
  with a `[data-testid="view-timeline"]` link that navigates to run B's evidence timeline.
- The current state strip renders `[data-testid="chronicle-state"]` with the last completed
  run's criterion phrase; with no completed run in the fixture, it renders the exact no-run copy.
- The guidance summary panel loads zero HTTP requests on chronicle mount (gesture-gated assert);
  on explicit open, exactly one `GET /audit?action=gate.decided` fires (request-tap).
- "Use in next run" opens the composer with the amendment text in `[data-testid="steer-prefill"]`.

---

## 4 Steering annotation layer

**Brief (quoted):** *"An operator can add pre-gate guidance from the home board; it
pre-populates the amend field when the gate arrives."*

### 4.1 Current state

The gate experience (§0 protected) today: when `gatePosted` arrives, the gate card renders
a plain-language ask (the `criterion`), an Approve button, an Approve+steer button (expands a
freeform textarea), and a Reject button. The steer textarea is freeform; the operator types from
scratch; nothing from the project's history pre-populates it.

The home board's gate chip renders Approve/Reject buttons inline. There is no pre-gate annotation
affordance — the operator cannot compose guidance before the gate is formally presented.

### 4.2 Wire verdicts

- **EXISTS** `POST /runs/:id/gate` → `{allow: boolean, amend?: string}` (api-types, §350) —
  the amend field is the existing steer channel; it is injected into the unit's description
  before re-dispatch (`unitReworkAmendedEvent` confirms the injection is real, not advisory).
- **EXISTS** `CoreEvent.type = 'gateEscalated'` — fires when the gate is raised to human;
  carries `criterion: string`. This is the "gate approaching" signal.
- **EXISTS** `GET /audit?action=gate.decided` (routes.ts:266) — carries the `amend` text in
  the entry's `detail` field when an amendment was supplied.
- **CLIENT** pre-gate annotation — a `Map<runId, string>` held in the run store; populated
  before the gate arrives; pre-filled into the steer textarea when `gatePosted` fires. No new
  wire — the annotation is a client-side draft that resolves into the existing `amend` field.
- **NEEDS-CREW-ENDPOINT** durable pre-gate annotation (**CREW-UX-4**, §8.2): the CLIENT draft
  is session-scoped and does not survive tab close or other-session access. A persistent
  annotation on the run record would allow multi-session operators and future agent consumption.
  Specced in §8.2; this slice ships the CLIENT version with an honest "this annotation is only
  visible in this browser session" label.

### 4.3 Design

**Pre-gate annotation.** On the home board, when a project's active run enters the "gate
approaching" state (from §1.3 — `gateEscalated` received, `gatePosted` not yet received),
the gate-approaching chip gains a `[+ add note]` affordance (inline, one click). Clicking opens
a 3-line inline textarea within the card; the operator types guidance; it is saved to the
client draft store keyed by `runId`. An `--ink-dim` `--text-2xs` label: "saved for this browser
session only — durable annotations land with CREW-UX-4."

When `gatePosted` fires for the same run, the gate card's Approve+steer section expands
automatically (not requiring a click) with the draft text pre-populated in the amend textarea.
The operator can edit, clear, or accept. The steer textarea still degrades gracefully: if no draft
exists, it is blank as today; if CREW-UX-4 has landed, it reads from the persistent record.

**Structured steer (non-freeform option).** The amend textarea gains three labeled prefixes the
operator can inject with keyboard shortcuts: `Focus:`, `Skip:`, `Context:`. These are not
enforced structure — they are typed into the freeform field as text. The keyboard shortcuts
(Ctrl+F, Ctrl+K, Ctrl+X within the textarea) insert the prefix at the cursor. This does not
change the wire — `amend` remains a string; the structure is a convention the operator adopts,
not a daemon-enforced schema. Documented in the '?' overlay (DES-UX-001 §7.7 AC: the overlay
is the source of truth for all shortcuts, including these new in-gate ones).

### 4.4 Token usage

Pre-gate annotation widget: `--surface-raised` background, `--ink-muted` placeholder text,
`--ink-dim --text-2xs` session-scope label. Steer textarea pre-populated: `--ink-body` text
on `--surface-raised` — same dress as the existing Approve+steer textarea; no new tokens.

### 4.5 DOM ACs

- With a fixture run receiving `gateEscalated` (not yet `gatePosted`): the home board card
  renders `[data-testid="gate-approaching"]` with `[data-testid="pre-gate-annotate"]` visible.
- Typing in the annotation field and then receiving `gatePosted` (fixture): the gate card's
  steer textarea renders `[data-testid="amend-prepopulated"]` with the typed text as its value.
  Zero additional HTTP requests fire between annotation save and gate arrival (request-tap).
- The session-scope label renders `[data-testid="annotation-scope-label"]` with the exact
  honest copy until CREW-UX-4 lands; once landed, the label is absent.
- Ctrl+F within the steer textarea inserts `Focus: ` at the cursor (keyboard event assert).
- The '?' overlay lists "Focus: / Skip: / Context: steer prefixes" under the gate shortcut group.

---

## 5 Navigation and information architecture

### 5.1 What this round does NOT touch

The five-path rail (Projects / Make / Chat / Repositories / Settings), the bottom panel for
ambient run state, the `?` shortcut overlay, the palette, and all DES-FEEDBACK-003 surfaces
are the substrate. This round extends them; it does not restructure.

### 5.2 New routes and entry points

| New surface | Route | Entry points |
|---|---|---|
| Run evidence timeline | `/runs/:id/timeline` (alias: `/runs/:id` navigates to timeline by default) | Run row "view timeline" link; retry chain sub-row; home board card click (during executing); provenance cross-link |
| Work chronicle | `/p/:id/chronicle` (new tab on project shell, replacing Build's flat list) | Project shell tab navigation; home board card link from QUIET band |
| Guidance summary panel | Panel within `/p/:id/chronicle` | Scroll into view or explicit "past guidance" button in chronicle header |

The existing `/runs/:id` route: currently shows the run detail. This round makes the timeline the
default layout for that route; the unit-list tab is tab 2 (regression pin: the existing DOM ACs
for unit-list rendering must still pass).

### 5.3 IA changes to existing surfaces

- **Project shell tabs:** Add `Chronicle` tab alongside the existing `Build`, `Chat`, `Document`,
  `Repository` tabs. The `Build` tab retains the existing flat run list for operators who prefer
  it; the `Chronicle` tab is the new default for a fresh project view.
- **Home board ACTIVE card click:** Navigates to `/runs/:id/timeline` for the project's active
  run (today: navigates to `/p/:id`). The card's project name row remains the project-shell link.
- **Home board QUIET band rows:** Already link to `/p/:id`. No change.

### 5.4 Keyboard extensions (through the one registry)

All new shortcuts register through the shortcut registry (DES-UX-001 §7.7, EC42):

| Shortcut | Context | Action |
|---|---|---|
| `t` | Run detail | Switch to timeline tab |
| `u` | Run detail | Switch to unit-list tab |
| `n` | Home board, gate-approaching chip | Open pre-gate annotation widget |
| Ctrl+F | Within steer textarea | Insert `Focus: ` at cursor |
| Ctrl+K | Within steer textarea | Insert `Skip: ` at cursor |
| Ctrl+X | Within steer textarea | Insert `Context: ` at cursor |

---

## 6 Wire verdict summary table

| Surface | Wire | Verdict | §8 prerequisite |
|---|---|---|---|
| Phase progress strip | `/ws` CoreEvents: `unitDispatched`, `unitPlanned` | **EXISTS** | — |
| Gate-approaching signal | `/ws` `gateEscalated` | **EXISTS** | — |
| Live feed phase line | `/ws` + `GET /runs/:id` SessionView | **EXISTS** + **CLIENT** | — |
| Evidence timeline rail | `GET /runs/:id/events` RecordedEvent[] | **EXISTS** | — |
| Timeline: unit transcript | `GET /runs/:id/units/:unitKey/output` | **EXISTS** | — |
| Timeline: gate verdict | `GET /runs/:id/events` gateEvaluated | **EXISTS** | — |
| Timeline: amendment diff | `GET /runs/:id/events` unitReworkAmended | **EXISTS** | — |
| Timeline: retry link | `AgentSession.retry_of` | **EXISTS** (0.8.0) | — |
| Work chronicle chain grouping | `AgentSession.retry_of`, `attempt` | **EXISTS** (0.8.0) | — |
| Chronicle current state strip | `GET /runs/:id/events` gateEvaluated | **EXISTS** (CLIENT derivation) | — |
| Guidance summary panel | `GET /audit?action=gate.decided` | **EXISTS** (CLIENT filter on run ids) | — |
| Pre-gate annotation (session) | Client draft store + existing `POST /runs/:id/gate amend` | **CLIENT** | — |
| Pre-gate annotation (durable) | New `PUT /runs/:id/guidance` | **NEEDS-CREW-ENDPOINT** | CREW-UX-4 §8.2 |

ASSUMPTION[external-transform] library=wicked-interactive transform=doc-thread sends are converted to doc-version runs and emitted back as `wicked.interactive.version.created`; mid-run sends queue behind the active run confidence=known :: Confirmed by BRIDGE-UX-1 probe 1 (DES-UX-001 §8.4.1): the bridge QUEUES — accepts `200 {ok}` independent of run state; the bus is the queue.

---

## 7 Cross-repo prerequisite slices (NEEDS-CREW-ENDPOINT — specced, flagged, never assumed)

### 7.1 CREW-UX-6 — phase boundary events (optional optimization, unblocks timeline LOC)

**Gap (CLIENT-derivable today):** No `phaseStarted`/`phaseEnded` events exist. The evidence
timeline groups events into phase buckets by joining `unitDispatched.unit_ix` to
`SessionView.units[ix].stage` — O(events × units). For runs with ≤50 units this is imperceptible.
For runs with >100 events it may be measurable.

**Spec (optional, post-launch):** `phaseStarted: {session_id, stage: StageKind, ts}` and
`phaseEnded: {session_id, stage, ts, units_completed: number}` emitted by the engine at stage
transitions. Client-side grouping becomes O(events). ~60 LOC in crew engine; additive; old
clients ignore unknown event types. This slice ships CLIENT derivation; CREW-UX-6 is
optimization, not correctness.

### 7.2 CREW-UX-4 — durable pre-gate annotation (unblocks §4's NEEDS-CREW gap)

**Gap (verified):** No endpoint exists for persisting operator annotations on a run between
sessions. The CLIENT draft is session-scoped; tab close loses it.

**Spec:** `PUT /runs/:id/guidance` with body `{text: string}` — upserts a single guidance note on
the run record; `GET /runs/:id` includes `guidance?: string` in the DTO. The governance gate
(the engine's `LaunchOptions`) does not read this field — it is operator-visible context, not
an agent-injected prompt. The amend text at gate decision is still the injection point; the
guidance field surfaces in the studio's steer textarea pre-population. ~70 LOC crew side; additive
DTO field (optional, old clients unaffected). Specced independently; this slice ships without it
with the honest session-scope label.

---

## 8 Slice plan

### 8.0 Inherited rules (DES-VISION-001 §6.0, unchanged)

One slice = one PR through the full merge protocol; each ≤~350 production LOC (overruns disclosed
and partitionable); each carries its named shots, unit tests, a rig, its rig re-scopes as
dedicated commits, and survives adversarial verification before landing.

### 8.1 Slices (5 studio slices)

**Slice BA — portfolio nerve center: active card enrichment** *(~320 LOC)*
Phase progress strip on ACTIVE cards; current unit description line; gate-approaching chip
variant with criterion preview; live-feed sidebar phase line. Reads §1 throughout.
*Repairs brief DoD condition 1 ("see live evidence accumulating without entering the run").*
Shots: `ux-BA-phase-strip.png`, `ux-BA-gate-approaching.png`, `ux-BA-feed-phase.png`.

**Slice BB — run evidence timeline** *(~350 LOC)*
Timeline rail + detail panel layout; event grouping by phase; unit transcript viewer (reused);
VerdictDetail in panel (reused); amendment diff view; retry-link header; timeline-mode as
default layout for `/runs/:id`; unit-list tab preserved.
*Repairs brief DoD conditions 3 and 4 ("navigate evidence timeline"; "failed run diagnosed in
sixty seconds").*
Shots: `ux-BB-timeline-rail.png`, `ux-BB-gate-verdict.png`, `ux-BB-amendment-diff.png`.

**Slice BC — work chronicle** *(~330 LOC)*
Project Chronicle tab; episode chain card with retry sub-rows; chain status derivation;
current state strip with honest empty state; guidance summary panel (gesture-gated with
audit fan-out); "use in next run" composer prefill.
*Repairs brief DoD condition 5 ("chronicle shows retry chains grouped; operator understands
project direction without reading individual runs").*
Shots: `ux-BC-chronicle.png`, `ux-BC-chain-expanded.png`, `ux-BC-guidance-panel.png`.

**Slice BD — steering annotation layer** *(~280 LOC)*
Pre-gate annotation widget on home board; session-scoped draft store; steer textarea
auto-expand with pre-population on `gatePosted`; session-scope label (honest); structured
steer keyboard shortcuts (Ctrl+F/K/X) registered through the shortcut registry; '?' overlay
update.
*Repairs brief DoD condition 2 ("add pre-gate guidance from home board; pre-populates amend
field when gate arrives").*
Shots: `ux-BD-pre-gate-annotate.png`, `ux-BD-steer-prepopulated.png`.

**Slice BE — CREW-UX-4 adoption + navigation wiring** *(~200 LOC)*
Depends on CREW-UX-4 landing. Adopts durable guidance endpoint: steer textarea reads from
`GET /runs/:id` `guidance` field; session-scope label retires; "save guidance" action writes
`PUT /runs/:id/guidance`. Also wires the new routes (chronicle tab, timeline default), the
keyboard extensions (`t`, `u`, `n`), and the IA changes (§5.2–5.3).
*Completes brief DoD condition 6 ("portfolio nerve center shows approaching gates and
evidence-accumulating projects"). Also unblocks multi-session annotation.*
Shots: `ux-BE-durable-guidance.png`, `ux-BE-nav-chrome.png`.

### 8.2 Sequencing

1. **BA** — no prerequisites; can ship immediately. Evidence accumulation is visible.
2. **BB** — no prerequisites; can ship in parallel with BA. The timeline is the highest-value
   surface and should not wait.
3. **BC** — depends on BA for the phase-line vocabulary (shared tokens); light dependency,
   can proceed in parallel with minimal coordination.
4. **BD** — depends on BB (the timeline's `gateEscalated` handling proves the event model);
   and on BA (gate-approaching chip from §1.3 is BD's trigger point). Sequence after BA.
5. **CREW-UX-4** (crew repo) → **BE** — BE waits for the crew endpoint; BA/BB/BC/BD ship first.
6. The **re-review** (BRIEF-UX-002 §7 DoD, six conditions): runs after BE.

### 8.3 Rig re-scopes

- Existing `/runs/:id` rig: add `[data-testid="tab-unit-list"]` existence assert and re-verify
  all unit-spine ACs hold in the new two-tab layout (slice BB dedicated commit).
- Existing home board rig: add phase-strip and gate-approaching fixtures; re-scope any assertion
  that fires on the first ACTIVE card and may now see the phase strip (slice BA dedicated commit).
- `feedback3_sliceN` steer textarea assertions: re-scope to the pre-populated state contract
  (slice BD dedicated commit).

---

## 9 New experience-checklist items (extends EC45)

- **EC46 — Active runs show evidence progress.** An active run's ACTIVE card renders the phase
  progress strip and current unit description; the live-feed sidebar block shows phase/N ·
  stage. (§1)
- **EC47 — Gate arrival is preceded by signal.** A gate-approaching chip renders from
  `gateEscalated` before the gate is formally presented; it names the criterion. (§1, §4)
- **EC48 — Run history is a navigable timeline.** The run detail's default layout is the
  evidence timeline; every terminal-status event is reachable by clicking one row. (§2)
- **EC49 — Amendment history is explicit.** `unitReworkAmended` events render in the timeline
  as amendment diffs — original description vs amended description, side by side. (§2)
- **EC50 — Retry chains are grouped.** A project's chronicle groups runs by `retry_of` lineage;
  retry siblings appear as sub-rows of one episode card, not as peer rows. (§3)
- **EC51 — Pre-gate guidance is composable before the gate arrives.** The operator can type
  guidance from the home board's gate-approaching chip; it appears pre-populated in the
  steer textarea when the gate formally arrives. (§4)
- **EC52 — Session-scoped annotations declare their scope.** Any annotation or draft that will
  not survive tab close carries a visible, honest scope label in operator language. (§4)
- **EC53 — Chronicle states are honest.** The "current state" strip derives from the last
  completed run's evidence; if no completed run exists, it says so exactly — never fabricates
  a state. (§3)

---

## 10 Open questions + out of scope (named)

- **⚠ OPEN QUESTION: CREW-UX-4 timing.** Slice BE depends on the crew endpoint for durable
  guidance. The CLIENT version (slice BD) ships without it. Operator decision required: should
  BE block on CREW-UX-4, or should the session-scoped version ship indefinitely? The honest
  scope label gives operators signal; "indefinitely" is acceptable if CREW-UX-4 is low priority.
- **⚠ OPEN QUESTION: chronicle as default project view.** §5.3 adds the Chronicle tab alongside
  the Build tab. Whether Chronicle replaces Build as the default (hiding the flat list) or is
  an additive tab requires operator confirmation before slice BC builds. This document proposes
  additive; the brief implies Chronicle should be the primary mental model.
- **Cross-project audit filtering by project:** `GET /audit` supports `?action=` and `?runId=`
  filters; a `?projectId=` filter does not exist. The guidance summary panel works around this
  by fetching per-run audit entries (gesture-gated). If the fan-out proves slow, CREW-UX-5
  (`?projectId=` filter on audit) is a 20-LOC crew addition — not specced here, flagged as a
  follow-up if measured latency exceeds 300ms in the rig.
- **Agent-readable guidance:** The `guidance` field (CREW-UX-4) is operator-visible context
  in the studio. Whether the engine reads it as part of a unit's context at dispatch is a
  crew-engine design decision, not a studio concern. This document does not design for
  agent-readable guidance; that is a future brief item.
- **Portfolio metric tiles (burn by project):** The brief DoD condition 6 speaks to "evidence
  approaching a gate" — delivered by the BA phase strip. It does not ask for per-project burn
  aggregation. A future CREW-UX-7 (burn pre-aggregated per project on the daemon) would enable
  metric tiles; that is out of scope this round.
- **Mobile treatments / route renames:** unchanged from DES-FEEDBACK-003 §11; the 1440×900
  operator viewport governs.

---

## 11 Traceability

| Brief DoD condition | Sections | Slices | Wire verdict summary |
|---|---|---|---|
| 1. See evidence accumulating without entering run | §1 | BA | **EXISTS** CoreEvents: `unitDispatched`, `unitPlanned`, `gateEscalated` over /ws relay |
| 2. Add pre-gate guidance from home board; pre-populates amend | §1.3, §4 | BA, BD, BE | **EXISTS** `gateEscalated` (signal) + `POST /runs/:id/gate amend` (delivery); **CLIENT** draft store; **NEEDS-CREW** CREW-UX-4 for durable |
| 3. Navigate completed run evidence timeline | §2 | BB | **EXISTS** `GET /runs/:id/events` RecordedEvent[]; **CLIENT** phase grouping |
| 4. Failed run diagnosed in sixty seconds | §2 | BB | **EXISTS** `gateEvaluated.denialReason` + `agentReasoning` + `unitOutputCaptured` transcript |
| 5. Chronicle shows retry chains; project direction legible | §3 | BC | **EXISTS** `retry_of`, `attempt` on AgentSession (0.8.0); **CLIENT** chain assembly |
| 6. Portfolio nerve center shows gate-approaching + quiet accumulation | §1 | BA | **EXISTS** `gateEscalated` (approaching) + `unitDispatched`/`unitPlanned` (progress) |
