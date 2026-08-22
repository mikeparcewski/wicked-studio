# Design Update Brief — wicked-studio: from verified machinery to trusted terminal

**Provenance.** This brief distills a six-journey staff-engineer usability review run against the live daemon (2026-08-22): cold orientation/triage, a real governed build inside a project, a one-off document with iteration, multi-agent chat, repo intelligence on an unfamiliar codebase, and cross-project keyboard power flows. Every problem below was hit by a reviewer doing real work in the real UI; repro steps are included so no external evidence is needed.

**The verdict this brief responds to.** The studio is unmistakably the right skeleton — reviewers oriented in under a minute, called the gate experience and the morning lede best-in-class, and the repo dossier "replaces 30–40 minutes of terminal spelunking." But it fails today at exactly the two things its own pitch claims: **the human cannot see the evidence** ("done is re-derived from evidence" — yet a failed run cannot be diagnosed from the UI), and **the books are not truthful** (work detaches from projects, nothing says who launched a run, counters contradict each other on one screen). Fixing the trust spine is repair work on surfaces that already exist, not new invention.

---

## 0. What must NOT regress (protect explicitly)

- The morning lede + needs-you-first wall + 24h activity river on `/`.
- The gate experience end-to-end (plain-language ask, Approve/Approve+steer/Reject, policy provenance, toast+status+amber simultaneity, honest "Waiting for your input… → Run resumed" record).
- The honesty-label house style ("observed", "by files indexed", the search-corpus disclosure with [why?]). The contradictions in §C are *violations of* this style — the fix direction is more honesty, never less labeling.
- Live-everything updates; browser-history honesty; the repo profile + code graph; the composer's + drawer capabilities; council/evaluator transparency chips; the Burn panel; palette prefix self-teaching; the Theme page.

---

## A. The trust spine (highest priority — these are why an operator would stop using the product)

### A1 — Failed runs must answer "why did this fail" (CRITICAL)
A failed run's page shows only a one-line verdict ("Rejected: phase produced no reviewable substance"). Completed runs render unit output; failed runs render none. Every escape hatch dead-ends: the Term tab opens an empty "Operator shell"; **Full diff** returns raw `API 409: run … has no workdir` on repo-less runs and hangs on "Loading…" forever on historical runs **while firing zero network requests** (a frontend state bug); the per-file Diff tab reports "no changes to this file" for a file the run demonstrably created and committed (wrong baseline — branch-vs-base is what a reviewer means); an underlined NOTES.md evidence link does nothing on click. One reviewer spent 15 minutes of forensics to infer a missing-repo root cause the system knew and never said.
*Repro:* open any failed run (13 exist on the daemon); click Term, Full diff, and any evidence link.
*Direction:* render whatever unit/agent output exists for failed runs (the render path exists for completed ones); show the evaluator's verdict detail (which phase, what it evaluated); translate the 409 into a named cause + remediation ("this run had no repository attached — nothing was produced to review"); fix the zero-request hang outright; make per-file diffs branch-vs-base; wire evidence links to the in-app file viewer. NEEDS-BACKEND (verify, don't assume): worker-output retention/exposure on the run DTO for failed/in-flight runs; evaluator-reasoning exposure; diff baseline computation side.

### A2 — Project binding must persist and project views must mean it (CRITICAL)
Runs launched with a project selected (chip visibly set) record as "Unfiled" and are absent from that project's Build list; the home board shows "NOT IN A PROJECT (62)"; a fresh project's Build tab lists nine foreign runs; the repo-register form and a project card's Chat button silently reset context to Unfiled; footer counters remain global inside project views.
*Repro:* create a project, launch a build with the project chip set, then look for the run in the project's Build tab.
*Direction:* carry the composer's project id through creation and confirm it round-trips on the run DTO (the chip-says-X / record-says-Unfiled gap means the id is dropped somewhere on the wire — NEEDS-BACKEND to locate which side); scope project-shell lists and counters to the project; preserve project context on every entry point launched from project surfaces.

### A3 — Provenance: every run says "launched by X via Y" (MAJOR)
Nothing anywhere (run detail, notifications, runs tray) says who or what launched a run. A reviewer watched a new run + project materialize mid-session and spent minutes genuinely afraid their own silent keypress had burned money. On a shared daemon this is disqualifying.
*Direction:* one line on run detail and notification rows: actor (human/agent/system) + channel (studio/CLI/API/schedule/retry-of-Z); degrade honestly to "launched via API (actor unknown)". NEEDS-BACKEND: an actor/source field on the run record.

### A4 — Close the triage loop: Retry (MAJOR)
See-failure → understand → retry-with-a-tweak cannot be closed; the operator retypes the intent from memory.
*Direction:* Retry on failed runs reopens the composer prefilled (intent, repos, gates, workflow), editable before send; record retry-of lineage (pairs with A3). Frontend over the existing create API; the lineage field is NEEDS-BACKEND.

### A5 — Reconcile the numbers (MAJOR)
Same-screen contradictions: right rail "No usage reported yet" beside status bar "$0.12 observed"; "RUNS (24H) 1 failed" vs unlabeled "12 failed"; "ACTIVE RUNS (0)" directly above two listed runs; hotspot count 13 on the profile vs 11 in the graph modal; "260 symbols" vs "4,221 nodes" for one repo; the bell says "No notifications" while a gate waits.
*Direction:* one source of truth per displayed metric, explicit window labels on every count, silent filters must declare themselves. Mostly frontend; the burn feed discrepancy NEEDS-BACKEND verification.

## B. The artifact loop (the product's second promise — currently unreliable)

### B1 — Thread iteration silently drops requests (CRITICAL)
On a freshly created document: a change request typed while the initial generation was finishing was ignored, yet the thread rendered "▤ v2 landed" directly beneath it — implying the edit produced v2 (it did not; the requested slide never appeared). A second request sent while fully idle **never spawned a run at all**: no Generating state, no error, no run on the project dashboard. The composer promises "Ask for a change — it lands as a new version…" and the promise silently fails.
*Repro:* Make ＋ → Document in any project; after v1 lands, send a change request; compare v2's content against the request; send another and watch nothing happen.
*Direction:* every thread send must visibly become a run or visibly fail — queued-behind-current-run state included; version markers must anchor to the message that caused them (never render "vN landed" under an unrelated request). NEEDS-BACKEND: whether mid-run sends are dropped by the bridge or the client.

### B2 — The Unfiled path is a dead end in Make → Document (CRITICAL)
The picker pre-selects "Unfiled," but choosing it (mouse or keyboard) closes the popover and nothing happens — no error, no advance. Any real project advances instantly. The advertised no-ceremony path cost a reviewer ~10 minutes before they gave up and used a project.
*Direction:* make Unfiled work or remove it from the picker with an honest reason; a pre-selected default that is also a silent dead end is the worst of both.

### B3 — The document thread does not survive reload (CRITICAL)
After a page refresh the thread shows the empty state; the brief, version markers, in-flight theme-learn narration, and the export Download link are all gone. Consequently every version's "In thread" anchor is disabled with the tooltip "…Documents created before the merge have no anchor" — on a document created minutes earlier through this very composer.
*Direction:* thread history must persist and rehydrate; the anchor contract must hold for newly created docs. NEEDS-BACKEND: thread persistence on the bridge.

### B4 — A cross-project gate toast hijacks the workspace (MAJOR)
An unrelated project's "Run awaiting human" toast pins bottom-right at z-50 with **no dismiss control** and physically intercepts clicks on the composer, Send, and Export buttons (30s of blocked pointer events observed).
*Direction:* toasts must be dismissible, must never intercept unrelated surfaces, and cross-project interruptions should respect the current work context (the bottom bar's gate count already carries the ambient signal).

### B5 — Act-and-nothing-happens: export and theme-learn feedback (MAJOR)
Clicking HTML export fires the API call but nothing visible happens at the button (the "ready — Download" message lands only in the thread panel, which may be closed); a theme learn from a trivial URL narrated "Grabbing the page…" then hung 10+ minutes with no progress, timeout, or error — and the Themes popover shows no in-flight state.
*Direction:* point-of-action feedback for export (spinner → toast/download affordance where the click happened); theme learn needs progress, a timeout with an honest error, and in-flight state in the popover.

### B6 — Doc affordances that gaslight (MINOR)
Point-and-comment — named in the mode's own description — is disabled on a system-generated doc with the tooltip "this document did not answer the instrument bridge" (raw machinery as user copy); quoted names are slugified into the whole sentence ("a-quick-one-off-deck-named-uxr-quarterly-brief").
*Direction:* honest, actionable disabled-state copy; name extraction that respects quoted names.

## C. Coherence (majors that erode the power-user promise)

### C1 — One canonical runs surface
Every "All runs ›" affordance lands on /runs: done-only, no timestamps, no filters — 13 failed runs invisible. The real console (/work: filters, search, success rate) hides behind a small "view all →".
*Direction:* point all runs affordances at the real console (or merge the two); context-sensitive default filter (from a failure → Failed). Pure frontend.

### C2 — Run identity: timestamps, durations, titles
No start/end/duration anywhere on run detail or any list; five identical "Implement GitHub issue #167…" rows are indistinguishable in palette, /runs, tray, and search; the river's marks have no hover or click-through.
*Direction:* timestamps + duration on detail and every row (verify DTO fields — likely present); synthesized display titles (truncated intent + short-id + attempt ordinal) as step one.

### C3 — Execution visibility during runs + bookmarkability
Between "Run started" and the verdict nothing streams; Term is empty during live runs; after Send the URL stays /build/new so a refresh mid-run drops to a blank composer.
*Direction:* navigate to the run's URL on launch; stream whatever the daemon already relays (the LiveFeed proves deltas exist) into the run view; NEEDS-BACKEND for anything beyond the current relay.

### C4 — Keyboard coherence
'?' is dead everywhere (no cheatsheet); the j/k legend appears only after a lucky keypress and only when gates exist; 'a' approves from the board but is a **silent no-op on the gate panel itself**; Escape closes some modals but not the Operator shell or the bell; multi-select can't extend to a second gate on the same card; the shell doesn't take focus on open (first command swallowed).
*Direction:* a global '?' shortcut overlay; the gate panel honors a/r; one Escape contract for every layer; focus-on-open for the shell. Pure frontend.

### C5 — Preflight intelligence in the composer
A code intent launches from a repo-less project with no warning (guaranteed opaque failure, money burned); binding a repo to the project still doesn't auto-attach it; gates default to None against the product's own "you approve each gate" tagline, with the control hidden in the + drawer; "Run Onboarding"-class actions carry no cost/duration/destructiveness preview — a reviewer declined to press one on a live daemon, which is itself the finding.
*Direction:* warn-and-block (with override) on repo-less code intents; auto-attach the project's bound repo; promote the gate control; blast-radius previews on named actions.

### C6 — Chat: roster-true defaults, stream routing, persistence, zombies
The default chips (writer/reviewer/planner) are rejected by the daemon on every fresh chat so the first send always fails (and the failed send clears the composer); only 1 of 6 seats replies, the rest go mute-red with no reason or retry; reply chunks splice mid-word into the wrong bubble; sessions are invisible in /chats even while streaming and unrecoverable after tab close; abandoned tabs leak zombie "working" agents into global counters with nothing clickable to find or stop them. There is also no bridge from a conversation into action (a build/doc) carrying context.
*Direction:* seed chips from the live roster (the + Add menu proves the endpoint); fix chunk→bubble correlation; explicit seat states (connecting/working/failed-with-reason + retry); never clear a failed composer; persist and list sessions; make every "working" count clickable to its source; a promote-to-run affordance carrying the transcript. NEEDS-BACKEND: session persistence/lifecycle and per-seat failure reasons.

## D. Hygiene (small, highest trust-per-line)

- **Copy:** no wire jargon in user copy — "diff: not exposed on the run DTO (work_output pending daemon surface)", "(core#24/#26)", raw "API 409:" strings, "did not answer the instrument bridge"; project display names instead of `proj_…` ids (one page titles itself with the raw id while the rail highlights the wrong project); repo-relative paths instead of 5-line /private/var sandbox paths; "New Projects"/"New Repositories" grammar.
- **Fresh-entity hydration:** a just-created project renders its raw id + "20687d ago" and is missing from the rail until reload; /system shows "permission blocked" when granted until clicked; contributor identity splits one human into two rows.
- **Dead ends:** disabled controls must say why in operator language and, where possible, what to do.

---

## Sequencing guidance (not a mandate)

1. **A1 + A2** are the spine — evidence and truthful books. Nothing else earns trust until these hold.
2. **B1–B3** restore the artifact promise (the second product pillar).
3. **A3–A5, C1–C3** make the operator-of-many-projects story real.
4. **C4–C6, B4–B6, D** complete the terminal feel.

## Constraints (house rules — all pre-existing, all enforced by CI/rigs)

- **Wire honesty is law.** No invented routes or fields; every data claim verified against the daemon source / `wicked-crew-api-types`; NEEDS-BACKEND items get their own flagged cross-repo slices with schemas specced before any client work; fixtures speak only real shapes; the real-bridge contract check must stay green and grow FATAL probes for any new wires.
- Design tokens only (no-raw-color is a build-failing rule); the EC experience checklist and existing rigs must stay green or be re-scoped in dedicated, justified commits; every slice ships named 1440×900 screenshots and survives adversarial verification (negative checks vs main, request-tap fetch budgets, pixel judgment).
- Zero-requests-on-mount budgets where established (chat, palette, panels); keyboard changes go through the one shortcut registry.
- Preserve everything in §0.

## Definition of done

The six review journeys, re-run cold by a skeptic against the live daemon, complete without hitting any A/B-class problem: a failed run diagnosed from its page in under two minutes; a project's Build tab showing exactly its runs; a document iterated twice with both edits landing and the thread surviving reload; a chat whose first send succeeds and whose session is findable afterward; every count on one screen consistent; '?' answering the keyboard question. Machinery-level ACs are necessary but not sufficient — **the journey is the acceptance test.**
