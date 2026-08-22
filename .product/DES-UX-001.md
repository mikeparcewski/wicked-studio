# DES-UX-001 — wicked-studio: the trust-spine response (from verified machinery to trusted terminal)

---

## 0 What this document is, and the law it obeys

This is the design response to `.product/BRIEF-UX-001.md` — the six-journey staff-engineer
usability review of the live product. The brief's words govern: every section below quotes
its problem before designing against it, and the brief's definition of done is this
document's definition of done — **the six journeys, re-run cold by a skeptic, complete
without hitting any A/B-class problem. Machinery-level ACs are necessary but not
sufficient; the journey is the acceptance test.**

**Provenance.** Authored by governed run `3eda2129` (clarify + design phases, operator-
gated at clarify). The run's build-phase revision was lost to a worker wedge — the bridge
went silent mid-turn for 55 minutes with a queued, undelivered steer (crew#288 field
evidence; run cancelled; the reap destroyed the uncommitted worktree, core#291's failure
mode). This document was reconstructed by the operator loop from the run's design-phase
output, verbatim captures of the lost document's key sections, and freshly re-verified
wires — with the operator's three steering points applied (§1.3/§1.5 retention empty
state, §6.3 stopgap contract, §11.3 sequencing). Where the reconstruction could not
re-verify a lost claim, it says **verify at slice time** rather than asserting.

### 0.1 The brief's §0 is protected here, explicitly

Nothing in this design touches the posture of: the morning lede + needs-you-first wall +
24h activity river; the gate experience end-to-end (plain-language ask, Approve /
Approve+steer / Reject, policy provenance, toast + status-bar + amber simultaneity, the
honest "Waiting for your input… → Run resumed" record); the honesty-label house style
("observed", "by files indexed", the search-corpus disclosure with [why?]); live-everything
updates; browser-history honesty; the repo profile + code graph; the composer's + drawer
capabilities; council/evaluator transparency chips; the Burn panel; palette prefix
self-teaching; the Theme page. Every fix below *extends* the honesty style — the brief is
explicit that the §C contradictions are violations of that style, and "the fix direction is
more honesty, never less labeling."

### 0.2 The wire rule (house law — quoted from the brief, unchanged)

> **Wire honesty is law.** No invented routes or fields; every data claim verified against
> the daemon source / `wicked-crew-api-types`; NEEDS-BACKEND items get their own flagged
> cross-repo slices with schemas specced before any client work; fixtures speak only real
> shapes; the real-bridge contract check must stay green and grow FATAL probes for any new
> wires.

Every wire verdict in this document is one of: **EXISTS** (route/field verified at a
file:line in the crew or bridge source), **CLIENT** (derivable from data the studio already
holds), or **NEEDS-CREW-ENDPOINT / NEEDS-BRIDGE** (a confirmed gap, specced in §8 as its
own prerequisite slice — never assumed, never invented).

### 0.3 The six journeys (the acceptance test — brief's words)

> A failed run diagnosed from its page in under two minutes; a project's Build tab showing
> exactly its runs; a document iterated twice with both edits landing and the thread
> surviving reload; a chat whose first send succeeds and whose session is findable
> afterward; every count on one screen consistent; '?' answering the keyboard question.

Each slice in §11 names the journey steps it repairs. §14 traces every brief item to its
sections, slices, and wire verdicts.

---

## 1 A1 — Failed runs must answer "why did this fail" (CRITICAL)

**Brief (quoted):** *"A failed run's page shows only a one-line verdict ('Rejected: phase
produced no reviewable substance'). Completed runs render unit output; failed runs render
none. Every escape hatch dead-ends… One reviewer spent 15 minutes of forensics to infer a
missing-repo root cause the system knew and never said."*

### 1.1 Current state — five separate dead ends, pinned

1. The run view renders the unit spine (`UnitList` → `WorkUnitDetail`) for `completed`
   runs but collapses `failed`/`cancelled` runs to `FailureBanner`'s one-line verdict
   (`src/components/FailureBanner.tsx`) — the transcript render path exists and is simply
   not taken for the statuses that need it most.
2. The evaluator's reasoning is never shown anywhere: which phase gated, what it saw, what
   it rejected — all absent from the page.
3. "Full diff" surfaces raw `API 409: run … has no workdir` for repo-less runs, and on
   historical runs hangs on "Loading…" forever **while firing zero network requests** — a
   frontend state bug (the request never dispatches).
4. The per-file Diff tab reports "no changes to this file" for files the run demonstrably
   created and committed — the daemon's diff baseline is the working tree vs HEAD, not the
   run branch vs its base (see §8.1).
5. Evidence links (the underlined NOTES.md reference) do nothing on click; the Term tab
   opens an empty "Operator shell" as the default landing for a diagnosing operator.

### 1.2 Wire verdicts (verified — two brief guesses corrected)

- **EXISTS** `GET /runs/:id/units/:unitKey/output` — crew `api/routes.ts:830`. Unit
  transcripts are stored when a unit's gate resolves, for every terminal status. The
  brief's "worker-output retention may be NEEDS-BACKEND" is **corrected → CLIENT**: the
  data is served today; the studio never renders it for failed runs.
- **EXISTS** `GET /runs/:id/events` — crew `api/routes.ts:1207` — carrying `gateEvaluated`
  events with the evaluator's verdict material (behaviorally confirmed on live runs).
- **EXISTS** `GET /runs/:id/files` (crew `api/routes.ts:423`) + the slice-I FileViewer —
  the evidence-link render path already exists in the client.
- **NEEDS-CREW-ENDPOINT** branch-vs-base diff baseline: `worktreeDiff` invokes
  `git diff --no-color --no-ext-diff HEAD` (crew `api/run-files.ts:111`) — uncommitted
  work only. Committed run work is invisible to it by construction. Specced as
  **CREW-UX-1** (§8.1).

### 1.3 Design

A failed run's page becomes a **legible post-mortem**, not a verdict stub. Four changes:

1. **Units are the spine for every terminal status.** The run view renders the ordered
   `UnitList` → `WorkUnitDetail` for `failed`/`cancelled` runs exactly as it does for
   `completed`, so each unit's captured transcript (already auto-loaded for `rejected`,
   `WorkUnitDetail.tsx:38`) is present. `FailureBanner` stays as the *headline* above the
   list, not the whole story.
2. **An evaluator verdict card.** A new `VerdictDetail` block reads the run's
   `gateEvaluated` events (from the already-fetched event log) and states, for the
   deciding phase: the `criterion` gated, the `agentVerdict` + `agentReasoning`, the
   `denialReason`, and whether a deterministic floor or evaluator layer ran
   (`hasDeterministicFloor` / `evaluatorPolicies` — an empty policy set alongside
   `evaluatorPass:true` is a vacuous default-allow and is labeled as such, per
   FINDING-025). This is the "which phase, what it evaluated" the brief asks for.
3. **An honest empty state for absent records.** Historical runs whose event logs carry no
   `gateEvaluated` entries (event retention predates the run, or the log was pruned) render
   the card in its empty dress: **"no evaluator record survives for this run"** — the card
   never renders blank, and never fabricates a verdict from the one-line status.
4. **Every escape hatch resolves to a real answer.** The `FilesPanel` "Full diff" and
   per-file diff paths gain: (a) a **named-cause card** when the daemon returns 409 —
   "This run had no repository attached — nothing was produced to review" for the
   no-workdir case, and "This run's workdir no longer exists" for the deleted-workdir
   case; (b) an **error/empty branch with a timeout** so a never-resolving diff shows
   "Couldn't load the diff — retry" instead of an eternal "Loading…" that fired no
   request; (c) the **evidence reference wired** to `readRunFile` → the FileViewer
   overlay (slice I's viewer, reused). The Term tab, when a run has a captured
   transcript, offers **"View this run's transcript"** (the unit output) rather than
   only the empty operator shell — the ungoverned shell stays available as a labeled,
   secondary action, never the default a diagnosing operator lands on.

Branch-vs-base is the one piece that needs the daemon (§8.1): once CREW-UX-1 lands, the
per-file and full diffs pass `?base=merge-base` and the "no changes to a committed file"
symptom disappears. Until it lands, the diff view **labels its own baseline honestly** —
"showing uncommitted changes vs HEAD; committed work is not shown here" — so the operator
is never silently misled (the brief's honesty law).

### 1.4 Token usage

Verdict card: `--status-fail` heading on `--status-fail-dim` surface; reasoning body in
`--ink-body`; the criterion in `--ink-muted` mono. Named-cause cards: `--surface-raised`
with `--ink-muted` body and an `--accent` remediation link. The verdict card's empty dress:
`--ink-dim` body on `--surface-raised`, no status color (an absent record is not a
failure signal). No raw color (EC15 holds).

### 1.5 DOM ACs

- With a `failed` fixture run carrying ≥1 unit with captured output: `[data-testid="work-unit"]` renders for the failed run; its `[data-testid="unit-transcript"]` auto-opens (rejected-unit contract preserved).
- `[data-testid="verdict-detail"]` renders for a failed run whose events include a `gateEvaluated` deny; it names the phase (`data-phase-ord`), shows the `agentReasoning` text, and — when `evaluatorPolicies` is empty beside `evaluatorPass:true` — renders `[data-vacuous="true"]` with the "default-allow" label.
- For a failed fixture run whose event log contains **no** `gateEvaluated` entries, `[data-testid="verdict-detail"]` renders `[data-empty="true"]` with the exact copy "no evaluator record survives for this run" — never an empty card, never a fabricated verdict.
- Full diff on a repo-less fixture run renders `[data-testid="diff-named-cause"]` with the no-repository copy — and **the raw string `API 409` / `has no workdir` never appears in the DOM**.
- Full diff on a historical fixture run whose diff never resolves renders `[data-testid="diff-error"]` within the timeout budget, never an indefinite "Loading…"; a network request WAS attempted (request-tap asserts ≥1 `/diff` fetch on open — the zero-request hang is the regression this pins).
- An evidence reference is an `<a>` that, on click, opens `[data-testid="file-viewer"]` populated from `readRunFile` (no dead click).
- While CREW-UX-1 is unlanded, the diff view carries `[data-testid="diff-baseline-note"]` naming its HEAD baseline honestly.

---

## 2 A2 — Project binding must persist and project views must mean it (CRITICAL)

**Brief (quoted):** *"Runs launched with a project selected (chip visibly set) record as
'Unfiled' and are absent from that project's Build list; the home board shows 'NOT IN A
PROJECT (62)'; a fresh project's Build tab lists nine foreign runs… footer counters remain
global inside project views."*

### 2.1 Current state — the chip sends, the DTO forgets, the views read the wrong source

The composer genuinely carries the binding: `ChatInput.tsx:46/136` documents and sends
`projectId` in the POST body (Unfiled = no key — the slice-B contract, wire-proven). The
daemon genuinely records it: `LaunchSchema.projectId` (crew `api/routes.ts:148`) attaches
membership **atomically with the launch record** — its own comment says "never a silent
unfiled run." And yet the journey saw Unfiled: because **the run DTO carries no project**
(`AgentSession`, `crew-api-types/index.d.ts:141` — no `project_id` field), every surface
that renders a run from the runs list alone cannot attribute it. Project Build tabs and
footer counters read global stores; the membership record — the truth — is consulted only
by the board's mirror. Where the *UI* additionally drops the id before POST (the review's
J5 observation on a specific entry point), that entry point is repaired in slice S —
**verify at slice time** which launch surfaces beyond the composer drop the binding.

### 2.2 Wire verdicts (verified)

- **EXISTS** `GET/POST /projects/:id/members` — crew `projects/routes.ts:8-10` — the
  membership record is the system of record for run↔project.
- **EXISTS** `LaunchSchema.projectId` — crew `api/routes.ts:148` — atomic attach, launch
  fails on unknown/archived project (never silently unfiled).
- **NEEDS-CREW-ENDPOINT** `project_id` on the run DTO: `AgentSession` has no project
  field, so every run-list consumer must join membership client-side or stay ignorant.
  Specced as **CREW-UX-2** (§8.2) — the DTO echoes the membership record.

### 2.3 Design

1. **Every launch entry point carries the binding** — the composer already does; the
   project-card Chat button, the repo-register form, and any surface launched from a
   project shell preserve the project context instead of resetting to Unfiled (the
   review's observed resets). One shared helper derives the ambient project id from the
   route; entry points may not hand-roll it.
2. **Project views scope to the membership record.** The project Build tab, run lists, and
   the shell's footer counters derive from `GET /projects/:id/members` (crew.run members)
   joined to the runs store — never from the global list filtered by nothing. A project
   page shows exactly its runs; the count beside a list equals the rows beneath it.
3. **Once CREW-UX-2 lands**, the join disappears: run rows read `run.project_id` directly,
   and the home board's "NOT IN A PROJECT (n)" bucket becomes the set the daemon actually
   considers unfiled — one truth, one source.

### 2.4 Token usage

No new visual language: project chips and counters reuse the existing rail/dashboard
tokens (`--ink-muted` context labels, `--text-2xs` counts). EC15 holds; no raw color.

### 2.5 DOM ACs

- Launching from `/p/:id/build/new` with the chip set: the created run appears in that
  project's Build tab within one live-update cycle, and `[data-testid="project-run-count"]`
  equals the number of rendered run rows (set-equality, not ≥).
- The project-card Chat button and repo-register form, entered from a project context,
  render their project field pre-bound to that project (`data-locked` or pre-selected per
  the slice-B contract) — never Unfiled.
- Footer counters inside a project shell carry `data-scope="project"` and derive from the
  membership join; the same counters on `/` carry `data-scope="global"`.
- With CREW-UX-2 landed: a run row's project name renders from `run.project_id` with zero
  membership fetches (request-tap).

---

## 3 A3 — Provenance: every run says "launched by X via Y" (MAJOR)

**Brief (quoted):** *"On a shared daemon nothing distinguishes my action from ambient
automation — actively frightening. Degrade honestly to 'launched via API (actor unknown)'
rather than omitting the line."*

### 3.1 Current state

No surface — run detail, notification rows, the runs tray — says who or what launched a
run. The reviewer watched a run materialize mid-session and could not rule out that their
own keystroke had burned money.

### 3.2 Wire verdict — corrected (brief guessed NEEDS-BACKEND; the wire EXISTS)

**EXISTS** `GET /audit?runId=<id>` → `AuditEntry` carrying `actor: {id, kind, trust}` and
`action: "run.launched"` with `detail` (workflow/repoRef/projectId). This is the daemon's
declared **system of record for "who launched that run"** — written crew-side precisely
because the engine's `LaunchOptions` carries no actor field.

- Route: crew `api/routes.ts:266` (filterable by `?runId=` / `?action=`).
- Record site: crew `api/routes.ts:570` (`audit.record('run.launched', actorOf(req), {...})`).
- Type: `wicked-crew-api-types/index.d.ts:32-89` (`AuditEntry`, `Actor`, `ActorKind = 'human'|'agent'|'system'`).

The brief's NEEDS-BACKEND flag is therefore **retracted**: the actor/source data exists;
the studio simply never asked for it.

### 3.3 Design

One provenance line, one place per surface: run detail (in the What/Where card, first
row) and notification rows render **"launched by {actor.id} · {actor.kind} via
{channel}"**, where channel derives from the audit entry's detail (studio / CLI / API /
schedule — and, once CREW-UX-3 lands, "retry of {short-id}"). The audit fetch rides the
run-detail load (one `GET /audit?runId=` per detail view, cached per run id); list rows
show provenance only where the audit entry is already cached — no fan-out. Absent or
unmatched audit entries degrade to the brief's own words: **"launched via API (actor
unknown)"** — the line always renders; only its content degrades.

### 3.4 Token usage

Provenance line: `--ink-muted` sans with the actor kind as a `--text-2xs` uppercase badge
(`--surface-raised`); "actor unknown" in `--ink-dim`. No status colors — provenance is
context, not signal.

### 3.5 DOM ACs

- Run detail renders `[data-testid="run-provenance"]` naming actor id + kind + channel for
  a fixture run with an audit entry; exactly one `GET /audit?runId=` fires per detail view
  (request-tap, cached on revisit).
- A fixture run with no matching audit entry renders the exact degraded copy "launched via
  API (actor unknown)" — the line is never absent.
- Notification rows for run events carry `[data-testid="notif-provenance"]` with the same
  contract.

---

## 4 A4 — Close the triage loop: Retry (MAJOR)

**Brief (quoted):** *"'see failure → understand → retry with a tweak' cannot be closed
without retyping the intent. A Retry button on failed runs… reopens the composer prefilled
with the original intent + configuration (repos, gates, workflow), editable before send;
record retry-of-Z so provenance can show lineage."*

### 4.1 Current state

No retry affordance exists anywhere; the operator retypes from memory. The run's own
record carries everything a prefill needs (`AgentSession`: `problem`, `clis`,
`workflow_id`, `entity_mode`; repo binding via membership).

### 4.2 Wire verdicts

- **EXISTS** everything a prefill needs: `problem`/`clis`/`workflow_id` on the run DTO;
  `POST /runs` (LaunchSchema) accepts the same shape back.
- **NEEDS-CREW-ENDPOINT** lineage: `LaunchSchema` carries no `retryOf` and no such field
  exists anywhere in crew src (grep-verified absent). Specced as **CREW-UX-3** (§8.3) so
  provenance (§3) and run identity (§7.5) can render "retry of {Z}" honestly instead of
  inferring lineage from identical prompt text.

### 4.3 Design

Failed (and cancelled) run pages gain **Retry** beside the headline: it opens the standard
composer **prefilled** — intent, workflow, roster, repo attachment (from membership), gate
posture — fully editable before send; nothing auto-launches. Until CREW-UX-3 lands, the
new run carries no lineage claim (no fake "retry-of" text); once landed, the launch sends
`retryOf: <id>` and both runs' provenance lines cross-link ("retry of {short-id}" /
"retried as {short-id}"). Retry is a composer prefill, not a hidden relaunch — the
operator's tweak-before-send is the point.

### 4.4 Token usage

Retry is a standard secondary button (`--surface-raised`, `--ink-body`); the lineage
cross-links are `--accent` links inside the provenance line. No new colors.

### 4.5 DOM ACs

- A failed fixture run renders `[data-testid="run-retry"]`; clicking it opens the composer
  with the intent textarea equal to the original `problem`, the workflow/roster/repo
  fields matching the original run, and **no** network launch fired (request-tap: zero
  `POST /runs` until the operator sends).
- With CREW-UX-3 landed: the relaunched run's `POST /runs` body carries `retryOf` (tap),
  and both provenance lines render the cross-link.
- Terminal-but-completed runs do not render Retry (the loop closes failures, not successes).

---

## 5 A5 — Reconcile the numbers (MAJOR)

**Brief (quoted):** *"Right rail 'No usage reported yet' beside status bar '$0.12
observed'; 'RUNS (24H) 1 failed' vs unlabeled '12 failed'; 'ACTIVE RUNS (0)' directly
above two listed runs… Each contradiction erodes trust in all the numbers."*

### 5.1 Current state — same datum, two derivations

Every observed contradiction is two components deriving the same fact from different
stores or windows: the landing's burn margin note folds `cliUsage` frames while the
bottom bar folds the same frames through a different accumulator; "RUNS (24H)" buckets on
the attach clock while the bottom bar counts unwindowed statuses; a dashboard header
counts one store while its rows render another. None of these is a wire problem — the
daemon serves one truth; the client derives it twice.

### 5.2 Wire verdicts

**CLIENT** throughout. The burn feed was verified single-source in the prior round
(cliUsage frames are the only cost wire — DES-FEEDBACK-003 §7's landing work); the
remaining contradictions are derivation-site divergence. No daemon change requested.

### 5.3 Design

One rule, mechanically enforced: **every displayed metric has exactly one selector, and
every count names its window.** A `src/board/metrics.ts` module exports the single
derivation per figure (workingCount, gateCount, failedCount24h, failedCountAll,
observedSpend, …); components may not fold stores inline. Every rendered count carries a
window label ("24h", "all", "this session") — the unlabeled number is retired as a class.
The known offenders are re-pointed: bottom bar ↔ landing margin notes ↔ river lede share
selectors; dashboard headers count the same collection their rows render (set-equality);
the bell's badge derives from the same store as the toasts it summarizes. Silent filters
(the graph modal's hidden-tests default, list caps) declare themselves in the same breath
as the count they alter.

### 5.4 Token usage

Window labels: `--text-2xs --ink-dim` mono suffixes, the same dress the landing's
"observed" label already wears — extending the existing honesty grammar, not inventing one.

### 5.5 DOM ACs

- With the W2 fixture: the bottom bar's counts, the landing lede's numbers, and the
  metrics selectors agree exactly (the rig derives expected values from the fixture and
  asserts all three surfaces render them).
- Every element matching `[data-testid$="-count"]` carries `data-window` and a visible
  window label; a lint-style rig grep asserts no component folds `cliUsage`/status counts
  outside `src/board/metrics.ts`.
- A dashboard header's `data-count` equals its list's rendered row count on the same
  paint (set-equality assert, the "ACTIVE RUNS (0) over two rows" regression pin).

---

## 6 B1–B3 — The artifact loop must be reliable (CRITICAL cluster)

### 6.1 B1 — Thread iteration silently drops requests (CRITICAL)

**Brief (quoted):** *"a change request typed while the initial generation was finishing
was ignored, yet the thread rendered '▤ v2 landed' directly beneath it … A second request
sent while fully idle never spawned a run at all: no Generating state, no error, no run on
the project dashboard. … every thread send must visibly become a run or visibly fail —
queued-behind-current-run state included; version markers must anchor to the message that
caused them."*

**Current state:** the doc thread store (`src/store/docThread.ts`, 351 lines) is a
client-side projection of `wicked.interactive.*` bus frames; a version marker is appended
on a `version.created` frame (`docThread.ts:62` `VERSION`) but is **not correlated to the
originating user message** — so a `v2` marker can render beneath an unrelated request. A
send while a run is in flight, and a send while idle, both route through
`src/api/interactive.ts` (483 lines) with no visible queued/failed state on the thread.

**Wire verdict:** the interactive bridge is the transform boundary here. Whether a mid-run
send is dropped by the bridge or the client must be **verified against the live bridge**,
not assumed — flagged in §8.4 as a bridge-contract probe (the brief's own
"NEEDS-BACKEND: whether mid-run sends are dropped by the bridge or the client").

ASSUMPTION[external-transform] library=wicked-interactive transform=a thread send is converted into a doc-version run and emitted back as `wicked.interactive.version.created`; a send issued while a prior run is in flight may be dropped rather than queued confidence=needs-research :: the brief observed a mid-run send producing no run and an idle send producing no run; the design requires every send to become a run or a visible failure, so the bridge's mid-run-send behavior (queue vs drop) must be confirmed by a FATAL contract probe before the client can promise "queued-behind-current-run"

**Design:** every thread send transitions to an explicit **Generating** state and MUST
resolve to one of: a version marker *anchored to that message*, a **queued-behind-current
-run** state (when a run is in flight), or a **visible failure** with a retry. Version
markers correlate to the causing message id (the store carries `version?` on user frames,
`docThread.ts:35` — the anchor is made mandatory for newly created docs). No marker
renders under an unrelated request.

**DOM ACs:** a send while idle renders `[data-testid="thread-generating"]` then either a
`[data-testid="version-marker"]` whose `data-caused-by` equals the send's message id, or
`[data-testid="thread-send-failed"]`; a send while a run is in flight renders
`[data-testid="thread-queued"]`; **no `version-marker` renders with a `data-caused-by`
that does not match a preceding user message** (the gaslight regression this pins).

### 6.2 B2 — The Unfiled path is a dead end in Make → Document (CRITICAL)

**Brief (quoted):** *"The picker pre-selects 'Unfiled,' but choosing it (mouse or
keyboard) closes the popover and nothing happens — no error, no advance… make Unfiled work
or remove it from the picker with an honest reason; a pre-selected default that is also a
silent dead end is the worst of both."*

**Current state:** the Make ＋ Document/Video tines route through the project-picker stage
(slice M's `MakePicker` → slice B's `ProjectSwitcher`); selecting a real project navigates
to that project's document surface, but the Unfiled option closes the popover without
navigating — documents are created against a per-project bridge mount, and no mount exists
for "no project."

**Wire verdict:** documents live behind per-project bridge mounts
(`/api/v1/projects/:projectId/interactive/*` — the crew proxy). Whether the bridge can
host an unfiled document at all (e.g. against the synthesized `default` project's mount)
is **NEEDS-BRIDGE** — a §8.4 probe, decided before the slice builds.

**Design (probe-gated, two honest outcomes):** this document adopts **"make Unfiled
work"** as the primary reading — the picker's Unfiled routes to the `default` project's
mount (the daemon's own unfiled home), the doc is created there, and the surface labels it
the way run surfaces label Unfiled runs. If BRIDGE-UX-1's probe shows the bridge cannot
host it, slice U falls back to the brief's alternative: **remove Unfiled from the doc
picker** and replace it with the honest reason inline — "documents live in a project;
pick one or create one" — with the project-create row one keystroke away. Either outcome
kills the silent dead end; which one ships is decided by the probe, not preference
(§13, first open question).

**DOM ACs:** selecting Unfiled in the Make→Document picker either navigates to a document
surface within the interaction (primary) or the option is absent and
`[data-testid="picker-unfiled-reason"]` renders the honest copy (fallback) — in no build
does selecting a rendered Unfiled option close the popover with no effect (the dead-end
regression pin, asserted by driving both mouse and keyboard selection).

### 6.3 B3 — The document thread does not survive reload (CRITICAL)

**Brief (quoted):** *"After a page refresh the thread shows the empty state; the brief,
version markers, in-flight theme-learn narration, and the export Download link are all
gone… every version's 'In thread' anchor is disabled with the tooltip '…Documents created
before the merge have no anchor' — on a document created minutes earlier."*

**Current state:** the doc thread is a session-memory projection of live bus frames
(`docThread.ts`) with no rehydration source; a reload rebuilds the store empty, which also
breaks the version strip's "In thread" anchors for docs created this session (the anchor
data died with the tab).

**Wire verdict:** **NEEDS-BRIDGE** — a thread-history read surface on the interactive
bridge (the bridge holds the doc, its versions, and the announce stream; whether it
retains a readable thread transcript is BRIDGE-UX-1's second probe). No such route is
assumed; §8.4 specs the probe and the proposed read shape.

**Design:** two layers. (1) **The stopgap ships first and states its contract** — the
thread panel persists its projection to session-scoped storage keyed by doc id, so a
same-session reload restores what this browser saw: the interim empty state reads
**"Showing what this session observed. Messages from before this session — and from other
sessions — return when thread history lands (BRIDGE-UX-1)"** — a promise with a pointer,
never a shrug; version anchors survive reload for anything the session witnessed.
(2) **Full persistence** lands when BRIDGE-UX-1 confirms (or grows) the thread-history
read: the store rehydrates from the bridge on mount, anchors hold for every version, and
the stopgap label retires.

**DOM ACs:** create a doc, send one message, reload — the thread renders the message and
its version marker (not the empty state), and the version strip's "In thread" button for
that version is enabled and scrolls; the stopgap banner renders the exact promise copy
while BRIDGE-UX-1 is unlanded; after a fresh-session load (cleared session storage), the
banner explains what is missing rather than presenting emptiness as "no messages."

---

## 7 B4–B6, C1–C6, D — the terminal-feel completions

### 7.1 B4 — A cross-project gate toast hijacks the workspace (MAJOR)

**Brief (quoted):** *"pins bottom-right at z-50 with no dismiss control and physically
intercepts clicks on the composer, Send, and Export buttons (30s of blocked pointer
events observed)."*

**Current state:** `GateNotifications` renders fixed bottom-right at z-50 with a single
"Review →" action — no dismiss, no timeout, and a hit-box that overlays working surfaces
(the same interception class slice F fixed for the version strip).

**Design:** toasts become **dismissible, self-expiring, and layout-safe**: an ✕ on every
toast; auto-dismiss after a bounded dwell (the gate itself stays in the status bar's gate
count and the bottom panel — the toast is an announcement, not the record); the toast
container reserves no pointer surface beyond its visible cards; and cross-project gate
toasts respect context — inside a project shell, another project's gate announces in the
bottom bar count and the bell, not as an overlaying card mid-canvas. Wire: **CLIENT**
(layering + lifecycle only).

**DOM ACs:** every `[data-testid="gate-notification"]` contains a `[data-testid="toast-dismiss"]`; with a toast visible, a click at the composer's Send coordinates reaches Send (hit-test assert — the interception pin); a gate arriving from another project while inside `/p/:id/*` increments the bottom-bar gate count without rendering an overlay card over the mode surface.

### 7.2 B5 — Act-and-nothing-happens: export + theme-learn feedback (MAJOR)

**Brief (quoted):** *"Clicking HTML export fires the API call but nothing visible happens
at the button… a theme learn from a trivial URL narrated 'Grabbing the page…' then hung
10+ minutes with no progress, timeout, or error."*

**Design:** point-of-action feedback becomes a contract: the export control renders its
own pending → ready states (spinner on the clicked control; on completion, the control
itself becomes the download affordance — the thread message remains, but the click site
answers); theme-learn gains a visible in-flight state in the Themes popover, staged
progress from the bridge's own status frames, and a bounded client timeout that resolves
to an honest error with retry ("the learn did not report back — the bridge may still be
working; retry or check the thread") rather than eternal narration. Wire: **CLIENT** for
feedback/timeout; the bridge's own progress frames are the existing announce stream
(no new wires; if the bridge emits no terminal error for a failed learn, that gap rides
BRIDGE-UX-1's lifecycle probe — **verify at slice time**).

**DOM ACs:** clicking an export format renders `[data-testid="export-pending"]` on that
control and resolves to `[data-testid="export-ready"]` (a real download affordance) at the
click site; a theme learn renders `[data-testid="learn-inflight"]` in the Themes popover
and, on fixture-simulated silence, `[data-testid="learn-timeout"]` with retry within the
budget — never an unresolved "Grabbing…" past it.

### 7.3 B6 — Doc affordances that gaslight (MINOR)

**Brief (quoted):** *"Point-and-comment — named in the mode's own description — is
disabled on a system-generated doc with the tooltip 'this document did not answer the
instrument bridge'… quoted names are slugified into the whole sentence."*

**Design:** disabled-state copy in operator language with a next step ("Comments need the
document's preview to finish loading — reopen the document or regenerate this version"),
never wire jargon (the raw phrase "instrument bridge" is retired from user copy); the
create flows extract quoted names ("uxr-quarterly-brief" in a sentence becomes the name,
the sentence becomes the brief) with the parse shown before submit. Wire: **CLIENT**.

**DOM ACs:** the Comment button's disabled title matches the operator-language copy (the
string "instrument bridge" appears nowhere in the DOM); a create submitted as
`a deck named "uxr-x"` yields a doc named `uxr-x` with the remainder as its brief
(fixture-asserted parse).

### 7.4 C1 — One canonical runs surface (MAJOR)

**Brief (quoted):** *"Every 'All runs ›' affordance lands on /runs: done-only, no
timestamps, no filters — 13 failed runs invisible. The real console (/work) hides behind a
small 'view all →'."*

**Design:** `/work` (the real console: Active/Completed/Failed filters, search, success
rate — `src/components/WorkPage.tsx`) becomes the one canonical runs surface: every
"All runs ›" affordance (bottom bar, landing, rail history) targets `/work`; `/runs`
redirects there (its done-only listing retires); entry is context-sensitive — arriving
from a failure context (FailureBanner link, a failed notification) lands with the Failed
filter active. Wire: **CLIENT** (routing + filter params).

**DOM ACs:** every anchor whose text matches /All runs/ resolves to `/work` (DOM-wide
assert); navigating `/runs` lands on `/work`; following a failed run's "All runs" entry
point renders the Failed filter active (`data-filter="failed"`).

### 7.5 C2 — Run identity: timestamps, durations, titles (MAJOR)

**Brief (quoted):** *"Five visually identical rows… no run start/end times or unit
durations anywhere; retries are indistinguishable; 'what happened overnight, in what
order' is unanswerable."*

**Wire verdict:** `AgentSession` carries **no timestamps** (verified: no
created/started/ended fields on the DTO — the round-4 landing already worked around this
with the membership attach clock). The event log (`GET /runs/:id/events`, routes.ts:1207)
carries per-event times for runs it retains — **CLIENT** derivation on detail views; list
rows use the attach clock already mirrored. A durable `started_at` on the DTO stays a
non-requested follow-up (§13), consistent with the prior round's honest-clocks doctrine.

**Design:** run detail renders started/ended/duration derived from its event log (labeled
"observed" where the clock is arrival-stamped — the house grammar); every run list row
(palette, /work, bottom sheet, search) renders the attach-clock timestamp and a
**synthesized display title**: truncated intent + short-id + attempt ordinal
(`fix the auth flow · 3eda21 · #2`), so five identical prompts stop being quintuplets.
Model-generated titles are explicitly out of scope this round (§13).

**DOM ACs:** run detail renders `[data-testid="run-times"]` with start/end/duration for a
fixture run with events (and the honest absent state for one without); every run row in
palette results, /work, and the bottom sheet carries `[data-testid="run-title"]` composed
title + `[data-testid="run-when"]`; two fixture runs with identical prompts render
distinguishable titles (short-id assert).

### 7.6 C3 — Execution visibility during runs + bookmarkability (MAJOR)

**Brief (quoted):** *"Between 'Run started' and the verdict nothing streams; the Term tab
is an empty shell during runs; after Send the URL stays /build/new so a refresh mid-run
drops to a blank composer."*

**Design:** (1) on launch, the composer **navigates to the run's URL** — the run is
bookmarkable from second zero, and a mid-run refresh lands on the live run view, not a
blank composer; (2) the run view streams what the daemon already relays — `unitOutputDelta`
frames render as the live transcript region for the executing unit (the LiveFeed proves
the deltas flow; the run page simply never subscribed), with the honest label the deltas
deserve ("live output — the full transcript lands when the unit completes"); (3) the Term
tab during a live run shows the same live region rather than an empty shell, with the
operator shell as the labeled secondary. Richer per-phase streaming beyond the current
relay is explicitly **not invented here** (§13 — a crew concern). Wire: **CLIENT** over
the existing /ws relay.

**DOM ACs:** submitting the composer changes `location.pathname` to the run's URL before
first paint of the run view (history assert: back returns to the composer); with the
fixture dripping `unitOutputDelta` frames, `[data-testid="live-output"]` renders text
within one frame cycle and grows monotonically; a reload mid-drip re-renders the run view
(not the composer) with the live region resuming.

### 7.7 C4 — Keyboard coherence (MAJOR)

**Brief (quoted):** *"'?' is dead everywhere; the legend appears only after a lucky
keypress; 'a' approves from the board but is a silent no-op on the gate panel itself;
Escape closes some modals but not the Operator shell or the bell; the shell doesn't take
focus on open."*

**Design:** through the one §G registry: **'?'** opens a global shortcut overlay
(grouped: triage / palette / gates / panels, rendered from the registry's own
registrations so it never drifts); the gate panel honors **a / r** (same `decideGate`
path — the panel is the one place approve matters most); **Escape** closes every layer
by one contract (overlay → palette → sheet → modal/popover → triage selection — extending
the slice-N precedence chain to shell modal and bell popover); multi-select extends with
x/Space across cards; the Operator shell takes focus on open (first keystroke never
swallowed). Wire: **CLIENT**.

**DOM ACs:** '?' renders `[data-testid="shortcut-overlay"]` on every route (board, project
shell, doc surface — asserted on each); with the gate panel focused, 'a' fires the same
`POST /runs/:id/gate` the button fires (tap, exactly once); Escape closes the shell modal
and the bell popover (regression pins); the shell's input is `document.activeElement`
within the open frame.

### 7.8 C5 — Preflight intelligence in the composer (MAJOR)

**Brief (quoted):** *"A code intent can launch from a repo-less project and burn money on
a guaranteed opaque failure; a bound repo still doesn't auto-attach; gates default to
None against the product's own tagline; 'Run Onboarding'-class actions carry no
cost/duration/destructiveness preview."*

**Design:** the composer gains a preflight row: launching a code-shaped intent with no
repo attached renders a **warn-and-block with override** ("No repository attached — the
run cannot produce reviewable work. Attach one, or launch anyway"); a project's bound repo
(membership crew.repo) **auto-attaches** with a visible chip (removable — auto is a
default, not a lock); the gate control surfaces at top level beside the roster (the +
drawer keeps the full matrix) with the default posture revisited against the tagline —
the shipped default becomes `human_confirm` on the first gate-bearing phase, changeable
per-launch (§13 flags this as an operator-confirmable default). Named actions (Run
Onboarding, annotation workflows) carry a preview line: what it does, what it writes,
rough duration. Wire: **CLIENT** (the composer already knows the project's repos; the
drawer proves the controls exist).

**DOM ACs:** a code-intent launch attempt with no repo renders
`[data-testid="preflight-block"]` and fires zero `POST /runs` until override; entering the
composer from a repo-bound project renders the repo chip attached
(`data-auto-attached="true"`, removable); the gate control is present at top level
(`[data-testid="gate-posture"]`) and its shipped default is not "none"; each named action
carries `[data-testid="action-preview"]`.

### 7.9 C6 — Chat: roster-true defaults, stream routing, persistence, zombies (MAJOR)

**Brief (quoted):** *"The default chips are rejected by the daemon on every fresh chat so
the first send always fails (and the failed send clears the composer); only 1 of 6 seats
replies, the rest go mute-red with no reason or retry; reply chunks splice mid-word into
the wrong bubble; sessions are invisible in /chats even while streaming and unrecoverable
after tab close; abandoned tabs leak zombie 'working' agents into global counters."*

**Design:** five repairs on one surface. (1) **Roster-true defaults**: seat chips seed
from the live roster cache (slice C's `rosterCache` — the fallback trio applies only when
the cache is genuinely cold AND the roster is unreachable; a warm roster always wins), so
the first send names seats the daemon accepts. (2) **A failed send never clears the
composer** — the draft survives, the failure renders inline with retry. (3) **Chunk→bubble
routing** keys on the frame's seat + turn correlation rather than arrival order (the
splice is a client correlation bug — **verify at slice time** against the fixture's real
fan-out frames). (4) **Explicit seat states**: connecting / working / replied /
failed-with-reason (open-time failures carry the daemon's own reason from `POST /chats`;
mid-stream lifecycle beyond that rides BRIDGE-UX-1's probe — the state machine ships, the
mid-stream *reasons* wait for the wire). (5) **Persistence + zombie cleanup**: sessions
list in /chats from their first frame (live ones flagged "streaming now"); tab close ends
or orphan-surfaces the session so every global "working" count remains clickable to a
findable source — the zombie counter with no referent is the regression this kills. The
conversation→action bridge (promote a chat into a build/doc with the transcript as
context) rides the composer's existing prefill machinery. Wire: chat listing/lifecycle is
**NEEDS-BRIDGE/CREW** in part — §8.4's fourth probe decides how much the daemon already
tracks (**verify at slice time**: /chats reported "0 of 0" during a live stream in the
review, which suggests the tracking gap is real).

**DOM ACs:** a fresh /chat/new's chips equal the fixture roster's accepted seats and the
first send yields ≥1 reply frame with zero rejected-chip errors; a fixture-failed send
leaves the composer text intact and renders inline retry; each reply chunk lands in the
bubble matching its seat+turn (fixture drips interleaved frames — no mid-word splices
across bubbles); seat chips render explicit state badges incl. failed-with-reason for an
open-time rejection; /chats lists a streaming fixture session while it streams; closing
the tab (context.close in the rig) leaves no orphan increment in the bottom bar's working
count on a fresh page.

### 7.10 D — Hygiene (small, highest trust-per-line)

**Brief (quoted):** *"DTO debug notes, issue numbers, raw 'API 409:' strings, proj_ ids as
titles, and 5-line absolute paths make the product read unfinished."*

**Design:** one copy pass, mechanically checkable: an error-translation layer at the
`apiFetch` boundary (raw `API NNN:` strings never reach the DOM — every surfaced error is
named-cause or the generic honest fallback "the daemon refused this — {translated}");
project display names everywhere a `proj_…` id currently renders (titles, breadcrumbs,
rail highlights); repo-relative paths in Files panels (the 5-line /private/var wrap
retires); internal notes ("work_output pending daemon surface", "(core#24/#26)") removed
from user copy; grammar fixes ("New Project", "New Repository"); fresh-entity hydration
(a just-created project renders its name and a sane age immediately; /system permission
state reads correctly on load; contributor identity de-duplicates). Wire: **CLIENT**.

**DOM ACs:** a DOM-wide rig assert that the strings `API 4`, `API 5`, `DTO`, `proj_` (as
a rendered title), and `/private/var` never appear in user-visible text across the rig's
route walk; a created project renders its display name in rail + breadcrumb without
reload; the two grammar strings render corrected.

---

## 8 Cross-repo prerequisite slices (NEEDS-CREW-ENDPOINT — specced, flagged, never assumed)

House rule (brief §constraints): these are flagged cross-repo slices with schemas specced
before any client work; each lands as its own wicked-crew (or contract-check) PR through
the full merge protocol, and the dependent studio slices name them as prerequisites.

### 8.1 CREW-UX-1 — branch-vs-base diff baseline (unblocks A1)

**Gap (verified):** `worktreeDiff` runs `git diff --no-color --no-ext-diff HEAD`
(crew `api/run-files.ts:111`) — uncommitted changes only; a run's committed work is
invisible, producing the "no changes to a committed file" gaslight.

**Spec:** `GET /api/v1/runs/:id/diff?base=<ref>` — `base` optional; when present and equal
to the literal `merge-base`, the diff runs `git diff --no-color --no-ext-diff
$(git merge-base <default-branch> HEAD)`; when an explicit ref, containment applies (the
ref must resolve inside the run's repo — never an arbitrary command surface). Response
shape unchanged (`RunDiff {diff, truncated}`); 400 on an unresolvable base with a named
error. Same caps/ladders as the existing route (byte-accurate 1MB, 409 workdir cases,
507 over-buffer). ~120 LOC + containment tests in the crew route suite.

### 8.2 CREW-UX-2 — `project_id` on the run DTO (unblocks A2 run-detail chip, A4 project prefill)

**Gap (verified):** `AgentSession` (`crew-api-types/index.d.ts:141`) carries no project
field, though the membership record holds the truth and attaches atomically at launch
(`LaunchSchema.projectId`, routes.ts:148).

**Spec:** `AgentSession.project_id?: string | null` — populated by the crew server from
the membership record at DTO assembly (the daemon-side join the client currently
re-derives); `null` = genuinely unfiled. api-types minor bump; additive and
backward-compatible (optional field — old clients unaffected). ~80 LOC incl. the
list-endpoint join and tests pinning member-attach → DTO echo.

### 8.3 CREW-UX-3 — `retryOf` lineage (unblocks A4 lineage, A3 retry channel)

**Gap (verified):** no `retryOf` anywhere in crew src (grep-empty); lineage cannot be
recorded, only inferred from prompt equality (dishonest).

**Spec:** `LaunchSchema.retryOf?: string` (must name an existing run id — 400 otherwise);
persisted on the session record and echoed as `AgentSession.retry_of?: string`; the audit
entry's detail carries it so provenance (§3) renders "retry of {short-id}" from the system
of record. api-types minor bump. ~40 LOC + schema/audit tests.

### 8.4 BRIDGE-UX-1 — interactive-bridge contract verification (unblocks B1, B3, B2 fallback, C6 mid-stream)

Not a new bridge feature — a **probe slice**: the existing
`e2e/interactive_wire_contract_test.py` grows FATAL probes against the real bridge for the
four open questions this design is gated on: (1) **mid-run sends** — queue or drop (B1's
"queued-behind-current-run" promise vs visible-reject fallback); (2) **thread-history
read** — does any real surface return a doc's announce history (B3's full persistence vs
stopgap-only); (3) **unfiled docs** — can the default project's mount host a doc (B2's
make-work vs remove-with-reason); (4) **per-seat mid-stream lifecycle** — what the bridge
emits when a seat dies mid-reply (C6's failed-with-reason scope). Each probe's outcome is
recorded in the doc as the decision for its dependent slice; where a probe reveals a
genuine bridge gap the operator decides whether wicked-interactive grows the surface
(a new brief item, not silently assumed here). ~150 LOC of probes + spec notes.
