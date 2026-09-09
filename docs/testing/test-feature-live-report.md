# Live Test-feature run against wicked-studio on the dogfood daemon — 2026-09-09

**What this is.** The Test feature (the interactive / gated testing approach — "Run recon" and
"New test" on `/testing/campaigns`) exercised LIVE, as a user would, through the studio UI on the
operator's dogfood daemon, against wicked-studio itself. Not a dry run and not a pinned target: real
governed runs, real councils, the intake gate approved on the real SteeringGate card, then an honest
look at what the feature produced. Harness: [`e2e/test_feature_live.py`](../../e2e/test_feature_live.py);
raw measurements: [`e2e/artifacts/test-feature-live/report.json`](../../e2e/artifacts/test-feature-live/report.json);
captured plans: `e2e/artifacts/test-feature-live/LT-{1,2,3}-plan-<run>.md`; screenshots: the 21
PNGs beside them (`LT-{1,2,3}-*.png`, **committed** — the historical observations of the three
recorded runs, which no later run can regenerate; every one is linked from "LT-5 — the operator's
view" below). The root of `e2e/artifacts/test-feature-live/` is the **promoted historical
record**: since round 8 every new invocation writes its own `runs/<UTC timestamp>-<pid>/` directory
and touches nothing at the root — `python3 e2e/test_feature_live.py --promote <run-dir>` copies a
chosen run into the root deliberately.

> **Revised 2026-09-09 after the codex review of PR #215.** No new runs were launched and no daemon
> state was touched: the verdict was split into `harness_ok` vs `result`, the gate policy became one
> deny-list for every gate, siblings are attributed by relationship, the swap gate reverted to the
> brief's 85 %, and the plan-consistency measurement was corrected. Every number that changed is
> annotated inline as *(was X — why)* and listed in `report.json → revisions[]`; the underlying
> measurements are the originals.
>
> **Revised again after codex round 2 (same day, still offline).** `pass` now requires every
> attributable sibling terminal with its own verdict; gates are decided by gate *kind* and fail
> closed; the preflight is re-run at the submit click under a process-wide launch reservation;
> sibling gates are decided on the UI while following; the brief-text attribution fallback is gone;
> artifact writes are contained and symlink-safe; evidence-fetch failures are typed misses; plan
> measurements exclude execution summaries. One number moved (LT-1's scenario count, 31 → 28 —
> annotated below); the swap-ceiling item was adjudicated by the coordinator at the time: recorded +
> acknowledged, not enforced *(superseded — the contract itself was amended after round 4; see
> "Preflight history")*.
>
> **Revised a third time after codex round 3 (same day, still offline — read-only GETs only, no
> launch).** The gate policy now fails closed on an *unknown* gate kind (unit lookup failed,
> `stage`/`gate` null): reject unless the COMPLETE prompt is crew's pre-execution shape with no
> delivery verb anywhere (codex's probe "Approve unit 4 before it runs: Push the branch and open a
> PR" → reject; an empty prompt is always a reject); the preflight has a fourth gate — no heavy
> worker/build fan-out on the host (`ps` scan, fail closed); the launch lock is opened `O_NOFOLLOW`
> after an `lstat` walk of every path component, and every artifact path is walked the same way;
> attributable siblings are rediscovered on every follow poll and the follow ends only on a set
> stable for two polls with every member terminal; every gate click's WIRE is verified (exact
> `/api/v1/runs/<this run>/gate`, `body.approve` == the decision, 2xx — a mismatch is
> `harness_ok=false`); and a plan line is excluded as an execution result only when it carries a
> RESULT marker, never for naming a command. **No number moved**: the three plans re-derive to the
> same 28 / 13 / 22 scenario lines, 31 / 14 / 30 files and 38.6 % / n/a / 0 % consistency — why is
> recorded in `report.json → revisions[2]`. The swap-ceiling item was re-adjudicated by the
> coordinator, no change *(superseded by the contract amendment below)*.
>
> **Revised a fourth time after codex round 4 (same day, still offline — read-only GETs only, no
> launch).** The gate policy is now an **allow-list** that fails closed: a gate is approved ONLY when
> the prompt is an allow-listed shape (crew's pre-execution unit gate `Approve unit N before it
> runs: …` or a plan approval `Approve [the] [proposed] [test] plan…`) **and** the gated unit's
> `stage`/`gate` is known and not a delivery kind **and** no delivery verb or command appears
> anywhere in the complete prompt (the list now includes `gh pr create`, `git push`, `push the
> branch`, `open a/the PR / pull request`, `npm`/`cargo publish`, `create a release`); everything
> else is rejected with a named reason — codex's probes "Approve unit 4 before it runs: gh pr create
> --fill", "Please push the branch and open a PR" and SteeringGate's "Prompt unavailable (daemon
> restarted)…" fallback all reject, and so does a plan approval whose body lists `/runs/:id/deliver`
> among the routes to test (a recorded finding, by design: a rejected plan is recoverable, an
> approved delivery is not). The fan-out gate is decided on the **tokens** of each `ps` command line,
> not a positional regex (`cargo +stable build`, `claude --model opus --print task`, `wicked-crew
> serve --db /tmp/x --port 62432` all block; `FANOUT_PATTERN` only adds matches). A followed
> sibling's gate whose wire fails is `sibling-gate-wire-mismatch` → `harness_ok=false`. The
> artifacts root is component-walked *before* startup creates anything (a symlinked `e2e/artifacts`
> refuses `main()`). The 21 screenshots are committed and linked below. **No number moved**; the
> recorded intake gates re-decide `approve` under the allow-list (`report.json → revisions[3]`). The
> swap-ceiling item: **the contract itself was amended by its author (the coordinator) on 2026-09-09
> to permit an explicit, acknowledged, recorded override; the harness matches the amended contract —
> no code change** (see "Preflight history").
>
> **Revised a fifth time after codex round 5 (same day, still offline — read-only GETs only, no
> launch).** (1) Every gate is now decided on the **complete, current prompt read from the daemon**,
> never on the card's text: SteeringGate renders `cleanPrompt()` — the text before the first `[` —
> so `Approve unit 4 before it runs: Finalize the test [gh pr create --fill]` showed a clean headline
> and was approved off the card; the harness now reads `GET /runs/:id/gate` (the daemon's cached
> open-gate record, `GateInfo.prompt`) or, failing that, the `awaitingHuman` event's verbatim
> `prompt`, decides on THAT, records the card's headline alongside (`gates[].prompt_card`,
> `card_consistent`) and only *clicks* the card; a full prompt the daemon does not serve is
> `unreadable-gate` (a clean headline alone never approves), a card that is not the full prompt's
> headline is `card-prompt-mismatch` — both reject. (2) The fan-out fence also matches build
> shorthand — `npm|pnpm|yarn|bun` with `build|test|typecheck|lint|check` anywhere, with or without
> `run` (`pnpm build`, `yarn build`, `bun test`) — and direct build/test executables by basename
> after the launcher look-through (`vite`, `tsc`, `esbuild`, `webpack`, `rollup`, `vitest`, `jest`,
> `playwright`, `rustc`, `make`, `ninja`, `gradle`, `mvn`, `go build|test`;
> `node …/vite/bin/vite.js build` included); the dogfood daemon, an idle `node` and `npm view x`
> still never match. (3) A plan line is excluded as an execution result only on a result
> **structure** — a summary tally, a tick, an exit code, `PASS|FAIL` starting the cell or ending it
> after `→`/`=>`/`:`, `green|red` with a tally or a command and no scenario verb — never a bare word:
> `- S-1 Verify failed /runs cards render red [TOOL]` and `- S-2 Verify /runs returns a FAIL
> verdict [AGENT]` are proposed scenarios. (4) Every artifact (report.json, plans, screenshots)
> lands through one dir-fd-anchored writer — the verified directory opened `O_RDONLY | O_DIRECTORY
> | O_NOFOLLOW`, a unique temp name created `O_EXCL | O_NOFOLLOW` via `dir_fd`, `fsync`, `rename`
> via `src_dir_fd`/`dst_dir_fd`; screenshots are taken as bytes — so a symlink swapped in after
> validation is refused or replaced, never followed. **No number moved**: the three plans re-derive
> to the same 28 / 13 / 22 scenario lines, 31 / 14 / 30 files and 38.6 % / n/a / 0 % consistency
> under the result-structure rule (why: `report.json → revisions[4]`); the recorded intake gates
> re-decide `approve` over their complete 180 / 246 / 180-char prompts — the cards showed all of
> them, no bracket (`gates[0].prompt_len == gate.prompt_raw_len`, `card_consistent: true`).
>
> **Revised a sixth time after codex round 6 (same day, still offline — read-only GETs only, no
> launch).** (1) **Gate identity before any click.** A POST to `/runs/:id/gate` carries no ord — it
> decides whatever the daemon's *current* gate is — so codex's reproduction (a cached record serving
> a delivery prompt for ord 4 while an old ord-1 event/card was still rendered) approved: the
> ord-mismatched record was discarded and the ord-1 event's readable prompt stood in. The harness
> now reads the daemon's CURRENT gate (`GET /runs/:id/gate`, else the LATEST `awaitingHuman` event —
> never an older one; an unreadable latest prompt is unreadable, full stop) and requires the card to
> BE that gate: same run (`data-run-id`), same ord (the card's `before unit #N` line, and the ord the
> harness read from the events), same headline (`cleanPrompt(current.prompt)`). Any conflict — a
> stale ord-1 card over a current ord-4 gate, an unreadable current prompt, a headline that is not
> the current prompt's — means NO click: the decision is recorded as `reject-by-abstention` with both
> texts and both ords (`gates[].prompt` / `prompt_card`, `current_ord` / `card_ord`), the finding is
> `gate-state-conflict`, `harness_ok=false`, and the run is left exactly as it is (round 5 clicked
> REJECT on an unreadable or mismatched card — an irreversible act on a gate the harness could not
> identify). (2) **Descriptor-anchored traversal.** `O_NOFOLLOW` on a pathname open protects only
> the final component: swapping `e2e/artifacts` (an ancestor) for a link after validation redirected
> both the open and the `lstat` to the same outside directory, so the identity check passed. Now the
> resolved repo root is opened once (the trusted descriptor) and every component — `e2e`,
> `artifacts`, `test-feature-live` — is opened `O_RDONLY | O_DIRECTORY | O_NOFOLLOW` *relative to the
> previous descriptor* (a missing one created with `os.mkdir(name, dir_fd=…)` and re-opened the same
> way); file, temp and lock creation and the rename happen on the final descriptor; the walk is
> repeated on every write; no pathname open, `mkdir` or `resolve` under the evidence dir remains
> (the self-test asserts that over the module source, and swaps the ancestor between two walks,
> during one, and as a missing component is being created — refused each time, nothing outside).
> (3) The fan-out fence also matches `pytest`/`py.test` by basename and any `python*` (`python3.12`
> included) with `-m pytest` or `-m unittest` among its tokens, with or without `-n` (`pytest -n 8`,
> `python3 -m pytest -n 8`); `python3 -m json.tool` and the harness itself never match. (4) A result
> structure excludes a plan line only when the cell/body carries NO scenario verb: `S-1 Verify CLI
> returns exit code 1 for invalid input [TOOL]` and `S-2 Verify completed UI cards show ✓ [TOOL]` are
> scenarios (round 5 dropped both on the exit code / the tick, and the self-test enshrined "verify
> the CLI exits with exit code 0" as a result — fixed); `N tests`, `Tests:` and `test results` are
> the tally noun / a label, not the verb, and a results table's verb-less Result cell still marks the
> row. **No number moved**: the three plans re-derive to the same 28 / 13 / 22 scenario lines,
> 31 / 14 / 30 files and 38.6 % / n/a / 0 % consistency under the verb-wins rule — no kept line of
> any plan carries a tick or an exit code, and the one item ever excluded (LT-1's `` `npm test` →
> 237 files / 2442 tests green ``) has no scenario verb (why: `report.json → revisions[5]`); the
> recorded intake gates re-check their identity over the recorded evidence (one `awaitingHuman`
> event, ord 1; headline == complete prompt; same run) with no conflict and re-decide `approve`
> (`gates[0].current_ord`, `gate_identity`).
>
> **Revised a seventh time after codex round 7 (same day, still offline — read-only GETs only, no
> launch).** (1) **A failed current-gate read abstains — it never decides on earlier events.** Every
> live caller handed `decide_gate_on_card` the events it had fetched before the card rendered, and
> when `GET /runs/:id/gate` failed (503, 404, a malformed 200, a transport error) `current_gate` fell
> back to THAT log — so codex's stale unit-1 card over a newer unit-4 delivery event approved
> (`wire_ok` true) on every failure branch and `/events` was never re-read. Now there is no argument
> for earlier events: the only fallback is a FRESH `GET /runs/:id/events` and the current UNRESOLVED
> gate in it — the latest `awaitingHuman` with no later `gateDecided`/`resumed` for its ord and no
> terminal event after it (`unresolved_gate`); the unit-4 gate is identified there and the unit-1
> card is a `gate-state-conflict` (no click). When the fresh fetch fails too, or the log settles
> nothing (no gate, already decided, ambiguous, run over), the state is UNKNOWN:
> `reject-by-abstention`, finding `gate-state-unknown`, `harness_ok=false` (a sibling's:
> `sibling-gate-state-unknown`). A healthy gate read still approves as recorded. (2) **The launch
> reservation protects the daemon, not the worktree.** `ART/.launch.lock` gave each worktree its own
> lock — two harnesses in two worktrees both saw an idle `:7701` and both submitted. The lock now
> lives outside every worktree in a per-user directory under the system temp dir
> (`wicked-test-feature-live-<uid>`, created 0700 and refused unless it is this user's and not
> writable by anyone else — never under `~/.wicked-crew`), named by the sha256 of the daemon origin,
> still created `O_NOFOLLOW` on the descriptor of a directory reached by the trusted no-follow walk,
> same `flock` semantics; its scrubbed path, scope and origin are recorded in `report.json →
> launch_lock`. **No number moved**: the recorded intake gates re-check under the round-7 rule over
> the recorded evidence — each run had a single `awaitingHuman` (ord 1) that closed its log at
> decision time (`gate.events_before_gate[-1]`, `event_type_counts.awaitingHuman 1`) and the gate
> POST was accepted (status 200: the gate was open at the click), so the fresh-events fallback would
> establish the same ord-1 gate and re-decide `approve` (`gates[0].gate_identity_round7`); the three
> recorded launches predate the shared reservation (`launch_lock.held_for_recorded_launches: false`).
>
> **Revised an eighth time after codex round 8 (same day, still offline — read-only GETs only, no
> launch).** (1) **Gate identity requires complete metadata.** A `GET /runs/:id/gate` record must
> carry `runId`, an integer `ord` and the verbatim `prompt` — a 2xx with only a `prompt` (codex's
> probe: a unit-4 prompt served that way, a unit-1 card, unit-1 metadata → *approved*, because with
> no ord every ord comparison was skipped) is an incomplete record: `unknown-gate-kind`, abstain,
> the events never substituted for a record the daemon did answer. The gated unit's `stage` AND
> `gate` must both be recognized wire values (`recon|build|review|test`;
> `auto|human_confirm|human_confirm_if`, string or object form) — `{stage: null, gate: "human"}` is
> no longer a "known non-delivery kind" — and an unknown kind is now an **abstention** (nothing
> clicked, `harness_ok=false`), not a clicked reject: which operation the gate authorizes cannot be
> told, and a click either way is irreversible. An APPROVE additionally requires the card to render
> the daemon's current ord (`before unit #N`; `card-ord-unverified` otherwise) — a reject needs no
> such proof. (2) **One reservation per daemon.** `localhost:7701` and `127.0.0.1:7701` hashed to
> two lock names and the lock directory followed `TMPDIR`: the origin is now canonical (scheme
> lower-cased; `localhost`, `127.0.0.0/8`, `::1`/`[::1]` and the machine's loopback aliases collapse
> to `loopback`, other hosts to the resolver's canonical name; the default port explicit) and the
> directory is fixed — `/private/tmp/wicked-test-feature-live-<uid>/` on macOS, `/tmp/…` elsewhere
> — never under the home directory; `report.json → launch_lock` records the canonical origin and
> key. (3) **Per-invocation evidence.** Every invocation writes `report.json`, plans and screenshots
> under `e2e/artifacts/test-feature-live/runs/<UTC timestamp>-<pid>/`; the committed historical
> files at the root are read-only fixtures the harness never rewrites (a blocked-preflight
> invocation leaves the root byte-identical — asserted end to end); `python3
> e2e/test_feature_live.py --promote <run-dir>` copies a chosen run into the root deliberately.
> (4) **Survey prose is not a scenario.** `tests` inside a path token (`tests/`, `tests/x.ts`) is
> not a verb — a scenario verb is a standalone word — and a bullet that starts with a code-span
> path followed by ` — ` is a survey entry. **One number moved: LT-3's scenario count, 22 → 21** —
> its `` **`tests/`** — 220+ Vitest specs (jsdom), covering … `` survey bullet had counted as a
> scenario; LT-1 (28) and LT-2 (13) re-derive unchanged, the consistency row reads 28 vs 21 (still
> 0 % shared), 38.6 % file overlap and n/a ids unchanged (`report.json → revisions[7]`). The
> recorded intake gates re-check under the complete-metadata rule (unit 1 stage `test` / gate `auto`
> — both wire values; the `awaitingHuman` event carried the run, ord 1 and the prompt; the card
> rendered `before unit #1`) and re-decide `approve` (`gates[0].gate_identity_round8`). Copilot's
> four threads: stable screenshot names → solved by (3); `/repos` is a typed list (`list_repos`);
> an undecodable `/ws` frame is a recorded placeholder (`ws_frame_undecodable`) and the socket keeps
> being listened to; a non-JSON 2xx launch answer is recorded raw with a finding.

| Component | Version |
|---|---|
| wicked-crew daemon (`:7701`) | 0.7.25 (studioBundle 0.5.1, coreTs 0.7.16, wicked-core 0.4.0, wicked-estate 0.15.1) |
| target repo | `wicked-studio` @ `main` `b30000f` (registered on the daemon as repo id `wicked-studio`) |
| council roster | claude, codex, pi, copilot, opencode |
| browser | Playwright chromium 145 headless, extension-free, 1440×900 |

**Rules the harness held itself to.** One governed run in flight at a time; a serialization
preflight before every launch (zero executing/awaiting runs on `:7701`, 1-minute load < 20, and a
swap gate — the brief's contract is **< 85 %**, which the harness enforces by default; the three
recorded launches ran under a coordinator-authorized **95 %** with swap reading 93 %, a contract
deviation recorded in `report.json → contract_deviation` and accepted as deviation evidence under
the contract's 2026-09-09 amendment — see "Preflight history"; free memory was
recorded but not gated on). *The harness as committed now also re-runs the gates immediately
before the submit click under a `flock` reservation that protects the **daemon**, not the
worktree — the lock lives outside every worktree in a fixed per-user directory
(`/private/tmp/wicked-test-feature-live-<uid>` on macOS, `/tmp/…` elsewhere — no `TMPDIR` moves
it, never under the home directory; created 0700) and is named by the sha256 of the **canonical**
daemon origin (`localhost` ≡ `127.0.0.1` ≡ `[::1]` ≡ `loopback`, other hosts via the resolver's
canonical name, the default port explicit — round 8), so two harnesses in two worktrees — or two
spellings of `STUDIO_URL` — aiming at the same `:7701` contend for one lock while different daemons
never do;
it is held until the intake gate is decided (`preflights[].at: "submit"`; the lock's scrubbed
path, scope and origin are recorded in `report.json → launch_lock`) — the three recorded launches
predate that check and had one preflight before browser start-up (`at_submit: "not performed"`)
— and carries a fourth gate: no
heavy worker/build fan-out on the host (`fanout_processes()` over `ps -axo pid=,command=`, each
command line tokenized and matched on its **tokens in any order** — `codex … exec`, `claude … -p |
--print`, `cargo [+toolchain] build | test | clippy | run`, `go build | test`, `npm|pnpm|yarn|bun`
with `build | test | typecheck | lint | check` anywhere (with or without `run` — `pnpm build`,
`yarn build`, `bun test`), a direct build/test executable by basename (`vite`, `tsc`, `esbuild`,
`webpack`, `rollup`, `vitest`, `jest`, `playwright`, `rustc`, `make`, `ninja`, `gradle`, `mvn`,
`pytest`, `py.test` — `node …/vite/bin/vite.js build` included), any `python*` with `-m pytest` or
`-m unittest` among its tokens (`python3 -m pytest -n 8`; `python3 -m json.tool` never), a second
`wicked-crew serve` whose `--port` value
(`--port N` / `--port=N`) is not 7701, runtime launchers such as `node …/.bin/codex` looked
through; the dogfood daemon, an idle `node` and `npm view x` never match; `FANOUT_PATTERN` adds a
regex, never replaces the rules; any match or a failed `ps` blocks; recorded in the reading as
`fanout: [pid cmd…]`). The three launches predate
that gate too (`readings[].fanout: "not measured"`); a live read-only `ps` on this host at review
time listed a second `wicked-crew serve --port 62432` daemon and codex council seats — the gate
would have blocked.* Every gate decided through the UI card only (never the API) under one policy
applied to the intake gate too — *an allow-list that fails closed, judged on the **complete,
current prompt read from the daemon, afresh** (`GET /runs/:id/gate` — the cached open-gate record —
else, on ANY failure of that read, a FRESH `GET /runs/:id/events` and its current unresolved gate:
the LATEST `awaitingHuman` with no later `gateDecided`/`resumed` for its ord, its verbatim `prompt`,
never an older one and never events fetched before the card rendered — round 7), never on the card's
`cleanPrompt()` headline, which strips everything from the first `[` on; the card is the click
surface, its headline is recorded alongside (`gates[].prompt_card`, `card_consistent`) — and,
since round 6, the card must BE the daemon's current gate before anything is clicked: same run
(`data-run-id`), same ord (its `before unit #N` line, and the ord the harness read from the
events), same headline (`cleanPrompt(current.prompt)`) — and, since round 8, the record itself
must be complete (`runId` + integer `ord` + `prompt`; a prompt-only 2xx is `unknown-gate-kind`)
and an *approve* requires the card to render the current ord (`card-ord-unverified` otherwise);
any conflict, or a current prompt the
daemon does not serve, is `reject-by-abstention` — nothing clicked, both texts and both ords
recorded, finding `gate-state-conflict` — or `gate-state-unknown` when neither the record nor the
fresh events establish a current gate at all — `harness_ok=false` (a POST to `/runs/:id/gate`
carries no ord: a stale card would decide the daemon's current gate). With the identity proven,
a gate is approved ONLY when
(a) the prompt is an allow-listed shape — crew's pre-execution unit gate ("Approve unit N before it
runs: …") or a plan approval ("Approve [the] [proposed] [test] plan…"), (b) the gated unit's
`stage` AND `gate` are both recognized wire values (`recon|build|review|test`;
`auto|human_confirm|human_confirm_if`) and neither is deliver/release/publish/merge, and (c) no delivery verb or command
appears anywhere in the complete prompt (deliver(y) / push / `git push` / push the branch /
`gh pr create` / `pr create` / open a|the PR / pull request / merge / publish / `npm`|`cargo
publish` / release / create a release — "Approve unit 4 before it runs: Finalize the test [gh pr
create --fill]" is rejected on the bracketed command the card never shows). Everything else is
rejected with a named reason: a delivery kind; a delivery verb anywhere
(`delivery-verb` — a plan body listing `/runs/:id/deliver` among the routes to test is rejected
too, and recorded as a finding); any other shape, SteeringGate's "Prompt unavailable (daemon
restarted)…" fallback included (`unknown-prompt-shape`); an allow-listed shape whose unit kind is
unknown — lookup failed, `stage` or `gate` null or not a wire value (`unknown-gate-kind`) — is,
since round 8, an abstention rather than a clicked reject: nothing is clicked. A current prompt the daemon
does not serve (`unreadable-gate`) and a card whose headline is not the current prompt's
(`card-prompt-mismatch`) never reach the policy: they are gate-state conflicts, and nothing is
clicked. The recorded intake gates (unit 1, stage `test`, gate
`auto`, "Approve unit 1 before it runs: …", no delivery verb, complete prompts of 180 / 246 / 180
chars shown whole on the card) re-evaluate to approve — agreeing with what was clicked. Every
click's wire is verified: the response must be a POST to
exactly `/api/v1/runs/<this run>/gate` with `body.approve` equal to the decision and a 2xx status,
else `gate-wire-mismatch` → `harness_ok=false` (a followed sibling's gate: `sibling-gate-wire-
mismatch`, same consequence); the three recorded gates re-verify offline
(`gates[0].wire_ok: true`)*; sibling gates are decided on `/runs/<sibling id>` while following, and
the attributable set is rediscovered on every poll (none arose); no deliver gate approved (none
arrived); no repo/project writes; read-only GETs for every assertion, with a failed evidence fetch
recorded as a typed miss rather than as absent evidence (none occurred; unexpected 2xx shapes on
`/events`, `/runs`, `/campaigns` are typed misses too); a wedge (no events for 10 min) would have
been reported, not killed (none occurred).

**The one-sentence brief** (identical for all three launches — core#393 splits on `.`/`;`/newline,
so it contains none):

> Survey wicked-studio at its current main and propose a test plan covering its live /ws CoreEvent
> fold (awaitingHuman, unitPlanned, sessionCompleted frames), the /api/v1 routes it calls (runs,
> campaigns, testing/recon, projects, repos), its CLI entry points, and its UI pages
> (/testing/campaigns, /runs/:id, /steering, the home deck), naming the real source files behind
> each scenario and classifying each as a deterministic tool check or a governed agent run

## Results

| Scenario | Result | harness_ok | Units planned | Gate prompt | Launch→gate | Approve→terminal | Siblings launched | Campaign registered | Verdicts | Plan names real files / classifies |
|---|---|---|---|---|---|---|---|---|---|---|
| LT-1 Run recon | **fail** — feature contract not met | **yes** | **3** (intent 1) | pre-execution: "Approve unit 1 before it runs: Recon: survey the target…" (180 chars, no plan) | 80 s | 564 s (total 651 s) | **0** attributable (0 unrelated) | **no** (label `recon-mttmyh2a-c635a60c` dangling) | none (`acceptance.required=false`) | yes — **31** canonical files *(was 25 = 9 paths + 16 basenames counted as separate identities; bare names now resolve to their repo path and lower-case source names count)* / yes |
| LT-2 New test | **fail** — feature contract not met | **yes** | **3** (intent 1) | pre-execution: "Approve unit 1 before it runs: New test: plan the test…" (246 chars, no plan) | 67 s | 190 s (total 260 s) | **0** attributable (0 unrelated) | **no** (`recon-mttnf3s6-99e928c5` dangling) | none | yes — **14** canonical files *(was 14 with `App.tsx` double-counted against `src/App.tsx`; `useRoute.ts` now resolved)* / yes (`[TOOL]`/`[AGENT]` tags) |
| LT-3 Run recon again (identical brief) | **fail** — feature contract not met | **yes** | **3** | pre-execution, same shape as LT-1 | 70 s | 210 s (total 287 s) | **0** attributable (0 unrelated) | **no** (`recon-mttnnicz-82c6bb65`) | none | yes — **30** canonical files *(was 32 = 24 paths + 8 basenames with five files counted twice; now 27 distinct + `interactive_wire_contract_test.py`, `uxfix_fixture.py`, `prepare-dist.mjs` resolved)* / yes |
| LT-3 consistency vs LT-1 | **low** | — | — | — | — | — | — | — | — | files overlap **38.6 %** (17 common / 44 union) *(was 32.6 % = 14/43 when `App.tsx` and `src/App.tsx` counted as different files — identities are now canonical repo paths)*; scenario-id overlap **n/a** — neither plan carries scenario ids *(was reported 0 % on LT-1's R-01/R-02, which are RAID risk ids inside a survey bullet, not scenario ids; only LT-2 numbers its items, 1.1–4.2)*; scenario-title overlap **0 %** (**28** vs 22 extracted scenario titles, none shared) *(was 31 vs 22 — three LT-1 lines were execution summaries, not proposed scenarios: the `npm test` baseline bullet, the `npm test` row of unit 2's "Execution verdict" table and that section's "#10 …" gap bullet; results a worker reported are now excluded from the scenario set; before that, 0 % of 8 vs 4 when the extractor missed the plan tables and counted survey bullets, and an earlier 25 % came from toolchain lines, elided since)*. *Round 5 restated: unchanged — 38.6 % / n/a / 0 % over 28 vs 22 — under the result-**structure** rule (a bare `red`/`green`/`FAIL` no longer excludes a line): the only LT-1 item ever excluded, `` `npm test` → 237 files / 2442 tests green ``, carries a command, a tally and no scenario verb and stays excluded; no kept line of either plan carries a structure, and neither plan names an expected outcome with a colour or verdict word — `report.json → revisions[4]`. Round 6 restated: unchanged again — 38.6 % / n/a / 0 % over 28 vs 22 — under the verb-wins rule (a structure excludes only a verb-less cell): no kept line of either plan carries a tick or an exit code, and the one excluded LT-1 item has no scenario verb — `report.json → revisions[5]`. **Round 8: 38.6 % / n/a / 0 % over 28 vs 21** — LT-3's `` **`tests/`** — 220+ Vitest specs (jsdom), covering … `` survey bullet is not a scenario (`tests` inside the path token `tests/` is not a verb; a code-span path followed by ` — ` is survey prose); the plan's 21 explicit scenario rows remain and none is shared with LT-1's 28 — `report.json → revisions[7]`* |
| LT-4 surfaces coverage | **pass (breadth)** | — | — | — | — | — | — | — | — | all three plans propose tests for all four asked surfaces (WS events, /api/v1 routes, CLI, UI pages); no gap — see quality caveats below. *Re-measured over the extracted scenario lines + plan-table rows only (a survey paragraph repeating the brief's surface names no longer counts): still four of four for every plan — LT-4 does not flip; `names_real_files` now also requires ≥ 1 scenario, still true for all three. Round 5 restated: four of four for every plan, unchanged — the scenario sets are the same 28 / 13 / 22 lines under the result-structure rule (`measured_over` now names the structures). Round 6 restated: unchanged — the same lines under the verb-wins rule (`measured_over` now says so). Round 8: four of four for every plan over 28 / 13 / **21** lines — LT-3's dropped line was survey prose, and every surface it named is named by a kept row (`measured_over` now names the survey-prose rule)* |
| LT-5 operator's view | **observed — stale and misleading** | — | — | — | — | — | — | — | — | Tests landing identical before/after every run; the finished run is nowhere on the page that launched it; scoreboard for the returned label says "No campaign is filed" (+ console 404); "All campaigns" rename leftover |

Two verdicts, deliberately. **`harness_ok: yes`** is the honest *harness* status: each governed run was
launched from the UI, its intake gate rendered on the card and was decided there, and it reached
`completed` with 3/3 units done — no wedge, no extra gate, no deliver, no blocker. **`result: fail`**
is the *feature* verdict: the contract ("run the approved plan as governed sibling runs under one
test") requires ≥ 1 attributable sibling run with **every** attributable sibling terminal and
**every** one carrying its own acceptance verdict (`measured.sibling_verdicts`, per id) — none
appeared (LT-2 additionally has no registered campaign). *(An earlier revision of this table said
`pass` on "recon completed + the plan names real files + classifies"; codex's review called that out
and the verdict was split; its round 2 showed that one truthy verdict among unfinished siblings
still passed, so the rule is now per sibling — `fail_reasons[]` in `report.json` names the sibling.
The measurements did not change; the reading of them did.)*

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
| 3 | the operator's sentence | claude | an on-target 17-row plan: WS fold (`useEventStream.ts`, `store/gates.ts:137/159`, `store/runtime.ts:58/91/99`, `narrator.ts`), REST routes per API module, CLI = npm scripts + `scripts/*.mjs` (no `bin`), UI pages per route; classifies Deterministic / Live read-only smoke / Operator-run e2e / Governed agent run; flags two unit-test gaps | an on-target 4-group plan (`[TOOL]`/`[AGENT]`), ends "**Holding at the gate — launching nothing until you approve.** Want me to run the `[TOOL]` checks now and launch a single governed sibling run…?" — a question with no gate to land on; the session completed | on-target 11-row plan; the run names 30 canonical files *(was 32 — see Results)* |

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
diffable — LT-3's 38.6 % file overlap, no shared scenario ids and 0 % title overlap *(was quoted as
32.6 % / 0 % id overlap before file identities were canonicalized and the id count corrected — see
the Results row)*.

## LT-5 — the operator's view

Screenshots — the **historical observations of the three recorded runs** (d293f4d7 / f8bc2bad /
d12adb6c on 2026-09-09 01:06–01:32), committed under `e2e/artifacts/test-feature-live/` and
**not regenerable**: another live run would launch different runs against a different daemon state
(the harness ignores regenerated PNGs everywhere else — `.gitignore` re-includes exactly these 21).
Since round 8 a new invocation writes its screenshots — under the same stable names — into its own
`runs/<UTC timestamp>-<pid>/` directory and never over these files; `--promote <run-dir>` is the
only path into the root, and it is deliberate.
Captured full-page at 1440×900; 21 files, 2,107,067 bytes, none over 250 KB (none downscaled).

| Capture (what it shows) | LT-1 Run recon | LT-2 New test | LT-3 Run recon again |
|---|---|---|---|
| `01-landing-before` — the Tests landing before the launch | [LT-1-01](../../e2e/artifacts/test-feature-live/LT-1-01-landing-before.png) (74 KB) | [LT-2-01](../../e2e/artifacts/test-feature-live/LT-2-01-landing-before.png) (74 KB) | [LT-3-01](../../e2e/artifacts/test-feature-live/LT-3-01-landing-before.png) (74 KB) |
| `02-panel-filled` — verb opened, repo chip attached, one-sentence brief typed | [LT-1-02](../../e2e/artifacts/test-feature-live/LT-1-02-panel-filled.png) (107 KB) | [LT-2-02](../../e2e/artifacts/test-feature-live/LT-2-02-panel-filled.png) (107 KB) | [LT-3-02](../../e2e/artifacts/test-feature-live/LT-3-02-panel-filled.png) (107 KB) |
| `03-gate-card` — the SteeringGate card inside the panel, before the click | [LT-1-03](../../e2e/artifacts/test-feature-live/LT-1-03-gate-card.png) (122 KB) | [LT-2-03](../../e2e/artifacts/test-feature-live/LT-2-03-gate-card.png) (124 KB) | [LT-3-03](../../e2e/artifacts/test-feature-live/LT-3-03-gate-card.png) (122 KB) |
| `04-after-approve` — the panel's resolved copy after the approve | [LT-1-04](../../e2e/artifacts/test-feature-live/LT-1-04-after-approve.png) (84 KB) | [LT-2-04](../../e2e/artifacts/test-feature-live/LT-2-04-after-approve.png) (84 KB) | [LT-3-04](../../e2e/artifacts/test-feature-live/LT-3-04-after-approve.png) (84 KB) |
| `06-run-page` — `/runs/:id` after completion | [LT-1-06](../../e2e/artifacts/test-feature-live/LT-1-06-run-page.png) (222 KB) | [LT-2-06](../../e2e/artifacts/test-feature-live/LT-2-06-run-page.png) (183 KB) | [LT-3-06](../../e2e/artifacts/test-feature-live/LT-3-06-run-page.png) (186 KB) |
| `07-landing-after` — the Tests landing after the run | [LT-1-07](../../e2e/artifacts/test-feature-live/LT-1-07-landing-after.png) (74 KB) | [LT-2-07](../../e2e/artifacts/test-feature-live/LT-2-07-landing-after.png) (74 KB) | [LT-3-07](../../e2e/artifacts/test-feature-live/LT-3-07-landing-after.png) (74 KB) |
| `08-scoreboard` — `/testing/campaigns/<returned label>` | [LT-1-08](../../e2e/artifacts/test-feature-live/LT-1-08-scoreboard.png) (44 KB) | [LT-2-08](../../e2e/artifacts/test-feature-live/LT-2-08-scoreboard.png) (44 KB) | [LT-3-08](../../e2e/artifacts/test-feature-live/LT-3-08-scoreboard.png) (44 KB) |

(No `05-gate-*` capture exists: that name is reserved for a later gate, and none arrived in any run.)

- **Gate card** ([`03-gate-card`](../../e2e/artifacts/test-feature-live/LT-1-03-gate-card.png)): renders inline in the "Run recon"/"New test" panel with "Awaiting
  human decision · run d293f4d7 · before unit #1" and the prompt "Approve unit 1 before it runs:
  Recon: survey the target and propose a test plan…". Four buttons; a "Run awaiting human" toast
  bottom-right; the rail gains a "Run recon" sub-item under Test. Works as designed — but what it
  asks the operator to approve is the survey, not a plan.
- **Tests landing after each run** ([`07-landing-after`](../../e2e/artifacts/test-feature-live/LT-1-07-landing-after.png) vs [`01-landing-before`](../../e2e/artifacts/test-feature-live/LT-1-01-landing-before.png)) is pixel-identical to before: PERFORMANCE
  "TESTS 1 · TEST RUNS 2", PIPELINE "0 running · 0 needs you", RISK "PASS RATE 0 % — 0 landed of 2
  finished". Every one of those numbers comes from the **Sept-8 cancelled fan**
  `recon-mttdwnhf-e3e3c5f4` (both nodes `cancelled`, campaign status `partially_completed`), whose
  card is titled "Recon: survey the target and propose a test plan…" — the same title the three new
  runs carry. The three runs launched *from this page* never appear on it: they are single-repo
  recons, which crew files on the per-run path without registering a campaign, and the landing
  lists campaigns (`GET /campaigns` returned that one stale campaign and `groups: []` throughout).
- **Scoreboard** ([`08-scoreboard`](../../e2e/artifacts/test-feature-live/LT-1-08-scoreboard.png)): the launch answer carried `campaign: recon-mttmyh2a-c635a60c`
  (with `campaignRegistered: false`, which the panel ignores); the panel's resolved copy points the
  operator at "Campaigns"; `/testing/campaigns/recon-mttmyh2a-c635a60c` renders "No campaign is
  filed under **recon-mttmyh2a-c635a60c** on this daemon — a campaign appears with its first run, so
  this label either never launched one or lives on another daemon." with an "**All campaigns**"
  link (rename leftover — the section is "Test"), and the browser console logs the 404 for
  `GET /campaigns/<label>`. Same for all three labels.
- **Run page** ([`06-run-page`](../../e2e/artifacts/test-feature-live/LT-1-06-run-page.png)): "Recon · d293f4 · #1 · Completed", phase strip **test › build ›
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
| F9 | **Two plans for the same brief do not agree.** LT-1 vs LT-3 (identical body): **38.6 %** file overlap over canonical repo paths (17 of 44 files named by either plan are named by both) *(was 32.6 % when `App.tsx` and `src/App.tsx` counted as two files)*; **no shared scenario ids** — neither plan carries any *(was "0 %" on LT-1's R-01/R-02, which are RAID risk ids in a survey bullet)*; **0 %** scenario-title overlap across **28** vs **21** extracted scenario rows/items *(was 28 vs 22 until round 8, when LT-3's `` `tests/` — 220+ Vitest specs… `` survey bullet stopped counting as a scenario; 31 vs 22 before that — three of LT-1's lines were execution summaries (`npm test` results, the "Execution verdict" section), now excluded; before that 0 % of 8 vs 4 before plan tables were counted)*; classification vocabularies differ. The feature has no stable plan schema to compare, approve, or execute against. | `consistency_vs_LT-1` | crew#473 (an executable plan needs a schema) |
| F10 | One `councilSeatFailed` (claude, unit 2 council, "exceeded 40s dispatch budget") in LT-1 — the council proceeded on the remaining seats. Recorded, not a blocker. | event seq 895 on d293f4d7 | — |
| F11 | **A captured unit output ends mid-word at the source.** LT-3 unit 2's `GET /runs/:id/units/2/output` is 5375 chars and stops at "a committed selector cont"; its streamed `unitOutputDelta` frames total 2587 chars over 3 events (units 1 and 3 stream exactly their captured length: 5336 and 7752). The committed plan file reproduces the daemon's output verbatim — the truncation is upstream of the harness, not an artifact-writing defect. | LT-3 plan unit 2; `GET /runs/d12adb6c…/events` vs `/units/2/output` | — (single occurrence; recorded) |

**What worked (so nobody mistakes the above for "the UI is broken") — this is what `harness_ok: yes`
records.** The launch UX itself is
solid end to end on the dogfood daemon: verb → panel → repo picker → explicit chip → one-sentence
brief → submit posted **exactly** the pinned `TestingReconBody` (`{problem, repoRefs:["wicked-studio"]}`);
the daemon answered `{runId, runIds, campaign, campaignRegistered:false}` in < 1 s; the intake gate
reached the panel's card over the app's `/ws` fold in 67–80 s in all three runs; approving on the
card fired `POST /runs/:id/gate {"approve":true}` → 200 and the panel resolved; every run completed
with 3/3 units done, no wedge, no extra or deliver gate; the on-target unit's recon quality is high.
The defects are in the contract between what the copy promises and what the engine does after the
gate, and in what the Test surface shows afterwards.

## Preflight history (honest)

**The three recorded launches cleared under a 95 % swap threshold, not the brief's 85 %.** The
brief's contract is "refuse to run if another governed run is executing or swap > 85 %". This host
idles at ~93 % swap, so an 85 % gate would never have cleared; mid-run the coordinator authorized
relaxing it to 95 %, the harness was edited to a hard-coded 95, and every recorded reading is swap
**93.0 %** — i.e. all three launches (LT-1 at 01:06, LT-2 at 01:19, LT-3 at 01:25) happened
*above* the contract's ceiling and would not have launched under it. That is a contract deviation
and is now recorded as one: `report.json → contract_deviation` (top level, `{var, contract,
effective, ack}`; mirrored in `preflight_policy`), and every `preflights[].readings[]` entry carries
the `swap_max_pct` it was judged against (backfilled with 95 for these three — the threshold was not
recorded at the time). The harness now defaults to the contract's 85 %; the only way to move it is
an explicit `SWAP_MAX_PCT` env var **together with** `SWAP_MAX_PCT_ACK=contract-deviation` — without
the acknowledgement the harness exits naming both variables — and the move is logged as
`CONTRACT DEVIATION` at every preflight, stamped on every reading and recorded in that top-level
object.

**The contract was amended (its author — the coordinator — 2026-09-09, after codex rounds 2–4).**
Codex asked, in each of rounds 2, 3 and 4, for the 85 % ceiling to be *enforced* and compliant
live-run evidence obtained, or for an explicit amendment to the supplied contract. The contract
(`brief-test-feature-live.md`, the "Outputs" paragraph) now carries that amendment, quoted in full:

> CONTRACT AMENDMENT (coordinator, 2026-09-09, after codex rounds 2-4 of PR #215): the 85% default
> stands; an EXPLICIT operator override (SWAP_MAX_PCT together with SWAP_MAX_PCT_ACK=contract-deviation)
> is permitted and MUST be recorded in the report as a contract deviation (threshold, reading,
> acknowledgement) and stated in the report doc. The three recorded launches (d293f4d7, f8bc2bad,
> d12adb6c) ran under an authorized 95% override at 93% swap because this host idles above 85%; they
> are accepted as deviation evidence.

The harness implements exactly the amended contract, so **no code change** followed it: the default
is the contract's 85 % (`SWAP_MAX_PCT_CONTRACT`); `SWAP_MAX_PCT` moves the gate only together with
`SWAP_MAX_PCT_ACK=contract-deviation` (alone, the harness exits naming both variables); the
deviation is recorded as `contract_deviation` {var, contract 85, effective, ack} at the top of
`report.json` (mirrored in `preflight_policy`), logged as `CONTRACT DEVIATION` at every preflight
and stamped on every reading with the threshold it was judged against (`swap_max_pct`); and the
three recorded launches — 95 % threshold, 93.0 % reading, coordinator authorization as the
acknowledgement — are the deviation evidence the amendment accepts, stated here as it requires.
(Earlier revisions of this section called this a "coordinator adjudication"; the amended contract
supersedes that wording.) The three launches also predate the pre-submit preflight: each had one
preflight before browser start-up and none at the submit click (`preflights[].at_submit: "not
performed"`).

Round 3 added the **fan-out gate** (gate 4, above), round 4 made it decide on the tokens of each
command line rather than a positional regex, and rounds 5 and 6 widened the rules (build shorthand,
direct build/test executables, `pytest` / `python* -m pytest|unittest`): the three launches predate it (`readings[].fanout:
"not measured"`, `preflight_policy.fanout_gate: "not in force"`), and a read-only `ps` reading at
round-3 review time showed this host running a second `wicked-crew serve --port 62432` daemon plus
codex council seats — under the current harness none of the three launches would have cleared gate
4 either. Recorded as such; no launch was attempted to find out.

How it got there: three harness attempts. Attempt 1 gated on `vm_stat` "Pages free" ≥ 2 GB and never
cleared in its first minutes (free swung 58 MB–2 GB while load was 9–14); attempt 2 lowered the floor
to 1 GB and still sat at 93–178 MB; the operator then ruled that macOS keeps free pages near zero by
design and that free is not availability on this host, so attempt 3 gates on the three signals that
mean something here — no executing/awaiting runs on `:7701`, load(1m) < 20, and the swap gate above —
and records free/available memory for the report. All three launches cleared on the first poll (load
8.49 / 8.99 / 9.10, swap 93 %, 0 active runs); no launch waited. No other governed run was active at
any point; the harness never registered, modified or deleted anything on the daemon; no PR/push was
attempted by any run (`delivery: vacuous`).

## Reproduce

```
python3 e2e/test_feature_live.py                 # all of LT-1..LT-3 + LT-4/LT-5 analysis (~35 min)
                                                 # → e2e/artifacts/test-feature-live/runs/<UTC timestamp>-<pid>/ (this invocation's dir;
                                                 #   the root's committed report.json / LT-* files are never written)
python3 e2e/test_feature_live.py --promote <run-dir | stamp>
                                                 # copy ONE run's report.json / plans / screenshots into the evidence root, deliberately
ONLY=LT-1 python3 e2e/test_feature_live.py       # one scenario
STUDIO_URL=http://localhost:7701 TARGET_REPO=wicked-studio   # defaults
SWAP_MAX_PCT=95 SWAP_MAX_PCT_ACK=contract-deviation python3 e2e/test_feature_live.py
                                                 # relax the swap gate — an acknowledged, recorded contract deviation
                                                 # (SWAP_MAX_PCT alone exits naming both variables)
FANOUT_PATTERN='sccache|bazel' python3 e2e/test_feature_live.py
                                                 # ADD an extra regex to the fan-out gate — the token rules (FANOUT_RULES) always apply
                                                 # (pytest / make / cargo … are already rules)

python3 -m unittest e2e/test_feature_live_selftest.py -v   # offline self-test: thresholds + ack (the amended contract), fan-out
python3 -m py_compile e2e/test_feature_live.py             # rules on tokens (injected ps table, codex's probes, build shorthand +
                                                           # direct executables, pytest / -m pytest|unittest), pre-submit preflight
                                                           # + the descriptor-anchored launch lock, gate IDENTITY (a stale card or an
                                                           # unreadable current prompt ⇒ no click) + the allow-list gate policy on
                                                           # the COMPLETE prompt from a fake read-only daemon (fake page only
                                                           # clicked, wire verified), sibling gates + rediscovery + wire, verdict
                                                           # split, attribution, typed fetch misses (output type), raw launch body,
                                                           # scrub, plan analysis (result structures in verb-less cells only;
                                                           # re-derived over the committed plans), the descriptor-walked artifacts
                                                           # root and writer under symlink substitution (target, parent, temp name,
                                                           # ANCESTOR — between walks, mid-walk, at creation); round 8: complete gate
                                                           # metadata (an incomplete record / a partially known unit kind ⇒ abstain;
                                                           # an approve needs the card's ord), the canonical daemon origin + fixed lock
                                                           # dir (TMPDIR never moves it), the per-invocation run dir (a blocked
                                                           # preflight leaves the root byte-identical) + --promote, survey prose
```

Requires `pip install playwright && playwright install chromium`, a reachable crew daemon with the
target repo registered, and nothing else executing on it — the harness refuses to launch otherwise
(swap ≥ 85 % included, unless `SWAP_MAX_PCT` + `SWAP_MAX_PCT_ACK=contract-deviation` say otherwise —
the amended contract's explicit, recorded override; any `codex … exec` / `claude … -p|--print` /
`cargo [+toolchain] build|test|clippy|run` / `go build|test` / `npm|pnpm|yarn|bun` with
`build|test|typecheck|lint|check` anywhere / `vite`, `tsc`, `esbuild`, `webpack`, `rollup`,
`vitest`, `jest`, `playwright`, `rustc`, `make`, `ninja`, `gradle`, `mvn`, `pytest`, `py.test` by
basename / `python* -m pytest|unittest` / second
`wicked-crew serve … --port ≠ 7701` process on the host included, matched on the command line's
tokens in any order — `FANOUT_PATTERN` adds a regex, a failed `ps` blocks), re-checks all four gates
at the submit click, and holds the daemon's launch reservation —
`/private/tmp/wicked-test-feature-live-<uid>/<sha256(canonical daemon origin)>.launch.lock` (macOS;
`/tmp/…` elsewhere — a fixed location `TMPDIR` never moves; `localhost` ≡ `127.0.0.1` ≡ `[::1]`),
outside every worktree
(`flock`; the per-user directory created 0700 and refused unless it is this user's and not writable
by anyone else, the lock file created `O_NOFOLLOW` on the descriptor of a directory reached by the
same trusted descriptor walk as every artifact) until the intake gate is decided — a second harness
process aiming at the same daemon, from any worktree, fails fast; the lock's scrubbed path is
recorded in `report.json → launch_lock`.
The self-test needs none of that (it touches `git ls-files` of this worktree and a temp dir);
studio's CI runs no Python step, so run it by hand before pushing a harness change. Every artifact
— `report.json`, the plans, the screenshots — lands in this invocation's
`e2e/artifacts/test-feature-live/runs/<UTC timestamp>-<pid>/` directory (the root's committed files
are never written; `--promote` is the one deliberate path into it) through one descriptor-anchored
writer (the resolved repo root opened once, then `e2e`, `artifacts`, `test-feature-live`, `runs`,
the stamp each opened
`O_RDONLY | O_DIRECTORY | O_NOFOLLOW` relative to the previous descriptor and created with
`mkdir(dir_fd=)` where missing, a unique temp name created `O_EXCL | O_NOFOLLOW` on the final
descriptor, `fsync`, `rename` via `dir_fd` — a symlink swapped in for ANY component, ancestors
included, is refused at its own step, a link planted at the final name is replaced, never
followed; no pathname under the evidence dir is ever opened);
`report.json` is written after every scenario and on every exit path — an aborted run still leaves
the finished scenarios' evidence on disk under `aborted: {scenario, error}`.
