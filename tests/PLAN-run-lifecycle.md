# Run-lifecycle test plan

Covers five surfaces that together span the full run lifecycle: launch form →
gate answering → archive/unarchive, plus the two supporting pickers (project
switcher and repo onboarding). Every scenario in Areas 1–5 is a **deterministic
tool check** (vitest + jsdom mocks, no live daemon) — a governed agent run
would only be appropriate if the scenario required a non-deterministic AI
decision during the test itself, which none of these do. Area 6 collects the
**functional browser** scenarios, run as Desk journeys in CI (#312).

Legend: **covered** = already in an existing test file; **new** = implemented
in `tests/run-lifecycle.test.tsx` by this plan; **not implemented** = specified
only, nothing in the tree runs it.

---

## Area 1 — Launch-form validation

Source: `tests/TestingLaunch.test.tsx` + `tests/testingLaunch.wire.test.ts`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| LF-1 | Submit disabled until a non-whitespace brief is typed | deterministic | covered (T10) |
| LF-2 | Submit disabled until scope is chosen (repo, project, or unscoped opt-in) | deterministic | covered (T10) |
| LF-3 | Double-click sends exactly one launch; button shows "Launching…" and is disabled in flight | deterministic | covered (T10) |
| LF-4 | Failed launch leaves the form live with the daemon's error sentence; retry clears it | deterministic | covered (T10) |
| LF-5 | Brief is trimmed before framing as `<prefix>\n\n<brief>` | deterministic | covered (T5) |
| LF-6 | Unscoped opt-in checkbox visible only when no repo or project scope is selected | deterministic | covered (T9) |
| LF-7 | Project-only scope: locked chips show the project's repos; wire sends `projectId` alone | deterministic | covered (T5/T6) |
| LF-8 | Explicit repos: wire sends `repoRefs` in attach order; no `projectId` key | deterministic | covered (T5) |
| LF-9 | Zero-repo project warning shown for a project with no `crew.repo` member | deterministic | covered (T11) |
| LF-10 | Rapid project switch: late member response for the prior project is discarded | deterministic | covered (T6) |

---

## Area 2 — Gate answering

Source: `tests/SteeringGate.test.tsx`, `tests/SteeringGate.keys.test.tsx`,
`tests/SteeringGate.prepopulate.test.tsx`, `tests/SteeringGate.rejectNote.test.tsx`,
`tests/SteeringGate.verdict.test.tsx`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| GA-1 | Approve → `confirmGate(id, {approve:true})`; `onResolved` fires once | deterministic | covered |
| GA-2 | Approve + steer → `confirmGate` with `{approve:true, amend}`; steer button disabled until text present | deterministic | covered |
| GA-3 | Reject → `confirmGate(id, {approve:false})` | deterministic | covered |
| GA-4 | Cancel run → `cancelRun(id)`; `confirmGate` not called | deterministic | covered |
| GA-5 | Failed `confirmGate` (API error): gate stays open, error text shown, `onResolved` not called | deterministic | covered (T19) |
| GA-6 | Failed `cancelRun` (API error): gate stays open, error text shown, `onResolved` not called | deterministic | **new** |

---

## Area 3 — Archive / Unarchive

Source: `tests/WorkPage.archived.test.tsx`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| AU-1 | Archived chip off by default: no fetch, no archived group in the DOM | deterministic | covered |
| AU-2 | Chip ON: fetches full list, shows only the archived remainder | deterministic | covered |
| AU-3 | Unarchive success: `archiveRun(id, false)` called; row removed optimistically | deterministic | covered |
| AU-4 | Unarchive failure: `archiveRun` rejects → row stays visible (silent fail by design) | deterministic | **new** |
| AU-5 | Chip OFF: archived group disappears; normal list remains visible | deterministic | **new** |

---

## Area 4 — Project switcher

Source: `tests/ProjectSwitcher.test.tsx` (field variant),
`tests/ProjectSwitcher.crumb.test.tsx` (crumb variant + keyboard repair)

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| PS-1 | Defaults to Unfiled; click opens list with project rows and the Unfiled option | deterministic | covered |
| PS-2 | Select a project → `onSelect(id)`; Unfiled → `onSelect(null)` | deterministic | covered |
| PS-3 | Filter by name narrows the list | deterministic | covered |
| PS-4 | "+ New project" calls `onNewProject` and closes the list | deterministic | covered |
| PS-5 | Locked: `data-locked="true"`, click does not open the list | deterministic | covered |
| PS-6 | `onOpen` fires on open only — not on mount, not on close | deterministic | covered |
| PS-7 | `dropUp`: list renders above the field | deterministic | covered |
| PS-8 | Crumb variant: no Unfiled row, current project marked ✓, dashboard row is a real link | deterministic | covered |
| PS-9 | Keyboard: ArrowDown/Up walk real DOM focus; Escape closes and restores trigger | deterministic | covered |

---

## Area 5 — Repo onboarding form

Source: `tests/RepositoriesPanel.project.test.tsx`,
`tests/RepositoriesPanel.dashboard.test.tsx`

| ID | Scenario | Kind | Status |
|----|----------|------|--------|
| RO-1 | Register & onboard disabled when **neither** field is filled | deterministic | **new** |
| RO-2 | Register & onboard disabled when path is empty (name present) | deterministic | **new** |
| RO-3 | Register & onboard enabled when both name and path are filled | deterministic | **new** |
| RO-4 | Unfiled (default): `registerRepo(name, path)` called; no `attachProjectMember` | deterministic | covered |
| RO-5 | Selected project: `attachProjectMember` called after `registerRepo`; navigates to repo detail | deterministic | covered |
| RO-6 | `ambientProject` pre-binds and locks the project field immediately; clicking the field does not open the dropdown | deterministic | **new** |

**RO-1 note — why it is "neither field filled" and not "name empty, path present".**
RO-1 was originally specified as *name empty while the path is present*, which cannot
be produced by typing in the form: the path input's `onChange` calls `deriveName`
(`src/components/RepositoriesPanel.tsx:579` → `:194`), which fills the name from the
last path segment unless the user has already edited the name field
(`nameEditedRef`). Since `canSubmit` is `newName.trim() && newPath.trim()`
(`:328-330`), entering a path makes the name non-empty in the same keystroke, so the
originally-specified state is unreachable through the UI. The shipped test therefore
asserts the reachable disabled state — **neither field filled** — and RO-2 covers the
other half (name present, path empty), which *is* reachable because typing a name sets
`nameEditedRef` and suppresses the derive.

---

## Area 6 — Functional browser scenarios (revived, CI-wired — #312)

The suite was written for the run page, which is gone; it was revived on the session thread as
`e2e/desk_run_lifecycle_test.py`, listed in `DESK_ONLY` (`e2e/run_journeys.py`), so CI's journey
shards run it on every PR.

| ID | Scenario | Where | Status |
|---|---|---|---|
| LC-1 | Launch-form validation: Send disabled with no problem, enabled with a problem and a repository; Send POSTs `/runs` | `desk_run_lifecycle` | **runs in CI** |
| LC-2 | Gate answering on `/s/run:<id>`: the POST leaves no earlier than the 10 s undo window (timed from before the click to the request), exactly one `{approve: true, ord}`, and the settled receipt (polled). Re-specified: the old "card detaches" assertion was wrong for a status-driven surface, the proof is the wire | `desk_run_lifecycle` | **runs in CI** |
| LC-3 | Archived lens lists the archived run; Unarchive re-reads the list | `desk_everything_archive` (steps 2–3; the Everything page replaced the Work board's chip) | **runs in CI** |
| LC-4 | Lens switching: All shows a live run and not the archived one; Archived shows it; back on All it is gone and the live runs stay | `desk_run_lifecycle` | **runs in CI** |
| LC-5 | Repo register form: disabled until name and path; submit POSTs `/repos {name, rootPath}` and lands on the new repo's `/repo-detail/my-repo` page (not "Repo not found") | `desk_run_lifecycle` | **runs in CI** |

---

## Implementation notes

New scenarios (GA-6, AU-4, AU-5, RO-1, RO-2, RO-3, RO-6) are implemented in
`tests/run-lifecycle.test.tsx` using the repo convention: vitest globals,
`@testing-library/react`, `userEvent.setup()` for interactions, `waitFor` for
async assertions — no sleeps, no fixed waits. Each test asserts a concrete
outcome on a real DOM node.

The Area 6 scenarios (LC-1…LC-5) run in CI — see the table above (#312).
