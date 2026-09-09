# Live Test-feature run against wicked-studio on the dogfood daemon — 2026-09-09

**What this is.** The Test feature (the interactive / gated testing approach — "Run recon" and
"New test" on `/testing/campaigns`) exercised LIVE, as a user would, through the studio UI on the
operator's dogfood daemon, against wicked-studio itself. Not a dry run and not a pinned target: real
governed runs, real councils, the intake gate approved on the real SteeringGate card, then an honest
look at what the feature produced. Harness: [`e2e/test_feature_live.py`](../../e2e/test_feature_live.py);
raw measurements: [`e2e/artifacts/test-feature-live/report.json`](../../e2e/artifacts/test-feature-live/report.json);
captured plans: `e2e/artifacts/test-feature-live/LT-{1,2,3}-plan-<run>.md`. Screenshots live beside
them (gitignored PNGs — regenerate with the harness).

| Component | Version |
|---|---|
| wicked-crew daemon (`:7701`) | 0.7.25 (studioBundle 0.5.1, coreTs 0.7.16, wicked-core 0.4.0, wicked-estate 0.15.1) |
| target repo | `wicked-studio` @ `main` `b30000f` (registered on the daemon as repo id `wicked-studio`) |
| council roster | claude, codex, pi, copilot, opencode |
| browser | Playwright chromium 145 headless, extension-free, 1440×900 |

**Rules the harness held itself to.** One governed run in flight at a time; a serialization
preflight before every launch (zero executing/awaiting runs on `:7701`, 1-minute load < 20, swap
used < 95 % — free-memory was recorded but not gated on, see "Preflight history"); the gate decision
through the UI card only (never the API); no deliver gate approved (none arrived); no repo/project
writes; read-only GETs for every assertion; a wedge (no events for 10 min) would have been reported,
not killed (none occurred).

**The one-sentence brief** (identical for all three launches — core#393 splits on `.`/`;`/newline,
so it contains none):

> Survey wicked-studio at its current main and propose a test plan covering its live /ws CoreEvent
> fold (awaitingHuman, unitPlanned, sessionCompleted frames), the /api/v1 routes it calls (runs,
> campaigns, testing/recon, projects, repos), its CLI entry points, and its UI pages
> (/testing/campaigns, /runs/:id, /steering, the home deck), naming the real source files behind
> each scenario and classifying each as a deterministic tool check or a governed agent run

## Results

| Scenario | Result | Units planned | Gate prompt | Launch→gate | Approve→terminal | Siblings launched | Campaign registered | Verdicts | Plan names real files / classifies |
|---|---|---|---|---|---|---|---|---|---|
| LT-1 Run recon | **ran to completion; feature contract not met** | **3** (intent 1) | pre-execution: "Approve unit 1 before it runs: Recon: survey the target…" (180 chars, no plan) | 80 s | 564 s (total 651 s) | **0** | **no** (label `recon-mttmyh2a-c635a60c` dangling) | none (`acceptance.required=false`) | yes — 25 real files (9 paths + 16 basenames) / yes |
| LT-2 New test | **ran to completion; feature contract not met** | **3** (intent 1) | pre-execution: "Approve unit 1 before it runs: New test: plan the test…" (246 chars, no plan) | 67 s | 190 s (total 260 s) | **0** | **no** (`recon-mttnf3s6-99e928c5` dangling) | none | yes — 14 real files / yes (`[TOOL]`/`[AGENT]` tags) |
| LT-3 Run recon again (identical brief) | **ran to completion** | **3** | pre-execution, same shape as LT-1 | 70 s | 210 s (total 287 s) | **0** | **no** (`recon-mttnnicz-82c6bb65`) | none | yes — 32 real files / yes |
| LT-3 consistency vs LT-1 | **low** | — | — | — | — | — | — | — | files overlap **32.6 %** (14 common / 43 union); scenario-id overlap **0 %** (neither plan numbers scenarios stably — LT-1 only carries RAID ids R-01/R-02); scenario-title overlap **25 %** |
| LT-4 surfaces coverage | **pass (breadth)** | — | — | — | — | — | — | — | all three plans propose tests for all four asked surfaces (WS events, /api/v1 routes, CLI, UI pages); no gap — see quality caveats below |
| LT-5 operator's view | **observed — stale and misleading** | — | — | — | — | — | — | — | Tests landing identical before/after every run; the finished run is nowhere on the page that launched it; scoreboard for the returned label says "No campaign is filed" (+ console 404); "All campaigns" rename leftover |

"Ran to completion" is the honest status: each governed run reached `completed` with 3/3 units done,
no wedge, no extra gate, no deliver. Whether the *feature* did its job is the findings section.

### Every run had the same event shape

```
sessionStarted → unitPlanned ×3 → councilConvened/Deliberated/Voted (unit 1) → unitDistributed
→ awaitingHuman (ord 1, "Approve unit 1 before it runs: <first prefix sentence>")   ← the ONLY human gate
→ [approve on the SteeringGate card → POST /runs/:id/gate {"approve":true} → 200] → resumed
→ unit 1 executes (claude, stage test) → unitOutputCaptured → gateEvaluated/gateDecided (auto) → unitDone
→ unit 2 council → executes (pi, stage build) → governanceUnenforced → unitDone
→ unit 3 council → executes (claude, stage test) → unitDone → sessionCompleted
```

The `awaitingHuman` frame arrived on the app's `/ws` fold and rendered the card **inside the launch
panel** in all three runs (`gate_on_panel_card: true`, one `awaitingHuman` WS frame each); after
approval the panel showed its "Intake gate answered — the campaign's progress lands on Campaigns"
copy. That copy turned out to be false (below).

## What the "plan" actually is

The operator never sees a plan at a gate. The deliverable is three unit outputs, readable only as raw
run output (`GET /runs/:id/units/:ord/output`, or the run page's thread). Because `plan_units`
splits the problem on sentence boundaries (core#393), the UI's two-sentence prefix and the
operator's one sentence became **three units with three different workers doing three different
things**:

| Unit | Text it received | Seat | What it did — LT-1 (recon) | LT-2 (new test) | LT-3 (recon, identical brief) |
|---|---|---|---|---|---|
| 1 | prefix sentence 1 only ("Recon: survey the target and propose a test plan…") — **without the operator's brief** | claude | surveyed the **wrong target**: an 11-row plan about the Home command-deck, nav rename, KPI band (the repo's recent ship wave), not the surfaces asked | "I don't see an actual scope attached to this message … Could you point me to the actual scope?" | as LT-1: a plan about the recent ship wave |
| 2 | prefix sentence 2 only ("Present the (proposed) plan at the intake gate and launch nothing until it is approved") — stage classified as **`build`** | **pi** — `governanceUnenforced`: "not admitted to input governance (acp_input_governance=false); its tool calls are answered by allow_result, unchecked" | **executed** unit 1's plan: ran `npm run typecheck`, `npm run lint` and the full **`npm test` (237 files / 2442 tests)** plus live curl probes of `:7701`, then wrote an "Execution verdict" — inside a run whose copy says nothing runs until approved | "Intake gate: BLOCKED — no testable scope determinable … I am launching nothing and holding at the gate" | audited `tests/` and `TEST-001` (read-only), no suite run |
| 3 | the operator's sentence | claude | an on-target 17-row plan: WS fold (`useEventStream.ts`, `store/gates.ts:137/159`, `store/runtime.ts:58/91/99`, `narrator.ts`), REST routes per API module, CLI = npm scripts + `scripts/*.mjs` (no `bin`), UI pages per route; classifies Deterministic / Live read-only smoke / Operator-run e2e / Governed agent run; flags two unit-test gaps | an on-target 4-group plan (`[TOOL]`/`[AGENT]`), ends "**Holding at the gate — launching nothing until you approve.** Want me to run the `[TOOL]` checks now and launch a single governed sibling run…?" — a question with no gate to land on; the session completed | on-target plan, 32 real files |

Unit 3's outputs are genuinely good recon (real files with line numbers, correct observation that
studio ships no `bin` and that `/runs/:id` has no dedicated page, both mirrors of
`wicked-crew-api-types` flagged for drift). Units 1 and 2 are cost and noise created by the split —
and unit 2 is where the governance story breaks.

## LT-4 — surfaces asked vs proposed

| Surface asked | LT-1 unit 3 | LT-2 unit 3 | LT-3 unit 3 |
|---|---|---|---|
| WS events (`/ws` CoreEvent fold: awaitingHuman, unitPlanned, sessionCompleted) | rows 1–4, 15–17: `useEventStream.ts` reconnect/backoff, `gates.ts` open/prune, `runtime.ts`, `narrator.ts`, live frame-type diff vs the `CoreEvent` union | group 1 (1.1–1.5): `App.tsx` `LIFECYCLE_EVENTS`, nine stores, live-wire proof | same files as LT-1 plus `store/{events,campaigns,annotations,…}.ts` |
| `/api/v1` routes (runs, campaigns, testing/recon, projects, repos) | rows 5–10: per module (`client.ts`, `campaigns.ts`, `testing.ts`, `steering.ts`), 404-tolerant probe, legacy redirects | group 2: mirror-drift diff, mocked-fetch coverage, live probe | as LT-1 |
| CLI entry points | "No CLI bin" — npm scripts + `scripts/*.mjs`; `e2e/studio_standalone_test.py` as the operator-run gate | group 3: each `package.json` script, the standalone e2e, staleness audit of ~57 slice scripts | as LT-2 |
| UI pages (`/testing/campaigns`, `/runs/:id`, `/steering`, home deck) | rows 11–14 + 16: `CampaignsPage`, `CampaignScoreboard`, `TestingLaunchPanel`, project-shell run rendering, `SteeringPage/Grid/UsageBand`, `HomeBoard/HomeCommand` | group 4: route-level tests + cross-page live walkthrough | as LT-1 |

Breadth is complete in every plan. The quality caveats are (a) the on-target plan is one third of the
output and is buried after an off-target plan and an execution transcript; (b) numbering and
classification vocabulary differ run to run (`Deterministic`/`Live read-only smoke`/`Operator-run
e2e`/`Governed agent run` vs `[TOOL]`/`[AGENT]`), so two plans for the same brief are not
diffable — LT-3's 32.6 % file overlap and 0 % id overlap.

## LT-5 — the operator's view

Screenshots (regenerable): `LT-{1,2,3}-01-landing-before`, `02-panel-filled`, `03-gate-card`,
`04-after-approve`, `06-run-page`, `07-landing-after`, `08-scoreboard`.

- **Gate card** (`03-gate-card`): renders inline in the "Run recon"/"New test" panel with "Awaiting
  human decision · run d293f4d7 · before unit #1" and the prompt "Approve unit 1 before it runs:
  Recon: survey the target and propose a test plan…". Four buttons; a "Run awaiting human" toast
  bottom-right; the rail gains a "Run recon" sub-item under Test. Works as designed — but what it
  asks the operator to approve is the survey, not a plan.
- **Tests landing after each run** (`07-landing-after`) is pixel-identical to before: PERFORMANCE
  "TESTS 1 · TEST RUNS 2", PIPELINE "0 running · 0 needs you", RISK "PASS RATE 0 % — 0 landed of 2
  finished". Every one of those numbers comes from the **Sept-8 cancelled fan**
  `recon-mttdwnhf-e3e3c5f4` (both nodes `cancelled`, campaign status `partially_completed`), whose
  card is titled "Recon: survey the target and propose a test plan…" — the same title the three new
  runs carry. The three runs launched *from this page* never appear on it: they are single-repo
  recons, which crew files on the per-run path without registering a campaign, and the landing
  lists campaigns (`GET /campaigns` returned that one stale campaign and `groups: []` throughout).
- **Scoreboard** (`08-scoreboard`): the launch answer carried `campaign: recon-mttmyh2a-c635a60c`
  (with `campaignRegistered: false`, which the panel ignores); the panel's resolved copy points the
  operator at "Campaigns"; `/testing/campaigns/recon-mttmyh2a-c635a60c` renders "No campaign is
  filed under **recon-mttmyh2a-c635a60c** on this daemon — a campaign appears with its first run, so
  this label either never launched one or lives on another daemon." with an "**All campaigns**"
  link (rename leftover — the section is "Test"), and the browser console logs the 404 for
  `GET /campaigns/<label>`. Same for all three labels.
- **Run page** (`06-run-page`): "Recon · d293f4 · #1 · Completed", phase strip **test › build ›
  test** (the middle unit — "Present the proposed plan…" — was classified as a `build` stage),
  "3 of 3 phases done", "took 10m 38s", intent = the full concatenated problem, roster of five
  CLIs, the plan readable only as the thread's output bubbles. "This run is finished — steering is
  closed." No control offers to execute the plan.
- `created_at` was populated on all three runs (1788930376 / 1788931152 / 1788931545) — the
  `created_at: null` seen on the Sept-8 fan's `recon-…:wicked-studio:a0` runs did not reproduce on
  the per-run path.

## Findings

| # | Finding | Evidence | Issue |
|---|---|---|---|
| F1 | **The approved plan is never executed.** After approving "Run recon" (×2) and "New test" (×1), zero sibling runs and zero campaigns appeared, immediately and after a 120 s grace. `GET /runs` grew by exactly the one launched run each time. The feature's own copy ("sibling runs land the work", "run the approved plan as governed sibling runs under one test") has no engine counterpart. | `report.json` → `siblings_after_grace` for LT-1/2/3; crew `packages/crew/src/api/testing.ts` has no plan→launch consumer | crew#473 (extended with this evidence) |
| F2 | **The only human gate is pre-execution.** Prompt: "Approve unit 1 before it runs: …" (180/246 chars; no plan content — the plan does not exist yet). After the plan is produced the units self-pass (`gateDecided` auto) and the session completes. LT-2's unit 3 literally ends "Holding at the gate — launching nothing until you approve. Want me to…?" with no gate to hold at. | `gate.pre_execution: true`, `contains_plan: false` ×3; LT-2 plan unit 3 | crew#473 |
| F3 | **The UI's prefix fans every launch into 3 units.** Two prefix sentences + the one-sentence brief → `unitPlanned` ×3 → three councils per launch (LT-1 total 10m 51s). Product intent is 1. | `units_planned: 3` ×3 with the split texts | core#393 (extended with the measured count) |
| F4 | **The split detaches the operator's brief from the "recon" instruction.** Unit 1 receives only "Recon: survey the target and propose a test plan…" and surveys whatever it finds interesting (LT-1/LT-3: the Home deck) or asks for a scope (LT-2). Only unit 3 works on the brief. | LT-1/2/3 plan files, unit 1 | core#393 (consequence) |
| F5 | **A "launch nothing" recon ran the full test suite, unchecked.** Unit 2 ("Present the plan at the intake gate and launch nothing until it is approved", stage `build`) was routed to the `pi` seat, which the engine itself reports as `governanceUnenforced` ("not admitted to input governance (acp_input_governance=false); its tool calls are answered by allow_result, unchecked"). In LT-1 it ran `npm run lint`, `npm run typecheck` and `npm test` (2442 tests, 69 s) on a memory-constrained host and wrote an "Execution verdict". | LT-1 plan unit 2; `governanceUnenforced` event seq 960 on d293f4d7 | crew#477 (filed) |
| F6 | **Dangling campaign label.** Single-repo launches answer `campaign: recon-…` + `campaignRegistered: false`; the panel ignores the flag, its resolved copy sends the operator to "Campaigns", and the scoreboard for that label 404s ("No campaign is filed under …"). | `launch_answer`, `scoreboard.notfound: true` ×3, console 404 ×3 | studio#216 (filed) |
| F7 | **The Test landing does not reflect the runs launched from it.** Single-repo recon runs are not campaigns, so the landing (which lists `GET /campaigns`) never shows them; its KPIs stayed frozen on a stale Sept-8 cancelled fan (`partially_completed` with both nodes `cancelled`, "0 landed of 2 finished", "PASS RATE 0 %") through all three runs. | `landing_before` == `landing_after` ×3; `GET /campaigns` | studio#216 (filed) |
| F8 | **Rename leftovers.** "All campaigns" link on the campaign-not-found view; the resolved copy's "Campaigns"; the not-found copy says "campaign" twice; the phase strip labels the middle unit `build`. | `08-scoreboard`, `TestingLaunchPanel.tsx` resolved copy | studio#216 (filed) |
| F9 | **Two plans for the same brief do not agree.** LT-1 vs LT-3 (identical body): 32.6 % file overlap, 0 % scenario-id overlap, 25 % title overlap; classification vocabularies differ. The feature has no stable plan schema to compare, approve, or execute against. | `consistency_vs_LT-1` | crew#473 (an executable plan needs a schema) |
| F10 | One `councilSeatFailed` (claude, unit 2 council, "exceeded 40s dispatch budget") in LT-1 — the council proceeded on the remaining seats. Recorded, not a blocker. | event seq 895 on d293f4d7 | — |

**What worked (so nobody mistakes the above for "the UI is broken").** The launch UX itself is
solid end to end on the dogfood daemon: verb → panel → repo picker → explicit chip → one-sentence
brief → submit posted **exactly** the pinned `TestingReconBody` (`{problem, repoRefs:["wicked-studio"]}`);
the daemon answered `{runId, runIds, campaign, campaignRegistered:false}` in < 1 s; the intake gate
reached the panel's card over the app's `/ws` fold in 67–80 s in all three runs; approving on the
card fired `POST /runs/:id/gate {"approve":true}` → 200 and the panel resolved; every run completed
with 3/3 units done, no wedge, no extra or deliver gate; the on-target unit's recon quality is high.
The defects are in the contract between what the copy promises and what the engine does after the
gate, and in what the Test surface shows afterwards.

## Preflight history (honest)

Three harness attempts. Attempt 1 gated on `vm_stat` "Pages free" ≥ 2 GB and never cleared in its
first minutes (free swung 58 MB–2 GB while load was 9–14); attempt 2 lowered the floor to 1 GB and
still sat at 93–178 MB; the operator then ruled that macOS keeps free pages near zero by design and
that free is not availability on this host, so attempt 3 gates on the three signals that mean
something here — no executing/awaiting runs on `:7701`, load(1m) < 20, swap < 95 % — and records
free/available memory for the report. All three launches cleared on the first poll (load 8.49 /
8.99 / 9.10, swap 93 %, 0 active runs); no launch waited. No other governed run was active at any
point; the harness never registered, modified or deleted anything on the daemon; no PR/push was
attempted by any run (`delivery: vacuous`).

## Reproduce

```
python3 e2e/test_feature_live.py                 # all of LT-1..LT-3 + LT-4/LT-5 analysis (~35 min)
ONLY=LT-1 python3 e2e/test_feature_live.py       # one scenario
STUDIO_URL=http://localhost:7701 TARGET_REPO=wicked-studio   # defaults
```

Requires `pip install playwright && playwright install chromium`, a reachable crew daemon with the
target repo registered, and nothing else executing on it — the harness refuses to launch otherwise.
