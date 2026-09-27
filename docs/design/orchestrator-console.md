# wicked-studio: the orchestrator console (final)

Angle: an **orchestrator console** for a forward-deployed engineer. You conduct a fleet of runs and campaigns across engagements. The primary objects are the **Fleet** (every live plan, one rail each, with cross-run dependencies) and the **plan graph** (phases, steps, members, monitors, gates). Every capability on the platform is a **verb on an object** from one registry. Chat is **Talk**: one input docked on the command line whose prompt is the address of what you have selected, and every Talk thread files into one **Log** per engagement.

Synthesis: base = orchestrator-console (Fleet, plan graph, verb registry and its CI coverage test, selection and "alike", campaign canvas). Grafted: the scoped shell prompt, preset launcher row, `>ps` terminals, `> source`, "new engagement asks for the boundary" and the overnight preview (desk-and-apps); the four-outcome Talk router, the breakthrough bar, the consequence clock, one-line strips, grey-and-slide undo, `d` delegate and amend-from-findings (attention-control); Say/Murmur, `@team` columns, the stable rank with a "new, ranked" divider, the House scope and the Pattern/Client-detail capture split (thread-first).

Status: experience spec. Checked against studio main @ 9a8239e (0.5.14), crew @ d6834a6 (endpoint-manifest.json, 138 rows, api-types 0.47.0), the team model (DES-TEAMING-002), and lanes #347 (standing orders) and #348 (capture). Neither lane is on studio main yet.
Companion: `prototype.html`, a clickable walk-through of fifteen moments in an FDE's day.

---

## 0. What the judges named, and what fixes it

| Flaw named | Fix in this design | Section |
|---|---|---|
| Chat history spread over objects; no central conversation; a general question needs "select nothing" first | Talk is the command line on every screen, and its prompt shows its target. Every thread files into its engagement's **Log**, and the **House** scope always exists for questions that belong to no client | §7 |
| Queue-left / canvas / inspector with queue cards looks like the rejected cards-and-sidebar | The queue is a **strip board**: dense one-line strips across the top of the console, not a column of cards. In Focus and Away it collapses into **marks on the Fleet rails**. The inspector is a sheet that opens on selection | §3, §8 |
| Headline verbs (hold, caps, un-bench, sweep, bus, eval compare) need crew work the prototype pretends exists | Release 1 ships only on existing routes plus one small crew field (`gate_kind`). Crew-new verbs are registry entries with `disabledWhen: crew-not-yet`; the button says "crew: not yet" and names the nearest working verb | §4.4, §17 |
| Five always-on zones are dense | Zones collapse when they have nothing to say: an empty strip board is one line, the inspector closes when nothing is selected, a healthy lane is one line | §3 |
| FDE breadth leaned to code | The **Write / Design / Rethink / Solve / Build / Demo / Test** launcher row: presets on each engagement tab and in Parts › Presets, not places | §6 |

---

## 1. The organising idea

The operator's day is **conducting**: at any minute a dozen plans move across three engagements plus their own practice. A few need a signal, most don't, and some are about to collide. So studio stops being a set of sections (Execute, Test, Vibe, Demo, Chat, Steering…) and becomes one **console** with one grammar: **select an object, then act on it**.

The objects are what the platform runs and governs: engagements, campaigns, runs (plans), phases, steps, members, monitors, gates, findings, councils, artifacts, terminals, and the **parts** plans are built from (catalog phases, presets, skills, steering rules, evals, repos, seats, workflow defs). Each object type has a fixed set of **verbs** in one registry. Every verb is a crew route with a preview, a key and, where it can be taken back, an undo window.

Above the plans sits the **Fleet**: every live plan as a rail at 1/8 scale, laid out in engagement lanes, with connectors between runs that wait on each other. Healthy rails go dark. Decisions that need you appear once, on the **strip board**, ranked by consequence, each with its clock ("blocks 2 runs · 40 min to freeze").

You say things in **Talk**, the input on the bottom command line. Its prompt is the address of the selection (`fleet ›`, `helix ›`, `helix/H1#build.2 ›`, `house ›`). The PA classifies each sentence into one of four outcomes: **answer**, **intent** (a plan preview), **compose** (a tile, a draft, an order), or **steer** (inject, or the amend text of a gate answer). Intent and steer come back as registry verbs you commit, so Talk and the keyboard end up in the same place.

Why this beats fatigue: you never go looking for a feature, because features are verbs on the thing in front of you. Alike decisions fold into one strip and one verb. Nothing healthy asks to be read. The rank never moves under your cursor. In Focus only what breaks through reaches you.

---

## 2. Vocabulary (the UI uses these words and no others)

| Word | Means | Replaces |
|---|---|---|
| **Console** | the whole program | Home, left rail, sections |
| **Engagement** | a client body of work with its confidentiality boundary (crew project) | Project, ProjectDashboard, ProjectShell, ModeSwitcher |
| **House** | your own standing engagement for practice work and questions that belong to no client | AskDock "everything" scope, the Practice idea |
| **Fleet** | the map of every live plan, one rail per run, in engagement lanes | HomeBoard bands, WorkPage, MadeDashboard ×3, RunsBottomPanel |
| **Plan** | a run's graph: phases → steps → members, monitors, gates, dependencies | ChatPanel, CenterDashboard, PhaseLadder, IntakePlan, PlanEditPanel |
| **Campaign** | plans joined by dependencies, with a failure policy and concurrency | `groupLabel` fan-outs, `/testing/campaigns`, `/p/:id/campaigns` |
| **Part** | a building block: phase, preset, skill, rule, eval, repo, seat, workflow def | Skills / Steering / Evals / Repositories / Workflows pages |
| **Preset** | a saved starting plan. Write, Design, Rethink, Solve, Build, Demo, Test are the launcher row | Execute / Vibe / Demo / Test / "New Build" / "New Document" |
| **Verb** | an action on an object, backed by one crew route | ~40 components' buttons |
| **Strip** | one pending decision, one line: clock · engagement · decision · what commit does · who waits | needs-you rail, toasts, GateChip, ApprovalDock, BatchGateBar, bell inbox |
| **Talk** | the one input, on the command line, addressed to the selection | GroupChat, AskDock, AssistDock, AuthorPanel, DocumentThread, run composer, FollowUpComposer |
| **Log** | an engagement's single history: every Talk thread, Say messages, gates answered, orders fired | ChatsPage, WorkChronicle, LegacyChatHistory |
| **Say / Murmur** | two volumes of team traffic: Say is addressed to you, Murmur is the team talking to itself (folded) | narrator feed, run timeline |
| **Board** | a saved lens on the Fleet with tiles, composed by Talk and inline | CenterDashboard, ProjectDashboard, GovernanceDashboard, KPI ribbons |
| **Raw** | the thing itself: events, worktree, terminal, config, source, bus | RunRawView, `>events`, AgentTerminal, HealthRailSection |
| **Orders** | standing orders: conditional verbs taken while you are away, each with an expiry | (new; #347) |
| **Focus / Away** | attention postures: Focus holds everything that doesn't break through; Away hands the console to your orders | Notification settings, "do not disturb" |

"Ask" stops meaning two things. The run posture Ask / Balanced / Autonomous becomes **Gate every step / Gate by risk / Auto**. Asking a question is Talk.

---

## 3. Anatomy of the console

Five bands, top to bottom. Skins may move or restyle them but not remove them, because the behaviours hang off them.

1. **Engagement bar.** `Fleet`, then one tab per engagement (Northwind Bank, Helix Payments, Orbital Retail, House), then `+`. Each tab shows only its worst state: nothing / ◆ waits on you / ▲ broke. On the right: **Open · Focus · Away**, and the **tray** (seats 5/5 · bus · dead letters · spend today · orders 3), dark while healthy, lighting one item when it isn't.
2. **Strip board.** The one ranked list of decisions, as dense one-line strips across the full width: `clock | engagement | decision | what commit does | who waits | key`. It shows at most five strips; the rest are counted ("+6 ranked below"). Alike strips fold into one group strip. New arrivals wait below a `2 new, ranked` divider until you reach them. When nothing waits, the board is a single line: "Nothing needs you. 9 runs working, on pace." In **Focus** and **Away** the board collapses to a held count, and its strips become **marks** (small amber or red diamonds) on the Fleet rails they belong to.
3. **Canvas.** One object at full size: the Fleet, a Plan graph, a Campaign graph, an Artifact (RFP draft, diff, demo cut, POV paper), a Part, a Board, or the Log. A breadcrumb gives the address (`fleet › helix › H1 ledger-migration › build › step 2`). `g` + letter jumps, `b` goes back.
4. **Inspector (sheet).** Opens when something is selected; closed otherwise. **Facts** (state, score, owner, clocks, evidence, parts used) and **Verbs** (every applicable verb with its key; disabled verbs say why). A tab switches Facts to **Raw** for the same object. At desktop width it docks on the right of the canvas; at phone width it is a bottom sheet.
5. **Command line.** The **Talk prompt** shows the address of the selection (`helix/H1#build.2 ›`). Typing a sentence is Talk; typing `:` starts a verb (`:approve`, `:add review`, `:reassign codex`); typing `>` goes raw (`>events`, `>term`, `>ps`, `>source`, `>bus`). ⌘K focuses it. The line also carries the **selection tray** ("4 gates selected · alike"), the **undo bar** (10 s countdown) and the **Talk drawer** handle: `↑` opens the drawer above the line with the current scope's recent thread from the Log.

At phone width the bands stack: engagement bar (scrolls), strip board, canvas as one column, the inspector as a sheet, the command line docked at the bottom.

---

## 4. The grammar: select, then act

### 4.1 The verb registry

`src/verbs/registry.ts` (new) is the single source of truth. Each entry is `{id, label, objects[], route, key, preview, undo, bulk, disabledWhen, since}`. Buttons, the inspector, the command line, strip default verbs, keyboard shortcuts, Talk's proposed verbs and standing orders all read it. A CI test (`tests/verbCoverage.test.ts`) joins `endpoint-manifest.json` with the registry and fails when a user-action route has no verb; read-only routes are allow-listed by name.

| Object | Verbs (key) |
|---|---|
| Fleet / selection of runs | new intent `n`, new campaign `N`, resume `u`, cancel `k`, archive `A` (bulk `POST /runs/archive`), approve alike `a`, filter `/`, save as board `B`, hold `h` (crew: not yet) |
| Engagement | brief `i`, new intent `n`, preset row `1`–`7`, board `g b`, Log `g l`, attach repo, members, edit boundary, archive |
| Campaign | add plan, add dependency, failure policy, concurrency, cancel `k`, resume `u`, raw `R` |
| Plan (run) | approve plan `a`, edit plan `e`, add phase `+`, raise floor `!`, save as preset `S`, resume `u`, cancel `k`, fork `f` (`retryOf`), revise PR `F`, guidance `G`, deliver `d`, outbound `o`, evidence `E`, raw `R`, capture `y`, hold `h` (not yet), cap (not yet), re-file (not yet) |
| Phase | add step, remove (unless floor), move, set gate, set executor, catalog entry |
| Step | talk to owner (select + type), reassign seat `s`, retry step `r`, output `O`, raw `R`, terminal `t`, worktree `w`, capture `y` |
| Member (seat) | talk, reassign its steps `s`, sign in, standing, un-bench (not yet) |
| Monitor | read findings, talk, raw |
| Gate | approve `a`, reject `x`, request changes `c`, approve and steer `A`, edit plan as answer `e`, answer elicitation, peek `p` |
| Finding | side with finding `c`, dismiss with reason, send to council `v`, anchor, capture `y` |
| Council | positions, re-convene, accept ruling, override (records dissent) |
| Artifact | open, version, fork, compare, comment, export, theme, source, record (demo), delete, capture `y`, outbound `o` |
| Terminal | attach, resize, close, rename, link to step |
| Part | open, edit, save, enable/disable, retire, run (eval), import, publish, reset, author by Talk |
| Repo | onboard/reindex, graph, blast radius, requirements, capture learnings, history |
| Strip (queue row) | its default verb, peek `Space`, open `Enter`, hold 30 min `z`, delegate to an order `d` |
| System | health, diagnostics, replay dead letters, settings, config, whoami, audit, live bus |

### 4.2 Selection is first-class

- Click selects one object. `x` or shift-click adds; a selection can span runs and engagements.
- **Alike** is computed over a selection: same gate kind, same band, same evaluator verdict, no open findings, same boundary rules. An alike selection offers the bulk form of a verb. A mixed one offers only verbs every member supports, and says which members block the rest ("H1 blocks approve: HIGH finding open").
- A group strip is a pre-made alike selection. `a` on it selects its gates and runs the preview.
- The Talk prompt follows the selection: `4 selected ›`. A sentence to a selection comes back as a proposed bulk verb.

### 4.3 Preview, commit, undo, for every verb

Every state-changing verb has three beats. **Preview** says exactly what will happen: a plan diff with ghost nodes and the new score, the gate answer and who it unblocks, the list of runs a bulk archive touches. **Commit** is `Enter`. The **undo window** holds the commit for 10 s in `board/undoQueue.ts` before it is sent; the strip or rail it came from **greys and slides down** during the window instead of vanishing, and `u` takes it back. Verbs that can't be taken back once sent (deliver, cancel, retire a rule, delete a doc) use a typed confirm and say so on the button.

### 4.4 Verbs that crew can't do yet

A registry entry may carry `disabledWhen: {crew: 'not-yet', until: 'S10', instead: '<verb id>'}`. The inspector draws it greyed with the reason **"crew: not yet"** and the nearest working verb ("Hold needs crew. Instead: steer the PA in Talk, or cancel `k`"). When the crew route lands, the entry flips to enabled and nothing else in the UI changes. The coverage test counts these rows separately so they can't be forgotten.

---

## 5. The primary objects: plan graph, Fleet, campaign

### 5.1 Plan graph anatomy

- **Rail.** Phases left to right as the PA composed them: understand → design → build → test → review → deliver, plus extras (scope, security review, scrub, record).
- **Steps** stack under their phase. Each shows its owner (`pa`, or claude, codex, pi, copilot, opencode), its state (queued / claimed / checkpoint / done / failed / reworked 1 of 2) and its latest checkpoint ("editing ledger/writer.rs").
- **Gates** are diamonds between phases, one per kind: plan_approval, intake, unit_review, team_dispute, team_transport, deliver. Hollow while closed, amber while waiting on you, green once passed.
- **Monitors** hang above the rail, bound to the steps they watch (pi on contracts, copilot on tests). A finding pins to its step as a red or amber flag.
- **Councils** appear as a node only when called, showing subject, positions and ruling.
- **Cross-run dependencies** are stubs at the rail's ends ("◂ waits on N1 review", "▸ unblocks H2").
- **Score meter.** Score 0–100, band, `high risk` when ≥70 or destructive, the reasons (41 dependents, contract_change on `PostEntry`), and the floor. Floor phases carry a lock.
- **Team comms line.** Under the rail, one folded line of **Murmur** ("14 team messages · 2 advice · 1 help · last: codex claimed build.2"). Say items (findings you must see, rulings, plan revisions that raise the band) are drawn on the graph itself. `m` opens the whole conversation in order.

### 5.2 Composing (before launch)

- `n` (or a sentence in Talk that the PA classifies as **intent**) opens a draft plan on the canvas with the **Parts tray** on its left: Presets (with the launcher row first: Write · Design · Rethink · Solve · Build · Demo · Test), Phases (catalog), Seats, Repos, Skills, Rules.
- The PA proposes a plan (`POST /plans/preview`); the ghost graph appears with floor phases locked. Drag a phase from the catalog onto the rail, or `+` and type. Every edit re-runs the preview; the meter moves.
- Header chips, not a popover: engagement, lead seat, seat pool, gate posture (Gate every step / Gate by risk / Auto), delivery (PR / none), deliver gate (human / auto), campaign.
- `L` previews launch, `Enter` commits `POST /runs` (10 s undo). `S` saves the plan as a preset (`PUT /presets/:name`).
- **Launch as campaign** `N` turns the canvas into a campaign graph (§5.4).

### 5.3 Editing live

The same canvas, lit. Every edit (add a phase, raise the floor, reassign, retry a step) previews first. The ratchet shows the new score and whether the change **pauses the run for plan approval** (moving into HIGH always pauses). Commit calls `POST /runs/:id/plan` with a `requestId`; it lands at the next step boundary. A phase inserted after its natural spot has passed carries a `late` tag. At a plan_approval gate the canvas shows the **plan diff** (rev 2 → rev 3; added nodes marked by who added them: floor / PA / member / you). Answer with Approve, or Edit plan as the answer (`action: edit_plan`).

### 5.4 The Fleet (graph of graphs)

- One **rail per run** at 1/8 scale in engagement lanes: phase dots, gate diamonds, the cursor, member initials on the active step.
- **Dark when healthy.** A working, on-pace rail is drawn at 35% ink with one status word. Rails with an open gate, a finding, a stall or a failure are full contrast. An all-healthy lane collapses to one line ("Orbital · 2 runs · on pace").
- **Cross-run connectors** between rails (N3 waits on N1 §4 review; H2 waits on H1 build). A connector turns amber when the upstream run waits on you, and the strip for that gate carries "blocks 2 runs".
- **Terminals are objects in the Fleet.** Each open terminal is a thin row in its engagement lane (`term · helix-core worktree · codex PTY (read-only) · 2h`), so a shell you opened last night is findable. `>ps` lists runs and terminals together in one table.
- Selecting rails gives Fleet verbs: resume, cancel, archive, approve alike, save as board (and hold, once crew has it).
- In Focus and Away the strip board's strips become **marks** on these rails.

### 5.5 The campaign canvas

`N` on a draft plan, on the Fleet, or on an engagement opens a campaign graph. Each node is a plan (drafted from a preset). Drag between nodes to draw dependencies. Set the **failure policy** (fail_fast / continue_independent / human_gate_on_failure) and **concurrency**. The preview lists every plan with its score and which will pause. `Enter` commits `POST /campaigns`. A running campaign shows as a bracket around its rails in the Fleet; `Enter` on the bracket opens the canvas with node status, the verdict ladder (`/runs/:id/acceptance` per node) and the delivery rollup. Verbs: cancel `k`, resume `u`.

---

## 6. One path for all work, and the FDE vocabulary

All work is **intent → PA scores and composes a plan → approve or auto → team works (dark unless it breaks) → review gate (outcomes plus team comms) → deliver gate or outbound**. Execute, Test, Vibe, Demo and Chat are presets of that path.

**The launcher row.** The FDE's own vocabulary is a row of seven preset buttons, shown in Parts › Presets and at the top of each engagement tab's canvas: **Write** (RFP sections, papers, status notes: preset rfp-section, pov-paper, docs), **Design** (architecture: design-review), **Rethink** (process: domain extraction, process map), **Solve** (a hard problem: investigate + council), **Build** (code: feature, bug), **Demo** (script, seed, record), **Test** (qe-recon, qe-author, evals). Pressing one opens the composer with that preset loaded and the Talk prompt at the draft (`northwind/draft ›`). They are presets, not places: nothing about them has its own page, and each one saves, edits and deletes like any other preset.

| Stage | RFP: Northwind Bank §4 "Security & Resilience" | Code: Helix ledger migration to idempotent writer | Demo: Orbital Retail returns-triage exec demo | POV paper: "Evaluators you can't bribe" (House) |
|---|---|---|---|---|
| Intent | `northwind ›` "Draft §4 from the controls library and last year's answers, 1,500 words" | `helix ›` "Move ledger posting to the idempotent writer; keep the v2 API" | `orbital ›` "6-minute walkthrough of returns triage for the COO, Thursday" | `house ›` "2,000 words from our last three engagements' QA learnings" |
| Plan & score | **Write** → rfp-section. No repo, so the PA judges **34** from content (regulated claims). Floor adds review | **Build** → feature. 41 dependents, contract_change on `PostEntry` → **58**; floor adds test + review | **Demo**. Read-only scope step, then script → seed → record → review. **22** | **Write** → pov-paper. **18**. The boundary adds a scrub step because it draws on client work |
| Approve / auto | Gate by risk: pauses (34 ≥ your threshold 30) | Pauses (Gate every step on Helix) | Auto under 40 | Auto |
| Team works | claude drafts; codex checks claims against the controls library; a monitor flags "RTO 15 min: unsupported" | codex builds; pi monitors contracts; copilot tests. You add a security review mid-run → **76 HIGH** → pauses | opencode seeds data and stalls; you reassign to codex; claude records | claude drafts; scrub strips client names; a monitor checks citations |
| Review gate | Prose diff with claims anchored, plus team comms | Diff + findings + PA replies + council ruling | Video with finding timestamps | Text with the scrub diff |
| Deliver / outbound | Export to portal format; status note to the bid manager (Copy) | Deliver gate → PR; status note to Helix's platform lead (Copy) | Link + cover note (Copy) | Draft to the marketing reviewer, queued |

**New engagement.** `+` on the engagement bar opens a short sheet (or `helix ›`-style Talk: "new engagement Kestrel Logistics"): name, repos, and the **confidentiality boundary**: client terms that must never leave (names, sites, contract values, people), and whether patterns may be shared. The boundary drives capture's scrub, cross-engagement Talk and preset sharing.

---

## 7. Where chat lives: Talk on the command line, history in the Log

### 7.1 One input whose target is visible

Talk is the command line. It is on every screen, and its **prompt is the address of the selection**:

| Prompt | Talk goes to | Wire (release 1) |
|---|---|---|
| `fleet ›` | the console lead, across engagements: patterns and your own memory only, no client detail | `POST /chats` scope `everything` |
| `house ›` | the House lead, your practice | `POST /chats` scope `project` (House) |
| `northwind ›` | the engagement lead, grounded in its repos, docs, memory | `POST /chats` scope `project` |
| `helix/H1 ›` | that run's PA | `POST /runs/:id/inject`; plan changes via `POST /runs/:id/plan` |
| `helix/H1#gate ›` | the open gate: your sentence becomes the amend on request changes, or the steer on approve-and-steer | `POST /runs/:id/gate` |
| `helix/H1#build.2 ›` | that step's member (codex) | `POST /runs/:id/inject` with target CLI |
| `northwind/§4-draft ›` | the document's thread | interactive `chat.posted` |
| `parts/rule SEC-014 ›` | an authoring run | `POST /governance/steering/author` |
| `4 selected ›` | a proposed bulk verb over the selection | registry bulk verb |

`@seat` overrides the target inside a run. `@team` fans out to the warm seats; the answers come back as **one message in columns**, one per seat (`POST /chats/:id/seats` + messages). The prompt changes the moment the selection changes, so there is no scope picker to keep in sync. `Esc` in Talk re-selects the engagement (`northwind ›`); `Esc` again goes to `fleet ›`. `g h` goes to `house ›` from anywhere.

### 7.2 One sentence, one of four outcomes

The PA classifies every sentence. Studio never guesses with keyword detectors (`detectWorkflow` is deleted).

| Outcome | Example | What comes back | Commit |
|---|---|---|---|
| **answer** | `northwind ›` "What did we say about RTO last year?" | a grounded answer with citations, filed in the Log | none |
| **intent** | `orbital ›` "Record the returns walkthrough for Thursday" | a plan preview inline (preset guess, score, floor) with Launch / Edit plan | `L`, `Enter` → `POST /runs` |
| **compose** | `northwind ›` "Add a tile: §§ done vs submission, warn under 80% two days out" / "draft the status to Priya" / "while I'm away approve LOW reviews on Helix" | a ghost tile, an outbound draft, or a draft order | `Enter` |
| **steer** | `helix/H1 ›` "Keep the v2 route names" / `helix/H1#gate ›` "Key on (tenant_id, entry_id)" | inject preview, or the amend on a gate answer | `Enter` |

Intent and steer come back as **registry verbs** (new intent, edit plan, inject, answer gate), so they take the same preview, undo and audit path as a key press. Nothing Talk proposes changes state until you commit it.

Release 1 has no classifier route. The scope's PA chat is briefed to return a typed proposal (`{outcome, payload}`) in its reply, and studio renders the proposal. Scopes at a gate or on a step default to **steer**. Release 2 replaces the convention with `POST /line {scope, text}` → `answer | intent | compose | steer`, a typed contract (see §16, crew C9 and Question 1).

### 7.3 The Log: one history per engagement

Every Talk thread is filed into its engagement's **Log** (House for the House and Fleet scopes). The Log is one ordered stream per engagement: your Talk threads, Say messages from runs (plans proposed, gates opened and answered, rulings, drafts), orders fired, and captures. It is the central history you come back to. `g l` opens it on the canvas; `↑` on the command line opens the **Talk drawer**, which is the last screenful of the current scope's Log. Closed threads stay readable. `:log <text>` searches every engagement's Log.

Release 1 folds the Log in studio (`board/log.ts`) from existing routes: `GET /chats` (scope project), `GET /projects/:id/activity`, `GET /projects/:id/prompts`, gates and team events from `/ws` and `/runs/:id/events`. Crew-new `GET /chats?closed=1&scope=` later adds closed transcripts that studio didn't see live.

### 7.4 Two volumes of team traffic

`board/track.ts` (pure, from thread-first) classifies each team event: **Say** = gates, plan.proposed/revised that need approval or raise the band, council.ruled, finding.raised{high} in the diff, ledger at review, drafts, orders fired. Everything else is **Murmur**: claims, checkpoints, advice, help, monitor chatter. The plan's team comms line, the Log and Talk all use this split. Murmur is folded into one live line and never opens itself; the review gate shows it in full.

---

## 8. Attention: strips, Focus, breakthrough, anti-fatigue

- **Consequence clock first.** Every strip starts with its clock: `40m to freeze`, `blocks 2 runs`, `leaves machine`, `waiting 3h`. Rank = `needsYou.compareNeeds` + deadline + band + downstream waiters + external-facing flag.
- **Moved because.** When a strip changes rank, the gutter says why for one refresh: `moved up: dispute blocks 2 runs`.
- **Never re-rank under the cursor.** While the cursor is on the board, the order is frozen. New arrivals appear below a `2 new, ranked` divider and join the rank when the cursor leaves or you press `.`.
- **Fold alike and fold per run.** Alike strips across runs form one group strip ("4 unit reviews · LOW · evaluator pass · no findings"). Several strips from one run fold into one ("H1: HIGH finding + dispute · 1 decision").
- **Grey and slide.** A committed strip greys and slides to the bottom for its 10 s undo window, then leaves.
- **Focus** (`⌘.` or the posture switch) holds everything that doesn't break through. `board/focus.ts`: `breaksThrough(row) = row.severity === 'high' || deadlineWithin(row, 2h)`. The board collapses to `11 held · nothing urgent`, and held strips become marks on the Fleet rails. A breakthrough arrives as a **breakthrough bar** across the top of the canvas: one sentence and two actions, **Open** and **Hold 30 min**. Nothing else moves.
- **Away** hands the console to your orders (§14 M15) and keeps the same marks.
- **`d` delegates.** On a strip or group strip, `d` drafts a standing order from it ("next time: approve LOW unit reviews on Helix with no findings"). The draft appears in Talk as a **compose** outcome with a preview of what it would have done today. Repeated decisions become orders.
- **`z` holds a strip 30 min** (client-side snooze, audit-logged).
- **No toasts.** Interruptions are strips; in Focus only breakthroughs.

---

## 9. Boards: dashboards you compose by Talk and inline

- A Board is a saved **lens on the Fleet** (a filter over runs, engagements, campaigns) plus **tiles** from a registry built on `dashboardKit` (StatTile with an honest delta and sparkline, KpiBand, list, gauge-vs-deadline, rail strip, gate latency from GateLatencyChart). Spec: `{lens, tiles:[{kind, fold, threshold, needs_me, span}]}`, stored in the `studio.boards` settings key (release 1, existing `PUT /settings`).
- **Dark by default.** A tile is a one-line reading until it crosses its threshold. A lit tile marked `needs_me` emits a strip.
- **Add via Talk.** With the Board selected (`northwind/board ›`): "add §§ done vs submission, warn under 80% two days out" → compose outcome → a ghost tile in the next slot → `Enter`.
- **Add inline.** `+` on any empty slot → kind × fold picker → preview → commit. `p` on any number in the console (a score, a finding count, a word count, today's spend) pins it as a tile.
- **`> source`** on every tile shows its lens, fold and the raw rows it was computed from.
- `B` on a Fleet selection saves the filter as a Board. `g b` opens the engagement's Board. Boards never replace the Fleet as the landing view.

---

## 10. Raw, one step from any object

- `R` on any object switches the inspector to **Raw** for that object. **Events**: its rows (a run's CoreEvents, a step's `wicked.team.*` rows, a gate's opened/decided). **Worktree**: files and diff, "open in Finder" (`POST /open`). **Terminal**: a shell in the worktree (`t`) or read-only attach to the member's PTY (`/ws/terminals/:id`). **Config**: the effective config (launch body + plan def rev, a seat's roster entry, daemon `/config`). **Source** (tiles, Board numbers, strips): the query and the rows.
- `>ps` lists runs and terminals together (engagement, kind, intent or cwd, seat, step, age, state). Terminals opened in studio are tracked client-side in release 1.
- `>bus` is a live tail of every `wicked.*` row on `/ws`, filterable by run, engagement and type. The historical bus browser is crew: not yet (`GET /bus`).
- `>worktrees` shows each run's worktree through `/runs/:id/files`; the cross-run list with size and sweep is crew: not yet.
- Deep-link routes `/runs/:id/events` and `/runs/:id/files` stay and render Raw full-width.

---

## 11. Capture, outbound and orders

- **Capture `y`** on any object (a Talk exchange, a finding, a step, a tile, a paragraph) opens a capture card split into **Pattern (crosses engagements)** and **Client detail (stays here)**. Detected client terms from the engagement boundary are **struck through** in the pattern ("~~Northwind~~ → the client", "~~Priya Raman, CISO~~ → the CISO", "~~INC-40213~~"). Pick a target (steering rule / memory / preset step / eval sample), commit, and it becomes a proposal (`/proposals`) that appears as a strip in the evening.
- **Outbound `o`** on a plan or artifact drafts from the work (`GET /runs/:id/deliver-text`). **Copy** works now. Mail and Message buttons are visible and disabled ("arrives with the first integration").
- **Orders.** An order is a sentence, its parsed rule, a scope, an **expiry** ("until Fri 18:00") and a preview of what it **would have done today** ("would have approved 3 unit reviews on Helix; would have queued 1 draft"). Orders never answer deliver or plan-approval gates, and always queue outbound unless a send policy approves it. Tomorrow's handover lists what each order did.

---

## 12. The day's moments

Each moment: why you're here, what you see, what you do, what powers it. The prototype walks through all fifteen.

### M1. Arriving (08:40, away 14 h)
- **See:** the Fleet under a **handover overlay** with fixed sections (decisions / broke / finished / system / orders), each line anchored to its rail. "Order 'LOW reviews on Helix' approved 2 unit reviews; queued 1 status draft to Northwind, sent 0."
- **Do:** `Enter` takes the top strip. `i` on a tab gives its switch brief. `Esc` dismisses; the lines stay as marks on the rails.
- **Powers:** B1 handover (lifted into the shell), B2 dark, B10 orders; `GET /audit?since=`, `path.ended`, `gate.opened`, `ledger.folded`.

### M2. Supervising the fleet: 11 runs, 3 engagements plus House
- **See:** four lanes. Dark rails ("working · on pace"); three lit (N4 plan approval, H1 HIGH finding, O1 stalled seat); four small amber diamonds folded into one group strip. Connectors: N3 waits on N1, H2 waits on H1. A terminal row in the Helix lane.
- **Do:** click to select, `x` to add; the inspector shows shared verbs and which rails block the rest. `Enter` opens, `p` peeks, `>ps` shows runs and terminals in one table.
- **Powers:** B2, B4, B3; `GET /runs`, `GET /campaigns`, `/ws`.

### M3. Composing a plan and launching it
- **See:** `northwind ›` "Draft §7 Operational Resilience from the controls library". PA answers **intent**: Write → rfp-section, score 34, floor adds review. The Parts tray with the launcher row.
- **Do:** drag "security review" from the catalog; the meter moves 34 → 41. Set lead seat and posture chips. `S` saves as preset. `L` previews, `Enter` launches; the new rail appears in the Northwind lane, greyed for 10 s undo.
- **Powers:** B5; `GET /catalog`, `POST /plans/preview`, `POST /runs`, `PUT /presets/:name`.

### M4. Launching a campaign
- **See:** Helix: "Contract tests across the four consumers of `PostEntry` after H1". Four plans, dependencies drawn from H1, failure policy human_gate_on_failure, concurrency 2.
- **Do:** drag a dependency, change policy, `Enter` → `POST /campaigns`. The bracket appears on the Fleet. `k` cancels, `u` resumes.
- **Powers:** B5; `POST /campaigns`, `/campaigns/:id/cancel|resume`.

### M5. Editing a live plan: add a security review
- **See:** H1: build (codex) active, test (copilot) queued, pi watching contracts.
- **Do:** `+` after test, "security review". Ghost node; ratchet **58 → 76 HIGH** (touches auth token scope); "pauses for plan approval at the next boundary". `Enter` → `POST /runs/:id/plan`. Rail shows rev 3 pending, then a plan_approval diamond.
- **Powers:** B5; `plan.revised`, `gate.opened{plan_approval}`.

### M6. Deep work, interrupted (Focus)
- **See:** Focus on the Northwind §4 draft. The strip board reads `5 held · nothing urgent`; held strips are marks on the Fleet mini-map. A **breakthrough bar**: "Helix H1 · HIGH finding · idempotency key drops tenant_id · blocks 2 runs".
- **Do:** **Open** (jump to the finding; `b` returns to the paragraph) or **Hold 30 min** (the bar folds into the held count, and comes back at 11:12).
- **Powers:** B3, B4, `board/focus.ts`; `finding.raised{high}`, `store/place`.

### M7. Many things colliding
- **See:** pi's HIGH finding on H1, the PA declines the advice, the council is called and rules **NO 3–1**, opening a team_dispute gate. O1 stalls. N4 waits for plan approval. The board shows `moved up: dispute blocks 2 runs`, folds H1 into one strip, and holds two new arrivals below `2 new, ranked`.
- **Do:** on the dispute: **side with the finding** (request changes with amend "key on (tenant_id, entry_id)"), **accept the ruling**, or **re-convene**. On the N4 strip: `d` → Talk shows a draft order "approve Northwind plans under band 40 with no floor changes" with "would have approved 3 this week".
- **Powers:** B4, B10; `finding.raised`, `advice.answered`, `council.called/ruled`, `gate.opened{team_dispute}`.

### M8. Acting on agents and steps
- **See:** O1 "seed returns data", opencode, quiet 22 min, escalated (dead_seat). Seat standing: 2 failures in the last hour, benched.
- **Do:** `s` lists seats with standing; pick codex; preview "restarts step 3 from checkpoint 4; evaluator stays claude"; `Enter`. On the member opencode: **un-bench** is greyed ("crew: not yet · instead: reassign its steps `s`"). `r` retries a step; `@` via Talk at `orbital/O1#seed ›` advises the member.
- **Powers:** B5; `workerStallEscalated`, `GET /roster`, `POST /runs/:id/reassign`.

### M9. Bulk actions
- **See:** a group strip "4 unit reviews · LOW · evaluator pass · no findings" across N2, H3, H4, O2; five terminal runs finished yesterday.
- **Do:** `a` on the group → preview of four answers (evaluator ≠ creator on each, what each unblocks) → `Enter`. Four strips grey and slide; the undo bar counts 10 s; `u` takes one back. Then select the five finished runs, `A` → `POST /runs/archive`.
- **Powers:** B4, B5; `board/batchGates.ts`, `POST /runs/:id/gate` × 4 with `ord`, `POST /runs/archive`.

### M10. Reviewing a team run
- **See:** N1 §4 at unit_review. Outcomes: prose diff, 41 of 42 claims anchored to control IDs, one flagged (RTO 15 min). Team comms: codex's finding, the PA's reply and fix, a help request to claude, the monitor settling it. Murmur folded ("11 more"). The evaluator (codex) is not the creator (claude).
- **Do:** approve `a`, or tick the held findings and press `c`: the amend text is composed from them ("Remove the 15-minute RTO claim or cite control BCP-07; …"), editable in Talk at `northwind/N1#gate ›`. Capture `y` on the RTO exchange.
- **Powers:** `GET /runs/:id/team`, `step.reviewed`, `ledger.folded`, gate.

### M11. Talk and the Log
- **See:** `house ›` "What's the strongest counterargument to 'evaluators you can't bribe'?" `@team` fans out; the answer comes back as **one message in columns** (claude, codex, pi). The Log for House shows it filed beside yesterday's thread.
- **Do:** "pin a tile: disputed findings this week by engagement" → compose outcome → ghost tile → `Enter`. `g l` opens the Log; `:log RTO` finds the Northwind thread from last month.
- **Powers:** `/chats`, `/chats/:id/seats`, `board/log.ts`, `board/track.ts`.

### M12. Going raw
- **See:** H1 build step. `R`: Events (`wicked.team.*` rows), Worktree (files, diff, open in Finder), Terminal (shell in the worktree or read-only codex PTY), Config (launch body + plan def rev 3).
- **Do:** `t`, run `cargo test -p ledger`. `>ps` shows the new terminal beside runs. `> source` on the Board's "claims anchored" tile shows the fold and rows. `>worktrees` shows per-run worktrees; the sweep verb is greyed "crew: not yet".
- **Powers:** B6; `/runs/:id/events`, `/runs/:id/files`, `/terminals`, `/ws/terminals/:id`.

### M13. Capturing
- **See:** `y` on the RTO exchange: Pattern "RTO/RPO claims must cite a control ID or be removed" with ~~Northwind~~, ~~Priya Raman~~, ~~INC-40213~~ struck through; Client detail stays in Northwind.
- **Do:** target "steering rule · compliance", commit. It becomes a proposal and a strip in the evening.
- **Powers:** B8 (#348), boundary.

### M14. Delivering and outbound
- **See:** H3 settlement fix at the deliver gate: diffstat (4 files, +61 −18), target PR, acceptance pass, the outbound draft.
- **Do:** `d` with typed confirm (`deliver H3`). `o` → Copy; Mail/Message disabled.
- **Powers:** B9; deliver gate, `/runs/:id/diff`, `/runs/:id/acceptance`, `/runs/:id/deliver-text`.

### M15. Leaving with standing orders
- **See:** Away opens the overnight sheet: what keeps running, what stops at gates, the orders in force, each with its parsed rule, expiry and **"would have done today"**.
- **Do:** "Approve LOW unit reviews on Helix with no findings until Friday; wake me for HIGH; draft the Northwind status at 17:00". Preview: the draft is **queued, not sent**. Deliver and plan-approval gates are listed as "will wait for you". Commit.
- **Powers:** B10 (#347), B1.

**Between moments: switching engagements (B7).** A tab click (or `1`–`4` with nothing selected) shows a brief first: what changed there since your last visit, what waits, where you were. The canvas and selection you left are restored.

---

## 13. Capability coverage

Every row of the 108-row inventory has a home and an action path. "Not yet" rows are registry verbs that draw greyed with "crew: not yet" and name the working verb to use meanwhile; they light up in slice S10 without UI change. Keys: single keys act on the selection; `g x` jumps; `:` verbs; `>` raw; a sentence is Talk.

| # | Capability | Where (object → place) | Action path | Keyboard |
|---|---|---|---|---|
| **Run lifecycle** |||||
| 1 | Launch a run | Plan (draft) → canvas composer | Talk intent or `n` / preset row → edit graph → `L` → `Enter` | `n`, `1`–`7`, `L` |
| 2 | Preview a launch | Plan (draft) → score meter | live on every edit; full preview on `L` | `L` |
| 3 | Retry a run | Plan (terminal) → inspector | `f` fork → draft with `retryOf` → launch | `f` |
| 4 | Revise a PR | Plan (delivered) → inspector | `F` → draft with `revisesPr` | `F` |
| 5 | List and browse runs | Fleet; `>ps`; `:runs` | select rails, `/` filter, `Enter` | `g f`, `/` |
| 6 | Watch a run live | Plan graph + step output + team comms line | select step → `O`; `m` for Murmur | `O`, `m` |
| 7 | Cancel a run | Plan / Fleet selection | `k` → typed confirm | `k` |
| 8 | Resume a run | Plan (paused, not gated) | `u` (`POST /runs/:id/resume`) | `u` |
| 9 | Pause a run | Plan → verb **hold** | not yet (crew C4); meanwhile the next gate holds it, steer via Talk, or `k` cancel | `h` |
| 10 | Inject a message | Talk at `…/H1 ›` or `…#step ›` | type → steer preview → `Enter` | type |
| 11 | Pre-gate guidance | Plan → Facts › Guidance | `G` edit the one note | `G` |
| 12 | Reassign a seat | Step / member → inspector | `s` → seats with standing → preview → `Enter` | `s` |
| 13 | Archive a run | Plan (terminal) | `A` | `A` |
| 14 | Bulk archive | Fleet selection | `x`… `A` → preview lists runs → `Enter` | `x`, `A` |
| 15 | Run artifacts | Plan → Raw › Worktree | `R` → Worktree; open in OS | `w` |
| 16 | Raw event log | any object → Raw › Events | `R` | `R`, `>events` |
| 17 | Evidence | Plan → Facts › Evidence | `E` view (bundle download kept) | `E` |
| 18 | Acceptance verdict | Plan Facts; review and deliver gates; campaign ladder | read in place | — |
| 19 | Team view | Plan graph: members, monitors, ledger, team comms | select member → Facts; `m` whole conversation | `m` |
| 20 | Delivery | Plan → deliver gate / Facts › Delivery | `d` (typed confirm); post-hoc on stranded | `d` |
| 21 | Outbound draft | Plan / artifact → inspector; Talk compose | `o` → Copy (Mail/Message later) | `o` |
| 22 | Provenance / decisions | Plan → Facts › Why | expand why seat / skill / route; audit rows | `?` on a fact |
| **Plans, presets, catalog** |||||
| 23 | Phase catalog | Parts › Phases (composer and live edit tray) | drag onto rail, or `+` and type | `+` |
| 24 | Presets | Parts › Presets; launcher row on each engagement | press a preset, or the PA proposes one | `1`–`7`, `:preset` |
| 25 | Preset management | Parts › Presets; Plan | `S` save; open → edit / delete | `S` |
| 26 | Workflows | Parts › Workflow defs | open def → graph; builder; save script | `:workflow` |
| 27 | Plan editing mid-run | Plan graph (live) | `+`, `e`, `!` → ratchet preview → `Enter` | `+`, `e`, `!` |
| **Gates** |||||
| 28 | Read the open gate | Gate diamond; strip | select diamond or strip; `Space` peeks | `j`/`k`, `Space` |
| 29 | Answer a gate | Gate → inspector; Talk at `…#gate ›` | `a` / `x` / `c` (amend from ticked findings or Talk) / `A` | `a`,`x`,`c`,`A` |
| 30 | Batch gates | Group strip / alike selection | `a` → preview → `Enter` | `a` |
| 31 | Plan-approval gate | plan_approval diamond → plan diff on canvas | `a`, or edit the graph and `e` answer | `a`, `e` |
| 32 | Intake gate | intake diamond → step list | approve / edit | `a` |
| 33 | Evaluator deny / unit review | unit_review diamond → verdict in Facts | read verdict; answer | `a`,`c` |
| 34 | Deliver gate | deliver diamond → diffstat / full diff | `d` / `x` | `d` |
| 35 | Escalation gate | stall flag on step → strip | `s` reassign, or answer | `s` |
| 36 | Team dispute / transport | team_dispute diamond + council node; team_transport diamond + bus banner | side / accept / re-convene; replay outbox | `c`, `v`, `:replay` |
| 37 | Elicitation | Step → question in Talk at `…#step ›` | answer / decline / cancel | `Enter` |
| 38 | Attention routing | Strip board, handover, peek, Focus breakthrough, desktop notify | ranked strips with clocks and reasons | `Space`, `g`, `b` |
| 39 | Undo | Undo bar on the command line; greyed strip | `u` within 10 s | `u` |
| **Campaigns and groups** |||||
| 40 | Browse campaigns | Fleet bracket → campaign canvas | select bracket → `Enter` | `g c` |
| 41 | Launch a campaign | Campaign (draft) canvas | `N` → plans, deps, policy, concurrency → `Enter` | `N` |
| 42 | Campaign cancel / resume | Campaign → inspector | `k` / `u` | `k`, `u` |
| 43 | Group a run | Plan header "campaign" chip | set at launch; re-file after launch not yet (crew C6); meanwhile fork into the group `f` | `:file` |
| **Settings, budgets, spend** |||||
| 44 | System settings | System → Config | edit keys incl. stall, escalation, reassign budget, base skill | `g s` |
| 45 | Budgets | Engagement / plan header "cap" chip | not yet (crew C5); meanwhile a Board tile on live spend with `needs_me` threshold | `:cap` |
| 46 | Spend / burn | Tray "spend today"; plan Facts; tile | live stream now, pin with `p`; per-run history not yet (C5) | `p` |
| 47 | Daemon config | System → Raw › Config | read | `>config` |
| 48 | Identity | Tray → you | read whoami, trust level | `:whoami` |
| **Projects and repos** |||||
| 49 | Projects | Engagement bar `+`; engagement inspector | new (asks boundary) / edit / archive / restore | `:engagement` |
| 50 | Project members | Engagement → Facts › Repos | attach / detach | `:attach` |
| 51 | Activity / prompts | Engagement → brief and Log | `i`; `g l` | `i`, `g l` |
| 52 | Register a repo | Parts › Repos | add path or clone → onboarding plan on the Fleet | `:repo add` |
| 53 | Onboard / reindex | Repo → verb | `:reindex` → plan preview → launch | `:reindex` |
| 54 | Code graph | Repo → canvas | open graph | `Enter` |
| 55 | Blast radius (repo) | Repo graph; plan score reasons | select symbol → blast radius | `B` on symbol |
| 56 | Project graph | Engagement → graph | open / refresh | `:graph` |
| 57 | Project graph search + blast radius | Engagement graph → search | search, select, blast radius | `/` |
| 58 | Repo history / contributors | Repo → Facts | read | — |
| 59 | Domain model / requirements | Repo → Requirements; Parts › Domain (global) | list / override; global view | `:requirements` |
| 60 | Capture learnings | Repo → verb; preset Rethink | `:capture learnings` → plan preview → launch | `y` on repo |
| **Seats, roster, council** |||||
| 61 | Roster and standing | Tray seats 5/5 → Seat objects | select seat → standing, bench, auth | `g m` |
| 62 | Sign a seat in | Seat → verb | sign in → login PTY in Raw › Terminal | `:signin` |
| 63 | Benched seats | Seat → verb **un-bench** | not yet (crew C7); meanwhile reassign its steps `s` | — |
| 64 | Council chat | Talk with `@team` or several `@seats` | fan-out answers as one columned message; add seat | `@team` |
| 65 | Council in runs | Plan header seat pool; council nodes | set pool; see quorum, failures | — |
| **Health, diagnostics, bus** |||||
| 66 | Health | Tray (dark when healthy) | lights on failure; emits a strip | — |
| 67 | Diagnostics | System → Facts | open | `g s` |
| 68 | Dead letters | Tray "dead letters" (only when > 0) | open → list | — |
| 69 | Replay dead letters | Dead letters; team_transport gate | replay (preview count) | `:replay` |
| 70 | Bus / event stream | `>bus` | live tail now (filter run/type/engagement); history not yet (crew C8) | `>bus` |
| 71 | Audit trail | System → Audit; Facts › History on any object | filter by action, actor, since | `:audit` |
| 72 | Stall watchdog | Step flags; strips; thresholds in System config | read; set thresholds | — |
| **Skills** |||||
| 73 | Skills catalog | Parts › Skills; step Facts "parts used" | open | `:skill` |
| 74 | Edit a skill | Skill canvas (files) | edit, save (conflict guard), baseline diff | `e` |
| 75 | Add / replace / reset | Parts › Skills | add, replace, reset (typed confirm) | `:skill add` |
| 76 | Enable / disable | Skill → verb | toggle | — |
| 77 | Analyze / publish / baseline | Skill → verbs | analyze, publish, refresh baseline | — |
| **Steering** |||||
| 78 | Steering dashboard | Parts › Steering (a Board) | open | `:steering` |
| 79 | Rules | Rule objects; gate Facts "rules applied" | add, edit, preview matches | `e` |
| 80 | Retire a rule | Rule → verb | retire (reason + typed confirm) | — |
| 81 | Import steering | Parts › Steering → verb | import | `:import` |
| 82 | Author by chat | Talk at `parts/steering ›` or a rule | sentence → preview "starts a governed authoring run" → launch | type |
| 83 | Governance policies (legacy) | Parts › Steering › Policies | list, upsert, retire | — |
| 84 | Claims, coverage, graph | Plan Facts › Why; Parts › Steering | read | — |
| **Evals and testing** |||||
| 85 | Recon | Preset **Test** › qe-recon | preset row or Talk intent | `7` |
| 86 | QE author | Preset **Test** › qe-author | same path | `7` |
| 87 | Evals | Parts › Evals | run, list, drill | `:evals` |
| 88 | Import corpus | Parts › Evals → verb | import | — |
| 89 | Compare eval runs | Two eval runs selected | side by side now; flip diff not yet (crew C10) | `x` |
| 90 | Acceptance / verdicts | Plan Facts; campaign ladder | read | — |
| **Proposals, memory, knowledge** |||||
| 91 | Proposals | Strips; Parts › Steering › Proposals | approve / reject | `a`, `x` |
| 92 | Memories | Parts › Memory | browse by facet, retire subtree | — |
| 93 | Knowledge ask | Talk at `fleet ›`, `house ›` or an engagement | ask → answer outcome | type |
| **Documents** |||||
| 94 | Documents | Artifact canvas (from a plan, the Log, or an engagement) | open; edit via Talk at the doc | `Enter` |
| 95 | Versions | Artifact → version strip | select, fork, compare | `v` |
| 96 | Feedback | Artifact → pin comments | comment, submit batch | `;` |
| 97 | Render / export | Artifact → verb | export HTML/PDF/PPTX | `:export` |
| 98 | Themes / brand | Artifact → verb; Parts › Themes | learn, apply | — |
| 99 | Sources | Artifact → verb; Talk attach | attach | — |
| 100 | Delete a doc | Artifact → verb | typed confirm | — |
| **Demos** |||||
| 101 | Demos | Preset **Demo**; artifact (demo) canvas | storyboard, record, status, compare | `6`, `:record` |
| **Terminals, worktrees** |||||
| 102 | Terminals | Fleet terminal rows; `>ps`; Raw › Terminal; `>term` | open shell / attach read-only / resize / close | `t` |
| 103 | Worktrees | Raw › Worktree; `>worktrees` | per-run now; list + sweep not yet (crew C11) | `w` |
| **Notifications, appearance** |||||
| 104 | Notifications | Open / Focus / Away; System › Notifications | posture; desktop, chime | `⌘.` |
| 105 | Appearance / skins | System › Appearance | skin, accent, theme | `:theme` |
| 106 | Composer defaults | Composer chips remember the last value | — | — |
| 107 | Keyboard and palette | Command line; `?` overlay | — | `:`, `?` |
| **Standing orders** |||||
| 108 | Standing orders | Tray "orders"; Away sheet; Talk compose; `d` on a strip | sentence → parsed rule + expiry + "would have done today" → commit; retire | `d`, `:order` |

Coverage guard: `tests/verbCoverage.test.ts` joins `endpoint-manifest.json` with the registry. It fails on a user-action route with no verb, and it lists every `crew: not-yet` verb so the backlog stays visible.

---

## 14. What every current section and entry point becomes

| Today | Becomes |
|---|---|
| `/` HomeBoard (+ HomeCommand, KPI band, bands, verbs) | **Fleet** with the handover overlay on arrival |
| Left rail (Projects, Execute, Test, Vibe, Demo, Chat, Repositories, Skills, Steering, Evals, Settings) | Deleted. The engagement bar and the command line. Skills/Steering/Evals/Repos are **Parts** |
| `/p/:id` ProjectDashboard, `/p/:id/{chat,build,document,video}` + ModeSwitcher | Engagement tab: Fleet lane, launcher row, Board (`g b`), Log (`g l`) |
| `/p/:id/chronicle` WorkChronicle | Engagement Log |
| `/p/:id/campaigns`, `/testing/campaigns[/:id]`, CampaignScoreboard | Campaign canvas (DAG + ladder + rollup) |
| `/runs/new`, NewRunView, ChatInput, ContextPopover, PhasePicker, LaunchPreview | Plan composer on the canvas (§5.2) |
| `/runs/:id` ChatPanel, CenterDashboard, RightPanel | Plan canvas + inspector |
| `/runs/:id/{events,files}` RunRawView | Raw tab (routes stay as deep links) |
| `/work`, `/execute`, `/vibe`, `/demo`, `/make`, MadeDashboard | Fleet and `>ps`; the launcher row replaces the per-kind sections |
| `/chats`, `/chat/new`, `/chat/:id`, GroupChat, ChatsPage | Talk + the Log. `/chat/:id` redirects to the Log entry in its engagement |
| AskDock, AskLauncher, ⌘⇧A | Talk at `fleet ›` (⌘⇧A focuses it) |
| Steering Assistant, AuthorPanel | Talk at `parts/steering ›` |
| DocumentThread | Talk at the artifact |
| FollowUpComposer, "Continue in Build →" | `f` / `F` on a finished plan; Talk intent |
| Legacy `chat` runs | Read-only Log entries |
| `/repos`, RepoDetailPage, RepoGraphModal, RequirementsModal | Parts › Repos → Repo object |
| `/projects`, NewProjectModal | Engagement bar `+` (asks the boundary) |
| TestingLaunchPanel | Preset row **Test** |
| `/testing/evals` | Parts › Evals |
| `/steering/*`, ProposalsSection | Parts › Steering; proposals also as strips |
| `/skills`, `/workflows` | Parts › Skills, Parts › Workflow defs |
| `/system`, `/theme`, HealthRailSection, NotificationBell | Tray → System object |
| CommandPalette | The command line (`:` verbs, `>` raw, sentences are Talk) |
| 7 gate-answering places | One: the Gate object's verbs, reached from a strip, a diamond, `:` or Talk at `…#gate ›`. All call `gateActions.commitGateDecision` |
| RunsBottomPanel | Deleted. The Fleet is the run list |
| Terminal, AgentTerminal | Raw › Terminal; terminal rows in the Fleet |

---

## 15. What gets deleted

- **Components:** HomeBoard, HomeCommand, HomeKpiBand, EssenceStrip, LeftSidebar, RunsBottomPanel, GateNotifications, ApprovalDock (ElicitationPrompt moves to Talk), GateChip, BatchGateBar UI, MadeDashboard, CenterDashboard, ProjectDashboard, ProjectShell, ModeSwitcher, WorkPage, ChatsPage, AskDock, AskLauncher, AssistDock, AuthorPanel UI, GroupChat UI, NewRunView, ChatInput as a page, ContextPopover, FollowUpComposer, ChatPanel (1,299 lines), RightPanel, ProjectCampaignsView, TestingLaunchPanel UI, LegacyChatHistory route, NotificationBell inbox, HandoverPanel as a home widget.
- **Already dead:** ConnectionStatus, RunList, LiveOutput, ForceGraph, essenceEntries, `listWikiRuleSets`. **Kept and mounted:** PhaseLadder's step model seeds the rail renderer; GateLatencyChart becomes a tile.
- **Routes** (redirect through useLegacyRedirect): `/work`, `/execute`, `/vibe`, `/demo`, `/make`, `/chats`, `/chat/new`, `/runs/new`, `/p/:id/{chat,build,document,video}/new`, `/p/:id/campaigns`, `/testing/campaigns`.
- **State:** `wicked.ask.session` and `wicked.chat.<scope>` keys become one Talk thread per scope, filed in the Log. useModeMemory.
- **Heuristics:** `detectWorkflow`, `isChatRun`.
- **Naming drift:** Do Work / New Run / New Build / Execute / Vibe / Document / Demo / Video / recon / Ask posture.

---

## 16. Behaviour layer reused, and what's new below the UI

### 16.1 Reused

| Behaviour | Reused unchanged | Re-mounted |
|---|---|---|
| 1 handover | board/handover.ts, store/visit.ts, useVisitClock | useHandover lifted into the shell; the overlay anchors lines to rails |
| 2 dark when healthy | bandExpansion, countTone, stalls, boardAttention | useBoardModel feeds lanes and rails |
| 3 peek/jump/back | peekTarget, PeekCard, store/place, usePeekJump | jump targets become object addresses |
| 4 one queue | needsYou (compareNeeds), needsQueue (groupAlike), needsSources, useNeedsRows, useTriageCursor | rendered as strips; default verb from the registry; frozen rank under cursor |
| 5 preview/commit/undo | undoQueue, batchGates, useUndoToasts (logic), gateActions | every `undo:true` verb; grey-and-slide instead of toast |
| 6 raw | palette runTargets, useRunRawEvents, RunRawView | inspector Raw tab |
| 7 switch brief | projectBrief, store/projectVisits, useProjectVisits | keyed on the engagement tab |
| 8 capture | lane #348 (not on main) | the `y` verb on any object |
| 9 outbound | api/outbound, useOutboundDraft, OutboundDraft | the `o` verb |
| 10 standing orders | lane #347 (not on main) | tray, Away sheet, `d`, Talk compose |
| Shared | useGlobalShortcuts (the key table the registry writes into), desktopNotify, store/*, dashboardKit and folds, the skin mechanism, planModel, planCatalog, planEdits, teamPlan, useLaunchPlan, campaigns store, testid inventory | `/ws` ingest moves from App.tsx into a `ConsoleRuntime` provider |

### 16.2 New in studio (model layer)

1. `src/verbs/registry.ts` + `useVerbs(selection)`: registry, alike, disabled reasons, `crew: not-yet`.
2. `board/teamRun.ts`: reducer over `teamEvent` + `/runs/:id/team` → plan, rev, diff, score, members, steps, findings, advice, council, ledger, transport.
3. `board/planGraph.ts`: rail layout at full and 1/8 scale (ghost nodes, late tags, marks).
4. `board/fleet.ts`: lanes, dark rails, connectors from campaign deps, terminal rows.
5. `board/track.ts`: Say/Murmur.
6. `board/focus.ts`: `breaksThrough`, held count, hold-30.
7. `board/log.ts`: per-engagement Log fold over existing routes.
8. `store/selection.ts`: cross-object selection and the address scheme that drives the Talk prompt.
9. `store/talk.ts`: one thread per scope, typed proposals → registry verbs.
10. `board/tiles.ts`: tile registry, thresholds, `> source`.

### 16.3 New in crew (staged; release 1 needs only C1)

| # | Change | Release | Unlocks |
|---|---|---|---|
| C1 | `GateInfo.gate_kind` (+ `reviewing_ord`, `plan_rev`, `band`, `high_risk`) through gate-cache | **R1** (small) | diamond kinds, alike grouping, dispute/transport handling (#36) |
| C2 | Standing orders (#347): parse → confirm, scope, expiry, away flag, audit, never deliver/plan approval, outbound queued | R2 | #108, `d`, Away |
| C3 | Capture (#348) + `boundary {client_terms[], share_patterns}` on project | R2 | capture scrub, boundary on new engagement |
| C4 | Hold: `POST /runs/:id/hold` (boundary hold, released by resume) | R2 | #9 |
| C5 | Caps + usage: `cap {usd?, tokens?}`, `GET /runs/:id/usage` | R2 | #45, #46 history |
| C6 | Re-file: `PATCH /runs/:id {campaignId|groupLabel}` | R2 | #43 |
| C7 | Un-bench: `POST /roster/:seat/unbench` | R2 | #63 |
| C8 | Bus history: `GET /bus?type=&run=&since=` | R2 | #70 history |
| C9 | Talk router: `POST /line {scope,text}` → typed outcome | R2 | replaces the R1 proposal convention |
| C10 | Eval compare: `GET /testing/evals/compare?a=&b=` over eval-compare.ts | R2 | #89 flip diff |
| C11 | Worktrees: `GET /worktrees`, `POST /worktrees/sweep` (worktree-sweep.ts exists) | R2 | #103 |
| C12 | Closed transcripts: `GET /chats?closed=1&scope=` | R2 | Log completeness |
| C13 | Consequence on needs rows (waiters, deadline, external flag) computed once in crew | R2 | same rank on every surface |

---

## 17. Build plan

Behaviour-first slices. Release 1 = S0–S8 on existing routes plus C1. Each slice ships behind the `console` skin layout until S8, then becomes the default. Journeys are Playwright tests in `e2e/` (Python, the repo's convention) against the seeded fixture daemon.

| Slice | Behaviour it delivers | Proving journey | Reuses | Deletes | New crew routes |
|---|---|---|---|---|---|
| **S0 Console frame + verb registry** | The five bands; the command line with `:` verbs and `>` raw; selection addresses; the registry drives every button | `console_frame_test.py`: load `/`, see the engagement bar, empty strip board line, Fleet canvas, `fleet ›` prompt; `:` lists verbs for the selection; select a run → prompt reads `helix/H1 ›`. Plus `tests/verbCoverage.test.ts` green | useGlobalShortcuts, CommandPalette fuzzy matcher, useRoute, useLegacyRedirect, skin mechanism | LeftSidebar, CommandPalette UI, SkinRightRail | none |
| **S1 Fleet** | Lanes, dark rails, connectors, alike selection, terminal rows, `>ps` | `fleet_dark_rails_test.py`: 3 engagements, 8 runs; healthy rails at dim opacity; lit rails full; `x` two rails → inspector shows shared verbs and the blocking reason; `>ps` lists a terminal opened in the test | useBoardModel, bandExpansion, countTone, stalls, boardAttention, PhaseLadder step model, campaigns store, Terminal | HomeBoard, HomeCommand, HomeKpiBand, EssenceStrip, WorkPage, MadeDashboard ×3, RunsBottomPanel | none |
| **S2 Strip board + handover + undo** | Consequence-ranked one-line strips, group strips, frozen rank + `n new, ranked`, grey-and-slide undo, handover overlay, one gate path | `strip_board_test.py`: seed away 14 h → overlay with fixed sections; strips start with clocks; commit `a` → strip greys and slides, `u` restores; a gate opened mid-test lands below the divider; approve alike on a group strip sends 4 gate posts with `ord` | needsYou, needsQueue.groupAlike, needsSources, useNeedsRows, useTriageCursor, handover.ts, visit.ts, undoQueue, batchGates, gateActions, peekTarget, PeekCard | GateNotifications, GateChip, ApprovalDock, BatchGateBar UI, NotificationBell inbox, HandoverPanel widget | **C1 `gate_kind`** |
| **S3 Plan canvas: watch and act on the team** | Plan graph, members, monitors, findings, council node, all gate kinds, reassign, retry step, resume, fork, revise, guidance, cancel, archive, bulk archive, live plan edit with ratchet, plan-approval diff, dispute verbs | `plan_canvas_test.py`: open H1; `+` security review → meter 58→76 HIGH and "pauses" preview; commit → `POST /runs/:id/plan` with requestId; plan_approval diamond shows diff; `s` reassign stalled step; `x` five finished runs, `A` → one `POST /runs/archive` | planModel, planEdits, teamPlan, `GET /runs/:id/team`, useRunModel, ReassignControl logic, stallEscalations, retryPrefill | ChatPanel, CenterDashboard, RightPanel, PlanEditPanel UI, IntakePlan UI | none |
| **S4 Review and deliver** | Review gate with outcomes + Say/Murmur team comms, evaluator ≠ creator badge, amend composed from ticked findings, deliver typed confirm, outbound Copy | `review_deliver_test.py`: N1 unit_review shows team comms folded with count; tick 2 findings, `c` → amend prefilled with both; H3 deliver requires typing `deliver H3`; `o` → Copy puts deliver-text on the clipboard | GateVerdict, VerdictDetail, denialCopy, DeliverLift, RunDelivery, OutboundDraft, useOutboundDraft, api/outbound | SteeringGate UI | none |
| **S5 Compose, presets, campaigns** | Composer on the canvas, Parts tray, launcher row Write…Test, save preset, campaign canvas with policy and concurrency, new engagement with boundary questions | `compose_launch_test.py`: `n`, press Write → rfp-section loads; drag a phase → preview reruns; `S` → `PUT /presets/:name`; `L`, `Enter` → rail appears greyed then live. `campaign_launch_test.py`: `N`, 3 plans, draw deps, human_gate_on_failure, concurrency 2 → `POST /campaigns`; bracket on Fleet; `k` cancels | useLaunchPlan, planCatalog, PhasePicker logic, LaunchPreview logic, composerPrefs, campaigns store | NewRunView, ChatInput page, ContextPopover, TestingLaunchPanel UI, ProjectCampaignsView, CampaignScoreboard page, FollowUpComposer, NewProjectModal | none (boundary answers held in the `studio.engagements` settings key until C3) |
| **S6 Talk and the Log** | Scoped prompt, four outcomes (R1 typed-proposal convention), `@team` columns, House scope, the Log fold, Talk drawer, elicitation in Talk | `talk_log_test.py`: select H1 → prompt `helix/H1 ›`; sentence → steer preview → commit → one inject; `Esc` → `helix ›`; question → answer filed in Helix Log; `@team` → one columned message with 3 seats; `g h` → `house ›`; `:log RTO` finds a seeded thread | askSession logic, liveChats, docThread, elicitations, chat-scope helpers | AskDock, AskLauncher, AssistDock, GroupChat UI, ChatsPage, AuthorPanel UI, DocumentThread chrome, LegacyChatHistory, detectWorkflow, isChatRun | none |
| **S7 Focus and Away postures** | Focus holds; breakthrough bar Open / Hold 30 min; strips become marks on rails; `z` snooze | `focus_breakthrough_test.py`: take Focus → board reads `n held`; a LOW gate stays held (mark on its rail); a HIGH finding shows the bar; Hold 30 min → bar gone, held count +1, audit row written | desktopNotify, notifPrefs, store/place | NotificationSettings page (moves to System) | none |
| **S8 Raw, ops, Parts and Boards** | Raw tab on every object, `>bus` live tail, `> source`, System object (health, diagnostics, dead letters + replay, config, whoami, audit, settings keys), Parts pages, Boards via Talk and inline, `p` pin | `raw_parts_boards_test.py`: `R` on a step → Events filtered to its unit; `t` opens a terminal in the worktree; `:replay` previews count; Board: Talk "add tile…" → ghost → `Enter` → `PUT /settings studio.boards`; `+` inline; `> source` shows rows; a tile over threshold with needs_me emits a strip | RunRawView, useRunRawEvents, HealthRailSection data, SystemSettings logic, SkillsPage/SkillDrawer, SteeringPage/Grid/Drawer, MemoriesPanel, TestingPage/EvalHistory, RepositoriesPanel, RepoGraphModal, dashboardKit, GateLatencyChart | GovernanceDashboard page, HealthRailSection rail, ProjectDashboard | none |
| **S9 Capture, orders, outbound (R2)** | Capture with Pattern/Client split and struck terms; orders with expiry and "would have done today"; `d` delegate; Away overnight sheet | `capture_scrub_test.py`, `away_orders_test.py`: `y` on a finding → client terms struck; commit → proposal strip; `d` on a group strip → draft order with preview count; Away → sheet lists deliver/plan-approval as "will wait for you" | lanes #347/#348 models | — | **C2, C3** |
| **S10 Crew-not-yet verbs light up (R2)** | hold, caps, re-file, un-bench, bus history, eval compare, worktree sweep, closed transcripts, `/line`, crew consequence | one journey per verb, e.g. `hold_resume_test.py`: `h` → rail shows "holds at next boundary" → `u` releases. Each flips a registry `disabledWhen` and asserts the greyed reason is gone | registry | the "crew: not yet" copy for that verb | **C4–C13**, in the order the operator chooses (Question 2) |

Rules for every slice: the 17 existing BEHAVIOUR journeys keep passing where their testids survive through reused models; `needs_shell`, `skin_contract` and `wave1_switch` are rewritten in S0–S2; `tsc --noEmit` runs beside vitest (vitest alone misses deleted imports).

---

## 18. What this design refuses

- A section per kind of work. Kinds of work are presets on a launcher row.
- A chat page, a floating chat bubble, a second assistant, or a scope picker. Talk is the command line, and its prompt is its scope.
- Chat history scattered on objects with no home. Every thread is filed in a Log.
- More than one place to answer a gate.
- Toasts. Interruptions are strips; in Focus only breakthroughs.
- Re-ranking under the cursor.
- A verb that exists in only one place, or a button for a route crew doesn't have that pretends to work.
- Showing healthy work at full volume.
- Orders that answer deliver or plan-approval gates, send outbound without a policy, or never expire.
- Client detail crossing an engagement boundary, in Talk, capture or presets.

---

## 19. The operator's asks, checked

| Ask | Where it's answered |
|---|---|
| "is it just for the conversation workspace or for all of the capabilities?" | All 108 capabilities are verbs on objects (§13); the coverage test keeps it so |
| "a workflow and action based app… a true orchestrator UX" | Fleet and plan graph are the primary objects (§5); select → verb → preview → commit → undo (§4); bulk, campaigns, live plan edits, step and member verbs (M4, M5, M8, M9) |
| orchestrating, monitoring, reviewing, approving; beat fatigue | Dark rails, consequence strips, frozen rank, alike folds, Focus with breakthrough, `d` delegate (§8) |
| "it's chat, the health panel, vibe, skills/steering/evals, repos, demos, EVERYTHING" | Presets for kinds of work (§6); Parts; tray and System for health |
| dashboards via chat and inline | Boards (§9) |
| raw things: terminals, worktrees, events, config | Raw tab, `>ps`, `>bus`, `> source` (§10) |
| designed for the moments, many events at once | §12, especially M6 and M7 |
| FDE terminal, "almost like an OS"; RFPs, thought leadership, architecture, process, problems | Launcher row Write · Design · Rethink · Solve · Build · Demo · Test; scoped prompt like a shell; terminals as objects |
| emails and messages from the work; a brain that learns | Outbound (M14), capture (M13), orders and `d` (M7, M15) |
| "the problem wasn't just the skin, it's a coherent user experience" | One grammar for everything; one place per behaviour |
| "what about chat?" | Talk on the command line + the Log + House (§7) |

---

## 20. Questions for the operator

1. **Talk before the router.** Release 1 gets the four outcomes from a typed-proposal convention in the PA's chat reply (and defaults to steer at a gate or step). Is that good enough to ship Talk in S6, or do you want Talk to wait for crew's `POST /line` router (C9)? If it waits, S6 moves after C9 and release 1 ships with Talk answering and steering only.
2. **Which "crew: not yet" verb first?** Hold, spend caps, worktree sweep, bus history, eval compare, un-bench and re-file all land in S10. Which two hurt most today? That order sets the crew backlog.
3. **Where does the confidentiality boundary come from?** Should "new engagement" ask you to list client terms (names, sites, figures, people), or should the PA propose the list from the engagement's docs and repos for you to confirm? The second needs an extraction step in C3 and changes how capture's scrub is tested.
