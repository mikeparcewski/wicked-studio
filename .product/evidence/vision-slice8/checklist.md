# DES-VISION-001 slice 8 — experience checklist verdicts

**Slice:** brand-learn (§6.3 slice 8) — §4 end to end. The garden skill
definition lands verbatim at `.garden/skills/studio-learn-brand.yaml` (§4.2);
`src/theming/brandMapper.ts` is the §4.5 mapper — a PURE `ThemeDetail →
{accent_h, accent_s, accent_l, logo_url, adjustments[]}` function carrying the
four guarantees (WCAG AA ≥4.5:1 contrast vs `--surface-card`, ≥30° circular
hue separation from the status trio, `s∈[20,88]`/`l∈[42,78]` clamps, ≥25
deltaE perceptual distinctness), every move disclosed, `unsatisfiable` never
silent; `src/api/interactive.ts` gains §4.4's ONE new wrapper (`ThemeDetail` +
`getTheme`, through the existing proxy — the SPA never fetches a brand
source); and the Appearance section gains the §4.3 **Learn from brand source**
row (`BrandLearn.tsx`): source-kind radios + input → `learnTheme` → the
bridge's queue `message` VERBATIM (§3.3) → `listThemes` polled every 3s until
`learned_at` → `getTheme` → mapper → **preview via the slice-7 live-preview
machinery** (`applyAppearance` writes the mapped primitives inline on `<html>`
— the page IS the preview, §3.4, nothing persisted) → Apply persists through
the appearance store's debounced PUT with the **fully resolved** logo URL
(§4.5: the logo must survive the bridge); Discard restores the stored
appearance. Adjustments are disclosed under the preview (§4.3 step 7).
**Rubric:** DES-VISION-001 §6.1 → this slice's §6.3 entry: **EC12, EC15,
EC16** (logo from brand — extracted here).
**Images:** `e2e/shots/vision/vision-8-brand-learn-running.png` (Settings
mid-learn: source row filled, the bridge's queued message on screen verbatim)
and `e2e/shots/vision/vision-8-brand-learn-applied.png` (the W2 board + chrome
wearing the learned brand: navy accent ≈217°, the 2:1 brand logo contained in
the 32×32 slot, status colors untouched), both 1440×900,
`device_scale_factor=1`, per §6.0, by `e2e/vision_slice8_test.py` against the
frozen-`NOW0` W2 fixture (browser clock frozen at `NOW0+5s`). The shots are
gitignored evidence; the rig's JSON report records the paths beside the
verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **EC12 — accent is singular** | **PASS** | The fixture's brand primary is a deep navy (`#0a2a5e` → hue 217°, ≥30° from gate 45° / fail 4° / run 148°); after mapping, the probe-computed `--accent` differs from every fixed status color in BOTH scenes (Settings preview and the applied board) — asserted computed-vs-computed, no hex in the rig. The applied shot shows it: chrome links, quick actions, and the logo turn navy while GATE stays amber, FAILED stays red, WORKING stays emerald. The §4.5 guarantees are the mechanism, not luck: the unit suite's whole-gamut property sweep (`tests/brandMapper.test.ts`) proves ANY extracted color lands ≥30° hue-separated and ≥25 deltaE from the trio (or is disclosed `unsatisfiable` and Apply is disabled — never silent). |
| **EC15 — token discipline** | **PASS** | With the mapped accent previewing, the §3.2 preview strip's computed `background` equals the scratch-element probe of `--accent` — the mapped values flow through the token cascade, not through any component restyle. `npm run lint` exits 0 with zero §2.11 findings including the new `brandMapper.ts`/`BrandLearn.tsx` (the mapper's fixed reference points — the card surface and status trio — are NUMERIC mirrors of tokens.css, pinned to `#1a1a26` by a unit test, because §2.11 bans raw color strings outside the token files). |
| **EC16 — logo slot respected** | **PASS** | The learned theme names a bridge-relative, deliberately NON-SQUARE (2:1) logo; the mapper passes it through untransformed, the Settings UI resolves it via `interactiveUrl`, and the PUT stores the FULLY RESOLVED URL (§4.5). On the applied board: the chrome slot's computed `background-image` resolves the brand asset, `background-size` is `contain` (letterboxed, never stretched or cropped), the slot stays exactly 32×32, and `[data-testid="logo-wicked-mark"]` count is **0**. |

**Slice DOM ACs** (from `vision_slice8_test.py`'s JSON report, all true):

- Clicking Learn with a valid URL fires **exactly one** request to
  `/api/v1/projects/notes/interactive/api/theme/learn` and **zero** requests
  to the brand host itself (`page.on('request')` filter over every request the
  session made; a final sweep confirms no host other than the fixture origin
  and Google Fonts was ever contacted).
- `data-testid="learn-status"` shows the bridge's `message` verbatim:
  `Queued — reading the brand at https://acme.example/brand (theme-learn agent)`
  (the rig waits on exact string equality with the response body's field).
- Learning `http://169.254.169.254/` is rejected by the bridge (**400**), the
  status shows the refusal verbatim (`refusing to fetch 169.254.169.254:
  loopback, private and link-local addresses are blocked (SSRF guard)`), and
  **no outbound request** touches the metadata address.
- After the 3s `listThemes` poll finds `learned_at`, `getTheme` fires ONCE and
  the preview updates: inline `--_accent-h/s/l` read back exactly
  `217/81%/59%` (the §4.5 mapping of `#0a2a5e`, pinned independently in the
  unit suite) and the preview strip's computed background equals the `--accent`
  probe — with **zero** settings PUTs before Apply (§3.4: preview ≠ persist).
- The mapper's two adjustments are disclosed in
  `data-testid="mapper-adjustments"`: `lightness-clamp` (l=20%→42%) and
  `contrast-floor` (l=42%→59%, "was 2.60:1 — raised for WCAG AA (4.5:1)").
- Apply fires ONE `PUT /api/v1/settings` carrying
  `studio.appearance = {accent_h: 217, accent_s: 81, accent_l: 59, logo_url:
  <origin>/api/v1/projects/notes/interactive/api/brand/logo.svg, theme: "dark"}`.
- A fresh page load renders the W2 board FROM the stored brand appearance
  (startup applies `--_accent-h: 217`), with the brand logo in the slot and
  the W2 order + live narration intact.
- Zero console errors across both scenes (the SSRF probe's by-design 400
  resource line excepted, filtered by exact shape).

**The §4.5 mapper guarantees, unit-proven** (`tests/brandMapper.test.ts`,
26 cases): contrast floor raised-and-capped (90%), the low-saturation rescue
(s→40 minimum), hue search in ±5° steps with the nearest-side win pinned
(`#22c55e` h142 → 117, down at 5 steps beats up at 8) and the dead-center
tie-break to max total status distance (h148 → 178), all four clamps,
CIE76-deltaE distinctness with the g1-beats-g4 ordering (a perceptual nudge
never breaks the contrast floor), a **whole-gamut property sweep** (h×s×l
grid: every input either satisfies all four guarantees or discloses
`unsatisfiable`), degenerate palettes (`{}`, unparseable strings, grey, black,
white, secondary-only — §4.4 tolerant reading, every fallback disclosed), logo
passthrough, and purity (frozen input, deep-equal reruns).

**Repo gates:** `npm run lint` exit **0 — zero errors, zero warnings** (the
§2.11 rule stays ERROR repo-wide over the new files). `npm run typecheck`
exit 0. `npm test` **906/906** (95 files — +39 new: the mapper's 26, the
BrandLearn flow's 10 incl. verbatim-error and poll-past-a-flake cases, and
`getTheme` in the wrapper suite's resolver/happy-path tables).

**All rigs green on the fresh build** (`dist-sameorigin` deleted and rebuilt
from this branch first): `uxfix_slice1..6_test.py`,
`vision_slice1..4_test.py`, `vision_slice6..7_test.py`, and this slice's
`vision_slice8_test.py` — **thirteen for thirteen, exit 0.**

**The vision-1 pixel gate:** the baseline was regenerated per its
`VISION_BASELINE=1` flow and the check passes **pixel-identical (0 differing
pixels)**. Disclosure, because the slice claims "no UXFIX surfaces touched":
a base-commit (`04f8f7c`) baseline first differed from the branch build by 27
pixels (±1/255 on one channel) confined to quiet-chip border-corner
antialiasing. Investigated before regenerating: the built CSS bundle is
**byte-identical** between base and branch (same content hash,
`index-DkF-X_o3.css`), and a live two-build probe found the quiet chips'
DOM geometry, computed border colors, radii, and fonts **identical to the
fraction of a pixel**; the same ±1 corner wobble also appears between
captures of identical content under different capture conditions. It is
rasterization noise on fractional-width rounded borders, not a rendered
change — the board is visually and structurally unchanged at default
appearance.

**UXFIX preserved:** no UXFIX surface touched — brand-learn is a new §4.3 row
inside the slice-7 Appearance section; the board/chrome change only when the
operator APPLIES a learned brand, and then only through the same §3.3
appearance path slice 7 shipped (the §2.6 status layer reads from untouched
tokens by construction).
