# DES-UXFIX-001 — Slice 6 experience-checklist verdicts (§4.1)

**Slice:** 6 — Document three-pane relationship + Themes
**Date:** 2026-08-20
**Build:** branch `uxfix/slice-6-document-panes` (on `main` at `772c112`, slices 1–4
merged; production commit `2180b5b`)
**Rig:** `e2e/uxfix_slice6_test.py` — the shared W2 fixture server (`uxfix_fixture.py`,
extended with the interactive document surface: preflight, themes, doc registry,
per-doc manifests, rendered version HTML, create/fork/events, frames relayed over the
same `/ws`; the board dataset and switches untouched), captured per the §4.0 contract:
1440×900, `device_scale_factor=1`, every capture waits on a `data-testid`, never a
sleep. The journey is W3's, driven through the REAL composer on the empty `scratch`
project: create a deck from a brief → v1 lands → continue → v2 lands.

The DOM ACs backing each verdict all passed in the same run with a NETWORK TAP
(JSON report printed by the rig): the strip's box measured extending under the thread
(`stripSpansUnderThread: true` from `getBoundingClientRect`), `thread-version-tag`
texts exactly `["▤ v1 landed", "▤ v2 landed"]`, strip-select at v1 focusing the
message the manifest's `meta.sourceMessageId` names (`focusedMessageId: dmsg-1` — the
id the client minted at submit, round-tripped through the fixture manifest; the
slice-9 regression guard), tag-click navigating to `?v=2`, `themes-explain` equal to
the V19 line verbatim, `theme library` appearing in ZERO testids and ZERO copy, and
the wire tap showing create/fork each carrying its `source_message_id` and the steer
riding `wicked.interactive.chat.posted`. The slice-1, slice-2, slice-3 AND slice-4
rigs were re-run against this exact `dist-sameorigin` build — all green, no
regression. Full vitest suite: 84 files / 792 tests green; lint and typecheck clean.

**Screenshots judged** (uncommitted evidence, `e2e/shots/uxfix/`):

| Scene | File |
|---|---|
| The three-pane surface, v1+v2 landed, spine spanning both | `uxfix-6-document.png` |
| v1 selected on the strip: canvas at v1, its message in view | `uxfix-6-version-crosslink.png` |
| The Themes panel open, explaining itself in one line | `uxfix-6-themes.png` |

Judged from the pixels alone, per §4.1 ("if you cannot tell from the image, it fails").

---

## EC7 — the surface teaches itself · **PASS**

Readable from the images alone:

- **The mode says what it is for without a hover.** Under the switcher in every shot,
  the active summary (slice 4's always-on line) reads: *"Document mode is where the
  interactive canvas lands: an HTML doc, deck or report, its version strip, and
  point-and-comment feedback — all against this project's one thread."* One line, the
  whole surface named.
- **The spine says what selecting does.** At the strip's thread-side end, beside
  [Themes] [Export]: *"selecting a version scrolls the thread to the message that made
  it ▸"* — §2.6 rule 1's "the connective tissue is labelled by what it does", pointing
  the eye at the pane the selection scrolls.
- **The composer teaches the continue rhythm.** Its placeholder in the terminal state
  reads *"Ask for a change — it lands as a new version…"* — what typing DOES, stated
  where typing happens.

## EC9 — the relationship is visible · **PASS**

This is the slice's reason to exist (F9, W3), and it is legible in `uxfix-6-document.png`
without knowing the app:

- **Thread messages are tagged with the version they produced.** Each user message
  carries an accent pill in the wireframe's literal words — *"▤ v1 landed"* under
  *"Make me a deck for the Q3 review"*, *"▤ v2 landed"* under *"Tighten this
  headline"* — so the thread side of the link is drawn, not inferred.
- **The version strip visibly connects canvas and thread.** It is ONE bar along the
  bottom spanning the full surface — under the canvas AND under the thread (§2.6
  rule 2's spine, and the rig measures the geometry) — with an accent rule on top,
  v1 and v2 entries, and the selected entry (v2) in the same accent as the thread
  tags. There is no dead middle column anywhere: canvas | thread above, one spine
  below.
- **The link works in both directions, and the pixels show the state agreeing.** In
  `uxfix-6-version-crosslink.png`, after selecting v1 on the strip: the canvas shows
  the VERSION 1 slide (the verbose headline *"Q3 was a quarter of significant and
  wide-ranging positive developments"*), the v1 entry is the highlighted one, and the
  thread's v1-tagged message sits in view — canvas ↔ strip ↔ thread reading as one
  fact. Against `uxfix-6-document.png` (v2: *"Q3: revenue up 18%"*, VERSION 2
  footer), the same document is visibly two versions, each traceable to its message.
- **Narration lands in the thread, versions on the strip, the artifact on the canvas**
  (§2.6 rule 3): the thread shows the agent's own lines (*"Planning the deck — outline
  first, then the slides."*, *"Tightening the headline and rebalancing the slide."*),
  the divider *"continues as v2"* marks the continuation, and the canvas holds the
  rendered deck — three destinations, one conversation, left to right.
- **Themes is explained where it acts** (V19, the other half of F9): in
  `uxfix-6-themes.png` the control sits on the strip beside Export, reads **Themes**,
  and its panel opens with *"Borrow a look from a site, PDF, or image."* above the
  two themes. No "theme library" spelling appears anywhere in any shot.

## EC10 — no banned state · **PASS**

- **No bare spinner, no bare "Working…", no whimsy** in any of the three shots: every
  working/finished state names its subject — the narration lines name the deck work,
  the tags name their versions, the strip entries name their timestamps, the export
  row names its version ("EXPORT V2").
- **No error without a next action**: no error state appears in any shot (and the rig
  recorded zero console errors across the whole journey).
- **No dead control**: both strip entries' "In thread" affordances are enabled (the
  rig asserts it — every version in this journey has its anchor), Fork/Export/Themes
  all name what they act on.

---

**Verdict: slice 6 PASSES its mapped checklist items (EC7, EC9, EC10) from the pixels
alone, with the DOM ACs green in the same rig run and no regression in slices 1–4's
surfaces (rigs 1–4 re-run green against the same build; full unit suite green).**
