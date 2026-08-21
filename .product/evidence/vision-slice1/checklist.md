# DES-VISION-001 slice 1 — experience checklist verdicts

**Slice:** the token foundation (serves §2 entirely — primitives + semantics, light theme
as a theme instance, tailwind var-backed aliases, the no-raw-color contract in WARN, the
global.css import chain). No component changes; **zero visual change is the gate**.
**Rubric:** DES-VISION-001 §6.1, item mapped to this slice: **EC15** (baseline recorded,
not yet passing for components — passing is the target of slice 2+, global by slice 6).
**Images:** `e2e/shots/uxfix/vision-1-token-check.png` (the settled W2 board on the
token-foundation build) against `e2e/shots/uxfix/vision-1-baseline.png` (the SAME rig's
capture on the pre-slice commit) — both at 1440×900, `device_scale_factor=1`, per §6.0,
by `e2e/vision_slice1_test.py` against the frozen-`NOW0` W2 fixture (§6.2), with the
browser clock frozen at `NOW0 + 5s` and animations frozen by injected CSS so the
pixel-identity claim is about the CHANGE, not about capture jitter. The shots are
gitignored evidence; the rig's JSON report records each shot's path beside the verdicts.

| Item | Verdict | Read from the evidence |
|---|---|---|
| **Zero visual regression** (the slice gate, §6.3) | **PASS** | `vision-1-token-check.png` is **pixel-identical** to `vision-1-baseline.png`: same 1440×900 size, `ImageChops.difference` bbox `null`, **0 differing pixels**. The board — bands, gate chips, live narration line, quiet rows — is unchanged to the pixel. |
| **EC15 — token discipline (baseline)** | **RECORDED, not yet passing** — by design | Every sampled token across all eight §2 tables resolves non-empty on the document root (`--surface-card: #1a1a26`, `--accent: hsl(258 72% 62%)`, `--status-gate: hsl(45 90% 68%)`, `--space-4: 16px`, `--text-sm: 13px`, `--radius-lg: 12px`, `--ease-out`/`--dur-base` set), while `[data-testid="project-card"]`'s computed background is still the hardcoded `rgb(22, 27, 34)` (`#161b22`) — the recorded baseline slice 2 moves from. |

**Slice DOM ACs** (from the rig's JSON report, all true):

- `--surface-card` resolves non-empty in a Playwright browser context (`#1a1a26`; read via
  `getComputedStyle(document.documentElement)` — where a stylesheet-declared custom
  property is observable; the spec's `documentElement.style` read is the inline-override
  channel §3.3 uses later and is empty by design until then).
- `npm run lint` exits **0** with **0 errors, 1562 warnings**, every one of them the new
  no-raw-color rule firing on the inherited hardcoded colors (`(DES-VISION-001 §2.11)` in
  each message) — the WARN-mode migration baseline; the codebase was warning-clean before.
- `npm run build` succeeds (tsc + vite, exit 0).

**Repo gates:** `npm run typecheck` exit 0; `npm test` **808/808** (85 files) pass.

**UXFIX preserved (§6.3 "no component changed; all UXFIX behaviors inherited by
definition"), re-proven anyway:** all six existing rigs green on the token-foundation
build (fresh `dist-sameorigin`, stale cache deleted first) — `uxfix_slice1_test.py`
through `uxfix_slice6_test.py`, each exit 0, report `ok: true`.

**What shipped (≈300 LOC production):** `src/styles/tokens.css` (§2.3–§2.10 verbatim:
surface/ink ramps, HSL accent primitives + derived semantics, fixed status hues with
`-dim` pairs, spacing/type/radius/shadow/motion); `src/styles/themes/light.css`
(`[data-theme="light"]` surface + ink overrides and the three status `-dim` light
re-tints, §2.14 — inert until something sets the attribute); `src/styles/themes/dark.css`
(documented empty — the default IS tokens.css, §2.13); `src/styles/global.css` (imports
tokens + themes, then Tailwind, then the app-global rules moved verbatim from index.css);
`src/index.css` → the one-line §2.12 import chain; `tailwind.config.js` semantic color
aliases from CSS vars (`bg-surface-card`, `text-ink-body`, `border-status-gate`, … —
inherited `wk.*` palette kept for today's consumers); `eslint.config.mjs` no-raw-color
via `no-restricted-syntax` (hex / literal `rgb()` / literal `hsl()` in string and
template literals, `src/**` only) at **warn**.
