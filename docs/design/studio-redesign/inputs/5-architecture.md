I'll read the design briefs and prior exploration documents to inform the architecture response.Let me check the current source structure to ground the component architecture in what exists.I have enough to write the full architecture. The produce phase will turn this into `spec.md` and `prototype.html`.

---

# Architecture: wicked-studio redesign

## Decisions upfront (resolve prior ambiguities and set scope)

**Slice count.** The build plan is S0–S9 (ten slices). There is no S10; crew-not-yet verbs light up in S9's contract test when crew routes land, with no UI change required. The "S10" reference in the orchestrator-console doc is historical; it does not carry forward.

**Q1 deduplication rules (binding).** A run is the unit of measure for all six vital signs. The dedup key for gate events is `(runId, gate_ord)` — the first decision at a given gate ordinal is the one that counts.
- *First-pass acceptance*: denominator = runs with a `unit_review` gate that has at least one closed decision. Numerator = runs where the first decision at that gate was `approve`. A run with a `unit_review` gate that never closed is excluded from both.
- *Rework rate*: denominator = runs started in the window. A run carrying both `plan.revised` and `retryOf` is one rework event, not two. Dedup: if `retryOf` and any `plan.revised` event appear on the same `runId`, count the run once.
- *Escaped defects*: findings with `severity HIGH|CRITICAL` on runs with `status = delivered`, within the 14-day window. A finding that appears on multiple runs (reraised) counts once per run.
- *Cost per outcome*: sum of `cliUsage.costUsd` events for delivered runs / count of delivered runs. If `costUsd` is absent or zero for every run in the window, the metric is `unknown`, not `$0`.
- *Speed*: median of `(run.completed_at − run.started_at)` for delivered runs only. Runs that ended in cancel or failure are excluded. Empty set → `unknown`.
- *Trends*: each metric compared to the prior 7-day window (days −14 to −8). Missing prior-window data → `unknown`, not an arrow.

---

## The two states

The studio is one application with one persistent shell. Within that shell, exactly one of two states is active. Switching is explicit and instantaneous. The state is per-engagement, persisted in `store/studioState.ts` keyed by `projectId`.

### Making (flow)

The active piece fills the screen. The piece is always an artifact — document, diagram, board, demo cut, or code diff. There is no nav, no sidebar, no metrics. Agents work alongside; their activity is visible at the bottom of the canvas as a quiet activity line. Talk is accessible via `⌘T` or a tap on the activity line; it opens as a drawer from the bottom, typed at the piece's address, and closes when the user commits or hits Escape.

The only thing that reaches the operator unprompted is a **breakthrough bar** across the top edge of the canvas. Breakthrough criteria (per `board/focus.ts`): `severity === 'high'` or `deadlineWithin(event, 2h)`. The bar carries one sentence and two actions: **Open** (focus the inspector) and **Hold 30 min** (snooze). Everything else is held; the held count appears as a quiet badge on the state toggle ("Managing · 3 held"). Nothing moves while the canvas is focused.

Governance runs in the background. The activity line shows one line of Murmur (team talking to itself). Say events — a HIGH finding, a plan revision that raises the band, a council ruling — reach the operator only as a breakthrough bar.

**Layout (Making):**
```
┌────────────────────────────────────────────────────┐
│ [engagement name]    · Making ▾ ·   [3 held badge] │ ← 40px header
├────────────────────────────────────────────────────┤
│                                                    │
│                   CANVAS (piece)                   │
│                                                    │
│                                                    │
│                                                    │
├────────────────────────────────────────────────────┤
│ [activity line: murmur or "3 agents working"]      │ ← 32px footer
└────────────────────────────────────────────────────┘
```

The canvas is a mount point for `DocumentCanvas`, `DemoWizard`, `CytoGraph`, `WorkflowViewer`, or the plan composer — whatever piece is active. The header's state toggle is the primary affordance to switch to Managing.

### Managing (short and deliberate)

Three question blocks, nothing more. The layout is fixed and cannot be rearranged. Each block has a heading in small caps and a clear vertical boundary.

```
┌─────────────────────────────────────────────────────────────────────┐
│  [engagement tabs] · Managing ▾ ·  [tray: seats·bus·spend·orders]  │
├───────────────┬─────────────────────────────┬───────────────────────┤
│               │                             │                       │
│   Q2          │          Q1                 │        Q3             │
│   JUDGMENT    │       PERFORMANCE           │      IMPROVE          │
│   (ranked     │    (6 vital signs +         │   (proposals, each    │
│    queue)     │     7-day trends)           │    with source)       │
│               │                             │                       │
│ [items]       │ [metric rows]               │ [proposal rows]       │
│               │                             │                       │
└───────────────┴─────────────────────────────┴───────────────────────┘
```

Column widths: Q2 40% | Q1 35% | Q3 25%. On narrow widths (< 900px): Q2 stacks top, Q1 middle, Q3 bottom. There is no dashboard chrome, no summary header, no KPI ribbon. The three columns are the entire view.

**Q2 (left)** — the ranked judgment queue. This is `needsYou`/`needsQueue` re-skinned as strips. Rank is frozen while the cursor rests on a row. New arrivals wait below a `2 new, ranked` divider. Each row: `consequence clock | piece | decision | recommendation | key`. Alike rows fold into one group row. `Space` peeks; `Enter` opens the inspector; `a` approves with preview; `x` rejects; `c` composes an amend; `d` drafts a standing order from this row. Undo: grey-and-slide 10 s, `u` takes it back. `d` and `z` work exactly as in the orchestrator console design.

**Q1 (center)** — the six vital signs. Each sign is one row: label | reading | 7-day trend arrow | target. A sign outside its target turns the row amber; `Enter` on an amber row drills by seat, skill, and work kind (opens a sheet). Healthy signs have no interactive affordance. The block carries a secondary line: window dates (`last 14 days · Sep 13–Sep 27`) and one sentence of tray state if relevant ("2 runs excluded: incomplete cost data"). An empty corpus (no delivered runs in window) shows "no delivered outcomes in this window" across all six rows.

**Q3 (right)** — improvement proposals. Each proposal is one row: `source badge | headline | predicted effect`. Source badges: `capture`, `eval-gap`, `override`, `seat`. Selecting a row opens the inspector (evidence, scope, audit preview, approve/reject). Approve sends `POST /proposals/:id/approve`; reject sends `POST /proposals/:id/reject`. A proposal with missing provenance shows a "provenance missing" badge and disables approve with an explanation in the inspector. A failed API decision keeps the proposal visible with an error inline. Q3 never shows an empty success state when the daemon cannot support proposals: it says "crew: not yet — proposals not available" and links to the capture verb.

---

## The crossings

### Crossing in (Managing → Making)

The operator selects or opens a piece (from Q2, from the inspector one-step-down, from Talk intent). A **crossing-in overlay** appears over the piece for 3 s or until the operator clicks:

```
┌─────────────────────────────────────────────────────┐
│  Making: §4 Security & Resilience                   │
│  ─────────────────────────────────────────────────  │
│  Score: 41 (LOW)  · floor: review required          │
│  3 runs active: build(codex), review(claude), done  │
│  Delegated: "approve LOW unit reviews until Fri"    │
│  ──────────────────────────────────────────────     │
│                                [Begin →]            │
└─────────────────────────────────────────────────────┘
```

Content: piece name, current score + band, active runs against this piece, any standing orders that apply, any outstanding gates. The overlay is non-modal: the piece renders behind it.

### Crossing out (Making → Managing)

When the operator explicitly switches the state toggle to Managing (or presses `⌘⇧M`), a **crossing-out overlay** appears in the Managing state for 3 s or until dismissed:

```
┌─────────────────────────────────────────────────────┐
│  While you were making §4:                          │
│  · codex completed build.2 (no findings)            │
│  · review gate opened → claude approved             │
│  · 1 capture proposed: "RTO claims require BCP-07"  │
│  Outstanding: deliver gate awaiting (or: none)      │
│  Orders: "approve LOW reviews" → fired 2 times      │
└─────────────────────────────────────────────────────┘
```

Content: team actions since the operator entered Making (from `GET /projects/:id/activity` filtered by `since = entered_at`), changes to the piece, outstanding gates on the piece, orders that fired. If nothing happened: "Nothing changed while you were making §4." The overlay auto-dismisses in 3 s; Escape dismisses immediately. The Q2 strip board updates underneath it.

---

## Capability homes

Every row of the 108-row inventory has exactly one home. "One step down" means a sheet or raw tab opened by a verb in the inspector; the operator reaches it in one action and returns to their prior state with `b`.

| Home | Capabilities |
|---|---|
| **Making canvas** | 1 (inject into active run via Talk), 6 (watch live: activity line + Say breakthrough), 10 (inject/steer via Talk), 15 (worktree via `R` in inspector), 21 (outbound from artifact), 22 (provenance in inspector Facts), 94–101 (document, demo, version, feedback, export, theme, source, delete), 102 (terminal while making) |
| **Q2 judgment queue** | 28 (read gate), 29 (answer gate), 30 (batch gates via alike group row), 31 (plan-approval), 32 (intake), 33 (evaluator deny), 34 (deliver gate), 35 (escalation), 36 (dispute/transport), 37 (elicitation), 38 (attention routing), 39 (undo) |
| **Q1 vital signs** | 18 (acceptance: aggregated read), 19 (team view: aggregated by seat/skill on drill), 46 (spend: as cost-per-outcome vital sign) |
| **Q3 proposals** | 79 (rule review as part of a proposal), 80 (retire rule as a proposal action), 82 (author by Talk: compose outcome → proposal), 91 (proposals: approve/reject) |
| **Engagement tabs + tray** | 44 (settings: in tray → System), 47 (daemon config: `>config`), 48 (identity: tray → you), 49 (projects: engagement bar `+`), 51 (activity: engagement Log), 61 (roster: tray seats), 62 (sign seat in: tray), 64 (council: Talk `@team`), 66 (health: tray dark when healthy), 67 (diagnostics: tray → System), 68 (dead letters: tray), 69 (replay: `:replay`), 71 (audit: System), 92 (memories: Parts › Memory), 93 (knowledge: Talk at engagement), 104 (notifications: posture toggle), 105 (appearance: tray → System), 106 (composer defaults), 107 (keyboard/palette: `:`, `?`), 108 (standing orders: tray, `d`, Away) |
| **One step down** | 2 (preview: inspector on draft plan), 3 (retry: `f` from finished run), 4 (revise PR: `F`), 5 (list/browse runs: Fleet in inspector one-step-down or `g f`), 7 (cancel: `k` with typed confirm), 8 (resume: `u`), 9 (pause: crew not yet → hold `h`), 11 (guidance: `G` in plan inspector), 12 (reassign: `s` from escalation), 13 (archive: `A`), 14 (bulk archive: selection → `A`), 16 (raw events: `R`), 17 (evidence: `E`), 20 (delivery: deliver gate or `d`), 23 (phase catalog: composer Parts tray), 24–25 (presets: launcher row), 26 (workflows: Parts), 27 (plan editing mid-run: `+`/`e`/`!`), 40–43 (campaigns: Fleet bracket), 45 (budgets: crew not yet → Board tile), 50 (project members), 52–60 (repos: Parts › Repos), 63 (un-bench: crew not yet), 65 (council in runs: plan inspector), 70 (bus: `>bus`), 72 (stall watchdog: Q2 strip for escalations), 73–77 (skills: Parts), 78–84 (steering: Parts), 85–90 (evals/testing: Parts), 95–96 (versions, feedback: artifact inspector), 103 (worktrees: `R` → Worktree) |

---

## State machine

```typescript
// store/studioState.ts
type StudioState = 'making' | 'managing'
type CrossingState = 'crossing-in' | 'crossing-out' | null

interface StudioStateSlice {
  state: StudioState                   // per engagement
  crossing: CrossingState
  activePieceId: string | null         // artifact/run/doc open in Making
  enteredMakingAt: number | null       // unix ms, for crossing-out summary
  managingLastVisitAt: number | null   // for Q1 window anchor
}
```

State transitions:
- `MANAGING → CROSSING_IN → MAKING`: operator selects a piece or hits a launcher preset
- `MAKING → CROSSING_OUT → MANAGING`: operator clicks the state toggle or presses `⌘⇧M`
- `MAKING → MAKING`: artifact navigation within Making (breadcrumb, `b` back) does not trigger a crossing
- Breakthrough bar in Making does not change state; it opens the inspector within Making

---

## New board/store modules (beyond orchestrator console)

These six modules are new and specific to the two-state design. Everything else from the orchestrator-console architecture carries over unchanged.

| Module | Purpose | Inputs | Outputs |
|---|---|---|---|
| `store/studioState.ts` | State machine, crossing data | operator actions, `store/place` | `StudioStateSlice` per engagement |
| `board/vitals.ts` | Q1 computation | `GET /runs` (14-day window), `/ws cliUsage`, `GET /runs/:id/gate` (gate_kind=unit_review) | `VitalsRow[6]` with reading, trend, target, denominator info |
| `board/judgment.ts` | Q2 ranked queue | `needsYou`, `needsQueue.groupAlike`, `needsSources`, `GateInfo.gate_kind` (C1) | `JudgmentRow[]` with consequence, recommendation, alike groups |
| `board/proposals.ts` | Q3 proposals | `GET /proposals` + `source`, `provenance` fields | `ProposalRow[]` with source badge, provenance status |
| `board/crossing.ts` | Entry/exit summaries | `GET /projects/:id/activity` since `enteredMakingAt`, orders state | `CrossingInSummary`, `CrossingOutSummary` |
| `board/vitalsDedup.ts` | Dedup rules for Q1 | `GET /runs/:id/events` (plan.revised, retryOf), `GET /runs/:id/gate` | Deduplicated counters per dedup spec above |

---

## Reused from orchestrator console (unchanged)

The ten behaviours from the brief all carry. Specific re-mounts:

| Behaviour | Module | Re-mounted in |
|---|---|---|
| 1 handover | `board/handover.ts`, `store/visit.ts` | crossing-out summary pulls from handover; daily handover becomes the crossing-out copy when arriving after >4 h |
| 2 dark when healthy | `bandExpansion`, `countTone`, `stalls`, `boardAttention` | Q2 column and tray (not Q1 or Q3, which are always visible) |
| 3 peek/jump/back | `peekTarget`, `PeekCard`, `store/place` | inspector sheet in both states; `b` returns to prior Making piece |
| 4 one queue | `needsYou`, `needsQueue`, `useNeedsRows`, `useTriageCursor` | Q2 column; frozen rank while cursor on column |
| 5 preview/commit/undo | `undoQueue`, `batchGates`, `gateActions` | every Q2 verb; grey-and-slide within Q2 column |
| 6 raw | `useRunRawEvents`, `RunRawView` | inspector Raw tab (one step down in both states) |
| 7 switch brief | `projectBrief`, `store/projectVisits` | crossing-in overlay; engagement tab on first visit after absence |
| 8 capture | lane #348 model | `y` verb in Making (artifact, step, Talk exchange); capture card split unchanged |
| 9 outbound | `api/outbound`, `useOutboundDraft` | `o` verb in Making; Q2 gate answer can include outbound draft |
| 10 standing orders | lane #347 model | tray, Away sheet, `d` in Q2, Talk compose in both states |

---

## Build plan (S0–S9, behaviour-first)

Each slice has one proving journey. The journey is the acceptance criterion. `tsc --noEmit` runs beside vitest on every slice.

### S0 — Two-state shell

**Delivers:** the state toggle (Making ▾ / Managing ▾), stable shell in both states, crossing-in overlay (static copy), crossing-out overlay (static copy), engagement tabs, tray (dark), state persisted per engagement.

**Proving journey** (`studio_two_state_test.py`):
1. Load `/`. See Managing state with three empty columns (Q2: "Nothing needs you", Q1: "no data", Q3: "no proposals").
2. Click Making. See crossing-in overlay. Click Begin. Canvas shows the last active piece (or a blank canvas if none).
3. Click Managing. See crossing-out overlay. Auto-dismiss. See Managing.
4. Reload. Same engagement is in Managing. A second engagement is in Making (seeded). Switching tabs restores each state.
5. Keyboard: `⌘⇧M` toggles state. `Esc` dismisses the crossing overlay.

**Reuses:** `store/place`, skin mechanism, `useRoute`, `useLegacyRedirect` for old routes, `store/projectVisits` for crossing-in data.
**Deletes:** `LeftSidebar`, `ModeSwitcher`, `HomeCommand`, `HomeKpiBand` (in this slice's shell, not full deletion — full deletion completes in S1–S3).
**New crew:** none.

---

### S1 — Q2: resolve what needs judgment

**Delivers:** Q2 ranked judgment queue with consequence-first ordering, group/alike rows, frozen rank, `2 new, ranked` divider, grey-and-slide undo, `d` draft order, `z` snooze, peek, all gate kinds (plan_approval, unit_review, deliver, intake, escalation, dispute, transport) each with recommendation text and preview.

**Proving journey** (`judgment_queue_test.py`):
1. Seed: 5 open gates (3 unit_review LOW alike, 1 plan_approval, 1 HIGH finding escalation). Seed consequence data (the plan_approval blocks 2 downstream runs, 40 min to freeze).
2. Q2 shows: consequence clock first on every row; group row folds the 3 alike unit reviews.
3. Move cursor to the group row. A new gate arrives. It lands below `1 new, ranked`. Rank of the existing rows does not change while cursor is on the board.
4. Press `.` (settle). New gate joins rank.
5. `a` on the group row → preview lists 3 gate decisions (evaluator ≠ creator on each). Commit → 3 `POST /runs/:id/gate` with `ord`. Rows grey and slide. `u` restores one.
6. `d` on the plan_approval strip → Talk shows draft order; preview includes "would have approved 3 this week." Draft does not fire. Typed confirm required.
7. A deliver gate appears. Attempt `d` (draft order). Q2 shows: "standing orders cannot answer deliver gates" and rejects the draft.
8. A rule cannot be used to answer a plan_approval or deliver gate. Verify: `d` on plan_approval → error inline "standing orders cannot answer plan-approval gates."

**Reuses:** `needsYou`, `needsQueue.groupAlike`, `needsSources`, `useNeedsRows`, `useTriageCursor`, `undoQueue`, `batchGates`, `gateActions`, `board/handover.ts`.
**Deletes:** `GateNotifications`, `GateChip` (Q2 is now the one gate place), `ApprovalDock`, `BatchGateBar` UI, `NotificationBell` inbox.
**New crew:** **C1** (`GateInfo.gate_kind`, `reviewing_ord`, `plan_rev`, `band`, `high_risk`).

---

### S2 — Q1: read team performance

**Delivers:** the six vital signs with 7-day trends, 14-day fixed corpus, drill sheet (by seat / skill / work kind), denominator disclosure, dedup rules, honest unknown/incomplete states.

**Proving journey** (`vitals_test.py`):
1. Seed deterministic fixture: fixed clock at Sep 27, 3 engagements, 14-day corpus. 12 delivered runs, 2 cancelled, 1 still active. Runs include: 4 with first-pass unit_review approve, 2 with first-pass reject, 3 with `plan.revised` (no `retryOf`), 1 with both `plan.revised` and `retryOf`, 1 with no `cliUsage.costUsd`, 1 post-delivery HIGH finding.
2. Q1 renders 6 rows. Verify exact values:
   - First-pass acceptance: 4/6 = 67% (denominator = runs with closed unit_review; the active run and cancelled runs excluded).
   - Rework: 3/12 = 25% (the `plan.revised + retryOf` run counted once).
   - Escaped defects: 1 HIGH (the post-delivery finding).
   - Cost: sum(costUsd for 12 delivered) / 12 (the run without costUsd = $0 included in sum if field present as 0; absent = excluded from sum, denominator stays 12, note shown: "1 run excluded: no cost data").
   - Actually re-read the dedup rule: "If `costUsd` is absent or zero for every run" → the note should say "unknown" only if ALL runs have absent/zero. If only 1 run has absent cost, the rest contribute. The 1 excluded run shows as a note.
   - Speed: median of 12 delivered durations.
   - Trends: all six vs prior 7-day window (days −14 to −8).
3. Cost row: remove all `cliUsage.costUsd` from fixture → cost row shows "unknown" not "$0".
4. Empty corpus: fixture has 0 delivered runs → all six rows show "no delivered outcomes in this window."
5. Click amber first-pass row → drill sheet shows breakdown by seat (claude: 4/4, codex: 0/2). `b` returns to Q1 without flicker.
6. A healthy sign is not interactive and carries no affordance.

**Reuses:** `board/metrics.ts` (existing folds), `dashboardKit.StatTile`, `GateLatencyChart` (repurposed as a sparkline).
**Deletes:** `DeckBurnChart`, `DeckKpiRibbon` (replaced by Q1), `GovernanceDashboard` page (governance is a Q3 source, not a page).
**New crew:** none (all data from existing routes + C1 `gate_kind`).

---

### S3 — Q3: improve the system

**Delivers:** Q3 proposal rows with source badges, inspector with evidence/scope/audit preview, approve/reject, provenance check, honest states for missing provenance and daemon-not-supported.

**Proving journey** (`proposals_test.py`):
1. Seed: 4 proposals with distinct sources (capture, eval-gap, override, seat). 1 proposal with no provenance data. 1 proposal with a failed API response mock.
2. Q3 renders 4 rows with source badges. The no-provenance proposal shows a "provenance missing" badge.
3. Select a capture-sourced proposal → inspector shows the captured exchange, predicted effect ("add to steering rules"), scope (Northwind), audit preview. Approve → `POST /proposals/:id/approve`. Row clears.
4. Select the no-provenance proposal → inspector shows: "Provenance missing. Cannot approve without source evidence." Approve is disabled.
5. Select a proposal → reject → `POST /proposals/:id/reject`. Row clears. Failed API response: row stays, error shown inline.
6. Crew not-supported scenario: `GET /proposals` returns 404 → Q3 shows: "crew: not yet — proposals not available. Use capture `y` to create one manually." No empty success state.

**Reuses:** `api/proposals.ts`, `ProposalsSection` logic.
**Deletes:** `GovernanceDashboard`'s `ProposalsSection` mount (moves to Q3 column), `SteeringHealth` as a standalone dashboard.
**New crew:** none.

---

### S4 — Make in flow

**Delivers:** Making state with full canvas (document, diagram, code, demo, board), activity line with Murmur, Talk drawer (`⌘T`), provenance in inspector (which agent, which rules, evidence), accept an agent suggestion via preview/commit path, undo restores exact prior content and state, breakthrough bar Open/Hold.

**Proving journey** (`making_flow_test.py`):
1. Enter Making with a document artifact open. Canvas fills the screen. Activity line shows "claude: drafting §4.2 · 2 agents working."
2. No strip board visible. No nav. Only the state toggle and the activity line.
3. `⌘T` → Talk drawer opens from the bottom at the document's address. Type a compose instruction. A ghost change appears on the canvas. Commit → change applied. Undo (`⌘Z` or `u`) → canvas and activity line restore to exact prior state (not just a toast).
4. Seed a HIGH finding on the active run. Breakthrough bar appears at the top edge: one sentence, **Open** and **Hold 30 min**. Canvas is not obscured; the bar is 48px at the top. No strip board appears.
5. Hold 30 min → bar disappears; the badge on the state toggle shows "Managing · 1 held." Bar reappears after 30 min (or after clock advance in test).
6. Open → inspector opens within Making showing the finding. `b` closes inspector and returns to canvas without state change.
7. `⌘T` while inspector is open → Talk drawer does NOT open (the inspector is the active focused surface). Escape closes inspector and returns to canvas.

**Reuses:** `DocumentCanvas`, `DemoWizard`, `CytoGraph`, `WorkflowViewer`, `desktopNotify`, `board/focus.ts` (`breaksThrough`), `undoQueue`, `store/place`.
**Deletes:** nothing new in this slice (Making canvas was already present in S0; this slice activates the full artifact stack).
**New crew:** none.

---

### S5 — The crossings

**Delivers:** crossing-in overlay with real data (score, active runs, delegated orders, outstanding gates), crossing-out overlay with real data (team actions since entered, changes to piece, outstanding gates, orders that fired), both auto-dismiss in 3 s, Escape dismisses immediately.

**Proving journey** (`crossings_test.py`):
1. In Managing, open a plan inspector and navigate to a document. Crossing-in overlay appears with: piece name, score (seeded), "2 runs active: build(codex), review(claude)", "Delegated: approve LOW unit reviews until Fri", "1 outstanding gate: deliver". Click Begin → canvas. Overlay gone.
2. Press `⌘⇧M` → Managing. Crossing-out overlay appears with: "While you were making §4: codex completed build.2 (no findings); review gate opened → claude approved; 1 capture proposed." "Outstanding: deliver gate awaiting." "Orders: fired 2 times." 3 s → auto-dismiss. Q2 updates underneath.
3. If nothing happened during Making: overlay says "Nothing changed while you were making §4." Still appears, still auto-dismisses.
4. Seed a >4 h gap between visits (not just Making/Managing, but a full session gap). The crossing-in overlay shows the switch brief content (B7) instead of the run-specific content.

**Reuses:** `board/handover.ts`, `store/visit.ts`, `board/projectBrief.ts`, `store/projectVisits`, `GET /projects/:id/activity`.
**New crew:** none.

---

### S6 — Compose by talking or pointing

**Delivers:** unified preview/commit path for all compose actions in Making (typed instruction → ghost change → commit → undo), and parallel path for pointer actions. Repeated Enter does not double-submit. Non-reversible actions use typed confirmation. Compose and Talk use the same preview path; point-and-click verbs route through the same preview.

**Proving journey** (`compose_test.py`):
1. In Making (document), type a compose instruction in the Talk drawer. Ghost markup appears. Press Enter → committed. Press `u` → exact prior content restored.
2. Type the same instruction, press Enter rapidly twice. Second Enter is a no-op (the commit is in-flight). Verify: one `POST /runs/:id/inject`, not two.
3. A verb marked as non-reversible (deliver): clicking shows a typed confirmation `deliver §4`. Pressing Enter without the typed phrase → nothing happens. The confirmation copy says "this cannot be undone."
4. Point to a ghost suggestion from an agent (marked with a dashed border). Click Accept → same preview/commit path as Talk compose. Undo → restores the agent's suggestion markup, not just a toast.
5. An out-of-scope instruction (referencing a different engagement's artifact) → no mutation. Error: "this instruction crosses the Northwind engagement boundary."

**Reuses:** `store/talk.ts`, `undoQueue`, `gateActions`, `board/planGraph.ts` for ghost nodes.
**New crew:** none (Talk uses typed-proposal convention in R1).

---

### S7 — Talk and Log without losing scope

**Delivers:** scoped Talk prompt (piece address), four-outcome classifier via typed-proposal convention, answers and intents and composes filed into the correct Log, project-switch cannot retain prior project's target, client detail cannot cross engagement boundaries, closing a sheet/drawer returns focus to its invoker.

**Proving journey** (`talk_log_test.py`):
1. In Managing, with Northwind active: `⌘T` → Talk drawer at `northwind ›`. Type "What did we say about RTO?" → answer outcome. Answer filed in Northwind Log. Switch to Helix tab → Talk prompt becomes `helix ›`. Type same question → answer filed in Helix Log. Northwind Log unchanged.
2. In Making (document at `northwind/§4-draft ›`): type a compose instruction. Compose outcome. Commit. Filed in Northwind Log with the `§4-draft` anchor.
3. Type an instruction that contains a Helix-specific client term (a term from Helix's boundary). Talk returns: "this contains client detail that cannot cross the Northwind boundary." No mutation.
4. Open an inspector sheet. Focus is on the sheet heading (verified via ARIA `aria-activedescendant`). Press Escape → sheet closes, focus returns to the Q2 row or the canvas element that invoked it.
5. `g l` → opens Northwind Log on the canvas. `:log RTO` searches all engagement Logs. A seeded thread from Northwind appears. A thread from Helix appears with its engagement badge. Client detail in the Helix thread is not visible in the cross-Log search.

**Reuses:** `board/log.ts`, `store/talk.ts`, `board/track.ts`, `askSession` logic, `liveChats`, chat-scope helpers.
**Deletes:** `AskDock`, `AskLauncher`, `AssistDock`, `GroupChat` UI, `ChatsPage`, `DocumentThread` chrome, `LegacyChatHistory`, `detectWorkflow`, `isChatRun`.
**New crew:** none.

---

### S8 — Go one step down

**Delivers:** any object reachable from its primary location in one action; the inspector Raw tab; `b` returns to the same state, selection, and scroll position; missing or unauthorized data shows a bounded error without losing context; raw access is scoped to the selected object.

**Proving journey** (`one_step_down_test.py`):
1. In Q2, select a plan_approval gate strip. Inspector opens showing the plan diff. `R` → Raw tab shows gate events. `b` → back to Q2, same strip selected, same scroll.
2. In Making (document), open the inspector for the active run. Select the build step. `t` → terminal opens in the worktree for that step. `b` → back to the step in the inspector within Making.
3. `w` on a step → worktree files. Open a file. `b` → back to worktree. `b` again → back to step. `b` again → back to inspector in Making.
4. Select a step with no worktree (pre-build). Worktree tab shows: "no worktree yet — available after build.1 completes." No error dialog.
5. `R` on a run in Q2 → events filtered to that run's `wicked.team.*` rows only. A different run's events do not appear.
6. Reduced-motion: `prefers-reduced-motion: reduce` → the inspector opens and closes without a slide transition. All content remains readable.

**Reuses:** `RunRawView`, `useRunRawEvents`, `store/place` (scroll/selection restore), `peekTarget`, terminal stack.
**New crew:** none.

---

### S9 — Preserve all platform capability honestly (static contract)

**Delivers:** a static contract test (`tests/capabilityContract.test.ts`) that verifies all 108 inventory rows have exactly one discoverable home: Making, Q1, Q2, Q3, or one step down. Supported actions map to published HTTP/WS routes from `endpoint-manifest.json`. Crew-not-yet capabilities are disabled with "crew: not yet," name the working alternative, and emit no mutation request. No capability is duplicated, omitted, or presented as operational.

**Proving journey** (`capability_contract_test.py`):
1. The contract test is a unit test (vitest), not a Playwright journey. It:
   - Imports the 108-row capability table (a new `src/data/capabilityInventory.ts` that the produce phase creates).
   - For each row, asserts exactly one `home` field: `'making' | 'q1' | 'q2' | 'q3' | 'one-step-down'`.
   - For each row with `home !== null`, asserts a corresponding verb in `src/verbs/registry.ts` or a documented read path.
   - For each `disabledWhen: {crew: 'not-yet'}` entry, asserts an `instead` field pointing to a valid verb id.
   - Joins with `endpoint-manifest.json`: every non-read verb must map to a route in the manifest.
2. Also: `tests/verbCoverage.test.ts` (from orchestrator console design) keeps passing. It lists crew-not-yet rows separately.
3. Playwright: navigate to the inspector for each object type in the fixture. Assert that verbs disabled with "crew: not yet" show the label and the `instead` text, and that clicking them produces no API call.
4. X1 (keyboard/AT): every control reachable by Tab. Visible focus maintained. Opening a sheet focuses its `h2` heading. Escape closes the sheet and focuses the invoker. `d` while a sheet is open: no-op (the `d` key handler checks `activeSheetId !== null`). Mode and decision state announced via `aria-live` regions. Reduced-motion: no essential motion-only feedback.
5. X2 (calmness/locality): prototype loads from a local file (no network requests in `window.__proto__` after DOMContentLoaded). At 200% zoom, no horizontal document scroll. Long labels truncate with ellipsis and the full value is in `title`. A Q2 column with 50 items: only 5 shown, "+45 ranked below" counter.

**New modules:** `src/data/capabilityInventory.ts` (the 108-row table as typed records), `tests/capabilityContract.test.ts`.
**New crew:** none.

---

## Prototype walk-through moments

The prototype (`prototype.html`) is a self-contained file with no external dependencies. Inline CSS and inline JavaScript only. It walks through 8 moments:

| # | Moment | State | What the operator does |
|---|---|---|---|
| P1 | Arriving in Managing | Managing (3 columns) | See Q2 (3 items ranked), Q1 (6 vital signs, one amber), Q3 (2 proposals). Nothing else. |
| P2 | Resolve a judgment item | Q2 | Click the unit_review group row. Inspector opens. Approve. Grey-and-slide. Undo. |
| P3 | Read a vital sign off-target | Q1 | Click the amber first-pass row. Drill sheet: by seat. Close. |
| P4 | Approve a proposal | Q3 | Select a capture proposal. Inspector: evidence visible. Approve. |
| P5 | Cross into Making | Crossing-in overlay | Click Making. See overlay: score, runs, delegated orders. Click Begin. |
| P6 | Make in flow | Making (document) | Canvas fills screen. Activity line visible. `⌘T` opens Talk. Type. Ghost appears. Commit. |
| P7 | Breakthrough at the edge | Making (breakthrough bar) | A HIGH finding bar appears. Hold 30 min. Bar goes. Badge shows "Managing · 1 held." |
| P8 | Cross out of Making | Crossing-out overlay | Click Managing. See overlay: what the team did. Auto-dismiss. |

The prototype's visual style: near-white background (`#F9F9F7`), one grey for structure (`#E8E8E4`), one near-black for text (`#1A1A18`), amber for attention (`#B45309`), no other colours. No shadows. No gradients. Monospace type for addresses and raw values; system sans-serif for everything else. Icon-free (text labels only). The three Managing columns have a 1px rule separator and 16px padding. The Q2 consequence clock is the leftmost element on each row, in tabular nums.

---

## What this design refuses (carried from the brief, extended)

- A section per kind of work.
- A chat page, floating chat bubble, or second assistant.
- Chat history scattered on objects.
- More than one place to answer a gate (Q2 is the only place).
- Toasts.
- Re-ranking under the cursor.
- Verbs that exist only in one place without registry backing.
- Showing healthy work at full volume.
- A Making state that lets notification traffic through below the breakthrough threshold.
- A crossing-out overlay that silently drops nothing-happened content (always renders, always honest).
- An orders system that answers deliver or plan-approval gates.
- A Q1 metric computed with a false zero for an empty or cost-absent denominator.
- A Q3 proposal approved without provenance.
- Client detail crossing an engagement boundary via Talk or capture.

---

## Open questions for the operator (three remain from the orchestrator-console design)

1. **Talk before the router (unchanged).** Does Release 1 ship Talk with the typed-proposal convention in R1, or does Talk wait for crew's `POST /line` router (C1)?

2. **Crew-not-yet verb priority (unchanged).** Which two of {hold, spend caps, worktree sweep, bus history, eval compare, un-bench, re-file} hurt most today?

3. **Confidentiality boundary source (unchanged).** Does "new engagement" ask the operator to list client terms, or does the PA propose the list from the engagement's docs for confirmation (needs an extraction step in C3)?

One new question from this architecture:

4. **Crossing-in trigger.** Should opening any artifact from the Log or the inspector one-step-down trigger a crossing-in overlay, or only when the operator explicitly presses the Making state toggle? The current architecture triggers the overlay whenever the state changes to Making (from any source). If it triggers too often, the alternative is: overlay only on the state-toggle press, not on artifact navigation from Managing.