# wicked platform: capability and action inventory (studio + crew API)

Sources, read 2026-09-26:
- crew `d6834a6`. The route table is `wicked-crew/packages/crew/endpoint-manifest.json` (138 method+path rows, api-types 0.47.0). A CI test fails on any drift, so this table is authoritative.
- studio `9a8239e` (0.5.14). Sources: `src/hooks/useRoute.ts` (panels), `src/App.tsx` (panel to component), `src/api/*.ts` (wire calls), `testid-inventory.json` (1,230 static testids) and component mount-site analysis.

"Exposed" means a mounted component calls the route. "Wired, no UI" means a studio client function exists but nothing calls it. "Not exposed" means studio has no call at all.

## Studio navigation map (what exists today)

| Area | Route(s) | Top component |
|---|---|---|
| Home / command deck | `/` | HomeBoard: attention bands (working/quiet/not-in-project), DeckKpiRibbon, DeckBurnChart, BatchGateBar, HandoverPanel, NeedsQueueSurface, HomeVerbs, RecentActivity, delivery strip |
| Projects | `/projects`, `/projects/:id` (manage), `/p/:id` (dashboard), `/p/:id/{chat,build,document,video}[/:artifact]`, `/p/:id/chronicle`, `/p/:id/campaigns` | ProjectsPage, ProjectDetailPage, ProjectDashboard, ProjectShell + ModeSwitcher |
| Execute / Vibe / Demo | `/execute`, `/vibe`, `/demo` | MadeDashboard (one per mode) |
| Runs | `/runs/new`, `/runs/:id[/timeline]`, `/runs/:id/events`, `/runs/:id/files`, `/work` | ChatInput (launch), ChatPanel + CenterDashboard + RightPanel (run detail), RunRawView, WorkPage |
| Chat | `/chats`, plus the global AskDock | ChatsPage, GroupChat, AskDock/AssistDock |
| Repositories | `/repos`, `/repos/new`, `/repos/:id` | RepositoriesPanel, RepoDetailPage, RepoGraphModal, RequirementsModal |
| Test / Evals | `/testing/campaigns[/:id]`, `/testing/evals` | TestingPage, CampaignsPage, TestingLaunchPanel, CampaignScoreboard, EvalHistory |
| Steering | `/steering` (dashboard), `/steering/policies?type=`, `/steering/memories` | GovernanceDashboard, SteeringPage, MemoriesPanel, ProposalsSection |
| Skills | `/skills?skill=` | SkillsPage, SkillDrawer |
| Workflows | `/workflows` | WorkflowViewer (view + builder) |
| Settings / System | `/system`, `/theme` | SystemSettings, NotificationSettings, ThemePage/AppearanceSettings/BrandLearn |
| Global chrome | every page | LeftSidebar (+ HealthRailSection, NotificationBell, ProjectSwitcher), CommandPalette, ShortcutOverlay, GateNotifications toasts, UndoToasts, PeekCard, RunsBottomPanel, Terminal |

## Capability inventory

| # | Capability | User actions | Crew route(s) | Studio today | Gap / note |
|---|---|---|---|---|---|
| **Run lifecycle** ||||||
| 1 | Launch a run | Launch with a problem; pick workflow or plan; target a project or repo; pick seats (`clisJson`); entity mode shared/isolated; gate mode (`humanConfirm` none/all/before N); deliver pr/none; deliver gate human/auto; attach to a campaign or group; link a chat | `POST /runs` (LaunchRunBody) | ChatInput at `/runs/new` and in project Build mode (launch-confirm-*, launch-target-*, ContextPopover launch-seat/gate/entity/workflow, deliver-toggle, group-attach); palette "New Build"; ProjectCard quick-actions | Exposed. `channel`/`actor` are set implicitly |
| 2 | Preview a launch | See score band, steps, floor-filled steps, high-risk flag and pending scope before launching | `POST /plans/preview` | LaunchPreview inside ChatInput | Exposed |
| 3 | Retry a run | Relaunch with lineage (`retryOf`), prefilled from the failed run | `POST /runs` + `retryOf` | ChatPanel run-retry, RunTimeline retry-link, MadeDashboard execute-retry, ProjectDashboard dashboard-run-retry, BatchGateBar batch-retry-* | Exposed (retry is a relaunch, not in-place) |
| 4 | Revise a PR | Launch a follow-up that revises an open PR | `POST /runs` + `revisesPr` | ChatInput launch-revises-pr; FollowUpComposer in ChatPanel | Exposed |
| 5 | List and browse runs | Filter, list, open, see status/delivery/lineage/group | `GET /runs`, `GET /runs/:id` | LeftSidebar Execute list, MadeDashboard, WorkPage, RunsBottomPanel, HomeBoard bands, palette run search | Exposed |
| 6 | Watch a run live | Stream output, narration, unit status, stalls, reassigns, council failures | `GET /ws` (CoreEvent), `GET /runs/:id/units/:unitKey/output` | NarratorFeed, LiveNarration, UnitList/WorkUnitDetail, RunTimeline, NowBar | Exposed. PhaseLadder and LiveOutput exist but are unmounted |
| 7 | Cancel a run | Cancel with confirm | `POST /runs/:id/cancel` | ChatPanel run-cancel(+confirm); palette "Cancel run" | Exposed |
| 8 | Resume a run | Re-enter the cursor of a non-gated paused run | `POST /runs/:id/resume` | `api.resumeRun` has no caller | Wired, no UI. A gated run advances via the gate |
| 9 | Pause a run | Stop at will | none (only gates via `humanConfirm`, team pause) | none | Crew has no pause verb |
| 10 | Inject a message (steer) | Send an operator note to active workers (all or one CLI) | `POST /runs/:id/inject` | ChatPanel/CenterDashboard composer (steer-prefill), ChatInput | Exposed |
| 11 | Pre-gate guidance | Upsert one durable guidance note per run | `PUT /runs/:id/guidance` | PreGateAnnotate on ProjectCard (save-guidance); WorkChronicle guidance-use | Exposed (only from the project card) |
| 12 | Reassign a seat | Move a stalled/escalated unit to another CLI | `POST /runs/:id/reassign` | ReassignControl in SteeringGate and CenterDashboard (steering-reassign-*, shows benched) | Exposed. Automatic reassign budget is a setting (see 44) |
| 13 | Archive a run | Write off a terminal run | `POST /runs/:id/archive` | ChatPanel run-archive, WorkPage run-archive-row | Exposed |
| 14 | Bulk archive | Write off many runs by explicit ids | `POST /runs/archive` | none | Not exposed |
| 15 | Run artifacts | Browse worktree files, whole-run diff, open a file in the OS | `GET /runs/:id/files`, `GET /runs/:id/diff`, `POST /open` | RunRawView `/runs/:id/files`, FileViewer (RightPanel, ChatPanel), palette "Open worktree / files" | Exposed |
| 16 | Raw event log (per run) | Read the run's raw CoreEvents | `GET /runs/:id/events` | RunRawView `/runs/:id/events`, palette "Raw events" | Exposed. No cross-run event log |
| 17 | Evidence | Download the run's evidence bundle | `GET /runs/:id/evidence` | downloadRunEvidence (ChatPanel, CampaignScoreboard, doc thread) | Exposed as a download only; no in-app evidence viewer |
| 18 | Acceptance verdict | Read the deny-dominates QE acceptance for the run (optionally pinned to `?qeRun=`) | `GET /runs/:id/acceptance` | GovernanceAudit acceptance-gate-line (RightPanel); campaign ladder | Exposed (read) |
| 19 | Team view | See the run's team: members, unit ledgers, gate folds | `GET /runs/:id/team` | none | Not exposed (plan edits use `/plan`; the team roster/ledger is invisible) |
| 20 | Delivery | See delivery state (delivered/stranded/vacuous), PR link and lift checks; post-hoc deliver a stranded run | `GET /runs` (`delivery`, `deliverUrl`), `POST /runs/:id/deliver` | RunDelivery (run-deliver-button) + DeliverLift in RightPanel/RunTimeline/SteeringGate; DeckVerifiedStrip; campaign delivery rollup | Exposed |
| 21 | Outbound draft | Draft a PR body or status update from the run | `GET /runs/:id/deliver-text` | OutboundDraft in ChatPanel (run-draft-update) | Exposed (copy only; no send) |
| 22 | Run provenance / decisions | Why a seat, skill or route was chosen; data used; assumptions; steering timeline | `GET /runs/:id/events`, `GET /audit`, `GET /governance/claims` | RightPanel: DecisionsLedger, RoutingProvenance, DataUsed, AssumptionsPanel, SteeringTimeline, ProvenanceLine | Exposed (read) |
| **Plans, presets, phase catalog** ||||||
| 23 | Phase catalog | Browse phases; compose a plan from phases | `GET /catalog` | PhasePicker (ChatInput phase-picker-toggle, PlanEditPanel) | Exposed |
| 24 | Presets | Launch by preset (saved phase selection) | `GET /presets` | useLaunchPlan picks a preset for project and workflow | Read only |
| 25 | Preset management | Create/save, view, delete a preset | `PUT/GET/DELETE /presets/:name` | none | Not exposed |
| 26 | Workflows | View workflow defs (phases, human gates); build/register a new workflow; save inline scripts for tool phases | `GET /workflows`, `POST /workflows`, `POST /scripts`, `GET /workflows/:id` | WorkflowViewer `/workflows` (builder + script save); workflow picker in ChatInput and TestingLaunchPanel | Exposed (`GET /workflows/:id` unused; no edit/delete of a def) |
| 27 | Plan editing mid-run | Add/remove phases; the engine applies the change at the next step boundary with floor fill; propose, see band/high-risk/floor-added | `POST /runs/:id/plan` (EditPlanBody, idempotent `requestId`) | PlanEditPanel in RightPanel (plan-edit-propose/result/retry); gate-moved handling in board/gateActions | Exposed |
| **Gates** ||||||
| 28 | Read the open gate | Prompt, lifecycle, refusal match; survives restart | `GET /runs/:id/gate`, `/ws` awaitingHuman | GateChip, SteeringGate, ApprovalDock, GateNotifications toasts, NotificationBell, HomeBoard bands | Exposed |
| 29 | Answer a gate | Approve; reject (with note); request changes (amend; scope cursor/creator); approve and steer; stale-gate guard via `ord` | `POST /runs/:id/gate` (GateDecision) | SteeringGate (steering-approve/-reject/-request-changes/-amend/-approve-steer), GateChip gate-approve/reject, GateRejectNote, palette "Approve/Reject gate", triage keys `a`/`r` | Exposed |
| 30 | Batch gates | Select several, approve all or reject all with a note; preview; retry failures | `POST /runs/:id/gate` × N | BatchGateBar on HomeBoard and ProjectDashboard | Exposed |
| 31 | Plan-approval gate (T9) | Approve the held plan, or edit the plan as the answer (`action: edit_plan`) | `POST /runs/:id/gate`, `POST /runs/:id/plan` | PlanEditPanel and gate UI; `plan_approval` only in api/teamPlan | Partial: no dedicated plan-approval card |
| 32 | Intake gate | Approve the planned units (ord, phase, executor, skill, seat) before unit 1 | `POST /runs/:id/gate` | IntakePlan inside SteeringGate and TestingLaunchPanel | Exposed |
| 33 | Evaluator deny / unit-review gate | See the deciding verdict (floor, judge, mutated worktree, repo checks, denied tool calls) and answer | `GET /runs/:id/events` + gate | GateVerdict (SteeringGate, CenterDashboard, PeekCard), VerdictDetail, denialCopy | Exposed |
| 34 | Deliver gate | Review the diffstat or full diff before push, then approve | `POST /runs/:id/gate`, `GET /runs/:id/diff` | SteeringGate deliver-gate-diffstat/-full-diff | Exposed |
| 35 | Escalation gate | Stall or condition escalations (evaluator_mutated_worktree, boundary_deny, dead_seat, floor_failed, verdict_not_pass) → reassign or answer | `/ws` workerStallEscalated/gateEscalated, `POST /runs/:id/reassign`, gate | needsYou board, stallEscalations store, ReassignControl, narrator | Exposed |
| 36 | Team dispute / team transport gates | Resolve a team dispute; handle a transport pause | gate `kind: team_dispute`, `team_transport` | No specific handling (generic gate only) | Not distinguished |
| 37 | Elicitation (worker asks) | Accept with an answer, decline, or cancel | `GET/POST /runs/:id/elicitation` | ElicitationPrompt in ApprovalDock (chat, run, AssistDock) | Exposed |
| 38 | Attention routing | "Needs you" queue, handover since last visit, peek, desktop notification | client-side over `/runs`, `/ws`, `/campaigns`, `/proposals` | NeedsQueueSurface, HandoverPanel, PeekCard, desktopNotify, NotificationBell | Exposed |
| 39 | Undo | Undo a just-made decision in a grace window | client-side | UndoToasts | Exposed |
| **Campaigns and groups** ||||||
| 40 | Browse campaigns and groups | List engine campaigns plus ad-hoc label groups and attached runs; open detail (DAG node status, ladder, delivery rollup) | `GET /campaigns`, `GET /campaigns/:id` | `/testing/campaigns[/:id]`, `/p/:id/campaigns`, CampaignScoreboard | Exposed (read) |
| 41 | Launch a campaign (DAG) | Define scenarios and dependencies, failure policy (fail_fast / continue_independent / human_gate_on_failure), concurrency, repos/project | `POST /campaigns` (LaunchCampaignBody) | none. Studio fans out via `POST /runs` + `groupLabel`, or `/testing/*` | Not exposed |
| 42 | Campaign cancel / resume | Cancel; resume a paused campaign | `POST /campaigns/:id/cancel`, `POST /campaigns/:id/resume` | none | Not exposed |
| 43 | Group a run | File a run into an existing campaign or a new label group at launch | `POST /runs` `campaignId`/`groupLabel` | ChatInput group-attach; TestingLaunchPanel fanout label | Exposed at launch only; no re-file |
| **Settings, budgets, spend** ||||||
| 44 | System settings | graphNodeLimit, worker_config_root, deliver-PR default; (unsurfaced keys: baseSkillRef/Policy, workerStallMinutes, escalate minutes/action reassign-or-notify, max escalations/reassign budget) | `GET/PUT /settings` | SystemSettings `/system` (deliver-pr-toggle, graph limit, worker root) | Partial: stall/escalation/reassign-budget and base-skill keys have no UI |
| 45 | Budgets | Set a spend or token cap per run, project or seat | none (only reassign budget, chat turn budget, `budget_exhausted` eval status) | none | Crew has no budget capability |
| 46 | Spend / burn | Token and cost per unit and per chat turn | `/ws` `cliUsage.costUsd`, `chatReply.usage` | DeckBurnChart and DeckKpiRibbon (this session's live stream only), ChatThread seat-usage, ApprovalDock | Partial: no per-run or historical spend (crew stores none) |
| 47 | Daemon config | Bound host/port and runtime config | `GET /config` | none | Not exposed |
| 48 | Identity | Who am I, trust level | `GET /whoami` | none | Not exposed |
| **Projects and repos** ||||||
| 49 | Projects | Create, edit (name, description, docs root), archive/restore, open dashboard, switch | `GET/POST /projects`, `GET/PATCH /projects/:id` | NewProjectModal, ProjectDetailPage, ProjectDashboard (docs-root edit), ProjectSwitcher, palette "New Project" | Exposed |
| 50 | Project members | Attach or detach a repo (or other member) | `GET/POST /projects/:id/members`, `DELETE …/:mid` | ProjectRepositories (project-repo-detach), RepositoriesPanel attach | Exposed |
| 51 | Project activity and prompts | Activity feed; prompt history | `GET /projects/:id/activity`, `GET /projects/:id/prompts` | ProjectDashboard, WorkChronicle `/p/:id/chronicle` | Exposed (read) |
| 52 | Register a repo | Register a local path, or clone and register | `GET/POST /repos` | RepositoriesPanel repos-add, `/repos/new` | Exposed |
| 53 | Onboard / index a repo | Run or re-run the onboarding workflow; reindex | `POST /repos/:id/onboard` (`GET` = latest onboard run id) | RepositoriesPanel repo-onboard/repo-reindex, RepoFindings *-reonboard, RepoGraphModal | Exposed (`GET …/onboard` unused) |
| 54 | Code graph | View the repo graph, kinds and hotspots | `GET /repos/:id/graph` | RepoGraphModal, HotspotsView, CytoGraph/ForceGraph | Exposed |
| 55 | Blast radius (repo) | Dependents of a symbol | `GET /repos/:id/graph/blast-radius` | RepoGraphModal action-preview | Exposed |
| 56 | Project graph | View; refresh the project graph | `GET /projects/:id/graph`, `POST …/graph/refresh` | ProjectGraphAction (ProjectDashboard, GroupChat) | Exposed |
| 57 | Project graph search and blast radius | Search symbols, blast radius across the project | `GET /projects/:id/graph/search`, `GET …/graph/blast-radius` | none | Not exposed |
| 58 | Repo history and contributors | Git history, contributors, commit cadence | `GET /repos/:id/git-history`, `GET /repos/:id/contributors` | RepoDetailPage (CommitCadence) | Exposed |
| 59 | Domain model and requirements | Domain graph; list/search requirements; view; override (status, risk, edit) | `GET /repos/:id/domain-graph`, `GET /repos/:id/requirements[/:key]`, `PATCH …/:key`, `GET /domain-graph` | RepoGraphModal (domain), RequirementsModal in RepoDetailPage | Exposed per repo; global `/domain-graph` wired, no UI |
| 60 | Capture learnings | Launch the capture-learnings workflow on a repo | `POST /runs` (workflow) | RepositoriesPanel repo-capture-learnings | Exposed (a single button) |
| **Seats, roster, council** ||||||
| 61 | Roster and standing | See each seat's health, signed-in state, auth, free tier, council eligibility and reason, bench (failures/last kind) | `GET /roster` | HealthRailSection rail-seat-row, SystemSettings seat-signin/-freetier, ContextPopover seat-health, ReassignControl benched | Exposed (read) |
| 62 | Sign a seat in | Run the seat's `login_invocation` in a PTY | `POST /terminals` + `/ws/terminals/:id` | SystemSettings seat-signin-* opens Terminal; ChatInput signin-warning | Exposed |
| 63 | Benched seats | Un-bench or reset a bench | none (bench is derived) | read only | Crew has no un-bench action |
| 64 | Council (chat) | Open a multi-seat chat with a scope (system/everything/project/repo/repos/none); message all or targeted seats; add/reseat agents; close | `GET/POST /chats`, `GET/DELETE /chats/:id`, `POST /chats/:id/messages`, `POST /chats/:id/seats` | GroupChat (add-agent, agent-picker, chat-scope-picker, seat-retry, chat-close), ChatsPage, AskDock/AssistDock (global) | Exposed |
| 65 | Council in runs | Choose the seat pool for a governed run; see quorum and council failures | `POST /runs` `clisJson`; `/ws` councilSeatFailed | ContextPopover launch-seat-*, councilQuorum, narrator | Exposed |
| **Health, diagnostics, dead letters, bus** ||||||
| 66 | Health | Daemon up, version | `GET /health` | ConnectionStatus, HealthRailSection | Exposed |
| 67 | Diagnostics | Component versions, store sizes, recent errors, ACP fold, governance landing, state-home classification, findings | `GET /diagnostics` | HealthRailSection (rail-health-toggle), SteeringHealth diagnostics, HomeBoard, skills recovery | Exposed (read) |
| 68 | Dead letters | See the governance dead-letter outbox (count, by type/reason, path, legacy outbox) | `GET /diagnostics.governance` | HealthRailSection rail-governance-outbox/-legacy | Exposed (read) |
| 69 | Replay dead letters | Replay the team outbox | `POST /team/outbox/replay` | none | Not exposed |
| 70 | Bus / event stream | Live CoreEvent feed; campaign events; terminal bytes | `GET /ws` | consumed app-wide; no bus browser | No cross-run event/bus viewer |
| 71 | Audit trail | Who launched, approved, rewrote a policy (filter by action, since) | `GET /audit` | ProvenanceLine, WorkChronicle (guidance entries) | Partial: no audit log page |
| 72 | Stall watchdog | Stalled and escalated workers | `/ws` workerStalled, workerStallEscalated | board headline, needsYou, narrator | Exposed (thresholds: see 44) |
| **Skills** ||||||
| 73 | Skills catalog | Browse effective skills; portability, provenance, conflicts, upgrades | `GET /skills` | SkillsPage `/skills`, SkillsGrid, SkillChips, sidebar | Exposed |
| 74 | Edit a skill | Open files, edit, save with a conflict guard; support files; baseline diff | `GET/PUT /skills/:name/files/*`, `GET /skills/:name/files`, `GET/PUT /skills/support/*` | SkillDrawer (skills-editor, skills-save, conflict keep/take, baseline view) | Exposed |
| 75 | Add / replace / reset a skill | Add a new skill (files map); replace; reset to baseline | `POST /skills`, `POST /skills/:name/replace`, `POST /skills/:name/reset` | skills-add-open + SkillFilesMapModal, skills-replace-open, skills-reset-open, SkillConfirmModal | Exposed |
| 76 | Enable / disable a skill | Toggle | `POST /skills/:name/enable`, `/disable` | setSkillEnabled in SkillsPage | Exposed |
| 77 | Analyze / publish / baseline | Lint findings; publish staged changes; refresh the baseline | `POST /skills/analyze`, `/publish`, `/refresh-baseline` | SkillFindings, skills-recover-publish/-refresh | Exposed |
| **Steering** ||||||
| 78 | Steering dashboard | Health, usage band, scoreboard verdict, store health | `GET /governance/wiki/meta`, `/scoreboard`, `GET /diagnostics` | GovernanceDashboard `/steering`, SteeringHealth, SteeringUsageBand | Exposed |
| 79 | Rules (policies) | List by type (7 types), filter retired, add, edit (effect, severity, trigger, weight, statement), view drawer and provenance | `GET/POST /governance/rules`, `GET /governance/rules/preview` | SteeringPage `/steering/policies?type=`, SteeringGrid (inline draft), SteeringRuleForm, SteeringRuleDrawer | Exposed (rules preview/recall wired, no UI) |
| 80 | Retire a rule | Retire with reason and typed confirm | `DELETE /governance/rules/:id` | SteeringRetireModal | Exposed |
| 81 | Import steering | Import entries per type (bulk) | `POST /governance/steering/import` | SteeringAddMenu, then SteeringPage | Exposed |
| 82 | Author steering by chat | Instructions + paths/documents launch a governed author run; the gate lands the approved rules | `POST /governance/steering/author` | SteeringAddMenu/AssistDock, AuthorPanel (CampaignsPage), SteeringGate | Exposed |
| 83 | Governance policies (legacy) | List, upsert, retire | `GET/POST /governance/policies`, `DELETE …/:id` | client fns exist, no caller | Wired, no UI |
| 84 | Claims, coverage, graph | Decision claims; coverage report; governance graph | `GET /governance/claims`, `/coverage`, `/graph` | CommandPalette claims search, CoverageView (RightPanel), DecisionsLedger | Exposed (read) |
| **Evals and testing (QE)** ||||||
| 85 | Recon / governed test | Launch a QE recon on project or repos | `POST /testing/recon` | TestingLaunchPanel (testing-recon-open) | Exposed |
| 86 | QE author | Author tests (project/repos, ungated, deliver) | `POST /testing/author` | TestingLaunchPanel (testing-author-open), per-repo fanout | Exposed |
| 87 | Evals | Run steering evals (by type, corpus); list and drill into eval runs; gap toggle | `POST /testing/evals/run`, `GET /testing/evals[/:id]` | TestingPage `/testing/evals`, EvalHistory | Exposed |
| 88 | Import a corpus | Import eval samples | `POST /testing/corpora/import` | TestingPage, SteeringGrid, palette | Exposed |
| 89 | Compare eval runs | Diff two eval runs (flips, permitted vs flagged) | none (`eval-compare.ts` is offline) | none | Not exposed (no route) |
| 90 | Acceptance / verdicts | Per-run acceptance; campaign ladder of verdicts | `GET /runs/:id/acceptance` | GovernanceAudit, CampaignScoreboard | Exposed (read) |
| **Proposals, memory, knowledge** ||||||
| 91 | Proposals | Review policy and memory proposals; approve; reject | `GET /proposals`, `POST /proposals/:id/approve`, `/reject` | ProposalsSection/ProposalsList in the steering dashboard and sections; sidebar count | Exposed |
| 92 | Memories | Browse by facet; coverage; retire a scope subtree | `GET /memory`, `GET /memory/coverage`, `POST /memory/retire` | MemoriesPanel `/steering/memories` (memory-retire + confirm) | Exposed |
| 93 | Knowledge ask | Ask a grounded question in the chosen scope | `POST /chats` scope + messages | AskDock (global ask-launcher), ChatScopeSelect | Exposed |
| **Documents (Vibe)** ||||||
| 94 | Documents | Create a doc from a prompt; list per project and across projects; open; thread-edit by chat | interactive proxy `/projects/:pid/interactive/*`, `GET /interactive/docs`, `POST …/interactive-events` | `/vibe`, `/p/:id/document/:doc`: DocumentThread, DocumentCanvas, doc-picker | Exposed |
| 95 | Versions | Select a version (`?v=`), fork, compare (split/overlay) | interactive proxy | VersionStrip, DocPanel compare-* | Exposed |
| 96 | Feedback | Pin comments on the canvas, submit a batch | interactive proxy events | FeedbackOverlay | Exposed |
| 97 | Render / export | HTML/PDF/PPTX report export | interactive proxy (postExport) | ExportMenu (DocPanel, VersionStrip, ProjectCard) | Exposed |
| 98 | Themes / brand | Learn a theme from a brand source; apply | interactive proxy (requestThemeLearn) | ThemesMenu, BrandLearn on `/theme` | Exposed |
| 99 | Sources | Attach a source file to a doc | interactive proxy (attachSource) | ComposerContext source-attach | Exposed |
| 100 | Delete a doc | Delete with confirm | interactive proxy / `DELETE …/interactive/docs/:doc` | DeleteDocButton (DocPanel, DocumentCanvas, VideoStoryboard) | Exposed |
| **Demos** ||||||
| 101 | Demos | Build a storyboard (steps add/remove); record a Playwright demo; status; compare versions | interactive proxy (listDemos, requestRecord, getDemoStatus) | `/demo`, `/p/:id/video/:demo`: DemoWizard, VideoStoryboard (video-record) | Exposed |
| **Terminals, worktrees, config** ||||||
| 102 | Terminals | Open a shell or login PTY, resize, close; observe an agent PTY read-only | `POST /terminals`, `/:id/resize`, `/:id/close`, `GET /ws/terminals/:id` | Terminal (palette "Open Terminal", RightPanel term-open-shell, SystemSettings); AgentTerminal (observer) in ChatPanel | Exposed |
| 103 | Worktrees | See or sweep run worktrees; open a path | none (sweep is automatic after delivery); `POST /open` | only per-run files/diff | No worktree management |
| **Notifications, appearance, skins** ||||||
| 104 | Notifications | Bell inbox; gate toasts; chime; desktop; off; permission | client-side over `/ws`; prefs in `PUT /settings` `studio.*` | NotificationBell, GateNotifications, NotificationSettings | Exposed |
| 105 | Appearance / skins | Pick a skin, accent, logo URL; light/dark toggle | `PUT /settings` (`studio.*`) | ThemePage/AppearanceSettings (skin-picker, accent-reset, logo-url-apply), palette "Toggle Theme", SkinRightRail | Exposed |
| 106 | Composer defaults | Remembered launch defaults | `PUT /settings` (`studio.*`) | composerPrefs | Exposed |
| 107 | Keyboard and palette | Global verbs (New Build/Chat/Document/Video/Project, Cancel run, Approve/Reject gate, Open Terminal, Config), fuzzy search runs/claims, triage keys | client-side | CommandPalette, ShortcutOverlay, useTriageCursor | Exposed |
| **Standing orders** ||||||
| 108 | Standing orders | Recurring or conditional instructions ("whenever X, do Y"; schedules; auto-triage) | none | none | Not built anywhere (0 hits in crew, studio, core, garden) |

## Orchestrator gaps: crew supports it, studio doesn't expose it

- **Campaign control**: `POST /campaigns` (the DAG launch with failure policy and concurrency), `/campaigns/:id/cancel`, `/campaigns/:id/resume`.
- **Run control**:
  - `POST /runs/:id/resume` (wired, no UI).
  - `POST /runs/archive` (bulk).
  - `GET /runs/:id/team` (team members and ledger).
  - Team dispute and transport gates are not distinguished.
  - There is no dedicated plan-approval gate card.
- **Presets**: `PUT/GET/DELETE /presets/:name` (save, view and delete presets).
- **Ops**:
  - `POST /team/outbox/replay` (dead-letter replay).
  - `GET /config`.
  - `GET /whoami`.
  - `GET /audit` has no page.
  - Settings keys (stall, escalation and reassign budget, base skill) have no controls.
- **Graph**: `GET /projects/:id/graph/search` and `/projects/:id/graph/blast-radius`; the global `/domain-graph` is wired but has no UI.
- **Governance**: `/governance/policies` CRUD and `/governance/rules/preview` are wired but have no UI.
  - Studio's `listWikiRuleSets` calls `/governance/wiki/rulesets`, which crew does not serve. It is dead code with no caller.
- **Dead studio UI** (built, unmounted): PhaseLadder, LiveOutput, GateLatencyChart, HomeKpiBand, EssenceStrip.

## Not in crew at all (would need backend work)

- Pause (distinct from gate or cancel).
- Budgets and spend caps.
- Per-run or historical cost (crew stores none; only the live `cliUsage` stream carries it).
- Un-benching a seat.
- Worktree listing and sweeping.
- Eval-run compare route.
- A cross-run event log or bus browser.
- Re-filing a run into another group after launch.
- Standing orders or schedules.
