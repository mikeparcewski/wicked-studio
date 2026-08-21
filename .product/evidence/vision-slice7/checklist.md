# DES-VISION-001 slice 7 — experience checklist verdicts

**Slice:** the customization UI (§6.3 slice 7) — §3 end to end. The `/system`
Settings surface gains the §3.2 **Appearance section** (a section, not a new
page): logo upload-or-URL into the chrome's 32×32 `--logo-url` slot with the
§3.1 contain-fit/clearspace contract, a 240px canvas hue wheel plus
saturation/lightness sliders driving the three §2.5 accent primitives, the
light/dark theme-instance picker (§2.14), the §3.2 preview strip (accent mode
segment + FIXED gate chip + primary action), and the two independent §3.5
resets. Live preview IS the page (§3.4): every move lands as inline
custom-property overrides on `<html>` — the cascade seam tokens.css declares.
Persistence (§3.3) is a 400ms-debounced, optimistic, silently-retried
`PUT /api/v1/settings` under the namespaced `studio.appearance` key;
`App.tsx` reads the key once at startup and applies it (a daemon without a
settings surface fails silently into the stylesheet defaults — the
§3.3 ASSUMPTION[external-transform] adaptation: studio treats the store as a
flat key-value object and never depends on a targeted sub-route).
**Rubric:** DES-VISION-001 §6.1 → this slice's §6.3 entry: **EC12, EC15, EC16**.
**Images:** `e2e/shots/vision/vision-7-appearance-settings.png` (Settings open,
Appearance section with the wheel dragged to teal and the preview strip live)
and `e2e/shots/vision/vision-7-custom-accent.png` (the W2 board + chrome
wearing a STORED teal accent ≈180° from startup), both 1440×900,
`device_scale_factor=1`, per §6.0, by `e2e/vision_slice7_test.py` against the
frozen-`NOW0` W2 fixture with the browser clock frozen at `NOW0+5s`. The shots
are gitignored evidence; the rig's JSON report records the paths beside the
verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **EC12 — accent is singular** | **PASS** | With the accent dragged to teal (and again with a STORED teal on the board), the probe-computed `--accent` differs from every fixed status color (`--status-gate` amber, `--status-fail` red, `--status-run` emerald) — asserted computed-vs-computed in both scenes, and visible in both shots: the gate chips/cards stay amber, FAILED stays red, WORKING stays emerald while the logo mark, nav links, active mode segment, and primary button all turn teal. Status colors are deliberately NOT offered in the surface; the section says so in copy ("fixed semantic signals"). |
| **EC15 — token discipline** | **PASS** | The preview strip's computed `background`/`color` values equal the scratch-element probes of their semantic tokens (`--accent`, `--accent-fg`, `--status-gate-dim`, `--status-gate`) — no hex in the rig. `npm run lint` exits 0 with zero §2.11 findings including the new `AppearanceSettings.tsx`/`appearance.ts` (the wheel's canvas hues and the slider gradient tracks interpolate variables/`var()` refs, never literal channel values). |
| **EC16 — logo slot respected** | **PASS** | Applying a same-origin custom URL (a deliberately NON-SQUARE 2:1 SVG) sets `--logo-url` on `<html>`; the chrome slot's computed `background-image` resolves the asset, computed `background-size` is `contain` (letterboxed, never stretched or cropped), the slot stays exactly 32×32, and `[data-testid="logo-wicked-mark"]` count is **0** — the W mark is absent, the two never stack. Remove restores the mark and clears the property; the PUT that carried the logo left the accent untouched (independence, §3.5). |

**Slice DOM ACs** (from `vision_slice7_test.py`'s JSON report, all true):

- On settings load with a SEEDED stored appearance (h=200, s=60, l=55),
  `document.documentElement.style.getPropertyValue('--_accent-h')` reads back
  exactly `'200'` (with `'60%'`/`'55%'` beside it) — startup applies the store
  (AC 1).
- A pointer-drag on the hue wheel to the 180° point updates `--_accent-h`
  within ONE `requestAnimationFrame` (read back `'180'` on the next frame)
  (AC 2).
- The `PUT /api/v1/settings` fires only after the 400ms debounce (measured
  ~0.4s after pointer-up), carries the FULL `studio.appearance` object with
  the dragged hue, and a slider ArrowRight×2 lands the next debounced PUT
  with `accent_s: 62` (AC 3).
- Reset restores `--_accent-h: 258` (+72%/62%) inline AND persists 258/72/62
  (AC 4).
- With a logo URL set, `[data-testid="logo-slot"]` has a non-none
  `background-image` resolving the asset and `[data-testid="logo-wicked-mark"]`
  is absent (AC 5 / EC16).
- The theme picker: Light sets `data-theme="light"` on `<html>` and flips the
  computed `--surface-base` (rgb(9,9,15) → rgb(244,244,248)); Dark removes the
  attribute; both persist their PUT.
- Zero console errors across both scenes.

**Repo gates:** `npm run lint` exit **0 — zero errors, zero warnings** (the
§2.11 rule stays ERROR repo-wide over the new files). `npm run typecheck`
exit 0. `npm test` **867/867** (93 files — +20 new: the appearance store's
load/apply/debounce/retry/sanitize contract, the AppearanceSettings DOM
contract incl. upload size-cap and data-URL landing, and the AppChrome
mark-absence case).

**All rigs green on the fresh build** (`dist-sameorigin` deleted and rebuilt
from this branch first): `uxfix_slice1..6_test.py`,
`vision_slice1..4_test.py`, `vision_slice6_test.py`, and this slice's
`vision_slice7_test.py` — **twelve for twelve, exit 0.** Every pre-slice-7
rig's page now GETs `/api/v1/settings` at boot (the App startup read); the
fixture's defaults are exactly tokens.css's values, so nothing moved.

**The vision-1 pixel gate, run the strong way (§6.3: "no UXFIX surfaces
touched"):** baseline captured from a build of the STACK BASE
(`vision/slice-6-token-completion` @ `fcc4f01`, a detached worktree — the
zero-regression reference for a stacked branch; origin/main is behind the
base by slice 6's sanctioned recolors, already accounted in slice 6's
evidence), check from this branch: **pixel-identical, 0 differing pixels,
empty diff bbox** — the startup settings read applying default inline
overrides changes nothing the eye or the diff can see.

**UXFIX preserved:** no UXFIX surface touched — the Appearance section is
additive inside `/system`; the board/chrome deltas are zero at defaults (the
pixel gate above) and, under a custom accent, confined to the accent layer by
construction (the §2.6 status layer reads from untouched tokens).
