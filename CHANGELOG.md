# Changelog

All notable changes to **wicked-studio** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
(0.x: minor versions may contain breaking changes).

Backfilled 2026-08-29 from the git history and the npm registry; release dates are the
npm publish dates. Every version listed here exists on
[npm](https://www.npmjs.com/package/wicked-studio?activeTab=versions).

## [Unreleased]

### Added
- S18a: two gate-answering ports from the classic skin land on the Desk (DES-STUDIO-REBUILD-001 Amendment 5). (1) The approvals group row ("2 approvals") answers in place — **Approve all** / **Reject all**, plus an optional **Reject with reason…**, fanning out one `POST /runs/:id/gate` per member through the shared batch path (the one 10 s undo window, per-id failure rows with retry-just-this-one — never an optimistic "approved all"); the group still expands to open each member. (2) The Desk question row's **Reject** choice opens an optional one-line reason that upgrades the decision to `{approve:false, amend}` — while the keyboard fast path (a digit, or Enter on a moved-to choice) still commits the bare reject at once.

## [0.6.5] — 2026-10-08

Everything › Sessions gains an "Every run" table beside the grouped view (S17b, studio#586), and a
finished run with no governance evidence says so once (S17c, studio#589, delivered by governed run
`dee87f48` on the rig). Also: an orphaned run says so and offers Resume (#545), a denied-unit gate
row offers Approve with the suggested arm (#573), one vocabulary for plan step names (#574), the
delivered card links its PR and the deliver card reads its evidence truthfully (#575, #577), and a
refused ask member is no longer listed as a reviewer (#540).

### Added
- S17c: a finished run with no governance evidence says so once ("No governance evidence was recorded for this run — it ended <ago>"), with the individual reasons collapsed under ⋯; the run's chain sentence says "· nothing checked".
- #545: a run the daemon restart orphaned says so — the session thread shows "The daemon restarted while this step was running; nothing is working on it." with one action, Resume (`POST /runs/:id/resume`); the Desk's needs-you queue counts it (above any stall verdict, with `Resume ›`); the Watchtower says "N runs were orphaned by a restart". The verdict is the engine's `runOrphaned` report as the newest dispatch-or-orphan frame of the run's trail (crew#830) — read once per executing run for a late join, kept current by the live frames.
- S17b: an "Every run" table on Everything › Sessions (DES-STUDIO-REBUILD-001 Amendment 5, §5.4). A view switch beside the filter chips toggles Grouped (the default) and Every run (`?view=runs`, carried like a filter); the tab header says the full count ("124 runs · 97 sessions"). The table is one row per run — state, what, project, repo, workflow, started, updated — every column sorts on click (default newest-updated), a text filter spans title/id/project/repo/workflow, the state chips apply, and it pages at 100. It paints the moment `GET /runs` answers, never waiting on the board-model fan-out; the Archived lens lists archived runs in the same table with Unarchive, and a per-row ⋯ opens the run, looks underneath, and (for a finished run) offers Reuse as preset / Draft update / Archive.

### Fixed
- #540: the ask thread's shape line names a reviewer only when its join attached — a member whose join failed ("No reviewer — <seat> can't join") is no longer listed as "<seat> reviews"; an ask run whose `problem` is crew's chat-scope statement is titled by what the conversation is about ("A conversation about <repo>"), never "# Chat scope" — the chat's own question still wins when the transcript is at hand.
- Session gate row: a unit DENIED by input governance (the engine's `boundary_deny` pause) now carries the engine's own arms — **Approve** re-runs the phase (suggested when the floor and the judge passed), Approve and steer, Stop — instead of Send back / steer / Stop with nothing suggested; there is no reviewer finding to send back on a denied unit (#573).
- Plan editor: the reorderable list, its move refusals, its order line and the card's "The order changes" line now name each step as the proposal sentence and the chain line do — from the plan's step ids (Scope · Clarify · Plan · Build · Challenge · Test · Review · Deliver), distinct across the plan — instead of by catalog alone (Research, Review, Review) (#574).
- Session thread: the finished run's receipt ("✓ Done · Finished · delivered") now links the pull request it opened — the same `Pull request ↗` the Handed-over row carries — or names the pushed branch when no PR was opened (#575). The deliver card's acceptance line no longer says "(missing ⇒ deny)" above a Deliver that will succeed: when crew's QE acceptance gate has no verdict to judge, the line says that Deliver does not consult it and names what this hand-over rests on — the run's own floor and reviewer gates, off its events; a FAILED verdict or an unreadable ledger keeps crew's words and the bad tone (#577).

## [0.6.4] — 2026-10-07

Projects are visible and manageable again under the Desk (DES-STUDIO-REBUILD-001 Amendment 5,
slice S17a — projects are reached from Everything, never a new rail entry): a Projects tab on
`/everything`, a New project door on the tab and on the Desk, and `/p/:id` landing on the
project's own scoped Sessions view under a project header (studio#576, delivered by governed run
`049f77d8` on the rig). Also the S15e gate row as seen on real paused runs in the 0.6.3 desk reel
— the row is styled, the send-back note keeps its caret, and each gate kind asks its own question
(studio#568, #569, #570) — and an engine cancel is no longer attributed to the operator's
send-back note (studio#537).

### Added
- S17a: Projects tab on Everything with active and archived registers, project actions, and a New project door on the tab and Desk. `/p/:id` now opens the project's scoped Sessions view with a project header.

### Fixed
- **The session-thread gate row is styled, the send-back note keeps its caret, and each gate kind asks its own question (studio#568, #569, #570; #572).** As seen on real paused runs in desk-reel chapter 35 (crew 0.8.3 / studio 0.6.3). **#568** — no stylesheet defined any `wk-session-gate-*` class: `src/styles/components.css` gains the block (after the `wk-prop-*` rules) — the choices as pills in a radio group, the suggested one dashed with a `suggested` tag, a focus ring on the focused choice and on the row, ⋯ / Details / the note as disclosures with a ▸/▾ marker, the note full-width under the choices, and the fold's `Undo` button set apart from "Undo 10 s"; tokens only. `tests/sessionView.gateRow.g19.test.tsx` reads `GateRow.tsx`, extracts every `wk-session-gate-*` class it renders and fails when one has no rule in the stylesheet chain (it also pins `index.css → global.css → components.css`). **#569** — the Send-back note lost focus to the composer: `GateRow`'s `useLayoutEffect(..., [model])` re-focused the row on every model recompute while `#gate` was in the URL (and `model` recomputes on every thread update — units re-polled, an event appended, the roster read); once the row held focus, `useTypeToComposer` sent the next letter to the composer. Now the `#gate` focus happens once per gate (keyed on `gateKey`), never while the note is open or focus is already inside the row; the note opens with the caret at the end of its pre-filled text (Chrome's programmatic focus put it at 0 — why the recorded POST body began with `"\n"` + the typed text in front of the pre-fill); `Escape` cancels the note and hands focus back to the row (Cancel does the same). **#570** — the question was generic on every non-def kind: `plainGateQuestion` (`src/board/deskWords.ts`) gains `pausedStepQuestion`, the engine's pause prompts as one line each — `The reviewer said FAIL — send it back?` (only when the prompt names the request-changes arm), `The reviewer changed the work instead of judging it — retry on the restored tree?`, `The step did not pass review — how should it go on?`, `The floor failed — how should the step go on?`, `A Bash call was denied — how should the step go on?` (the refused tool named), `Governance denied this step — how should it go on?`, `The team disagreed — approve or reject the work?`, plus the triage-escalated / could-not-start / generic-escalation lines; the Desk's needs-you row and the gate toast share the function and now read the same words. No testid changes. Tests: 9 vitest files, 168 cases (red first: 4 failed against 0.6.3 — 21 unstyled classes, the re-focus on a thread update, the caret at 0, Escape inert); DESK journey `desk_gate_kinds`.
- **An engine cancel is never attributed to the operator's send-back note (studio#537 part (a); #564).** On the rig, run `ada5b0aa` was cancelled by the engine when the creator unit timed out; the operator's last gate answer, 2 h 45 min earlier, was "Send back to the creator" (`gate.decided {approve:false, action:'request_changes', amend}`), and the run page read **"Run cancelled. You rejected it: \"Fix the reviewer's failing items…\""** — the cancel attributed to the operator, with the send-back note (which rewound the creator and was acted on) shown as the rejection reason. `rejectNoteOf` (`src/store/provenance.ts`) treated every `gate.decided` with `approve: false` and words as a rejection; on the wire (api-types 0.92.0 `GateDecision`) `approve: false` + `action: 'request_changes'` is a send-back, not a rejection — only the absent-`action` legacy arm and `action: 'reject'` reject. Now, from the same one audit fetch per detail view, the cancelled banner reads: a real rejection with words → `Run cancelled.` + `You rejected it: "…"` (unchanged); no rejection and the daemon's `run.turn.timedout` audit mark on record → `Run cancelled — the engine stopped it: a worker turn hit its time ceiling.`; no rejection and a send-back on record → `Your last send-back to the creator (acted on — not a rejection): "…"`; nothing on record → `Run cancelled.` — nothing is invented (an operator's own Cancel also leaves no rejection, so the engine sentence is emitted only on the audit mark). `data-cause` on the banner (`rejected` / `engine-timeout` / `unattributed`) and `data-testid="failure-send-back-note"`; `isRejection` / `isSendBack`, `sendBackNoteOf`, `ENGINE_TIMEOUT_AUDIT`, `CancelStory` / `cancelStoryOf`, `cancelStories` in the store; `FailureBanner.tsx`'s cancelled branch. Part (b) of #537 (phase counts 5 vs 6 of 11) is verified after S17; part (c) (`/units/:ord/output` serving attempt 0) is crew's, filed there. Tests: `tests/provenance.store.test.ts`, `tests/FailureBanner.test.tsx`.

## [0.6.3] — 2026-10-07

Every gate kind is answerable in the session thread (DES-STUDIO-REBUILD-001 Amendment 5 §1;
DESIGN-interaction rules 5 and 6, slice S15e): plan and deliver gates stay a proposal card, every
other gate — def / run-level, a reviewer-FAIL escalation, a seat-failure or retry gate, a team
pause, a free-text question, an enumerated choice, an unknown kind — is one compact row of 2–4
choices with the recommended one preselected, answered through the same single `confirmGate`
caller as the Desk (10 s undo, double-submit guard, 409 "gate moved"), folding to a receipt that
survives the gate clearing and a remount. Every gate deep link (Needs-you, Watchtower, the
desktop notification, peek-jump `G`, triage `a`) now lands at `/s/run:<id>#gate`. Also the
Repositories card's captured-learnings line and five corrections from the wave-1/2 defect lists
on the released 0.6.2 Desk (studio#405, #406, #408, #485, #546).

### Added
- **Every gate kind is answerable in the session thread (S15e; DESIGN-interaction rules 5 and 6, DES-STUDIO-REBUILD Amendment 5 §1; wicked-studio#539, #547, #403).** `RunBlock` in `/s/run:<id>` now answers every open gate: plan and deliver gates stay a `ProposalCard` (`proposalKindOf` returns `'plan' | 'deliver' | null`; the `'step'` kind and `stepQuestion` are gone), and every other gate — def / run-level, a reviewer-FAIL escalation, a seat-failure or retry gate, a team pause, a free-text question, a gate carrying its own enumerated choices, and a gate of unknown kind — is a `GateRow` (`src/components/session/GateRow.tsx`, model `src/board/gateRowModel.ts` → `sessionGateChoices`): one compact row of 2–4 choices with the recommended one preselected ("suggested"), arrows / Home / End move, a digit picks and sends, Enter sends once the operator has moved, the raw prompt, verdict layers, failing items, reviewer note and the floor's per-check lines sit behind a `⋯` disclosure, and an answered row folds to one line — "You chose: Approve · Undo 9 s" through the 10 s undo window, then "You chose: Approve, 04:22". Choice sets: def / run-level → Approve · Approve and steer · Send back · Stop (steer sends `amendScope: 'creator'` only when a later creator phase exists, the run page's rule); escalation → Send back (preselected when `recommendGateMove` says so, note pre-filled from the reviewer's failing items) · the engine's escalation arms (extend / targeted / accept partial / adopted suggestion) · Approve and steer · the first Reassign candidate · Stop, the rest in `⋯` (3 inline + Stop); retry → Retry · Reassign · Stop, with no Reassign after a launch refusal (another seat meets the same environment); team / choices → the engine's choices, first 4 inline, rest in `⋯`, an unrecognised choice value renders disabled ("No wire for this choice yet — answer on the run page"), and when every choice is unknown the row still offers Stop and "Send a note instead"; free-text → one Send that opens the note; unknown → Approve · Stop. Every answer goes through `commitGateDecision` / `commitGateReassign` (the single `confirmGate` caller; `gateWireSingleCaller.test.ts`), so the 10 s undo, the double-submit guard and the 409 "gate moved" words are the same as the Desk's. The sent answer is a receipt in `GateActionState` (`receipt: { kind: 'plan' | 'deliver' | 'row', chosenLabel, sentAt }`), so the fold and the proposal's outcome survive the gate clearing and a remount of the thread (rule 5) — no component-local ref. Arriving at `#gate` focuses the row (or the deliver card's primary button). The deliver card's "Delivery details" disclosure shows the diffstat parsed from `GET /runs/:id/diff?base=merge-base` ("N files changed, +A, −D"; falls back to the changed-file count of the gate's `repoChecksEvaluated` event when the diff is unavailable), the branch (`session.run_branch`, else the diff's), the repository, and the floor's per-check lines. Every gate deep link lands in the thread at the row: the Desk's Needs-you row and the Watchtower's waiting-session link (`gateOpenPath` → `/s/run%3A<id>#gate`, project known or not), the desktop-notification click, peek-jump `G`, and the triage cursor's `a`; a gated waiting session's own link carries `#gate`. New: `src/board/gateRowModel.ts`, `src/components/session/GateRow.tsx`; changed: `src/board/{gateActions,needsYou,peekTarget,desktopNotify,deskModel,proposalCard}.ts`, `src/components/session/{SessionView,ProposalCard}.tsx` (`RunBlock` exported; `GateRow` and `ProposalCard` each hydrate the run's events on the session page). Tests: `tests/gateRowModel.s15e.test.ts`, `tests/sessionView.gateRow.s15e.test.tsx` (incl. the remount receipt through `RunBlock`), `tests/proposalCard.test.ts`; DESK journey `e2e/desk_gate_kinds_test.py` (def row, steer opens the note, approve + undo, Enter inert until moved, reviewer escalation send-back, deliver details with diffstat + branch, Needs-you → `#gate`, seat-failure Reassign / Stop / Approve and steer, 409 gate moved). Carried as follow-ups, not in this slice: a `team_dispute` gate without engine `choices` offers Approve / Reject only; the row preselects only a recommended send-back; one session-level event hydration path; the send-back prefill of "Concerns" and bold-paragraph verdicts.
- **The repository card shows when learnings were captured (studio#294; #562).** After a capture-learnings run the Repositories card only bumped the generic run count, so a captured repo was indistinguishable from one never captured and nothing told a fresh operator the "Capture learnings" verb exists. The card now carries one captured-learnings line derived from the repo's newest `capture-learnings` run the way the graph line is derived from its newest `onboarding` run — `learnings captured · 2h ago — durable memory holds this repo's history` (button "Capture learnings again"), `capturing learnings now — …` while executing / awaiting, a failed capture named as such — and the `repoStats.capture` read backs it. Tests: four vitest files (50 cases); DESK journey `desk_repo_page`.

### Fixed
- **The narrator never prints the ` ||| ` instruction separator (studio#405; #550).** The engine joins a planned unit's description to its phase instructions (and any approved intent amendment) with ` ||| `. Every gate already split it; the narration's "Planned … — …" lines did not, so the raw marker showed in the run thread, the Desk sheet's Activity tail and the Watchtower lines. `src/components/narrator.ts` — the `unitPlanned` arm now takes segment 0 of `description` (split on `INSTRUCTION_SEP`) before the existing prefix strip, `restates()` and `clip()`.
- **An unchanged lift is not red when a later step fails (studio#408; #551).** The DeliverLift card wore `--status-fail` whenever `liftIsFailure(view)` was true — true for *any* `stepFailed` of the deliver unit — so an `unchanged` lift ("base unchanged — main is still at …", good news) rendered red when the push was refused afterwards. New `liftItselfFailed(view)` in `src/components/deliverLiftModel.ts` drives the card's tone (`data-lift-tone="pass|fail|muted"`); `liftIsFailure` is unchanged for RunDelivery, RunTimeline and SteeringGate, which read it as the attempt predicate; the failure line keeps its own `--status-fail`.
- **A zero-hit memories search says so instead of "No memories in the store" (studio#406; #552).** Both empty states read `memories.length === 0`, but `memories` is the search result (Memories page) / the preview's listing (dashboard), not the store — a zero-hit query said "No memories in the store." under a header saying "2 in store". `MemoriesPanel` now distinguishes a zero-hit search (with a Clear search control) from an empty store, re-reads coverage after a retire, and `GovernanceDashboard`'s `MemoriesBrowse` receives the KPI tile's `coverageTotal` for the preview's empty copy.
- **The skills recovery block shows `~/`, not the home directory (studio#546; #553).** When `GET /skills` answers 503 the recovery block printed the engine's snapshot input as an absolute path under the daemon's state home — account name and folder layout included — in the default layer (the desk reel had to blur it). `SkillsPage.tsx` now passes `engine.engineInput` through the page's `useDisplayPath()` hook, the rule the header's root line and the `WICKED_SKILLS_SNAPSHOT` title already follow. Test: `tests/SkillsPage.recovery.test.tsx`.
- **The plan picker opens only on a fresh team read (studio#485; #555).** "Edit the plan…" was seeded from `planGate.view?.editSeed` — the cached team view — with nothing checking that the view was read for the gate instance now open, so a successor plan gate opening before its team read landed showed the predecessor's plan, and approving posted it. `SteeringGate.tsx` now reads `usePlanGate().fresh` / `.reading` (from #482): the controls wait behind a "Reading the plan for this gate…" line while reading, and a `gateInstance` effect closes an open editor when the gate instance changes.
- **The Health rail settles once `/health` answers (studio#280 item 2; #563 — shipped in 0.6.3, this line added in the 0.6.4 cut).** RC1 saw the rail-foot Health registry read "API server checking… / seats checking… / governance checking…" 2.5 s after the expand while the daemon's `/health` answered in < 50 ms. The component had no notion of a probe that does not settle: a pending fetch read "checking…" forever, an answer carried no clock, a rejection said only "unreachable", and only the diagnostics read was guarded against a slow earlier answer landing over a later expand. Now every probe settles visibly, inside `HealthRailSection.tsx`: answered → `ok · 0.6.2` + `checked HH:MM:SS` (its own span — the detail text is verbatim); rejected → `✗ unreachable — <the error's sentence>` + its clock, heart degraded; pending past `PROBE_DEADLINE_MS` (4 s) → `no answer after 4 s — still waiting` + **check again** (re-runs the expand's probes without a collapse); a kept answer from an earlier expand with this expand's probe past the deadline → the kept answer with its clock, `data-state="stale"` + **check again**, the seats list kept under `no answer after 4 s · showing the last answer`. One expand generation guards `/health`, `/roster` and `/diagnostics` (a slow earlier answer never lands over a later one); an unmount-only cleanup retires in-flight probes. Untouched: fetch on gesture (zero requests before the expand, one of each per expand), answers survive a collapse for the summary dot, the heart/dot signals, the seat-row anatomy, the governance rows. `CheckRow` gains `since` / `testId` / `state` / `action`; `probeOverdueWord()`; `probeDeadlineMs` prop (tests shorten it). Items 1, 4 and 5 of #280 are closed as fixed / no Desk form in the issue thread; item 3 (`/health` address) is a follow-up after S16a. Tests: `tests/HealthRailSection.test.tsx` (new describe, 6 cases); DESK journey `desk_rail`.

## [0.6.2] — 2026-10-06

The ask is one thread (DES-STUDIO-REBUILD-001 Amendment 6; DES-ASK-TEAM-CHAT-001). On a daemon
whose `capabilities.askPath` is true — the ask path landed in wicked-crew after the 0.8.1 publish
and ships in 0.8.2, on wicked-core-ts ≥ 0.7.38; the bullets' live proofs ran against that main
build, which still named itself 0.8.1 — one primary
helper answers — chosen, or picked at random among the signed-in seats — a reviewer watches and
its findings are quiet lines under the reply, Continue in Build is a card in the thread, and the
session's Helpers sheet names the path's seats by role. On an older daemon the thread says so and
keeps the released behaviour. Also the W12 reel's corrections to the released 0.6.1 Desk: the
chrome fits a 700-px window, Settings and Theme say what is true, demos and onboarding sessions
read in plain words.

### Added
- **The session's Helpers sheet names the ask path's seats by role (DES-ASK-TEAM-CHAT-001 §10, slice ASK-S3, first half).** Under `capabilities.askPath` the look-underneath's Helpers tab reads `GET /chats/:id.path` and leads with the path, by ROLE (what the wire records — identities, not what a seat is doing right now): **"claude primary helper · picked at random"** (or "· your pick"), **"pi reviewer"** (**"· also answered a question the primary helper asked"** when the reviewer answered a HELP: line too), **"codex helped — answered a question the primary helper asked"**; no reviewer reads **"No reviewer attached."**, or — only when the roster shows no other seat — "No reviewer — only claude is signed in." with **Sign in**, which opens the Sign-ins tab. Every named seat opens its helper sheet, like the run rows, which follow as before. Without the capability the tab is the run rows alone. The Watchtower half of ASK-S3 waits on crew's ASK-C3 (the `path.repicked` / absent-reviewer / non-answered-help entries are not shipped yet). New: `useAskPath` in `src/components/sheets/ObjectSheet.tsx`; testids `sheet-helper-role`, `sheet-helper-signin`. Tests: `tests/sessionSheet.askHelpers.test.tsx`; the DESK journey `e2e/desk_ask_team_test.py` opens the sheet and reads the roles.
- **The ask's turn gate stays undrawn after a reload on a real daemon; the LIVE ask-path journey (DES-ASK-TEAM-CHAT-001 §9 E2E).** The LIVE proof against a real wicked-crew 0.8.1 daemon (core-ts 0.7.38, seats claude + opencode) found the one wording the fixture had invented: the engine's terminal gate reads "Approve completion after the final phase (unit N): <step> — …" (`actor.rs`), so a reload read the real ask's turn gate back without a kind, classified it as a real gate and drew the run's block and a Desk row. The late-join words now carry the engine's three prompts (`src/board/askThread.ts`). `e2e/live_ask_path_test.py` (LIVE list, operator-run against `CREW_ORIGIN`): builds the studio with `VITE_API_HOST` baked, asks from the Desk, waits for the real reply and proves one voice, the who-line against `path.started`, the reviewer line against `member.joined` and `GET /chats/:id.path`, the undrawn turn gate (run `awaiting_human`, session "waiting", no Desk row) and 0 page errors. Run 5 on 2026-10-06 passed 7/7 (PA opencode picked at random, claude reviewing).
- **Continue in Build happens in the thread (DES-ASK-TEAM-CHAT-001 §4.7, slice ASK-S2).** When the primary helper proposes work — a `plan.proposed{kind:change}` that adds the first creator step, scored on the touch it declared (`path.scored{basis:intent}`), the floor's additions (`plan.revised`), and the engine's crossing-into-work approval row (`gate.opened{plan_approval, reason:first_creator}`, core ASK-K2b) — the session thread shows ONE proposal card where the proposal landed: **"Continue in Build? claude proposes: Build → Check (required)."** with "band 20–39 · touches 2 declared paths · 12 dependents" (the touch set is declared paths — a directory counts as one; a proposal with no declared scope says "high risk — the helper declared no scope" beside whatever band the engine gave it, §8 F10) and three answers through the one decision path (`POST /runs/:id/gate`, `board/gateActions.ts`): **Continue in Build** = approve (the run's block and chain line appear once the engine accepts the rev; the shape line yields to the chain); **Not now** = approve with the ACCEPTED rev's steps (nothing accepted is removed, no build; the card stays as "Not now — the conversation goes on; the proposal stays here" with **Bring it back**, which prefills the composer with "Go ahead with the plan you proposed." — the operator's own words, so the helper re-proposes; nothing re-posts a dead proposal); **End** = reject (the path is cancelled; "Conversation ended"). The run's own block stays hidden while the plan gate of a pending build proposal is open — the card is that gate's surface. Between the answer and the engine's `gate.decided` row the card says what was answered (never "Starting the work" for a Not now), for at most 15 s; an open proposal with no cached gate holds the block away for at most 60 s (the runs reconcile reads the gate back); a deliver, escalation or any other gate on the run takes precedence over the card. Every row is correlated to ITS proposal (`proposal_id`, the bound `gate_id`; a reopen for the same plan rev after a refused answer rebinds); a refused answer keeps the three choices (no "Try again" that would re-send an approve), also when the gate it was made on is gone; Not now re-approves the NEWEST accepted rev; a step reads "(required)" only when the floor added it. The Not now and End notices say what was answered in the operator's words. Under `capabilities.askPath` the prefill promote is gone: the legacy chat page's "Continue in Build →" becomes **Build this**, which puts the operator's words in the composer (`promoteToBuild` survives only on the pre-capability branch). New: `askProposal` / `AskProposal` (`src/board/askThread.ts`), `askProposalWords` and the ask branch of `proposalCard` (`src/board/proposalCard.ts`), `ProposalCard`'s `ask` / `onBringBack` / End, `AskProposalBlock` in `SessionView.tsx`. Tests: `tests/askProposal.test.ts`, `tests/sessionThread.ask.s2.test.tsx`; DESK journey `e2e/desk_ask_path_test.py` over the fixture's `ask_path` replay ("Build this" → the card → Not now → Bring it back → re-proposal → Continue in Build → the chain line; a fresh ask → End). New testids: `session-ask-proposal`, `session-proposal-end`.
- **The ask thread: one helper answers, a reviewer watches, and the session shows it as ONE thread (DES-ASK-TEAM-CHAT-001 §4.8, slice ASK-S1; DES-STUDIO-REBUILD-001 Amendment 6).** The operator saw "claude and opencode answering with each's opinion"; what was designed is a team path driven by one agent. With wicked-crew's `capabilities.askPath` (crew ≥ 0.8.1 on core-ts ≥ 0.7.38), a question typed on the Desk or in a session starts a team path: crew picks ONE eligible signed-in helper at random (or the one named with `@helper` before the first send — `ChatOpenBody.primary`), scores the ask, seats a reviewer, and the primary helper's answer is the only reply. The session thread now folds three sources into one list in time order — the transcript (and the turns this client deposited or streamed before the transcript has them), the path's `wicked.team.*` rows as quiet lines, and the other runs' blocks: **"claude answers · picked at random"** (expands to the pick and roster, the score and band, the shape — *answer · research · check · build*), **"codex is reviewing"**, the PA's reply as the one bubble on the agent side (labelled "claude · answering" while it streams; "claude is thinking" while the answer step is claimed and nothing has landed), **"reviewer · 1 finding: …"** under the reply (expands to the evidence and suggestion; "claude: declined — …" / "reviewer holds" appended as they land), **"asked codex: … · answered"** under the reply (expands to the answer; "codex did not answer (timed out)" / "no other helper is signed in" otherwise), **"No reviewer — only claude is signed in."** with Sign in (the session sheet's Sign-ins), **"claude didn't answer in 10 min"**, **"codex takes over — claude stopped answering"**, **"claude started over after a restart"**, the one-seat refusal **"Can't build from here: only claude is signed in; sign in another helper so review can run."**, **"Conversation ended"**. Every quiet line is the look-underneath of its row. The ask run's own block, chain line and proposal card stay hidden while the plan has no creator step — the thread IS the chain, and a shape line under it names the steps — and come back once one is accepted, or when the run opened a gate the composer cannot answer (a hand-over, an escalation, a plan approval) or stopped. The ask's TURN gate (the engine's def / terminal HumanConfirm AT an answer step — a unit the reply's `ord`, the runs list's `answer-N` units or `step.claimed` placed; a gate at any other unit, a gated research step included, is drawn — while the plan has no creator step) draws nothing: the next message is the answer; the gate store leaves it undrawn and RECORDS it (a gate cached before the run was known as a path is reclassified when the runs list says so) — the one positive fact the Desk acts on (that gate row is skipped; every other row of the run stays; an unknown gate stays a gate), the session reads "waiting", and a gate reconciled on a late join (no kind) is told apart by the engine's own words ("Approve unit N before it runs" / "Approve the output of unit N" — a hand-over, an escalation or a plan approval is kept). Once a creator step is accepted every gate on the run is drawn. A finding or help line sits under the reply of ITS answer step (matched by unit, not by time — a slow final pass publishes after later turns), the who-line keeps the FIRST pick and the absent-reviewer line names the helper of its own moment (a re-pick does not rewrite history), every quiet line expands to its row, an un-teamed path (no team transport) and a failed team read are said in the thread, and the Ask dock's "Open in full chat" leads to the session (not the fan-out surface) and renders the relay's reply as the canonical text. A message while the PA is answering (409 `turn_in_flight`) is said as "claude is still answering — wait for the reply; your message was not sent." and the draft is kept. On the chat's own session page the Ask dock steps aside once a send is accepted (one thread, never the conversation twice); a finished reply re-reads the transcript so its citations and decisions land; the thread keeps its newest line in view while the operator is at the bottom. A re-pick retires the former helper's half-typed bubble and its late frames (the quiet line says what happened); a failed or timed-out attempt drops the half-typed bubble. A recorded turn gate is reconciled against the runs list and superseded by any real gate on the run, so a transition missed across a reconnect never hides a later gate. A returning visitor's saved place is re-applied as the thread fills (a short thread clamps it) and nothing follows until they scroll again; a reply streaming in keeps the thread on its newest words. Without the capability (an older daemon) nothing is classified as an ask path — every gate is drawn, whatever a run's steps are called — and the thread renders as before and says once, in grey, "Older daemon: every helper answers at once — no primary helper, reviewer or help requests in this conversation." New: `src/board/askThread.ts` (the pure fold), `src/store/askThread.ts` (the live turns, the ask runs), `src/hooks/useTeamFold.ts`, `src/components/session/AskThread.tsx`; `capabilities.askPath`; `ComposerSend.primary`. Tests: `tests/askThread.test.ts`, `tests/askThreadStore.test.ts`, `tests/sessionThread.ask.test.tsx`, `tests/sessionThread.follow.test.tsx`, `tests/needsYou.askTurn.test.ts`, `tests/AskDock.askPath.test.tsx`; DESK journey `e2e/desk_ask_team_test.py` over the fixture's `ask_path` replay of the frames the crew lane captured live (one voice, the quiet lines and their look-underneath, a second turn with a help exchange, the undrawn turn gate, the one-seat roster, the older daemon). New testids: `ask-line`, `ask-line-toggle`, `ask-line-detail`, `ask-line-signin`, `ask-typing`, `session-ask-shape`, `session-ask-older`.

### Changed
- **`wicked-crew-api-types` 0.40.0 → 0.92.0, and the hand-mirrored wire types are gone (DES-ASK-TEAM-CHAT-001 §5.3, slice ASK-S1 part 1).** The devDependency pin catches up with the published contract (the ask-path fields: `HealthCapabilities.askPath`, `ChatOpenBody.primary`, `ChatMessageResponse.runId/stepId`, `ChatDetailResponse.path`, `wicked.team.path.repicked`, `TeamFindingRaisedPayload.target`, `TeamHelpAnsweredPayload.outcome`, `TeamMemberJoinedPayload.seat: string | null`). Every declaration that was copied into `src/api/*.ts` "until the pin catches up" is now an import re-exported under the same name — 218 types across chat-wire, mcp-wire, watch-wire, wave6-wire, skills-wire, teamPlan, demo, walkthrough, decisions, considered, capture, proposals, memory, steering, wiki, gateHistory, standingOrders, deliveryFreeze, governanceReplay, seatRecord, editors, docChecks and types — so no importer moved. The byte-pin tests that guarded the two VERBATIM mirrors (`tests/skillsWire.test.ts`, `tests/wave6Wire.test.ts`) and the vendored fixture `tests/fixtures/api-types-0.40.0-skills.d.ts` are deleted: the package is the evidence now; the wave-6 null-safe readers keep their tests in `tests/wave6Readers.test.ts`. Kept on purpose, each with its reason in the file: studio's READ-SIDE SUBSETS `TeamRow` / `RunTeamResponse` / `TeamEventFrame` (studio folds rows by `event_type` over `Record<string, unknown>` payloads; the contract's `TeamEventPayloads` union would make the chain and plan models cast), the campaign family (the contract's `CampaignRunSpec` requires `clis` / `entity_mode`, which no surface reads), the typed `MemoryBrowseQuery` input that serializes to the contract's `ListMemoriesQuery`, `SteeringImportBody` / `SteeringImportEntry` (the contract names the INPUT entry what studio calls the RESULT entry), the delivery readings in `types.ts` that tolerate the 0.11–0.18 wire reshape, and the engine-mirrored wiki / steering rule shapes the contract does not carry. `ChatThread` narrows the transcript record to `seat` before reading `cliKey` (0.92.0's union carries `decisions` and `system` records too). Two divergences the adjudication found in the kept-local copies are corrected to the contract: the steering rule's effect union gains `warn` (the badge colours it and the rule form offers it — the hand-written union had dropped the value the contract declares), and `listMemories` sends facet filters as the contract's ONE JSON-encoded `facets` object (crew parses exactly that; the old `facet.<key>=<value>` spelling had no caller and was never read) and drops the exact-`scope` parameter crew never read (`scope_prefix` is the wire). `tests/wireContract.structural.test.ts` keeps the two structural guards the deleted wave-6 pin test carried (no row-level `test_set` join; no `workflow` key on the recon body).

### Fixed
- **Demo mode in plain words: the demos list reads by what the demo is of, and the demo page names a gate the run waits on (studio#520, #521).** On the released 0.6.1 Desk, Project › Demo mode › "This project's demos" printed each run's raw `problem`, which on crew 0.8.1 carries the brief's absolute home path ("…follow the demo brief at <home>/.wicked/demos/<id>/BRIEF.md. Demo root: …") with "Show technical details" off — the reel had to blur the frames (the daemon half is wicked-crew#813). Now a row reads by what the demo is of — "Demo of <url>" (the first URL in the text) — or the one title fold, and goes through the home-path formatter either way. And the demo's own page said "The team is scoping the demo before planning starts." while the run was `awaiting_human` on an **escalation** gate (a denied tool call): only the team plan gate had a card. Now the page reads the run's open gate beside the demo view (`GET /runs/:id/gate`, 404 = none; never awaited by the demo read), and a gate that is not one of the demo's own three (team / plan / review) gets a card — "Waiting on you: step N needs a decision before the demo goes on", the prompt's first line, and **Open the run →** (the run's page with the gate in view) — while the stage line says the run is waiting on a decision (`data-waiting="gate"` on `demo-run`). Tests: `tests/DemoMode.plainWords.test.tsx`; DESK journey `e2e/desk_demo_plain_test.py` (a demo run with a home path in its problem: the row reads "Demo of http://…" and no home path is on the page; the demo page on `preparing` with an escalation gate open shows the card with the prompt head, the waiting line, and Open the run lands on `/p/:id/build/:runId`).
- **See everything › Sessions: an onboarding run names its repository, and Unarchive re-reads the list (studio#510, #511).** On the released 0.6.1 Desk the five onboarding runs of a seed rendered as five rows that all read "Onboard repository" — in the Done rows and, bare, in the Archived lens, where each offers Unarchive, so the operator could not choose the right one. `humanTitle` keeps the clause before the first `: `, which for "Onboard repository: notes-b" is exactly the part every onboarding shares; #423 fixed the Desk rail with "Set up notes-b" and the Everything page (S15c) re-introduced the dropped name through `runTitle` (the finished rows, via `RunLink`) and `humanTitle` (the Archived lens). Now the fold is ONE helper, `onboardTitle` in `runIdentity`, that `runTitle` and the rail's `plainRunTitle` both go through — every title of an onboarding run reads "Set up <repo>" (the palette's labels included; its match highlight is computed against the label it shows). And Unarchive re-reads the runs list through the same `onRetryRuns` that Archive on a finished row calls, so the run shows under its state filter (Stopped / Done) without leaving the page — before, Unarchive edited only the lens's local rows and the run stayed missing from Sessions until some other navigation reloaded the list (the reel waited 62.8 s on the Stopped lens for a row that never came). Tests: `tests/runIdentity.onboard.test.ts`, `tests/everythingPage.archived.test.tsx`; DESK journey `e2e/desk_everything_archive_test.py` (onboarding rows named on the Done filter and in the Archived lens; Unarchive → one `GET /runs` re-read, and the row is on the Stopped lens in place).
- **The chrome fits a 700-px-tall window: anchored overlays, the skill drawer, long settings errors, Esc from the player (studio#514, #515, #516, #509).** Four defects the W12 reel found on the released 0.6.1 Desk at 1440x700. *Standing orders from the rail's Additional settings (#514):* `AnchoredOverlay` placed the panel below its Manage toggle (y ≈ 628) with a 160-px height floor, so it ran off the viewport — its input and Read-it-back / Keep / Not-that were under the fold, and `position: fixed` meant nothing could scroll them in. Now an overlay that does not fit below its anchor opens above it (`data-placement="above"`, pinned by `bottom`), and in either direction its height is capped to the room that side has; the Desk header's Manage still opens below. *Skills (#515):* the drawer was a fixed `inset-y-0` aside over the header's Refresh baseline / Analyze / Publish and the catalog re-read — the re-read being meant for exactly the moment a skill is open. Now the drawer starts where the header ends (the page measures its header, `skills-header`, and pins the drawer's `top` to it; re-measured on resize, scroll and header growth). *Configuration (#516):* a long `worker_config_root` refusal rendered on one line and made the control column as wide as the sentence, so the label column collapsed to a word per line. Now the two text-input rows' control column is the input's width (`w-56`) and their inline errors wrap at it (`overflow-wrap: anywhere`). *The Demo video (#509):* Esc did not shrink the artifact while the player had the focus. Measured in Chromium, the cause is narrower than the issue guessed: a keyboard entry into the player (Shift+Tab from the first chapter mark) lands the focus on one of the native controls' own buttons, inside the browser's user-agent shadow tree, from where **no** key event reaches the page at all — not keydown, not keyup, not even a window-level capture listener — while a player focused by a click or by `focus()` delivers its keys normally. Now the `<video>` re-points an entry from outside at the player itself (`focusPlayerOnEntry`; Space and the arrows still drive it, Tab from it still walks the native buttons — moves between them fire no focus event at the host, so they are never pulled back), and `ArtifactMorph` also listens in the capture phase on its own element so Esc from the focused player shrinks one step (the browser's own fullscreen is left alone; a field inside the artifact still owns its Esc). Tests: `tests/anchoredOverlay.test.tsx`, `tests/SkillsPage.drawerTop.test.tsx`, `tests/artifactMorph.escVideo.test.tsx`, `tests/walkthroughEditor.playerFocus.test.tsx`; DESK journey `e2e/desk_fit_test.py` (1440x700: the rail overlay's box, input and placement inside the viewport; every Skills verb's hit point is the verb and the re-read click lands with the drawer open; a 130-character 400 wraps to 3+ lines under the input with the label column intact; Shift+Tab onto the player then Esc shrinks pane → inline).
- **Settings and Theme say what is true: the site name on the Desk rail, the notification refusal that stays, the theme that survives a daemon restart, a brand-learn Cancel that creates nothing (studio#512, #513, #517, #518).** Four defects the W12 reel found on the released 0.6.1 Desk. *Site name (#512):* Theme › Site name promised "the product name shown beside the logo in the chrome", but under the Desk skin (the default since S15b) the only consumer was the classic `AppChrome`; the rail's brand was the literal "wicked studio". Now the rail brand (`desk-rail-brand`, new testid) reads the saved name and follows a change typed on the Theme page; blank keeps the default wordmark. *Notifications (#513):* with the browser's permission already denied, picking Desktop calls `requestPermission()`, which resolves "default" (no prompt is shown) while `Notification.permission` stays "denied"; the page used the request's result as the state, so the "permission blocked" line vanished and the radio snapped back to Off with no explanation. Now a decisive answer (granted / denied) is the state, and for "default" the browser's own permission is read: still denied = the blocked line stays; default = "the browser did not grant it — pick Desktop again to be asked" (`data-state` on the line names it). *Appearance (#517):* the store started from the dark default and only `GET /settings` ever changed it, so every cold load flashed dark until the stored wicked-light arrived (~0.4 s on a fast daemon; whole pages in the reel's slow / 500 / stopped passes) and an unreachable daemon left the UI dark for as long as it was away. Now `applyAppearance` remembers what it applied in `localStorage` (`studio.appearance.cache`, sanitized on read), the store starts from that record and applies it before the first render, and a failed settings read leaves it standing; the stored settings stay the source of truth once they answer. *Brand learn (#518):* `ensureScratchDoc` awaited the project's document list (seconds, while the bridge comes up) and then created the scratch document unconditionally, so a Cancel during "Preparing the scratch document…" could not stop the create that followed — and that create launches a governed drafting run on the daemon (wicked-crew#811). Now the abort signal rides both calls (`listDocs` / `createDoc` take an optional `{ signal }`) and is re-checked between them; a cancelled preparation ends as an `AbortError` the surface treats as the cancel it is. Tests: `tests/deskRail.siteName.test.tsx`, `tests/NotificationSettings.denied.test.tsx`, `tests/appearance.cache.test.ts`, `tests/scratchDoc.abort.test.ts`, a Cancel-while-preparing case in `tests/BrandLearn.test.tsx`; DESK journey `e2e/desk_settings_honest_test.py` (the rail brand reads the saved name and a typed one; blocked stays said and a dismissed prompt is named, with the radio back to Off; wicked-light at the first script run with `GET /settings` refused, and wicked-dark once the daemon says so; a slow document list cancelled → no `POST …/interactive/api/docs`).
- **The Demo video artifact's state line sits between the header and the player at every size (studio#507).** On the released 0.6.1 Desk the inline "Demo video" artifact played in place (S15d, #503), but its state line ("✓ Ready to watch · 3 chapters · 1:45 · codex reviews, claude records") rendered half-hidden behind the card's "Demo video" header. The preview's content (padding + the line + a fixed 150px player) overran the 200px card by 19px — the player's own controls were cut at the card's foot — and `overflow: hidden` left the preview a scroll container, so the first scroll-into-view (the focus landing on the player: Tab from a chapter mark, a click on its controls) slid the whole body up 19px and the line went under the header. Now the inline stage takes the height the state line leaves (a 16:9 box as tall as the row; the player, its controls and the line all fit between the header and the card's foot, at whatever width the line wraps to) and the preview is `overflow: clip` — never a scroll container, so nothing can slide it; the words beside the player keep to the row and scroll on their own when many chapters wrap at a narrow width (a focus on a lower mark scrolls the side, never the body). The pane and full sizes are unchanged, and #503 holds: one tree at every size, the `<video>` never remounts, a playing take keeps its place. New testid `artifact-head` on the artifact's header. Journey `e2e/desk_demo_video_status_test.py` (DESK): both themes × inline / pane / full at 1440x900 and a narrow 960x700 card at inline, at rest and with the focus on the player — the state line's box below the header's and inside the card, the player's below it and inside the card, every chapter mark inside the card, nothing to scroll; the same `<video>` node across the morph; Tab off the player lands on the first chapter mark and Esc shrinks from there (with the focus on the native player its controls take Esc — a #503 limit, studio#509).

## [0.6.1] — 2026-10-05

The released Desk, corrected by the operator's review of 0.6.0 (DES-STUDIO-REBUILD-001 Amendment 5,
as revised): the session is the running chat and a finished demo's video plays in it; the rail is
Desk · Watchtower · the sessions list · Skills · MCP tools · Steering · Health · "Additional
settings" (Configuration, Repositories, Workflows, Evals, Theme); `/everything` carries what the
retired list pages carried, the §5.4 moves redirect to it; and signing a CLI helper back in is one
command shown in plain words with Copy and "check again".

### Fixed
- **A finished demo's video plays in the session, and the run stays in the thread (DES-STUDIO-REBUILD-001 Amendment 5 items 1–2, slice S15d; studio#502).** The operator opened the released Desk on a finished `demo` run and found "no video or video editor anywhere": the "Demo video" artifact's inline preview was a text card (`✓ Ready to watch · 3 chapters`) and the player lived only behind the unlabelled ⤢. Now the preview IS the take (DESIGN-interaction rule 1): the inline artifact holds the `<video>` on `GET /runs/:id/demo/file`, playable in place beside the state line (which gains the length once known — `· 1:45`), the seats and the chapter marks; the same element grows into the editor, and `WalkthroughEditor` renders ONE tree at every size so the morph never remounts the player (a take playing inline keeps its place in the pane). Picking a chapter seeks and makes it the subject of the next message — an `about: chapter 2 · …` chip on the session composer (rule 2). The presenter's script is editable in the editor only while crew accepts the edit (the plan gate; `PUT /runs/:id/demo/script` answers 409 at any other stage), and a finished demo's narration reads as fixed and says where to ask. A failed walkthrough's preview stays its failing frame. The run's block in the thread no longer offers "Open the run page →"; its ⋯ opens the session sheet, which now carries what the old run page had, in plain words: **Steps** (every step in order, its state and helper, each a way into that step's own sheet on "What it did"), **Changes** (the worktree diff) and **Evidence** (the bundle download) — the §5 table names the homes (`RAW_CONTROLS`). Tests: `tests/demoVideo.s15d.test.tsx` against a real crew 0.8.0 `GET /demo` answer (`tests/fixtures/demo-crew-0.8.0-done.json`), `tests/sessionThread.s15d.test.tsx`; DESK journeys `desk_demo_video` and `desk_session_live`; `desk_walkthrough` reads the state line as a prefix. Removed testid `session-run-open` → `session-run-look`.
### Added
- **"See everything" — `/everything`, one page with four tabs (DES-STUDIO-REBUILD-001 §5.4, §11 S15c).** Sessions (what Work, Chats, Execute, Projects and the project chronicle listed, as sessions grouped by project; `?filter=` keeps the old words — Working, Waiting on you, Done, Blocked, Stopped — and `?project=` scopes to one project), Everything made (documents, pages, decks and videos across every project, from the daemon's index when it has one), Helpers (the roster and each seat's sign-in), Handed over (the runs whose work left this machine as a pull request or a push). The tab, filter, scope and kind are the address, so every view is deep-linkable and Back-correct; the tabs are an ARIA tablist. New: `src/board/everythingModel.ts`, `src/components/everything/EverythingPage.tsx`, `src/hooks/useMovedRoutes.ts`; tests `tests/movedRoutes.s15c.test.ts`; journey `e2e/desk_everything_test.py` (DESK).
- **CLI sign-in in plain words (Amendment 5, decision 5).** Wherever a helper is signed out — the Desk's "needs signing in again" row, Health's seat move, Configuration's seat card, `/everything › Helpers` — Sign in opens one panel: which CLI, that studio cannot sign in for it, the ONE command to run in a terminal exactly as the daemon sent it in the roster's `login_invocation` (its own login verb with the worker home it runs the seat from — read from the wire, never guessed; a seat with no line gets an honest sentence), a Copy button, and "I've signed in — check again", which re-reads `GET /roster` and deposits it so every row built on the roster clears itself when the seat is back. Studio no longer opens a terminal and runs the login for you. A first-run Desk with no signed-in helper leads with the sign-in. Sign in is offered wherever the roster says the sign-in lapsed — including a seat the daemon also calls council-ineligible, Health's ordinary seat rows (not only the week's move), and the helper's sheet; the Copy button's name and tooltip never print the home directory (the clipboard gets the line as given). New: `src/components/SignInPanel.tsx`; `useRoster` follows later roster deposits; tests `tests/signInPanel.test.tsx`; journey `e2e/desk_signin_test.py` (DESK); the fixture gained `roster_signed_in` and `roster_login_lines`.

### Changed
- **The Desk rail, top to bottom (Amendment 5, as revised): Desk · Watchtower · the sessions list · Skills · MCP tools · Steering · Health · "Additional settings".** Watchtower takes the place the bell held (its hover card opens downward there, and stays closed while the Watchtower page itself is open, so it never covers the feed's controls); the Notifications entry is gone (the Desk is the notification surface; Watchtower is the full feed). Skills, MCP tools and Steering sit in the rail because they change what in-flight work does; Steering is the Rules page (`/rules`), renamed in the rail and in ⌘K. "Everything else" is now "Additional settings" and holds exactly Configuration (today's Settings), Repositories, Workflows, Evals, Theme — in that order — plus the orders/away and freeze controls; nothing that redirects is in it. Testing campaigns is reached by ⌘K and from Configuration (a link on the page). Test ids: `desk-rail-rules` → `desk-rail-steering`, `desk-rail-everything` → `desk-rail-additional` (successors named); new `desk-rail-watch`, `desk-rail-skills`, `desk-rail-mcp`. Tests `tests/deskRail.s15c.test.tsx`; journey `e2e/desk_rail_test.py` (DESK); `desk_home`, `desk_look`, `desk_cmdk_routes`, `mcp_tools`, `skin_contract` read the new rail.
- **The §5.4 moves — redirects for moves, never for typos, under every skin.** `/projects` → `/everything`; `/chats`, `/work[?filter=]`, `/execute[?filter=]`, the bare `/runs[?filter=]` and the twice-retired `/make` → `/everything?tab=sessions[&filter=]`; `/vibe` → `/everything?tab=made&kind=documents`; `/demo` → `/everything?tab=made&kind=videos`; `/p/:id/chronicle` → `/everything?tab=sessions&project=:id`; `/p/:id` → the project's newest session (`/s/:id`), or its empty Sessions tab when nothing has been started. Each replaces its history entry. The classic skins' nav (`LeftSidebar`) points its ▦ dashboards and view-all rows at the live addresses; the old pages' components stay in the tree for S16. `/p/:id/<not a mode>` is a dead address now, never a silent swap onto the project. ⌘K's GO TO lists Everything (four tabs), Steering (`/rules`), Configuration, and a project's sessions; the retired list pages are not destinations. **Not moved yet (S16a):** `/runs/:id` → `/s/:id` and `/p/:id/:mode[/:artifact]` → `/s/:id[/a/:key]` — 23 of the 65 CI journeys drive those addresses for behaviours the session page does not carry yet (the gate trust record, re-run from a phase, the reject-note banner, seat reassignment, the demo start form) and `/s/:id/a/:key` is not a route yet; `tests/movedRoutes.s15c.test.ts` pins the deferral so it goes red when they move. What the retired list pages did is kept on the Sessions tab: a finished run's row is the Work page's row with its next-use moves (Reuse as preset, Draft update, archive), an **Archived** lens lists the archived runs with Unarchive, archived projects are named with a link to restore them, and the daemon's live-chat census (the one `GET /chats` the needs-you fold already makes — walking the routes re-reads nothing) lists warm chats that are not a session yet — reconciled with what this client has seen since (a chat opened later is listed; one that ended is dropped) — each with End. Titles on every tab (the finished row's too) read through the home-path formatter; a dead address under `/everything` is not-found. A chat the daemon reports closed (`chatClosed`) leaves the live-chat list; one that comes back is listed again. The Archived lens honours the project scope, archive notes read through the home-path formatter, and archiving a run re-reads the list. `/p/:id` follows the board's placement rule — the DTO's `project_id` wins; membership files a run only when the DTO names no project. The run's failure banner's "All runs" link points at the Stopped lens.

## [0.6.0] — 2026-10-04

The rebuild's minor (DES-STUDIO-REBUILD-001 §6.5): the Desk is the default skin. Everything since
0.5.19 that was built for the desk now opens by default. That covers the session with its page,
document, deck, walkthrough and video in place, the page editor plugin, the ordered plan, Rules on
its own page, the placed walkthrough, and the rules a reply was given. An install that stored the
old default skin opens on the Desk. The classic `studio` skin and `compact-rail` stay on the Theme
page, so going back is one pick.

### Added
- **The Desk is the default skin — the flip (DES-STUDIO-REBUILD-001 §6.5, §11 S15b; BUILD-PLAN W11).** `DEFAULT_SKIN_ID` is now `desk`, and an unknown skin resolves to it. The classic `studio` skin and `compact-rail` stay on the Theme page, so going back is one pick there, or a revert of this change. An install whose stored `studio.appearance` predates the flip carries the old default as its skin, so it opens on the Desk, with its theme and accent left as stored. Reading still never writes (§3.3): the record moves past the flip, `skin_migrated: true`, with the operator's next change, and from then on the stored skin is what they chose and stands across reloads. A new install, with nothing stored, opens on the Desk with the wicked-light theme and the harbor accent, and nothing is written for it. `index.html` pre-renders `data-skin="desk"`. Not in this change: the §5.4 redirects. `/everything` is not a route yet, and §5.4's redirects are not skin-scoped, so sending `/runs/:id` and `/p/:id/:mode` to `/s/:sessionId` would retire the run and project pages under the classic skins this change keeps selectable. Every old route still renders under every skin and stays reachable by its nav entry or ⌘K. The CI matrix keeps the `studio` and `compact-rail` behaviour legs next to the two desk shards until S16b removes compact-rail. Tests: `tests/skinFlip.s15b.test.ts` (the default, a pre-flip record, a post-flip choice that survives a reload, a new install), the registry and appearance tests moved to the new default, and the classic-shell rigs (`e2e/uxfix_fixture.py`'s stored record, `vision_slice7`, `studio_standalone`) pick `studio` the way the Theme page does.
- **Every behaviour journey now runs under the desk skin, and the Desk carries what Home carried (DES-STUDIO-REBUILD-001 §6.4, §11 S15a).** Before the flip, the Desk lacked six things Home offered. Now: standing orders with "Mark me away", and "Just the top one", sit in the Desk's header. Capture is the Start row's last chip. Dead-lettered governance events are a chore "for whoever runs studio", with the same dry run, then confirm, then re-read as the Governed tile. Back to the Desk puts its scroll back (`data-place-scroll="desk"` plus the history scroll Home used). Behaviour change for every skin: a failed run that a later run retried (`retry_of` names it) no longer has a Needs You row, the rule the "Retry failed" move already used. CI's desk leg is now two shards. It runs the 29 desk-only journeys plus 33 behaviour journeys under `STUDIO_SKIN=desk`. Eleven of the 33 needed a desk branch, where the journey reads `STUDIO_SKIN`: `wave2a_safety`, `wave2a_undo`, `type_to_composer`, `wavea_home`, `wavec_home_runs`, `wave2b_handover`, `wave2b_queue`, `capture`, `main_scroll`, `wave1_raw` and `wicked_theme`. `standing_orders` passes as written now that the header carries the panel. The three journeys about Home's bands and count tiles (`wave1_dark`, `wave1_stall`, `wave1_tone`) name their Desk counterpart: the new `e2e/desk_calm_test.py` covers dark when healthy, a stall as an exception, and zero is quiet. `run_journeys.py --check-desk` fails CI if a behaviour journey neither runs under desk nor names a counterpart. `--shard K/N` splits a list. `BEHAVIOUR` and its `[studio, compact-rail]` legs are unchanged.
- **The page editor acts at once, with Undo: remove, recolour, the whole section, phone/tablet/desktop widths — and the page's checks beside it (DES-EDITOR-PLUGINS-001 §7.1 R-a…R-d, §5.8; slice EP-P3).** A picked element's peek in the `wicked-page` plugin offers Remove (also ⌘⌫ / Ctrl+Backspace; bare Backspace never removes), a fill and a text colour from the page's own theme (its `--wi-*` colours, sent as concrete values the engine's grammar accepts) plus Default (`revert-layer`, back to the document's stylesheet), and Whole section (also ⌥↑, or a second click; the bridge now reports each block's `section`). Each is one version with the host's line — "Removed …", "Restyled …" — and Undo. The header sets the width the page lays out at (Phone 390, Tablet 820, Desktop 1280; only the nested frame changes, scaled to fit); Tab moves through the plugin's own controls and leaves at either end. Under the page, at pane and full size, the host draws crew's checks read (the four reviewers' verdicts, who reviewed and whether that seat is independent, "on version N" for an older one, and a finding's "Point at it" as a chip in the host's words); an older daemon without the read shows no panel. A picked container's chip no longer fuses its parts' words. Journey `e2e/desk_page_acts_test.py` (DESK).
- **The walkthrough is placed, and the second live E2E is a runnable journey (DES-STUDIO-REBUILD-001 §11 S13; §9 item 4; DES-WALKTHROUGH-PROOF-001 §8 "Live proof through the studio UI").** S13's three placement items landed with WT-U1 (#475) and WT-U2 (#483): the run's walkthrough grows through the artifact frame's three sizes in the session, "checked at m:ss ▸" chips sit in the chain's step slot, and "checked" — and "N of N done and checked" — come only from crew's `check_state`. What was missing was the proof itself: `e2e/live_walkthrough_deliver_test.py` (LIVE, operator-run against a real daemon: `STUDIO_URL`, `WALK_RUN`) follows a run's walkthrough through the UI — inline and moving while it records; a failure's pane at the failing moment, full screen on the same element, Esc one step at a time; "Ask helpers to fix" read back as exactly one more gate decision in `GET /runs/:id/events`; the re-record followed to its verdict (`WALK_RERECORD_S`); the chips reconciled with `GET /runs/:id/acceptance`; Export ▾ Video byte-equal to the take's stitched mp4 through the file route; the hand-over card's acceptance line and the one "Are you sure?", with nothing sent before the yes (the yes itself is the operator's unless `LIVE_APPROVE_DELIVER=yes`; `deliver` alone needs no walkthrough on the run). Every wait and every leg's moment is recorded; a leg whose evidence the daemon does not serve is capped `machinery-verified` and named. `live_walkthrough_deliver_selftest` (DESK, CI) runs the same script over the fixture's `r-walk-fail` / `r-walk-pass` / `r-walk-yours` and checks the fixture's own recorder, so the proof lane runs a script CI has exercised.
- **Rules has its own page again — `/rules` and `/rules/:ruleId`, DC's components on one frame (DES-STUDIO-REBUILD-001 §5.4, §11 S12; DES-DECISION-CAPTURE §3 B9/B11, §5.2).** The address the old RuleManager held is a real route under every skin: crew's rules as sentences, grouped — from your words, testing rules, other — newest first, retired last; one line says what is in force. A rule opens on its own address as the same drawer the steering grid shows (scope and effect as one sentence, ORIGIN, history, where it was considered; "Hold work to it" only where that drawer already renders it), and Esc returns to the list. Every decision line, considered row, Desk sentence and Evals gap that names a rule lands here (`rulePath`). The steering grid stays one link away as "All rules". No rule model was added: the page groups and counts what crew serves. ⌘K lists the page. Esc is one step at a time over the rule page: a sheet opened from the drawer ("look underneath" on where a rule was considered) is a layer in the Escape chain, so Esc closes the sheet and the drawer under it stays.
- **A page opens in the `wicked-page` editor plugin — the first built-in plugin in the kind slot (DES-EDITOR-PLUGINS-001 §4, §5, §7.1, §9.3; slice EP-P2).** S8's page element editor is now a `wicked.editor/1` plugin: ONE self-contained HTML bundle (`src/plugins/wicked-page/`, built by `scripts/build-editors.mjs` into `dist/editors/wicked-page/{index.html,editor.json}` on every `vite build`) that crew's registry discovers at boot, pins by sha256 and serves hash-checked with the bundle policy (`default-src 'none'`, `connect-src 'none'`; web images and fonts only through the first-party `network.media`). In the session, a run's **page** is opened by whichever editor crew's registry names for `page` (`GET /api/v1/editors`, `src/api/editors.ts`, `store/editors.ts`): the plugin frame (`sandbox="allow-scripts"`, an opaque origin) renders the page in a NESTED sandboxed frame with the `data-wid` bridge, and everything S8 proved holds against it — the preview inline, the pane and full screen as the same element (pane ↔ full never re-parents the plugin frame), a click on an element makes it the subject (`selection.set` with ids only; the **host** writes the chip's words from its own inventory of the version), typing on it edits in place (the plugin sends one `version.write` with `before`; the host checks the anchor against its inventory, posts ONE `feedback.submitted`, finds the edit's own version and draws "Changed the headline — version 2. Undo" under the page), Undo forks the version before the change with `expect_head` (a helper's version in between → "Not undone … (version 5)"), and `<b>x</b>` lands as those characters. The first printable key typed on the page with nothing picked goes to the session composer with the focus (`ui.typed`); Esc with nothing picked, ⌘K and the navigation ⌥ chords are forwarded and re-pressed in the host (`ui.key`); a plugin that fails to start, reloads itself or stops answering is torn down with "Reload it". The engine's decided grants are read in crew's shape (`{permission, decision, ruleIds, token}` — only an `allow` grants; an `ask` is named in a note) — EP-P1's reader took a bare list and would have granted a real daemon's plugin nothing. With no registry (an older crew) or no editor claiming `page`, the page shows read-only with "No editor is installed for pages" and why. The document and deck editors (S9) stay the studio component until EP-P4 re-hosts them; `PageEditor` is no longer the page's editor. New: `src/components/session/PluginArtifact.tsx`, `src/editors/interactiveDocAdapter.ts` (the `interactive-doc` adapter: read, versions, write with the landing poll, undo/fork with `expect_head`), `tests/editorsApi.test.ts`, `tests/interactiveDocAdapter.test.ts`, `tests/editorBundles.test.ts` (the bundle is one file, loads nothing from outside, under the 5 MB cap, version-stamped). The fixture lists and serves the dist's first-party editors as crew does and answers grants in crew's decided shape. Journeys: `e2e/desk_page_editor_test.py` re-targeted at the plugin (every S8 step, plus: one handshake, the plugin frame the same element across pane ↔ full, 0 requests from the plugin and page frames beyond the bundle entry, one registry read); `e2e/editor_conformance_test.py --bundle wicked-page` (cases 1–12 against the real plugin).

- **WT-U2 — checked chips, the deliver card's acceptance line, Hold work to it** (DES-walkthrough-proof §3 scenes 21, 22, 28, 29-30; §4.9, §4.12). A chain step a sealed walkthrough proves wears "checked at 0:34 ▸" — the word only from crew's `GET /runs/:id/acceptance` per-step `checkState`, the moment from the take's chapter marks (crew asserts none) — and opens the run's walkthrough there; a failed check reads "check failed at 0:41"; a plan whose override removed the pair reads "end-to-end testing is yours"; the chain sentence becomes "N of N done · M checked" / "done and checked". The deliver card carries crew's acceptance line verbatim (WT-W3 `summary.line`) with a tone. A testing rule's drawer gains the one explicit "Hold work to it" switch: on = `allow_with_conditions` + obligations from the closed vocabulary (`step:test`, `step:walkthrough`, `step:security_review`), off = advisory (no effect; trigger and obligations kept) — one `POST /governance/rules` each; a decision rule shows none. Journey `e2e/desk_checks_test.py`; fixture `acceptance_wt` + the `r-walk-yours` run.
- **A run's plan is an artifact you can put in order (DES-STUDIO-REBUILD-001 §5.7, §11 S10; §6 Q-R5: order only).** A planned run's block in the session shows its plan in the artifact slot beside its page (`artifact[data-kind=plan]`, `PlanOrderEditor`): the steps as a numbered list, inline as a preview, open beside the thread or full screen as the same element. At a `plan_approval` gate a step moves up or down with its arrows; the new order is a **draft on the gate card** — "The order changes: Research → Plan → Review → Build." with "Approve with these changes" — and only the card's approve sends it, as the gate's answer, through the one decision path and its 10 s undo window (S7's rule for a `/` command's added step now covers the order; `GateDraft.order`). Steps the engine will not let move show as fixed with one word and the reason — the lead helper's scope step (first), hand-over (last), a step that has run already (the ratchet, DES-TEAMING-002 §8.5), a step the floor added for this risk — and a refused move is said, not hidden. "Add a step" offers the catalog here too (the same draft at a gate; mid-run the same 10 s window as `/`). Mid-run the editor says the order is set — a running plan only grows (§8.7) — every row fixed. Not built, as decided: lanes, a time axis, and "done when" (no engine concept or wire). Pure model + tests: `src/board/planOrder.ts`, `tests/planOrder.test.ts`. Journey (DESK): `e2e/desk_plan_order_test.py`.
- **A run's walkthrough, and a demo's video, open in the session like its page does (DES-WALKTHROUGH-PROOF-001 §3 scenes 18–20, 23 and 41; slice WT-U1).** The artifact slot S8 added now hosts two more kinds beside the page (`ArtifactMorph` takes a `slot`: a kind and a body drawn at each size; `RunArtifacts` adds them to the run's block). **`walkthrough`**: a run whose plan carries the `walkthrough_review` step shows its recording inline — the state in one line ("● Recording · chapter 4 of 6", "✗ Failed at 0:41", "✓ Passed · 6 chapters"), who checks apart from who builds, the chapter marks with their verdicts, what happened underneath in red and the failing frame — read from crew's `GET /runs/:id/walkthrough` (polled while it moves, re-read when the run's status changes), offered only where the daemon mints evidence roots (`health.capabilities.walkthroughRoots`). Opened (pane, then full screen, Esc back) it is the video editor: the take with the playhead on the failing moment, chapters as seek points, the narration, every check at its moment with its kind and its evidence under ⋯ (through the contained file route), the red mark on the timeline, and **Export** (the video, and the poster when the take wrote one). At a failed walkthrough's own escalation gate — crew's rule, the run parked on a denied unit of the pair — it offers **Watch · Ask helpers to fix · Edit the check**: fix is one `request_changes` carrying what the walkthrough caught in words (through the same 10 s Undo as every gate answer), edit is the storyline `PUT` then one approve. Any other open gate offers neither. **`demo-video`**: a demo run's video in the same slot, without checks — play, full screen, chapter seek, the narration, and Export Video / GIF / Poster (`POST /runs/:id/demo/export`, only while the daemon will make them). Nothing here says "checked": that word is the acceptance read's (WT-U2). A result that carries verdicts only (what the recorder writes today, wicked-garden#1208) reads honestly: the failure and its chapter, no invented checks, nothing to watch. Words and geometry are pure in `src/board/walkthroughModel.ts` (`tests/walkthroughModel.test.ts`); the wire is hand-mirrored in `src/api/walkthrough.ts` until studio bumps `wicked-crew-api-types`. Journey: `e2e/desk_walkthrough_test.py` (in `DESK`) on the fixture's new `walkthrough` switch.
- **The page a run is producing is in the session, and it is the control (DES-STUDIO-REBUILD-001 §11 S8; DESIGN-interaction rules 1–3).** A run's block in the session thread now shows the document its draft seam is writing (the project's documents whose bound run it is, `runBinding.isDocRun`) as a live preview (`artifact[data-size=inline]`). A click grows it to a **pane** beside the thread (the thread and composer make room), ⤢ to **full screen**, Esc shrinks one step — the same element throughout, never re-parented (DOC-1), morphed with View Transitions where the browser has them and not at all under reduced motion (`ArtifactMorph`, `store/artifactSizes.ts`). Inside it, the built-in **page element editor** (`PageEditor`) renders the head version in a sandboxed `allow-scripts` frame instrumented with the `data-wid` bridge: pointing highlights an element; a click picks it and makes it the subject of the next message — an "about: “…”" chip on the session composer; typing on the picked element edits it in place and lands ONE deterministic `content-edit` (`feedback.submitted`, `before` as the staleness guard) → one version, with a line under the page ("Changed headline — version 2. Undo"). **Undo** forks the page before the change as the new head with `expect_head` (interactive 0.10.0, C5; `postFork` gains the argument and a `HeadMovedError`): when a helper's version landed in between the bridge refuses with `409 head_moved` and the line reads "Not undone — a helper changed the page since (version N)" — the helper's work is never buried. What you type is text: `<b>x</b>` lands as those characters, never markup (interactive #247). Pure model + tests: `src/board/artifactMorph.ts`, `tests/artifactMorph.test.ts`. Journey (DESK): `e2e/desk_page_editor_test.py` — inline → pane → full → Esc ×2, the pick and its chip, the touch edit, Undo (version 3), Not undone (a helper's version 5 posted straight to the bridge), `<b>x</b>` as text; the fixture's fork learns `expect_head` and its content-edits land as text.
- **A written document and a deck open in their own editors (DES-STUDIO-REBUILD-001 §11 S9; DES-EDITOR-PLUGINS-001 §7.2).** The artifact in a run's block now opens in the editor its recorded style names (`DocSummary.style`, `editorKindOf`): a page as before, a **document** (`doc`, `brochure`) or a **deck** (`ppt`) — `artifact[data-kind]`. Both are the page editor's parts: the same frame, the same touch edit (one `content-edit` → one version, Undo with `expect_head`). A **deck** has a slide strip beside the frame (`slide-strip`, `SlideStrip.tsx`): the slides the engine anchored, named by their titles; a click brings the slide into view and makes it the subject ("about: slide 3 — “…”"). A **document** at full screen has a requirements column (`doc-coverage`, `DocCoverage.tsx`) only when `GET /repos/:id/requirements` serves requirements for the run's repository: the same rows and total as that read, each with where the document names it (a click goes there) or that it does not; with no repository, a failed read or no requirements, the column is absent. **Export ▾** in the header (PDF / web page for a document, PowerPoint / PDF for a deck) uses the existing export wire and answers on a line under the page with a Download link. The element is named in plain words — "Changed slide 3’s title — version 2.", "paragraph 2" — never by its raw anchor id (`anchorWords`). Not built: slide reorder and speaker notes (no engine operation, EP-I3), margin comments and answered/missing coverage (the RFP chain). Journey: `e2e/desk_doc_editors_test.py`.

- **The rules a reply or a step was given, and where a rule came from (DES-DECISION-CAPTURE §3 B10/B11; slice DC-S8).** Under the last reply of a chat turn, and in a run step's sheet, one quiet line reads what crew's `/considered` read says: "2 of your rules considered · 1 set aside · cited 1 (unchecked)" (`considered-line`, `src/board/consideredLine.ts`). It opens to one row per rule — *Considered*, *Cited by the step — unchecked* (the step wrote `[rule:<id>]` and the id is in force; whether it followed the rule is not checked by anything, so that verdict is never claimed and the word "Followed" appears nowhere — pinned by a grep test), *Set aside — other project / replaced / retired / not confirmed yet*, and an invented or out-of-scope citation as unverified, by its id. A row opens its rule on the Rules page. Nothing is drawn when no rule touched the turn, on a daemon before DC-S7, or when the read was refused. The rule drawer (`/steering/policies?rule=`) now leads with scope and effect as one sentence (`rule-sentence`), and for a rule remembered from the operator's words shows **ORIGIN from crew's ledger only** — the verbatim words, who said them, when, how it was remembered and a link to the conversation or run (ids under technical details) — its **history** (remembered, undone — retired never deleted, restated, made to apply everywhere, what it replaces) and **where it was considered**: every turn and step studio has read whose Consideration names the rule, plus a bounded look into the rule's project's recent steps; each step row looks underneath. No "Hold work to it" control (DC rev 2 N7). Journey (DESK): `e2e/desk_rules_test.py`; the fixture serves the DC-S7 `/considered` reads for chat-pay's turns and r-pay-2's steps and, under `steering_rules`, `GET /governance/rules`.

### Fixed
- **The launch form says what a launch will be when the engine is slow, and when there are no steps (studio#431, #429).** The launch preview no longer waits forever. If the engine hasn't answered in 10 s it says "The engine didn't answer in 10 s — the summary below is studio's own reading of this launch." A timed-out preview is not cached, so asking again re-requests it, and an answer that arrives later still lands (only the newest request's). **Send** pressed while the preview is late waits for the engine's answer (bounded to 60 s), since that answer places the first gate, rather than refusing the launch as a failed preview (`PREVIEW_TIMEOUT_MS`, `previewAnswer`, `src/store/planCatalog.ts`). A launch on a repository with no steps, preset or workflow runs as one neutral unit (no PA scope, no review, no delivery), while the page says the PA scores and plans it. It still sends, because a repository as context is a designed launch, but the form now says so first (`launch-plan-note`). The run-level gate's card calls a lone unplanned step "One unplanned step — no PA scope, no review, no delivery", not "The plan you are approving". Journey: `e2e/desk_launch_test.py` (DESK list); the fixture gains `preview_delay_ms`.
- **An escalation card works from the whole verdict, and says which layer denied (studio#430).** The engine keeps a long verdict's 4 KB tail, head-cut with "…", as the denial reason and the escalation's `verdictSummary`, so the card's send-back built its note from findings 5-9 of 9. The note sent to the creator was missing the most important ones. When either text is head-cut, the card now reads the reviewed unit's whole output once (`GET /runs/:id/units/:key/output`, per run and unit). If that output ends with the tail the engine kept, which shows it is the same verdict, the card recommends from it. Otherwise the tail is read with its "…" removed, so the first kept finding still counts. When the judge passed and the evaluator unit's own `VERDICT:` denied, the card says so: "judge (pi): pass · evaluator's own verdict: FAIL — the evaluator is what denied it" (`layerLine`, `gate-verdict-who-denied`). Before, a DENIED head sat over "judge: pass". Journey: `e2e/desk_gate_moves_test.py` gains the step; the fixture gains `gate_move_tail`.
- **Reassign from an escalation gate is one move, and a steering-grid save never sends or reverts to a stale copy (studio#480, #476).** **Reassign** on a seat-failure escalation used to approve the gate, then `POST /reassign` once the run resumed. The approve re-dispatched the unit on the seat that had just failed, the card unmounted, and a refused move showed nowhere. With no steer to carry, the seat now rides the decision in one `POST /runs/:id/reassign {cli}` through the same 10 s undo window (`commitGateReassign`). crew approves and reassigns together and refuses a bad seat before approving, so a refused move keeps the gate open and the card shows the daemon's sentence and **reassign again**. A "Not moved" notice is raised too. A steered retry keeps approve-then-reassign; a reassign refused after its approve is now also said as a notice. Every steering-grid save goes through `planCommit` (`src/board/steeringCommit.ts`):
  - A save that changes nothing against the row it was edited from sends nothing (the reel's stale re-send).
  - A save is the current row plus its own changes, so fields saved since are kept.
  - If a changed field moved on since the edit began, the save is refused, by name.
  - A refused save reverts to the row as it was when the save was made, never to an older copy. Journey: `e2e/desk_gate_moves_test.py` (DESK list). The fixture gains `seat_escalation`, `reassign_refuse` and `GET /__fixture/reassign-posts`.
- **The repo page says "run onboarding" only when no graph was built (studio#461).** An onboarded Markdown-only repo opened on "Language mix not indexed yet — run onboarding" and "Graph not yet indexed", beside a Code graph card that read "Symbols 0 of 7 shown". A failed graph read said the same thing. The page now tells three cases apart (`src/board/repoGraphState.ts`): never built ("run onboarding"), built with nothing to rank ("7 symbols indexed across 2 files — none of them code to rank here.", "No code files in the indexed graph (2 files)."), and a failed read ("Couldn't read the code graph (…)" with **Try again**, which re-reads the graph alone). Journey: `e2e/desk_repo_page_test.py` (DESK list); the fixture gains `repo_graph` (`docs` / `fail`).
- **A failed read, a focused field, a project name, a rejoined chat, a rejected plan, a step gate and a floor-filled plan say what is true (studio#466, #473, #463, #451, #478, #469, #470).** When `GET /runs` fails, the Desk says it could not read your work, in the daemon's words, with **Try again** (`desk-runs-failed`, `desk-runs-retry`). It derives nothing from the missing list: no "N repos never indexed" row, no "Index all" batch launch, no "Nothing has been started yet" (`useRuns` keeps the error; `useNeedsRows` derives no repo row until the first runs answer). ⌘K / ⌘P and ⌘⇧F open the palette from a focused text field such as `/chat/new`'s composer. A field that handles the chord itself (the palette's own input, an editor) keeps it through `preventDefault`. A project name follows one rule, the daemon's (1-120 characters after trimming; `src/board/projectName.ts`), in the New project modal and on the Projects page alike. The modal no longer refuses capitals and punctuation. **Continue in Build** on a rejoined chat whose seats have not replied yet carries the chat's live seats, not an empty selection. A plan rejected with a note ends cancelled. The run page's banner now shows the note ("You rejected it: …", read from crew's `gate.decided` audit, `detail.amend`), and its all-runs link opens the **Cancelled** filter, which lists the run. The gate row's Reject button says how to reject with a note (⌥R on the selected row). A session that says "Waiting on you" for a step gate (before a unit runs, a step's output, an author's own question) now carries that gate's card. It reads "Start the triage step?" or "Accept the review?" in the Desk row's words, with Go / Not now through the one decision path (`ProposalKind` `step`; studio#469). A plan gate whose floor added steps proposes the plan the gate asks about, not the PA's earlier proposal on the team bus. The proposal names all 11 steps in the chain's words and says "3 required by the floor: Test plan, Architecture, Security check". The chain under it lists the same steps (floor steps marked), so "N of M" doesn't change when Go is pressed (`gatePlanOf`, `withGatePlan`; studio#470). Journey: `e2e/desk_run_state_test.py` (DESK list); the fixture gains `runs_fail`, `reject_note` and `floor_plan`.
- **A typed `<b>x</b>` no longer lands double-escaped through the editor host (EP-P1).** The host HTML-escaped `text` ops before posting them — the design's pre-#250 rule — but the engine already lands a `content-edit` as text (interactive #250), so a plugin's edit would have shown `&lt;b&gt;` on the page. The host now sends the text as typed; the engine keeps it text. The wire `selector` is the element's `data-wid` itself, as the engine resolves it and studio's own batches send it (the host had emitted a CSS selector the engine never matched).
- **A paragraph longer than 400 characters can be changed by typing.** The frame's bridge cut every block's text at 400 characters, and that text is the `before` snapshot the engine checks — so an edit to a longer paragraph was called stale and no version landed. A block that holds no other block now carries its whole text; a container carries only its opening, and a cut text is marked (`WidBlock.cut`) and never offered for editing. The edit field is a text area the size of the element, so a paragraph reads as a paragraph while it is changed. A container picked by its edge says it holds other parts instead of opening a field the engine would refuse. A chip already on the composer quotes its element (or its slide) as the page reads now: after the operator's own edit, an Undo or a helper's version it takes the current words; a chip that was removed is not put back (`relabelAboutChip`). A new version's frame opens scrolled back to the element that was edited, not at the top.
- **The default layer never prints your home directory (studio#458, #460, #462 — the rule #444 set for the hand-over card).** The Settings page printed the settings file's absolute path, the Skills page the plugin root's, and an onboarding run's open index output the graph file's — each with the account name and the local folder layout, in a screen share or a recording. One formatter, `src/board/homePath.ts` (`displayPath` for a path field, `displayText` for engine prose), turns an absolute path under a home directory — `/Users/<name>`, `/home/<name>`, `/root`, `C:\Users\<name>` — into `~/…` in the default layer; **Show technical details** shows the full path (`src/hooks/useHomePath.ts`). Applied wherever the daemon's paths render: Settings (`settings-path`, plain type now, not monospace — studio#425), Skills (root, baseline, snapshot and engine titles), every unit-output renderer (the run thread's "Show output", the unit transcript, the Term tab, the step sheet), the registered repositories (list, rail, detail page, project rows, chat scope), the core#406 repository findings, and the governance store paths. Tests: `tests/homePath.test.ts`; the desk journey `e2e/desk_home_paths_test.py` visits every route the ⌘K GO TO group lists (each destination and one of each parametric shape), opens every transcript, and asserts that neither the page text nor any hover title carries the home directory — against the fixture's new `home_paths` switch, which moves every path it serves under `/Users/reel-operator`.
- **The Desk waits for `/runs` before it says "Nothing needs you" (studio#459).** While the first `GET /runs` was in flight the Desk already printed the all-clear and "Nothing has been started yet.", so a slow daemon's first words were a false calm. The headline, the needs-you fold and the projects sentence now hold until the first runs answer arrives, showing "Checking what needs you…" / "Checking…" (`desk-loading`, `desk-projects-loading`) in their place. Journey: `e2e/desk_home_paths_test.py` with the fixture's `runs_delay_ms` switch holding `/runs` for 2.5 s.
- **No home directory and no engine scaffold in four more places (studio#464, #467, #468, #479).** A run paused before its first step showed crew's whole unit prompt on the Desk ("Approve the next step: triage — <goal> ||| PHASE SCOPE: …"); it now reads "Approve the triage step", and ` ||| ` is engine text everywhere a gate question is worded. The seat sign-in panel printed the worker home's absolute path in its "Running …" line and the shell echoed it; the line reads `~/…` and the terminal draws that home directory as `~` (what runs is unchanged). Ask's context pack rides the first message and is stored with it: the pack's stores line now carries names and sizes only, and every transcript shows what the operator typed with the pack folded behind "Sent with studio's context" (opened, it reads `~/…`). The run page's What / Where worktree, the Files referenced rows and their hovers, the file viewer's header, the timeline's file cards, the Delivery section's worktree and push target, and a unit's output in the gate-under-review and legacy history panes all read `~/…` in the default layer; "Show technical details" shows the full paths. The Desk journey `desk_home_paths` covers the new routes: the pre-unit gate row, a delivered run's rail sections and outputs, the sign-in panel and a chat with a stored pack.

## [0.5.19] — 2026-10-01

### Added
- **No fabricated citation renders unmarked: a reply's cited files, symbols and commit SHAs wear the daemon's verdict (crew#561, F-RC1-117 — Wave 1 criterion 2; crew `chatCitations` on `/ws`, `wicked-crew-api-types` 0.67.0).** On the RC1 Phase 6 re-run a seat answered with 26 commit SHAs, two of which existed in no repository, and the thread rendered all 26 as identical plain text. The daemon now verifies every citation against the repositories the chat can read and sends its verdicts; a reply shows them two ways. **Inline:** a citation the seat wrote in backticks wears its state where it sits — struck through with `UNVERIFIED` when it is in no repository, `→ the real place` when the line ref was off, `unchecked` when the daemon's bounded pass did not reach it; the hover says why. **On the reply:** a footer counter — "24 verified · 2 unverifiable" — and one chip per flagged citation, so a citation written outside backticks is named too. The seat's text is never edited: marked, not rewritten. A reply that cites nothing, a chat with no read roots and a daemon predating the frame all render exactly as before — silence, never "verified". A **reload keeps the marks**: the daemon records the verdicts as their own transcript record (api-types 0.68.0, `kind: "citations"`), and the rejoin replay folds it onto the reply it belongs to — without that, the fabricated SHA came back as plain text on the next page load. Wire types are mirrored in `src/api/chat-wire.ts` until studio's `wicked-crew-api-types` pin reaches 0.68.0. Tests: `tests/chatCitations.test.tsx` (the counter, the inline mark, the corrected ref, a fenced block left alone, and the frame landing on the reply it answers) and the journey `e2e/chat_citations_test.py` (a repo-scoped chat at 1440x700, both skins: the reply before the verdicts, then the marks).
- **A gate can amend the run's intent, and the run head says it did (wicked-core#555, crew api-types 0.67.0).** `request_changes` reaches the creator and **Approve + steer** reaches one unit; nothing amended the acceptance list the EVALUATOR is handed, so a mid-run descope could only end in a relaunch — and the evaluator kept failing a withdrawn item (the same tree passed on one attempt and failed on the next). The gate card gains **Amend intent** beside Approve + steer (and beside Request changes on an escalation card): approve-shaped, the note required, no scope — the engine appends the amendment to every unit at or after the cursor, which is what makes it reach the later evaluator. Its undo toast says what actually happens — "The run's acceptance list changes: every phase from here on — the evaluator included — is judged against your amendment instead of the withdrawn launch item" — not "the run resumes". The run head then carries each amendment beside the intent it changed (`RunIntentAmendments`, read off the RUN RECORD's `intent_amendments`, so it survives a reload), with the unit it took effect at and when it was decided. Nothing renders on an unamended run or against a daemon before the field. The arm and the record are typed in `src/api/wave6-wire.ts` until studio's api-types pin reaches 0.67.0. Tests: `tests/amendIntent.k7.test.tsx`.
- **The deliver identity is a setting you can see and set (wicked-crew#549).** The deliver phase pushed under whatever credential the daemon resolved at push time, and the gate said only "under the daemon's GitHub sign-in". System → Runs gains **Deliver identity (GitHub login)**: the account the phase must push as. The daemon checks it against gh's active login AND the credential git would use for the remote's host, and refuses before staging anything when either disagrees, naming both. Empty means the daemon's `GH_ACCOUNT`, and unset there means it pushes as whatever login gh holds — the description says so rather than implying a pin. A login, never a token: the field's own text says it, the daemon stores no secret, and a value that is not a login shows the inline hint client-side (a bad login would refuse every delivery) with the daemon's own 400 landing at the field, not in the page banner. Tests: `tests/SystemSettings.deliverIdentity.test.tsx`.
- **MCP tools: register MCP servers, see what each unit may do with their tools, and approve first use (DES-MCP-TOOLS-001 slice S6; crew `/api/v1/mcp/*`, `wicked-crew-api-types` 0.63.0).** A new rail section, **MCP tools** (`/mcp`), sits between Skills and Steering. Each server row shows its health and age, auth state, enabled tools and a posture summary for the chosen run mode (Gate every step / Gate by risk / Auto), for example "1 read run · 2 write ask". Expanding a row lists its tools with their class and annotations, an enable switch, **Approve** / **Revoke**, and a **Policies** matrix: one row per phase role (creator, evaluator, recon), one column per seat, each cell the engine's own decision (`POST /mcp/policies/preview`, recorded nowhere) with the rule ids that fired; a steering rule id opens its Steering row. **Add existing server** probes a pasted command or URL, previews the tools and their decisions as if saved now, and saves exactly that preview by its `previewHash`. Approving is an audited policy edit crew makes (server = first use; tool = first use and writes); Remove states its consequence first; servers found in a worker home are flagged. **Steering → Policies** gains an **MCP** filter chip (`?mcp=1`) and **Add ▾ → Add MCP policy**: a Subject picker over the registry fills `applies_to`, and a When builder (phase role, seat, class, argument pattern) compiles to `trigger.contains`, which stays visible and editable. The wire types are mirrored in `src/api/mcp-wire.ts` until studio bumps its `wicked-crew-api-types` pin. Journey: `e2e/mcp_tools_test.py` (paste, preview, save, approve at 1440x700, both skins).
- **Demo mode makes a real demo of your running app: plan gate → record → review gate → watch (#373).** Demo mode (the former Video mode) is a governed run of wicked-core's `demo` preset, the wicked-garden demo skill's plan, record and review, on the crew api-types 0.61.0 wire (`src/api/demo.ts`, hand-mirrored until studio's contract pin reaches it). **Start:** say who the demo is for, what to show and the app's URL; nothing launches until all three are filled, and the launch is `POST /projects/:id/demo`. **Plan gate:** the presenter script and the chapter list are the deliverable; approve, edit the script (a PUT at the gate only) or send the plan back with a note. A held team plan (`team_gate`) is approved first. **Record:** each chapter shows recorded, recording or waiting. **Review gate:** the three contact sheets and the reviewer's per-issue verdicts (re-encode, re-record one chapter, fix the app); accept, or "Re-record this chapter" sends `request_changes` naming that chapter only. A review the engine failed offers no Accept, only Review it again or re-record. **Watch:** the stitched MP4 with chapter markers that seek it, Download, and Draft update. Governance is stated where it is true: the recorder and reviewer seats (evaluator ≠ creator), whether the recording was read-only, and whether the script labels synthetic data. `/demo` lists the demo runs, the ones waiting on a gate first. The mode is labelled Demo everywhere.

### Removed
- **The old demo storyboard and wizard (M9b).** `VideoStoryboard`, `DemoWizard`, `demoWire` and `demoHtml` are gone with crew's interactive-demo pipeline; a demo document opens in Document mode.

### Fixed
- **A failed review's headline is its finding however the reviewer heads it (ship-prove-4 R4, #410).** Live on 0.5.18 the evaluator headed its section "Critical finding:", which only a heading starting with "findings" opened, so the send-back headline fell back to every bullet and led with "Read governed-worker skill — exit 0. (+3 more)". A findings heading is now recognised singular or plural, with a severity before or after, as a markdown heading, in bold or as an "X:" line (Findings, Critical finding, Concerns, Issues, Problems, Blocking issues, Blockers). Known non-finding sections (Commands run, Evidence, Verified, What I checked/did, Suggestions, Notes, Summary, Counts, Open questions) are never read as findings. With nothing left, the headline says the review failed and points to its full verdict; it never lists commands. Tests: `tests/gateMoveModel.r4b.test.ts`, on the run's real evaluator text (`tests/fixtures/shipProve4Review.ts`).
- **The launch's delivery checkbox promises a pull request only on a GitHub origin (ship-prove-4 R3b, #411).** The notice already read crew's deliver-target preflight, but the checkbox above it still said "Open a PR when done" on a local origin where no pull request can be opened. The label now reads the same preflight: "Open a PR when done" on a GitHub origin, "Push the branch when done" on a local or other-host origin, "Deliver when done (needs an origin remote)" with no origin remote, and "Deliver when done" while the origin is unread or unknown. Tests: `tests/ChatInput.deliverTarget.r3.test.tsx`.
- **A failed review's "why it failed" list and send-back headline show the finding, not the evaluator's "Commands run" (ship-prove-3 R4).** A governed evaluator writes a sectioned report (What I did / Commands run / Counts / Findings / Open questions / VERDICT); every bullet of it was read as a failing item, so the recommended send-back read "Read `…/SKILL.md` — exit 0. (+8 more)". The Findings section now outranks every other reading — the items under a failing severity (a "Critical:" group or a "Critical — …" line), else its bullets, else its prose; "Verified …" lists and "Concerns: none." are not failures, and file links render as `path:line`. Commands and evidence stay in the raw verdict underneath. An unsectioned review reads as before.
- **The launch says what delivery will really do on the repo's origin, and the deliver approve toast repeats the gate card (ship-prove-3 R3; crew `GET /repos/:id/deliver-target`, `wicked-crew-api-types` 0.69.0).** On a local-origin repo the composer promised "approve it and the run pushes its branch → opens a PR on <repo>", which was false. The notice now carries crew's deliver-gate sentence for that origin ("…a local path, so no pull request can be opened against it…", or "…to <owner>/<repo> on GitHub and opens a pull request there…"); a daemon that cannot say gets the condition ("…pushes its branch to the origin of <repo> → opens a PR there if that origin is a GitHub repository"), never a named PR destination. The undo toast after approving the deliver gate reads the same card sentence instead of a generic "opens a pull request on <registry name>".
- **A push-only delivery reads as delivered, not stranded (ship re-proof N1; crew `delivery: 'pushed'`, `wicked-crew-api-types` 0.69.0).** A run whose branch went to a non-GitHub origin showed "Stranded — … sitting uncommitted… No PR is on record" and a "Deliver — open a PR" button. The Delivery card now says "Delivered as a pushed branch — no pull request was opened, because the origin is not a GitHub host gh can resolve", names the branch and the remote, and offers no action; the badge reads "branch pushed"; the deck, census and campaign rollups count it as delivered (with no PR link), and it never lands in Needs-you.
- **The deliver gate's consent line says what will actually happen (ship re-proof N3).** It read only "Deliver pushes the run branch: 4 files changed…" while the truth for a non-GitHub origin ("no pull request can be opened") sat behind "show the full prompt" and a raw ` ||| `. The line now leads with the workflow's own target sentence from the deliver unit, then the diffstat; without a card it claims no pull request either way. No gate prompt renders the ` ||| ` separator, and the Home gate row recognises the engine's "Approve delivery before unit N runs" prompt.
- **The deliver lift's "base unchanged" line no longer states a SHA it cannot trust (ship-proof F1, wicked-core#682).** On a deliver RETRY the card read *"origin/main is still at c9caa85"* — and `c9caa85` was the RUN BRANCH head, not the base. `outcome: unchanged` means the base did not move, so `baseBefore` and `baseAfter` are the same commit BY DEFINITION; wicked-core's old `Unchanged` arm set `base_before = HEAD`, which equals the base only until a phase commits, so every retry put a false SHA on the consent surface for the one irreversible action. The engine is fixed — and studio ships against engines it did not release, so the card now JUDGES the pair instead of trusting it (`unchangedBaseSha` / `liftContradictsItself` in `deliverLiftModel.ts`). Only `baseAfter` is ever named — on an `unchanged` lift that field is the base tip in every engine that has shipped, while `baseBefore` is the field the defect put the run-branch head in, so a frame carrying only `baseBefore` (an unresolved base tip) names nothing rather than falling back to it. A mixed full/abbreviated pair identifies ONE commit and is not read as a contradiction. A pair that agrees is named exactly as before. A pair that disagrees names NOTHING: the card keeps the claim it can stand behind — "the lift found no change to origin/main — the tree the checks verified is the tree that would ship" (what the frame establishes: the lift found the same base, not that nothing ever moved) — and adds one line saying the daemon reported two different commits and that neither is identified as the base, showing both halves, telling the operator to read the ref themselves before approving, and naming the upgrade. `data-base="named"` / `"untrusted"` on `deliver-lift-summary` so a journey can tell them apart. The run narrator's line is fixed the same way. `lifted`, `conflict`, `skipped` and `failed` are untouched — they name two bases BECAUSE the base moved. Tests: `tests/RunDelivery.lift.test.tsx` (the C7 retry frame, red on the previous main with `origin/main is still at c9caa85` verbatim), `tests/deliverLiftModel.test.ts`, `tests/narrator.wire433.test.ts`.
- **The plan gate's consequence names the plan it gates, deliver included (ship-proof F4).** The line read *"approve runs 6 phases: understand → design → build → review → test → critique"* while the plan on the same card was `pa-scope → clarify → design → build → adversarial-review → test → review → deliver` — 8 units. It was derived from `PlanGateView.editSeed`, which is what the plan EDITOR is seeded with: it strips the two steps an operator cannot author (`pa-scope`, the launch's own `deliver`) and names steps by CATALOG rather than by their own id. Used as if it were the plan, the count, the names AND the presence of `deliver` — the only phase with an external side effect — were all wrong on the card that approves it. `planGateOf` now also reads `planSteps`: every step of `plan.proposed`, in order, nothing stripped and nothing renamed — each with the `id` the card shows it under AND the `catalog` that says what it is, because those answer different questions. The consequence line displays the ids, finds the deliver step by CATALOG (so a deliver step under any step id is named, and a step merely CALLED `deliver` that instantiates something else is not), reconciles the floor's additions — which are catalog names — against both fields so an addition already in the plan under another id is not listed twice, and says the side effect out loud rather than leaving `deliver` to be spotted in an eight-item arrow list. A step the payload could not name is COUNTED and shown as `(unnamed phase)`: dropping it would make the count disagree with the plan again, which is the whole defect. The edit seed still seeds the editor — the two are different things and the fix is that they are no longer confused. Tests: `tests/gateMoveModel.test.ts` (the C7 plan, red on the previous main with the 6-phase sentence verbatim; plus a floor-only addition and a plan with no deliver step) and `tests/SteeringGate.planGate.test.tsx`.
- **Skills: a published snapshot behind the installed garden plugin is named, with Refresh as the next move (#388).** The MCP S8 dogfood's first governed run failed INSIDE a worker with `scripts/mcp/shim.py: not found under the plugin root …/snapshots/000005`: the snapshot was generation 5, published from a baseline captured before wicked-garden#1192 added that file — and every MCP call a worker makes goes through that shim. The remedy (Refresh baseline → Publish) worked, but nothing on the page had said the root was behind the install, for two independent reasons, both fixed. (1) Nothing compared them: crew now reports the INSTALLED plugin's bundle content hash (`SkillsManifestResponse.installed`, wicked-crew#718's sibling change) and the page shows a row when it differs from the baseline — consequence first ("Workers are running skills older than the plugin installed on this host"), then the install's version, kind, hash and HEAD sha beside the baseline's, then **Refresh baseline** and **Publish** on the row itself. A comparison the daemon could not make is stated, never read as current, and a daemon too old to report it says nothing. The comparison is the content hash, not the version string — the dogfood's install had the same declared version. (2) The existing per-skill `unpublished` badge is judged over the files a SKILL owns, so it is structurally blind to the support tree — `scripts/`, `schemas/`, `.claude-plugin/`, `pyproject.toml` — which is exactly where the missing shim lived. The same row now names unpublished support files, with the first three paths, and in that state **Publish** is the primary verb and the copy does not tell the operator to refresh a baseline that is already current. Screenshots at 1440x700 caught two things measurement did not: markdown backticks rendering as literal text, and a headline that named the installed VERSION beside a header line showing the same number — it now says "the same version number, different files" when they match, which is the dogfood's own case. Tests: `tests/skillsApi.test.ts` (`baselineDrift`, `unpublishedSupport`) and five cases in `tests/SkillsPage.test.tsx`.
- **MCP: a pasted secret is written when you SAVE, together with the server (wicked-crew#719).** Adding a server wrote the secret to the OS keychain with `PUT /mcp/servers/:name/secret` and then previewed and saved, because crew refuses to probe an authenticated upstream without a secret. A failure anywhere after that write left a keychain entry with no server — invisible, because a keychain service's entries cannot be enumerated — or a server whose secret never landed. The value now rides the preview body (`secret`) and crew writes it inside the save, so the pair commits together: ONE request, the reference derived from the server's name rather than learnt from a pre-write, and the value kept in the form (nothing was written, so a correction still works) until the save. The panel's copy and the replace-a-live-secret consent say "when you save" instead of "when you preview", which is what they now do, and the stale-write hazards that consent guarded are structurally gone — nothing is written back mid-flight. A preview that answers AFTER the secret was corrected is now dropped rather than shown (review of PR #391, HIGH): the value is deliberately not part of the form key, so the success path needed the same value guard the failure path already had — otherwise Save would have committed the preview staged with the typo by its `previewHash`, beside a form showing the correction. `mcpApi.putSecret` went with the old flow.
- **Workflows: a drop-in definition the engine refused is named, with its reason (wicked-crew#718).** crew listed defs wicked-core had skipped at boot, so the selector offered `mcp-s8-dogfood` and the launch 400'd `unknown workflow`. crew now serves only what the engine accepted — so nothing can launch a refused def — and reports the rest as `unavailable`; the Workflows surface shows them with core's verbatim reason (`gate evaluates nothing: write-a-note — the phase declares executes_code but pins no validator …`), so the operator who authored the drop-in learns why from the page instead of from a failed launch. A daemon too old to report the field shows no row. Tests: `tests/WorkflowViewer.refused.test.tsx`.
- **An authenticated MCP server can be added at all, and a bearer API is sent its scheme
  (DES-MCP-TOOLS-001 §7, found by the S8 dogfood).** The add panel takes the secret's **value**, not
  only a reference: pasting one writes it to the OS keychain (`PUT /mcp/servers/:name/secret`) before
  the preview, then the field clears and the panel names the reference crew stored. Previously the
  panel could only offer a `keychain:` reference it had no way to fill, and crew refuses to probe an
  authenticated server unauthenticated ("auth.ref … resolves to no secret: set it, then try again"),
  so **every** authenticated server failed at Preview; `mcpApi.putSecret` existed and had no caller.
  A refused write (a secret under 8 characters, no OS store) stops before the preview and says why.
  A secret write that outlives the form it was started from is not written back: the value is in
  the keychain, but the reference never lands on a panel the operator has since retargeted at
  another server, and correcting a typed secret while its predecessor is still being written keeps
  the correction (codex review rounds 1-2 on #387). A header-injected secret also gains its **scheme** (`McpAuthConfig.prefix`, which the broker
  already honoured as `${prefix}${secret}`): without a field for it, an `Authorization: Bearer
  <token>` API was sent the bare token and answered 401. stdio servers, whose secret is the env
  var's whole value, are offered no scheme. A typed scheme is sent with the one space a header
  needs — `Bearer` and `Bearer ` both send `Bearer <secret>`, a separator scheme like `token=`
  is left alone — and the panel shows the header it will send, spacing included, because a
  trailing space in a text box is invisible and `Bearertoken` 401s exactly like no header.
  Pasting a secret for a name that is **already registered** replaces the credential that server's
  running calls use, before anything is saved — so the panel says exactly that and will not
  preview until the operator ticks it, and retyping the name or the value takes the consent back.
  (The keychain write is still not atomic with the save: crew has no staged-secret route, so an
  abandoned replacement leaves the new value in place. Named where it happens.) A pasted value
  decides the reference, so a half-typed one no longer blocks it, and any edit clears the last
  failure along with the held preview.
- **Retire on a memory row removes that one memory (#206).** The row's Retire now calls crew's
  `POST /memory/retire-item` and erases exactly that memory; its confirm says the rest of the scope
  stays. The subtree erase is a separate, quieter "Retire scope…" whose confirm names the whole
  subtree and its count. A daemon that cannot erase one memory (crew before the route, or a
  wicked-estate before erase-by-id) is named in the note. Nothing is deleted then, and nothing
  falls back to the subtree.
- **Run rows name what the run is (#230).** A row reads Onboarding, Document, Bug fix, Feature, … from
  the daemon's `run_identity` (a run that answered a document reads Document), not "Build" for every
  run. A one-word label before a colon ("Runs: …", "Recon: …") no longer becomes the whole title. A
  delivered run shows its delivery chip on the row.
- **The recon launch copy says what recon does (crew#473).** The intake gate comes before the survey
  and approves the survey itself; the plan is the run's output and nothing is launched from it. The
  problem framing is now one sentence, because the planner turns each sentence into a unit.
- **Chat replies show the answer (#237).** A collapsed reply's teaser is its first heading or first
  real sentence, not a leading `---` or the seat narrating its own tool use ("I'll explore…"); the
  now-bar uses the same teaser. claude's "Compacting... Compacting completed." session notice is
  dropped from the reply. A GFM table whose header row was glued to the sentence before it (a
  stream that joined two blocks) renders as a table instead of one fused paragraph.
- **A question several seats answered says the answers are unreconciled (#238).** Once every seat
  of a round has replied and two or more answered, the thread adds "N seats answered separately
  and nothing reconciled them — they may disagree; compare before acting". Continue in Build now
  carries the whole conversation instead of its last 6000 characters.
- **Each chat seat states its grounding, and every reply its cost (#277).** Warm seat chips read
  "grounded" or "ungrounded" from the chat's code-graph binding, with the daemon's reason on
  hover. A reply whose seat reported no usage reads "unmetered" instead of a blank, and the chat
  header totals the priced replies and counts the unmetered ones.
- **The gate card offers the new escalation arms, each with its consequence first, and only where crew accepts them (wicked-core#469, #467; crew#699).** A repo-checks floor that did not finish (`denial.source: repo_checks_timeout`) now renders the escalation layout with three more buttons: re-run the checks with twice the time (`extend`), re-run with the targeted tests (`targeted`), and accept what passed (`accept_partial`: the checks that did not pass or did not run are waived and listed; offered only when the floor report names one). An evaluator the worktree guard denied, whose edit the engine restored and pinned, offers "Adopt the evaluator's edit" (`accept_suggestion`), naming the paths, the suggestion ref and the creator phase it goes back to; it is offered only when the denied unit is an evaluator with a creator before it. Each sends `POST /runs/:id/gate {approve: true, action}` and nothing else (the arm takes no note), typed locally in `src/api/wave6-wire.ts` because studio pins api-types 0.40.0, and its undo toast says what it does. A timeout gate no longer recommends "Retry with the validator's findings", since the floor judged nothing. Tests: `tests/SteeringGate.escalation.test.tsx` (the timeout and suggestion blocks fail on the previous main).
- **The gate card leads with the work under review and names where the gate came from (#232).** A pre-run gate ("Approve unit N before it runs: …") now opens with "Under review: <phase>" (the engine's `awaitingHuman.reviewingOrd`, else the last finished unit), its output one click away (read only when opened), and "Approve runs next: <phase>". The footnote no longer claims every gate is "Workflow-declared": it reads the engine's `gateKind` (`run_level`, `def`, `deliver`, `terminal`) and says nothing when the daemon names none. The run header's working unit now comes from the live log (the latest `unitExecuting` not since finished or gated), so it no longer lags a unit behind the feed. Tests: `tests/gateCard.w2s3.test.tsx`, and the gate-source cases in `tests/SteeringGate.escalation.test.tsx`.
- **A judge the engine skipped reads as "judge skipped — reason", never as a verdict (#306).** `agentVerdict: "skipped"` (wicked-core#539: the only eligible judge seat was the creator's) is read as no judge verdict on the gate card, the decisions ledger and the verdict detail, each of which shows the engine's `judgeSkippedReason` and `judgeDistinct: false` instead of a verdict chip or "agent judge". Typed locally (`judgeVerdictOf`, `judgeSkippedOf` in `src/api/wave6-wire.ts`). A `"pass"` verdict is unchanged.
- **A steer at a pre-run gate can target the fix phase (wicked-core#465, studio half).** When the unit about to run is not the creator and a creator phase follows (the intake gate before triage), the card asks where "Approve + steer" goes: the creator phase (the default, sent as `amendScope: "creator"`) or the unit about to run. An intake steer written for the fix no longer lands on triage.
- **Gate card follow-ups from #308 (#310).** R6: every failure escalation (the dead-seat, never-seated and promptless worker-failure gates) renders the escalation layout. R7: the reassign-absent assertions now seed a seated failed unit and check `steering-reassign-row`, so they can fail. R8: the Revise seed scans back to the last evaluation that said something instead of stopping at a delivered run's clean deliver evaluation. R9: a host that does not hydrate events (the steering-author and testing panels) still reads the floor-failed prompt and the request-changes verdict prompt as escalations; the legacy worktree-guard prompt keeps Approve. R10: correcting the #299 bullet below, the floor-failed layout keys on the `repo_checks` denial alone, not on the prompt.
- **The Document composer chooses its council (#302).** The launch composer's seat chips are
  toggles now, not an inert row: defaulted like the Build composer's (the stored default seats,
  else every seat enabled for councils) minus the seats the roster says will not answer (not
  council-eligible, or signed out), which are named on a "council: claude · pi — left out: …"
  line. The choice rides the create as `clisJson` (crew#631), so the draft run convenes exactly
  those seats; with every seat unchecked, Create is refused. The Video wizard is unchanged.
- **No export on the v0 placeholder, and the collapsed panel says what it holds (#236).** The
  export bar is not offered on v0 (the bridge's "Building…" placeholder) in the panel, the
  version strip or the board tile. The collapsed rail labels its tabs, and Chat reads
  "Chat · Export", so a document opened directly shows where the conversation and the downloads
  live.
- **Studio no longer offers levers that cannot work (#315).** With every selected seat benched or
  not council-eligible, Send is disabled and a line names each seat's reason (Cmd+Enter posts
  nothing either), instead of a "Ready to send" beside the composer's own warning and a launch that
  fails at distribution. A gate whose unit's launch was refused by its environment (the engine's
  "refused its environment" or "failed again … before its work was judged", or a `stepFailed` of
  kind `environmentRefused`) shows no reassign row and says why; a seat-attributable failure offers
  only seats that can take the retry and names the rest with the roster's reason. Retry failed
  relaunches no run whose pool the roster says no seat can take, and a relaunch carries only the
  seats that can.
- **A team message at a plan gate gets a receipt (#367).** After the inject lands, the emptied
  composer and its hint line say what was sent and that it is queued for the team's next turn while
  the plan gate stays open; typing again clears it. A failed send still shows the error.
- **Approving the deliver gate says what leaves the machine (#368).** Its undo toast (and the gate
  chip's title) now reads "Pushes branch `wicked/<id>` and opens a pull request on `<repo>`, under
  the daemon's GitHub sign-in" instead of "The run resumes past this gate". Other gates keep the old
  line.
- **Losing the daemon now says how to get it back (crew#551).** The lost-connection banner was
  written but never mounted, so a studio whose daemon had gone (a reboot, a crash) showed only a red
  pill in the health rail. `ConnectionStatus` is now a banner that App mounts: while `/ws` is down it
  says the connection to the wicked-crew daemon is lost and reconnecting, and names the same one-line
  fix `wicked-crew status` prints (`wicked-crew serve`, or at every login `wicked-crew serve
  --install-service`). It renders nothing while connecting or connected.
- **A run the stall watchdog handed to you survives a reload (#284).** After the watchdog spent its
  automatic recoveries, a reloaded run page showed an executing run with nothing but Cancel. Crew
  now serves the watchdog's frames in `GET /runs/:id/events`; studio folds them back when it
  hydrates the run's log, so the run page shows a needs-you card ("Needs you: unit 5 (deliver)
  silent 30 min; 2 automatic recoveries spent (bash → claude → codex)") with **Reassign the unit**
  and, for an agent unit, **Nudge the worker**, and the needs-you queue counts the run again. A
  replayed watchdog frame no longer duplicates its live copy in the run log.
- **P never shows "Nothing needs you" while a gate is up (#369).** The queue builds its gate rows
  from the run list, which trails the live gate frame by a refresh; a gate the live store holds but
  the queue has not folded yet is now the peek target.
- **Team-model routing reads as a routing, not "degraded: undefined" (#332).** A `teamed` unit
  renders "Routed <seat> (team model, no council)" in the assumptions panel and "Routed: <seat>"
  in routing provenance. `wicked-crew-api-types` moves to 0.40.0 (the `teamed` arm); the wave-6
  and skills mirrors are re-vendored to it (line ranges; the `routingMethod` union gains `teamed`).
- **Home scrolls.** At 1440x700 the landing's own column was `overflow: hidden`, so the portfolio
  wall, the Quiet band and Unfiled runs sat below the fold with no way to reach them. The Home pane
  is now the one scroller (the rail and the status bar stay put) and the wall windows its rows
  against it; a run page whose gate card outgrows the pane scrolls too. New journey `main_scroll`
  (in the behaviour set) wheels to the last Home section and checks every top-level page for a
  clipped pane.
- **Wave A home, verified on the live rig at 1440x700.** The tile repair moves ("Retry", "Replay")
  sat over the tile's value row and covered a two-digit value's delta badge or unit; they now take
  their own line under the tile. A failed run with no `ended_at` (the daemon booted after it ended)
  now ages by the engine's terminal clock `finished_at` instead of showing "age unknown". A daemon
  without the replay route (404, crew before #689) is named as too old, with the host CLI that
  still drains the outbox, instead of "the daemon refused this — not found".

### Changed
- **Letters always type: every global shortcut moved off bare letters, for every skin (DES-STUDIO-REBUILD-001 §5.6, slice S2a).** A focused card or button used to swallow `j`, `a`, `r`, `x`, `p`, `g`, `b`, `n`, `t`, `u` and `?` as commands — a stray `a` approved a gate. Global chords now carry ⌥ (matched on the key's position, so macOS Option works): ⌥J/⌥K walk the triage cursor and the needs-you queue (the arrows still do), ⌥A/⌥R approve/reject the selected or focused gate, ⌥X selects a gate for batch resolution (Space no longer does), ⌥P/⌥G/⌥B peek/jump/back, ⌥N opens the steer note, ⌥T/⌥U switch a finished run's lenses, and ⌥/ opens the shortcut overlay. Ctrl/⌘ chords (⌘K, ⌘P, ⌘⇧F, ⌘⇧K, ⌘⇧A) are unchanged. The registry refuses a bare printable chord at registration, and `tests/chordModifiers.test.ts` enumerates every chord under `src/`. The skin contract is restated in `src/theming/skins.ts` and `e2e/skin_contract_test.py`: a skin changes no behaviour; every route is reachable under every skin, by its nav or ⌘K; keyboard behaviour is identical across skins. The safety semantics are unchanged: the 10 s undo window, one decision per gate, Esc never dismisses a decision.
- **Letters always type into a composer (DES-STUDIO-REBUILD-001 §5.6 rule 4, slice S2b).** A letter, digit or symbol typed with no modifier while focus is on the page, a card or a button — not in a field, and not inside a control that owns its keys (a radiogroup, listbox, menu, tabs, slider) — now lands in a composer: the open Ask dock, else the page's composer (chat, launch, the Steering assistant), else the Ask dock, opened holding what you typed (opening it only reads). The gate card's steer box never takes these letters, because its send approves the gate: typing never answers a question. Nothing is sent until you send it yourself. Space still presses the focused button. Tests: `tests/typeToComposer.test.tsx`, `tests/AskDock.test.tsx`, and the journey `e2e/type_to_composer_test.py` (body, a focused card, a focused Approve button, the launch composer, the gate thread and a radiogroup; 0 gate POSTs past the 10 s window), now in the CI behaviour set.
- **"While you were away" is one line that never holds the page.** The handover was a four-column
  panel that grew with its items and pushed every Home section down (with ~3 items per column, the
  Needs You queue started 552 px down at 1440x700). It is now one fixed-height strip: "Since 21:11 ·
  3h ago — [2 decisions due] [1 broke] [1 finished] [1 done for you] · Got it". *Decisions due* and
  *broke* scroll to and briefly highlight their rows in the Needs You queue, where Open gate and
  Retry already live. *Finished* opens an overlay listing each finished run with Open, Draft update
  and Reuse as preset (the Runs list's next-use model). *Done for you* opens an overlay of what your
  standing orders and the system did, each with Open and its audit entry. Overlays float over the
  page, so opening one moves nothing. Escape or an outside click closes them, and focus returns to
  the chip. "Got it" records the visit, and the handover also clears itself once every item it
  listed has been acted on or resolved.
- **Standing orders no longer take a permanent row.** With none in force they are a small header
  chip ("Orders: none · Mark me away"). With some, they are one header line ("3 orders active ·
  while away: will approve … · Manage · Mark me away"), and the full preview and crew's invariant
  sit in its tooltip and at the head of Manage, which is now an overlay.
- **Palette and controls polish (tokens and CSS, no layout changes).** A slate-ink surface ramp
  with a cool bias, tinted ink, hairline border tokens, an iris-blue default accent (230/74/68,
  replacing the stock violet 258/72/62; "Reset to default" on Theme picks it up) with dark text on
  it, a warn-orange status, and a light theme whose text, accent and status colours all clear
  WCAG AA (the old light theme's amber measured 1.2:1). One button vocabulary (`wk-btn` primary /
  secondary / danger / quiet, with hover, active, focus-visible and disabled states) on the gate
  card, Home's verbs, the Needs You rows, the run header and the undo toasts; the gate card's
  recommended move is the single primary; status fills are washes rather than slabs.
- **Design-council pass on the polish (wicked-studio#370).** The Ask bubble reserves room instead
  of covering the composer, the Home tail and the toast pointer; disabled controls are a dashed,
  unfilled structure rather than a faded copy; focus draws a ring plus a transparent outline so it
  survives forced-colors mode; the gate card reads its consequence before its verb and keeps its
  answers in fixed slots (Reject is always the right column); status dots carry a shape per state;
  every control is a 24px target; field edges clear 3:1 (`--border-input`); amber means only
  "waiting on you"; one page-title token. `tests/tokens.contrast.test.ts` measures every ink step
  (4.5:1) and the field edge (3:1) on every surface in both themes.

### Added
- **Capture anything, where you already are (Studio OS behaviour 8, on the Wave A–C pattern).**
  A **Capture** verb sits beside **Do Work** in Home's verb row, and the same drop is in the Ask
  dock. Paste notes or a transcript, add files, or drop a whiteboard photo, and pick the project.
  The consequence is said before the send: the team files what these say as proposals on that
  project, they land in Needs You on Home, and nothing is kept until you accept it. The drop posts
  `POST /projects/:id/capture` (crew api-types 0.48.0), and crew files a small run whose only output
  is proposals in the ONE queue. There is no second review surface: while the run works, studio
  re-reads the pending queue into the needs-you sources, so the rows land in Home's EXISTING
  proposal triage (#357). The triage line names what the team filed each row as ("Memory only — a
  captured decision: …", "Changes enforcement — lands a development rule (warn) from your
  capture"), and "Accept N memory-only" covers the harmless ones. The Capture verb carries the last
  capture's count ("· 5 waiting"); the open drop and the Ask dock show the full line (how many wait,
  split by consequence, with **Review in Needs You**). Journey: `e2e/capture_test.py`, in the
  behaviour set.
- **Standing orders: the Away switch says what it will do (Studio OS behaviour 10, on the Wave A–C
  pattern).** Home's Standing-orders strip carries the away switch with its consequence first: a
  preview built from the orders in force ("While you are away: 3 orders active: will approve band
  0-19 (LOW) unit reviews on Northwind; …; deliver gates always wait"), beside crew's invariant (no
  order answers a deliver gate or a high-risk plan approval; a message an order writes is queued,
  never sent). The list is the ONE list: orders made at a gate ("make it a rule", #356) and by the
  trust receipt (#360) appear with the ones typed in words, each saying where it came from, and the
  rule words read band and preset orders. Add an order in plain words, **Read it back** (crew's seat
  parses it, the rule is said back), **Keep this order**; a rule the invariant refuses cannot be
  kept. The handover gets a "What your standing orders did" section (only when an order acted),
  naming the order behind each approve, hold or queued message. The order types are the ones
  `src/api/gateHistory.ts` already declares; the rest of the wire is hand-declared until studio's
  `wicked-crew-api-types` pin carries it. Journey: `e2e/standing_orders_test.py`, now in the
  behaviour set.
- **Home's elements carry their own next move (Wave A, lane home: ideas 3, 5 and 14).**
  *Collapse clones*: two or more never-indexed repos fold into ONE Needs You row whose line states
  the consequence ("Launches 9 onboarding runs · ~N min each (median of K past onboards)", or "time
  unknown" when none has finished) and whose "Index all 9 repos" launches one onboarding run per
  repo through `POST /repos/:id/onboard`, reporting what launched and what was refused.
  *Numbers are repair moves*: the Governed tile's dead-letter count carries "Replay", which asks
  `POST /governance/deadletters/replay` (crew#689) for a DRY RUN first and shows what would move and
  that failures stay quarantined; the real replay posts only on confirm, then diagnostics is re-read.
  The Failed tile carries "Retry", previewing the failures in its window not yet retried and
  relaunching exactly those (onboarding runs through their repo's onboard route, the rest through
  `POST /runs` with `retryOf`, the run's seats as roster seat objects where the roster still has
  them, and `deliver: 'none'` on repo-scoped workflows). *Broken-clock pill*:
  an absent or impossible age (before 2020, i.e. a seconds-as-ms slip, or in the future) renders as
  an "age unknown" / "impossible age" pill linking to the record, never "20702d", on the Needs You
  queue, Home's recent activity and quiet chips, and the runs list; a group's age and the "oldest
  waiting" line ignore broken clocks. `tests/waveA.home.test.tsx` and `e2e/wavea_home_test.py`
  (added to the behaviour set) pin it.
- **Chat stays off delivery when it is an engine preset (DES-TEAMING-002 M3, crew api-types 0.48.0).**
  `chat` and `onboarding` are now the engine's built-in presets: `GET /workflows` no longer lists
  them and `GET /presets` carries `system: true` on them. The run-kind lookup
  (`isSystemWorkflowIn`) reads a preset's `system` flag when no def has the name, so the chat
  surface's `workflowOverride: 'chat'` launch is unchanged: no `deliver` key, no deliver notice,
  and no launch preview for a system preset. On an older daemon the def still answers first.
- **The plan UI for team runs (DES-TEAMING-002 T9).** The composer's **Phases** picker lists the
  engine's catalog (`GET /catalog`), not a list of our own; a composed plan launches as `plan`
  (with an optional touch set), never `workflow`. Before Send, a **launch preview**
  (`POST /plans/preview`, for a composed plan or a named preset) shows the score, the band, the
  steps the floor added, and whether the launch pauses and why. A plan the PA will scope first
  (`graph: "pending_pa_scope"`) shows no score and no floor markers, because its floor is only the
  baseline's. `before:N` is sent as `before:N+1` when the preview's first step is the PA's
  `pa-scope` step (ord 1). The engine accepts only a number there, so the shift is read off the
  preview. A live preset or user-plan run gets a **Plan** section on its run page: adding phases
  sends `POST /runs/:id/plan` with a fresh `requestId` per edit and shows the answer's band,
  high-risk flag and floor additions. Retrying a lost answer re-sends the same `requestId`, and
  `duplicate: true` reads "Already applied". The types are hand-declared from
  wicked-crew-api-types 0.47.0 (`src/api/teamPlan.ts`) until a published version carries them.
  `e2e/t9_plan_ui_test.py` covers all of it under both skins.

- **The Needs-you queue lives in the app shell.** Its inputs (live chats, campaigns, the repo
  register, pending proposals) are loaded by one app-level store (`store/needsSources.ts`) and
  folded by one hook (`useNeedsRows`), so Home, the right rail and peek read the same ranked rows
  on every route. Under `compact-rail` the right rail now shows on every route, and peek off Home
  sees proposals, chats, campaigns and repo graphs, not only gates and the `/ws`-fed stores. Each
  input is read once and re-read only when Home finds it older than 30 s, so a route walk re-reads
  nothing. The shell's board model and the launch composer share the one `GET /repos`, and the
  pages that already read chats, proposals or repos deposit their answers into the store without
  a request. `e2e/needs_shell_test.py` covers the rail on a run page, peek on a run page, and the
  request budget.
- **Skin contract.** Studio's shape is now a skin over the one behaviour layer. A skin is a
  manifest (`theming/skins.ts`): token overrides of the same semantic-token names tokens.css
  declares (never a primitive, never a colour), a shell layout (`classic` | `right-rail`), and a
  variant for each behaviour surface (Needs-you queue, live runs, handover, peek card, undo
  toasts, nav rail). The active skin rides `studio.appearance.skin` beside the theme, is stamped
  on `<html>` as `data-skin` (default `studio`, the current look), and is chosen in a new Skin
  picker on the Theme page. The proof skin `compact-rail` docks the Needs-you queue into a
  full-height right rail on Home, collapses the left nav to icons, and tightens the type and
  spacing scales. Every destination the full nav exposes stays reachable in the icon rail:
  each section's glyph, Notifications, Settings (an icon flyout with Theme / Workflows /
  System) and Health (the heart icon, opening the health registry in a flyout), each with an
  aria-label; the icon variant no longer hover-expands. The e2e fixture's `STUDIO_SKIN` env var boots any journey under a skin;
  `e2e/skin_contract_test.py` checks that the structure changes, the queue behaves the same, and
  the nav's destinations are the same set under both skins.
- **Wave 1 — dark when healthy.** The home board's WORKING band collapses to one count line
  (`Working (n)`, expandable); only exception bands (Needs you) open by default, so a healthy
  portfolio shows no animated card and the one gated project is the only expanded card. The rule
  lives in `board/bandExpansion.ts`; the expansion and the board's scroll ride the history entry
  (`hooks/useHistoryState.ts`), so Back restores them.
- **Wave 1 — raw in one step.** Palette verbs for ANY run by id or intent words: `>events <run>`
  opens `/runs/:id/events` (the run's raw event JSON), `>files <run>` opens `/runs/:id/files` (the
  existing worktree/diff viewer), `>config` opens `/system`. Each is a route, so browser Back
  returns to where you were with the palette closed. Targets live in `palette/runTargets.ts`.
- **Wave 1 — outbound harness.** A "Draft update" action on every run drafts the PR description
  (completed run) or a status update (anything else) from crew's `GET /runs/:id/deliver-text`, in
  an editable text area with a Copy action. One data function (`api/outbound.ts`,
  `{kind: 'pr' | 'status', runId}`) and one action list (`OUTBOUND_ACTIONS`, Copy only today).
- **Wave 2b — one queue ranked by consequence.** The home needs-you queue adds MCP elicitations,
  agent steer requests (the bell's unread `steer_requested`), the stall watchdog's needs-a-human
  escalations (`workerStallEscalated`, superseding the board's stalled-run row) and pending
  steering/memory proposals. One ranking function (`compareNeeds` in `board/needsYou.ts`): the
  kind's consequence class, then the waiting-age band (longest waiting first), then stakes, then
  exact age and key. Alike simple items fold into one expandable row ("2 approvals",
  `board/needsQueue.ts`). Focus the queue and j/k walk it; Enter expands a group or does the row's
  verb (`hooks/useNeedsQueue.ts`). A failure now dates from the daemon's `ended_at` first.
- **Wave 2b — handover on arrival.** Studio records your last visit (a visible tab, in
  localStorage). After an absence of at least 30 minutes (`studio.handover.awayMinutes` in crew's
  settings store overrides the default), Home opens with a "While you were away" panel in a fixed
  order: decisions due, what broke, what finished, and what the system did for you (system-actor
  audit entries via `GET /audit?since=`, crew#677). Every row links to its run. Dismissing the panel
  keeps it closed until the next absence (`board/handover.ts`, `store/visit.ts`).
- **Wave 2b — switching projects with a brief.** Switching projects from the context header keeps
  your current mode and lands where you last were in that project under that mode: the route, and
  the scroll once the surface can hold it. A band then shows what changed since you left,
  e.g. "since 14:05: 1 run finished, 1 gate". Leaving a project snapshots its runs' statuses, and
  the brief compares against that snapshot (`board/projectBrief.ts`, `store/projectVisits.ts`,
  `hooks/useProjectVisits.ts`).
- **Wave 2b round 2 (review of #336).** The queue's cursor no longer pulls focus back from Ask or
  any input on a live update, and focus and selection now agree: a click or a Tab onto a row
  selects that row, and focus leaving the queue clears the selection. Enter acts only when the
  selected row (or the queue itself) has focus, so Enter on a focused Retry runs Retry. The wall's
  triage keys (j/k, a/r, x/Space, Enter) stand down while the queue has focus, so `a` can no
  longer approve a wall-selected card's gate from inside the queue. The minute heartbeat now
  treats a gap past the threshold (a laptop that slept with the tab open) as an arrival instead of
  overwriting it. The handover's "system" section says it is checking while the audit read is in
  flight and says the daemon cannot say only when the read fails. The project brief snapshots only
  live runs and counts a run as new only when its `created_at` is after you left.
- **Wave 2a — peek, jump, back.** `P` shows the top item that needs you (for a gate, its prompt
  and the evaluator verdict it is asking about) in place, with the URL unchanged; `G` goes to that gate;
  `B` puts you back exactly where you were: the route, every `data-place-scroll` scroller's
  offset, the focused control, and any panel registered with `usePlacePanel`. All three are in the
  shortcut registry, so the `?` overlay lists them under "Peek, jump, back". Behaviour in
  `board/peekTarget.ts`, `store/place.ts`, `hooks/usePeekJump.ts`; `PeekCard` only renders.
  The peeked item is the top of wave 2b's ONE ranked queue (`needsYouRows` → `compareNeeds`;
  a folded group stands for its top member), so peek and jump follow the queue's ranking.
- **Wave 2a — preview, then commit, with an undo window.** A gate decision from the board chip,
  the triage keys (`a`, `r` + note), the palette verbs, or the batch bar is queued for 10 s with an
  Undo toast ("Approving in 10 s", what will happen, Undo); the `POST /runs/:id/gate` goes out only
  when the window ends. Undo sends nothing and the gate stays open; closing the tab inside the
  window sends nothing either, and the toast says so. A batch is one window, then the sequential
  fan-out. Behaviour in `board/undoQueue.ts`; `UndoToasts` only renders.
  Every human gate decision in studio rides it: the thread's gate card (buttons and its `a`/`r`
  keys), the project dashboard, the steer composer, the reassign control and the unit detail all
  decide through `commitGateDecision`, and `tests/gateWireSingleCaller.test.ts` fails if any other
  module calls the gate POST.
  A queued decision is about ONE gate: it records the gate's `ord` and sends it (crew#681 answers
  409 `gate_changed` / `gate_unknown`; any refusal is shown as "Not sent: …" with the server's reason,
  never resent). If that gate
  is answered elsewhere, the run moves on, or a NEW gate opens on the run during the window, the
  decision is dropped unsent and the toast says so. Every outcome is visible whichever surface is
  mounted (sent / failed / not sent); a refused second decision is never silent. The toast names
  the gate ("Approving beta · b1 in 8 s"); the gate card shows the shared queued state with its
  controls disabled; peek, triage selection and batch skip gates that already carry a decision;
  a reject reason survives Undo; `B` after chained jumps returns to the first origin; `P`/`G`/`B`
  stand down under a modal or the `?` overlay.

### Changed
- **A gate decision that outlived its gate is refreshed, not retried.** On crew's 409
  `gate_changed` / `gate_unknown`, the one decision path (`board/gateActions.ts`) re-reads the
  open gate, shows it, and says the gate moved; nothing is re-sent.
- **Runs are classified by the daemon's `run_identity`.** A run's kind comes from
  `run_identity.system` / `.kind` (api-types 0.46.0), and a launch's from the def's `is_system`.
  Studio's own `SYSTEM_WORKFLOW_IDS` list is deleted. On a daemon before 0.46.0, a cold cache shows
  a machine-owned run's worktree line (a fact), never the "no deliver phase" claim.

### Fixed
- **Dogfood fixes on the launch screen and the plan gate (2026-09-27 findings D1-D4, D6, D10,
  D11, D15).** A `plan_approval` gate now shows why the plan scored as it did (score, band, the
  score's reasons from `GET /runs/:id/team`, what the floor added and why), hides the scope
  step's verdict and the doubled "manual mode", and offers approve, approve with an edited plan
  (the T9 picker, seeded from the held plan) and reject; "Approve + steer" and the steering
  composer are gone there (the daemon refuses amend text), and the bottom composer sends a team
  message instead. The launch screen says the team model in one line, shows the no-PR notice only
  for a build launch without a repo, gains a repo picker beside Project, hides `deliver` in the
  phase picker when the launch delivers, reads the roster's `auth` for "sign in needed", and drops
  the file-attach control that never sent its files (a launch cannot carry files to its run).
  Home's "Never indexed" age reads the wire's epoch seconds (was "20702d").
- **Back after opening a gate.** The thread's gate card consumed the `#gate` hash with
  `history.replaceState(null, …)`, which wiped wave 1's in-app mark from the history entry, so a
  later Back from that entry went to a fallback page instead of the previous one. The entry's
  state is now kept whole (`keepEntryState`).
- **Wave 1 — project switch reused the previous project's run.** The project shell's per-mode
  artifact memory was not scoped to the project, so after switching project a mode tab could route
  into the old project's run (`/p/beta/build/a1`). The memory is now keyed by project
  (`hooks/useModeMemory.ts`).
- The palette hands focus back without scrolling the view the operator left.
- **Wave 1 round 2 — a stalled run is never hidden.** An active run whose freshest activity
  evidence (a streamed frame, or its durable event tail — never an attach/project clock) has
  decayed past the triage threshold (30 min silent) is `stalled`: `bandFor` puts it in NEEDS YOU
  and the needs-you queue carries a `stalled-run` row, so home is never "calm" over a wedged run
  (`board/boardAttention.ts` `isStalled`, `store/activityClocks.ts`).
- **Wave 1 round 2 — zero is quiet.** Count tiles (Needs you / Failed / Review and the delivery
  strip) take their tone from `board/countTone.ts`: a zero is neutral, a status colour marks only a
  non-zero exception (`data-tone` on each tile).
- **Wave 1 round 2 — draft edits survive the run finishing.** The draft's kind is fixed when it
  opens, so a status flip no longer refetches over the operator's edits.
- **Wave 1 round 2 — Back never leaves studio.** App-pushed history entries are marked; the raw
  views go Back only from a marked entry and otherwise navigate to `/`. Escape over the files view
  with the palette open closes only the palette (capture-phase, palette-yielding, like Modal). A
  pending scroll restore is cancelled by the operator's first scroll.
- **studio#333 — the Ask bubble no longer covers Chat's Send button.** On `/chats` → New chat at
  1440×700 the floating launcher (#326) sat on the composer's Send, clipping it to "S…". The
  launcher takes a `bottomOffsetPx` — the same contract as the run right-panel's `rightOffsetPx`,
  on the other axis — and GroupChat reports its composer band's LIVE height (a ResizeObserver —
  the band grows when "Choose repos…" opens the scope picker; 0 on unmount) which the shell passes
  through, so bubble and panel lift above the composer whatever it shows. The composer band and its
  Send button carry `chat-composer` / `chat-send` testids; `e2e/ask_launcher_333_test.py` asserts
  the Send box never intersects the bubble, closed AND with the picker open (red before, green
  after). The lift is clamped to the viewport's height — the bubble and its gutter always stay on
  screen and the panel's height never goes negative on a short viewport. The Chat empty-state helper
  now names the #327 scope vocabulary (System / Everything / Project repos / Choose repos) instead
  of "a repo list, or unscoped".
- **Registry lag no longer costs the release its GitHub Release page (#331).** On `v0.5.14` npm
  accepted the publish, the post-publish "The registry can actually serve it" probe 404'd through
  its whole 60 s window, and `Create the GitHub Release from CHANGELOG` was skipped — then the
  same version resolved about a minute later and the release had to be cut by hand. The probe now
  backs off over ~6 minutes (10+15+20+30+45+60+60+60+60 s across 10 attempts) and, if the registry
  is still lagging, emits a `::warning::` and exits 0 instead of failing the job: the publish is
  what gates the release page, and the probe reports whether the version was servable yet.
  `tests/releaseWorkflow.test.ts` pins the order of publish → probe → release, that the probe
  carries no non-zero exit and no `if:` guard on the release step, and that the backoff covers at
  least five minutes. Checked for the same shape in wicked-ci's reusable `node-release.yml`: it has
  no serve probe and no GitHub Release step, so nothing to fix there.

## [0.5.14] — 2026-09-23

### Added
- **studio#323 R4 — Chat scope is system + everything / project / repos, in Chat AND Ask.** GroupChat's
  three chips (All project repos / Choose repos / Unscoped) become four: **System** (the platform
  itself — no repositories, no code graph), **Everything** (every registered repo, not an enumerated
  list), **Project**, **Repos…**. System and Everything name their kind on the open (`scopeKind`,
  wicked-crew-api-types 0.39.0) and stay choosable inside a project (the project rides as filing
  only); Project and Repos keep the legacy body older daemons accept. The opened chat states the
  resolved `system` / `everything` scope. The Ask dock gains a scope select in its empty state,
  defaulting to the route's project, else Everything; the seats it offers follow that scope's
  admission, and its header states the scope the daemon resolved. A daemon predating named kinds
  (400 unknown field `scopeKind`) is named as such. Pins `wicked-crew-api-types` 0.39.0 (mirrors in
  `wave6-wire.ts` / `skills-wire.ts` relabelled; the chat-refusal region re-vendored to carry the
  upstream `ChatSingleSeatDegradation` / `ChatMessageResponse` additions).

### Fixed
- **The evaluator ≠ creator disclosure is no longer silent for `same_cli_instance` or an unknown
  value.** `narrateDistributionWarning` (routing line + run head) handled only `creator_seat`, so a
  review unit on a distinct seat INSTANCE of the builder's own cli (wicked-core#595, crew#666) — or
  any value a newer engine sends — showed nothing. It now reads "evaluator ≠ creator held by seat
  instance only — the reviewer runs the same cli as the builder", and any other non-null value gets
  a generic "not recognised … treat the review as not independent" disclosure, as the contract says.
- **A reopened Ask dock restates the open chat's scope.** The scope the daemon resolved is persisted
  with the Ask session (`wicked.ask.session`, studio#323 R3) and read back on reopen, so the header
  says `scope: …` for the resumed chat instead of offering a scope choice; a session saved without
  one reads "scope: not stated by the daemon".

- **Ask no longer resumes a session the daemon already reaped (studio#328).** On reopen, the resumed session's `GET /chats/:id` probe now follows GroupChat's rule: a 200 with no seats means reclaimed, so the dock drops the resumed block (no "still on the line" note, no "Open in full chat" to a dead chat), forgets the stored `wicked.ask.session`, and the next question opens a fresh session. A probe that fails keeps the session and shows the transient error.

- **Ask floats bottom-right, its chats show up on Chats, and it opens into the full chat (studio#323 R1–R3).** The Ask entry left the rail chrome (the `?` circle beside the logo) and is now a floating chat bubble fixed bottom-right (`AskLauncher`, `data-testid="ask-launcher"`), clear of the runs bar and — when a run is selected — the right panel; the Ask dock floats as a panel anchored above it instead of pushing a 384px layout column. Ctrl/⌘+Shift+A still toggles it. The Chats page now reconciles the daemon's `GET /chats` with the client's live-chats store (the same store the rail reads), deduped by id, so an Ask-started chat is listed there — a successful list is authoritative (a store session it omits that was last seen before the request is dropped, never a live card to a dead `/chat/:id`), and the store is the fallback when the list fails; every live card carries an origin marker (Ask / Chat / Session when unknown) and the first question as its title instead of `live · <8 hex>`. The Ask dock gained **Open in full chat**, which routes to `/chat/:id` for the dock's session (the full chat replays the daemon-kept transcript). Closing and reopening Ask no longer mints a second session: the active Ask chat id is persisted in `sessionStorage`, reopening resumes it (and replays its transcript in the dock), and a resumed session falls back to a fresh one only when the daemon proves it is gone (`GET /chats/:id` answers no seats) — a 5xx or network failure keeps the session and shows the error. On a narrow viewport with a run selected, the launcher overlays the right panel rather than pushing the Ask panel off-screen.

- **Health rail section is bounded and scrollable (studio#322).** The expanded Health section rendered as an unbounded `shrink-0` sibling below the rail's only scroller (`overflow-y-auto`), so any roster or governance payload that grew taller than the remaining viewport was silently clipped with no way to reach the bottom rows. The section root now carries `flex flex-col max-h-[45vh]` and the expanded body carries `overflow-y-auto min-h-0 flex-1`, giving the section its own bounded scroll area. Reproduces at the default 5-seat roster with a realistic governance payload; verified with a Playwright check at 1440×700.

- **MemoriesPanel: retire confirm count is no longer overwritten by a stale scope-coverage call.** Clicking "Retire…" on a second memory before the first scope's coverage fetch resolved would let the stale first response overwrite the second scope's count in the confirm banner. The fetch is now in a `useEffect` keyed on the retiring scope **string** (not the row object), with an `active` flag that discards any response that arrives after the scope has changed. Keying on the object had a second failure: re-clicking "Retire…" on the row already being confirmed cleared the count while the effect — seeing the same object — never re-fired, so the blast-radius count silently disappeared. The count is now cleared only when the scope changes.

- **RequirementsModal: "Run domain extraction" has an in-flight guard and surfaces failures.** The button was `void`-ing the `launchRun` promise, silently swallowing errors and allowing rapid repeated clicks to spawn concurrent runs. The button is now disabled while the launch is in flight (showing "Launching…"), and **stays disabled after a successful launch** ("Extraction launched", naming the run) — `launchRun` resolves in tens of milliseconds while the extraction runs for minutes, so a guard that re-armed when the POST settled still let a second click start a duplicate run. The launch is recorded as a studio-origin run in the provenance store, as ChatInput already does. A failed launch re-arms the button and surfaces the daemon's error.

- **RequirementsModal: Escape closes the edit rail before closing the modal.** Pressing Escape while the `RequirementEditRail` was open called `onClose()` on the modal directly, discarding unsaved title/notes/status edits without warning. Escape now closes the rail first; a second Escape (with no rail open) closes the modal, matching the layer-by-layer §7.7 contract.

- **Steering "Add row" works on an unseeded store (studio#212).** The `{!unseeded && <SteeringGrid>}` guard was blocking the grid from mounting when the store had never been seeded, making the "Add row" menu entry inert — the draft row could never appear because the grid that holds it wasn't rendered. The guard is removed; `SteeringGrid` now renders unconditionally. The grid's own "No steering rules in the store." empty-state sentence is suppressed when the store is unseeded — the `steering-unseeded` banner continues to own that visual so the two messages do not conflict; the grid and its `FilterStrip` remain mounted so `Add row` can create the first rule. Seeding a store's first rule from the empty state now works as intended.

- **RequirementsModal closes on Escape and offers a launch button on empty corpus (studio#229).** The modal rolled its own overlay without wiring `useModalEscape`, so pressing Escape did nothing. It now wires `useModalEscape`, matching the contract all other modal-family components follow — through a handler that closes an open edit rail first (see the Escape entry above). Additionally, when a repo's extraction has never run (`corpus === 0`) the modal previously showed plain text "Run domain extraction on it to populate this view." with no way to act; it now renders a "Run domain extraction" button that posts `POST /runs` with `workflow: 'domain-extraction'`.

- **Memory retire confirm shows blast-radius count before the destructive action (studio#206, blast-radius half).** Selecting a memory row to retire now fetches `GET /memory/coverage?scope_prefix=<scope>` whenever the retiring scope changes, and displays the count in the confirm banner (e.g. "3 memories will be erased") before the operator confirms. The count is cleared on cancel or after confirm completes. No per-id delete is added — the estate wire exposes no per-memory delete endpoint.

- **Export links survive a reload (wicked-studio#234 — stopgap).** `VersionStrip` now calls `hydrateExports` on document open and every version change. For each of the three formats (`html`, `pdf`, `pptx`) it probes the deterministic download name (`<doc-slug>_v<n>.<fmt>`) at `/d/<docId>/api/export/file/<name>` through crew's interactive proxy using a 1-byte Range GET (HEAD would false-positive on HTML fallbacks). A 200/206 response seeds `exportAnswers` so `ExportMenu`'s `readyHere` is true after a reload and the "Downloads" strip renders; a 404 or any probe error is silently ignored — for a pdf or pptx export that does not exist, no download is ever shown (their expected MIME types cannot be confused with an HTML fallback), and a 404 or probe error renders nothing for every format. The settled `href` is the exact URL probed, matching the URL a POST answer returns for the same file on the same bridge (AC-2). **Disclosed stopgap**: `wicked-interactive#236` is the tracking issue for a bridge listing route that will replace this probe when it lands; until then this module is the authoritative source for reload-surviving links. **Known limitation**: the probe cannot prove an html export exists — wicked-interactive 0.9.3 serves a real HTML export as `text/html` and an HTML fallback from an unmapped path also answers `text/html`, so for the html format a download for an export that does not exist can still be shown (`wicked-studio#319`).

- **Export probe validates content type per format (wicked-studio#234 content-type guard).** `hydrateExports` previously gated solely on `res.ok`, which let any HTML-fallback (a 200 + `text/html` from an unmapped path) seed a READY link for a pdf or pptx export that does not exist. The probe now validates the response content type per format (`text/html` for html, `application/pdf` for pdf, `application/vnd.openxmlformats-officedocument.presentationml.presentation` for pptx); a missing, empty or mismatched type leaves the format button unchanged, and a 404 or any probe error renders nothing for every format. This guard is not equivalent to VideoStoryboard's recording probe, which gates on `type.startsWith('video/')` — a test an HTML fallback can never satisfy — because here the expected type for html IS `text/html`. **Known limitation (stopgap, tied to the bridge listing route `wicked-interactive#236`)**: for html the probe can still show a download for an export that does not exist, since a real HTML export and an HTML fallback from an unmapped path both answer `text/html` (`wicked-studio#319`).

- **FacetAutocomplete: clear the blur-close timer on unmount.** The 120 ms `setTimeout` in `onBlur` was never cancelled on unmount, so if the component was torn down while the timer was live its callback fired into a destroyed environment and produced an unhandled `ReferenceError`. Added a `useEffect` cleanup that calls `clearTimeout(blurTimer.current)` on unmount.

## [0.5.13] — 2026-09-21

- **AC1 — Run cost from the run record (wicked-crew#496, 2026-09-18).** Execute run rows (`CenterDashboard RunRow`) and the run identity strip (`RunTimes` in `WhatWhere`) now render cost from the DTO's `cost_usd` field only — never from `cliUsage` session fold. Three display shapes: a numeric `cost_usd` → formatted dollar chip (sub-cent shows `<$0.01`; `usage_seats_reported`/`usage_seats_unmetered` appended when present); `null` → "unmetered"; absent or non-finite → "cost not in run record" with `data-testid="run-cost-chip"` and a `title` citing crew#496 so operators know the daemon version that lands the field. The field is read as optional-unknown with no api-types bump.

- **AC2 — KPI spend tile reads DTO cost sums when present (#303).** `DeckKpiRibbon`'s spend tile now prefers DTO sums: when any non-archived live run carries a numeric `cost_usd`, the tile shows "Spend · runs" labeled from those sums; when no run has the field it falls back to the `observedSpend` session-fold labeled "Spend · session". The Burn tab is unchanged.

- **AC3 — Storyboard record button follows daemon status (#304).** `VideoStoryboard DemoSurface` now polls `GET /d/:doc/api/demo/status` on mount and on every folded frame (via `lastSignalAt`, which advances on each `wicked.interactive.*` frame the store ingests). `in_flight: true` → button is `data-state="recording"` + disabled + step label. A 409 `in_flight` answer from a local POST renders the bridge's `remedy` text verbatim (no retry suffix). A crew-triggered recording (no local POST) surfaces the same state. The `recordFromThread` call transitions through `data-state="queuing"` while the POST is pending.

- **AC4 — Provenance channel case-insensitive, and absence no longer reads as API (#303).** `store/provenance.ts` now accepts the daemon's lower-case channel set (`studio|cli|api`) case-insensitively. Rendered labels stay "via studio" / "via CLI" / "via API". Added `'CLI'` to the channel union. **User-visible copy change:** the provenance line's no-audit-entry branch (`ProvenanceLine.tsx`) now reads **"launch not recorded"** instead of "launched via API (actor unknown)" — wicked-crew#632 omits the channel and actor fields when it has none, so their absence means unknown rather than API, matching how an `unrecorded` channel already rendered.

- **The project management page is reachable again — Edit and Archive/Restore are no longer dead UI (#249, fixes #214).** `/projects/:id` was being redirected to `/p/:id` by `useLegacyRedirect`, so `ProjectDetailPage` — the only surface that owns Edit (rename/describe) and Archive/Restore (`ProjectDetailPage.tsx:190`/`:209` are the sole callers) — could not be reached by navigating the app, and operators could not archive or restore a project at all. (The page also carries repo attach/detach, but that one is shared rather than exclusive — the same `<ProjectRepositories>` renders on the `/p/:id` dashboard too, and a repo can be bound at registration from `/repos` — so it was never lost to the redirect.) The redirect arm is removed; `/projects/:id` now renders the management page. Archived project cards on `/projects` open it (where **Restore** lives) while active cards still open the `/p/:id` dashboard, and the dashboard gains a **Manage** link (`data-testid="dashboard-manage"`) carrying a real `/projects/:id` href, so it is keyboard-accessible and middle-clickable. This also **restores** `NewProjectModal`'s shipped intent: its "Empty" start has always been defined as `/projects/:id` ("Empty = its detail page", `NewProjectModal.tsx:33-38`, pinned by `tests/NewProjectModal.test.tsx:44`), which the redirect had been defeating. **Doctrine note:** `.product/DES-MERGE-001.md` §1.5 is amended in the same commit — `/projects/:id` is **not** retired; the shell (`/p/:id`, where work is seen and started) and the management page (`/projects/:id`, where the project is administered) are two overlapping surfaces accepted for now, and §1.1's "nothing produced" description of the page is footnoted as no longer true since #207.

- **Escalation gate: Retry / Request changes / Reject / Cancel run verbs (#299).** On every engine escalation gate — triage-escalated (`"Unit N failed and triage escalated"`), floor_failed (`"confirm to retry the phase, or reject to cancel the run"` with `repo_checks` denial), and verdict_not_pass (`"confirm to retry the phase, request changes …"` with `evaluator_verdict` denial) — the gate card replaces the standard Approve layout with four labelled actions: **Retry** (`confirmGate({approve:true})`); **Request changes** (`confirmGate({approve:false, action:'request_changes', amend})` — requires a note, disabled until the textarea has text); **Reject** (`confirmGate({approve:false})` — note optional); **Cancel run** (`cancelRun`). The deliver-unit escalation (`lift !== null`) keeps Retry / Reject / Cancel run (no Request changes, as rewinding to the creator cannot fix a git-push or rebase-conflict failure). Each verb carries its own `data-testid` (`steering-retry`, `steering-request-changes`, `steering-reject`, `steering-cancel`). The confirm line names all four: "Retry re-runs the failed unit · Request changes rewinds to the last creator phase (note required) · Reject cancels the run · Cancel run stops the run without a gate decision". Non-escalation gates keep the existing layout unchanged. `isEscalationGate` in `gateVerdictModel.ts` is the predicate; `isFailureEscalation` is unchanged, used only for the seat-reassign lever (F-7R2-007).

- **Deliver gate card: diffstat + full-diff expander (#300).** When the gate is on the deliver unit (`lift !== null`), the card fetches `GET /runs/:id/diff?base=merge-base` and renders a `<details>` summary (`data-testid="deliver-gate-diffstat"`) showing files-changed / +additions / −deletions and a "(diff truncated at 1 MB)" note when `truncated: true`. The raw unified diff is in `deliver-gate-full-diff`. If the request fails, the block is silently absent.

- **Delivered run: "Revise this PR" action in the Delivery panel (#301).** When a run is in `pr-open` state and the host provides `navigate`, a **Revise this PR** button (`data-testid="run-revise-pr"`) appears below the PR link. Clicking it calls `setRetryPrefill` with `revisesPr: {number, title, headRef}` (from the PR URL, session problem, and `run_branch`) and navigates to `/runs/new` — the Build composer prefills from the deposited shape. `retryOf` is `null` (this is a revision, not a retry). **Prefill disclosure:** the deposited `problem` is seeded from the run's own problem statement because the 0.7.38 daemon serves no PR-review-thread route — the prefilled intent is `"Revise PR #N (<headRef>): <session.problem>"`. When the run's event log holds a `gateEvaluated` event with an evaluator verdict (`evaluatorVerdict` wins) or denial reason, that text is appended after ` — ` as context for the revision run.

- **Tests: `tests/deliverLiftModel.test.ts` — 43 vitest unit tests for `src/components/deliverLiftModel.ts`** (the deliver phase's pre-push story fold: `deliverLift`, `liftOutcomeLabel`, `liftIsFailure`, `reverifyChangedTree`, `splitElided`/`ELISION_MARKER`, `textCarriesFailure`).

- **Tests: `tests/PLAN-run-lifecycle.md` + `tests/run-lifecycle.test.tsx` — a run-lifecycle test plan and 6 vitest gap tests for scenarios that were uncovered on main (#258).** The plan maps the run lifecycle across five UI surfaces (launch form, gate answering, archive/unarchive, project switcher, repo onboarding), marking every scenario covered / new / not-implemented. The tests close the genuinely uncovered cases: a failed `cancelRun` leaves the gate open with the daemon's error and does not call `onResolved` (GA-6); a rejected unarchive leaves the row visible, the silent-fail-by-design path (AU-4); toggling the Archived chip off hides the archived group while the normal list stays (AU-5); `Register & onboard` stays disabled until both repo fields are filled and enables once they are (RO-1/2/3); and `ambientProject` pre-binds **and locks** the register form's project field so clicking it does not open the dropdown (RO-6). Test-only — no `src/` change. The companion Playwright suite (LC-1…LC-5) is **not** included: it fails against current main and no CI job executes `e2e/*.py`, so it is tracked separately in **#312** and preserved on `archive/run-lifecycle-e2e-258`; the plan's Area 6 records those five scenarios as specified-but-not-implemented.

- **Continue in Build (#297): PR-safe headline, replied-only seats, first-gate posture, scoped navigation.** The "Continue in Build" bridge in GroupChat now derives the intent's first line from the first user question (≤ 72 chars, absolute paths redacted) with the transcript below a `---` separator (no more hardcoded copy preamble); carries only the seats that actually replied (not all warm seats); sets `humanConfirm: { before: 1 }` (first-gate by default); and navigates via `launchPath(ambient, 'build')` so a project-scoped chat lands inside its project shell.

- **CLIs chip row (#302): Document, Video, and Testing composers show disabled seat chips pending crew schema support.** `DocumentThread`, `DemoWizard`, and `TestingLaunchPanel` render the known roster as greyed-out CLIs chips with a one-line note; the chips become interactive once crew adds `clisJson` / a seat field to `InteractiveDocCreateRequest` / the demo create body / `TestingReconBody` / `TestingAuthorBody` (pending crew#631).

- **Run provenance survives page reload (#298): sessionStorage witness + forward-compat `detail.channel` read.** `markLaunchedHere` persists the studio-launch record to `sessionStorage` (survives same-session reload) in addition to the Zustand store; `deriveProvenance` reads `detail.channel` from the run record first (crew#632 — the daemon does not write it yet); until then a per-tab sessionStorage witness carries 'via studio' across a same-tab reload; a second tab or another browser still reads 'via API'; when neither the record nor the witness says anything the channel is reported as not recorded, never as 'API'.

## [0.5.12] — 2026-09-15
_Built against `wicked-crew-api-types` **0.38.0** (unchanged since 0.5.11)._

- **System seat cards: opencode provider login + Log out action (#293).** `not_required` seats that carry a `login_invocation` now offer provider **Sign in** (the `free_tier` note demoted to a small secondary line below the row); a new **Log out** action runs the command-in-terminal through the same terminal modal, with the logout line derived client-side from `login_invocation` (trailing `login`→`logout`, env prefix preserved; underivable ⇒ no button). UI-only — no new daemon route.

## [0.5.11] — 2026-09-14
_Built against `wicked-crew-api-types` **0.38.0** (unchanged since 0.5.10). FIX-IT-ALL wave 3 for the studio: #290 (L8 — escalation copy table, repo-check classification render, wire-fact readers, full-diff merge-base, one Send predicate, workflow round-trip, System auth rows) · #291 (L5 — the picker reads the daemon's `chat_admission`, an `ok` reply is the answer, Retry re-seats a refused seat). Bundled by wicked-crew 0.7.36._

- **Chat: an `ok` reply is the answer; the seat picker offers only the seats the daemon would seat; a refused seat gets Retry on the live chat (F-W1-004 / F-W1-005, wave-1 P6 gate; R-L5-2, R-L5-3).**
  - `finalizePending`: an `ok: true` `chatReply` IS the bubble (core-ts ≥ 0.7.27 makes `chatReply.text` the block after the seat's last tool call — the "Let me explore… Now let me read…" narration streamed as deltas and is not repeated); a NOT-ok reply (an eviction's budget sentence + partial) keeps `retainOnFinalize`'s longer-text rule, so nothing streamed before a cut is lost (E4). On an older engine the reply ⊇ the stream — unchanged.
  - [+ Add] and the default chips read the daemon's `chat_admission` verdict for the CURRENT scope mode (crew ≥ 0.7.36 `GET /roster`; the same predicate its `POST /chats` pre-filter runs — one source of truth, no client-side copy of the rule; the F-W1-003 decision lands in that verdict daemon-side). Seats the daemon would refuse are not offered; one line under the picker names them with the daemon's reason. A pristine selection re-seeds when the scope mode changes before the first send. Without the verdict (older daemon) the picker behaves as before: every seat offered, the incapable ones labeled "no chat config".
  - A failed seat chip on a live chat carries **Retry** → `POST /chats/:id/seats` (the engine's per-seat ensure in the recorded scope; same chat id, same pool key) — the chip folds the answer (ready / failed with the daemon's reason, narrated), a re-seated seat rejoins the next send's audience; a daemon without the route says so on the chip.

- **Escalation gates say what happened, from the engine's own class × denying layer (fixall L8-8E(i);
  crew #559 / F-RC1-047 = F-RC2-061; DES-L8 r2 §5 PR-8E).** One copy table (`denialCopy.ts
  escalationCopy(condition, denialSource, facts)`) shared by the narrator feed and the run timeline:
  `boundary_deny × {input_governance, ""}` (the hook-veto arm whose source the engine folds away) reads
  "a command was refused by governance: `<cmd>`" — a governance-refused `ls` no longer reads "tried to
  write outside its workspace"; `evaluator_mutated_worktree` branches on `restored` (restored + N paths
  discarded + the suggestion ref, or "could NOT be restored; inspect the worktree"); `dead_seat`,
  `floor_failed × {repo_checks, repo_checks_timeout, pinned_validator, substance, deliverables}`,
  `verdict_not_pass × {agent_validator, worker_failure, evaluator_verdict}` each have their sentence;
  `defGate` / `outputCaptured` become footnotes; an unknown pair keeps today's wording (nothing is
  guessed). `denialSourceLabel` learns `repo_checks_timeout`, `dead_seat`, `evaluator_verdict`.
- **Repository checks render the engine's head-vs-base classification (D3 of the benchmark review;
  api-types 0.38.0 `RepoCheckRun.classification/preExisting/regressions`).** `GateFloorCheck` carries
  the three fields; `checkOutcome` reads `regression` as "regression — N new failure(s)" (red) and
  `pre_existing_in_sandbox` (or the legacy `floor_env_mismatch`) as "failed on head AND base —
  pre-existing, not this change" (not red); a frame without the field reads exactly as before.
- **Wire facts that had no reader now render:** the unit header gains `discipline: <name> §<role>` from
  `unitDispatched.baseSkill`, with "discipline named only (not handed)" ONLY on `handed === false`
  (absent ⇒ unknown, core #479 / studio #275); `sandboxPosture` (F-E2E-039) and `worktreeRetained`
  (F-RC1-064) frames get timeline rows; the narrator reads the watchdog's `workerStalled.quietForMs`
  when `stalledSecs` is absent (no more "quiet for ?s") and narrates `workerStallEscalated` — "Needs
  you — worker silent N min — automatic recoveries spent" (studio #284 / F-BM-006, the minimal live
  render; the reload-safe needs-you card needs crew to persist the frames — coordinator to place).
- **Full diff asks for `base=merge-base` (fixall L8-8E(ii); studio #244; BC-54).** `api.getRunDiff`
  gains a third argument and the run page's Full-diff viewer sends it: committed + uncommitted run work
  vs the fork point, instead of the worktree vs HEAD (which showed only uncommitted files).
- **Send and its line agree by construction (fixall L8-8E(iii); F-089 = F-E2E-035, F-RC2-005/024/045).**
  The composer's "Ready / Not ready to send" prefix reads the SAME `canSubmit` predicate that disables
  the button. **"Revise PR #N" pre-fill** (DES-L9 §5): `RetryPrefill.revisesPr` deposits the PR; the
  body carries `revisesPr` ONLY when `GET /health.capabilities.revisesPr === true` (else the chip reads
  "this daemon cannot revise a PR — upgrade wicked-crew" and nothing is sent), with `deliver: 'pr'`.
- **Saving a workflow round-trips `skill_ref` / `allowed_skills` / `required_deliverables` /
  `validator_pin` (fixall L8-8E(iv); F-RC1-093).** One def→builder mapper (`builderPhaseOf`) feeds the
  editor and the JSON import; `buildDef` writes the four fields back verbatim instead of nulling them.
- **System reads seat standing off `auth`, offers Re-authenticate, and names the daemon's settings
  path (fixall L8-8E(v); F-E2E-040 = F-RC2-043, F-004/013/010, studio #280 item 4; BC-56).** Seat rows
  use the health rail's `seatStandingWord` fold (`signed_in` / `signed_out` / `not_required` (free tier)
  / `unknown`); a seat whose own stderr reported the failure (`auth_source: 'seat-stderr'`) reads
  "sign-in failed: <evidence>" and its button says **Re-authenticate**; the page shows `GET
  /settings.path` (crew 0.7.36) instead of a hard-coded home-relative literal, and says when the
  daemon does not report it.
- **Run clocks prefer the run's own record (crew #496 / studio #230; BC-52).** `runWhenWord` takes
  `AgentSession.created_at` (the sidebar and the command palette pass it); `runEndedWord` renders
  `ended_at` as "finished N ago" and `null` for an undated run — never derived from now.
- **Code Graph tile reads "150 of 5,470 shown" (crew #505 / F-RC1-100 / F-E2E-022; BC-53)** from
  `CodeGraphData.totals` when the daemon sends it; the slice alone on an older daemon.
- Housekeeping: the Testing page's gap hint drops the embedder clause (F-E2E housekeeping, `TestingPage`).

## [0.5.10] — 2026-09-15
_The published bundle is built against `wicked-crew-api-types` **0.38.0** — the exact
devDependency pin bumped from 0.37.0 in #283 (the wave-1 train's one api-types release; additive:
`ChatDetailResponse.messages`, `UnitDistributedEvent.distinctnessFallback`,
`GateEvaluatedEvent.evaluatorVerdict`, the skills `unchanged` / `claude-dispatch` / `baseSkill` shapes),
with both wire mirrors re-vendored from the published `index.d.ts`. FIX-IT-ALL wave 1 for the studio:
#283 · #285 · #286 · #287 · #288 — plus #273, #281 and #282, landed since 0.5.9. wicked-crew 0.7.35
bundles this dist as its default local skin._
### Added
- **Documents root control on the project dashboard (#279).** The one lever that isolates a project's documents — `interactiveRoot` — was API-only. The header's meta region now shows the project's binding (or "the daemon's default root — this project's own partition") with Set… / Change… / Clear, through the new `setProjectInteractiveRoot` (`api/wave6-wire.ts`) over crew's existing `PATCH /projects/:id {interactiveRoot}`; the daemon's refusal is shown at the control and the docs tile re-lists off the new root. The `default` project is read-only here (the route refuses it).
### Fixed
- **The "Capture learnings" card files its run under the ambient project (FIX-IT-ALL L4-⑩; F-RC1-049 /
  F-E2E-015).** From a project page the `capture-learnings` launch now carries `projectId:
  <ambient project>` on the existing `launchRun` wire (`LaunchRunBody.projectId`, api-types 0.38.0), so
  the run lands under `/p/<proj>/…` like every other launch from that page; from the flat `/repos`
  page no `projectId` is sent and the run stays Unfiled honestly (there is no repo→project map to
  guess from). The button title says "filed under the current project" when it applies.
- **Skills page: Publish re-reads the engine line, and an `unchanged` publish says so (fixall L6-4a; F-RC1-017 / crew#547 item 3; DES-L6 r2 §5 PR-L6-4).** After an applied Publish the page now calls `loadEngine()` explicitly: the catalog re-read refreshed the engine line only when it succeeded, so a failed re-read left "generation N" on the previous generation until a page reload. A publish that answers `unchanged: true` (api-types 0.38.0 — the daemon minted nothing because the tree hashes to the current generation) reads "Unchanged — generation N is still current (…); nothing was re-published." instead of announcing a new generation. The `claude-dispatch` portability copy (typed ahead of its detector in 0.38.0) is edited to the operator wording the design pins — "invokes a Claude-only tool (Task/Skill/AskUserQuestion) — a dispatch no other seat can follow" — not re-added (review-L8-283 N3).
- **Seatless-run failure card: headline truncated at `(Failed):` and "sign a seat in" remedy shown for tool-only failures (F-E2E-014, refs #272).**
  `cleanPrompt` split on the first `[`, which in a triage-escalation prompt is the opening bracket of the engine's cause — so the cause was demoted to the collapsed "why this gate fired" disclosure (starting mid-token, since `slice(bracketIdx + 1)` stripped the bracket) and the headline stopped at `(Failed):`. The `ReassignControl` lever rendered for any failure escalation regardless of `assigned_cli`, so a run that never had a seat was told to retry on another seat / sign one in.
  - `cleanPrompt` now keeps the leading `[` in the extracted footnote text (`slice(bracketIdx, …)` not `slice(bracketIdx + 1, …)`).
  - `SteeringGate` skips footnote extraction entirely for escalation prompts (`isFailureEscalation`): the full prompt — cause included — renders in the headline, which now carries `overflow-wrap: anywhere` so a long unbroken cause wraps instead of overflowing.
  - `isSeatFailure(escalation, failedCli)` (new predicate in `gateVerdictModel.ts`) gates `ReassignControl` in both `SteeringGate` and `CenterDashboard`: a PROVEN seatless escalation (`failedCli === null` — the unit is known and has no seat) renders no seat lever; a seat failure keeps the existing lever and Approve label unchanged; a host that cannot resolve the unit's seat (`failedSeatOf` → `undefined`: no `units` passed — the steering-author and testing-launch panels, the landing inbox before the run is loaded) keeps the lever as before, never reading "unknown" as "seatless" (#274, found by the independent review of the first cut).
- **Chat: the send targets the seat chips minus the seats refused at open, so an evicted seat is re-seated by the next message; `chatSeatRefused` renders; a rejoin replays the persisted transcript; a reply shows what it cost (DES-L5 wave 1 — studio#277 / F-RC1-114, studio#237 / F-RC1-115, F-RC1-111).**
  - `GroupChat` posts `targets` on every `POST /chats/:id/messages` (`client.ts` already accepted them): the header's seat chips minus `refusedRef` — the 201's `refused[]` + `ok: false` outcomes, `GET /chats/:id.refused` on a rejoin, and every `chatSeatRefused` frame. A seat the engine EVICTED (a turn over its budget, a dropped session) stays a greyed chip and, named in `targets`, is re-warmed by the engine on that send — was: the warm pool only, so an evicted seat never came back (P6: claude evicted twice, the chat quietly went on with one seat).
  - NEW `case 'chatSeatRefused'` in the frame switch: "not seated: <reason> (<source>)" as a fail-tone narration line with the seat chip, the chip greyed with the same reason, the seat out of the audience.
  - Rejoin replays `GET /chats/:id.messages` (api-types 0.38.0, crew ≥ 0.7.35) as bubbles — turn ordinals by first-seen `turnId`, the send counter continues — and the boundary note reads "Rejoined — N earlier messages restored"; a seat that spoke but is no longer warm keeps a failed chip wearing its last reason. An older daemon (field absent) keeps today's wording and an empty log.
  - `chatReply.usage` (additive; `null` on pi/agy) lands on the `SeatMsg` and renders as the bubble's footer (`12.3k in · 800 out · $0.04`; no `$` when `costUsd` is null; cache counts on the title). The composer carries the static budget copy once seats are warm ("Replies are budgeted per turn; …", no number — the engine's `WICKED_CHAT_TURN_SECS` is env-only).
- **Project dashboard DOCUMENTS tile stayed "0 — No documents yet" for any project without its own root binding (#233, F-048; DES-L7 §5 I3).**
  `ProjectDashboard` returned early from the `listDocs` effect when `interactiveRootOf(project)` was null — but the daemon resolves every project's root itself (the binding, else `WICKED_INTERACTIVE_ROOT`, else the project's own partition of the default root), so a default-partition project's documents were listed by the bridge and invisible on its page. The effect now waits only for the project row.
- **A recording that fails over the bus is now visible on the storyboard (#278, the live half).**
  `video-record-error` rendered only the POST's own catch; the thread store already folds the bridge's `status.posted {state:"error"}` into `lastError` (live over `/ws`, or hydrated from `GET /api/conversation` after a reload), and the storyboard never read it. `VideoStoryboard` now renders `lastError[key]` unconditionally beside the request error (same `data-testid="video-record-error"`, `data-source="thread"`), hidden only while a new attempt is in flight. The persistence half (the owning bridge writing the line) landed in interactive 0.9.3.
- Disclose `distinctnessFallback: 'creator_seat'` beside unit routing and in the run-head note, even when no seats were benched (#276). Include any degraded reason; older daemons with an absent or null fallback retain existing rendering.
### Security
- **site: patch Astro AVIF/SVG advisory chain (#227).** `site/package.json` lifts the Astro
  constraint from `^7.1.3` to `^7.2.8`; npm resolves to **7.3.2**, patching
  [GHSA-26w7-cxv4-gfx2](https://github.com/advisories/GHSA-26w7-cxv4-gfx2) (Astro < 7.2.8 Sharp/libheif
  AVIF RCE). The updated Astro tree also pulls **svgo 4.1.0**, patching
  [GHSA-w27v-7q3p-w38r](https://github.com/advisories/GHSA-w27v-7q3p-w38r) and
  [GHSA-4vpr-x523-8j87](https://github.com/advisories/GHSA-4vpr-x523-8j87) (svgo removeScripts
  SVG sanitisation bypasses). `npm audit` reports **0 vulnerabilities** after the update.

## [0.5.9] — 2026-09-13
_The published bundle is built against `wicked-crew-api-types` **0.37.0** — the exact
devDependency pin bumped from 0.36.0 in #270 (the deliver-gate wire: `HealthResponse.capabilities.deliverGate`,
`LaunchRunBody.deliverGate`, `AgentSession.auto_deliver`); this cut lands the Archive control (#268, the
harness-delivered fix for #219) and the composer's deliver-gate posture (#269, F-E2E-030)._
### Fixed
- **Archive control for terminal runs in the run header and on WorkPage rows (#219, refs #211).**
  Studio could *unarchive* a run (crew#265) but never *archive* one — `archiveRun(id, false)` was the
  wire's only caller, so a terminal run left the active work list only through the API and the
  seed-surfaces suite's RUN-ARC journey (#211) had to run `[SUBSTITUTE]`. The run header of every
  terminal run (`completed` / `failed` / `cancelled`, on both `/runs/:id` and `/p/:pid/build/:runId`)
  now carries **Archive** (`run-archive`) in the slot Cancel occupies on a live run: confirm-gated
  (`run-archive-confirm`, Yes / Keep, Escape = Keep), refusals surfaced inline as `role="alert"`
  (`run-archive-error`) with the confirm held open, and on success the run index refreshes and the
  view navigates back so the run leaves the list. Every terminal Work row — the Completed / Failed /
  Cancelled groups on the All tab and the filtered Completed / Failed / Cancelled tab views — gets
  an inline **Archive** button (`run-archive-row`) beside the run, the shipped Unarchive-row pattern;
  Active rows and live runs get nothing. Both paths `POST /runs/:id/archive {archived: true}`;
  Unarchive is unchanged.
  - *Review findings landed in-wave (independent review of #268, M-1 / L-1 / L-2):* this entry; the
    header offers no Archive on an already-archived run (`session.archived_at` set — reachable
    through the Archived chip), so there is nothing to re-archive; and the WorkPage tests now cover
    the filtered tab views and the Failed / Cancelled groups, not only Completed.
- **The composer promised a push with no gate (acceptance finding F-E2E-030).** Under the default
  "First gate" posture the deliver notice read "When this finishes it pushes its branch → opens a
  PR" — and that is exactly what run `0ab5ccb8` did, unattended. The engine now gates the deliver
  phase by default (wicked-core#456) and crew accepts `deliverGate: 'human' | 'auto'`
  (wicked-crew#543). The composer says WHEN the push happens: the default postures read "pauses
  at the deliver gate; approve it and the run pushes its branch → opens a PR on <repo>", the
  confirm line gains `deliver: after you approve the deliver gate` (`launch-confirm-deliver`), and
  the body sends NO opt-out. Only the explicitly unattended postures — Autonomous, or the gate
  option now labelled **"No gates · auto-deliver"** — send `deliverGate: 'auto'`, and their notice
  says "with NO deliver gate — this posture is auto-deliver". The intake plan's deliver row names
  the gate from `session.auto_deliver` ("human gate before it pushes its branch + opens the PR" /
  "auto-deliver — … no gate"; `intake-plan-deliver-gate`) and stays silent on an engine that
  predates the gate, so no promise is made that the engine cannot keep. The composer makes the
  same promise only when the DAEMON can keep it: it reads `GET /health.capabilities.deliverGate`
  (crew ≥ 0.7.33) and, against a daemon without it, says "this daemon delivers WITHOUT a deliver
  gate (upgrade crew to 0.7.33+ to confirm the push first)", offers no auto-deliver option and
  never sends `deliverGate` (the older launch schema rejects it). "No gates" is labelled
  auto-deliver only where the select is honoured (not in Ask mode, where every unit is gated).

### Changed
- **Pin `wicked-crew-api-types` 0.37.0** (the deliver-gate wire, crew#543) and re-vendor both wire
  mirrors from the installed `index.d.ts`. Built against api-types 0.37.0: `HealthResponse`
  (`GET /health`, previously undeclared) with `capabilities.deliverGate`, `LaunchRunBody.deliverGate:
  'human' | 'auto'`, and `AgentSession.auto_deliver` — the three shapes #269 hand-declared as
  "≥ 0.37" in `src/api/client.ts` (`getHealth`) and `src/api/types.ts` (`LaunchBodyWithDeliver`) now
  come from the package, and `tests/deliverGateWire.test.ts` pins them to the installed `index.d.ts`
  (compile-time `satisfies` + the declaration lines) so a pin that loses them fails the suite. 0.37.0
  is ADDITIVE and touches neither the skills block nor the wave-6 shapes: all 16 VERBATIM regions of
  `src/api/skills-wire.ts` (+ its fixture, now `tests/fixtures/api-types-0.37.0-skills.d.ts`;
  `index.d.ts:1995-2445` / `4720-4779`) and `src/api/wave6-wire.ts` are byte-identical to 0.36.0 and
  relabelled by line range only (+26 above the `LaunchRunBody` addition, +38 below it).

## [0.5.8] — 2026-09-12
_The published bundle is built against `wicked-crew-api-types` **0.36.0** — the exact
devDependency pin, unchanged from 0.5.7 (#264); this cut lands the fix that reads the `test_sets`
that wire actually declares (#266)._
### Fixed
- **The Test landing reads the daemon's top-level `test_sets` (api-types 0.36.0) — counts, PLAN and
  PR per produced set.** The 0.5.7 landing (`CampaignsPage`, the Home "Test" door, `campaignStats`)
  read a PROVISIONAL row-level `Campaign.test_set` / `RunGroup.test_set` join that 0.36.0 never
  declared, so against a 0.36.0 daemon no card showed a produced set. The daemon serves the sets as
  `CampaignsListResponse.test_sets: TestSet[]` (snake_case, `run_id`-keyed, tagged with the
  `qe-tests-<repo>` label an authoring run is filed under); `listCampaigns` now normalizes them
  (`testSets: null` = a pre-0.36 daemon — absence, never a fabricated zero), the store holds them,
  and the fold joins them onto each campaign / label-group card by `run_id` (and by label for a
  group). Each set renders its verified chip, `produced · executed · passed · failed` (plus
  "· N not executed" when the verify phase left tests unrun), the PLAN (opens the producing run)
  and the engine's PR (`isPrUrl`-gated); the Tests tile's context and the Home door append the
  registered sets once the wire carries them. The provisional join, its `testSetOf` row reader and
  the dead `POST /testing/recon` + `workflow` ladder rung (`qe-author-tests` shipped together with
  `POST /testing/author`, so no daemon lists the workflow without the route; 0.36.0's
  `TestingReconBody` declares no `workflow` key) are deleted — `tests/wave6Wire.test.ts` now guards
  that neither shape returns. Fixtures (`tests/fixtures/wave6.ts`, `e2e/uxfix_fixture.py`) serve the
  real 0.36.0 shape; the testid inventory gains `campaign-card-testset-{verified,pr,more}`.
  - *Review findings landed in-wave (independent review of #266, F-1..F-4, R2-1):* the Tests
    tile's context now LEADS with the sets word — painted as `1 set · 11/11 passed`, sized to clear
    the `…` glyph at 1440 px, with the unabridged `1 test set · 11/11 passed …` line as the span's
    hover `title` — the redundant "N ad-hoc group" word is gone, and every `StatTile` context
    carries its full text as `title` (`stat-context`; a `contextTitle` prop when the painted line
    is an abridgement); sets no card can show are said as `· N
    unattributed` and `test_sets` rows served without a `run_id` as `· N malformed` (never
    folded away — `listCampaigns` now returns `malformedTestSets`); a 0.36 daemon's real zero
    renders as `no test sets registered yet` on the tile and `N tests · 0 test sets` on the Home
    door, while a pre-0.36 daemon still says nothing about sets; the launch panel reads
    `/testing/author`'s `runs[].label` and says `filed under qe-tests-<repo> on the Test landing
    — the set fills in when the verify phase registers it` (`testing-launch-filed-label`) instead
    of "appears … when the run registers its test set". The Chrome rig asserts the sets word is
    VISIBLE (glyph box inside the context span), not merely present in `textContent`.

## [0.5.7] — 2026-09-11
_The published bundle is built against `wicked-crew-api-types` **0.36.0** — the exact
devDependency pin on this cut (#264), and the wire the bundle's mirrors and `satisfies` checks are
typed against: both wire mirrors (`src/api/skills-wire.ts`, `src/api/wave6-wire.ts`) are byte-pinned
to it. Two wire gaps (a row-level `Campaign.test_set` / `RunGroup.test_set` join;
`TestingReconBody.workflow`) stay studio-worded and test-guarded — see *Changed* below._
### Added
- **New test launches the governed `qe-author-tests` workflow; the Test landing shows the produced
  set; honest UNGATED / degraded gates; a files view once the worktree is gone** (wave 6 — the
  governed testing journey: acceptance findings F-075 / F-076 / F-7R2-003 / -005 / -006 / -008 /
  -009 / -010 / -011 / -012 / -013 / -014 / -017, studio half). Develops against a PROVISIONAL wire
  mirror (`src/api/wave6-wire.ts`) spelled exactly as the wave-6 briefs name the fields; every
  reader is null-safe, so an older daemon changes nothing. `tests/wave6Wire.test.ts` pins the
  posture: a pin bump to ≥ 0.36.0 without a VERBATIM re-vendor fails the suite (the #257 pattern).
  - *Routes* (F-075 / F-7R2-009): `/testing` and the retired `/testing/harness` land on the TEST
    landing (`/testing/campaigns`), as `src/api/testing.ts` documented all along; Evals keeps
    `/testing/evals` as a sub-page; the rail heading follows. Home's "Run recon" verb is now
    **New test** and opens the launch panel (`?new=test`). "Add with chat" on the landing is
    labelled **Add testing rules** — it authors testing STEERING RULES, not tests.
  - *New test is governed* (F-7R2-003 / -004 / -012): the panel reads `GET /workflows` on mount;
    a daemon that lists `qe-author-tests` gets the governed launch (the chip names the five
    phases: recon → author → verify → review → deliver — the ENGINE's deliver phase opens the PR,
    never the worker), and `launchGovernedTest` walks the wire ladder, each step only when the
    previous wire is ABSENT: `POST /testing/author` → `POST /testing/recon` + `workflow` (a strict
    schema naming it unrecognized ⇒) → one `POST /runs {workflow, repoRef, projectId,
    humanConfirm: 'before:1'[, groupLabel]}` per resolved repo. A daemon that lists no such
    workflow shows the honest banner **"this daemon has no governed test workflow — plain run"**
    BEFORE the launch and takes today's free-text recon. Every named refusal surfaces untouched.
  - *Project chips are droppable* (F-076 / F-7R2-010): "attach the project, drop repos". A
    narrowed project launches one `POST /runs` per remaining repo — `repoRef` scopes, `projectId`
    FILES — so an explicit single repo keeps its `project_id` (the pinned recon body's `projectId`
    would union the dropped members back in); the dropped line names them and offers "restore
    all"; every member dropped is refused on the button, before any wire call.
  - *After launch* (F-7R2-011): the panel LINKS every launched run (`testing-launch-fanout-run`,
    the single run too), names the workflow, the wire it rode (`testing-launch-route`) and the
    test/group label, then the waiting line; the intake gate arrives on the app's one /ws fold.
  - *The intake card shows the PLAN* (F-7R2-008): on the pre-run gate for the run's first unit —
    the panel's copy of the card and the run page's — `IntakePlan` lists every planned phase with
    its executor (agent / tool), skill, `writes code`, `evaluator ≠ creator`, and seat (the one
    routed, else "council picks from <pool>"), read once off `GET /runs/:id` when the gate arrives.
  - *The Test landing shows the produced set* (F-7R2-014): a card's `test_set` (the campaign
    registration a completed run lands) renders "N test files · T tests · E executed · P passed ·
    F failed" — the counts the VERIFY phase re-derived, with "K never executed" when
    `executed < tests` — plus the PLAN path; the workflow chip reads `qe-author-tests` off the live
    runs from launch. A pre-0.36 row renders no counts (absence, never a fabricated zero). The
    empty state says what fills it.
  - *Honest UNGATED gates* (F-7R2-005 / -017): `gateEvaluated.ungated` / `ungatedReason` win over
    the card's fold — the gate card reads **"UNGATED — no eligible judge seat"** (the floor that DID
    run is still listed; the judge axis is said not held), the run-page verdict card carries the
    same line, and the narrator says "Gate UNGATED on <phase> — <reason>; repository checks ran,
    no distinct judge" — never "Checks ran — pass" for a judge-less gate.
  - *Degraded councils* (F-7R2-006 / F-4R2-007): `unitDistributed.degradedReason` renders on the
    run head (`run-degraded`: "council degraded: 4 of 5 seats benched: …", with the affected-unit
    count) and on the routing line in the feed. The narrator now reads the camelCase
    `agreementPct` the engine actually emits (api-types ≤ 0.35.0 declared `agreement_pct`, which
    the wire never carried — so the pct was always missing); the snake_case read stays as the
    fallback until the 0.36.0 pin declares camelCase.
  - *The remote-write fence* (F-7R2-012): a `workerToolCallDenied` (a creator/evaluator seat's
    `git push` / `gh pr create` …) renders in the feed with the seat, role, the refused command as
    code and the remedy — the engine's, or "delivery is performed by the run's deliver phase".
  - *Files view once the worktree is gone* (F-7R2-013): `GET /runs/:id/diff` answering
    `source: "branch"` is labelled as the run branch vs its base (committed work shown; an empty
    branch says so); a pre-0.36 daemon's 409 cause card names the run branch and the upgrade. The
    run page's Files section offers **Full diff** on EVERY state — the empty one included, which
    was exactly the completed run with no files view.
  - Tests: the launch ladder (22), the panel (14), the gate model + cards (9), the narrator (13),
    the files view (6), the landing card (8), the run head (6), the mirror posture (7); the
    Playwright loopback rig `e2e/governed_testing_test.py` (fixture switch `governed_testing` /
    `governed_testing_workflow_absent`: GET /workflows, POST /testing/author + the intake gate
    over /ws, GET /campaigns with `test_set`, the completed run's degraded / UNGATED / refused-write
    trail, the branch-source diff) at 1440x700 and 400px; testid inventory regenerated. Wire gaps
    recorded for the crew PR: the recon body's `projectId` cannot express a narrowed project; the
    campaign registration shape (`test_set`) and the `/testing/author` route are provisional names.
  - *Pin*: `wicked-crew-api-types` **0.35.0** exact (crew#533 — published while this landed; 0.36.0,
    the wave-6 wire, was not). The skills mirror + `tests/fixtures/api-types-0.35.0-skills.d.ts` are
    re-vendored by label (the 0.34.0 skills and `diagnostics.skills` blocks are byte-identical in
    0.35.0, shifted to `index.d.ts:1768-2186` / `4223-4272`); two additive catch-ups — the Health
    rail names the widened `info` finding severity, the wave-2 fixture's `legacyOutbox` carries the
    new required `scope`. The wave-6 mirror stays PROVISIONAL under 0.35.0 (none of its names are
    declared there — `tests/wave6Wire.test.ts` asserts exactly that).
  - *Skills page recovery from `GET /skills` 503* (acceptance findings F-A45-001 HIGH / F-A45-002
    MEDIUM — the F-083 stale-rules refusal "current does not point at a valid published snapshot …
    re-publish or remove the link"). The unavailable card used to offer only Refresh (a second 503);
    the remedy the finding names was unreachable. It now carries the engine's word — `GET
    /diagnostics` → `skills.state` + every `findings[]` message (`skills-recovery-finding`) — and two
    controls with pending/result states: **Refresh baseline** (`POST /skills/refresh-baseline`) and
    **Publish** (`POST /skills/publish`). Every mutation is CAS-guarded by the revision the 503
    withholds, so the page learns it through `POST /skills/analyze` (the dry run reads the MANIFEST,
    not `current`) and says so when analyze 503s too (the manifest itself is unreadable — the
    daemon host's job). After a Refresh the baseline is STAGED and the catalog still answers 503
    until Publish: the result renders inline ("garden 12.33.0 staged (… taken · kept · added ·
    removed · conflicts) — publish to activate"), the engine line is re-read, the catalog is NOT
    (F-A45-002). A Publish that writes a snapshot re-reads the catalog and flips the page to the
    loaded state with the note; a blocked publish renders its findings on the card. A 409 says the
    catalog moved and re-learns the revision on the next click.
  - *One roster story on the composer and the rail* (F-A45-006 studio half). The composer's seat
    warning derived from the `signed_in` file/env heuristic alone, so it said "codex + opencode
    aren't signed in" while the Health rail — reading crew#533's `auth` / `council_eligible` /
    `free_tier` — showed opencode green "no sign-in needed". Both now read the rail's
    `seatStandingWord`: `auth: not_required` is never a sign-in problem, `auth: signed_out` warns
    even when the heuristic is null, a daemon-declared `council_eligible: false` gets its own
    sentence with the daemon's reason (`ineligible-warning`); a pre-0.35 roster keeps the heuristic.
  - *`/vibe` and the Home door count what the daemon serves — without spawning a bridge per project*
    (F-A45-008 MEDIUM, bounded by the independent review of #263, F-1/F-2). The corpus listed only
    "projects opened this session" (the docs cache's deposits), so a fresh browser on a daemon holding
    three documents read "DOCUMENTS 0" and Home said "Vibe 0 documents". A per-project docs GET
    (`GET /projects/:id/interactive/api/docs`, the only per-project route) MATERIALIZES the project's
    partition and cold-starts one `wicked-interactive` bridge (~60 s) — so NOTHING fans out on mount.
    The one request the corpus surfaces and Home make on their own is the CHEAP daemon-wide index
    `GET /interactive/docs` (api-types 0.36.0, the wave-6 crew PR — served from the state-home doc
    ledgers, no bridge; presence-checked: a pre-0.36 daemon answers 404 and the corpus stays "documents
    in opened projects (k of N)" — the honest word, never "all N projects" on the strength of unasked
    bridges). The per-project fan-out is the operator's explicit `[load for all projects]` gesture:
    SEQUENTIAL (one bridge at a time), the project being asked named in the progress line,
    cancellable (`cancel` stops after the current project answers; what landed stays). A project
    whose bridge cannot answer (503 `bridge_unavailable`) is recorded as UNREACHABLE with the daemon's
    sentence — the label reads "N projects · M unreachable", the count excludes it, the button stays
    live for it — never counted as "no documents". The per-project view is a FILTER chip (`All
    projects` / one per project with live counts), the CURRENT project — read off the router's
    pathname, so it follows navigation — first; with no project named the corpus is newest-first.
    Home's Vibe door says "N documents in opened projects" until a census (the index, or the gesture)
    has answered for every project. The docsCache header is amended accordingly.
  - *Independent review of #263 (REVISE → fixes, one bundled commit)*: F-1/F-2 above; F-3 the launch
    button is disabled ("resolving workflows…") while `GET /workflows` is pending — a click could
    launch a silent plain run — and a failed read shows the banner before enabling the plain run as
    an explicit choice; F-4 a NARROWED project launches through `POST /testing/author` (projectId +
    the exact `repoRefs`) when the daemon has it, the per-run `POST /runs` fan only as the
    route-absent fallback (recorded wire gap: that fan's `deliver: 'pr'` default appends a second
    deliver phase to a def that already ends in one); F-5 a PASS whose frame says `judgeCli: null`
    (the single-seat floor-only case) appends "no distinct judge reviewed this verdict (floor only)"
    on the gate card and "— no distinct judge" in the feed; F-6 the mirror-posture test also guards
    studio's own spellings (`test_set`, `testing/author`, `TestSetCounts`) and requires every wave-6
    declaration inside a VERBATIM region at the pin; F-7 the mirror's `workerToolCallDenied` carries
    `carrier` and `tool` (the feed names the tool); F-8 `ApiError.body` keeps a refusal's JSON, so a
    skills 409's `revision` is adopted and the next click needs no second analyze; F-9 the governed
    rig's drop-chip scene is real (the fixture project carries a `crew.repo` member); F-10 the fan
    note says "each pauses at its own intake gate; approve them one at a time"; F-11 the degraded
    count is distinct ords; F-12 the current project follows the router; F-13 the inventory scan
    has a 30 s budget. *r2 (APPROVE)*: R2-1 the `/testing/author` narrowing is stated as a
    REQUIREMENT on the crew PR (projectId = filing, repoRefs = the exact scope — not the recon
    route's union) and guarded — an answer with more `runIds` than requested repos renders "the
    daemon launched N runs for M requested repositories — it did not honour the narrowed scope"
    (`testing-launch-scope-note`) and the scope is never claimed; R2-2 the Vibe tile title follows
    the census word; R2-3 the fixture answers the daemon-wide index with Fastify's bare `Not Found`
    so the rig exercises the presence-check's `absent` branch; R2-4 the gesture never falls back
    to "all" silently — "every project is already listed — reload" when nothing is unknown.
  - Tests: `SkillsPage.recovery` (9), `ChatInput.seatStanding` (5), `MadeDashboard.corpus` (12 — no
    fan-out on mount, the index, the sequential + cancellable gesture, unreachable bridges); the
    `/vibe` + Home loopback rig `e2e/vibe_corpus_test.py` (4/4 steps — the fresh page asks no bridge
    beyond the board model's rooted reads, the gesture never has two docs GETs in flight); both rigs
    accept `PLAYWRIGHT_CHANNEL` (e.g. `chrome`) to run on an installed browser when the Playwright
    cache is absent (review R2-6 — a rig never installs anything); testid inventory regenerated.

### Changed
- **Pin `wicked-crew-api-types` 0.36.0** (the wave-6 wire, crew#536; `skills.stale-rules`, crew#535) and
  re-vendor BOTH wire mirrors from the installed `index.d.ts`. The skills mirror + fixture
  (`tests/fixtures/api-types-0.36.0-skills.d.ts`, `index.d.ts:1969-2419` / `4682-4741`) carry the
  ADDITIVE block: `SkillsManifestResponse.current.rules` / `drift`, `PortabilityRulesIdentity`,
  `SnapshotRowDrift`, the `skills.stale-rules` finding kind. The wave-6 mirror (`src/api/wave6-wire.ts`)
  drops its PROVISIONAL declarations for 14 VERBATIM regions byte-pinned by `tests/wave6Wire.test.ts`
  against the installed package: `POST /testing/author` (`TestingAuthorBody` / `TestingAuthorResponse`
  with `runs[]`, `plan`, `gate`, `scope`; the registered `TestSet`), `CampaignsListResponse.test_sets`,
  `RunDiff.source` / `branch` / `base`, `gateEvaluated.ungated` / `ungatedReason` / `floorNote` /
  `judgeSkippedReason`, `repoChecksEvaluated.sandboxLevel` / `sandboxError` / `detectError`,
  `unitDistributed` camelCase (`seatConstraint` included), `workerToolCallDenied` (`carrier` / `role` /
  `tool`), the `acpFallback` auth kinds, `runBaseResolved.runBranch`, the roster's `auth` /
  `auth_source` / `free_tier_source` / `council_eligible` / `council_bench`, chat `refused[]`, the
  `GET /interactive/docs` rows. The `unitDistributed` snake_case fallbacks (`agreement_pct`,
  `degraded_reason`) are dropped — 0.36.0 declares them `@deprecated`; the engine never emitted them.
  Two WIRE GAPS stay studio-worded and test-guarded: a row-level `Campaign.test_set` /
  `RunGroup.test_set` join (0.36.0 serves the sets as top-level `test_sets: TestSet[]`, so the Test
  landing's per-card counts render only when a daemon joins the row) and `TestingReconBody.workflow`
  (the launch ladder's middle rung; a 0.36.0 daemon answers the first rung, `POST /testing/author`).

## [0.5.6] — 2026-09-11
_The published bundle is built against `wicked-crew-api-types` **0.34.0** — the exact
devDependency pin on this cut, and the wire the bundle's mirrors and `satisfies` checks are typed
against. The crew#533 roster fields named below (`auth` / `free_tier` / `council_eligible` /
`council_ineligible_reason`, api-types 0.35.0) are read defensively when a daemon sends them;
the pin itself moves in a later release._
### Added
- **Reassign to <seat> + retry on a failure-escalation gate** (phase7-r2 acceptance finding
  F-7R2-007, HIGH). At every "Unit N failed and triage escalated" gate the card offered Approve — a
  retry on the SAME dead seat — Approve + steer, Reject and Cancel; recovery was
  `POST /api/v1/runs/:id/reassign {cli}` by hand, five times, racing the re-dispatch window. Both
  gate cards (the run page's `SteeringGate`, the landing inbox's card) now carry `ReassignControl`:
  the run's OTHER seats (`session.clis` minus the seat that failed the unit) with the roster's word
  on each — signed-in first, a seat with no sign-in observed hedged as "may fail or be benched"
  (today's roster carries no council-eligibility field; crew#533's `auth` / `council_eligible` /
  `council_ineligible_reason` / `free_tier` are read when a daemon sends them — `seatStanding`),
  inactive last, daemon-declared ineligible after that — and one action that approves the retry
  (the steer text rides it), waits for the run to resume (`GET /runs/:id` until `executing`, 30 s
  bounded — the daemon reassigns only an executing run), then calls the existing
  `POST /runs/:id/reassign {cli}` (`api.reassignRun`). Every step is stated
  (`steering-reassign-status`); a refused reassign leaves the approve standing, shows the daemon's
  sentence and offers the reassign alone again. Plain Approve is relabelled "Approve (retry on
  <seat>)" on that gate. A host without the run view (the steering-author and testing-launch panels)
  reads the run once for its pool on a failure escalation only. Recorded on the steering timeline as
  `reassign`. (Wire gap, recorded: the reassign route refuses an `awaiting_human` run, so the approve
  must precede it.)
- **The wicked-core#431 wire on the gate, the delivery card, the run head and the feed** (#250/#431
  consumer follow-through — pins `wicked-crew-api-types` 0.33.0, the wire wicked-crew#527 publishes).
  Every field is read off the frames the daemon sends and rendered only when present, so an older
  daemon changes nothing.
  - *Gate card — the judge seat* (`gateEvaluated.judgeCli` / `judgeDistinct`): the verdict header
    names WHO judged (`· judge: codex`); `judgeDistinct: false` adds a same-seat warning — the judge
    fell back to the single default runner, so evaluator ≠ creator is not held on that verdict.
  - *Denial card — the restored tree* (`evaluatorMutatedWorktree.restored` + `worktreeRestored`):
    a worktree-guard denial the engine already remedied says "the evaluator's edit was discarded and
    the creator's verified tree restored", lists the discarded paths from the restore record, and
    gives `git show refs/wicked/suggestions/<run>/<ord>/<attempt>` as copyable code — with a real,
    keyboard-reachable **copy** button beside it — when the edit was pinned (an honest "not pinned"
    otherwise). **Approve is relabelled "Retry against the restored tree"** (and "Retry + steer") on
    exactly that gate, on the run page's gate card AND the landing inbox's card, from one predicate
    that mirrors the engine's own guard (`denial.source === 'worktree_guard'` and `restored`) — keyed
    on the evidence frames, not on the prompt, which the engine also changed ("confirm to retry the phase" → "Approve to retry the phase
    against the restored tree"; the card's NOT PASS match holds for both spellings). A failed
    restore (`restored: false`) is said, with the engine's error, and the manual remedy stands.
  - *Delivery card / deliver gate — the lift* (`deliverLiftEvaluated`, the deliver ord's
    `repoChecksEvaluated`, the deliver unit's `deliver:` refusal): the rail's Delivery body and a
    gate opened on the deliver unit render what the pre-push lift did — `unchanged` / `lifted`
    (base and tree before → after, the re-verify per check with the forced-install source
    `package-lock.json (forced: lockfile drift)`) / `conflict` (the files, "nothing was rebased and
    nothing was pushed", the LIFT-CONFLICT remedy) / `skipped` / `failed` — and the engine's
    refusal as the wire carries it (`stepFailed.detail` is a head+tail excerpt; the elision marker
    renders dimmed between the kept words), once: the gate card omits its copy when the engine's
    triage-escalate prompt already quotes it, the rail when the rejected unit's framed
    `denial_reason` does. A red check exposes its recorded `stderr` / `stdout` tail (`RepoCheckRun`,
    declared since 0.31.0) as a collapsed, monospace, phone-width-wrapping block — on the deliver
    lift and on the gate card's floor. A deliver unit refused BEFORE the lift (a `HEAD` off the run branch)
    has no lift frame and renders its `deliver:` text on its own; a `passed: false` re-verify over
    all-green rows is explained as the checks having CHANGED the worktree.
  - *Run head / timeline — the base* (`runBaseResolved`): a `base` row on the run's context card and
    a `based on` head row on the evidence timeline — "origin/main @ f57069d · 5 behind · lifted to
    the tip" — plus timeline rows and detail panels for the restore, the lift and a refused write.
  - *Feed*: narration lines for the run base, the creator-tree restore, each lift outcome, a refused
    write-class tool call (`evaluatorToolCallDenied`) and the one deliberate ACP reroute
    (`acpFallback.fallbackKind: 'read_only_requires_wrapped'` — routing, not a failure); every other
    `acpFallback` kind stays silent as before.
  - Tests: unit suites over synthetic frames in the wire's exact spelling (`tests/fixtures/wire433.ts`,
    mirroring wicked-crew's wire-contract literals) for each surface — every frame declared `satisfies`
    its 0.33.0 named type, and `tests/wire433.shapes.test.ts` re-derives the key-set and union diff
    against the installed `index.d.ts` at run time; the deliver fixtures carry what the WIRE carries
    (`stepFailed.detail` as the engine's 150/250 head+tail excerpt, the triage-escalate prompt quoting
    the 450/750 excerpt, `denial_reason` framed as `Worker FAILED on unit N …`); the loopback rig
    `e2e/wire433_test.py` (fixture switch `wire433`) drives the three surfaces in a real browser.

### Changed
- **Skills page: a badge per KIND of portability reason, and the claude-only KPI split** (#256,
  F-079 — pins `wicked-crew-api-types` 0.34.0, whose additive `SkillEntry.portability`
  `{portable, reasons[], evidence?[]}` is the publisher's per-reason verdict, crew#531). The one
  `claude-only` badge lumped "the author used a Claude-only path" together with "this skill needs
  the Claude harness" and hid the fix. Now any AUTHORING reason (`plugin-root`, `skill-dir-var`,
  `cwd-script`, `relative-link`, `cross-skill-path`) renders **not portable**
  (`skills-not-portable-badge`; the hover title lists the reasons and the first `file:line`
  anchor, and is the badge's accessible name) while `requires-harness:claude` alone renders
  **needs Claude harness** (`skills-needs-claude-badge`; title = the reason). The wrapper keeps
  `skills-claude-only-badge` for one release so existing selectors resolve; a daemon that predates
  the field (no `portability`) falls back to `portable` alone — the generic **not portable** badge
  with the previous sentence, never a fabricated reason. The Portable tile's context reads
  `N not portable · M need Claude harness` (the value stays the portable count); the chips
  `not-portable` + `needs-claude` replace `claude-only`; the drawer gains a **Portability** line —
  every reason with one clause of "why", and every `file:line` anchor as monospace text that wraps
  at phone width. `skillCounts` gains `notPortable` / `needsClaude` (`portable + notPortable +
  needsClaude === total`). The wire mirror (`src/api/skills-wire.ts`) and its parity fixture move
  to the 0.34.0 block (picking up the 0.29.0 `installer-copy` source kind and the `skills.source` /
  `skills.manifest` diagnostics findings the 0.27.0 mirror lagged). The Reach KPI group is as wide
  as the two-tile groups so the context line never ellipsizes, the badge's ink is `--ink-high` on the
  amber fill so it reads in both themes, and the page header + verbs wrap at phone width. Review
  follow-through: a `non-portable` analyze/publish finding wears its `portabilityReason` as a chip
  (hover = the reason's one clause), and a `portability` verdict that disagrees with `portable` is
  named — `data-contradiction` on the row and badge, a hint line in the drawer — never swallowed and
  never a different badge (`portable` stays the admission key).

### Fixed
- **Document thread hardening** (phase4-r2 acceptance findings F-4R2-003 / -005 / -006 / -014 / -016).
  - *Export bar — readiness per format* (F-4R2-016): `ExportMenu` looked up the FIRST ready answer for
    the version, so an un-consumed HTML download shadowed the PDF that finished after it — the PDF
    button spun for 120 s while the file already sat in the thread. Each format button now asks for
    its own (version, format) answer and flips the moment its own reply lands. The bridge's additive
    layout report (wicked-interactive#219: `layout`, `layout_source`, `page_size`, `pages`) is read
    null-safely off the export response AND the `export.generated` echo and rendered where present —
    "PDF ready — 2 pages · A4 portrait" under the row, on the anchor's hover text, and on the thread
    line; an older bridge that sends none of it changes nothing.
  - *Heartbeat narration* (F-4R2-005): crew's seams re-emit the current phase's line every ≤15 s, so
    one draft read as 39 narration rows ("Crew phase 2/3: writing the draft (draft)…" ×16). A repeat
    of the NEWEST narration now folds into it — one row, a repeat count and a span that ticks live
    while the thread generates — live and on the restored transcript alike. The same words after
    another line are a new phase, not a fold. (Keying narration on the unit ord needs the wire: the
    seams' `status.posted` frames carry no `unit_ord` / `run_id` — recorded as a crew wire gap.)
  - *Reload mid-run* (F-4R2-006): the composer read `terminal` for up to one heartbeat interval over
    an executing run, because neither the frames nor the announce history carry a run id. On doc open
    the thread now reads `GET /runs` once and adopts the run whose declared write root names the doc
    (`interactive-drafts/<doc>`, `interactive-chats/<doc>-m-…`, `interactive-edits/<doc>-v…`,
    `interactive-demos/<doc>`): a LIVE run flips the composer to `generating` with one honest line
    ("Still in progress — a governed run picked this up before the page reloaded and is executing
    now" — or "…is waiting at a gate" for a run parked at a human gate) and an "open run" link on the
    chip; the run's lifecycle frame ends the live state if the seam's terminal frame never reaches
    the thread.
  - *Deliverable-floor failure, for a human* (F-4R2-014): the crew seams' "The crew run answering
    your ask failed (run …). Reason: [wicked-crew] deliverable floor: … EXPECTED: /abs/path … Inspect
    it via the crew API (GET …)" line rendered verbatim in the document chat. It is now a card: one
    sentence derived from the floor's own EXPECTED path ("The revise step produced no file, so this
    turn did not land — nothing changed in your document"), a link to the run page, a **Retry** on the
    wire that failed — a chat ask re-posts as a chat ask (`doc-actionable-retry[data-kind=resend]`),
    an edit batch re-posts as a batch on the same anchors when the thread still holds its items
    (`data-kind=resend-batch`), and a draft or demo spec — which no message can re-send — gets the way
    back said instead (`doc-run-failed-wayback`) — and the raw dump — absolute paths, issue ids, the
    API URL — whole behind a collapsed "details" fold. All four crew seams' sentences parse, the demo
    seam's "authoring this demo's spec" included. The head send resolves as answered when its run
    fails (one retry, on the card — never a second "send failed · retry" chip on the bubble). The
    failure itself is unchanged: the floor did its job.
  - *Document name before Create* (F-4R2-003): the launch composer shows the id the bridge will mint
    (its own slug of the quoted name or the brief's first six words), live and editable, so a 409
    "doc already exists" is preventable; when one still happens the copy names the colliding document
    with a link ("open it") and offers "use a different name" inline (the next free-looking name in
    the field), with the daemon's own sentence kept, dimmed.
  - Tests: `runFailure`, `runBinding`, `docThread.collapse`, `exportReport` unit suites; the
    `DocumentThread.runFailed` / `DocumentThread.name` component suites; `ExportMenu` gains the
    two-formats case; the loopback rig `e2e/ux5_document_hardening_test.py` (fixture switches
    `export_report`, `doc_fail_floor`, `doc_heartbeat_ms`, `doc_bound_run`, `create_409_existing`)
    drives the export chip, the failure card's Retry, the folded heartbeat, the reload restore and
    the 409 way-out in a real browser.
- **Repo readiness honesty + the project graph control** (phase2-r2 acceptance findings F-2R2-003 /
  -004 / -008 / -009).
  - */repos KPIs and card status* (F-2R2-003): "GRAPHS READY 9 of 9 · INDEX GAPS 0" and "graph ready —
    onboard completed" over two repos whose engine findings said no live graph existed. The graph story
    is now the run history CORRECTED by `RepoEntry.findings` (wicked-core#406): a repo whose finding
    names the re-onboard remedy (`in_tree_code_graph_ignored`, no live graph) or `code_graph_root_
    unresolvable` reads **"graph missing — re-run onboarding"** (`repo-graph-state[data-state=missing]`),
    is excluded from Graphs ready, counted on Index gaps ("2 graph missing · …"), and gets its own
    `Graph missing` filter chip; tooltips say what the reading derives from.
  - *Project dashboard REPOSITORIES rows* (F-2R2-004): the `project-repo-findings` mount existed but
    the row's registry lookup stayed undefined until the attach picker's gesture warmed the repo
    cache. A project WITH repo members now warms the one session cache on mount (still at most one
    `GET /repos` per session), so rows show the finding and **Re-run onboarding**.
  - *Build project graph* (F-2R2-008, studio half): a new `ProjectGraphAction` calls crew's existing
    `POST /api/v1/projects/:id/graph/refresh` (`api.refreshProjectGraph`; standing from the new
    `api.getProjectGraph`, `GET /projects/:id/graph`) with honest state — the build is synchronous on
    the daemon and says so ("Building… indexing 9 repositories — this can take a few minutes"), the
    result is the daemon's indexed / skipped / failed labels. On the project dashboard (standing +
    control, hidden on a daemon without the route) and on the chat scope card for a project scope
    whose reason names an unbuilt graph (the result says it grounds NEW chats — the open chat keeps
    the scope it opened with). The scope card's reason is now customer copy: the raw `POST …`
    sentence is dropped, "repo-less" is said only when the scope names no repository, the daemon's
    own words stay (raw sentence on hover).
  - *Health rail seat rows* (F-2R2-009): an active seat with `signed_in: false` wore a green ✓ and
    "active · signed out" as if nothing followed. It now wears the amber `!` and says **"signed out —
    councils may bench this seat"** (`rail-seat-row[data-signed-in][data-standing]`) — hedged, because
    today's roster (api-types 0.33.0) carries no eligibility field and the rig saw a "signed out" seat
    answer on its free tier — with the free-tier possibility on hover; the heuristic is never folded
    into the heart. When a daemon sends crew#533's `auth` / `free_tier` / `council_eligible` /
    `council_ineligible_reason` (api-types 0.35.0) the row believes those instead ("no sign-in needed
    (<tier>)" with a ✓, "not council-eligible — <the daemon's reason>", "signed out — still
    council-eligible"), and only a daemon-declared ineligibility degrades the heart.
  - Tests: `RepositoriesPanel.graphMissing`, `ProjectRepositories.findings`, `ProjectGraphAction`,
    `GroupChat.graphBuild`, `HealthRailSection.signin`, `ProjectDashboard.graph`.
- **The gate card's verdict block is about THIS gate's unit** (F-7R2-018): on an escalation gate
  about unit N the block rendered the LAST `gateEvaluated` at or below N — unit N−1's vacuous pass
  under a card about the unit that failed. `gateVerdictFor` keys an escalation gate ("Unit N failed
  and triage escalated" / "Unit N verdict is NOT PASS") on unit N's own evaluation AND its latest
  attempt (the last `unitDispatched` for N — an earlier attempt's denial is not this gate's) and
  renders no block when there is none; a pre-run gate keeps the previous phase's verdict
  (F-3R2-006). The block carries `data-phase-attempt`.
- **Narration never says "Checks ran" without a floor** (F-7R2-017): a `gateEvaluated` with
  `hasDeterministicFloor: false` reads "Gate passed without checks on <phase> (ungated)" (no judge,
  no policy), "Judge passed <phase> — no repository checks ran", or "Evaluator policy passed …";
  a denial without a floor reads "Gate denied on <phase>: … — no repository checks ran". A frame
  without the field (an older engine) keeps the legacy wording.
- Tests: `gateVerdictModel.escalation`, `SteeringGate.reassign`, `CenterDashboard.reassign`;
  `narrator.test` gains the floor/no-floor cases.

## [0.5.5] — 2026-09-11
### Added
- **Wave-2 consumers: the repo card renders the engine's findings, the Health rail renders
  `diagnostics.governance`, and New Chat carries a scope control** (#251, #246, #248 — pins
  `wicked-crew-api-types` 0.32.0, the wave-2 crew release).
  - *Repo findings* (#251, wicked-core#406 via crew#517): `RepoEntry.findings[]` renders on the
    Repositories fleet card, the repo detail header and the project page's repo rows — one labelled
    row per finding with the engine's own message. An in-tree `.codegraph/` beside a live graph is a
    tidy-up warning; an in-tree graph with NO live graph (the F-024 checkouts after the upgrade) is an
    error whose row carries **Re-run onboarding**, wired to each surface's existing onboard trigger
    (`POST /repos/:id/onboard`); `code_graph_root_unresolvable` is an error naming the daemon-
    environment fault. Silent for a clean checkout and for a daemon that predates the field.
  - *Governance in Health* (#246, crew#495 / F-022): expanding the rail's Health section also reads
    `GET /diagnostics` and renders the `governance` block — the store path and which rule chose it,
    the record counts (an honest "engine cannot count" for `null`, never 0), the dead-letter fold
    (count as a floor when truncated, by type / by reason, the timestamp range, the outbox, the
    pre-fix HOME outbox) and every finding as a severity-styled row whose message carries the
    `wicked-crew governance replay …` recipe. A `store: null` boot and any error finding turn the
    heart red (and show the collapsed-header dot) and degrade the home board's **Governed** tile
    (fail-coloured, the reason underneath — never a clean percentage over evidence that is not
    landing); a warning degrades the heart to amber. A daemon without the block, or without the
    route, reads "not reported by this daemon".
  - *Scoped New Chat* (#248, crew#502 / F-067): the create window carries a **Scope** control —
    *All project repos* (the default once a project is bound: `projectId` alone rides the open and
    the daemon scopes to every `crew.repo` member), *Choose repos…* (a multi-select from
    `GET /repos`, loaded on that gesture; sends `repoRefs` by id) and *Unscoped* (an explicit click).
    An Unfiled chat with no choice does not open on send — the gap is stated on the row, nothing is
    posted, the draft stays. A scoped open with the default (untouched) seat chips omits `clis`, so
    the daemon admits only governed seats and the 201 re-seeds the chips; an edited selection rides
    as asked and refused seats say why. The opened chat states `ChatOpenResponse.scope` under the header: the
    repositories (names; paths on hover), read-only, whether a code graph grounds the seats and the
    daemon's reason when not, and any project member the registry no longer knows; a rejoin states
    `ChatDetailResponse.scope`, and a daemon that said nothing is reported as "not stated". The
    route's refusals render as inline sentences by status — 404 (every missing ref named), 400
    (an ambiguous name → name it by id), 409 (a daemon-side conflict), 501 (the engine predates chat
    scope, with a **Continue unscoped** fallback that mints a fresh unscoped chat outside the shell).

### Fixed
- **Gate cards state the evaluator verdict they are asking about** (#250, acceptance finding
  F-3R2-006 — the UI half of wicked-core F-036/F-039). The verify pre-run gate ("Approve unit 4
  before it runs") and the deliver gate showed only their prompt while the `fix` phase's PASS —
  criterion, deterministic floor, the judge's reasoning — sat in the already-hydrated event log;
  the DENIED gate said "Unit 4 verdict is NOT PASS — confirm to retry…" while the reason
  (evaluator≠creator, the changed path, the restore command) was only in an expandable thread
  line. `SteeringGate` now renders a `gate-verdict` block from the run's own `gateEvaluated` (the
  last one at or below the gate's ord), with the F-039 `repoChecksEvaluated` floor per check
  (name · exit code · duration · manifest source, plus what was skipped) and the F-036
  `evaluatorMutatedWorktree` record (seat, phase, changed paths, tree ids) attached from the SAME
  fold — a retry's verdict never inherits the previous attempt's evidence. A denial names the
  layer (`denial.source`: worktree guard, repository checks, …) and quotes the engine's reason
  verbatim, backticked commands rendered as copyable code. An ungated phase is labelled a
  default-allow, never a pass (FINDING-025); no evaluation yet ⇒ no block, never a verdict
  fabricated from the prompt. Zero new requests. `wicked-crew-api-types` 0.30.0 → 0.31.0
  (purely additive: `UnitDenial`, `GateEvaluatedEvent.denial`, `RepoChecksEvaluatedEvent`,
  `EvaluatorMutatedWorktreeEvent`). The judge SEAT is not on this wire, so the card claims none.
- **The landing's delivery strip no longer counts onboarding runs as "Vacuous — needs retry"**
  (#250, F-3R2-018). The daemon stamps `delivery: 'vacuous'` on every completed repo-scoped run
  whose worktree is untouched — the DESIGNED outcome of `onboarding` and the other system
  workflows — so a fresh install read "9 Vacuous — needs retry" and buried the one real signal.
  `deliveryCounts` (shared by the strip and the KPI ribbon's Review tile) now licenses the
  vacuous bucket with the Delivery section's own `canDeliver` rule — a deliver unit on the run, or
  a workflow positively known not to be a system one (`is_system`, the one budgeted
  `GET /workflows`) — and the cell reads "Vacuous — no change to deliver": the condition, not a
  prescription. The licence can only withhold a count, never invent one.
- **`.codegraph/estate.db` is no longer tracked** (#220). A fresh clone shipped the operator repo's code-graph
  identity, so onboarding the clone failed with `REPO COLLISION` (and an older wicked-core wrote into the
  tracked file); the graph is per-checkout, built by `wicked-estate index` under the daemon state home
  (wicked-core#406). The file is untracked (local copies are left on disk) and `.codegraph/` is ignored.

## [0.5.4] — 2026-09-10

### Fixed
- **Document thread — bare status frames file under the doc's MOUNTED thread (acceptance finding
  F-045, belt and braces).** Crew's own interactive seams narrated their governed runs with
  `document_id` alone, so every heartbeat was filed under the Unfiled mount while the project-bound
  thread heard nothing and, 90 s into a live run, showed "no worker has picked this up — the
  generation service may be down" with a Retry that would have injected a duplicate. Crew now stamps
  `project_id` on every seam emit (wicked-crew, F-045); independently, `docThread.ingest` files a
  frame that names a doc but no project under the project a `DocumentThread` is currently MOUNTED for
  that doc (`bindDoc`/`unbindDoc`, registered by the component — never inferred from retained
  history, which a previous same-slug thread would poison). The composer claims the doc for its
  project the moment the create is SENT — under the bridge's CANONICAL id (`docSlug`, the bridge's
  own `DOC_NAME` + `slugify` rule replicated byte for byte and pinned against observed ids), which
  is what every frame carries — as a pending binding the mounting thread adopts (released on a
  refused create), so a frame that beats the bridge's answer files on the project thread; a frame
  with no binding at all is HELD and released exactly once onto the thread that binds, expiring to
  Unfiled only when nothing is bound for 10 s (never while a pending create or an ambiguous pair
  is open; an unmount that leaves one thread releases the held frames to it). The stall banner
  therefore appears only after a genuine 90 s silence.

### Added
- **Launch composer — what the document (or demo) is ABOUT and in what format (F-046, studio half).**
  `DocSubjectPicker` offers the project's `crew.repo` members by name as toggles on BOTH the Document
  and the Video launch composer (sent on the create as `repo_refs`; crew validates them against the
  project and grounds the governed draft/demo run on THOSE repositories instead of the project's first
  member — the demo wizard carries them through `demoDraftBody`) and the bridge's four formats on
  both composers (sent as `style`, the demo flow included; "from the brief" sends nothing and lets
  crew infer it from the brief's format words, so a print/A4 brief reaches the bridge's print
  instructions). Discovery has visible
  loading / error states with a retry: the composer refuses to submit while the repositories are
  unknown, unless the user explicitly chooses to create without repository grounding — which the
  thread then records. The picks reset when the launch context changes and after a create.
- **Create body typed from the shared wire declaration.** `CreateDocBody` is now
  `wicked-crew-api-types` 0.30.0's `InteractiveDocCreateRequest` (and `DemoStepDraft` its
  `InteractiveDemoStepDraft`) — no local mirror to drift. `wicked-crew-api-types` is pinned to
  `0.30.0` exactly; the package publishes from wicked-crew on the F-045/F-046 merge.

## [0.5.3] — 2026-09-10

### Fixed
- **Launch composer: a multi-repo project must be told which repo a build run works in (F-028).**
  Choosing a project auto-attached every one of its repos as chips and the launch body took
  `repoRef = repoRefs[0]`, so an explicit tick on the repo the operator meant was silently outranked
  by whichever project member happened to be listed first — acceptance run `1f12f9ab` dispatched a
  studio bug fix into wicked-core with four councils voting before it could be stopped. The chips are
  now **context**: the one repo the run works in is derived by `resolveLaunchTarget`
  (`src/components/launchTarget.ts`, the single definition the Send guard, the wire body, the deliver
  notice and the pre-send summary all read) — Target-repo choice > explicit popover tick > the lone
  attached repo > for **build-kind** work with several candidates **ambiguous, no default** (a
  required `launch-target-repo` select with `launch-target-reason`; Send disabled, Cmd+Enter fires
  nothing; the deliver notice reads `no-target`); non-build launches keep the first repo as context, as
  before. Auto-attached chips keep their `(from project)` marker after a tick (`data-auto-attached`
  is now per chip) and the target chip carries `data-target="true"`. The deliver notice names the
  repo the PR lands on — `→ opens a PR on owner/repo` off the registered `git_url`, the registered
  name otherwise (`repoSlugOf`; `data-deliver-repo`). A pre-send confirmation step (`launch-confirm` with `launch-confirm-workflow` / `-target` / `-gate`;
  `data-workflow` / `data-target` / `data-gate`) reads workflow + target repo + gate posture before
  Send. The operator's **latest act stands**: a tick made after a Target choice wins ("select A,
  then tick B" sends B), and removing the chosen repo drops the choice. The popover's gate select is
  now `launch-gate` (its former `launch-confirm` testid names the confirmation step). Wire unchanged
  (`LaunchRunBody.repoRef`). Tests: `tests/launchTarget.test.ts`,
  `tests/ChatInput.target.test.tsx`; seed suite: `LNCH-T` (`e2e/seed_surfaces_test.py`, authored,
  not yet executed — see `docs/testing/seed-surfaces-plan.md` §3).
- **Run page: `Cancel run` for every non-terminal status, outside gates (F-029).** A run in
  `distributing` had no cancel anywhere on `/runs/:id` — `steering-cancel` lives inside a gate card
  that had not opened, and the header's stop control was an unlabelled icon that read as decoration —
  so a mis-bound run burned seats until the operator hit `POST /runs/:id/cancel` by hand. The header
  now carries a labelled `run-cancel` button for planning / distributing / executing / awaiting_human;
  it asks first (`run-cancel-confirm`: `run-cancel-yes` / `run-cancel-keep`, Escape keeps), speaks the
  wire directly (`api.cancelRun`) and refreshes the run index; a refusal stays on screen
  (`run-cancel-error`, `role="alert"`) instead of being swallowed. Terminal runs offer none. `ChatPanel` no longer
  takes an `onKill` prop (the header speaks the wire itself; the Ctrl/⌘+Shift+K shortcut and the
  palette verb are unchanged). Tests: `tests/ChatPanel.cancel.test.tsx`; seed suite: `RUN-CXL`
  (observed at TST-1's gate on a second page; authored, not yet executed).

## [0.5.2] — 2026-09-09

### Added
- **Repositories section on the project page (#208, closes #207).** `ProjectRepositories` lists a
  project's `crew.repo` members and attaches / detaches them from the surface an operator actually
  lands on (`/p/:id`; also the legacy `/projects/:id`, whose generic Members list now shows only the
  non-repo members): a registered-repo picker over the one session repo cache (fetched on the field's
  first focus, never on mount; already-attached repos excluded) that sends the pinned
  `AttachMemberBody` (`POST /projects/:id/members` `{kind:'crew.repo', ref, attachedBy:'studio'}`),
  an inline-confirmed detach (`DELETE /projects/:id/members/:mid`), one `busy` lock shared by attach
  and detach (both derive the next membership from the members they closed over, so two in flight
  would report from a stale base), failures surfaced in `project-repo-error` — never swallowed — an
  empty state that names the consequence (a project-scoped test cannot launch until a repo is
  attached), and the section omitted for the synthesized `default` project. The dashboard's bound-repo
  chips render from the same membership read, so an attach lights the chip with no second fetch.
  Before this a UI-created project could never launch a project-scoped test: nothing in the product
  called `attachProjectMember` with `kind:'crew.repo'`, and crew's multiscope resolver 400s a
  project-only launch over zero repository members.
- **Skills section (#209).** `/skills` — the file manager over the daemon's one effective
  garden-shaped plugin root (the skills keystone, crew#480): the KPI band and catalog with
  kind / provenance / core / claude-only / upgrade / conflict / unpublished badges, the enabled
  switch through the daemon's guards, the drawer with the skill's own files and the root support
  files under tabs, a textarea editor (Save → `PUT` → the daemon's findings, CAS on the revision
  the content was read at), the read-only **Baseline side** of the open file (`?side=baseline`;
  for a held-back name collision it names the upstream file actually read), Reset (typed
  confirmation), Replace / Add (a pasted files map), Refresh baseline, Analyze (dry run) and
  Publish. A "Skills" rail section sits before Steering. Every mutation answers the contract's
  2xx `{verdict, findings, revision}` envelope (a `blocked` verdict is a normal answer with
  nothing written); a 409 — exclusively a stale `expectedRevision` — freezes the page behind the
  reload prompt.
- **Engine line on `/skills`.** `GET /diagnostics` → `skills` (the api-types 0.28.0
  `diagnostics.skills` block, mirrored) rendered under the snapshot line: the state vocabulary
  `published | fallback | blocked | config-error | disabled` with its findings — whether the engine
  is actually being handed a verified snapshot, and why not.
- **Tests-feature deterministic test layer (#210).** T1–T20 / T24 of the Tests-feature test plan
  (council run `1aba96f6`; the codex REVISE's required changes applied), the scenario id in every
  test name: the launch wire's presence gate and its negative guarantee — named 404 / 400 /
  strict-zod 400 / 500 / 501 / transport rethrown after ONE call, never retried over `/runs`
  (`tests/testingLaunch.wire.test.ts`); the four `POST /runs/:id/gate` bodies and the bodyless
  cancel (`tests/gateWire.test.ts`); the launch panel's scope matrix, locked chips, picker, consent,
  double-submit → one POST, and gate arrival before/after the response (`tests/TestingLaunch.test.tsx`);
  the page's probing → populated states and the `?new=` intent (`tests/CampaignsPage.test.tsx`);
  route wiring through the project shell (`tests/ProjectCampaignsView.test.tsx`); and **T30**, a
  rename-consistency guard over every rendered string — text, `title`, `aria-label`, `placeholder` —
  on the Test surfaces (`tests/renameConsistency.test.tsx` + `tests/renameGuard.ts`). The revised
  plan ships in-repo (`docs/testing/tests-feature-test-plan.md`: T21–T23 rewritten as non-launching
  probes, T25–T29 governed / Playwright left as documented next steps).
- **Seed-surfaces E2E suite (#211).** `e2e/seed_surfaces_test.py` seeds and exercises every studio
  surface through the real UI (Playwright) against a disposable, hermetic daemon — own port, scratch
  HOME / TMPDIR, every `WICKED_*` store pinned into the temp dir, the bridge pinned to
  `wicked-interactive@0.8.1` and resolved offline — with persistence + scoping assertions, product
  gaps as narrowly scoped `xfail` rows carrying their issue numbers (studio#212 / #213 / #214 / #216,
  crew#472), one governed scenario proven from durable events, and an isolation proof that the rig
  wrote nothing identifiable into the live daemon or the operator's stores. Certified run 12:
  52 rows — 36 pass · 0 fail · 15 xfail · 0 xpass · 0 skip · 1 blocked (DEM-REC, studio#217).
  `--self-test` runs 229 in-process checks of the rig's own guards; `--rescrub-report` re-derives the
  committed report deterministically. Rig, coverage matrix, findings and known limitations in
  `docs/testing/seed-surfaces-plan.md`; the scrubbed report in `docs/testing/seed-surfaces-report.json`.
- **Live Test-feature run (#215).** `e2e/test_feature_live.py` drives "Run recon" / "New test"
  through the studio UI on the dogfood daemon (crew 0.7.25 / studio 0.5.1): three governed runs
  serialized behind a preflight, the intake gate approved on the real SteeringGate card, every testid
  it uses verified against `testid-inventory.json`, no deliver / push / PR gate ever taken, nothing
  registered, modified or deleted. Write-up in `docs/testing/test-feature-live-report.md`; raw
  measurements in `e2e/artifacts/test-feature-live/report.json`. What worked end to end: the launch
  UX (verb → picker → chip → submit posts exactly the pinned `TestingReconBody`; the gate on the panel
  card over `/ws` in 67–80 s; approve → `POST /runs/:id/gate` 200; runs reach terminal state). Findings
  recorded for follow-up: the approved plan is never executed (0 sibling runs, 0 campaigns — crew#473),
  the only human gate is pre-execution, a one-sentence brief plans 3 units every time (core#393), two
  plans for the same brief share 0 % of scenario ids, and studio-side operator-view defects (a dangling
  `campaign` label when `campaignRegistered:false`, the Test landing never showing single-repo recon
  runs, rename leftovers).

### Fixed
- **Campaign → Test rename regression (#210, closes #203).** 15 rendered "Campaign" strings — the
  rail ＋ label, the project-shell crumb, the chat group-attach pill, the Needs-You row text and verb,
  the scoreboard not-found / loading / attached tooltip, the launch panel's fan-out and resolved copy
  and link, the landing's probing / unsupported copy, `TESTING_UNSUPPORTED_COPY`, the "+N older" chip
  title and the "No tests match" line — now speak the Test vocabulary; backend / route / store-key /
  testid vocabulary stays `campaign` by design. **The Test rail ＋ now creates**: it used to land on
  the Tests page with nothing open; a `?new=test` / `?new=recon` arrival intent (`testingLaunchPath` /
  `readLaunchIntent` in `src/api/testing.ts`) opens that panel on mount and is consumed with one
  `replace` navigation, and the rail's "Run recon" row rides `?new=recon`. The project-scoped view
  moved out of `App.tsx` into `ProjectCampaignsView.tsx` (`project-campaigns-crumb`);
  `testid-inventory.json` regenerated.
- **The Skills API layer speaks the real crew#480 wire — fix pass 4 of #209.** Against the
  integrated bundle `/skills` rendered an error: studio's hand-mirrored types expected a
  `manifest.support` map, string `revision`/`expectedRevision`, hash-carrying file entries and a
  `SkillFileContent.hash`, none of which exist in the contract. Every declaration is now a
  byte-for-byte MIRROR of the contract's skills block (`src/api/skills-wire.ts`, pinned by
  `tests/skillsWire.test.ts` against a vendored fixture of the same line ranges), and every
  reader/writer consumes it: numeric revisions, `manifest.files` records (support files are the
  records no skill owns; the DEEPEST registered skill dir owns a file), `SkillFileTree` rows
  `{path, size, record}`, `SkillReadResult {content|null, size, truncated, binary}` (Save disabled
  on either flag), the `provenance` field as the wire's (no longer derived), `upgradeAvailable` /
  `upstreamDir`, the `published` record and `current` snapshot, `SkillPublishResult.snapshot` and
  `SkillRefreshResult`'s merge tallies in the notes. Every finding kind renders generically with
  its skill, the skill it is against (core-marked), `file:line`, evidence and explanation. A
  **503** (unseeded root / corrupt `current` / no seam) renders the named unavailable state with
  the daemon's sentence — never an empty catalog; the bare 404 stays the "predates" state.
  **Contract pin:** the mirror pins the skills block that `wicked-crew-api-types` **0.28.0** carries
  (crew#480 — re-minted from 0.27.0 after the #475/#480 collision; the block is content-identical,
  only the version token moved). The package pin stays `^0.25.0` in this release; the swap to
  `export type { … } from 'wicked-crew-api-types'` (deleting the fixture + pin test) follows once the
  pin can move to the published 0.28.0.

## [0.5.1] — 2026-09-08

### Fixed
- **Honest dashboard stat framing (#200, Copilot review).** The home essence tile for tests reads
  "Governed tests (each test groups its sibling runs)" instead of "Test runs" — the value is the
  test/campaign count, not a run count. The Memories store band no longer falls back to the
  query-scoped loaded count for the store-wide total (shows "—" when coverage is absent), and the
  facet-value tile states it counts the loaded recall page, not the whole store.
- Renamed the exported `CAMPAIGN_PROBLEM_PREFIX` → `TEST_PROBLEM_PREFIX` to match the "New test"
  verb it now frames.

## [0.5.0] — 2026-09-08

### Changed
- **The command-deck landing rebuild.** A ground-up redesign of `/` on real wire data: a themed KPI
  ribbon (FLOW / ATTENTION / TRUST&SPEND) on the real `AgentSession.created_at` clock (true 30d
  windows + prior-window deltas, degrading to positional when no run is dated), a needs-you feed with
  severity stripes, a verified-vs-needs-review strip, a live-pulse burn chart, and section doors.
- **Nav usability wave.** Test split out below Execute (a standalone, project-optional work section,
  renamed from "Campaigns"); Evals moved beside Steering; work/system dividers + a Settings bar; the
  daemon health bar stays at the rail's foot.
- **The deck design applied to every section dashboard** (the shared `StatTile` reskin).

### Added
- The Evals section lists the persisted eval-run history + drilldown (`GET /testing/evals[/:id]`).
- Bumped `wicked-crew-api-types` 0.8.0 → 0.25.0; new `--section-{test,vibe,demo}` tokens.

## [0.4.15] — 2026-09-07

### Added
- **Governed-knowledge dashboard (#195).** `/steering/dashboard` is the new Steering
  landing: a KPI band (Needs review · Memories · Active rules by severity), a
  consolidated review inbox (memory + policy proposals in one place, approve/reject
  inline), and browse. A "Needs review" governed-knowledge band on the project homepage.
  The propose→promote review queue is no longer buried at the bottom of the Policies and
  Memories pages.
- **`FacetAutocomplete` (#195).** The facet chip filters became a `key=value` typeahead.

### Changed
- **Nav tweaks (#194).** Removed the logo connection dot; the Health heart is colored by
  health; Ask is a compact `?`-circle; Testing is relabelled "Test" and moved below Make;
  a custom site name in Settings → Appearance.

## [0.4.14] — 2026-09-07

### Added
- **Capture learnings action (#189).** A per-repo verb on the Repositories panel
  launches the governed `capture-learnings` workflow over the repo (`launchRun`
  with `workflow:'capture-learnings'`) — a tracked run the operator watches that
  mines the repo's churn + hotspots into faceted memory and policy proposals,
  reviewed in the Steering surfaces. Marks the run launched-here (studio
  provenance), mutually disables with Onboard, and guards against double-click.

## [0.4.13] — 2026-09-06

### Changed
- **Unified governed-knowledge surface (DES-MEM-FACETED-001, #187).** Steering is now the home for both **Policies** and **Memories**, each sub-section carrying *manage existing* AND *proposals*: the seven steering-type pages collapse into one type-filtered Policies view (all rule-management preserved) with policy proposals folded in; a new Memories sub-section browses the memory store, retires (subtree-scoped), and reviews memory proposals. The standalone Proposals surface is retired into these sub-sections (`/proposals` and legacy `/steering/:type` redirect).

## [0.4.12] — 2026-09-06

### Added
- **The proposal approval-queue surface** (DES-MEM-FACETED-001, #185). A dedicated queue for
  governed-knowledge proposals: browse pending proposals, filter by type, and approve or reject
  each in place. The `Proposal` type is defined locally for this release (per the `src/api/wiki.ts`
  pattern) pending `wicked-crew-api-types@0.21.0`.

## [0.4.11] — 2026-09-05

### Changed
- **Chrome + rail control affordances (#183, operator direction).** The rail header now spaces
  Notifications, Ask, and the menu as distinct actions rather than one cluster. NotificationBell
  is centered inside a token border, with the unread count moved from an overlaid badge to inside
  the border (right of the label, shown only when unread > 0). Ask takes the slot next to the
  logo where the connection "live" word used to sit; the status dot stays as the minimal
  glanceable state and still expands the rail-foot Health section on click.

## [0.4.10] — 2026-09-02

### Added
- **Campaign cards tell the whole story** (#27, #181, on the 0.19.0 wire). Delivery rollup —
  "n of N landed" with per-sibling PR links (`isPrUrl`-gated) and stranded siblings surfaced as
  needs-you; a live one-line narration per card from the freshest member-run CoreEvent (rendered
  through `narrator.ts`, the one template source); ad-hoc grouping — the launch composer attaches
  a run to an existing campaign or a create-on-first-use label group, and grouped runs co-render
  on the campaigns dashboard.

## [0.4.9] — 2026-09-01

### Added
- **The delivery surface** (crew#393's studio half, #178). The launch composer's "Open a PR when
  done" toggle (default ON for repo-scoped code-work launches, posted explicitly); the run
  detail's Delivery card renders the 0.18.0 tri-state — delivered (PR link), **stranded** (amber,
  one-click Deliver with the daemon's own error shown verbatim on failure), none; home needs-you
  counts stranded completed runs. Pre-0.18 daemons that 400 on the key get one retry without it.
- **Docs and demos can be deleted from the UI** (#119, #179). Confirm names the doc; success
  drops the row and re-lists; a two-store divergence (crew's partial 500) renders the wire
  sentence verbatim with a retry armed; ghost 404 / build-in-flight 409 / bridge-unavailable 503
  each render honestly.

### Fixed
- **Ask & chat nits from the live campaign** (#176, #177). The Ask quick-prompt seeds the NEWEST
  failed run; dock replies render sanitized markdown; collapsing a long seat reply keeps its bytes
  (expand restores byte-equal text); the chat header's seat chips and feed read one attribution
  source.

## [0.4.8] — 2026-09-01

### Added

- **The home command center** (#174) — the homepage answers three questions in priority order:
  *what needs me* (one deduped queue of waiting gates, failed runs, blind repos, stalled chats,
  and campaign gaps — every row actionable in place: dock deep-links, retry/re-index prefill),
  *is the portfolio healthy* (six KPIs from the shared folds — the needs-you tile counts the
  queue's own fold so they can never disagree — plus the narrated activity pulse and the project
  wall), and *where do I go* (creation verbs, a board-level Ask invite, and the per-section
  essence strip). Calm copy is owned solely by the queue's zero-row branch, so "All quiet"
  beside visible failures is structurally impossible. NarrativeBand, ActivityRiver, LiveFeed,
  and RunOutcomeBar are deleted — their questions are now answered once, not twice.

## [0.4.7] — 2026-09-01

### Added

- **Chat and Repositories become command surfaces** (#169) — the dashboard kit applied to the
  last two list sections: conversation cards with seat chips and a live/needs-you-first order,
  and the repo fleet view with derived graph state, windowed pass/fail splits, and
  re-index-as-prefill.
- **Testing lands on Campaigns** (#170) — the Testing section opens on a campaigns dashboard
  (Harness folds into the landing's creation verbs), and launches gain **project selection and
  multi-codebase attachment**: the pinned `{projectId, repoRefs}` wire against crew's new
  `POST /testing/recon`, honest `runIds` fan-out rendering, and a presence-gated single-repo
  fallback for older daemons.
- **Steering becomes a spreadsheet** (#171) — inline cell editing with Enter/Esc/Tab semantics,
  add-row with reserved-namespace validation, retire-with-reason; advanced fields stay in the
  drawer. And the **assist dock**: the reusable right-panel chat (design:
  `.product/DES-ASSIST-DOCK.md`) where chatting launches the governed authoring run, the propose
  gate renders as a pinned approval card inside the panel, and attachments fork
  import-directly vs analyze-with-chat.
- **Ask** (#172) — an app-wide assistant entry in the rail (below Notifications, its own accent
  idiom, ⌘⇧A) opening the assist dock with an app-context pack that cites the daemon's new
  diagnostics (component versions, stores, per-CLI ACP health) when served, with honest
  degraded copy on older crews; quick-prompt chips prefill common questions.
- **Steering reports on itself** (#172) — a usage band on the Steering landing: gate
  evaluations, denials, % of runs governed, allow/deny split, top-fired vs unused rules
  (clicking through to the filtered grid), and the latest eval's caught/gap rate.

## [0.4.6] — 2026-09-01

### Added

- **Section dashboards** (#167) — Projects, the project homepage, and Make become full-width
  command surfaces on the executive-dashboard model: a ≤6-tile KPI band per section
  (performance / pipeline / risk) with honest deltas (a delta renders only against a full
  same-size prior window — never a fabricated surge) and inline sparklines, a first-class
  FilterStrip (search + status chips + window picker), and card grids where every card is a
  door. The action layer rides on top: creation verbs on every header, "needs you" floats
  first with gate cards deep-linking straight to the approval dock, and failed items carry
  Retry-as-prefill. One shared kit (StatTile / FilterStrip / DashboardGrid / sparklines).

### Changed

- **The run header condensed** (#166): one row + the phase strip; started/ended/took moved
  into the What/Where insights panel; Timeline and Units left the primary tabs for an
  Inspect ▾ menu — the Feed is the run view. +79px (+19%) more feed above the 1440×700 fold.

## [0.4.5] — 2026-08-31

### Fixed

- **The narrator reaches the chat surface** (#164): GroupChat now renders the narrative by
  default — user messages and short crew replies stay first-class turns, long per-seat worker
  output collapses to seat-chip narration lines with the raw bytes behind expanders (the full
  verbatim transcript stays behind the view toggle), streaming shows as honest progress lines,
  artifacts render as cards, and the now-bar + pinned approval dock mount on chat too. Direct
  follow-up to 0.4.4 user feedback: "what I see is still the outputs from the individual agents."
- The approval dock no longer vanishes mid-decision on chat sessions: the run-refresh reconcile
  pruned gate ids absent from `GET /runs` (a chat session id never appears there), unmounting the
  gate card ~400ms after it appeared and eating any half-typed note — a counted pin registry
  (`awaitingPins`) both reconciles respect keeps a mounted surface's gate alive (#164).

## [0.4.4] — 2026-08-31

### Added

- **The run narrator** — the build-chat redesign (design doc `.product/DES-RUN-NARRATOR.md`).
  One chronologically stable feed narrated by a deterministic template layer over the event
  stream (raw output collapses behind expanders; ordering fixed at the source for backfill and
  live-merge), a **sticky now-bar** always showing what is happening right now, a **pinned
  approval dock** that never scrolls away (approve / amend / reject-with-note — the reject path
  now carries the note), **artifact cards** inline as files and documents are produced, and a
  labelled follow-up bar replacing the ambiguous composer on finished runs (#161).
- A real **not-found view** — unknown routes keep the typed URL and offer links instead of
  silently landing on a default page (#160).

### Fixed

- The usability review's dead ends (#160): the Escape/overlay contract with focus return + a
  skip link; the Work window is an honest "last 30" with full-set search, a first-class
  show-all chip, and a threshold-colored success rate; lists derive short human titles instead
  of raw prompt text; Steering type pages show type-scoped stats (empty types lose store-wide
  noise; diagnostics fold behind a toggle); single-seat council decisions read "allowed — no
  policy applied" instead of vote theater; evals split blocked-vs-passed, link gap hints into
  the rule drawer, and name their corpus; dead-end empty states gained CTAs plus ten
  plain-language copy rewrites.
- **Failed runs explain themselves** (#162): the failure banner translates engine denials into
  plain words with advice ("Unit #2 tried to write outside its workspace and was stopped to
  protect your files."), reading the structured denial from wicked-core-ts ≥ 0.7.6 with an
  honest prose fallback on older daemons; the engine's verbatim reason stays as a detail line,
  and rule denials link into the Steering drawer.

## [0.4.3] — 2026-08-31

### Added

- **Steering** — the governance surface, rebuilt end-to-end. A top-level Steering nav item
  (above Settings) lands on seven compact type cards (Architecture, Development, Security,
  Testing, Operations, Compliance, Design/UX) with live rule counts; each type page is a clean
  rule list (severity chip, id + statement, non-default weight) with a single **Add ▾** action
  offering Add individual / Import / Add with chat (the governed-run authoring flow) — nothing
  renders open by default. Rule detail, provenance, retire/update live in a click drawer.
  Replaces the Wiki page and the old always-open management forms (#153, #154, #156).
- **Testing** — a top-level Testing nav item (above Steering) with three pages: **Harness**
  (campaign recon trigger, intake gate, launch, add-with-chat), **Campaigns** (the scoreboard,
  moved here; the old route redirects), and **Evals** (run the steering-rule evals per type or
  all, caught/gap/false-positive summary + results table, gap rows expand to the nearest
  non-firing rules with similarity, corpus upload). Honest states throughout: a pre-0.7.5
  engine answers with the upgrade callout, a hint run without an embedder shows the
  facet-only-degrade notice, an empty corpus renders an empty state (#155).
- The data-testid contract (TH-13 / test-R13): `testid-inventory.json` — a committed, versioned
  inventory of every `data-testid` the UI declares, regenerated with `npm run manifest:testids`
  and emitted into `dist/testid-inventory.json` by the build so consumers verify against the
  dist actually served. `tests/testidInventory.test.ts` re-scans `src/` and fails CI on drift.

### Changed

- The steering client is reconciled to crew's shipped wire byte-for-byte — import
  `{type?, entries[]}`, author `{instructions, type?, documents?}` → `{runId}` (#154).

### Removed

- The Settings **Policies** panel and PolicyManager (policies merged into steering rules;
  `/policies` redirects to `/steering`), and the context-free **Domain** and **Coverage**
  Settings panels (`/domain` and `/coverage` redirect to `/system`; per-run coverage evidence
  keeps its home in the run view; the project-scoped successor is tracked in #157/#158) (#156).

## [0.4.2] — 2026-08-30

### Added
- **Architecture Wiki page** (nav): scoreboard health header, faceted rules browser
  (provenance, wiki URIs, evidence counts), RuleSet grouping, retire kill-switch with
  typed confirmation, About/authoring panel; honest 501/unseeded/empty states throughout.
- **Campaign scoreboard** (TH-14): ladder + node status from Campaign* WS frames, verdict
  chips, evidence links, cost column; sibling-run delivery rollup off `session.delivery`.
- **GovernanceAudit honesty** (AW-18): renders the acceptance conformance section with an
  explicit "unenforced" state — an unenforced run is never claimed guardrailed.
- **data-testid inventory** as a versioned build artifact with a CI drift test (TH-13).

## [0.4.1] — 2026-08-29

The truth-pass release: the docs and the site describe the product that shipped, and the
governance rule template actually saves. This is the version wicked-crew 0.7.1 bundles as its
default local skin.

### Changed

- Board attention bands read their copy from one source of truth (#121).
- Site: repositioned as "where product work happens", scoped honestly (#131); the
  project-as-context story — the multi-repo graph — added (#130); hero, scroll-snap, and
  fixed-topbar band fixes (#132, #133, #134).
- Truth pass (docs-R9): the site's project-shell copy flipped to present tense — the dedicated
  project browser is shipped, not "landing next" — and the editorial guard comment that enforced
  the stale claim now enforces the shipped one; README rewritten to the 0.4.x surface; the
  crew-daemon floor corrected to v0.7.0+ (verified against the wire: `PUT /runs/:id/guidance`
  is 0.7.0-only); onboarding copy corrected from "index → annotate → domain" to the two units
  crew actually runs (index → annotate).

### Fixed

- The governance rule template is saveable and the version row truthful (AW-1, #141).
- Unresolved-reference caveat and coverage empty states clarified post-migration (#140).
- Document/demo delete: pin the missing wire instead of inventing one (#138).
- Test stability: no FontFaceSet across the Playwright boundary (#137); doc-canvas LANDED case
  no longer reads the DOM in the frame's swap gap (#139).

## [0.4.0] — 2026-08-25

### Changed

- Delivery: the worktree is a fact — the delivery panel no longer gates it on the workflow
  catalog (#128).

This is the version certified by the 21-scenario functional campaign (21/21 PASS,
`estate-review/STUDIO-CAMPAIGN.md`): projects, repo intelligence (code graph, ego focus,
blast radius, domain graph + coverage, requirements), governed runs with HITL gates,
group chat, governed PTY terminals, workflow builder, governance surfaces, settings
persistence, document/video modes, and deep links.

## [0.3.0] — 2026-08-25

The largest release to date (~77 commits): four design programs landed.

### Added

- **DES-UX-002 — the agentic terminal of the future**: portfolio nerve center with active-card
  enrichment (#113, #118), run evidence timeline (#111), work chronicle (#112), the steering
  annotation layer with durable pre-gate guidance notes riding crew's `PUT /runs/:id/guidance`
  (#114, #117).
- **DES-UX-001 — the trust spine**: one canonical runs surface (#95), run identity (#96),
  provenance + retry (#91), failure forensics — failed runs answer "why did this fail" (#90),
  thread truth (visible sends, anchored versions, reload survival) (#97), the Unfiled path
  (#98), toast lifecycle (#99), live execution + bookmarkability (#101), export + theme-learn
  feedback (#102), chat repair (#103), keyboard coherence + composer preflight (#104),
  roster-resolved capability-aware seat chips (#109).
- **DES-FEEDBACK-002/-003 — FDE ergonomics**: universal command palette + global shortcut
  registry (#76), keyboard gate triage — j/k select, a approve, r reject-with-note (#77),
  in-studio file & diff viewer (#79), five-path accordion rail (#80), fixed bottom runs panel
  (#81), health rail-foot + `/make` dashboard (#82), `/projects` `/chats` `/repos` reporting
  dashboards (#83), narrative landing with the 24h activity river (#84), header project pivot +
  honest global search (#85), chat grid/columns + document version compare (#86), desktop gate
  notifications + batch gate resolution (#87).
- **DES-VISION-001 / DES-UXFIX-001 — the visual re-envision**: design-token foundation through
  full token conversion (#56–#60), appearance settings — logo, accent, theme, live preview
  (#61), brand-learn (#62, #75), Theme page (#64), attention decay + bands (#49), segmented
  mode spine (#52).
- Build runs open a PR by default, with a settings toggle (#124).
- Delivery visibility: what a run produced, where the operator already is (#125).
- Doc canvas block-level click-to-edit (#116) and the video surface restored on the real
  record wire (#120).

### Fixed

- Theme client speaks the real bridge wire — invented routes removed, contract probes FATAL
  (#73, #75).
- Send-lifecycle honesty: no fork-per-send, live first generation, reload-surviving send state
  (#108); chat cold-start roster truth (#107).
- Copy triage: internal vocabulary out of the product (#47).

## [0.2.0] — 2026-08-19

The merged interactive layer: wicked-interactive's UI moved into this skin (DES-MERGE-001).

### Added

- Project routes + the four-mode switcher — chat / build / document / video (#29).
- The orchestrator home board, static then live, with answerable gate chips (#30, #31, #32).
- Typed studio client for crew's proxied interactive service (#28).
- Document mode: canvas iframe (#33), version strip + fork (#34), the one conversation thread
  (#35), point-and-comment on the sandboxed bridge (#37), exports as thread artifacts (#40),
  learn-a-theme + sources attach (#41).
- Video mode: storyboard + player against the proxied demo endpoints (#38), record and
  re-record from the thread (#39).
- Merged preflight / install gate (#42).
- Live narration + unified launch/steer conversation on the run thread (#24, #25).
- Seat sign-in terminals, worker config root, launch check in settings (#23); runtime
  seat-health chips on the dashboard, launch roster, and chat composer (#18, #19, #20).

### Removed

- Unrouted legacy views (#22).

## [0.1.1] — 2026-08-16

### Added

- `ws.wickedagile.com` — the product site, with its own e2e suite and Pages deploy (#1).
- Wire contract consumed from npm: `wicked-crew-api-types` (#2).
- Projects UI: list, detail, create, archive (DES-PROJECT-001, #13) — the first projects
  surface in the skin.
- Run view: outputs primary in the main panel + Files tab system-open (#17); Archived chip
  for finished history (#14).
- npm trusted-publisher release workflow (#16).
- `.product` artifact set: REQ-001–005, DES-001, TEST-001, RAID, acceptance evidence (#4, #6).

### Fixed

- Gate toasts scoped to the currently viewed run; pointer-events on the notification container
  (#9, studio#10).
- Gate HITL card data + cache-read token visibility (#7).
- `wicked-crew-api-types` pinned to the npm registry version (#5).

## [0.1.0] — 2026-08-12

### Added

- Initial release as its own product: carved out of the wicked-crew monorepo
  (`packages/studio`) with the package's full in-monorepo history preserved via
  `git subtree split` (92 commits).
- The SPA as a pure HTTP/WS client of the wicked-crew daemon: runs, gates, live CoreEvents.

[Unreleased]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.5...HEAD
[0.6.5]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.4...v0.6.5
[0.6.4]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.3...v0.6.4
[0.6.3]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.2...v0.6.3
[0.6.2]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.19...v0.6.0
[0.5.19]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.14...v0.5.19
[0.5.14]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.12...v0.5.13
[0.5.12]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.11...v0.5.12
[0.5.11]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.10...v0.5.11
[0.5.10]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.9...v0.5.10
[0.5.9]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.8...v0.5.9
[0.5.8]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.7...v0.5.8
[0.5.7]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.5...v0.5.6
[0.5.5]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.4...v0.5.5
[0.5.4]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.3...v0.5.4
[0.5.3]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.15...v0.5.0
[0.4.15]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.14...v0.4.15
[0.4.14]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.13...v0.4.14
[0.4.13]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.12...v0.4.13
[0.4.12]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.11...v0.4.12
[0.4.11]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.10...v0.4.11
[0.4.10]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.9...v0.4.10
[0.4.9]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.8...v0.4.9
[0.4.8]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.7...v0.4.8
[0.4.7]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.6...v0.4.7
[0.4.6]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.5...v0.4.6
[0.4.5]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.4...v0.4.5
[0.4.4]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mikeparcewski/wicked-studio/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mikeparcewski/wicked-studio/releases/tag/v0.1.0
