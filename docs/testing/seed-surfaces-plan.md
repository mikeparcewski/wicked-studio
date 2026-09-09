# Seed-surfaces plan — seed and exercise every studio surface against a real daemon

**Executable form:** `e2e/seed_surfaces_test.py` (`python3 e2e/seed_surfaces_test.py`).
**Status:** revision 4 — the run-3 council plan (39 scenarios) rebuilt per the codex review's
REQUIRED CHANGES and the adjudication, then EXECUTED four times against disposable daemons
(§7). The recon in that plan stands (root causes, testid map, CI gap); its dependency graph, agent
classifications, selectors and oracles are replaced here, and three of its remaining source claims
were corrected by execution (the drawer header, the retired-facet default, the intake gate's
position relative to the distribution council).

## 1. Rig — a disposable, real-mode daemon (never :7701)

| Concern | How the suite handles it |
|---|---|
| Daemon | Spawned per run from the installed `wicked-crew` CLI (`CREW_CLI` overrides): temp state dir, free port, **no `--stub`** — the seeds are real engine rows. Refuses to run on :7701 or under `~/.wicked-crew`. |
| Isolation | `--db` → temp state home (audit, project settings, eval history, graphs — crew#353's `setCrewStateHome` follows it); **`WICKED_BUS_DATA_DIR` → temp bus shared by the daemon AND the bridge it spawns** (an explicit `--bus-db` pins only the daemon's half — the bridge knows only wicked-bus's default, which is the LIVE daemon's bus; see finding 7); `WICKED_HOME` → temp (memory store); `WICKED_WORKER_HOME` → temp (hermetic worker config home, crew#396 idiom); `WICKED_CREW_SYSTEM_SETTINGS` → temp; `WICKED_INTERACTIVE_ROOT` → temp docs root (the bridge pool starts its own `wicked-interactive serve` for that root and the suite terminates it from `<root>/.wi-serve.json`); **`WICKED_CREW_API` → the disposable daemon's own origin** — the bridge resolves the crew daemon from that variable and defaults to `:7701` (`wicked-interactive/src/service/project.js:27`), and crew's `bridge-pool.ts defaultSpawn` passes no origin of its own, so without it the bridge asks the LIVE daemon about projects that exist only here (run 2 of this suite: "project … not found on the crew daemon at http://127.0.0.1:7701"). |
| Agents | Interactive agent answering is **disabled** on the daemon (`--no-interactive-{draft,edit,chat,demo}-events`). Doc/demo creation therefore yields a real registry row (placeholder v0) and no generation run. Exactly **one** governed scenario (TST-1) runs, serialized, and its gate is **rejected**. |
| Repository | A `git clone --local` of this checkout at HEAD, inside the temp dir — this checkout is a linked worktree, and a run's own `git worktree add` from inside it would write into the main checkout's `.git/worktrees`. The clone's tracked `.codegraph/estate.db` is removed first (finding 8). Registered over the API (setup, labelled). Registration launches the built-in `onboarding` workflow: two **tool** phases (`wicked-estate index <root> --db <root>/.codegraph/estate.db`, `wicked-estate clusters --annotate`) — no agent, no council, temp-dir only; the suite waits for it so the project has a graph. |
| Governed budget | `SEED_GOVERNED=1` (default) runs TST-1 once, serialized. **A recon launch convenes the engine's distribution council (every signed-in seat) BEFORE its intake gate** — the gate is `before:1`, i.e. it parks execution, not planning (finding 10). `SEED_GOVERNED=0` records TST-1 as a skip with that reason, for the deterministic-only rerun. |
| Isolation proof | At teardown the suite scans the REAL `~/.wicked-crew` for anything carrying its run stamp and fails the run if it finds any (`teardown.live_state_home_touched`). |
| Served build | The daemon's bundled studio (same-origin). The report pins `crew`, `studioBundle`, `coreTs`, engine binaries, Playwright, chromium and node versions, and whether `studioBundle` equals this repo's `package.json` version. |
| Browser | Python Playwright, `chromium.launch()` headless, 1440×800. Gate toasts are hidden (display-only, as in `studio_standalone_test.py`); the gate asserted is the card **inside** the launch panel. |
| Persistence proofs | Every "survives reload" step is a real `page.goto` (full document load), never a pushState. |
| Substitutes | Steps the UI cannot perform are done over the daemon API and labelled `[SUBSTITUTE]` in the report, then **verified through the UI**: repo registration (setup), attaching the repo to Project A (no attach control until wicked-studio#207), seeding the first steering rule when the UI cannot (see STR-1), archiving projects (see CLN-2). |
| Verdicts | `pass` / `fail` / `skip` (with reason) / `xfail` (asserts the correct behaviour; fails today; marker names the issue) / `xpass` (an xfail that passed — the marker is stale; **fails the suite**). Exit 0 only with no `fail`/`xpass`. |

## 2. Dependency graph and seeding order

```
PRJ-1 (A) ─┬─ PRJ-2 (B) ── PRJ-3 (reload + switcher)
           ├─ ATT-1 (repo→A, substitute, UI-verified) ── TST-1 (governed, gate REJECTED) ── TST-S
           ├─ VIB-1D (doc in A) ─┬─ VIB-2D (doc in B) ── VIB-3 ✗#472
           │                     └─ VIB-4 (reload)
           ├─ DEM-1D (demo in A) ── DEM-3 ✗#472
           └─ TST-2 ✗App.tsx:466 (dynamic skip when no campaign card exists)
STR-1 (first rule, unseeded store) → STR-1S (substitute, only if STR-1 failed) → STR-1B → STR-2 → STR-3 → STR-4 → XPS-2
EVL-1 → EVL-2          MEM-2 (read-only)
CLN-1 (delete docs/demos — after every consumer) → CLN-STR (retire the substitute seed rule) → CLN-2 (UI archive) → CLN-2S (substitute archive, UI-verified)
```

Every scenario's seeded identifier (project ids, rule ids, doc/demo names, the eval run id, the
test run id) is captured in the harness context and consumed by the later scenarios by identity —
no scenario re-derives "the latest" of anything.

Chats, doc/demo **generation**, steering "Add with chat" and memory proposals all spawn agents;
they are governed scenarios and are listed in §5, not executed by this suite.

## 3. Scenarios (as executed)

Exact testids were verified against `testid-inventory.json` (studio 0.5.1) and the component
source. Selectors the run-3 plan got wrong are corrected here.

| id | surface | journey (UI unless labelled) | oracle (content / identity / persistence) | kind |
|---|---|---|---|---|
| PRJ-1 | Projects | `rail-heading-projects` ＋ (`heading-new` scoped to the heading) → `new-project-modal` → `new-project-name` = `e2e-scope-<ts>-a` → `new-project-create` | URL `/p/<id>/build`; `project-name` renders the name; `GET /projects/<id>` name matches | deterministic |
| PRJ-2 | Projects | same, `…-b` | same | deterministic |
| PRJ-3 | Projects | full reload of `/projects`; `/p/A/build` → `project-name` (the ProjectShell switcher trigger, `data-locked=false`) → `project-switcher-option[data-project-id]` → pick B | both `project-card[data-project-id]` render their names as `active`; switcher lists A and B by name; pivot lands on `/p/B/build` (mode retained, artifact dropped) and the header names B | deterministic |
| ATT-1 | Projects | `[SUBSTITUTE]` `POST /projects/A/members {kind:"crew.repo", ref}` (no UI attach control until #207) | `GET /projects/A` lists exactly that `crew.repo` member and `GET /projects/B` lists none; A's dashboard renders `dashboard-repo[data-repo-ref]`; B's renders no `dashboard-repos` | deterministic |
| STR-1 | Steering | on the **unseeded** store: `steering-add-menu` → `steering-add-open` → draft row | `steering-grid-draft` appears and the rule saves | deterministic — **fails today**: `SteeringPage` mounts the grid only when rules exist (`{!unseeded && <SteeringGrid/>}`), so the banner's own "Add a row" path is inert |
| STR-1S | Steering | `[SUBSTITUTE]` `POST /governance/rules` with the exact `draftRule` body (PAT-100) — only when STR-1 failed | after reload the grid mounts with `steering-grid-row[data-rule-id=PAT-100]` | deterministic |
| STR-1B | Steering | Add ▾ → Add row → keep the prefilled `PAT-nnn` id → `steering-draft-statement` → `steering-draft-save` | draft detaches; the row's `steering-cell-statement` equals the statement; `steering-saved-note` says `Saved <id>` | deterministic |
| STR-2 | Steering | full reload | row present; statement/type/severity cells equal what was typed; server row carries `provenance.source: "ui"` | deterministic |
| STR-3 | Steering | `steering-grid-id` (opens the drawer; the id is the drawer's **header**, `aria-label="Rule <id>"` — `steering-rule-detail` is the field list under it) → `steering-rule-statement` carries the statement → `steering-edit-open` → `steering-rule-form` (`steering-form-id` read-only = id) → `steering-form-severity` = error, `steering-form-statement` rewritten → `steering-form-save` | cells update; both values survive a full reload | deterministic |
| STR-4 | Steering | row `steering-grid-retire` → `steering-retire-modal`: confirm disarmed until `steering-retire-confirm-input` = exact id **and** `steering-retire-reason` non-empty → `steering-retire-confirm` | `steering-retired-note` echoes id + reason; **retire never deletes and the default facet LISTS retired rows** (`GRID_FACETS_DEFAULT.includeRetired = true`, chip reads "retired shown", `aria-pressed=true`): the row stays with `data-retired=true` + `steering-rule-retired-chip`; toggling `steering-filter-retired` to "retired hidden" detaches it; after a full reload the default facet lists it struck again and the toggle still hides it; `GET /governance/rules` (default `status=all`) → `retired:true`. The run-3 plan's "hidden by default" was wrong | deterministic |
| XPS-2 | Steering | reach `/steering/policies` after standing in Project B's shell; make sure the retired facet is ON (`aria-pressed`) rather than blindly toggling it | grid rule-id set == store rule-id set (global corpus; no `projectId` on the wire) | deterministic |
| EVL-1 | Evals | `/testing/evals` → `testing-evals-run` | `testing-evals-summary` numbers; `testing-evals-row` count == total; `blocked+passed+gaps+fp == total`; exactly one `eval-history-row`; its `eval-history-detail` text carries the same numbers; `GET /testing/evals/:id` agrees | deterministic (engine replay, no model call — `wicked-governance/src/evals.rs`) |
| EVL-2 | Evals | full reload → same `eval-history-row[data-run-id]` → drilldown | identical drilldown text | deterministic |
| MEM-2 | Memories | `/steering/memories` → settled state → `memories-search` + `memories-search-go` → revisit after Project B | state and row count are settled, error-free and context-independent. **Retire is never exercised**: `memory-retire` sends the item's scope as `scope_prefix` — a subtree erasure (`memory.ts:101`) | deterministic, read-only |
| VIB-1D / VIB-2D | Vibe | `/p/X` → `dashboard-mode-document` → (InstallGate `install-gate-continue` if shown, recorded) → `doc-composer` ask with a quoted name → `doc-composer-submit` | URL `/p/X/document/<name>`; `doc-canvas[data-doc-id]` frames it | deterministic seed (generation disabled) |
| VIB-4 | Vibe | full reload at the doc URL | `doc-canvas[data-doc-id]`; A's `doc-picker-row[data-doc-id]` lists it; the versions wire answers | deterministic |
| VIB-3 | Vibe | compare `doc-picker-row[data-doc-id]` under `/p/A/document` and `/p/B/document` | **correct behaviour:** A lists only A's doc, B only B's | **xfail crew#472** (shared `rootFor()` default root) |
| DEM-1D | Demo | `/p/A` → `dashboard-mode-video` → composer ask opens `demo-wizard` → `wizard-target` (a local fixture URL), one `wizard-step-subject`/`wizard-step-action` + `wizard-step-add` → `wizard-create` | URL `/p/A/video/<name>`; `demo-picker-row[data-demo-id]` lists it | deterministic seed (authoring disabled; the wizard's steps are NOT consumed by the backend — see §5) |
| DEM-3 | Demo | compare `demo-picker-row[data-demo-id]` under `/p/B/video` | **correct behaviour:** B lists none of A's demos | **xfail crew#472** |
| TST-1 | Tests | `/p/A` → `dashboard-campaigns` → `project-campaigns[data-project-id]` → `testing-campaign-open` → `testing-launch-panel[data-intent=campaign]` (`testing-launch-project` pre-bound to A; `testing-launch-chip[data-source=project]` shows the repo) → `testing-launch-instructions` → `testing-launch-submit` → `testing-launch-waiting` → the intake gate card (`steering-gate` inside the panel) → `steering-reject` | run found by its brief token; gate `steering-prompt` non-empty while the run is `awaiting_human`; the `council*` events recorded before the gate are reported (the distribution council runs first — finding 10); `testing-launch-resolved`; run ends `cancelled` (routes.ts: "approve:false = reject (cancels)") and **no planned unit reaches running/completed**. A run that fails before its gate because the worker home has no CLI login → **skip with reason**; `SEED_GOVERNED=0` → skip with reason | **governed** (the one and only), serialized |
| TST-S | Tests | `/p/A` vs `/p/B` dashboards | `dashboard-run[data-run-id]` present on A (membership join), absent on B; the run's problem carries the brief | deterministic |
| TST-2 | Tests | `campaign-card[data-campaign-id]` under `/p/A/campaigns` vs `/p/B/campaigns` | **correct behaviour:** B excludes A's campaigns. Dynamic **skip** when A renders no card: a single-repo test registers no engine campaign (`campaignRegistered:false`), so the gap is not observable with one repo | **xfail App.tsx:466** |
| CLN-1 | Vibe/Demo | picker `doc-delete-trigger[data-doc-id]` → `doc-delete-confirm` → `doc-delete-go`, per seeded doc/demo, after every consumer | absent from the picker after a full reload | deterministic — **fails today** on the published `wicked-interactive@0.8.1` bridge (no `DELETE /api/docs/:doc`; finding 9) |
| CLN-STR | Steering | retire the STR-1S substitute seed (PAT-100) through the same Retire modal (only when STR-1S seeded it) | `data-retired=true`; `GET /governance/rules` → `retired:true` | deterministic |
| CLN-2 | Projects | `/projects/:id` → ProjectDetailPage → Archive | the Archive control is reachable | deterministic — **fails today**: `useLegacyRedirect` replaces `/projects/:id` with `/p/:id`; ProjectDetailPage (the only Archive/Restore control) is unreachable |
| CLN-2S | Projects | `[SUBSTITUTE]` `PATCH /projects/:id {status:"archived"}` for A and B | `/projects`: no active card for either; the "Show N archived projects" toggle reveals both with `data-status=archived` | deterministic |

## 4. Project-scoping observables (what the suite certifies today)

| Surface | Observable | Verdict |
|---|---|---|
| Projects | cards/switcher by id + name after reload; pivot retains mode, drops artifact | correct |
| Repositories on a project | `dashboard-repo[data-repo-ref]` on A only | correct (attach itself is API-only until #207) |
| Runs filed under a project | `dashboard-run[data-run-id]` on A only — a client-side membership join (`ProjectDashboard.tsx`: `sessionProjectId` first, membership fallback), no server `?projectId=` filter | correct |
| Documents / demos | pickers must be disjoint | **UNMET** — crew#472 (`proxy-routes.ts rootFor()` falls through to one shared root when `interactiveRoot` is unset) → xfail |
| Tests (campaign store) | `/p/:id/campaigns` must be partitioned | **UNMET** — documented in `App.tsx:466`; not observable with a single-repo test → xfail/skip |
| Steering / Evals | global corpus and global history; identical from any project context | correct by design |
| Steering retire | never deletes; retired rows are listed struck under the default facet and hideable per operator | correct by design (`GRID_FACETS_DEFAULT.includeRetired = true`) |
| Memories | browse is global; scopes/facets carry project semantics (`memory.ts`), so "global navigation" ≠ "no project semantics" | read-only here |

## 5. Governed scenarios (not executed by this suite)

These spawn agents and are run one at a time, never alongside each other, and never by the seed
suite:

- **CHT-1..4** — every chat warms the chat-capable roster seats (`GroupChat.tsx`); no deterministic single-seat path exists.
- **VIB-1/VIB-5** — document generation / revision (a real drafting agent per `doc.created`).
- **DEM-1 (authored)** — the demo create emits `doc.created(kind:demo)` unconditionally and crew's demo seam launches an authoring run; the wizard's `demo_steps` have **no backend consumer** (interactive + crew source: zero readers) — the step form is decorative. Product defect to file on studio/interactive.
- **STR-5** — "Add with chat" lives in the assist dock: `assist-input`, `assist-send`, `assist-run-waiting` (not `steering-author-*`); the menu item is "Open assistant".
- **MEM-1/MEM-3** — no deterministic memory producer; retire is a scope-subtree erasure and needs an exclusive seed scope before it is ever exercised.
- **EXE-1..4** — build runs (the full council per phase).

## 6. Findings this suite surfaces (each is a `fail` row, not papered over)

1. **STR-1 — "Add row" is inert on an unseeded store.** `SteeringPage.tsx` mounts `SteeringGrid` only when `!unseeded`; the unseeded banner tells the operator to "Add a row", but the draft row lives in the grid, so the first rule cannot be authored from the UI. The suite seeds one rule over the wire (labelled) and continues.
2. **CLN-2 — no reachable UI affordance archives a project.** The Archive/Restore buttons exist only on `ProjectDetailPage` (`/projects/:id`), which `useLegacyRedirect` replaces with `/p/:id` on mount. The suite archives over `PATCH /projects/:id` (labelled) and verifies through `/projects`.
3. **VIB-3 / DEM-3 — crew#472** (xfail): documents and demos leak across projects.
4. **TST-2 — App.tsx:466** (xfail, not observable with one repo): the campaign store is not project-partitioned.
5. **Rig finding for crew (not a studio defect): the bridge pool spawns `wicked-interactive serve` without naming the daemon.** `bridge-pool.ts defaultSpawn` runs `npx wicked-interactive@^0.8.1 serve --root <root>` with the daemon's inherited env and never exports `WICKED_CREW_API=<bound origin>` (the pool already computes `boundOrigin` for the `studio_origin` POST). The bridge's project lookups therefore dial `:7701` whatever port the daemon listens on — a second daemon on this machine silently validates projects against the first. The suite sets the variable itself; the pool should.
6. **The daemon's `wicked.estate.rule.*` emits dead-letter to a user-global spool** (`~/.something-wicked/wicked-apps/emit-outbox.ndjson`, "no shared store (WICKED_ESTATE_DB unset)") — an append outside the temp dir the suite cannot pin without an estate store. Recorded, not fixed here.
7. **Rig finding for crew: a `--bus-db`-isolated daemon's bridge still emits on the LIVE bus.** The bridge emits `wicked.interactive.doc.created` through wicked-bus, which resolves `WICKED_BUS_DATA_DIR` › the platform default — the same default the live `:7701` daemon consumes. Run 3 of this suite (daemon pinned with `--bus-db`, bridge inheriting no bus env) produced three EMPTY handoff dirs in the operator's real state home — `~/.wicked-crew/interactive-drafts/seed-doc-{a,b}-<stamp>` and `~/.wicked-crew/interactive-demos/seed-demo-a-<stamp>` — created by the live daemon's draft/demo seams reacting to this suite's events (the live daemon launched no run: `GET /runs` on :7701 shows nothing new; the disposable daemon's own state home had none of them). The three dirs were removed by hand (`rmdir`, empty-only) and this is disclosed here. Fix in the suite: pin `WICKED_BUS_DATA_DIR` instead of `--bus-db` so daemon and bridge share one temp bus; fix for crew: the pool should pass the daemon's bus location (and `WICKED_CREW_API`, finding 5) to the bridge it spawns.
8. **Repo hygiene: `.codegraph/estate.db` (4 MB SQLite) is tracked in wicked-studio.** A fresh clone therefore carries the main checkout's graph, and onboarding's `wicked-estate index` refuses it ("REPO COLLISION: this graph already holds https://github.com/mikeparcewski/wicked-studio.git (at …/wicked-studio)"). The suite deletes it from its temp clone; the repo should gitignore it (separate PR).
9. **CLN-1 — the studio's document/demo Delete targets an unpublished bridge route.** `DeleteDocButton` → `DELETE …/interactive/docs/:doc`; the published `wicked-interactive@0.8.1` the pool installs has no `DELETE /api/docs/:doc` (the route exists only in the unreleased 0.9.0 checkout, #189), so the bridge answers 404 and the UI shows its "bridge predates" hint. The delete journey cannot be certified on a published bridge — a release-parity gap (interactive 0.9.0 not cut), not a studio bug.
10. **The intake gate does not precede the distribution council.** `RECON_INTAKE_GATE_TOKEN = 'before:1'` parks execution of unit 1; while the run reads `distributing`, the engine already convenes every signed-in seat to vote on the plan (run 3: 5 seats, `councilDeliberated`/`councilVoted` on ords 1–4, one `non_zero_exit` from opencode — "database is locked" — and consensus at 100 % before the gate arrived ~2 min after launch). "Reject so no council executes" is therefore true of the EXECUTION councils only; the planning council's CLI spend happens before anyone can say no. Also: `WICKED_WORKER_HOME` isolates only the claude seat's sign-in (`seat-signin.ts`); codex/pi/copilot/opencode resolve from the operator's real home, so the "hermetic" worker home does not stop those seats from convening with real credentials.

## 7. Executed — against disposable daemons

Four executions on the same machine as the live `:7701` daemon (never touched; verified by
`GET /api/v1/runs` on it before and after — nothing new — and by the stamped-entry scan of
`~/.wicked-crew` at teardown). Runs 1–2 were harness debugging (run 1: a URL race read Project A's
URL as B's; run 2: a wrong `attachedBy` enum value, and the bridge dialling `:7701` — finding 5).
Run 3 is the one governed execution (TST-1 reached its gate and was rejected) and is the run that
leaked three empty handoff dirs into the operator's `~/.wicked-crew` (finding 7 — disclosed,
removed). Run 4 is the certified deterministic layer with the bus pinned and the isolation proof
asserted; its governed scenario was disabled (`SEED_GOVERNED=0`) because the brief budgets exactly
one governed execution and run 3 spent it.

### 7.1 Run 4 — `SEED_GOVERNED=0 python3 e2e/seed_surfaces_test.py` (certified)

- crew `0.7.25` · studioBundle `0.5.1` (equals this repo's `package.json`: True) · core-ts `0.7.16` · wicked-core `0.4.0` · wicked-estate `0.15.1` · bridge `wicked-interactive@0.8.1` · Playwright `1.58.0` · chromium `145.0.7632.6` · node `v26.0.0`
- isolation: state home, bus data dir, memory store, worker home, system settings, docs root and `WICKED_CREW_API` all under the temp dir; interactive agent answering disabled; `teardown.live_state_home_touched = []`
- onboarding of the registered clone: `completed` (fresh graph after removing the tracked `.codegraph/`)
- counts: {'pass': 19, 'fail': 3, 'xfail': 2, 'xpass': 0, 'skip': 3} — exit 1 because the three `FAIL` rows are findings 1, 2 and 9, and `xpass` = 0 (both xfails still fail, i.e. crew#472 is still open)

| id | scenario | status | s | detail (first line) |
|---|---|---|---|---|
| PRJ-1 | Create Project A via the rail ＋ → modal → Create | **PASS** | 0.3 | Project A = proj_178892805679800000 (e2e-scope-1788928041-a); landed on /p/proj_178892805679800000/build with the shell header naming it |
| PRJ-2 | Create Project B (the scoping control) the same way | **PASS** | 0.1 | Project B = proj_178892805691400001 (e2e-scope-1788928041-b) |
| PRJ-3 | Reload persistence + ProjectShell switcher identity | **PASS** | 0.1 | after a full reload both cards render their names as active; the ProjectShell switcher lists A and B and pivoting to B retains the mode verb and drops the artifact |
| ATT-1 | Attach the repository to Project A (API substitute, UI-verified) | **PASS** | 0.7 | [SUBSTITUTE] repo seed-surfaces-1788928041 attached to A over POST /projects/proj_178892805679800000/members (no UI attach control until #207); UI verifies: A's dashboard renders the repo tile, B's renders none |
| STR-1 | Author the FIRST rule via Add row on the unseeded store | **FAIL** | 5.2 | assertion: 'Add row' produced no draft row while the UNSEEDED banner is showing — SteeringPage mounts the grid only when rules exist (`{!unseeded && <SteeringGrid/>}`), so the banner's own 'Add a row' path cannot author the first… |
| STR-1S | Seed the store so the grid mounts (API substitute, only if STR-1 failed) | **PASS** | 0.1 | [SUBSTITUTE] PAT-100 seeded over POST /governance/rules (the exact body the draft row sends) so the grid mounts |
| STR-1B | Author a rule via Add row on a seeded store | **PASS** | 0.2 | PAT-101 authored through the draft row (prefilled id kept; statement set; saved note names it) |
| STR-2 | Reload persistence of the authored rule (content) | **PASS** | 0.1 | PAT-101 survives a full reload with statement/type/severity intact; server row carries provenance.source=ui |
| STR-3 | Edit via the drawer (steering-grid-id → Edit…) and reload | **PASS** | 0.2 | PAT-101 edited through the drawer's Edit form (severity warn→error, statement rewritten); both persist across a reload |
| STR-4 | Retire with exact id + reason; listed-struck by default; hideable; reload | **PASS** | 0.2 | PAT-101 retired with typed id + reason; the note echoes both; the row stays listed struck under the default 'retired shown' facet (before and after a reload) and leaves under 'retired hidden'; server row retired=true |
| XPS-2 | Steering is global — grid ids == store ids from another project's context | **PASS** | 0.1 | the grid renders exactly the store's 2 rule ids regardless of the project context it was reached from (global corpus, no projectId on the wire) |
| EVL-1 | Run evals; report ⇄ history drilldown ⇄ API agree | **PASS** | 0.1 | eval run 0edef3f89deb4349aa74bcd7d259384e: 27 samples · 11 caught · 16 gaps · 0 fp — report, result rows, history drilldown and GET /testing/evals/:id all agree |
| EVL-2 | Eval history + drilldown persist across reload (identity + content) | **PASS** | 0.1 | after a full reload the history still holds exactly 0edef3f89deb4349aa74bcd7d259384e and its drilldown text is byte-identical |
| MEM-2 | Memories browse is read-only, settled, and context-independent | **PASS** | 1.0 | panel state 'memories-empty' (0 rows) on the isolated store; search round-trips to 'memories-empty' (0); identical when reached after Project B (memories-empty, 0) |
| VIB-1D | Seed a document in Project A via the composer (deterministic) | **PASS** | 0.1 | doc 'seed-doc-a-1788928041' created under A through the composer (placeholder v0 — drafting agent disabled on this daemon); canvas frames it |
| VIB-2D | Seed a document in Project B via the composer (deterministic) | **PASS** | 0.2 | doc 'seed-doc-b-1788928041' created under B |
| VIB-4 | Document survives a reload (canvas identity + picker listing) | **PASS** | 0.1 | after a full reload the canvas frames 'seed-doc-a-1788928041' and A's picker lists it; versions wire → 200 head=0 |
| VIB-3 | Documents are disjoint per project (A ∌ B's doc, B ∌ A's doc) | **XFAIL** | 0.1 | expected failure (crew#472): Project A's picker lists B's document 'seed-doc-b-1788928041': ['seed-doc-b-1788928041', 'seed-doc-a-1788928041'] |
| DEM-1D | Seed a demo in Project A via the wizard (deterministic) | **PASS** | 0.2 | demo 'seed-demo-a-1788928041' created under A via the wizard (target http://127.0.0.1:52784/doc-fixture.html, one hand-pinned step; authoring agent disabled); A's picker lists it |
| DEM-3 | Demos are disjoint per project (B ∌ A's demo) | **XFAIL** | 0.1 | expected failure (crew#472): Project B's demo picker lists A's demo 'seed-demo-a-1788928041': ['seed-demo-a-1788928041'] |
| TST-1 | New test from Project A → intake gate arrives → REJECT (no council runs) | **SKIP** | 0.0 | governed scenario disabled by SEED_GOVERNED=0 — a recon launch convenes the engine's distribution council (real CLI seats) BEFORE its intake gate; run with SEED_GOVERNED=1 to exercise the gate, serialized, once |
| TST-S | The test run is scoped: on A's dashboard, absent from B's | **SKIP** | 0.0 | no test run was launched |
| TST-2 | Tests list is partitioned per project | **SKIP** | 0.6 | no campaign card to partition: a single-repo test registers no engine campaign (campaignRegistered:false), so the App.tsx:466 gap is not observable on this rig |
| CLN-1 | Delete every seeded document/demo through the UI | **FAIL** | 0.6 | assertion: delete refused: the daemon refused this — wicked-interactive answered 404 without the retire wire's body — this bridge likely predates DELETE /api/docs/:doc (the doc may still be alive), so crew's handoff-ledger rows w… |
| CLN-STR | Retire the substitute seed rule through the UI | **PASS** | 0.1 | PAT-100 (the STR-1S substitute) retired through the grid's Retire modal; server row retired=true |
| CLN-2 | Archive a project through the UI (ProjectDetailPage → Archive) | **FAIL** | 0.6 | assertion: ProjectDetailPage (the only Archive control, ProjectDetailPage.tsx) is unreachable: /projects/proj_178892805679800000 redirected to /p/proj_178892805679800000 (useLegacyRedirect) — no reachable UI affordance archives a… |
| CLN-2S | Archive both projects (API substitute, UI-verified) | **PASS** | 0.6 | [SUBSTITUTE] both projects archived over PATCH /projects/:id; UI verifies: no active card, both listed under the archived toggle |

### 7.2 Run 3 — the governed scenario, executed once (`SEED_GOVERNED=1`, otherwise identical seeds)

Deterministic rows identical to run 4 except `CLN-1`'s reason wording; onboarding `failed` (the
tracked `.codegraph/estate.db` collision — finding 8, fixed for run 4). The governed rows:

| id | scenario | status | s | detail (first line) |
|---|---|---|---|---|
| TST-1 | New test from Project A → intake gate arrives → REJECT (no council runs) | **PASS** | 121.7 | run 5e859556-c9a3-4662-bcce-53553c2049bc launched from A (project pre-bound, repo chip via project), parked at its intake gate, REJECTED in the panel → cancelled; prompt: 'Approve unit 1 before it runs: New test: plan the test for the attached scope — the scenarios, their dependencies, and w' |
| TST-S | The test run is scoped: on A's dashboard, absent from B's | **PASS** | 0.7 | A's dashboard lists run 5e859556-c9a3-4662-bcce-53553c2049bc (membership join, problem carries the brief); B's does not |

What run 3 additionally established (read-only `GET /runs/:id/events` on the disposable daemon
while TST-1 waited): the run read `distributing` for ~2 minutes while five seats
(`claude` unsigned under the hermetic worker home; `codex`, `pi`, `copilot`, `opencode` signed in
from the operator's real home) produced `councilDeliberated` / `councilVoted` events for ords 1–4
(one `non_zero_exit` from `opencode`: "database is locked"), reached 100 % agreement, and only
THEN raised the intake gate — finding 10. Rejecting it cancelled the run with every planned unit
still `pending`; A's dashboard listed the cancelled run and B's did not (TST-S).

### 7.3 Verdict summary

| outcome | rows | meaning |
|---|---|---|
| pass | 19 (run 4) / 21 (run 3) | journeys certified through the UI with content/identity/persistence oracles; `[SUBSTITUTE]` rows are API steps that were then UI-verified |
| xfail | VIB-3, DEM-3 | crew#472 reproduced on a real daemon: both projects' pickers list each other's documents and demos |
| fail | STR-1, CLN-1, CLN-2 | findings 1, 9, 2 — product gaps, not harness gaps |
| skip | TST-2 (both runs); TST-1, TST-S (run 4 only) | TST-2: a single-repo test registers no engine campaign, so the App.tsx:466 gap is not observable with one repo; TST-1/TST-S: governed budget spent by run 3 |
