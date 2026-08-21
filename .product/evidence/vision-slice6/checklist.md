# DES-VISION-001 slice 6 — experience checklist verdicts

**Slice:** the remaining component token conversion (§6.3 slice 6) — finishes
§2.11. The ~1166-warning lint baseline slices 1–5 left (50 files still speaking
the inherited GitHub-dark shell palette) is converted to the semantic tokens;
the legacy `--wk-*` palette in global.css, its Tailwind `wk` aliases, and the
unconsumed `.wk-crew-bg` raw-color background are retired; the no-raw-color
rule moves to **ERROR for all of `src/**`** and the per-file `TOKEN_CLEAN`
allowlist machinery is deleted; `postcss.config.js` gains the §2.11 build-time
twin (`no-raw-colors`) guarding the stylesheets. Mechanical color replacement
only — no behavioral change, no new features.
**Rubric:** DES-VISION-001 §6.1 → this slice's §6.3 entry: **EC15 (globally
passing for the first time)**, with EC11/EC12 re-read after the bulk recolor.
**Images:** `e2e/shots/vision/vision-6-token-complete.png` (the settled W2
board, 1440×900, `device_scale_factor=1`, per §6.0, by `e2e/vision_slice6_test.py`
against the frozen-`NOW0` W2 fixture with the browser clock frozen at
`NOW0+5s`). The shots are gitignored evidence; the rig's JSON report records
the path beside the verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **EC15 — token discipline (GLOBAL)** | **PASS** | `npm run lint` exits **0 with zero §2.11 findings** across all of `src/` under the ERROR-mode rule (1166 → 0). The rig's EC15 sweep probes TEN `data-testid` elements across two scenes and matches every computed `background`/`color`/`border-color` against the scratch-element probe of its semantic token — no hex duplicated into the rig: left-rail bg == `--surface-rail`; project-card bg == `--surface-card`; awaiting run-chip border+bg == `--status-gate-dim` and its phase label == `--status-gate`; executing phase label == `--status-run`; live-line == `--ink-body` in JetBrains Mono; gate-approve == `--status-run` on `--status-run-dim`; and on `/work` the RunLink status dots == `--status-gate` / `--status-run` / `--status-fail` / `--status-done`. |
| **EC12 — accent is singular** (re-read) | **PASS** | The conversion **strengthened** the separation §2.6 demands: the legacy amber `--wk-accent` was split by ROLE — primary CTAs / selection / links / checkbox accents onto `var(--accent)` (+`--accent-fg` ink), while gates, awaiting-human states, warnings, conditional verdicts, and "needs attention" markers went to the `--status-gate` layer. Legacy blue `#79c0ff` likewise: links/selection → accent; executing/active → `--status-run`. No hue family other than the violet accent reads as interactive in the shot. |
| **EC11 — information is the aesthetic** (re-read) | **PASS** | The shot is the same board slices 1–3 shipped — no gradients, no ornament introduced by the recolor; the only visible deltas are status-layer signals (below). The unconsumed `.wk-crew-bg` decorative background (gradients + watermark) was deleted, not converted. |
| **EC10 — no banned state** (preserved) | **PASS** | Zero console errors across both rig scenes; all ten prior rigs re-prove their narration/copy contracts on this build. |

**Slice DOM ACs** (from `vision_slice6_test.py`'s JSON report, all true):

- `npm run lint` exits 0 with NO findings on raw colors across all of `src/` (AC 1).
- The Playwright `getComputedStyle` sweep across 10 `data-testid` elements confirms
  every probed `background`/`color`/`border-color` resolves through the token
  (probe-equality, EC15 passing globally) (AC 2).
- Enforcement posture, statically read: `'no-restricted-syntax': ['error', ...]`
  for `src/**/*.{ts,tsx}`; no `const TOKEN_CLEAN` declaration and no
  `files: TOKEN_CLEAN` block; warn-mode gone; `no-raw-colors` PostCSS twin
  present; no `--wk-*`/`.wk-crew-bg` in global.css (AC 3).

**Repo gates:** `npm run lint` exit **0 — zero errors, zero warnings** (the §2.11
rule at ERROR repo-wide; the react-hooks advisories that ride the config also
report nothing). `npm run typecheck` exit 0. `npm test` **847/847** (91 files —
unchanged suite; the conversion needed no test rewrites). `npm run build` green
with the PostCSS twin in the pipeline; the twin was negative-tested: a probe
`color: #ff0000` appended to global.css fails the build with the §2.11 message
naming the file/line, and the token sources stay exempt (per-declaration source
check, pre-Tailwind, so generated utilities/preflight are not misattributed).

**All rigs green on the fresh build** (`dist-sameorigin` deleted and rebuilt from
this branch first): `uxfix_slice1..6_test.py`, `vision_slice1..4_test.py`, and
this slice's `vision_slice6_test.py` — **eleven for eleven, exit 0.**

**The vision-1 pixel gate, run the strong way (§6.3: "zero visual regression"):**
baseline captured from an **origin/main** build (a detached worktree at
`0bfebd2`), check from this branch — the diff was **911 pixels in four row
bands**, every one a sanctioned slice-6 recolor on the home board, verified by
color-pair census and eye-check of the diff crop:
- run-chip gate phase labels: `#ffda19` → `--status-gate` (hsl 45 90% 68%);
- gate pill fills: translucent amber → `--status-gate-dim`;
- the Notifications label: legacy gray-blue → `--ink-dim`.
No layout shifts, no other surfaces moved. Per the rig's VISION_BASELINE flow
the baseline was then regenerated on this branch and the check re-run:
**pixel-identical, 0 diff pixels** — determinism intact, the delta exactly the
declared §2.6 vocabulary change and nothing else.

**Rig-set reconciliations** (contract advanced; behavior-preserving):
- `vision_slice1..4_test.py` each asserted the WARN baseline was still firing
  elsewhere ("raw_color_warnings > 0") — the §2.11 migration those assertions
  staged is complete, so they now pin the end state: exit 0 AND zero findings
  repo-wide. Their own error-mode-files-clean assertions are unchanged.

**Role decisions of record** (semantic fidelity — the token matching the ROLE,
not the nearest hex; §2.6 status/accent separation):
- **Status vocabulary** (`RunCard.STATUS_STYLE`, `RunLink.statusColor`, shared by
  the converted board): distributing/executing → `--status-run` (emerald =
  running, was legacy blue), awaiting_human → `--status-gate`, completed →
  `--status-done` (was legacy green — §2.6: emerald means *running*), failed →
  `--status-fail`. The dead `className: 'text-wk-*'` field was deleted with its
  aliases.
- **Primary CTAs** (legacy amber bg + dark ink): `var(--accent)` +
  `var(--accent-fg)` — Build/launch/save/register/steer-approve buttons.
- **Gate/attention layer**: gate toasts, steering gate, sign-in-needed chips,
  "risk flagged", conditional verdicts, quorum-lost/degraded notes, ungoverned
  terminal marker, proposed domain entities → `--status-gate`(-dim).
- **Selection/identity**: chosen elicitation option, active time-range/sort
  column, selected workflow chip, attached-context chips, evaluator/creator
  identity, member-kind pills → the accent family (`--accent`, `--accent-dim`,
  `--accent-subtle`).
- **Graph categorical palettes** (CytoGraph/ForceGraph/HotspotsView/
  RepoGraphModal, one shared mapping): callables → `--status-run`, data shapes
  (class/struct, rust) → `--status-gate`, interface-likes (interface/trait/
  type_alias, python) → `--accent`, enum/macro/go → `--accent-dim`, fallback
  `--ink-muted`; graph selection/highlight → `--accent` (was `#fbbf24`).
- **Surfaces**: legacy shell hexes onto the ramp by elevation (canvas →
  `--surface-base`, canvas-2/wells → `--surface-rail`, cards → `--surface-card`,
  hovers/hairlines/input fills → `--surface-raised`, the "blue modal" →
  `--surface-overlay`/`--surface-raised`); whole legacy shadow strings onto
  `--shadow-card/-raised/-overlay`.
- **New semantic token, one**: `--scrim` (rgba 0,0,0,.6 in tokens.css) for the
  modal/backdrop fills that must stay translucent; the FeedbackOverlay's
  selection fill uses `color-mix(in srgb, var(--accent) 10%, transparent)` for
  the same reason (a token-derived translucency, no literal channels).
- **The var()-blind sinks** (§2.11 escape hatch): xterm themes
  (Terminal/AgentTerminal) and cytoscape stylesheets (CytoGraph) resolve tokens
  through the cascade at mount/build time via the new
  `src/styles/resolveToken.ts` — customization (§3.3) still reaches them.

**UXFIX preserved:** this slice is color replacement only — all ten prior rigs
(every UXFIX behavior contract among them) pass unchanged on this build; the
unit suite needed zero edits.
