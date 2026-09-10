# LT-2 — run f8bc2bad-47fc-4971-8961-bb49acb1dc6b (campaign)

POST body:
```json
{
 "problem": "New test: plan the test for the attached scope \u2014 the scenarios, their dependencies, and which are deterministic tool checks vs governed agent runs \u2014 and run the approved plan as governed sibling runs under one test. Present the plan at the intake gate and launch nothing until it is approved.\n\nSurvey wicked-studio at its current main and propose a test plan covering its live /ws CoreEvent fold (awaitingHuman, unitPlanned, sessionCompleted frames), the /api/v1 routes it calls (runs, campaigns, testing/recon, projects, repos), its CLI entry points, and its UI pages (/testing/campaigns, /runs/:id, /steering, the home deck), naming the real source files behind each scenario and classifying each as a deterministic tool check or a governed agent run",
 "repoRefs": [
  "wicked-studio"
 ]
}
```

## unit 1

_verbatim from `GET /runs/:id/units/1/output` — 653 chars_

I don't see an actual scope attached to this message — I only have the worktree layout and the external-transform convention note, but no description of the feature/change/PR that needs test scenarios planned.

Could you point me to the actual scope? For example:
- A PR number or branch diff to test
- A feature/design doc (e.g. something under `.product/`)
- A specific set of files/changes you want scenario coverage for

Once I know what's being tested, I can break it into scenarios, mark dependencies, classify each as a deterministic tool check vs. a governed agent run, and then execute the approved plan as governed sibling runs under one test.

## unit 2

_verbatim from `GET /runs/:id/units/2/output` — 1872 chars_

I confirmed the prior phase's finding independently. There is no scope to plan against.

**Intake gate: BLOCKED — no testable scope determinable**

What I checked in the worktree:

- **Working tree:** clean — `nothing to commit`
- **Branch vs. main:** `wicked/f8bc2bad-…` is at commit `b30000f`, *identical* to `main`/`origin/main`. `git diff main..HEAD` is empty; `git log main..HEAD` is empty.
- **No uncommitted changes, no staged changes, no branch-local commits.**
- **No scope artifact:** the run message carries only the worktree layout + the external-transform convention note. No PR number, no feature/design doc reference, no file list.

There is literally no change, feature, or PR delta for me to derive test scenarios from. The prior phase (unit 1) reached the same conclusion and asked for the scope; that request was not answered — so nothing has changed that would let me proceed.

Per the run's own instruction ("Present the plan at the intake gate and launch nothing until it is approved"), and because a plan cannot be authored without a subject, **I am launching nothing** and holding at the gate.

To unblock, point me at one of:
- **A PR number or branch diff** (something with an actual code delta — this branch has none vs. main)
- **A design/brief doc** under `.product/` (e.g. `DES-HOME-COMMAND-CENTER.md`, `DES-CAMPAIGN-001.md`, `BRIEF-UX-001.md`) if the intent is to test an *already-merged* surface against its spec
- **An explicit file/change set** you want scenario coverage for

Once I have a subject, I'll break it into scenarios, mark inter-scenario dependencies, classify each as a deterministic tool check vs. a governed agent run, present that plan here at the gate, and launch the approved scenarios as governed sibling runs under one test.

No `ASSUMPTION[external-transform]` lines apply — there is no work being reasoned about yet.

## unit 3

_verbatim from `GET /runs/:id/units/3/output` — 5508 chars_

I'll survey the actual source tree to find the real files behind each area before drafting the plan.## Survey result

wicked-studio at `main` (`b30000f`) is a pure HTTP/WS client SPA — 237 existing vitest files, no server code, no bin/CLI package. Backed up by file reads, not guesses:

| Area | Real source | Notes |
|---|---|---|
| WS fold | `src/hooks/useEventStream.ts`, `src/App.tsx` (`handleEvent`, `LIFECYCLE_EVENTS`), `src/store/{gates,runtime,events,campaigns,annotations,elicitations,notifications,docThread,liveChats}.ts`, `src/hooks/useRuns.ts` | `awaitingHuman` opens/closes in `store/gates.ts`; `unitPlanned`/`sessionCompleted` are both in `App.tsx`'s `LIFECYCLE_EVENTS` (trigger a debounced `GET /runs`) and in `store/runtime.ts`'s `summarize()` |
| API routes | `src/api/client.ts` (runs/repos/projects/chats/terminals/workflows/governance/settings), `src/api/campaigns.ts` (`/campaigns`, `/campaigns/:id`, `/runs/:id/acceptance`), `src/api/testing.ts` (`/testing/recon`, `/testing/evals*`, `/testing/corpora/import`) | `campaigns.ts` and `testing.ts` both self-flag as **TEMPORARY hand-mirrors** of `wicked-crew-api-types` pending a version bump — worth auditing for drift |
| CLI entry points | `package.json` scripts (`dev/build/typecheck/lint/test/manifest:testids/prepare`), `e2e/*.py` (58 Playwright scripts) | No `bin` field — studio ships no binary. `e2e/studio_standalone_test.py` is the actual sanctioned CLI-driven gate per `.product/TEST-001-test-strategy.md` §4 (operator-run, requires a live `wicked-crew serve` daemon) |
| UI pages | `/testing/campaigns` → `CampaignsPage.tsx`; `/runs/:id` → `ChatPanel.tsx` (via `App.tsx:364`); `/steering` → `SteeringPage.tsx`; home deck → `HomeBoard.tsx`/`CenterDashboard.tsx` | Confirmed by `useRoute.ts` panel parsing + `App.tsx` render branches |

No third-party payload-transforming service is involved anywhere in this scope (the only "mirrors" are studio's own hand-copies of an internal wire-contract package, not an external transform) — no `ASSUMPTION[external-transform]` lines apply.

## Proposed test plan (scenarios, dependencies, classification)

**Group 1 — WS CoreEvent fold**
- 1.1 `[TOOL]` Audit existing coverage of `App.tsx`'s fan-out: `tests/events-hydrate.test.ts`, `events-merge.test.ts`, `runtime.store.test.ts`, `HomeBoard.live.test.tsx`, `needsYou.test.ts`, `RunDelivery.stranded.test.tsx`, `GroupChat.narrated.test.tsx`, `desktopNotify.test.ts`.
- 1.2 `[TOOL]` Gap check: no `gates.store.test.ts` found in `tests/` — confirm `awaitingHuman`'s `choicesOf` parsing and `approaching`-clear logic (`src/store/gates.ts`) is actually unit-tested; write it if not.
- 1.3 `[TOOL]` Confirm `unitPlanned`'s dual effect (runtime log line + `LIFECYCLE_EVENTS`-triggered debounced `GET /runs` in `useRuns.ts`) is covered.
- 1.4 `[TOOL]` Confirm `sessionCompleted` gate-clear + terminal UI state via `RunTimeline.test.tsx`.
- 1.5 `[AGENT]` Live-wire proof: drive a real governed run through `awaitingHuman → approve → sessionCompleted` against a live daemon and assert each frame lands in the UI. *Depends on: a live `wicked-crew serve` + one real governed run.*

**Group 2 — `/api/v1` routes**
- 2.1 `[TOOL]` Diff `campaigns.ts`/`testing.ts`'s self-flagged TEMPORARY mirrors against the currently-shipped `wicked-crew-api-types` version for drift.
- 2.2 `[TOOL]` Confirm each named route has mocked-fetch unit coverage: `client.resolver.test.ts`, `clientFiles.test.ts`, `testingRoutes.test.ts`, `steeringRoutes.test.ts`, `memoryApi.test.ts`, `proposalsApi.test.ts`, `campaigns.store.test.ts`.
- 2.3 `[AGENT]` Live route probe (`GET /health,/runs,/campaigns,/repos,/projects`, real `POST /testing/recon` launch) against a live daemon. *Same daemon/run as 1.5 — no separate spin-up needed.*

**Group 3 — CLI entry points**
- 3.1 `[TOOL]` Run each `package.json` script (`build`, `typecheck`, `lint`, `test`, `manifest:testids`, `prepare`) locally — no daemon.
- 3.2 `[AGENT]` `python3 e2e/studio_standalone_test.py` — the actual release-gate CLI script; builds studio alone, serves `dist/` standalone, points it at a live daemon via `VITE_API_HOST`, drives a real governed run through Playwright. *Same governed run as 1.5/2.3.*
- 3.3 `[TOOL]` Staleness audit of the other ~57 `e2e/*.py` slice scripts (read-only, no execution).

**Group 4 — UI pages**
- 4.1 `[TOOL]` Route-level unit coverage: `/testing/campaigns` → `CampaignsPage.test.tsx`, `CampaignScoreboard.test.tsx`, `TestingLaunch.test.tsx`; `/runs/:id` → `ChatPanel.*.test.tsx`, `RunTimeline.test.tsx`; `/steering` → `SteeringPage*.test.tsx`, `SteeringGate*.test.tsx`, `SteeringGrid.test.tsx`; home deck → `HomeBoard.*.test.tsx`, `CenterDashboard.*.test.tsx`.
- 4.2 `[AGENT]` Cross-page live walkthrough of one governed run's lifecycle (home deck → `/runs/:id` mid-run → gate approve → rollup on `/testing/campaigns` → `/steering` untouched). *Same governed run as 1.5/2.3/3.2 — this is what `studio_standalone_test.py` §8–10 already targets.*

**Net dependency structure:** all `[TOOL]` scenarios (1.1–1.4, 2.1–2.2, 3.1, 3.3, 4.1) are independent, need no daemon, and can run immediately. All `[AGENT]` scenarios (1.5, 2.3, 3.2, 4.2) collapse onto **one** live-daemon governed run — they're facets of the same `studio_standalone_test.py` execution, not four separate runs.

Holding at the gate — launching nothing until you approve. Want me to run the `[TOOL]` checks now and launch a single governed sibling run for the `[AGENT]` scenarios, or adjust the scope first?
