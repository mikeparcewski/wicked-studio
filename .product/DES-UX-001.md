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
