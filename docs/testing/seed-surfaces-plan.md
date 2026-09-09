# Seed-surfaces plan — seed and exercise every studio surface against a real daemon

**Executable form:** `e2e/seed_surfaces_test.py` (`python3 e2e/seed_surfaces_test.py`; `--self-test` runs
the harness's own safety checks without a daemon).
**Status:** revision 5 — revision 4 (the run-3 council plan rebuilt and executed four times) was REJECTED by
the codex review for harness-safety and oracle defects; this revision fixes each REQUIRED CHANGE (§8 maps
finding → fix), restores the binding coverage matrix (§4b), and was executed ONCE against a fresh
disposable daemon with the governed scenario enabled (§7). The recon in the run-3 plan stands (root causes,
testid map, CI gap).

## 1. Rig — a disposable, real-mode daemon in a hermetic environment (never :7701, never the operator's home)

| Concern | How the suite handles it |
|---|---|
| Daemon | Spawned per run from the installed `wicked-crew` CLI (`CREW_CLI` overrides): temp state dir, free port, **no `--stub`** — the seeds are real engine rows. Refuses :7701. Runs in **its own process group** (`start_new_session`), so every non-detached child (workers, estate-mcp) is torn down with it. |
| Environment | **Built from scratch, never inherited** (`Rig.build_env`). Pass-through: `PATH` (node, npx, git, wicked-estate and the CLI seats resolve from it), `LANG`, `USER`/`LOGNAME` (identity, not paths) — recorded as `setup.write_targets.env_passthrough`. Everything else points INTO the temp dir: a scratch `HOME`; `TMPDIR`/`TMP`/`TEMP`; `--db` → state home (crew#353's `setCrewStateHome` follows it: audit, project settings, eval history, graphs, worktrees); `WICKED_BUS_DATA_DIR` → the bus the daemon AND the bridge share (wicked-bus `paths.js`: env › `~/.something-wicked/wicked-bus`); `WICKED_HOME` → memory store; `WICKED_WORKER_HOME` → worker config home (crew#396 idiom); `WICKED_CREW_SYSTEM_SETTINGS`; `WICKED_WORKFLOWS_DIR` (else `~/.config/wicked-core/workflows`); `WICKED_STEERING_INBOX_DIR` (else `~/.wicked/steering-inbox`); `WICKED_ESTATE_EMIT_DEADLETTER` + `WICKED_APPS_EMIT_DEADLETTER` (the Rust spools that otherwise append to `~/.something-wicked/{wicked-estate,wicked-apps}` — finding 6); `WICKED_ESTATE_REPO_GRAPH_ROOT` (the engine's per-repo code graph, else `~/.wicked-estate/repo-graphs` — finding 11); `WICKED_INTERACTIVE_ROOT` → temp docs root; **`WICKED_CREW_API` → the disposable daemon's own origin** (the bridge resolves the crew daemon from it and defaults to `:7701` — crew#476); `npm_config_cache` → a scratch npm cache. Every child of the daemon inherits this env (`bridge-pool.ts defaultSpawn` passes none of its own). |
| Write-target guard | Before anything starts, every write target (the temp dir, HOME, TMPDIR, the state home, the clone, the npm cache, every path-valued `WICKED_*`) is resolved and asserted NOT to be under the operator's real home or `~/.wicked-crew` — `setup.write_targets` (a violation is a setup failure). |
| Bridge | The pool spawns `npx --yes wicked-interactive@^0.8.1 serve --root <root>` **detached** under the scratch HOME. The operator's already-resolved `~/.npm/_npx/<hash>` install for exactly that spec is CLONED (APFS clonefile; read-only on the source) into the scratch npm cache under the same key, so the bridge starts offline in ~5 s (`setup.bridge_cache`). |
| Agents | Interactive agent answering is **disabled** (`--no-interactive-{draft,edit,chat,demo}-events`): doc/demo creation yields a real registry row (placeholder v0), no generation run. Exactly **one** governed scenario (TST-1) runs, serialized, and its gate is **rejected**. |
| Repository | A `git clone --local` of this checkout at HEAD, inside the temp dir (this checkout is a linked worktree; a run's own `git worktree add` from inside it would write into the main checkout's `.git/worktrees`). The clone's tracked `.codegraph/estate.db` is removed first (finding 8). Registered over the API (setup, labelled); the built-in `onboarding` workflow (two **tool** phases, no agent, no council) is waited on. |
| Startup | Bounded for real: a reader thread pumps the daemon's stdout to the log and (during startup) onto a queue; the main thread waits on the queue with the remaining deadline (90 s). A silent daemon, a dead daemon (EOF) and a late daemon all end in a group stop + a setup failure carrying the log tail. |
| Build identity | **Enforced**: the served `studioBundle` version must equal this repo's `package.json` version or setup fails (the results would describe another revision). The served `index.html` and every `/assets/*` it references are fetched and SHA-256'd into `setup.build_identity`. |
| Teardown — every exit path | The daemon and Chromium live inside ONE `try/finally`. On success, exception or interruption (SIGINT/SIGTERM): live runs on the disposable daemon are cancelled (each `POST /runs/:id/cancel` response verified, terminal state polled); the browser is closed; the daemon's process group is SIGTERMed → polled (leader exit AND empty group) → SIGKILLed → polled; the detached bridge is found **by identity** — command line naming `wicked-interactive` AND our unique temp root, started after our daemon — and terminated the same way. `.wi-serve.json` is advisory only: a symlink is refused, the pid must be a positive integer, and it is cross-checked against the identified processes; a lock pid that matches no identified process is **not signalled**. The temp dir is removed (`SEED_KEEP_TMP=1` keeps it). |
| Isolation proof | Re-derived at teardown: (a) entries under the real `~/.wicked-crew` whose NAME carries this run's identifiers; (b) a **byte-scan** of every file under the operator-global wicked stores (`~/.wicked-crew`, `~/.something-wicked`, `~/.wicked`, `~/wicked-interactive`, `~/.wicked-interactive`, `~/.wicked-worker`, `~/.config/wicked-{core,crew}`) that was **modified during the run**, for this run's composite identifiers (project names, repo name, doc/demo names, rule text, brief token, temp-dir name, project/repo/run ids — never the bare stamp, which is a substring of every same-second millisecond timestamp); (c) a read-only diff of the live `:7701` daemon's run ids before/after. Any hit is `live_touched` and **fails the process** regardless of the scenario table. What the daemon and its children wrote into the scratch HOME/TMPDIR is listed as the `HOME-WRITES` finding (finding 11). |
| Browser | Python Playwright, `chromium.launch()` headless, 1440×800, launched inside the daemon's `try/finally`. Gate toasts hidden (display-only); the gate asserted is the card **inside** the launch panel. |
| Persistence proofs | Every "survives reload" step is a real `page.goto` (full document load), never a pushState. |
| Substitutes | Steps the UI cannot perform are done over the daemon API, labelled `[SUBSTITUTE]`, then **verified through the UI**: repo registration (setup), attaching the repo to Project A (studio#207), seeding the first steering rule when the UI cannot (studio#212), archiving projects (studio#214). |
| Verdicts | `pass` / `fail` / `skip` (an ESTABLISHED environmental cause only) / `blocked` (explicit: the rig cannot make it observable within budget — reason + issue) / `xfail` (asserts the correct behaviour; the ONE assertion tied to the issue fails today) / `xpass` (a stale marker — **fails the suite**). |
| xfail hygiene | `expect_gap(cond, issue, msg)` marks the single assertion an issue excuses; every other assertion in an xfail scenario is a plain `assert` and FAILS normally. VIB-3's oracle (`disjoint_pickers_oracle`) requires both pickers non-empty and each project's own document listed before the leak can count as crew#472 — an empty-both-lists state is a FAIL. |
| Skip hygiene | TST-1 failing before its gate is a skip only when `/roster` shows **no** signed-in seat; a mode surface's error is a skip only when the daemon itself answers `503 bridge_unavailable`; evals "unsupported" only when `GET /testing/evals` is 501. Everything else is a failure with the UI's text. |
| Exit code | `0` **only** when `report.ok`: no `fail`/`xpass`, `live_touched` empty, no setup failure, nothing aborted. `--self-test` proves `report.ok=false ⇒ exit≠0` (and the xfail/blocked/pid-identity/gate-oracle plumbing) in-process. |

## 2. Dependency graph and seeding order

```
PRJ-1 (A) ─┬─ PRJ-2 (B) ── PRJ-3 (reload + switcher)
           ├─ ATT-1 (repo→A, substitute, UI-verified) ── TST-1 (governed, gate REJECTED, event-log oracle) ── TST-S
           ├─ VIB-1D (doc in A) ─┬─ VIB-2D (doc in B) ─┬─ VIB-3  ✗crew#472 (pickers disjoint)
           │                     │                     └─ VIB-3F ✗crew#472 (foreign deep link)
           │                     └─ VIB-4 (reload + versions head/lineage)
           ├─ DEM-1D (demo in A) ── DEM-3 ✗crew#472
           └─ TST-2 ⊘ BLOCKED (needs a ≥2-repo fan — over the governed budget; App.tsx:466, studio#216)
STR-1 ✗studio#212 (first rule, unseeded) → STR-1S (substitute, only if STR-1 did not pass) → STR-1B → STR-2 → STR-3 → STR-4 → XPS-2
EVL-1 → EVL-2          MEM-2 (read-only)
CLN-1 ✗studio#213 (delete docs/demos — after every consumer) → CLN-STR → CLN-2 ✗studio#214 (UI archive) → CLN-2S (substitute, UI-verified)
```

Every seeded identifier (project ids, rule ids, doc/demo names, the eval run id, the test run id) is
captured in the harness context and consumed by later scenarios by identity — and appended to the
isolation scan's needle list.

## 3. Scenarios (as executed)

| id | surface | journey (UI unless labelled) | oracle (content / identity / persistence) | kind |
|---|---|---|---|---|
| PRJ-1 | Projects | `rail-heading-projects` ＋ → `new-project-modal` → name `e2e-scope-<ts>-a` → Create | URL `/p/<id>/build`; `project-name` renders the name; `GET /projects/<id>` name matches | deterministic |
| PRJ-2 | Projects | same, `…-b` | same | deterministic |
| PRJ-3 | Projects | full reload of `/projects`; `/p/A/build` → `project-name` (switcher trigger, `data-locked=false`) → pick B | both `project-card[data-project-id]` render their names as `active`; switcher lists A and B; pivot lands on `/p/B/build` | deterministic |
| ATT-1 | Projects | `[SUBSTITUTE]` `POST /projects/A/members {kind:"crew.repo", ref, attachedBy:"api"}` (studio#207) | `GET /projects/A` lists exactly that member, `GET /projects/B` none; A's dashboard renders `dashboard-repo[data-repo-ref]`; B's renders no `dashboard-repos` | deterministic |
| STR-1 | Steering | on the **unseeded** store: `steering-add-menu` → `steering-add-open` → draft row | `steering-grid-draft` appears and the rule saves. **Expected gap (studio#212):** no draft row WHILE `steering-unseeded` shows; no draft row without the banner is a plain FAIL | deterministic, **xfail studio#212** |
| STR-1S | Steering | `[SUBSTITUTE]` `POST /governance/rules` (the exact `draftRule` body, PAT-100) — only when STR-1 did not pass | after reload the grid mounts with `steering-grid-row[data-rule-id=PAT-100]` | deterministic |
| STR-1B | Steering | Add ▾ → Add row → keep the prefilled `PAT-nnn` → statement → Save | draft detaches; `steering-cell-statement` equals the statement; `steering-saved-note` says `Saved <id>` | deterministic |
| STR-2 | Steering | full reload | statement/type/severity cells equal what was typed; server row `provenance.source: "ui"` | deterministic |
| STR-3 | Steering | `steering-grid-id` → drawer (`aria-label="Rule <id>"`) → `steering-edit-open` → `steering-form-severity`=error, statement rewritten → save | cells update; both values survive a full reload | deterministic |
| STR-4 | Steering | row Retire → modal: confirm disarmed until exact id AND reason → confirm | note echoes id + reason; row stays listed struck under the default facet (`includeRetired = true`), hidden under "retired hidden", same after a reload; `GET /governance/rules` → `retired:true` | deterministic |
| XPS-2 | Steering | reach `/steering/policies` from Project B's shell; retired facet ON | grid rule-id set == store rule-id set | deterministic |
| EVL-1 | Evals | `/testing/evals` → `testing-evals-run` | summary numbers; row count == total; `blocked+passed+gaps+fp == total`; exactly one `eval-history-row`; drilldown text carries the same numbers; `GET /testing/evals/:id` agrees. "Unsupported" is a skip only when `GET /testing/evals` → 501 | deterministic (engine replay) |
| EVL-2 | Evals | full reload → same `eval-history-row[data-run-id]` → drilldown | identical drilldown text | deterministic |
| MEM-2 | Memories | `/steering/memories` → settled → search → revisit after Project B | state and row count settled, error-free, context-independent. Retire never exercised (studio#206) | deterministic, read-only |
| VIB-1D / VIB-2D | Vibe | `/p/X` → `dashboard-mode-document` → (InstallGate continue, recorded) → `doc-composer` with a quoted name → submit | URL `/p/X/document/<name>`; `doc-canvas[data-doc-id]` frames it | deterministic seed |
| VIB-4 | Vibe | full reload at the doc URL | `doc-canvas[data-doc-id]`; A's `doc-picker-row` lists it; **versions wire → 200** with an int `head` inside a strictly increasing `versions` chain whose parents are consistent (v0 → null); the docs listing agrees on head and version count; the head's rendered `/doc` answers 200 | deterministic |
| VIB-3 | Vibe | compare `doc-picker-row[data-doc-id]` under `/p/A/document` and `/p/B/document` | plain: both pickers non-empty and each lists its own doc; **expected gap:** A ∌ B's doc and B ∌ A's doc | **xfail crew#472** |
| VIB-3F | Vibe | deep link `/p/B/document/<A's doc>` | **expected gap:** B's shell must not frame A's document (`doc-canvas[data-doc-id]`) | **xfail crew#472** |
| DEM-1D | Demo | `/p/A` → `dashboard-mode-video` → composer → `demo-wizard` → `wizard-target` (local fixture URL), one step → `wizard-create` | URL `/p/A/video/<name>`; `demo-picker-row[data-demo-id]` lists it | deterministic seed (wizard steps have no backend consumer — §6.11) |
| DEM-3 | Demo | A's picker vs B's picker | plain: A lists its own demo; **expected gap:** B ∌ A's demo | **xfail crew#472** |
| TST-1 | Tests | `/p/A` → `dashboard-campaigns` → `testing-campaign-open` → `testing-launch-panel[data-intent=campaign]` (project pre-bound, repo chip) → instructions → submit → waiting → the intake gate card (`steering-gate` inside the panel) → `steering-reject` | run found by its brief token; gate prompt non-empty while `awaiting_human`; `council*` events before the gate reported (crew#473); `testing-launch-resolved`; run ends `cancelled`; **event-log oracle** (`assert_execution_prevented`): a non-empty `units` array, every unit in `pending|distributed|rejected`, NO `unitDispatched`/`unitExecuting`/`unitOutputDelta`/`unitOutputCaptured`/`unitDone`/`acpSessionStarted` anywhere, `awaitingHuman` then `runCancelled`. A run failing before its gate is a skip only when the roster shows no signed-in seat | **governed** (the one and only), serialized |
| TST-S | Tests | `/p/A` vs `/p/B` dashboards | `dashboard-run[data-run-id]` on A, absent on B; the run's problem carries the brief | deterministic |
| TST-2 | Tests | `/p/A/campaigns` renders; `GET /campaigns` read | **BLOCKED** (explicit): a single-repo test registers no engine campaign (`campaignRegistered:false`), so the App.tsx:466 partition is unobservable without a ≥2-repo **fan** (crew#390 shape) = ≥2 governed runs, over budget. A campaign card appearing on a single-repo project FAILS (the premise no longer holds → implement the assertion). Context: studio#216 | blocked |
| CLN-1 | Vibe/Demo | picker `doc-delete-trigger` → `doc-delete-confirm` → `doc-delete-go`, per seeded doc/demo | absent after a full reload. **Expected gap (studio#213):** crew's own sentence that the pinned `wicked-interactive@^0.8.1` predates `DELETE /api/docs/:doc` (`doc-delete-error`); a partial delete or any other wire error is a plain FAIL; a bridge hint is a skip only when the daemon confirms `bridge_unavailable` | **xfail studio#213** |
| CLN-STR | Steering | retire the STR-1S seed (PAT-100) through the Retire modal | `data-retired=true`; server row `retired:true` | deterministic |
| CLN-2 | Projects | `/projects/:id` → ProjectDetailPage → Archive | **expected gap (studio#214):** `/projects/:id` stays and the Archive control exists; when it does, archive → server row `status=archived` (plain) | **xfail studio#214** |
| CLN-2S | Projects | `[SUBSTITUTE]` `PATCH /projects/:id {status:"archived"}` for whichever of A/B CLN-2 did not archive | `/projects`: no active card; the archived toggle reveals both with `data-status=archived` | deterministic |

## 4. Project-scoping observables (what the suite certifies today)

| Surface | Observable | Verdict |
|---|---|---|
| Projects | cards/switcher by id + name after reload; pivot retains mode, drops artifact | correct |
| Repositories on a project | `dashboard-repo[data-repo-ref]` on A only | correct (attach itself is API-only — studio#207) |
| Runs filed under a project | `dashboard-run[data-run-id]` on A only (client-side membership join) | correct |
| Documents / demos | pickers must be disjoint; a foreign deep link must not frame | **UNMET** — crew#472 → xfail (VIB-3, VIB-3F, DEM-3) |
| Tests (campaign store) | `/p/:id/campaigns` must be partitioned | **UNMET / BLOCKED** — App.tsx:466; not observable without a fan (TST-2) |
| Steering / Evals | global corpus and global history; identical from any project context | correct by design |
| Memories | browse is global; scopes/facets carry project semantics | read-only here |

## 4b. Coverage matrix (binding — no silent omissions)

For every surface: the deterministic journeys this suite covers, the governed journeys it defers (agents
spawn — run one at a time, never by the seed suite), and every explicit disposition with its issue.

| Surface | Deterministic — covered here | Governed — deferred | Explicit dispositions |
|---|---|---|---|
| **Projects** | create (PRJ-1/2), reload + switcher pivot (PRJ-3), repo tile scoping (ATT-1, attach = `[SUBSTITUTE]`), run scoping (TST-S), archive list + toggle (CLN-2S, archive = `[SUBSTITUTE]`) | — | **xfail studio#214** CLN-2 (UI archive). **BLOCKED studio#214**: restore and rename/describe — the only Edit / Archive-Restore controls live on `ProjectDetailPage`, which `useLegacyRedirect` makes unreachable (`PATCH /projects/:id` carries them on the wire). **BLOCKED studio#207**: attach a repository through the UI (no control). |
| **Steering (policies)** | author via draft row (STR-1B), reload content (STR-2), drawer edit + reload (STR-3), retire with typed id + reason, default facet, hide, reload (STR-4), global corpus from another project (XPS-2), retire the seed (CLN-STR) | STR-5 "Add with chat" (assist dock, `assist-input`/`assist-send`) | **xfail studio#212** STR-1 (first rule on an unseeded store). **Not yet automated — studio#217**: inline cell edit (`steering-cell-type`/`steering-cell-severity` selects), import via the assist-dock attachment (`importDirect` → `POST /governance/steering/import`, .md/.json). |
| **Memories** | browse settled + search + context independence (MEM-2, read-only) | MEM-1/MEM-3 (agent-produced memories and proposals) | **BLOCKED studio#206**: retire (scope-subtree erasure; no single-item delete on the wire). **Not yet automated — studio#217**: seed an exclusive scope with a substitute producer then retire it; proposal approve/reject (`proposal-approve`/`proposal-reject`) with a substitute `proposal.submit`. |
| **Testing → Evals** | run the built-in corpus, summary ⇄ rows ⇄ history ⇄ API (EVL-1), reload identity + content (EVL-2) | — (engine replay, no model) | **Not yet automated — studio#217**: corpus selection (`testing-evals-corpus`) → history row names the corpus. |
| **Testing → Tests** | the run is scoped to A (TST-S) | **TST-1** — the ONE governed scenario, executed: gate reached, rejected, event log proves no execution | **BLOCKED** TST-2 partition (App.tsx:466; needs a ≥2-repo fan = ≥2 governed runs; studio#216). Finding 10/crew#473: the distribution council runs BEFORE the intake gate. |
| **Vibe (documents)** | seed in A and B (VIB-1D/2D), reload identity + picker + versions head/lineage + docs listing + head html (VIB-4) | VIB-1 generation, VIB-5 revision (a drafting agent per `doc.created`) | **xfail crew#472** VIB-3 (disjoint pickers), VIB-3F (foreign deep link). **xfail studio#213** CLN-1 delete. **BLOCKED studio#213 + crew#472**: mutation isolation from a foreign context (edit/delete A's doc from B's shell) — studio#217 tracks the fixture. |
| **Demo (video)** | seed via the wizard (DEM-1D) | DEM-1 authored demo (`doc.created(kind:demo)` → authoring run) | **xfail crew#472** DEM-3. **xfail studio#213** CLN-1 (demo delete). **Not yet automated — studio#217**: recording (`video-record`, the bridge's Playwright needs `PLAYWRIGHT_BROWSERS_PATH` passed through under the hermetic HOME) and playback (`demo-player`). Finding 11: the wizard's `demo_steps` have no backend consumer. |
| **Chat** | — | CHT-1..4 (every chat warms the chat-capable roster seats) | deferred: no deterministic single-seat path exists. |
| **Build / runs** | — | EXE-1..4 (the full council per phase) | deferred: governed by definition. |

## 5. Governed scenarios (not executed by this suite)

Run one at a time, never alongside each other, never by the seed suite: **CHT-1..4** (chats), **VIB-1/VIB-5**
(document generation / revision), **DEM-1 (authored)** (the demo authoring run — the wizard's `demo_steps`
have no backend consumer, §6.11), **STR-5** ("Add with chat" in the assist dock), **MEM-1/MEM-3** (memory
producers), **EXE-1..4** (build runs). TST-1 is the one governed scenario that IS executed here.

## 6. Findings this suite surfaces

1. **STR-1 — "Add row" is inert on an unseeded store** (studio#212). `SteeringPage.tsx` mounts `SteeringGrid` only when `!unseeded`; the banner's "Add a row" path cannot author the first rule. Seeded over the wire (labelled), continued.
2. **CLN-2 — no reachable UI affordance archives/restores/renames a project** (studio#214). `ProjectDetailPage` is replaced by `useLegacyRedirect`. Archived over `PATCH /projects/:id` (labelled), verified through `/projects`.
3. **VIB-3 / VIB-3F / DEM-3 — crew#472** (xfail): documents and demos leak across projects — pickers and deep links (`proxy-routes.ts rootFor()` falls through to one shared root).
4. **TST-2 — App.tsx:466** (BLOCKED): the campaign store is not project-partitioned; unobservable without a fan (studio#216 context).
5. **Rig finding for crew — crew#476: the bridge pool spawns `wicked-interactive serve` without naming the daemon or its bus.** `bridge-pool.ts defaultSpawn` runs `npx wicked-interactive@^0.8.1 serve --root <root>` with the daemon's env and never exports `WICKED_CREW_API=<bound origin>` or the bus location; the bridge's project lookups dial `:7701` and its `doc.created` events land on the LIVE bus (revision-4 run 3 left three empty handoff dirs in the operator's `~/.wicked-crew`; removed, disclosed). The suite pins both itself; the pool should.
6. **The Rust spools default to the operator's home.** wicked-estate's dead-letter (`~/.something-wicked/wicked-estate/emit-deadletter.ndjson`, `WICKED_ESTATE_EMIT_DEADLETTER`) and wicked-apps-core's outbox (`~/.something-wicked/wicked-apps/emit-outbox.ndjson`, `WICKED_APPS_EMIT_DEADLETTER`) resolve from `HOME`. Revision 4 recorded appends there; revision 5 pins both env overrides AND the scratch HOME, and the byte-scan proves the operator's spools gained none of this run's identifiers.
7. **Repo hygiene: `.codegraph/estate.db` (4 MB SQLite) is tracked in wicked-studio.** A fresh clone carries the main checkout's graph and onboarding's `wicked-estate index` refuses it ("REPO COLLISION"). The suite deletes it from its temp clone; the repo should gitignore it (separate PR).
8. **CLN-1 — the studio's Delete targets an unpublished bridge route** (studio#213). `DELETE …/interactive/docs/:doc` → the pinned `wicked-interactive@^0.8.1` has no `DELETE /api/docs/:doc`; crew answers with its "predates" sentence. Release-parity gap (interactive 0.9.0 not cut).
9. **The intake gate does not precede the distribution council** (crew#473). `RECON_INTAKE_GATE_TOKEN = 'before:1'` parks execution of unit 1; the planning council (every roster seat) runs first. The engine DEGRADES a no-vote council (`distribute.rs`: `degrade(no_vote_reason)`) rather than failing, so the gate is reached even when no seat has credentials — which is the hermetic-HOME case: the roster reports every seat unsigned (`WICKED_WORKER_HOME` isolates only the claude seat's sign-in heuristic; codex/pi/copilot/opencode resolve from `HOME`). Run 6 recorded what the credential-less council produced: 4 `councilConvened`, **36 `councilSeatFailed`** (codex "no auth", pi "No API key found", copilot "No authentication information found", opencode), 5 `councilDeliberated`, 4 `councilVoted` — with **exactly one vote per round: the `claude` seat, whose OAuth credential lives in the macOS Keychain and therefore survives a scratch `HOME`** (agreement 20 % of the 75 % needed → degraded routing). A hermetic HOME does not stop a keychain-backed seat from convening with the operator's real credentials; `CLAUDE_CONFIG_DIR`/worker-home isolation is not credential isolation on macOS.
10. **The demo wizard's steps have no backend consumer.** The demo create emits `doc.created(kind:demo)` unconditionally; `demo_steps` have zero readers in interactive + crew — the step form is decorative. To file on studio/interactive.
11. **HOME-WRITES (named finding, re-derived per run).** With `HOME` pointed at the scratch dir, the daemon and its children still write under `$HOME` — the writes that would have landed in the operator's home without the scratch, none pinnable by a `WICKED_*` knob today. Run 5 (no CLI seat convened) caught the daemon's own: `~/.wicked-estate/repo-graphs/<repo>/estate.db` (wicked-core `code_graph.rs repo_graph_root` — **now pinned** via `WICKED_ESTATE_REPO_GRAPH_ROOT`) and the bridge's `~/.wicked-interactive/instances.json` (interactive `instances.mjs REGISTRY` — `homedir()` only, no override). Run 6 added the CLI seats' state the moment the council convened: `~/.codex/.tmp/plugins/**` (codex cloned its plugin marketplace repo — 391 files), `~/.claude/projects/<cwd>/<session>.jsonl` (one transcript per seat invocation, 5), `~/.claude.json` + a backup, `~/.cache/opencode/models.json`, `~/.codex/.sandbox_migration`. The report carries the list (`setup.teardown.scratch_home_writes`, capped at 400) and per-directory counts (`scratch_home_writes_by_dir`); the scratch `TMPDIR` additionally received node's compile cache (401 entries, expected).
12. **Bridge 404 classification.** crew's "predates DELETE" answer arrives as a plain `ApiError` (`kind: 'wire'` → `doc-delete-error`), not as `BridgeUnavailableError` (`doc-delete-bridge-hint`) — the suite scopes the studio#213 expected gap to the wire sentence, so a genuinely unavailable bridge is never mistaken for the known gap.

13. **Launch panel: a transient "no project" + zero-repo hint on open** (UX, not filed). `TestingLaunchPanel` seeds `projectId` from `initialProjectId` at mount (`TestingLaunchPanel.tsx:149`) but the `<select>`'s options come from an async `listProjects()`; until it resolves, the controlled select shows "no project" (its DOM value reads `""`) and the "This project holds no repositories" hint flashes (`projectRepos` starts `[]` before the members effect sets `'loading'`). Run 5 of this suite read the select at that instant and failed TST-1 before launching; the harness now waits for the bound value. The flash is a small misleading state the panel could avoid by rendering the bound project as a placeholder option until the list arrives.

## 7. Executed — revision 5, against fresh disposable daemons (`SEED_GOVERNED=1`)

Two executions on the same machine as the live `:7701` daemon. **Run 5** found a harness race (TST-1 read the
launch panel's project `<select>` before its options loaded — finding 13) and failed TST-1 BEFORE launching,
so no governed run was spent; every other row and the whole isolation proof behaved as designed
(`live_touched: []`, :7701 46 → 46, group stop clean, bridge identified + terminated). **Run 6**, after the
one-line wait fix and pinning `WICKED_ESTATE_REPO_GRAPH_ROOT`, is the certified execution.

### 7.1 Run 6 — `SEED_GOVERNED=1 python3 e2e/seed_surfaces_test.py` (certified; exit 0, `report.ok = true`)

- crew `0.7.25` · **studioBundle `0.5.1` = this repo's `package.json` (enforced)** · core-ts `0.7.16` · wicked-core `0.4.0` · wicked-estate `0.15.1` · bridge `wicked-interactive@^0.8.1` (cache key `f3c1d902516e713e`, seeded in 11.1 s) · Playwright `1.58.0` · chromium `145.0.7632.6` · node `v26.0.0`
- served build pinned: `index.html` sha256 `83c979daf589f3f5…`, `/assets/index-C4iz4uAw.js` `c094c56a436e97f0…`, `/assets/index-DEEQcRQ_.css` `7d35701e60485cd5…`
- environment: 23 keys, built from scratch — pass-through `PATH`, `LANG`, `USER`, `LOGNAME`; scratch `HOME`/`TMPDIR`; `WICKED_{HOME,WORKER_HOME,CREW_SYSTEM_SETTINGS,WORKFLOWS_DIR,STEERING_INBOX_DIR,INTERACTIVE_ROOT,CREW_API,BUS_DATA_DIR,ESTATE_EMIT_DEADLETTER,APPS_EMIT_DEADLETTER,ESTATE_REPO_GRAPH_ROOT,MEMORY_EMBEDDER}`, `npm_config_cache`, `npm_config_update_notifier`, `NO_UPDATE_NOTIFIER`; `setup.write_targets.ok = true` (every target resolved outside `~` and `~/.wicked-crew`)
- roster under the hermetic HOME: `claude/codex/pi/copilot/opencode` all `signed_in: false`; onboarding of the registered clone `completed`
- teardown: daemon pid 15599 — group SIGTERM, `forced: false`, exit 0, `group_empty: true`; bridge — lock ok, pid 16230 valid, **1 process identified by command line** (`node …/npm-cache/_npx/f3c1d902516e713e/node_modules/.bin/wicked-interactive serve --root <tmp>/idocs`, pgid 16162 = the detached npx wrapper), lock pid matches the identified set, SIGTERM sufficed (`forced: []`, `remaining: []`); no live runs left to cancel; temp dir removed
- isolation proof: 4 operator files modified during the run (`~/.wicked-crew/{daemon-stdout.log,core.db-wal,core.db.mem-wal,core.db.knowledge-wal}` — the live daemon's own housekeeping), **0 identifier hits**, **0 stamped entries**, live `:7701` reachable before/after with **46 → 46 runs, no new ids** → `live_touched: []`
- HOME-WRITES (finding 11): 401 listed (cap) — `.codex/.tmp` 391, `.claude/projects` 5, `.claude.json` + `.claude/backups` 2, `.cache/opencode` 1, `.codex/.sandbox_migration` 1; TMPDIR 401 (node compile cache)
- counts: `{'pass': 21, 'fail': 0, 'xfail': 6, 'xpass': 0, 'skip': 0, 'blocked': 1}` — scenario time 99.3 s (TST-1 86.8 s); console: one `502` resource error (the delete CLN-1 exercises)

| id | scenario | status | s | detail (first line) |
|---|---|---|---|---|
| PRJ-1 | Create Project A via the rail ＋ → modal → Create | **PASS** | 0.4 | Project A = proj_178893474847100000 (e2e-scope-1788934725-a); landed on /p/proj_178893474847100000/build with the shell header naming it |
| PRJ-2 | Create Project B (the scoping control) the same way | **PASS** | 0.1 | Project B = proj_178893474857100001 (e2e-scope-1788934725-b) |
| PRJ-3 | Reload persistence + ProjectShell switcher identity | **PASS** | 0.1 | after a full reload both cards render their names as active; the ProjectShell switcher lists A and B and pivoting to B retains the mode verb and drops the artifact |
| ATT-1 | Attach the repository to Project A (API substitute, UI-verified) | **PASS** | 0.9 | [SUBSTITUTE] repo seed-surfaces-1788934725 attached to A over POST /projects/proj_178893474847100000/members (no UI attach control until studio#207); UI verifies: A's dashboard renders the repo tile, B's renders none |
| STR-1 | Author the FIRST rule via Add row on the unseeded store | **XFAIL** | 5.1 | expected failure (studio#212): 'Add row' produced no draft row while the UNSEEDED banner is showing — SteeringPage mounts the grid only when rules exist |
| STR-1S | Seed the store so the grid mounts (API substitute, only if STR-1 failed) | **PASS** | 0.0 | [SUBSTITUTE] PAT-100 seeded over POST /governance/rules (the exact body the draft row sends) so the grid mounts |
| STR-1B | Author a rule via Add row on a seeded store | **PASS** | 0.1 | PAT-101 authored through the draft row (prefilled id kept; statement set; saved note names it) |
| STR-2 | Reload persistence of the authored rule (content) | **PASS** | 0.1 | PAT-101 survives a full reload with statement/type/severity intact; server row carries provenance.source=ui |
| STR-3 | Edit via the drawer (steering-grid-id → Edit…) and reload | **PASS** | 0.2 | PAT-101 edited through the drawer's Edit form (severity warn→error, statement rewritten); both persist across a reload |
| STR-4 | Retire with exact id + reason; listed-struck by default; hideable; reload | **PASS** | 0.2 | PAT-101 retired with typed id + reason; the note echoes both; the row stays listed struck under the default 'retired shown' facet (before and after a reload) and leaves under 'retired hidden'; server row retired=true |
| XPS-2 | Steering is global — grid ids == store ids from another project's context | **PASS** | 0.1 | the grid renders exactly the store's 2 rule ids regardless of the project context it was reached from |
| EVL-1 | Run evals; report ⇄ history drilldown ⇄ API agree | **PASS** | 0.1 | eval run 53d76b674c614874a2e0bec8a9a928d4: 27 samples · 11 caught · 16 gaps · 0 fp — report, result rows, history drilldown and GET /testing/evals/:id all agree |
| EVL-2 | Eval history + drilldown persist across reload (identity + content) | **PASS** | 0.1 | after a full reload the history still holds exactly 53d76b674c614874a2e0bec8a9a928d4 and its drilldown text is byte-identical |
| MEM-2 | Memories browse is read-only, settled, and context-independent | **PASS** | 0.6 | panel state 'memories-empty' (0 rows) on the isolated store; search round-trips to 'memories-empty' (0); identical when reached after Project B |
| VIB-1D | Seed a document in Project A via the composer (deterministic) | **PASS** | 0.2 | doc 'seed-doc-a-1788934725' created under A through the composer (placeholder v0 — drafting agent disabled on this daemon); canvas frames it |
| VIB-2D | Seed a document in Project B via the composer (deterministic) | **PASS** | 0.2 | doc 'seed-doc-b-1788934725' created under B |
| VIB-4 | Document survives a reload (canvas identity + picker listing + versions head/lineage) | **PASS** | 0.1 | canvas frames 'seed-doc-a-1788934725' and A's picker lists it; versions wire → 200 head=0 lineage=[0] (parents consistent); docs listing agrees (head, 1 versions); head html renders (200) |
| VIB-3 | Documents are disjoint per project (A ∌ B's doc, B ∌ A's doc) | **XFAIL** | 0.1 | expected failure (crew#472): Project A's picker lists B's document 'seed-doc-b-1788934725': ['seed-doc-b-1788934725', 'seed-doc-a-1788934725'] |
| VIB-3F | Foreign deep link: /p/B/document/<A's doc> must not frame A's document | **XFAIL** | 0.1 | expected failure (crew#472): Project B's shell frames A's document 'seed-doc-a-1788934725' through a deep link |
| DEM-1D | Seed a demo in Project A via the wizard (deterministic) | **PASS** | 0.4 | demo 'seed-demo-a-1788934725' created under A via the wizard (local fixture target, one hand-pinned step; authoring agent disabled); A's picker lists it |
| DEM-3 | Demos are disjoint per project (B ∌ A's demo) | **XFAIL** | 0.1 | expected failure (crew#472): Project B's demo picker lists A's demo 'seed-demo-a-1788934725' |
| TST-1 | New test from Project A → intake gate arrives → REJECT (event log proves no execution) | **PASS** | 86.8 | run 55a5d7fb-0db1-4f20-b07b-b42d989b26b9 launched from A (project pre-bound, repo chip via project), parked at its intake gate after the distribution council ({'councilConvened': 4, 'councilSeatFailed': 36, 'councilDeliberated': 5, 'councilVoted': 4}), REJECTED in the panel → cancelled; event log proves no execution: 4 planned units ['distributed' ×4], 60 events, none of [acpSessionStarted, unitDispatched, unitDone, unitExecuting, unitOutputCaptured, unitOutputDelta], awaitingHuman@58 → runCancelled@59; prompt 'Approve unit 1 before it runs: New test: plan the test for the attached scope…' |
| TST-S | The test run is scoped: on A's dashboard, absent from B's | **PASS** | 0.7 | A's dashboard lists run 55a5d7fb… (membership join, problem carries the brief); B's does not |
| TST-2 | Tests list is partitioned per project | **BLOCKED** | 0.6 | the campaign store partition (App.tsx:466) is not observable on this rig: a single-repo test registers no engine campaign (GET /campaigns → 0, A renders 0 cards); needs a ≥2-repo fan = ≥2 governed runs, over budget; studio#216 |
| CLN-1 | Delete every seeded document/demo through the UI | **XFAIL** | 0.6 | expected failure (studio#213): the pinned bridge predates DELETE /api/docs/:doc — "the daemon refused this — wicked-interactive answered 404 without the retire wire's body" |
| CLN-STR | Retire the substitute seed rule through the UI | **PASS** | 0.1 | PAT-100 (the STR-1S substitute) retired through the grid's Retire modal; server row retired=true |
| CLN-2 | Archive a project through the UI (ProjectDetailPage → Archive) | **XFAIL** | 0.6 | expected failure (studio#214): ProjectDetailPage is unreachable: /projects/proj_1788934748… redirected to /p/… (useLegacyRedirect) |
| CLN-2S | Archive both projects (API substitute, UI-verified) | **PASS** | 0.6 | [SUBSTITUTE] both projects archived over PATCH /projects/:id; UI verifies: no active card, both listed under the archived toggle |

### 7.2 Run 5 — the same command, before the TST-1 wait fix (exit 1; `report.ok = false` because TST-1 failed)

Identical rows to run 6 except `TST-1 FAIL 0.6 s — assertion: the project selector is not pre-bound to A`
(finding 13; the panel's `<select>` read `""` while its options were still loading) and therefore
`TST-S SKIP — no test run was launched`. No governed run was launched, so the budget was not spent. The
isolation proof was equally clean: 5 operator files modified (the live daemon's), 0 identifier hits, 0
stamped entries, :7701 46 → 46; daemon group stop `forced: false`; bridge identified (pid 5287, lock match)
and terminated. Its HOME-WRITES list — with no CLI seat ever convened — is what pins finding 11's
daemon/bridge half: `.wicked-estate/repo-graphs/repo-0bbd38cd2f73/estate.db`, `.wicked-interactive/instances.json`,
plus the node compile cache under TMPDIR.

### 7.3 Verdict summary

| outcome | rows | meaning |
|---|---|---|
| pass | 21 | journeys certified through the UI with content/identity/persistence oracles; `[SUBSTITUTE]` rows are API steps then UI-verified; TST-1's gate rejection is proven from the run's event log |
| xfail | STR-1 (studio#212), VIB-3 / VIB-3F / DEM-3 (crew#472), CLN-1 (studio#213), CLN-2 (studio#214) | the ONE assertion each issue excuses failed; every other assertion in those scenarios held |
| blocked | TST-2 | explicit: needs a ≥2-repo fan (≥2 governed runs), over the one-governed-scenario budget |
| fail / xpass / skip | 0 / 0 / 0 | no unrelated regression, no stale marker, no unexplained skip |
| `live_touched` | `[]` | the operator's stores and the live :7701 daemon carry none of this run's identifiers |

## 8. Codex REQUIRED CHANGES → what changed (revision 4 → 5)

| # | Finding (codex, revision 4) | Fix in revision 5 |
|---|---|---|
| 1 | daemon inherits the operator's env/HOME | `Rig.build_env` — minimal env from scratch (PATH/LANG/USER pass-through only), scratch HOME/TMPDIR, every store + spool pinned, npm cache cloned; `assert_write_targets` before start; `HOME-WRITES` finding lists the remaining writes |
| 2 | `report.ok=false` exited 0 | `finalize` + `exit_code(report)` — the exit code reads `report.ok` only (suite ok AND `live_touched` empty AND no setup failure/abort); `--self-test` proves `ok=false ⇒ exit≠0` |
| 3 | teardown trusted `.wi-serve.json` pid | `bridge_processes` identifies by command line + start time; `read_bridge_lock` refuses symlinks; `valid_pid` (positive int > 1); lock pid cross-checked, unmatched pids never signalled; the daemon is a process group we own (`stop_process_group`) |
| 4 | Chromium outside the daemon's `finally`; cancels unverified; no wait after kill | one `try/finally` in `main`; `cancel_live_runs` verifies each response and polls terminal; SIGTERM → poll → SIGKILL → poll for the group and the bridge; SIGTERM handler → `KeyboardInterrupt` → teardown |
| 5 | every assertion in an xfail scenario became xfail; broad regex skips | `ExpectedGap`/`expect_gap` — one assertion per issue; plain asserts fail; `disjoint_pickers_oracle` requires ownership + non-empty lists; skips only on established causes (roster all-unsigned, daemon `bridge_unavailable`, 501) |
| 6 | gate oracle read only final statuses (and `running/completed`, which are not even unit states) | `assert_execution_prevented` — non-empty units, states ⊆ `pending|distributed|rejected` (wicked-core `UnitStatus`), zero execution events in the log, `awaitingHuman` → `runCancelled` ordering |
| 7 | TST-2 silently skipped | explicit `blocked` verdict with the reason (needs a ≥2-repo fan → ≥2 governed runs) and issue; a card on a single-repo project FAILS |
| 8 | VIB-4 printed the versions response | 200 required; int `head` inside a consistent lineage; docs listing agrees; head html renders |
| 9 | blocking `readline()` could hang past the deadline | reader thread + queue; the main thread waits with the remaining deadline; EOF handled |
| 10 | build identity observed, not enforced | served `studioBundle` must equal `package.json` or setup fails; index + assets SHA-256'd into the report |
| 11 | plan omitted binding coverage | §4b matrix: covered / deferred / BLOCKED-with-issue per surface; studio#217 filed for the not-yet-automated deterministic journeys |
