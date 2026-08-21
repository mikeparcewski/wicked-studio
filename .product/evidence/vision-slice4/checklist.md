# DES-VISION-001 slice 4 — experience checklist verdicts

**Slice:** the mode SURFACES on the token system — Chat + Build (§5.3, §5.4) and
Document + Video (§5.5, §5.6), landed as two commits on one branch
(`vision/slice-4-surfaces`): GroupChat/ChatPanel/CenterDashboard, then
DocumentCanvas/DocumentThread/VersionStrip + the strip toolbar (ThemesMenu,
ExportMenu), the shared SurfaceState constants, threadAnchor (the §5.5
cross-link animation), and VideoStoryboard. The no-raw-color rule is **ERROR**
for all 11 files the slice touched (§2.11).
**Rubric:** DES-VISION-001 §6.1, items mapped to this slice's two §6.3 entries:
**EC7, EC9, EC10, EC11, EC13, EC15** (plus EC12 re-read on Build).
**Images:** `e2e/shots/vision/vision-4-chat-firstrun.png`,
`vision-4-build-runs.png`, `vision-5-document.png`, `vision-5-video.png` — all
1440×900, `device_scale_factor=1`, per §6.0, by `e2e/vision_slice4_test.py`
against the frozen-`NOW0` W2 fixture (§6.2) with the browser clock frozen at
`NOW0+5s`; the Document scene drives the real W3 create→continue journey, the
Video scene runs on the fixture's new `demo` switch (a recorded 4-step
`checkout-demo`, GIF + thumbnails drawn deterministically). The shots are
gitignored evidence; the rig's JSON report records each path beside the verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **EC7 — the surface teaches itself** (carried from UXFIX) | **PASS** | Chat's first-run states what it is and what typing does (the §5.3 instruction, on screen); Build's purpose statement is the first block under the H1 (`build-purpose`, always visible); each mode's summary line rides the switcher. All asserted off the live DOM. |
| **EC9 — the relationship is visible** (carried from UXFIX) | **PASS** | The Document shot shows canvas ↔ strip ↔ thread with the strip spanning beneath both panes; the rig re-proves BOTH cross-link directions and the §5.5 flash: selecting v1 scrolls the thread to the anchored message AND flashes it (`wk-anchor-flash` observed on, then retired on animationend). |
| **EC10 — no banned state** (carried from UXFIX) | **PASS** | No "Working…", no bare spinner anywhere in the four shots; the Video recording status names its subject (pinned in `VideoStoryboard.tokens.test.tsx` and unchanged narration suites); zero console errors across all four scenes. |
| **EC11 — information is the aesthetic** | **PASS** | All four shots: no gradients, no ornament. Every colored pixel is signal — run-row left borders, the gate pair, the accent on the ONE primary/selection — and every text block is data. |
| **EC12 — accent is singular** | **PASS** | Probed: `--accent` (violet) ≠ `--status-gate`/`--status-run`/`--status-fail`. On Build the accent appears ONLY on `+ Build something`; gates/statuses speak the §2.6 layer. Seat identity in Chat moved OFF per-CLI hues onto one surface/ink pair — color stays reserved for signal (§1.5 rule 2). |
| **EC13 — two typefaces, one rule** | **PASS** | Computed in all four scenes: intent labels/prose/purpose in Inter (the sans token); status words, phases, cost, narration, version numbers/stamps, chapter offsets in JetBrains Mono. Both faces visible in every shot — the contrast is the rhythm. |
| **EC15 — token discipline** (passing for these surfaces — the slice target) | **PASS** | Probe-asserted, no hex duplicated into the rig: `build-purpose` color == `var(--ink-body)`; gate-row `border-left` 2px == `var(--status-gate)` (run/fail rows likewise); composer bg == `var(--surface-raised)` with the `--accent-dim` focus ring (never full accent); version-strip active dot bg == `var(--accent)`; version tags == `var(--status-done)` at `--radius-sm`; selected chapter border 2px == `var(--accent)`. Lint: the rule is ERROR for the 11 slice files and finds **nothing** in them. |

**Slice DOM ACs** (from the rig's JSON report, all true):

- `[data-testid="build-purpose"]` computed `color` resolves from `--ink-body` (AC 1).
- The `awaiting_human` run rows' computed `border-left-color` == the probe of
  `--status-gate`, width `2px`; executing == `--status-run`; failed == `--status-fail` (AC 2).
- Chat first-run shows the instruction text; `data-testid="add-agents"` present and
  on-accent; **zero** `POST /api/v1/chats` fired on mount — the request tap covered the
  page's whole life (AC 3).
- Version strip active dot computed `background` resolves from `var(--accent)`;
  `data-testid="themes-explanation"` non-empty, sans/13px; selecting a storyboard chapter
  applies `border-color` from `--accent` (read after the `--dur-base` recolor settles) (AC 4,
  the §6.3 slice-5 items this branch carries).
- Console: zero errors across all four scenes.

**Repo gates:** `npm run lint` exit **0** — the 11 slice files under the ERROR-mode rule
with zero findings, the warn baseline still firing on the not-yet-converted rest (**1166**
warnings, down **316** from main's 1482 — slice 6 retires them). `npm run typecheck` exit 0.
`npm test` **847/847** (91 files; new: `DocumentSurfaces.tokens.test.tsx`,
`VideoStoryboard.tokens.test.tsx`, plus the Chat/Build commit's `GroupChat.tokens` and
`CenterDashboard.tokens` suites; `threadAnchor.test.ts` extended for the smooth scroll +
one-run flash).

**All rigs green on the fresh build** (`dist-sameorigin` deleted and rebuilt from this
branch first): `uxfix_slice1..6_test.py`, `vision_slice1..3_test.py`, and this slice's
`vision_slice4_test.py` — ten for ten, exit 0. Two rig-set reconciliations, both
behavior-preserving:
- `uxfix_slice5_test.py`'s EC1 accent census probed the inherited amber literal; it now
  probes `var(--accent)` — the contract (exactly ONE accent-filled primary) is unchanged,
  the hue moved onto the token by design (§2.5, applied to Build by this slice).
- `vision_slice1_test.py`'s pixel gate was re-baselined the strong way: baseline captured
  from an `origin/main` (pre-slice-4) build, check from this branch — **pixel-identical
  (0 diff pixels)**, proving the surface conversions changed nothing on the home board.
- `uxfix_slice6_test.py` follows the `themes-explain` → `themes-explanation` testid rename
  (the §6.3 AC names the latter); the assertion itself is unchanged.

**UXFIX preserved (§6.3's lists), re-proven:** Build purpose statement always visible; no
campaigns panel ("campaign" absent from the surface text); intent labels on run rows (never
raw prompts — uxfix-5's truncation checks still green); Chat single-agent default with
"Add agents" opt-in and no warmed roster on first run (uxfix-4 green); Document three-pane +
version cross-link both directions + Themes explanation on open (uxfix-6 green); Video
narration rules (recording status names its subject and step; ffmpeg actionable state
untouched).

**Fixture gotcha fixed (rig infrastructure, not product):** the shared `/ws` one-shot
queues were drained by whichever handler thread ticked first — a rig that navigates
between routes leaves the previous page's handler looping until its write fails, and its
pre-write drain STOLE the interactive frames meant for the live page (the Document journey
stalled on any multi-route rig). Each connection now takes a generation number and only
the NEWEST drains (`ws_gen` in `uxfix_fixture.py`).

**What shipped (~640 LOC production across the two commits):** `GroupChat.tsx`,
`ChatPanel.tsx` (§5.3): token conversion, seat identity on one surface/ink pair, first-run
instruction sans/`--ink-body`, composer `--surface-raised`/`--radius-xl` with the
`wk-composer` `--accent-dim` focus ring, on-accent "Add agents", transparent user bubbles /
card agent bubbles, roster disclosure at `--dur-base`; `CenterDashboard.tsx` (§5.4): token
conversion, run-row `border-left: 2px solid var(--status-*)` with `--dur-base` recolor and
`--dur-fast` mount fade, gate-inbox pill on the gate pair, cost footer mono/dim beside the
accent `+ Build something`; `DocumentCanvas.tsx`/`VersionStrip.tsx`/`DocumentThread.tsx` +
`ThemesMenu.tsx`/`ExportMenu.tsx`/`SurfaceState.tsx` (§5.5): token conversion, active
version dot on `var(--accent)`, strip on `--surface-rail` under an `--accent-subtle` spine,
`--status-done`/`--radius-sm` version tags, gate/actionable cards on the §2.6 amber pair,
framed canvas, the composer on §5.3's contract; `threadAnchor.ts` + `global.css`: smooth
scroll + the 1s `wk-anchor-flash` fade of `--accent-subtle` (one run, class retired on
animationend, `prefers-reduced-motion` honored); `VideoStoryboard.tsx` (§5.6): token
conversion, `border: 2px solid var(--accent)` on the selected chapter (2px in every state —
no layout shift), thumbs on `--surface-raised`, captions `--text-2xs --ink-dim` mono,
recording status mono/`--text-xs`/`--ink-body`; `eslint.config.mjs`: TOKEN_CLEAN grows by
the 11 slice files; `e2e/uxfix_fixture.py`: the `demo` switch + surface and the `ws_gen`
drain fix; `e2e/vision_slice4_test.py`: the gate (this file's evidence source).
