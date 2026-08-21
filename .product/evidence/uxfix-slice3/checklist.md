# DES-UXFIX-001 — Slice 3 experience-checklist verdicts (§4.1)

**Slice:** 3 — rail to two taxonomies
**Date:** 2026-08-20
**Build:** branch `uxfix/slice-3-rail` (on top of slice 2, `49b7697`)
**Rig:** `e2e/uxfix_slice3_test.py` — the W2 messy-reality fixture (§4.2) served by
the SHARED deterministic fixture server (`e2e/uxfix_fixture.py`, extracted from
the slice-1/2 rigs per the slice-2 verifier's recommendation; both older rigs now
import it and stay green), captured per the §4.0 contract: 1440×900,
`device_scale_factor=1`, every capture waits on a `data-testid`, never a sleep.
The DOM ACs backing each verdict all passed in the same run (JSON report printed
by the rig; `rail_banned_strings_found: []`, `page_banned_strings_found: []`,
`rail_matches_board_needs_you: true`), and the slice-1 AND slice-2 rigs were
re-run against this exact build — both green, no regression.

**Screenshots judged** (uncommitted evidence, `e2e/shots/uxfix/`):

| Scene | File |
|---|---|
| The consolidated rail beside the settled W2 board | `uxfix-3-rail.png` |

Judged from the pixels alone, per §4.1 ("if you cannot tell from the image, it
fails").

---

## EC1 — one obvious next action · **PASS**

The BEFORE rail opened with three stacked, equal-weight, full-width creation
links — "Do Work" / "New Chat" / "New Repository" — three near-synonym primaries
competing before any content (F2's second occurrence). In `uxfix-3-rail.png`
that stack is gone: the creation verbs are ONE compact subordinate row
(`+ ⚙ Build  + 💬 Chat` / `+ Repository`), and the visually dominant element of
the rail is the PROJECTS list itself — whose top row, by decayed attention
order, is the gate-carrying `q3-review-deck` with the accent-yellow dot. The
rail now points at the same single next action the board leads with (enter the
project that needs you), instead of manufacturing three primary verbs of its
own. Secondary affordances ("view all", the search glyph, "All runs ›") are
visibly demoted: small, link-coloured, single-line. The one absence on the
surface ("No repositories yet") is one italic line — the empty-state budget
holds here too.

## EC7 — the surface teaches itself · **PASS**

Readable from the image alone:

- The two section labels name exactly what they hold — **PROJECTS ›** (a real
  list, colour-dotted by the same attention palette the board cards use, in the
  same order as the board's NEEDS YOU band: gate, gate, failed, working) and
  **REPOSITORIES** (with its search). Nothing else claims to be a taxonomy.
- The creation verbs are the mode spine's own words with the switcher's glyphs
  (⚙ Build, 💬 Chat) — the same four symbols meaning the same things everywhere
  (§1, §2.5 rule 4) — so the rail teaches by vocabulary the switcher already
  established, not by a second dialect ("Do Work" vs "New Chat" is gone; the
  rig asserts the strings appear nowhere on the page).
- **All runs ›** says precisely what the escape hatch is: the one flat list,
  behind one link, not two rail sections of visually identical truncated run
  items (F4). The Chats/Work sections — and their "No chats yet"/"No work yet"
  absence lines — appear nowhere (asserted against the rail's full text).
- The rail teaches the board's order by AGREEING with it: same axis, same
  colours, same top-four (the rig asserts rail order === board NEEDS YOU order
  from the same DOM, including the R3 trap — `legacy-spike`'s 8-day failure is
  in neither).

---

## Notes / caveats (honest, not blocking)

1. **The rail row's signal is colour + order only.** The board card pairs the
   dot with a pill word ("gate"/"failed"/"working"); the rail row carries just
   the dot and its position. A colour-blind operator still gets the ordering,
   and the board (one glance right) names the signal — but a later pass could
   add the pill word to the row's `title`.
2. **`useBoardModel` now mounts twice on `/`** (rail + board), so a home-route
   visit duplicates the projects/members/docs fetch set once. Deliberate for
   this slice — the rail needs the model on EVERY route, and hoisting one
   instance into `App` would churn `HomeBoard`'s contract; that hoist is the
   named cleanup if the duplication ever grates.
3. **Three loose selectors in the merged rigs were card-scoped**
   (`[data-project-id=…]` → `[data-testid="project-card"][data-project-id=…]`):
   the rail now legitimately carries `data-project-id` rows (it is the same
   axis — the point of the slice), which made the bare attribute ambiguous and
   had slice-2's gate-chip check matching the rail row. The assertions'
   subjects (the board cards) and semantics are unchanged; both rigs pass.
4. **The collapsed rail changed axis too**: it shows attention dots for the top
   projects (same order, same colours) instead of one dot per run — consistent
   with Chats/Work leaving the rail, but a behaviour change for anyone who used
   the collapsed strip as a run list. The runs remain one click away at
   `/runs`.
5. **Work items got their distinguishable labels in `RunLink`** (spine word +
   glyph, `data-kind`), which renders on `/work` and `/repo-detail` — the flat
   escape-hatch lists — not in the rail (the rail no longer lists runs at
   all, which is the design's stronger fix for F4).
