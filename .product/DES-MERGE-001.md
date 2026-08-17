# DES-MERGE-001 — wicked-studio + wicked-interactive merge design

**Status:** DRAFT — complete, ready for review
**Date:** 2026-08-17
**Scope:** Design only. No implementation.
**Repos in scope:** `wicked-studio` (this repo, the coder skin), `wicked-interactive` (the creator skin), `wicked-crew` (control plane, `/api/v1` + `/ws`).

## Purpose

Fold wicked-interactive's document/build/video capability into wicked-studio so a single
experience-plane surface covers both skins, without losing any wicked-interactive feature
and without regressing studio's crew-run governance surface.

---

## 1 IA

### 1.1 The problem with today's two IAs

**wicked-studio** (`src/hooks/useRoute.ts`) is a flat panel router: `runs | coverage |
workflows | domain | policies | rules | repos | system | chats | work | repo-detail |
projects | project-detail`. It is *run-centric* — `/` is the run list, everything else is a
side panel. `LeftSidebar.tsx` exposes three verbs at the top (`Do Work`, `New Chat`,
`New Repository`) and four browse sections (Projects, Repositories, Chats, Work).
There is no notion of a document, and Projects are a thin membership+activity page
(`ProjectDetailPage.tsx` — Members / Activity, nothing produced).

**wicked-interactive** (`frontend/src/App.jsx`) is the inverse: a *single-document*
application. The whole shell is built around one `currentDoc` in the URL, one manifest,
one canvas iframe, one thread. Multi-doc exists (ADR-0015, `docs` registry + `DocPicker`)
but only as a switcher; there is no board, no cross-project view, and each project is a
separate server instance discovered via `getProjects()` / `ProjectSwitcher.jsx`.

Merging them naively (add a "Documents" panel to studio's sidebar) would preserve both
weaknesses: documents stay second-class, and projects stay a directory listing rather than
a place where work is visible.

### 1.2 Target IA: one orchestrator home, four modes

```
┌─────────────┬──────────────────────────────────────────────────────────┐
│  rail       │  ORCHESTRATOR HOME  (route: /)                           │
│  (studio's  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  LeftSide-  │  │ project card │ │ project card │ │ project card │      │
│  bar,       │  │  docs ▸▸▸    │ │  docs ▸      │ │  (no docs)   │      │
│  kept)      │  │  ● 2 runs    │ │  ⏸ gate      │ │  ● 1 chat    │      │
│             │  │  quick: ▸▸▸  │ │  quick: ▸▸▸  │ │  quick: ▸▸▸  │      │
│             │  └──────────────┘ └──────────────┘ └──────────────┘      │
└─────────────┴──────────────────────────────────────────────────────────┘
                        ↓ enter a project / open a thing
┌─────────────┬──────────────────────────────────────────────────────────┐
│  rail       │  [ Chat | Build | Document | Video ]   ← MODE SWITCHER   │
│             │  ──────────────────────────────────────────────────────  │
│             │  mode surface (canvas / run view / storyboard)           │
│             │  ────────────────────────────────────────────────────    │
│             │  ONE conversation thread (§2), always present            │
└─────────────┴──────────────────────────────────────────────────────────┘
```

**The home board is the orchestrator.** Not a project directory — a wall of what is
happening across *many unrelated projects at once*. This is the studio's actual job:
the user runs several efforts in parallel and needs to see, without clicking, which one
needs them.

### 1.3 Mode switcher

Four modes, each a *verb on the current project*, not a document type:

| Mode | What it is | Backed by | Primary surface |
|---|---|---|---|
| **Chat** | Talk to an agent; no artifact commitment yet. Also where a mode is *chosen* by conversation ("make me a deck" → Document). | crew `/api/v1` chat runs (studio `chatMode` route today) | thread only, full-width |
| **Build** | Governed code work — the existing studio run experience (units, gates, phases, evidence). | crew runs | run view (`CenterDashboard`, `PhaseLadder`, `UnitList`) + thread |
| **Document** | **First-class.** Interactive HTML doc / deck / report — the wicked-interactive canvas, its versions, its point-and-comment feedback loop. | interactive service (§5) | canvas iframe + `VersionStrip` + overlay + thread |
| **Video** | Demo recording / storyboard — interactive's demo path (`DemoStoryboard.jsx`, `postDemoGif`). | interactive service | storyboard + player + thread |

Rules that make this cohere:

1. **The thread is invariant across modes.** Switching modes never resets the
   conversation; it changes what the top pane renders (§2). A user can start in Chat,
   say "turn this into a deck", and the mode switcher flips to Document with the same
   thread continuing.
2. **Mode is a route segment, not app state**: `/p/:projectId/:mode[/:artifactId]`.
   Deep-linkable, back-button-correct, and Playwright-addressable.
3. **Modes are disabled, not hidden, when unavailable** (e.g. Video with no recorder
   installed — interactive's `InstallGate`/`getPreflight`). A disabled mode states the
   one action that enables it. Hiding it teaches the user the feature doesn't exist.
4. **Document is not a tab under Build.** It is peer-level. wicked-interactive's whole
   thesis is that a business user never touches Build; demoting Document to a sub-tab of
   an engineering surface would re-import the split we are removing.

### 1.4 Orchestrator home board — per-project card

One card per project. Cards are the *only* thing on the home route; the board is
scannable at a glance and sorted by **attention needed**, not recency:

```
sort key:  gate-waiting  >  failing  >  running  >  idle-with-drafts  >  quiet
```

Card anatomy (all four regions always present; empty regions render an invitation, never
a blank):

| Region | Content | Source |
|---|---|---|
| **Header** | project name, repo binding (if any), status dot | crew `GET /projects` |
| **Interactive docs** | up to 3 doc thumbnails (live-rendered HTML at small scale, not a screenshot service) + kind glyph + "N more" | interactive `listDocs` per project (§5) |
| **Live activity** | the newest narration line per active run, streaming (§3) — e.g. "Writing the acceptance criteria for AC-3" | crew `/ws` `unitOutputDelta` |
| **Crew runs** | compact run chips: phase, gate state, elapsed. A waiting gate renders as an **answerable** chip, not a badge | crew runs + gates store |
| **Quick actions** | `New chat` · `Do work` · `New doc` · `Record demo` — each launches *into that project* with the project pre-bound | §2 launch |

Design constraints:

- **Many unrelated projects at once is the default case.** The board must stay legible at
  ~20 cards: fixed card height, virtualized grid, no card that grows with run count.
- **A card is never a dead tile.** A project with nothing in it shows the four quick
  actions large — the card *is* the empty state.
- **Live activity on the board is real streaming, not polling.** The board subscribes to
  the same event stream as the run view; a card updates in place while the user is
  looking at a different card. This is the single most important property of the board —
  it is what makes it an orchestrator instead of a list.
- **Gate chips are actionable on the board.** Answering a simple gate (approve/reject)
  must not require entering the project. Complex gates deep-link into the thread.

### 1.5 Route map

| Route | Surface | Replaces |
|---|---|---|
| `/` | orchestrator home board | studio's run list at `/` |
| `/p/:projectId` | project home → redirects to last-used mode (default `chat`) | `/projects/:id` |
| `/p/:projectId/chat[/:threadId]` | Chat mode | `/chat/new`, `/chats` |
| `/p/:projectId/build[/:runId]` | Build mode | `/`, `/runs/:id`, `/runs/new` |
| `/p/:projectId/document/:docId` | Document mode | interactive `?doc=` |
| `/p/:projectId/video/:demoId` | Video mode | interactive demo path |
| `/runs`, `/work`, `/chats` | flat cross-project lists (kept — power-user escape hatch) | unchanged |
| `/repos`, `/repo-detail/:id`, `/coverage`, `/workflows`, `/domain`, `/policies`, `/rules`, `/system` | unchanged side panels | unchanged |

Back-compat: existing studio paths (`/runs/:id`, `/projects/:id`) 301-equivalent
client-side redirect into the new shape, resolving the project from the run. No bookmark
breaks. `useRoute.ts` grows a project+mode parse ahead of the existing panel parse; the
`Panel` union stays for the side panels.

### 1.6 What the rail becomes

`LeftSidebar.tsx` survives with a changed top section: the three creation verbs become
**project-scoped when a project is active** and **project-picking when not**. Its browse
sections gain **Documents** alongside Chats and Work, so the rail lists everything a
project produces, uniformly.

**Open question (needs a product call, not a design call):** whether Projects in crew and
"instances" in interactive are the same entity. §5 assumes they must be unified — a
document without a project has nowhere to live on the board.

## 2 Conversation model

### 2.1 The rule

> **One thread per run. The thread is the whole relationship with that run: you launch it
> in the thread, you steer it in the thread, you answer its gates in the thread, and you
> follow up in the thread.**

Studio already established this for code runs in #24 ("unified launch/steer conversation"):
`ChatPanel.tsx`'s composer routes by run state rather than showing separate widgets. This
design **generalizes that rule to documents and video** — which is precisely what makes the
merge a merge and not a bolt-on. wicked-interactive's `Thread.jsx` is the same idea reached
independently (one transcript, agent questions render as inputs, verdicts render inline),
so the two converge rather than conflict.

### 2.2 The four composer states

The composer is a single input. What pressing Enter *does* is a pure function of run state.
The user is never asked to pick a verb; the composer tells them which one is active.

| # | Run state | Composer does | Studio wire | Interactive wire | Affordance shown |
|---|---|---|---|---|---|
| 1 | **no run yet** | **Launch** — create the run from this message | `POST /runs` (`launchRun`) | `POST /api/docs` (`createDoc`, brief seeded) | mode chips (Chat/Build/Document/Video), repo/project binding, seats |
| 2 | `executing`\|`distributing`\|`planning` | **Steer** — inject into the live agent session | `POST /runs/:id/inject` (`injectMessage`, target `all` or a named agent) | `wicked.interactive.chat.posted` bus emit | subtle "steering live run" chip + inject-target selector |
| 3 | `awaiting_human` | **Answer the gate** — approve/reject **plus** free-text steer in one submit | `POST /runs/:id/resume` + inject, or `POST /runs/:id/elicitation` for an elicitation | `wicked.interactive.question.answered` (`request_id`) | gate card inline in the transcript with the actual question and its options |
| 4 | terminal (`completed`\|`failed`\|`cancelled`) | **Follow up** — start a *linked* run seeded with this thread's context | `POST /runs` with `parentRunId` | `POST /api/fork` (new version lineage) | "continues from <run>" chip on the new thread |

Two properties this buys, both of which are lost the moment steering moves to its own panel:

- **No dead composer.** There is no run state in which the input is disabled with no
  explanation. #24 already removed the duplicate steering input from `RightPanel`; this
  design forbids it returning for documents.
- **The transcript is the audit trail.** Every gate answer, every injection, every launch
  is a message with an author and a timestamp in one ordered log. `SteeringTimeline.tsx`
  becomes a *read projection of the thread*, not a second source of truth.

### 2.3 Non-text inputs are messages too

wicked-interactive's distinctive input is not typing — it is **pointing at the artifact**
(`InlineComment.jsx`, `Overlay.jsx`, `feedbackStore.js`, `selection.js`). Point-and-comment
feedback batches into `wicked.interactive.feedback.submitted`.

In the merged model, a feedback batch **posts into the thread as a user message** whose body
is the targeted comments (each with its element reference and a jump-to-element affordance),
not as an invisible side channel. Same for a `ToolRail` action ("Style — learn from a
website", "Analyze → A11y"): it appears in the thread as *"You asked for an accessibility
review"* and its verdict streams back as a reply.

Rationale: if the artifact-pointing path is invisible in the transcript, the transcript
stops being the record, and a user who scrolls back cannot reconstruct why the doc changed
between v4 and v5. This also collapses interactive's `role: "review"` message kind into the
ordinary reply model — a reviewer is just another author.

### 2.4 Thread identity and lifetime

- **Thread id = run id.** A thread is not a separate entity to store, name, or garbage
  collect. For documents, the "run" is the doc's generation lineage (`getVersions` /
  `getConversation` per doc) — one thread per doc, spanning all its versions.
- **A thread survives mode switches** (§1.3). Chat → "make this a deck" → Document keeps
  one transcript; the artifact appears above it. Mechanically: the chat run's id is passed
  as `parentRunId` and the two threads render as one continuous transcript with a mode
  divider. Two runs in the store, one conversation on screen.
- **Follow-up is chaining, not resurrection.** A terminal run is immutable — its evidence
  is already written to the ledger. Case 4 creates a *new* run rather than reopening. The
  UI hides the seam; the governance model must not.
- **Threads are addressable**: `/p/:projectId/:mode/:runId`. A gate chip on the home board
  (§1.4) deep-links to the message in the thread, scrolled and focused.

### 2.5 Multi-agent authorship

Studio's thread already carries per-CLI identity (`CLI_COLORS`, `cliInitials`, council
quorum). Documents inherit it: the doc agent, each reviewer (`Intent`/`A11y`/`Copy`/
`Quality`), and the user are all distinct authors in one transcript. Concurrency is
interactive's existing rule — reviews are **non-blocking and concurrent**, they never veil
the canvas — and it should win over studio's more serialized feel, because a Document-mode
user must keep reading their document while a review runs.

**Design decision (deliberate divergence from both today's apps):** the thread is never
force-opened-and-locked. Interactive's ADR-0024 locks the thread open with the canvas
blurred while the agent works, and needs a 75s `consoleEscape` valve to recover from hangs
(`App.jsx`: `agentBusy`, `renderReady`, `consoleEscape`). That escape valve is the tell —
a modal working-state that needs a timeout to escape is a modal that shouldn't exist. In
the merged app the thread is always dismissible; liveness is carried by narration (§3) and
by the board (§1.4) instead of by blocking the canvas.

## 3 Narration

### 3.1 Where each app is today

**Studio** has the real thing. `store/runtime.ts` folds both delta spellings —
`unitOutputDelta` (`text`, contract 0.5.1) and legacy `cliOutputDelta` (`chunk`) — into one
per-`(run, unit)` buffer via `deltaTextOf` + `outputKey`, fed identically by live `ingest`
and replayed `hydrateOutputs`. `ChatPanel.tsx`'s `LiveNarration` renders that buffer inside
the active unit's block: phase label, pulse dot, collapsible, autoscrolled, windowed to a
`NARRATION_TAIL` of 4096 bytes so a chatty worker can't grow the DOM unbounded.

**Interactive** has the opposite: a `wicked.interactive.status.posted` event the agent is
*asked* to send (`emitStatusRequested` on a 20 s `HEARTBEAT_MS` timer), and when it doesn't,
`Thread.jsx` fills the silence with a rotating `WHIMSY` list — "Reticulating splines…",
"Pondering the loop…" — every 4 s.

### 3.2 The rule

> **Threads consume `unitOutputDelta`. Every status line is either actionable or
> informative. Nothing else is allowed on screen.**

Two direct consequences, both deletions:

- **Delete the whimsy filler.** "Tightening the bolts…" is neither actionable (there is
  nothing to do) nor informative (it says nothing about this run). It exists only because
  the real stream was missing; with deltas relayed, the dead air it papers over is gone.
  Keeping it once real narration exists is strictly worse — it *competes* with true output
  for the user's attention, and interactive already had to add `realStatusAt` to stop the
  filler talking over a fresh real status. That workaround disappears with the filler.
- **Delete the 20 s heartbeat.** `emitStatusRequested` nudges the agent to say something.
  A pull-based liveness poll is a symptom of a push channel that isn't wired. Once the
  document agent's output is relayed as deltas, liveness is a property of the stream. (Keep
  a *connection* health indicator — that is `ConnectionStatus.tsx`'s job, and it is
  actionable: "reconnecting" tells the user why nothing is moving.)

### 3.3 The two legal status kinds

| Kind | Definition | Must carry | Example |
|---|---|---|---|
| **Informative** | Names *what is happening right now*, with its object | a subject the user recognizes (unit/phase/doc/element) | "Rewriting slide 3 — tightening the headline" · "Planning: 4 units" |
| **Actionable** | Names *what the user can do*, with the control adjacent | a control, in the same block | "Gate: approve the acceptance criteria?" `[Approve] [Reject]` · "Recorder not installed" `[Install]` |

Anything that is neither gets cut. Concretely, the following are **banned**:

- a bare `Working…` with no subject (studio's current fallback when the buffer is empty —
  it must instead say *what* it is working on, from the unit's phase and title, which it
  already knows);
- a spinner with no adjacent text;
- an error with no next action ("Couldn't grab that URL: …" is informative-but-terminal;
  it must offer `[Retry]` / `[Pick a file instead]`, both of which exist already in
  `ThemeFromUrlModal` / `FsPicker`);
- rotating flavour text of any kind.

### 3.4 Two rendering altitudes from one stream

The same delta stream feeds two very different surfaces. They must not be the same
component.

**(a) Thread — the transcript.** Studio's `LiveNarration`, kept as-is, extended to
Document/Video modes. Raw-ish output, collapsible, 4 KB tail, active unit only. This is
where a user goes to *watch*.

**(b) Board card — the headline (§1.4).** One line per active run, no scroll, no toggle.
A card cannot render a 4 KB tail; it needs the *last meaningful line*. Derivation, in
priority order:

1. an explicit structured status if one exists (interactive's `status.posted` `message`,
   crew's phase transitions) — always wins over scraped text;
2. otherwise the last non-empty, non-noise line of the delta buffer, trimmed to one line
   (drop ANSI, progress-bar redraws, and pure-punctuation lines);
3. otherwise the unit's phase + title ("Planning — acceptance criteria").

Rule 3 is why the bare `Working…` is never needed: there is always a truthful subject
available from state the client already has.

### 3.5 Making the document agent narrate

Document/Video work must emit deltas, not just discrete status events, or Document mode
regresses to the silence the whimsy was hiding. Two paths, in preference order:

1. **Preferred — route document generation through crew runs.** Interactive already
   half-does this: `createDoc` takes a `project` binding and `getDocActivity` reports
   `{active, status, run}` for a governed run. If document generation is a crew run, its
   worker's output is relayed as `unitOutputDelta` for free, and Document mode inherits
   narration, gates, evidence, and the board card with zero new plumbing.
2. **Fallback — bridge the SSE stream.** Where generation stays in the interactive service
   (`src/service/generation.js`, `handlers.js`), its `onStep({index, total, label})`
   callback and agent chatter get relayed onto the same client-side buffer keyed by
   `outputKey(docRunId, ord)`, so both altitudes above work unchanged.

`useSse.js` (interactive) and `useEventStream.ts` (studio) collapse into **one client
subscription** feeding the runtime store. Two live sockets in one page is how the two
surfaces drift out of sync.

### 3.6 Ordering, replay and correctness

- **Replay must equal live.** Studio's `hydrateOutputs`/`ingest` symmetry is the property
  that makes reload-mid-run work; interactive's `getDocActivity`-on-open exists for the
  same reason (#165). The merged store keeps one fold function so a reloaded page and a
  live page render byte-identical narration.
- **Deltas are append-only per `(run, unit)`.** Out-of-order or duplicated frames must not
  corrupt the buffer; the fold stays a pure append and the *store* keeps the larger cap
  while the *thread view* keeps the 4 KB tail (already the split today — preserve it).
- **Narration is not evidence.** Streamed text is a view, never the source of a verdict.
  Acceptance still reads the ledger. Nothing in this section may be used to derive "done".

### 3.7 Acceptance heuristic

For any screen state, a reviewer must be able to answer: *"What is it doing, and what can
I do?"* If both answers are "unclear", the state is a bug — and that is the Playwright
assertion in §6, not a subjective review note.

## 4 Feature-parity inventory

Every wicked-interactive capability, with a disposition. Three dispositions:

- **EMBEDDED** — the existing implementation runs unchanged behind the merged UI (§5). No
  port, no rewrite. Default disposition; chosen wherever the logic is deterministic
  server-side work with no studio equivalent.
- **REBUILT** — the UI is re-implemented inside studio (React+TS, studio's stores) against
  the same service API. Chosen where the surface must participate in studio's thread,
  board, or routing.
- **REPLACED-BY-BETTER** — studio already has a stronger mechanism; interactive's version
  retires. Chosen only where the studio mechanism is a strict superset.

> **Parity bar:** a wicked-interactive user must be able to do everything they can do today,
> from the merged app, with no drop to a second UI. Anything marked EMBEDDED that cannot be
> driven from the merged shell is a parity failure, not a deferral.

### 4.1 Document kinds (4)

`createDoc(name, html, meta)` accepts `kind ∈ {blank, html, source, demo}`
(`frontend/src/lib/api.js`; the wizard derives `source` vs `blank` from whether a brief or
source paths exist — `CreationWizard.jsx:184`).

| # | Kind | What it is | Disposition | Notes |
|---|---|---|---|---|
| 1 | `blank` | empty doc, built up in chat | **REBUILT** (UI) + EMBEDDED (service) | Becomes "start in Chat mode, promote to Document" (§2.4). The empty doc *is* the thread. |
| 2 | `html` | adopt existing HTML into the version chain | **EMBEDDED** | Reached via `wicked-interactive adopt` / `artifact/adopt.js`. Merged UI needs an "import existing HTML" entry — today it is CLI-only, which is itself a parity gap in *interactive*. |
| 3 | `source` | generate from a brief + attached local files | **REBUILT** (UI) + EMBEDDED (service) | The wizard's source list becomes studio's context attachment (`ContextPopover.tsx` already does this shape for runs). Local paths never upload — preserve that. |
| 4 | `demo` | recorded walkthrough of a live app | **EMBEDDED** | → Video mode (§4.6). |

**Creation UX decision:** `CreationWizard.jsx` (a 4-step modal, ~650 lines) is **REPLACED-BY-BETTER**
by conversational launch (§2.2 case 1). The wizard's fields map onto composer affordances:
name → derived, brief → the message itself, sources → attachment chip, style → theme chip,
project → project binding (already the active project in the merged IA). The wizard survives
only as an "advanced" disclosure for the demo path, which has genuinely ordered steps
(target URL → scenes → transitions → recording mode).

### 4.2 Versions, fork, rewind

`core/versions.js` — parent-pointer manifest, monotonic version numbers, **write-once
(INV-4)**: entries are never mutated or removed. `POST /api/fork` branches from any version.
`VersionStrip.jsx` is the rewind/compare surface.

| Capability | Disposition | Notes |
|---|---|---|
| version manifest (`versions.json`, parent pointers, forks) | **EMBEDDED** | Do not reimplement. Write-once is a correctness invariant, not a storage detail. |
| `VersionStrip` rewind/select UI | **REBUILT** | Must live in Document mode's chrome and cross-link to the thread: selecting v5 scrolls the thread to the messages that produced v5. That link is the whole point of merging, and interactive can't do it today. |
| fork ("chase two ideas at once") | **REBUILT** (UI) + EMBEDDED (service) | In the merged model a fork is §2.2 case 4 — a linked thread. Two forks = two threads side by side, both on the project card. |
| studio run history | *(no conflict)* | Runs and versions are different axes; a doc thread shows both — runs on the time axis, versions as artifacts produced. |

**Rejected alternative:** re-expressing versions as crew run evidence. It loses fork
lineage (a DAG, not a list) and would make rewind a governance operation. Keep the manifest.

### 4.3 Feedback targeting (point-and-comment)

The distinctive interaction: `core/instrument.js` injects stable `data-wid` anchors
(`slide-{i}-{role}-{n}`, stability invariant INV-1: an element that has one keeps it);
`Overlay.jsx` + `selection.js` (`nearestReviewable`, `describe`) resolve a click to the
nearest reviewable element; `InlineComment.jsx` collects the comment; `feedbackStore.js`
batches items; `wicked.interactive.feedback.submitted` sends them; `structural.js` applies
the agent's returned fragments through the INV-2 gate as a follow-on version.

| Capability | Disposition | Notes |
|---|---|---|
| `data-wid` instrumentation + INV-1/INV-2 gates | **EMBEDDED** | Untouched. This is the load-bearing correctness machinery. |
| overlay / hit-testing / inline comment UI | **REBUILT** | Must render over the embedded canvas and post into the thread as a user message (§2.3). Cross-frame hit-testing is the main technical risk in the iframe approach — see §5. |
| batching multiple comments before submit | **REBUILT** | Keep. Batch = one message with N targeted items, one regeneration. Sending each comment individually would produce N versions and N runs. |
| structural edit application | **EMBEDDED** | `structural.js` unchanged. |

### 4.4 Exports — HTML · PDF · PPTX

`service/export.js` + `service/pptx.js`. All three are **EMBEDDED**; every one of them is
deterministic server-side rendering with hard-won detail studio has no equivalent for.

| Format | Mechanism | Disposition | Non-obvious detail to preserve |
|---|---|---|---|
| HTML | `inlineHtml` + `decorateForExport` (cheerio) | **EMBEDDED** | Self-contained single file: local assets → data URIs, CSS `url()` inlined. |
| PDF | `chromeRenderer` — `chrome --print-to-pdf` over the self-contained HTML | **EMBEDDED** | Print contract (issue #12): `@page size` honored by new headless; the gradient-clip workaround (`collectGradientClipSelectors`) exists because `-webkit-text-fill-color:transparent` paints solid in print. Deleting that is a visible regression. |
| PPTX | vendored `vendor/pptx/html_to_pptx.py` (python-pptx) | **EMBEDDED** | **Lazy dependency**: missing Python/python-pptx must stay a clean 400 with an install hint, never a crash, and must never enter the install gate that blocks ordinary docs. |
| download naming | `downloadBase(dir, version)` | **EMBEDDED** | Doc-slug names (`agent-harness_v17.pdf`), not `export_v17.*`. |

**Merged-UI change (REBUILT):** export is currently a per-doc button. On the board (§1.4)
export becomes a **quick action on the card**, and a completed export posts into the thread
as a downloadable artifact message. Studio's `downloadRunEvidence` already establishes the
"artifact lands in the transcript" pattern.

ASSUMPTION[external-transform] library=cheerio transform=HTML parse→serialize round-trip normalizes markup (attribute quoting/order, whitespace, self-closing tags) and drops the doctype confidence=known :: `decorateForExport` re-prepends `<!DOCTYPE html>` explicitly (`export.js:185`) precisely because cheerio does not emit one; instrument/theme/structural all round-trip through cheerio, so any merged code touching document HTML must assume byte-inequality after a no-op load+serialize and compare semantically, never by string equality.

ASSUMPTION[external-transform] library=chrome(--print-to-pdf, new headless) transform=self-contained HTML → paginated PDF, honoring CSS `@page size`, rasterizing gradient-clipped text confidence=known :: New headless applies `@page` automatically (no explicit page-size flag); `--no-pdf-header-footer` suppresses chrome's default header/footer; `-webkit-background-clip:text` + transparent text fill paints as a solid box, which `collectGradientClipSelectors` overrides pre-render. Chrome discovery is centralized in `findChrome()` with a `WI_CHROME` override.

ASSUMPTION[external-transform] library=python-pptx (via vendored html_to_pptx.py) transform=HTML deck → native editable .pptx shapes/text/theme colors confidence=needs-research :: The mapping from arbitrary styled HTML to PowerPoint shapes is inherently lossy (CSS layout → absolute shape geometry; web fonts → PPT fonts; effects dropped). Needs human research to state exactly which CSS features survive, how slide dimensions are derived, and what the fallback is for unsupported constructs, before the merged UI can set user expectations in its export dialog.

### 4.5 Demo recording (Video mode)

`service/demo.js` (ADR-0018) — the agent authors a deterministic `demo.spec.mjs`, the
**model-free service executes and records it** (Playwright: browser launch, video capture,
tracing, artifact paths, versioning). ffmpeg post-processing produces mp4 + poster frame;
`POST /api/demo/gif` converts webm → looping GIF. `DemoStoryboard.jsx` renders anchored
chapter thumbnails; `/api/demo/player/:version` serves the player.

| Capability | Disposition | Notes |
|---|---|---|
| agent-authors-spec / service-executes split | **EMBEDDED** | ADR-0010 model-free delegation. Deterministic replay is why "change step 3" works at all. |
| recording, video capture, tracing | **EMBEDDED** | |
| mp4 + poster via ffmpeg, GIF conversion | **EMBEDDED** | Graceful degradation on missing ffmpeg is required behavior, not a nicety. |
| storyboard + chapter thumbnails, player | **REBUILT** | Video mode's main surface; storyboard steps must be feedback-targetable exactly like document elements (highlight a step → comment → re-author → re-record). |
| "record a demo" launch | **REBUILT** | §2.2 case 1 in Video mode; the ordered wizard survives here (§4.1). |

ASSUMPTION[external-transform] library=Playwright transform=scripted steps → recorded webm video + trace, with its own viewport/DPR/timing normalization confidence=known :: The service owns browser launch and video capture and never decides what to click; recorded output dimensions and frame pacing come from Playwright's recording config, so storyboard anchors must be derived from spec step boundaries, not from video timestamps alone.

ASSUMPTION[external-transform] library=ffmpeg transform=webm → mp4 (re-encode), mp4 → poster JPEG at t=2s, webm → looping GIF confidence=known :: `demo.js:266-280` — all three are best-effort: a missing ffmpeg or a non-zero exit must not abort the version landing; GIF conversion surfaces an install hint instead of a crash. Re-encoding is lossy, and the poster is a fixed 2-second seek, which yields a blank frame for demos that start with a slow page load — a known sharp edge the merged UI should let the user re-pick.

### 4.6 Learn-a-theme (URL · PDF · image) and the theme library

| Capability | Mechanism | Disposition | Notes |
|---|---|---|---|
| learn theme from a live URL | `theme-grab.js` → chrome print-to-PDF of the URL; the **agent** reads the design | **EMBEDDED** | The **SSRF guard is non-negotiable**: http(s) only, reject metadata/loopback hostnames, resolve *every* address for the host and reject loopback/link-local (incl. `169.254.169.254`)/private/ULA/CGNAT/unspecified, then **pin the validated IP**. Any merged-app proxying of this must not bypass it. |
| learn theme from a local PDF/image | agent reads the file in place | **EMBEDDED** | **Nothing uploads.** Preserve that guarantee and say so in the UI. |
| built-in theme library | `src/themes/*.json` (absorbed from prezzie, ADR-0020) + `core/theme.js` | **EMBEDDED** | Base `<style>` block, element-level selectors, idempotent, never touches `data-wid`. |
| the modal + file picker | `ThemeFromUrlModal.jsx`, `FsPicker.jsx` | **REBUILT** | Becomes a thread action + studio's existing path-picking pattern. |
| `ToolRail` "Style" group | | **REBUILT** | Rail survives in Document mode (§4.7). |

ASSUMPTION[external-transform] library=chrome(theme-grab) transform=live URL → PDF snapshot used as design reference confidence=known :: Same `findChrome()` primitive as PDF export with the URL substituted for `file://`; the capture is a *rendering* of the site (lazy-loaded content, cookie banners, and auth-walled regions appear as the headless browser sees them, not as a logged-in human does), so themes learned from gated pages may reflect the consent overlay rather than the site.

### 4.7 Analyze (reviewers)

`ToolRail.jsx` exposes four passes — `match` (Intent — does it still match the original
ask), `a11y` (WCAG AA + contrast), `copy` (clarity), `qe` (full quality crew) — emitted as
`wicked.interactive.review.requested`; verdicts stream back as `chat.posted` with
`role: "review"`. **Non-blocking and concurrent** by design.

| Capability | Disposition | Notes |
|---|---|---|
| the four review passes | **EMBEDDED** (agent-side) | The reviewers are garden specialists; the merged app requests, it does not implement. |
| verdicts in the transcript | **REBUILT** | Collapses into ordinary multi-author messages (§2.5); `role:"review"` stops being a special kind. |
| non-blocking + concurrent execution | **REPLACED-BY-BETTER**? **No — this wins.** | Studio's flow is more serialized. Interactive's rule is the better one and is adopted globally (§2.5). Recorded here so it isn't lost in translation. |
| `qe` → full quality crew | **REPLACED-BY-BETTER** | In the merged app this is a *crew run*: real governance, evidence in the ledger, evaluator≠creator, visible on the board. Today it's a fire-and-forget review request. This is the single biggest capability upgrade the merge delivers to interactive users. |
| the tool rail itself | **REBUILT** | Kept as Document/Video-mode chrome. Its "one action per icon, tooltip states the outcome" discipline is good; port it, don't redesign it. |

### 4.8 Project binding

`service/project.js` (DES-PROJECT-001 §2.3): registration via crew
`POST /api/v1/projects/:id/members {kind:"interactive.doc", ref:"<doc>"}` is **the
authority**; `project.json` beside `versions.json` is an **advisory breadcrumb**; events
carry an additive optional `project_id`. Breadcrumb and table disagree ⇒ **the table wins**.
`getCrewProjects` / `createCrewProject` back the wizard's picker (#162, #167).

| Capability | Disposition | Notes |
|---|---|---|
| membership as source of truth | **EMBEDDED** | Exactly the model the board needs — this is why §1.4's per-project doc list is buildable at all. |
| `project.json` breadcrumb + `adopt` re-registration | **EMBEDDED** | Offline recovery path; keep. |
| `project_id` event enrichment | **EMBEDDED** | Lets the board route a doc event to the right card. |
| project picker in the wizard | **REPLACED-BY-BETTER** | The merged IA always has an active project (§1.2). Binding becomes implicit; the picker only appears when creating from the cross-project home. |
| `ProjectSwitcher.jsx` (switch between running *instances*) | **REPLACED-BY-BETTER** | Studio's project routing replaces instance-hopping. See the open question in §1.6 and the port/instance model in §5. |
| loud error when `--project` given with no crew daemon | **EMBEDDED** | Keep the loudness; silent ungoverned fallback is worse. |

### 4.9 Everything else in interactive's surface

| Capability | Where | Disposition | Notes |
|---|---|---|---|
| attach reference sources (files/folders read in place) | `getSources`, `source.attached/removed`, `FsPicker` | **REBUILT** (UI) + EMBEDDED (service) | Merge into studio's `ContextPopover` pattern. "It uses your actual numbers" is a headline feature — do not lose the folder-attach affordance. |
| conversation persistence | `GET /api/conversation` | **REPLACED-BY-BETTER** | Studio's run-scoped transcript + event store, with replay symmetry (§3.6). |
| SSE stream | `useSse.js`, `serve-bridge.mjs` | **REPLACED-BY-BETTER** | One `/ws` CoreEvent subscription (§3.5). |
| install gate / preflight | `InstallGate.jsx`, `preflight.js` | **REBUILT** | Studio has a launch check (#23). Merge into it; keep the "Continue anyway" escape (#159) and keep PPTX/ffmpeg *out* of the blocking gate. |
| doc picker / multi-doc registry | `DocPicker.jsx`, `listDocs` (ADR-0015) | **REPLACED-BY-BETTER** | The board + rail's Documents section (§1.6). |
| dynamic port + lockfile discovery, one shared instance | ADR-0022 / ADR-0025 | **EMBEDDED** | §5 depends on it. |
| dark/light theme toggle | `App.jsx` pre-paint class | **REPLACED-BY-BETTER** | Studio's theming. Note: studio components hardcode a dark palette (`ProjectsPage.tsx` `S`), so "studio's theming" is itself owed a light mode — flagged as an out-of-scope debt this merge exposes. |
| whimsy filler + status heartbeat | `Thread.jsx` | **DELETED** | §3.2. The only outright deletion in this inventory. |
| doc activity rehydrate on open (#165) | `getDocActivity` | **REPLACED-BY-BETTER** | Studio's `hydrateOutputs` replay path (§3.6). |
| bus vocabulary (ADR-0019) | `service/events.js` whitelist | **EMBEDDED** | The UI-emittable whitelist is a security boundary; the merged client must stay inside it. |

### 4.10 Parity ledger

**Nothing in wicked-interactive is dropped except the whimsy filler and its heartbeat.**
Counted by disposition: EMBEDDED 24 · REBUILT 14 · REPLACED-BY-BETTER 9 · DELETED 1.

Three items are *gained* by interactive users through the merge: governed QE runs with
ledger evidence (4.7), the cross-project orchestrator board (1.4), and real streamed
narration (3). Two are *owed* by studio to reach parity: an import-existing-HTML entry
point (4.1) and a light theme (4.9).

## 5 Integration

### 5.1 The proposal on the table

> iframe `:4400` with `?embed=1`, plus CORS on crew `:7701`.

**Verdict: reject the transport, keep the iframe — but iframe a different thing.**
Three of its four assumptions are false against the code as it stands.

### 5.2 Why it fails as stated

**(a) `:4400` is not a port.** ADR-0022 made the interactive bridge's port *dynamic*:
"no `--port` → take the first free port from 4400 up; `--port N` is a *preference*: if N is
taken, fall forward". The live port is recorded in a per-root lockfile
`<root>/.wi-serve.json` = `{port, host, pid, startedAt, version}`. ADR-0025 then made one
shared instance the default (`~/wicked-interactive/docs`) — but "shared by default" is not
"fixed at 4400"; a second root, or anything else holding 4400, moves it. **A browser cannot
read a lockfile.** An iframe `src="http://127.0.0.1:4400/…"` is a coin flip.

Studio already decided this exact question and decided it the other way:
`api/client.ts` documents "no hardcoded `7701` literal ships in the bundle" and derives the
origin from `window.location` (DES-STUDIO-SERVING-001 §4.2). Hardcoding `4400` in the same
bundle that refuses to hardcode `7701` would be incoherent.

**(b) CORS on `:7701` solves the wrong problem.** CORS would be needed only if the embedded
interactive SPA called crew directly from its own origin. In the merged design it must not:
§2 says one thread, §3.5 says one event subscription. If the iframe talks to crew on its
own, there are two clients, two auth paths, and two sources of truth for run state.
**Enabling CORS is a symptom of the wrong seam, not a fix.** It also permanently widens
crew's browser-reachable surface for the benefit of one local integration — a bad trade the
day crew grows auth or the remote runner (already in its roadmap).

**(c) `?embed=1` on the interactive *SPA* re-imports the split we are removing.** Embedding
`frontend/` whole means shipping two React apps, two composers, two threads, two SSE
streams — and `?embed=1` becomes a growing pile of "hide this chrome too" flags. §4 already
committed the interactive *shell* (composer, thread, version strip, doc picker, wizard) to
REBUILT precisely so this doesn't happen.

**(d) Cross-origin would break the core interaction.** Feedback targeting reads the doc's
DOM directly: `App.jsx:269-275` walks `iframeRef.current.contentDocument`, collects
`[data-wid]` elements and their `getBoundingClientRect()`, and tracks
`contentWindow.scrollY` to keep the overlay pinned. Every one of those calls throws on a
cross-origin frame. A `:4400`-vs-`:4200` iframe silently kills point-and-comment — the
feature the product is named for.

### 5.3 The design: proxy the service, iframe only the document

Two changes, and the four problems above all disappear.

```
        browser (one origin: whatever crew bound)
        ┌──────────────────────────────────────────────┐
        │ studio SPA                                   │
        │   fetch /api/v1/...            ─────────────►│ crew
        │   ws    /ws  (CoreEvents)      ─────────────►│  ├─ runs, gates, projects
        │                                              │  └─ /api/v1/interactive/*  ──► interactive bridge
        │  ┌────────────────────────────────────────┐  │        (port from .wi-serve.json,
        │  │ <iframe src="/api/v1/interactive/      │  │         resolved server-side)
        │  │              docs/:id/doc/:version">   │  │
        │  │   ← the RENDERED DOCUMENT only,        │  │
        │  │     same-origin, overlay reads its DOM │  │
        │  └────────────────────────────────────────┘  │
        └──────────────────────────────────────────────┘
```

**1. Crew reverse-proxies the interactive bridge** under `/api/v1/interactive/*`. Crew is a
server process: it can read `<root>/.wi-serve.json`, health-check the bridge (ADR-0025's
hardened reuse check: retry `/api/health` 1.5 s × 3 while the pid lives), start it if
absent, and forward. Consequences:

- no port literal in the bundle — the dynamic-port ADR is *honored* rather than worked around;
- **no CORS at all** — every request is same-origin, including the doc frame;
- one auth/identity path, so the remote-runner future doesn't need a second story;
- the bridge stops being browser-reachable, shrinking, not widening, the attack surface;
- studio's dev split (`VITE_API_HOST` → `127.0.0.1:7701`) keeps working unchanged, because
  interactive is now *behind* that same host.

**2. The iframe carries the rendered document, not the app.** `GET /doc/:version` already
exists (`server.js:76-79`) and is exactly what interactive itself iframes today. Embedding
it — proxied to studio's origin — means `contentDocument` access keeps working and the
overlay/hit-testing logic ports over as-is (§4.3). `?embed=1` is then unnecessary: there is
no chrome to hide, because we never load the chrome.

### 5.4 Events: one stream, not two

Interactive's control plane is already bus-native (ADR-0019: one vocabulary, `POST
/api/events` with a UI-emittable whitelist validated service-side). Crew consumes wicked-bus.
So: **`wicked.interactive.*` frames are relayed onto crew's `/ws` CoreEvent stream**, and
`useSse.js` retires (§4.9). The client keeps one subscription (§3.5), one runtime store, one
replay path.

The **UI-emittable whitelist stays server-side and stays authoritative.** The merged client
posts intent through the proxied `/api/events`; crew must not become a way to emit
non-whitelisted interactive events on the browser's behalf.

### 5.5 Same-origin document HTML — the real risk, stated plainly

Proxying `/doc/:version` to studio's origin means **agent-authored HTML executes on the app's
origin**. That HTML is influenced by untrusted input: attached source files, and pages
scraped by theme-grab. Same-origin script could read `localStorage` and call `/api/v1` with
the user's ambient authority.

- **Status quo is identical.** Interactive already serves `/doc` and its SPA from one origin,
  so this is not a regression introduced by the merge.
- **It stops being acceptable the moment crew has credentials to steal** — auth tokens, a
  remote runner, or any multi-user mode.
- **Therefore:** the doc frame gets `sandbox` from day one, with `allow-scripts` (documents
  are interactive HTML; dropping scripts would break decks) and **without** `allow-same-origin`
  *as soon as* the postMessage bridge in the next bullet exists. Until then, ship
  `allow-scripts allow-same-origin` — which is what runs today — and treat closing this as a
  tracked slice, not a someday.
- **The bridge:** `core/instrument.js` already injects `data-wid` anchors into every
  document. It is the natural place to also inject a tiny bridge script that posts
  `{wid → rect}` and scroll position to the parent, replacing direct `contentDocument`
  reads. That is the one change that lets the frame be fully sandboxed *and* keeps
  point-and-comment working — and it is why §6 schedules it explicitly rather than leaving
  it to "later".

### 5.6 Ports and lifecycle, concretely

| Concern | Resolution |
|---|---|
| crew API | studio's existing rule: same-origin in prod, `VITE_API_HOST` (`127.0.0.1:7701`) in dev. Unchanged. |
| studio dev server | `:4200` (`vite.config.ts`). Unchanged. |
| interactive bridge | dynamic from 4400 up, discovered by **crew** via `<root>/.wi-serve.json`. Never referenced by the browser. |
| bridge not running | crew starts it on first `/api/v1/interactive/*` request (ADR-0025's idempotent reuse-or-start), and reports "starting the document service…" as an **informative** status (§3.3) — not a spinner. |
| bridge unhealthy / missing deps | proxied preflight (`/api/preflight`) surfaces in studio's launch check as an **actionable** status with the install hint (§4.9). PPTX/ffmpeg stay out of the blocking gate. |
| multiple roots | crew resolves root per project binding (§4.8). One shared root remains the default (ADR-0025). |

### 5.7 What we keep from the original proposal

The iframe. It is the right call and the alternatives are worse: rendering agent-authored
HTML inline in the React tree gives away all isolation and lets document CSS fight studio's;
a screenshot service loses interactivity, which is the product. **Iframe yes — of the
document, same-origin via crew's proxy, sandboxed once the instrument bridge lands.**

ASSUMPTION[external-transform] library=crew reverse proxy (/api/v1/interactive/*) transform=rewrites request/response paths between studio's origin and the interactive bridge's dynamic origin confidence=known :: The proxy must rewrite relative asset URLs inside proxied document HTML (a doc's `<img src="./assets/x.png">` resolves against the proxied path, not the bridge root) and must stream SSE/chunked responses without buffering; `Location` headers on the bridge's redirects need rewriting too. Interactive's own `apiPath.js` already prefixes doc-scoped calls, so the prefix scheme is compatible — but asset resolution under the new prefix needs verification before slice 5 (§6) is called done.

## 6 Slice plan

### 6.0 Ground rules

- **Each PR is under 400 LOC of production diff** (tests excluded from the count, never
  from the PR).
- **Each PR ships behind no flag it can't remove**, except the one mode flag in slice 4.
- **Each PR is independently mergeable and independently revertable.** No slice leaves the
  app in a state where a wicked-interactive user has lost a capability (§4's parity bar).
- **Acceptance criteria are Playwright assertions**, written against `data-testid`
  selectors in the style already used by `LiveNarration` (`live-narration-${ord}`). Studio's
  browser gate is `e2e/studio_standalone_test.py` (Python + Playwright chromium, drives a
  real crew daemon); new specs extend it or sit beside it in the same harness.
- **Every slice's AC includes the §3.7 heuristic** where a working state is visible: no
  screen shows a spinner or status without a subject or a control.
- Follow the repo's merge protocol (branch, open PR, wait 6–8 min for bots + CI, address
  comments, then merge).

### 6.1 Phase A — transport (nothing user-visible moves yet)

**Slice 1 — crew proxies the interactive bridge** *(crew-side; ~250 LOC)*
Add `/api/v1/interactive/*` reverse proxy: resolve `<root>/.wi-serve.json`, health-check
(pid alive → retry `/api/health` 1.5 s × 3, ADR-0025), reuse-or-start, stream responses
unbuffered, rewrite `Location`.
*AC:* with no bridge running, `GET /api/v1/interactive/api/docs` → 200 JSON list; a second
request reuses the same pid; `curl` after killing the bridge → 200 again (restarted).
`grep -r "4400" packages/studio/dist` → no match.

**Slice 2 — studio client for the proxied service** *(~180 LOC)*
`src/api/interactive.ts`: typed wrappers for `listDocs`, `getVersions`, `createDoc`,
`postFork`, `postExport`, `getSources`, `postEvent`, resolved through `apiBase()`. No new
origin, no CORS.
*AC (unit + browser):* `client.resolver` test pins that every interactive URL derives from
`window.location.origin` in prod and `VITE_API_HOST` in dev; Playwright asserts zero
requests to any port other than the daemon's (`page.on('request')` filter).

**Slice 3 — relay `wicked.interactive.*` onto `/ws`** *(crew-side; ~200 LOC)*
Bridge bus frames into the CoreEvent stream; preserve the UI-emittable whitelist server-side.
*AC:* Playwright opens studio with a doc generating; a `wicked.interactive.status.posted`
frame arrives on the existing `/ws` socket (asserted via the page's socket, not a second
one); attempting to emit a non-whitelisted event type returns 400.

### 6.2 Phase B — IA shell

**Slice 4 — routes + mode switcher** *(~300 LOC)*
Extend `useRoute.ts` with `/p/:projectId/:mode[/:artifactId]`; render the four-mode switcher;
client-side redirects from `/runs/:id` and `/projects/:id`. Document/Video render a
placeholder that states what is coming (informative, §3.3).
*AC:* `data-testid="mode-switcher"` shows 4 tabs; clicking **Build** URL-changes to
`/p/<id>/build` and back-button returns; visiting a legacy `/runs/<id>` lands on
`/p/<project>/build/<id>` with the run open; an unavailable mode is `disabled` **and** its
tooltip names the enabling action (`toHaveAttribute('title', /install|connect|create/i)`).

**Slice 5 — orchestrator home board, static** *(~350 LOC)*
`/` renders per-project cards: header, run chips, quick actions, empty-state invitation.
Attention-ordered sort. Fixed card height.
*AC:* with 3 seeded projects (one gate-waiting, one running, one empty), the first card is
the gate-waiting one (`data-testid="project-card"` nth-0 contains `gate`); the empty
project's card shows 4 quick actions; 20 seeded projects render without the page height
exceeding N screens (virtualization assertion).

**Slice 6 — board goes live** *(~200 LOC)*
Cards subscribe to the shared runtime store; headline derivation per §3.4(b).
*AC:* while sitting on `/`, emitting a `unitOutputDelta` for project B updates *B's* card
headline within 2 s **without** a navigation or reload, and card A is unchanged.

**Slice 7 — answerable gate chips on the board** *(~180 LOC)*
Simple approve/reject inline on the card; complex gates deep-link to the thread message.
*AC:* clicking `data-testid="gate-approve-<runId>"` on the board advances the run (status
transitions off `awaiting_human` on the same page, no navigation); a complex gate's chip
navigates to `/p/<id>/build/<runId>` with the gate message scrolled into view and focused.

### 6.3 Phase C — Document mode

**Slice 8 — document canvas iframe** *(~220 LOC)*
Embed `/api/v1/interactive/.../doc/:version` in Document mode. `sandbox="allow-scripts
allow-same-origin"` (status quo; slice 12 tightens it).
*AC:* opening a seeded doc renders the iframe with a non-empty `contentDocument`;
`iframe.getAttribute('sandbox')` is present; no console errors; the frame's request URL
shares the page's origin.

**Slice 9 — version strip + fork, wired to the thread** *(~280 LOC)*
Rebuild `VersionStrip`; selecting a version swaps the frame and scrolls the thread to the
messages that produced it; fork creates a linked thread.
*AC:* a 3-version doc shows 3 entries; selecting v1 changes the frame's `src` to `…/doc/1`
**and** scrolls `data-testid="thread"` to the message tagged `v1`; **Fork** from v1 creates
a 4th version whose parent is 1 (asserted through the API) and opens a thread labelled
"continues from".

**Slice 10 — the thread in Document mode** *(~300 LOC)*
One composer, four states (§2.2) mapped onto document wires; ToolRail ported; review
verdicts as ordinary messages; **delete the whimsy filler and the 20 s heartbeat**.
*AC:* typing while idle creates a doc-generation run; typing while generating injects
(chip `data-testid="steering-chip"` visible); the transcript never contains any string from
the `WHIMSY` list (`expect(thread).not.toContainText(/reticulating|splines|bolts/i)`); no
`status.requested` event is emitted over a 60 s generating window.

**Slice 11 — point-and-comment overlay** *(~340 LOC)*
Port overlay/hit-testing/inline comment/batching against the same-origin frame; a submitted
batch posts into the thread as one user message.
*AC:* clicking a `[data-wid]` heading in the frame shows the comment box anchored to it
(overlay box within 4 px of the element's rect); adding 2 comments and submitting produces
**one** thread message containing both, **one** new version, and each item deep-links back
to its element.

**Slice 12 — sandbox the frame via the instrument bridge** *(~260 LOC; crosses into
wicked-interactive)*
`core/instrument.js` injects a rect/scroll postMessage bridge; the overlay switches from
`contentDocument` reads to messages; drop `allow-same-origin`.
*AC:* `sandbox` no longer contains `allow-same-origin`; slice 11's overlay AC still passes
byte-for-byte; a script inside the doc attempting `parent.localStorage` throws (asserted via
a fixture doc), proving isolation.

### 6.4 Phase D — Video mode and the long tail

**Slice 13 — Video mode: storyboard + player** *(~300 LOC)*
Rebuild `DemoStoryboard` and the player against the proxied endpoints.
*AC:* a seeded demo doc shows N chapter thumbnails matching its spec steps; clicking chapter
3 seeks the player; a missing-ffmpeg fixture shows an **actionable** message with an install
hint and no crash.

**Slice 14 — Video mode: record + re-record from the thread** *(~280 LOC)*
Ordered demo wizard retained (§4.1) for launch; step-targeted feedback triggers re-authoring
+ re-recording.
*AC:* commenting on storyboard step 2 and submitting produces a new version whose spec
differs at step 2; the recording status streams as informative narration, never a bare
`Working…` (`expect(status).not.toHaveText('Working…')`).

**Slice 15 — exports as thread artifacts + board quick action** *(~200 LOC)*
HTML/PDF/PPTX from the card and the thread; completed export lands as a downloadable message.
*AC:* triggering a PDF export yields a download whose filename matches `<doc-slug>_v<N>.pdf`;
a PPTX export with python-pptx absent renders a 400-derived **actionable** message with the
install hint and leaves the doc usable.

**Slice 16 — learn-a-theme (URL / PDF / image) + sources attach** *(~300 LOC)*
Thread actions + studio path picker; SSRF guard untouched server-side.
*AC:* submitting `http://169.254.169.254/` is rejected with a stated reason and **no**
outbound request (asserted server-side); attaching a local folder shows it as a context chip
and uploads nothing (`page.on('request')` sees no multipart body).

**Slice 17 — merged preflight / install gate** *(~180 LOC)*
Fold `/api/preflight` into studio's launch check; keep "Continue anyway"; keep PPTX/ffmpeg
non-blocking.
*AC:* with garden missing, the gate blocks with a named install command and a working
"Continue anyway"; with only ffmpeg missing, the gate does **not** appear and Document mode
opens normally.

**Slice 18 — retire the interactive SPA shell** *(~150 LOC deletions; wicked-interactive)*
Stop building/serving `frontend/`; the bridge becomes API-only. **Gate: §4.10's parity
ledger must be fully green before this merges.**
*AC:* the standalone gate script drives every §4 capability from the merged app only; the
interactive bridge serves no HTML shell (`GET /` → 404 or a redirect to studio).

### 6.5 Sequencing notes

- **1 → 2 → 3 are hard prerequisites** for everything else; they are also the slices with
  zero user-visible change, so they can land fast and unblock parallel work.
- **Phase B and Phase C are independent** after slice 4 and can proceed in parallel by
  different authors: B touches the board and stores, C touches Document mode.
- **Slice 12 is not optional and must not drift** — it is the security close-out for §5.5.
  If it slips, slice 18 must slip with it; shipping the merged app with a permanently
  same-origin doc frame is the one outcome this plan is designed to avoid.
- **Slice 18 is the only irreversible one.** Everything before it leaves wicked-interactive
  fully usable standalone, which is the escape hatch if parity work runs long.

### 6.6 Out of scope (named so they aren't assumed)

Light theme for studio's hardcoded dark palette (§4.9), an import-existing-HTML entry point
(§4.1), unifying crew Projects with interactive instances beyond what §4.8 already provides
(§1.6's open question), and any remote/multi-user story for either app.

## 7 Review resolutions (operator decisions, 2026-08-17)

Every finding in `.product/DES-MERGE-001-review.md` is resolved here. Where a resolution
amends an earlier section or a slice, this section wins.

### 7.1 Project identity (review #1 — BLOCKER)

Decided, not deferred: **a crew Project is THE entity.** An interactive "instance" (root
dir) maps to a project through one nullable project setting, `interactiveRoot` (default:
the shared root, ADR-0025). §1.6's open question is closed; §4.8's authority claim and
§5.6's "crew resolves root per project binding" now rest on this setting. Phase C depends
only on the setting existing, so §6.5's B ∥ C parallelism stands.

### 7.2 Proxy root selection (review #2 — BLOCKER)

The proxy path encodes the project: **`/api/v1/projects/:projectId/interactive/*`**.
Slice 1 mounts the proxy there; every slice 2 wrapper takes `projectId`. Crew resolves
`interactiveRoot` per project (7.1), pools bridges keyed by resolved root — two projects
sharing the default root share one bridge; projects bound to different roots get
different bridges. Multi-root is in scope from slice 1; "shared root" is only the default
value of the setting, not a constraint.

### 7.3 Slice 11/12 ordering (review #3 — RISK/HIGH)

**Merged into one slice (11+12, ~600 LOC, an explicit exception to the 400-LOC rule).**
The point-and-comment overlay ships only against the postMessage instrument bridge;
`allow-same-origin` never reaches users with the overlay live. §6.5's "must not drift"
becomes structural rather than aspirational.

### 7.4 Preferred narration path (review #4 — GAP)

The preferred path (document generation as crew runs) is **deferred post-merge** and
added to §6.6. The fallback is now specified: the bridge persists its SSE frames per
document (`agent-log.jsonl`, keyed `docId` + `seq`) and exposes
`GET /api/docs/:id/agent-log`; studio hydrates Document-mode narration from it exactly as
`hydrateOutputs` replays `unitOutputDelta`. §3.6's replay symmetry is satisfied with
doc-scoped keys; no crew `unit` identity is fabricated.

### 7.5 Doc thumbnails (review #5 — RISK/MED)

Slice 5 ships **placeholder tiles** (title, kind glyph, updated-at) — no live iframes on
the board. Live thumbnails are a named post-merge enhancement with a stated budget
(scripts-disabled `srcdoc`, `loading=lazy`, unmount off-viewport) if ever wanted. §1.4's
card anatomy is amended accordingly.

### 7.6 Version → message cross-link (review #6 — GAP)

The service is authoritative: generation/fork requests carry an optional
`sourceMessageId`; the bridge writes it into `versions.json` meta at commit. For a
multi-turn conversation the anchor is the last user message before generation started
(the client sends it). Slice 9 scrolls to `meta.sourceMessageId`; versions with a null
anchor (pre-merge docs) disable the scroll affordance rather than guessing.

### 7.7 Feedback batch → thread (review #7 — GAP)

**The client authors both writes**: on submit it emits the bus event (contract unchanged)
and posts the same batch as a user message via `POST /runs/:id/inject` — or as the
opening message of the new run when idle. No crew bus-listener is introduced. A failed
inject does not block the batch (the document still updates); the thread shows a
retryable "not recorded" chip (§3.3 actionable).

### 7.8 Governed doc QE (review #8 — GAP)

**Deferred post-merge** and removed from the §4.10 parity count — it was an upgrade
claim, not existing parity. Interactive's fire-and-forget `qe` request stays wired as-is
through the proxy. A follow-up design (DES-MERGE-002) will spec the crew workflow, its
input contract, and evidence format.

### 7.9 Remote runner (review #9 — CONTRADICTION)

Corrected: bridge lifecycle management is **explicitly local-only** (crew and the
interactive root share a host). The remote-runner future runs a bridge alongside remote
crew; nothing here forecloses that, and nothing here delivers it. The "one auth path
improves the remote story" claim in §5.3 is struck.

### 7.10 Document editing rhythm (review #10 — RISK/MED)

Document mode's composer hides the run seam: editing a complete version performs
fork + inject as **one atomic composer action**, and the thread renders the linked run as
a continuation — no new thread header, a subtle version divider instead. Governance
stays per-run underneath (evidence, gates unchanged). §2.2 case 4 gains this paragraph;
Build mode keeps the explicit follow-up affordance as designed.

### 7.11 Simple vs. complex gates (review #11 — GAP)

Heuristic, client-side, testable: a gate is **simple** iff its payload offers ≤2 choices
and requires no free text; everything else is complex. Slice 7's AC asserts both shapes
via fixtures. If the heuristic misfires in practice, an additive `complexity` hint on the
gate payload is the escape hatch (post-merge).

### 7.12 Bridge-start failure (review #12 — GAP)

Slice 1 gains an AC: when the bridge cannot start (missing install, port exhaustion), the
proxy answers `503` with JSON `{code: "bridge_unavailable", hint: "<named install/fix
command>"}`, and studio surfaces the hint verbatim (§3.3 actionable). The full preflight
gate remains slice 17.

### 7.13 Standalone SPA retirement (review #13 — RISK)

Slice 18: `GET /` on the bridge **redirects to the studio origin** recorded in
`.wi-serve.json` (crew writes its origin there when it starts or adopts a bridge);
`--standalone` keeps the old shell for development. The migration note lands in
wicked-interactive's README in the same PR.

### 7.14 Net effect on the plan

Slices 11 and 12 merge (7.3), so the count is 17. Slice 1 changes shape: project-scoped
mount (7.2) plus the failure AC (7.12). Slice 5 swaps live thumbnails for placeholder
tiles (7.5). No other ordering changes; Phase A remains the hard prerequisite chain.
