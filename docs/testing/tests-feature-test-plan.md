# Tests feature — test plan (revised)

The Test surfaces of wicked-studio: the `/testing/campaigns` landing (`CampaignsPage`), its two
launch verbs (`TestingLaunchPanel` — "Run recon" / "New test"), the project-scoped view
(`/p/:id/campaigns`, `ProjectCampaignsView`), the scoreboard (`CampaignScoreboard`), the Test
rail section (`LeftSidebar`), and the wire below them (`src/api/testing.ts`, `src/api/errors.ts`).

**Provenance.** Council recon run `1aba96f6-350d-4582-8491-21424c7073c3` (30 scenarios) →
codex final review **REVISE** (7 HIGH / 11 MEDIUM, every finding file:line grounded) → adjudication
ratified REVISE. This document is the plan with codex's REQUIRED CHANGES applied and the
deterministic layer **executed** (vitest, `tests/`). The curl layer is repaired and left as
documented next steps; the governed and Playwright layers are revised and left as documented next
steps. Rename regression: wicked-studio#203 (15 rendered strings + the rail ＋ behavior).

**Vocabulary rule.** The backend / route / store-key / testid vocabulary stays `campaign`
(`/testing/campaigns`, `data-testid="campaign-*"`, `campaignId`, `POST /testing/recon`'s response
`campaign` label). Every **rendered** word says Test. The guard for that is T30.

## 1. What the surface actually does (recon, verified)

- `TestingLaunchPanel` composes `TestingLaunchBody = {problem, projectId?, repoRefs?}` and calls
  `launchTestingRun` (`src/api/testing.ts`), which POSTs the pinned `/testing/recon`. The
  `problem` is `"<prefix>\n\n<trimmed brief>"`; the prefix is `RECON_PROBLEM_PREFIX` for "Run
  recon" and `TEST_PROBLEM_PREFIX` for "New test" (`TestingLaunchPanel.tsx:43,49`).
- **Presence gate.** Only the bare unknown-route 404 — body `'Not Found'` (Fastify headless) or
  `'not found'` (crew's SPA-serving notFoundHandler), `isRouteAbsent` (`src/api/errors.ts`) — falls
  back to the shipping `POST /runs` with the legacy single `repoRef`, and only when the scope fits
  it (≤ 1 repo, no project). A scope that needs the pinned keys throws
  `MultiScopeUnsupportedError` → `MULTI_SCOPE_UNSUPPORTED_COPY`. **Every other refusal is rethrown
  untouched** (named 404, 400, 500, 501, transport) — never retried over `/runs`.
- **Fan-out honesty.** `launchedRunIds` prefers a non-empty `runIds` over the legacy `runId`;
  invalid entries are dropped. `ids.length > 1` renders the fan-out (buttons, one per run) and
  **never** an inline gate; `ids.length === 1` watches the app's one gate fold (`useGateStore`,
  fed by `awaitingHuman` frames on `/ws`) and renders the EXISTING `SteeringGate` card;
  `ids.length === 0` is an error, not a silent no-op.
- **Scope.** A launch needs a project OR ≥ 1 explicit repo, or the explicit "run unscoped"
  opt-in. Selecting a project or attaching a repo resets that consent. A project's `crew.repo`
  members render as locked "via project" chips (display only — the daemon re-resolves from
  `projectId`); the picker excludes attached and project-carried repos and caps at 8.
- **Arrival intent (#203 fix).** `?new=test` / `?new=recon` on the landing
  (`testingLaunchPath`, `readLaunchIntent` in `src/api/testing.ts`) opens that panel on mount and
  is consumed with a `replace` navigation. The rail's ＋ ("New Test") and its "Run recon" row use
  it — a create affordance creates.

## 2. Codex's REQUIRED CHANGES → what changed here

| # | finding | resolution |
|---|---|---|
| 1 | T25 waits for `awaiting_human` and assumes the gate prompt starts with the launch prefix | Event is `awaitingHuman` (`src/store/gates.ts`). No prompt-prefix assumption anywhere: T17/T25 assert the prompt is rendered in-band via `steering-prompt`, whatever it says. |
| 1 | T7's fixture is impossible through the picker | T7 attaches `r1` **before** selecting the project that carries it; asserts one locked chip while selected, the explicit chip (with a working remove) after clearing. |
| 1 | T28 names the wrong close selector | "Add with chat" closes via `steering-author-close`; only the two launch panels use `testing-launch-close`. |
| 1 | The rail ＋ only navigates | Fixed (＋ → `?new=test` with the panel open) and tested separately from the label (`LeftSidebar.rail.test.tsx`, `CampaignsPage.test.tsx`). |
| 1 | T29's terminal URL is not guaranteed for project-filed runs | T29 asserts the canonical route (`/p/:projectId/build/:id` after `useLegacyRedirect`) or uses unfiled fixtures. |
| 2 | T5 covers one scope shape with an unspecified prefix | T5 is a matrix: project-only / explicit-only / combined / unscoped × both prefixes, trimmed brief, attach-order `repoRefs`, no absent keys. |
| 2 | T4 lacks the negative guarantee | T4 pins six real refusals (named 404, validation 400, strict-zod 400, 500, 501, transport) as rethrown after ONE call, both route-absent spellings, the unscoped `{problem}` fallback, and fallback-failure propagation. |
| 3 | Gate coverage omits reject / steer / cancel / failure | T19 pins `{approve:true}`, `{approve:true,amend}`, `{approve:false}`, `{approve:false,amend}` and the bodyless `POST /runs/:id/cancel` — at the fetch boundary (`gateWire.test.ts`) and through the panel (`TestingLaunch.test.tsx`), plus the refused decision. T25/T26 carry execution-boundary evidence requirements (§5). |
| 4 | Deterministic vs governed conflated; curl not executable | T22/T27/T29 split into deterministic assertions and labelled governed setup. T21–T23 rewritten as non-launching probes with captured bodies and the JSON content type (§4). |
| 5 | Async scope / consent / boundaries / gate content missing | T6 (rapid switching, failed lookup), T9 (consent reset), T10 (whitespace brief, double submit, retry), T11 (loading → empty → fixed), T12 (unavailable `initialProjectId`), T14 (no inline gate with sibling gates), T16 (four no-id shapes, multi-request/one-answer), T17 (unrelated gate, gate-before-response). |
| 6 | Rename inventory incomplete | 15 strings (§7), all fixed; T30 covers every listed surface state. |
| 7 | Fixtures / dependencies | Every deterministic test initialises its own fixtures; T18 precedes T17; no scenario depends on another test's state. |

## 3. Layer 1 — deterministic (vitest, executed)

All of these run with `npm test`. Each test's name carries its scenario id. Fixtures are mocks
at the client boundary (`apiFetch` / `api.*`) or the fetch boundary; nothing touches a daemon.

| id | surface | what is pinned | file |
|---|---|---|---|
| T1 | `isRouteAbsent` | exactly the two route-absent bodies; named 404s, other statuses, non-wire errors → false | `tests/testingLaunch.wire.test.ts` |
| T2 | `launchedRunIds` | non-empty `runIds` wins over `runId`; empty/invalid falls back; invalid entries dropped; `[]` when nothing usable | `tests/testingLaunch.wire.test.ts` |
| T3 | `isMultiScopeUnsupported` | the typed error; strict-zod 400 naming `repoRefs`/`projectId`; other 400s / statuses → false | `tests/testingLaunch.wire.test.ts` |
| T4 | `launchTestingRun` | (a) 200 verbatim, `/runs` untouched; (b) route absent + project → typed error, no `/runs`; (c) route absent + ≤1 repo → `POST /runs {problem, repoRef}` / `{problem}` (both spellings); (d) route absent + 2 repos → typed error; **negative:** six real refusals rethrown as-is after ONE call; fallback failure propagates verbatim | `tests/testingLaunch.wire.test.ts`, panel-level in `tests/TestingLaunch.test.tsx` |
| T5 | wire body | matrix: project-only / explicit-only / combined / unscoped × recon & test prefixes; trimmed brief; attach-order `repoRefs`; no absent keys; landing-level cases (one repo, many repos, project alone, union, unscoped) | `tests/TestingLaunch.test.tsx` |
| T6 | project selector | `crew.repo` members → locked chips (no remove), non-repo members ignored, `default`/archived projects not offered; rapid switching discards the stale answer; failed lookup → no chips, `projectId` still rides | `tests/TestingLaunch.test.tsx` |
| T7 | explicit ∩ project | attach first → one locked chip while selected, picker excludes it, explicit chip + remove after clearing; wire: `repoRefs` alone when cleared, `projectId + repoRefs` while selected (union dedupes server-side) | `tests/TestingLaunch.test.tsx` |
| T8 | picker | name OR id, case-insensitive, cap 8, miss/blank → no list; attached + project-carried excluded; picking clears the query | `tests/TestingLaunch.test.tsx` |
| T9 | unscoped opt-in | visible iff unscoped; attaching / selecting hides it; removing / clearing brings it back UNCHECKED | `tests/TestingLaunch.test.tsx` |
| T10 | submit gating | whitespace brief never launches; scope OR opt-in; consent lost with scope; double click → ONE POST, `onLaunched` once, "Launching…" disabled; failed launch → live form, retry clears the error | `tests/TestingLaunch.test.tsx` |
| T11 | zero-repo project | absent while resolving, shown for no `crew.repo` member, cleared by an explicit attachment which rides the union | `tests/TestingLaunch.test.tsx` |
| T12 | `initialProjectId` | pre-selected once the option loads, repos resolved, wire without a click; an inactive id still rides verbatim (daemon is the authority) | `tests/TestingLaunch.test.tsx`, `tests/ProjectCampaignsView.test.tsx` |
| T13 | route wiring | `useRoute('/p/:id/campaigns')` → `{projectId, campaignsView:true, mode:null}`; `ProjectCampaignsView` frames the landing, crumb "Tests", back door, pre-selects the project | `tests/ProjectCampaignsView.test.tsx` |
| T14 | fan-out | "N runs launched under <label>", one button per run, navigable; **no inline gate even when sibling gates arrive** | `tests/TestingLaunch.test.tsx` |
| T15 | fan-out, no label | "— one per attached codebase, under one test", no label element; non-string label = absent | `tests/TestingLaunch.test.tsx` |
| T16 | no run id | `{}`, `{runIds:[]}`, `{runId:''}`, `{runIds:[''],runId:''}` → error, `onLaunched` never fires, form live; multi-request answered with one id keeps the single-run flow | `tests/TestingLaunch.test.tsx` |
| T17 | single-run gate | the ONE `SteeringGate` with `data-run-id`, prompt in-band; unrelated gate ignored; gate-before-response renders once the id is known | `tests/TestingLaunch.test.tsx` |
| T18 | waiting | waiting line names the run (8-char prefix), no gate card | `tests/TestingLaunch.test.tsx` |
| T19 | decisions | wire: four `POST /runs/:id/gate` bodies + bodyless cancel, content type only with a body, encoded id, refusal → typed error; panel: each button → its decision exactly once → resolved copy with working doors; cancel resolves; refused decision keeps the gate up | `tests/gateWire.test.ts`, `tests/TestingLaunch.test.tsx` |
| T20 | named gap | `MULTI_SCOPE_UNSUPPORTED_COPY` rendered **verbatim** for multi-repo and project scopes on an old daemon; `/runs` never touched; form stays live | `tests/TestingLaunch.test.tsx` |
| T24 | landing states | probing (line alone, one `GET /campaigns`, no verbs) → page; 404 → unsupported copy with verbs usable; 200 empty → "no tests yet" + CTA; 200 populated → KPIs + strip + grid | `tests/CampaignsPage.test.tsx` |
| — | `?new=` intent | `campaign`/`recon` open the panel and consume the query with one `replace`; plain arrival opens nothing; honored on an unsupported daemon; toggles with the verb; rail ＋ → `?new=test`, "Run recon" row → `?new=recon`; `readLaunchIntent` rejects bare/foreign/backend-worded values | `tests/CampaignsPage.test.tsx`, `tests/LeftSidebar.rail.test.tsx`, `tests/testingRoutes.test.tsx` |
| T30 | rename consistency | every rendered string (text + `title`/`aria-label`/`placeholder`) on: the Test rail heading (title, ▦/＋ labels, Run recon row), the project-shell crumb, the chat group-attach chip, the scoreboard not-found / loading / attached-row tooltip, the panel's fan-out and resolved copy, the landing's probing / unsupported / nothing-matches / older-chip copy, the Needs-You row + verb, `TESTING_UNSUPPORTED_COPY` | `tests/renameConsistency.test.tsx`, `tests/renameGuard.ts`, `tests/needsYou.test.ts`, `tests/LeftSidebar.rail.test.tsx` |

T30's guard (`expectTestVocabulary`) is scoped to product copy: fixture ids are chosen without the
word (`suite-1`, `r-1`), because a daemon-minted id or a user-authored title may legitimately say
"campaign".

## 4. Layer 2 — curl probes (documented next steps, non-launching)

**Daemon fixtures.** Always a DISPOSABLE daemon on a free port with a temp data dir — never
`:7701`, never `~/.wicked-crew`. `CURRENT` = the installed `wicked-crew` (0.7.25 at time of
writing). `OLD` = any release predating `POST /testing/recon`; the T21 probe itself is the
version check (you do not need to know the number in advance).

**Why these bodies.** A launch POST with a *valid* body starts a governed run. Every probe below
sends a body the route's zod **rejects** (or a GET), so a present route answers **400 naming the
field** and an absent route answers the **bare 404** — presence is decided without launching
anything.

```bash
HOST=http://127.0.0.1:$PORT   # the disposable daemon
probe() {  # method path body → prints "<status>" then the captured body
  local body; body=$(mktemp)
  local code; code=$(curl -s -o "$body" -w '%{http_code}' -X "$1" "$HOST/api/v1$2" \
    -H 'content-type: application/json' ${3:+-d "$3"})
  echo "$code"; cat "$body"; echo; rm -f "$body"
}
```

| id | command | OLD daemon | CURRENT daemon | proves |
|---|---|---|---|---|
| T21 | `probe POST /testing/recon '{}'` | `404` + `{"error":"Not Found"}` (headless) or `{"error":"not found"}` (bundled SPA handler) — the exact spellings `isRouteAbsent` matches | `400` naming `problem` (route present, zod refused, **nothing launched**) | the presence-gate discriminator, both spellings |
| T22 | `probe POST /runs '{"problem":"x","repoRefs":["r"]}'` then `probe POST /runs '{"repoRef":1}'` | `400 Unrecognized key(s) … 'repoRefs'` and `400` on the `repoRef` type — the strict zod that *forces* the legacy spelling | same (the legacy route keeps its zod) | why the fallback composes `repoRef`, never the pinned keys. **The client fallback itself is proven by T4c**, not by curl. |
| T23 | `probe GET /campaigns` | `404` bare | `200` with `campaigns: []`-or-rows; `groups` MAY be absent (the client normalises, `src/api/campaigns.ts`) | the `campaigns-unsupported` vs `campaigns-page` fork (T24's fixture is real) |

Assert T23's shape with `python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d["campaigns"], list); assert "groups" not in d or isinstance(d["groups"], list)'`.

## 5. Layer 3 — governed runs (documented next steps; exactly ONE at a time)

Each of these spawns a council. Serialize them; a disposable daemon needs a signed-in worker CLI
or the run stalls — record that as skipped-with-reason, never as a pass.

- **T25 — "Run recon" → intake gate.** From `/testing/campaigns`, "Run recon", attach 1 repo,
  submit. Wait for the `awaitingHuman` frame for the returned run id on `/ws` (the store key,
  `src/store/gates.ts`), **not** the `awaiting_human` session status. Assert: `steering-gate`
  with that `data-run-id` inside `testing-launch-panel`; the prompt is rendered in `steering-prompt`
  (if it contains `[`, the tail is in the collapsed disclosure — expand and check the plan text is
  readable). **Do not assume the prompt starts with `RECON_PROBLEM_PREFIX`** — no contract says
  so (crew#473: the recon gate is pre-execution; the plan may not be present at all — that is a
  finding, not a test failure). Execution boundary evidence: `GET /runs/:id/units` shows no unit
  past the gate before the decision; after **reject** (`{approve:false}`) the run reaches a
  terminal status and spawns nothing further. Reject, do not approve, so no council executes.
- **T26 — "New test" fan-out.** ≥ 2 registered repos, "New test", attach both, submit. Assert the
  real `POST /testing/recon` response has `runIds.length === 2` (+ `campaign` label), the panel
  renders T14's fan-out (buttons, not links), **no inline gate**. Then, per sibling: navigate to
  `/runs/:id`, wait for its own `awaitingHuman`, correlate the gate's run id, reject it. The
  campaign appears on the landing grid after `refresh`. Nothing is approved.
- **T27 — project-scoped launch.** The deterministic half (pre-selection, via-project chips,
  `projectId`-only body) is T12/T13. The governed half: from `/p/:id` → `dashboard-campaigns` →
  "New test" → submit → the daemon resolves the project's repos server-side (the response's
  `runIds` count equals the project's `crew.repo` member count). Reject at the gate.

## 6. Layer 4 — Playwright (documented next steps)

- **T28 — panel accordion.** `testing-recon-open` / `testing-author-open` /
  `testing-campaign-open` are one-at-a-time (`aria-expanded`); the launch panels close via
  `testing-launch-close`, "Add with chat" via **`steering-author-close`**. Also: arriving at
  `/testing/campaigns?new=test` shows the New-test panel open and the address is `/testing/campaigns`
  afterwards (consumed; Back does not re-open it).
- **T29 — fan-out navigation.** Use the T26 run (governed setup, labelled) or a recorded
  fixture. Click a `testing-launch-fanout-run` **button**; assert the run id in the URL and, for a
  project-filed run, the **canonical** `/p/:projectId/build/:id` after `useLegacyRedirect` — not
  the initial `/runs/:id`.

## 7. Rename inventory (wicked-studio#203) — all fixed

| # | where (before this change) | was | now |
|---|---|---|---|
| 1 | `LeftSidebar.tsx` `P_TEST.noun` → ＋ `aria-label`/`title` | New Campaign | New Test |
| 2 | project-shell crumb (`App.tsx` → `ProjectCampaignsView.tsx`) | Campaigns | Tests |
| 3 | `ChatInput.tsx` group-attach pill | Campaign: … | Test: … |
| 4 | `board/needsYou.ts` row text | Campaign gaps — … | Test gaps — … |
| 5 | `board/needsYou.ts` row action | Open campaign › | Open test › |
| 6 | `CampaignScoreboard.tsx` not-found copy | No campaign is filed … a campaign appears … | No test is filed … a test appears … |
| 7 | `CampaignScoreboard.tsx` not-found link | All campaigns | All tests |
| 8 | `TestingLaunchPanel.tsx` fan-out footer | the campaign's progress | the test's progress |
| 9 | `TestingLaunchPanel.tsx` resolved copy | the campaign's progress | the test's progress |
| 10 | `TestingLaunchPanel.tsx` resolved link | Campaigns | Tests |
| 11 | `CampaignsPage.tsx` probing | Checking this daemon for campaigns… | …for tests… |
| 12 | `CampaignsPage.tsx` unsupported | no campaign surface … predates campaign grouping … effort's | no test surface … predates test grouping … test's |
| 13 | `CampaignScoreboard.tsx` loading | Loading campaign … | Loading test … |
| 14 | `CampaignScoreboard.tsx` attached-row tooltip | Filed onto this campaign … the campaign never … | Filed onto this test … the test never … |
| 15 | `api/testing.ts` `TESTING_UNSUPPORTED_COPY` | The Campaigns surface still works. | The Test surface still works. |

Also swept while T30 was written: `CampaignsPage.tsx` "+N older" chip title (`N campaign(s)` →
`N test(s)`) and the "No campaigns match" line (→ "No tests match").

**Rail ＋ behavior (separate finding).** The ＋ navigated to the landing with no panel open. It now
lands on `/testing/campaigns?new=test` and the landing opens the New-test panel; the "Run recon"
row lands on `?new=recon`. Testids unchanged except `project-campaigns-crumb` (new);
`testid-inventory.json` regenerated.

## 8. Dependencies

T1–T3 (pure folds) → T4 (the gate) → T5, T14–T20 (panel-level launch). T6 → T7, T11. T12/T13
→ T27. T18 → T17 → T19. The whole deterministic layer must be green before spending daemon time
on T21–T23 (curl) or T25–T29 (governed / Playwright) — a governed failure is hard to attribute if
the cheap checks are not.

## 9. Open questions surfaced while executing (not asserted, filed as follow-ups)

- **Panel state across intents.** `CampaignsPage` renders one unkeyed `TestingLaunchPanel` for
  both verbs, so switching Run recon ↔ New test keeps the brief, scope, error and *launched* state
  under the other title. Keying the panel by intent (`key={panel}`) would give a fresh panel per
  verb. Product decision pending; no test pins either behavior.
- **Failed member lookup wording.** When `listProjectMembers` fails, the panel shows the
  zero-repo warning ("This project holds no repositories") — true for an empty project, misleading
  for an unreachable lookup. T6 asserts the wire (`projectId` still rides) and deliberately does
  not pin the warning.
- **Inactive `initialProjectId`.** An archived/unknown project id from a shell still rides the
  wire (T12 pins this as the honest behavior — the daemon's named 404 surfaces). The select shows
  "no project" while the state is scoped; a visible "project unavailable" hint would be clearer.
