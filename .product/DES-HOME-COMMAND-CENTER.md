# DES-HOME-COMMAND-CENTER — the landing becomes the command center

Status: implemented (this wave)
Route: `/` (HomeBoard and its children)
Predecessors it reworks: DES-VISION-001 §1.3 (wall + live feed), DES-FEEDBACK-003 §7 (narrative band)

## 0. The brief

> "determine the best things to bubble up to the homepage for its dashboard, aggregating
> data and action oriented" — toward "part analytics and part action panels... the IDE of
> the future, not working with code, but agents and directing many projects/work products
> at once."

The homepage answers **three questions in priority order**, and nothing else:

1. **WHAT NEEDS ME?** — the triage question. One deduped queue, act-in-place.
2. **IS THE PORTFOLIO HEALTHY?** — the analytics question. Honest numbers with doors.
3. **WHERE DO I GO / WHAT DO I START?** — the navigation/creation question.

Everything that serves none of those **stays in its section**. This document is the
inventory of every shipped section's folds and the verdict on each candidate.

## 1. Inventory — what every shipped section exposes, and the verdict

| Source | What it exposes (fold / wire) | Verdict for `/` |
|---|---|---|
| **runs wire** (`GET /runs` + `/ws`) | `SessionView[]` + units; `runStats` / `windowBuckets` / `windowDelta` / `statusCounts` / `healthOf` / `attachSeries` (board/metrics, board/windowStats) | **Bubbles up** — the spine of Q1 (gates, failures) and Q2 (KPI band). |
| **gate store** (`awaitingHuman` fold) | `OpenGate{runId, prompt, receivedAt}`; `gateOpenPath` deep link | **Bubbles up** — gate rows in the queue (Q1), each deep-linking to the run's approval dock (`…/build/:run#gate`). |
| **ProjectsPage** (`/projects`) | project register, per-register KPI band, Do Work / New project verbs | Counts only: **Projects N** in the essence strip (Q3) + the verbs row (Q3). The register grid stays in its section — a second project grid would double the wall below. |
| **ProjectDashboard** (`/p/:id`) | per-project KPIs, mode verbs | **Stays** — per-project altitude; the wall card is its door. |
| **MakeDashboard** (`/make`) | docs across interactive projects (docsCache), spend | **Docs N** in the essence strip (Q3). Doc tiles stay — a doc list is work-product browsing, not triage. |
| **ChatsPage** (`/chats`) | `GET /chats` live seat pool; `stalledLiveChats` (idle ≥ 600s); chat history via `isChatRun` windows | **Bubbles up twice**: stalled live chats are Q1 queue rows (warm seats someone pays for that nothing drives — an attention debt); the live-session count is the essence strip's **Chats N** (Q3). History folds stay in the section. |
| **RepositoriesPanel** (`/repos`) | `repoFleetModels` / `repoOnboard` (ready/onboarding/failed/**never**), re-index-as-prefill idiom | **Bubbles up**: repos whose graph build **failed** or was **never run** are Q1 queue rows with the re-index/index prefill act (the fleet is blind on those repos — every downstream surface degrades). Repo count → essence strip (Q3). Per-repo run counts stay in the section — a failing repo RUN is already a failed-run row; a second repo-shaped row for the same run would violate dedupe. |
| **TestingPage campaigns** (`campaignStats`) | `campaignTotals`, per-campaign counts (awaitingHuman/failed/running), pass rate, recon verb | **Bubbles up with subtraction-dedupe** (Q1): a campaign row fires only for waiting/failed members the live runs list CANNOT already show as rows (server counts cover archived/rolled-off members). Campaign count → essence strip; **Run recon** → verbs row (Q3). Pass-rate stays in the section — campaign health is a section-level analytic, the portfolio KPI band already carries the cross-cutting success rate. |
| **Steering** (usage folds) | `usageWindows` (evaluations/denials), `governedRuns` (%), `ruleUsage` (unused rules), eval report (session-local) | **Governed %** joins the KPI band (Q2 — the one steering number that describes the *portfolio*: how much of the work ran under the rules). Rules N / unused N → essence strip (Q3 — unused rules are a standing to-do, not a triage item: nothing degrades while they sit). Evaluations/denials/splits/eval verdicts stay on `/steering` — they describe the governance system, not the portfolio. |
| **Narrator** (`narrator.ts`, runtime/event stores) | `narrate` / `lastNarration` / `TONE_*`; per-run structured frames (`useRunEventStore`), arrival clocks (`useRuntimeStore.logs`) | **Bubbles up** as the RECENT ACTIVITY strip (Q2's pulse): each observed run's last narration line, newest first, ≤8, each a door to its run. The queue's gate rows speak through `narrate()` over the gate's own frame shape — one template layer, zero forks. |
| **AskDock + askContext** | governed Q&A chat with the context pack; rail button + ⌘⇧A | **Bubbles up** as a board-level invite (Q3): a visible Ask entry ON the board that opens the same `AskDock` (the rail button is not duplicated — the invite calls the same `setAskOpen` the rail does, via an `onOpenAsk` prop). |
| **`GET /api/v1/diagnostics`** (LIVE: components/stores/acp.byCli) | crew/studio versions, uptime, store sizes, recent errors, per-CLI ACP health | **One line only**: the essence strip ends with `crew <version> · up <t>` (Q2's "is the machine on?" — presence-gated, omitted on older daemons). Error tails and ACP health stay with Ask/System: they are debugging surfaces with no per-item act, and a daemon error is not an operator to-do. |
| **Old HomeBoard: NarrativeBand** (lede + ActivityRiver + margin tiles) | 24h lede, per-project river, outcome bar, burn sparkline | **Deleted.** The lede's job (Q1 headline) is done better by the queue + its calm line; the river/outcome-bar's job (Q2) by the KPI band's deltas and sparklines; the burn note by the Make/section surfaces. Components `NarrativeBand`, `ActivityRiver`, `RunOutcomeBar`, `TokenBurnSparkline` leave with their tests (`composeLede` dies with its band; `ledeCounts` survives in board/metrics for its other consumers/tests). |
| **Old HomeBoard: LiveFeed** (right rail) | newest output lines of moving runs | **Deleted.** Its question ("what is the system doing right now?") is Q2's pulse and now answered by RECENT ACTIVITY — narration (story beats) rather than raw output lines, deduped per run, with honest arrival clocks. Two live narration rails on one page would compete with the queue for the first read. |
| **Old HomeBoard: the project wall** (bands, windowed grids) | needs-you/working/quiet cards, gate chips + batch bar + triage cursor, live card narration | **Survives as PORTFOLIO, below the command center** — it *is* the many-projects-at-once vision (Q2 at project altitude, and every card a door, Q3). The queue and the wall read the SAME stores (gate store, run DTO statuses, `bandFor`) so they cannot disagree; the queue is the flat, item-level index with deep links, the cards are the workbench with the in-place controls (gate chips, batch selection, reject notes). The wall's needs-you band **loses its empty-state line** ("Nothing needs you right now.") — calm copy now has exactly ONE owner, the queue (see §3). |
| **Old HomeBoard: quiet-project chips** | one-line doors to dormant projects w/ 7-day sparkline | **Survive** (Q2/Q3): the dormant majority stays visible-but-demoted, and each chip is a door. |
| **Old HomeBoard: unfiled shelf** | runs no project claims | **Survives** (Q2 honesty): hiding unfiled runs would un-count them everywhere on the page. Collapsed, last, as before. |
| **Old HomeBoard: run-history strip** (ActivityRiver) | 24h per-project activity marks | **Deleted** (see NarrativeBand). Its gate marks are queue rows now; its density read is the KPI sparkline. |

## 2. The page

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Home            [Do Work] [New project] [New chat] [Register repo]       │
│                 [Run recon]      [ Ask about your work… ⌘⇧A ]  All runs ›│
├──────────────────────────── command center ──────────────────────────────┤
│ NEEDS YOU (spine, left ~58%)          │ PORTFOLIO KPI BAND (6 tiles)     │
│  ◆ gate row … age   [Open gate ›]     │  active now · runs(Δ) · needs-you│
│  ✗ failed row … age [Retry ›]         │  failed(Δ) · success% · governed%│
│  ✗ campaign row …   [Open campaign ›] │──────────────────────────────────│
│  ● repo row …       [Index repo ›]    │ SECTION ESSENCE STRIP            │
│  ◆ stalled chat …   [Open chat ›]     │  Projects N · Docs N · Chats N · │
│  (or, ONLY when the fold is empty:    │  Repos N · Campaigns N · Steering│
│   "Nothing needs you — N runs         │  N/M unused · crew v · up t      │
│    working.")                         │──────────────────────────────────│
│                                       │ RECENT ACTIVITY (≤8 narrated     │
│                                       │  lines, newest first, run doors) │
├────────────────────────────── portfolio ─────────────────────────────────┤
│ NEEDS YOU · WORKING · QUIET (N) · unfiled — the windowed card wall,      │
│ unchanged bands, batch bar + triage cursor intact                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Layout: full width. The command center is a `flexShrink:0` block capped at ~55vh with the
queue scrolling internally; the wall keeps its own scroller below. **At 1440×700 the queue
and the KPI band are both fully visible without scrolling** (verified by live screenshot).
The right column scrolls independently, so RECENT ACTIVITY can never push the queue or the
KPIs — that structural guarantee is why the strip does not need a collapsed-by-default
state (the brief's condition "if it competes with the queue at 1440×700" cannot arise).

## 3. The needs-you queue (Q1 — the spine)

One fold, `src/board/needsYou.ts` (`needsYouRows`), pure in all inputs including `now`.

**Sources → rows** (severity → tone → act-in-place):

| kind | fires when | severity | act |
|---|---|---|---|
| `gate` | run `awaiting_human` (never windowed — a gate is a person blocked) | 100 | **Open gate ›** — `gateOpenPath(project, run)` (`…#gate`, the approval dock focus intent); `/runs/:id` when unfiled |
| `failed-run` | `status === 'failed'`, unarchived, inside the newest-30 positional window (the same "last 30" idiom every section KPI band uses — the honest recency the wire supports) | 70 | **Retry ›** — Retry-as-prefill (`setRetryPrefill` + `/runs/new`): POSTS NOTHING, the composer prefills |
| `campaign` | `counts.awaitingHuman + counts.failed` exceeds what the live runs list already shows as rows for that campaign's members (subtraction-dedupe) | 60 | **Open campaign ›** — `/testing/campaigns/:id` |
| `repo-graph` | newest onboard run **failed** (sev 50) or **no onboard on record** (sev 30) | 50/30 | **Re-index ›** (re-index-as-prefill off the recorded onboard run — the RepositoriesPanel idiom, POSTS NOTHING) or **Open repo ›** for never-indexed (the launch verb lives on the repo page) |
| `stalled-chat` | `GET /chats` session with `idleSecs ≥ 600` (`stalledLiveChats`, reused verbatim) | 25 | **Open chat ›** — `/chat/:id` |

**Order**: severity desc → newest first (rows with no honest clock sort last in their
severity group — absence stays absent, shown as "age unknown") → key asc (deterministic).

**Dedupe** (unit-tested):
- one row per subject key (`gate:<run>`, `fail:<run>`, `campaign:<label>`, `repo:<id>`, `chat:<id>`);
- a failed run that IS a repo's newest failed onboard is suppressed in favor of the repo
  row (the re-index act is strictly more useful than a bare retry of the same run);
- campaign members already visible as gate/failed rows subtract from the campaign's
  counts; a campaign whose troubles are all individually visible contributes no row.

**Narration**: rows speak the narrator's vocabulary — gate rows are literally
`narrate({type:'awaitingHuman', prompt}, ctx)` (one template layer, zero forks); the
tones/glyphs are `TONE_GLYPH`/`TONE_COLOR`. Row subjects are `humanTitle` / repo / campaign
/ chat names. Ages render off the honest clocks only (`gates.receivedAt`, `failedAt` tail,
membership attach, campaign `updated_at`, `idleSecs`).

**The calm state and the contradiction guard**: the component computes `rows =
needsYouRows(inputs)` ONCE and branches on `rows.length === 0` — the calm copy ("Nothing
needs you — N runs working", N = `workingCount(runs)` live) derives from the SAME fold that
counts failures and gates; there is no second derivation that could disagree. The guard
test renders 21 failed runs and asserts the calm testid CANNOT appear while the queue
renders 21 rows.

**Why deep-link instead of inline approve on gate rows**: a gate decision deserves the
run's evidence (the dock carries the prompt, steer text, coverage, the why-this-fired
footnote). A one-line row inviting a context-free approve is the anti-pattern the
evaluator≠creator doctrine exists to prevent. Inline decisions stay where the context is:
the wall cards' gate chips and the approval dock. (The batch bar + triage cursor survive on
the wall for exactly that reason.)

## 4. The portfolio KPI band (Q2 — ≤6 tiles, every tile a door)

`dashboardKit.StatTile` verbatim; folds from `board/metrics` + `board/windowStats` +
`board/steeringUsage` — nothing re-derived:

1. **ACTIVE NOW** — `workingCount(runs)` (window: right now) → `/work?filter=active`.
2. **RUNS (last 30)** — `windowBuckets` current count, `windowDelta` vs the previous full
   bucket ("—" when none — never a fabricated 0%), spark = `attachSeries` (14d, honest
   attach clocks) → `/work`.
3. **NEEDS YOU** — **the queue fold's own row count** (the tile and the queue cannot
   disagree by construction), amber when > 0, context = oldest waiting age → the door
   scrolls to the queue itself.
4. **FAILED (last 30)** — windowed failed count, `deltaSense: bad-up`, red when > 0
   → `/work?filter=failed`.
5. **SUCCESS RATE** — done/terminal over the window, colored by `healthOf` thresholds
   (green ≥80 / amber ≥50 / red below; "—" with no terminal runs — no verdict, no color)
   → `/work?filter=completed`.
6. **GOVERNED** — `governedRuns(claims, runs).pct` (the steering lens on the portfolio);
   "—" with honest context when the daemon serves no claims → `/steering`.

## 5. Essence strip, verbs, Ask, activity (Q2/Q3)

- **Essence strip**: `Projects N · Docs N · Chats N · Repos N · Campaigns N · Steering
  N rules/M unused · crew v · up t` — one number + one door each; an entry whose wire is
  absent/unsupported is OMITTED, never rendered as a fabricated 0. It replaces
  nav-guessing; the rail survives as the addressing scheme.
- **Verbs**: Do Work (`/runs/new`), New project (the shared `NewProjectModal`, in place),
  New chat (`/chat/new`), Register repo (`/repos/new`), Run recon (`/testing/campaigns` —
  the recon panel's home; the panel itself is section state, not a URL).
- **Ask**: a board-level invite that opens the SAME `AskDock` the rail button opens
  (`onOpenAsk` prop threaded from App — no duplicate rail button, no second dock).
- **Recent activity**: `src/board/homeActivity.ts` — for each run with observed structured
  frames, `lastNarration(events, ctx)` (narrator, zero forks; `phaseName` idiom for ctx),
  clocked by the runtime log's arrival tail, newest first, capped at 8, each row a door to
  `runTimelinePath(run)`. Only observed runs appear — no invented history.

## 6. Empty portfolio (fresh install)

`projects === 0 && runs === 0 && repos === 0` → the command center renders the **verbs +
Ask, prominent**, one welcome line, and NOTHING else: no KPI zeros, no essence zeros, no
empty queue frame (no fabricated numbers where nothing has ever run). Unit-tested.

## 7. Data honesty & request budget

- New reads on `/` mount (a page navigation pays for page reads — the rail's zero-request
  budget is untouched): `GET /chats`, `GET /campaigns`, `GET /governance/claims`,
  `GET /governance/rules`, wiki scoreboard, `GET /diagnostics` — each once, each
  failure-tolerant (`tryRead` → the feature renders its absent state; a daemon without the
  route degrades the tile/entry, never the page). Repos ride the board model's existing
  read (exposed additively — zero new requests).
- Deltas only over proven full prior windows; "—" otherwise. Every count names its window.
  Clockless subjects sort last and say "age unknown".

## 8. Tests

- `needsYou.test.ts` — the fold: severity order, dedupe (onboard-failure suppression,
  campaign subtraction), windowing, calm-input equivalence.
- `homeActivity.test.ts` — the pulse fold: narration reuse, arrival ordering, cap.
- `HomeBoard.queue.test.tsx` — the contradiction guard (21 failed ⇒ calm copy CANNOT
  render), act-in-place wires (gate deep-link href, Retry deposits a prefill and POSTS
  NOTHING, re-index prefill, chat door), calm + live count.
- `HomeBoard.command.test.tsx` — KPI folds/thresholds/deltas, essence counts + omission on
  absent wires, empty-portfolio state, recent-activity strip.
- The wall's standing suites (`HomeBoard.test.tsx`, `HomeBoard.bands.test.tsx`) survive
  with the layout's new mount points; the deleted components' suites leave with them.
