# DES-UXFIX-001 — Slice 5 experience-checklist verdicts (§4.1)

**Slice:** 5 — Build purpose + fold the dead shells
**Date:** 2026-08-20
**Build:** branch `uxfix/slice-5-build-purpose` (on top of slice 4, `772c112`; production
commit `19a848e`)
**Rig:** `e2e/uxfix_slice5_test.py` — the shared W2 fixture server (`uxfix_fixture.py`,
extended with three default-off switches: `no_runs`, `usage_ws`, `long_prompt` — the
slice-1..4 rigs see the exact fixture they always saw), captured per the §4.0 contract:
1440×900, `device_scale_factor=1`, every capture waits on a `data-testid`, never a
sleep. The DOM ACs backing each verdict all passed in the same run (JSON report printed
by the rig: `build-purpose` non-empty on an empty project, zero `campaign-dag-stub`
testids, zero `—` characters on the surface in BOTH scenes, every row title carrying the
full prompt while its text carries the truncated intent, footer
`3 steps in flight · $0.42 · 98.0k tokens` only after a real `cliUsage` frame), and the
slice-1, slice-2, slice-3 AND slice-4 rigs were re-run against this exact
`dist-sameorigin` build — all green, no regression. Full vitest suite: 84 files /
795 tests green (16 of them the new `CenterDashboard.build.test.tsx`); lint and
typecheck clean.

**Screenshots judged** (uncommitted evidence, `e2e/shots/uxfix/`):

| Scene | File |
|---|---|
| Empty Build: purpose first, one primary action | `uxfix-5-build-empty.png` |
| Build with work: gate inbox + the ONE intent-labelled runs list | `uxfix-5-build-runs.png` |

Judged from the pixels alone, per §4.1 ("if you cannot tell from the image, it fails").

---

## EC2 — absence is at most one line · **PASS**

- **The empty Build shows ZERO lines of absence.** In `uxfix-5-build-empty.png` the
  surface is: the purpose statement, then `+ Build something`. No "No work sessions
  yet", no "No chats yet", no "Campaigns are coming", no stat row of `—` — the four
  absences the old three-panel home printed simultaneously. The runs region is
  *omitted*, not filled (§2.1.2 applied to a surface); the purpose statement IS the
  empty state (§3.4: "purpose is the empty state").
- **The em-dash stat hero is gone in both shots.** The old first-thing-on-the-surface
  was `Cost — / Tokens —` (F7's most literal complaint). In the working shot the stats
  survive only as a one-line footer under the runs (asserted in the DOM in the same
  run: present with data, absent without; it sits below the fold here — see caveat 1),
  and neither image contains a single `—` placeholder.
- **The Chats and Campaigns shells are simply not there** — nothing occupies their old
  columns; the runs list spans the surface. Absence of a feature no longer costs
  pixels.

## EC7 — the surface teaches itself · **PASS**

- **Build states what Build IS, in one breath, before any content.** Both shots lead
  with *"Build runs governed code work: an agent writes, an independent check grades,
  and you approve the gates. Everything it does lands as evidence."* — the write /
  independent check / gates / evidence quartet of §2.7 rule 1, readable in the image
  without hovering anything. A newcomer can now answer F7's failing question ("what is
  Build?") from the first two lines of the surface.
- **The one action is the mode's own verb** (V9): the single accent-filled control
  reads `+ Build something` — not "Do Work" — and in the empty shot it is the only
  filled control on the surface (the rig's accent census: exactly 1 inside
  `build-dashboard`), so what-to-do-next and what-this-mode-is are the same lesson.
- **Rows teach their state in user words.** `working · phase 1/1`, `gate · needs you`,
  `done`, `failed · at phase 1` — the `planning → working → done` vocabulary of V3;
  the rig asserts the strings `executing`/`distributing`/`awaiting_human` appear in no
  row. Runs are named by INTENT ("make the Q3 review deck", "add rate-limiting to the
  upload endpoint"), and the long-prompt run visibly truncates with the intent leading
  ("refactor the ingestion pipeline so that every incoming webhook payload…") — the
  raw-prompt labelling F7 flagged is gone from the pixels.

## EC10 — no banned state · **PASS**

- **No bare spinner, no bare "Working…", no whimsy, no error without a next action**
  anywhere in either shot. Failed runs render as `✕ <intent> failed · at phase 1` — a
  red *word with a subject* on a clickable row (the way in), not a bare red dot
  (asserted in the rig's row dump; those two rows sit just below the fold — caveat 1).
- **No inert shell teaches falsely.** The "Campaigns are coming" stub (V4 — an
  admission of unfinishedness dressed as a panel) appears in neither image and its
  testid no longer exists in the DOM; the dead `CampaignDagStub`/`InsightRail`
  components (zero consumers since the rail redesign) are deleted outright.
- **The gate inbox appears only when gates pend** — absent in the empty shot, present
  and answerable (`⏸ 2 gates need you`, Approve / Approve + steer / Reject per card)
  in the working shot, each card named by the run's intent. Nothing ambushes the empty
  state.

---

## Notes / caveats (honest, not blocking)

1. **The stats footer and the two terminal-row groups sit below the fold in
   `uxfix-5-build-runs.png`** — two full gate cards (both §4.2 gates are open in the
   fixture) push them past 900px. The footer's gating is a DOM AC, asserted in the
   same rig run (`3 steps in flight · $0.42 · 98.0k tokens`, and `null` without the
   usage frame); the visible portion carries all three mapped checklist items. In
   frame: both gate cards, three `working` rows and two `done` rows; the two `failed`
   rows are directly beneath the fold, captured verbatim in the rig's row dump.
2. **The gate inbox count reads "2 gates need you", not the wireframe's "1".** The
   §4.2 fixture holds two open gates (r-q3 SIMPLE + r-api COMPLEX) and the inbox
   self-heals both from `GET /runs/:id/gate` (useRuns' reconcile) — the wireframe's
   count is illustrative; the rule ("only if gates", rule 5) is what's asserted.
3. **The Build surface is still UNSCOPED to the routed project** (all runs show under
   `/p/q3-review-deck/build`). That is the pre-slice behavior, kept deliberately: the
   App.tsx comment pins scoping to the board's data plumbing so launch can file the
   run it creates; this slice changes labels/layout/purpose, not data flow (§4.4: "a
   sort/label/layout change over data that already flows").
4. **`phase k/n` is computed from the routed plan** (first not-done step, over the
   unit count) — with the fixture's one-unit plans it reads `phase 1/1`. A failed
   run's short reason renders only when the event store holds its `sessionFailed`
   frame (live or hydrated); the fixture's Build route has none, so those rows read
   `failed · at phase 1` — status + position, full prompt on the title, the row
   itself the way in.
5. **"2h ago" ages from the §2.7 wireframe are not rendered** — `AgentSession` has no
   timestamp on the wire (the same limitation `useTimeRange` documents), and
   fabricating one would violate the fixture's honesty rule. The wireframe's age
   column degrades to nothing rather than to a fake.
6. **Send-to-agents and the activity feed survive** (capability parity, §4.4) but are
   now omitted when idle and the feed is omitted when event-less — previously each
   printed its own absence line ("No active sessions", "Waiting for events…"). The
   steer placeholder no longer says "inject" (V15).
