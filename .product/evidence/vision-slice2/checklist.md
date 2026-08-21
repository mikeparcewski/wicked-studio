# DES-VISION-001 slice 2 — experience checklist verdicts

**Slice:** the orchestrator home reimagined (§5.1 — the §1.3 composition: status wall +
live-feed sidebar). HomeBoard/ProjectCard/GateChip token-converted wholesale; the 2px
status bar on ACTIVE card tops (the leading signal kind AS color, §1.4); narration in
`--font-mono` (§1.5 rule 3); NEW `LiveFeed.tsx` subscribed to the SAME runtime store as
the cards (zero new sockets); the no-raw-color rule flipped to **ERROR** for every file
this slice touched (§2.11).
**Rubric:** DES-VISION-001 §6.1, items mapped to this slice: **EC3, EC4, EC11, EC12,
EC13, EC14, EC15.**
**Images:** `e2e/shots/vision/vision-2-home-live-feed.png` (the settled W2 board + live
feed) and `e2e/shots/vision/vision-2-active-card.png` (the q3 ACTIVE-card closeup) —
both at 1440×900, `device_scale_factor=1`, per §6.0, by `e2e/vision_slice2_test.py`
against the frozen-`NOW0` W2 fixture (§6.2) with the browser clock frozen at `NOW0+5s`.
The shots are gitignored evidence; the rig's JSON report records each path beside the
verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **EC3 — bands** (carried from UXFIX) | **PASS** | NEEDS YOU settles to the exact W2 order `q3-review-deck, api-migration, auth-refactor, upload-endpoint`; QUIET (24) collapsed to the chip strip; "Not in a project (1)" last. `boardAttention.ts` untouched (`git diff` — zero hunks). |
| **EC4 — decay** (carried from UXFIX) | **PASS** | The decay pair holds: `legacy-spike` (8-day failure, project touched an hour ago) is NOT in `band-needs-you` while fresh-failed `auth-refactor` leads with the red bar — asserted off the live DOM (`legacyDemoted: true`). |
| **EC11 — information is the aesthetic** | **PASS** | Both shots: no gradients, no imagery, no ornament. Every colored pixel is a signal (status bars, dots, gate chips), every text block is data (names, narration, ages). The feed column is narration and nothing else — no header, no scrollbar (§1.3). |
| **EC12 — accent is singular** | **PASS** | Computed probe: `--accent` = `rgb(130, 88, 228)` (violet) ≠ `--status-gate` `rgb(247, 210, 100)` ≠ `--status-fail` `rgb(243, 84, 73)`. On this surface the accent appears ONLY on the first-run invitation (an affordance); amber/red/emerald appear only as status. |
| **EC13 — two typefaces, one rule** | **PASS** | Computed: card narration and feed lines render `"JetBrains Mono", "Fira Code", ui-monospace` (the `--font-mono` token); the project name renders the sans (`Archivo, ui-sans-serif`). Both faces visible in both shots — the contrast IS the rhythm. |
| **EC14 — the live feed is live** | **PASS** | A NEW `unitOutputDelta` (`extra_narration` fixture switch, same `/ws`) landed in `live-feed-block-upload-endpoint` **within 2s** with no navigation (`feed_updated_within_2s: true`) — through the same store fold the cards read. |
| **EC15 — token discipline** (passing for these components — the slice-2 target) | **PASS** | Probe-asserted, no hex duplicated into the rig: card computed `background` `rgb(26, 26, 38)` == the probe of `var(--surface-card)`; the q3 bar `border-top: 2px` == the probe of `var(--status-gate)`; auth's == `var(--status-fail)`. Lint: the rule is ERROR for the five slice files and finds **nothing** in them. |

**Slice DOM ACs** (from the rig's JSON report, all true):

- `data-testid="live-feed"` present and non-empty with runs active; blocks:
  `upload-endpoint` narrating (headline + the fresh line), `auth-refactor` as the fail
  block `failed 12m ago [open run]`; NO block for the decayed `legacy-spike` or the
  gate-waiting `q3-review-deck` (the gate is answerable on the card — §1.3's wireframe).
- `unitOutputDelta` → `live-feed-block-upload-endpoint` updated within 2s (EC14 above).
- `getComputedStyle(project-card).background` resolves from `var(--surface-card)` (EC15).
- The 2px bar's `border-top-color` matches `--status-gate` on the gate card and
  `--status-fail` on the failure; `border-top-width: 2px`.
- Console: zero errors across the run.

**Repo gates:** `npm run lint` exit **0** — the five slice files under the ERROR-mode
rule with zero findings, the warn baseline still firing on the not-yet-converted rest
(1530 warnings, down 32 from slice 1's 1562). `npm run typecheck` exit 0. `npm test`
**815/815** (86 files; +7 new: `LiveFeed.test.tsx`, and the slice-2 card-language
asserts in `ProjectCard.variants.test.tsx`).

**UXFIX preserved (§6.3's list), re-proven:** `boardAttention.ts` untouched; band
structure + windowing intact (the grid tightened to §1.3's `minmax(280px)`/8px — the
mount ceiling in `HomeBoard.test.tsx` re-derived for the extra column); the quiet-card
budget still exactly ONE `quiet-summary` line per card (asserted expanded, in the rig
and in unit tests); answerable gate chips (`gate-approve-r-q3`/`gate-reject-r-q3` live
on the card); the attention pill kept with its V3 user words ("working", never
"distributing") — §5.1 sketches the bar as the pill's replacement, but the UXFIX
checklist this slice must preserve asserts the pill's words, so the bar lands BESIDE the
pill and the pill's retirement is deferred to the checklist's own revision. All six
uxfix rigs (`uxfix_slice1..6_test.py`) green on the fresh slice-2 build
(`dist-sameorigin` deleted and rebuilt first). `vision_slice1_test.py` is a
point-in-time gate whose pixel-baseline and hardcoded-`#161b22` baseline assertions are
superseded by this slice BY DESIGN (its own docstring: "the baseline the next slice
moves from") — its successor is this rig's probe assertions.

**What shipped (~340 LOC production):** `src/components/LiveFeed.tsx` (new, ~160 lines
with §-comments): per-project blocks — dot + dim name, then the newest distinct
narration lines in mono, newest first, ≤3 per block, fail blocks with `[open run]`,
`§1.6` motion (`wk-feed-in`, fade-in once, no loops, `prefers-reduced-motion` honored);
`HomeBoard.tsx`: wall+feed row, token conversion, §1.3 grid, ResizeObserver re-measure
(the feed mounts without a window resize — the rig caught the column math spending the
feed's width); `ProjectCard.tsx`: token conversion, `SIGNAL_BAR` + the 2px status bar,
mono narration, slot heights +6px for `--space-4` padding and the border-box bar;
`GateChip.tsx`: token conversion (gate=amber status pair, approve=run pair,
reject=fail pair); `useBoardHeadline.ts`: `lastMeaningfulLines(text, max)` (the feed's
window; `lastMeaningfulLine` re-derived from it); `global.css`: the `wk-feed-in`
keyframes; `eslint.config.mjs`: one shared selector list, WARN for `src/**`, **ERROR**
for the five converted files (`TOKEN_CLEAN` — grows per slice until slice 6 flips
`src/**`); `e2e/uxfix_fixture.py`: the one-shot `extra_narration` switch;
`e2e/vision_slice2_test.py`: the gate (this file's evidence source).
