# DES-UXFIX-001 — Slice 2 experience-checklist verdicts (§4.1)

**Slice:** 2 — card variants + empty-state budget + differentiated actions
**Date:** 2026-08-20
**Build:** branch `uxfix/slice-2-card-variants` (on top of slice 1, `3893e71`)
**Rig:** `e2e/uxfix_slice2_test.py` — the W2 messy-reality fixture (§4.2) served by
the deterministic fixture server (same pattern as the slice-1 rig), captured per
the §4.0 contract: 1440×900, `device_scale_factor=1`, every capture waits on a
`data-testid`, never a sleep. The DOM ACs backing each verdict all passed in the
same run (JSON report printed by the rig; `banned_strings_found: []`,
`clipped_cards: []`).

**Screenshots judged** (uncommitted evidence, `e2e/shots/uxfix/`):

| Scene | File |
|---|---|
| ACTIVE card (q3-review-deck: gate pill, live line, answerable chip) | `uxfix-2-active-card.png` |
| QUIET card (smoke-tests: one line + compact actions) | `uxfix-2-quiet-card.png` |
| First-run card (scratch: invitation + four differentiated verbs) | `uxfix-2-actions.png` |

Judged from the pixels alone, per §4.1 ("if you cannot tell from the image, it
fails").

---

## EC1 — one obvious next action · **PASS**

On the first-run card (`uxfix-2-actions.png`), the invitation — *"Start by
describing what you want →"* — is the single accent-coloured (yellow), bolded
element on the card; it is unambiguously the thing to click. The four mode
actions sit below it as visibly subordinate muted boxes with faint sublabels.
Nothing else on the card competes. On the quiet card the summary line is plain
and the compact actions are uniform — no false primary is manufactured where
none exists.

## EC2 — absence is at most one line · **PASS**

- The quiet card (`uxfix-2-quiet-card.png`) is exactly one line of absence —
  *"Quiet — last active 6d ago"* — plus the compact action row. Nothing else.
  The card is one-line tall (~64px rendered), not a 352px shell of three
  "nothing" regions.
- The active card (`uxfix-2-active-card.png`) shows ZERO absence lines:
  q3-review-deck has no documents and its Documents region is simply not there
  — omitted, not narrated. No "No documents yet", "Nothing running", or
  "No runs yet" appears in any capture (the rig asserts the strings are absent
  from the whole page text, and passed).
- The first-run card's single line is the invitation — §2.1.2's one sanctioned
  exception, still one line.

## EC6 — verbs are differentiable · **PASS**

The four actions read as four different things in every capture: each carries
its own glyph (💬 ⚙ ▤ ▶ — the same four the mode switcher uses) and a mode name
(Chat / Build / Document / Video), and on the first-run card each also carries a
producing-artifact sublabel ("think out loud with an agent" / "ship code, with
checks" / "a deck, page, or report" / "record a demo"). None of the labels are
near-synonyms; "New chat" vs "Do work" is gone. The DOM AC backing this
(distinct `data-mode`, labels matching `MODE_SPECS`) passed on every mounted
card.

---

## Notes / caveats (honest, not blocking)

1. Two first-run sublabels ellipsise at the fixture's 3-column card width
   ("think out loud with a…", "a deck, page, …"). The full text survives on
   hover (`title`) and the verbs stay differentiable via glyph + label, so EC6
   holds — but a narrower board will truncate more.
2. Cards are content-sized inside fixed windowing slots, so a NEEDS YOU band of
   short cards shows slot whitespace *between* bands (visible in
   `uxfix-1-messy-board.png`). That whitespace is layout air, not absence copy
   — EC2 is judged on "nothing" lines, and there are none — but a later slice
   could tighten band offsets if it grates.
3. The first-run invitation is gated on `created_at` newer than 24h
   (`FIRST_RUN_MS`): an empty project older than that reads as debris
   ("Quiet — last active Nd ago"), per W2. The 24h window is a defensible
   default, not a measured one.
