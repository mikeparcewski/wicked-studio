# DES-VISION-001 — wicked-studio: the orchestrator re-envisioned

**Status:** DRAFT — in progress
**Date:** 2026-08-20
**Scope:** Design only. No implementation. This is the design-phase deliverable.
**Repo in scope:** `wicked-studio` (this repo, the coder skin of the experience plane).
**Reads first:** `.product/DES-MERGE-001.md` — what the product IS; `.product/DES-UXFIX-001.md` — the IA and usability arc this document builds on top of.

---

## 0 Why a re-envision, not another UX-fix

DES-UXFIX-001 made the inherited crew-dashboard shell **usable**: attention decay, card variants, rail consolidation, mode-switcher weight, Build purpose statement, Document three-pane relationship. Six slices, all on main. The shell is now navigable.

What it is not is **the product itself**. The visual language is still the inherited shell's: colors are hardcoded hex across 40+ components, no token system exists, the chrome is generic, and the product looks like a dashboard into which features have been fitted — because that is exactly what it is.

This document re-envisions from zero. The UXFIX arc proved three things at the IA level that survive:

1. **The decayed-attention model** (`boardAttention.ts`) — the math is right; the visual expression is not yet beautiful.
2. **The mode spine** (Chat / Build / Document / Video) — the vocabulary is correct; the switcher is now weighted but the visual language around it is still thin.
3. **The empty-state budget and the screenshot-gate process** — the discipline is right; it carries forward exactly.

Everything else — layout skeleton, chrome, rail, card anatomy, typography, color, motion — is open. The constraint is: nothing the UXFIX arc built is regressed.

The operator's words: *"visually stunning and helpful information as the orchestrator, drive the experience like someone doing multiple projects at once."* That is the brief. This document makes it concrete.

---

## 1 The North Star

### 1.1 The person and the scene

The person is an **operator orchestrating six unrelated efforts at once**: an API migration, a Q3 deck, a data pipeline cleanup, two experimental chats, a demo recording for a client. These projects do not relate to each other. The operator's mental model is not a timeline, not a dependency graph — it is a **portfolio of parallel bets**, each at a different phase, each capable of demanding attention at any moment.

They open wicked-studio and need to know, in under three seconds: **which of these six things needs me right now?** Then, without entering any project, they want peripheral awareness of what is moving — what the agents are doing — so they can decide when to go deeper.

This is mission control. Not a project manager's Gantt chart. Not a developer's issue tracker. A mission controller's panel: many live feeds, one person, fast triage.

### 1.2 The three candidates, decided

Three compositions were considered seriously:

---

**Candidate A — attention queue + activity river.**
A vertical priority queue (Linear's inbox model) plus a scrolling feed of narration across all active runs. Every item gets one row; the queue ranks by decayed attention score.

*Pro:* Extreme keyboard-friendliness. Very high line density. The river gives live peripheral awareness.
*Con:* A queue strips project context — "Approve gate" means nothing without knowing which project it belongs to and what state that project is in. Items are tasks in a system; projects are entities with history, state, and identity. At six projects, each with multiple signals, a queue becomes a list of decontextualised demands. Also: a queue view can't carry the richness of a project's state — a card with a gate + two running steps + streaming narration deserves more than one line of queue row.

**Verdict: wrong model for multi-project orchestration. Projects are not tasks.**

---

**Candidate B — spatial / zoomable canvas.**
Projects float in 2D space; the operator zooms in to see card detail, pans to navigate.

*Pro:* Infinite scale — 100 projects work. The operator can arrange their own layout.
*Con:* Navigation overhead is fatal to glanceability. Mission control's #1 requirement is that the answer to "what needs me?" is visible without navigation. A canvas requires the operator to remember WHERE they put things, pan, zoom — cognitive work that competes with the actual decision. Spatial memory helps when objects have a meaningful relationship to their positions; unrelated projects have none. Also: technically expensive, and the first time a project falls off-screen the glanceability promise is broken.

**Verdict: wrong model. Glanceability and navigation are in direct conflict.**

---

**Candidate C — status wall + live-feed sidebar.** *(Selected)*
A two-column layout. Left: the project wall (attention-banded cards, 2/3 of the viewport). Right: a live-feed sidebar (streaming narration across ALL active projects, 1/3 of the viewport). Above both: 48px chrome.

*Why it wins:*
- The wall gives each project **spatial identity and state richness** — a project card can carry a gate chip, a narration line, doc tiles, and actions in one glance.
- The **live-feed sidebar** solves the gap the UXFIX model leaves: you can see the NEEDS YOU band's narration in the card, but you cannot see what the QUIET projects are quietly doing. The sidebar shows live narration across ALL active projects — not just those in the NEEDS YOU band — giving the operator peripheral awareness without requiring navigation. This is the "activity river" concept, implemented as a sidebar rather than a background ticker.
- This composition maps to established mission-control references: Vercel's deployment list + build log sidebar; Railway's project grid + live log; Bloomberg's position grid + trade feed. These are not decoration choices — they are proven patterns for the exact cognitive task.

**Verdict: selected. The wall gives identity; the sidebar gives peripheral awareness.**

---

### 1.3 The concrete composition

```
1440×900 — the reference viewport
┌──────────────────────────────────────────────────────────────────────────────┐
│  [logo]  wicked-studio                       ● api-migration  [⚙ settings]   │  48px chrome
├───────────────────────────────────────────────────────┬──────────────────────┤
│  Projects                 sorted by what needs you ↓  │  Live               │
│  ─────────────────────────────────────────────────    │  ──────────────────  │
│  NEEDS YOU                                            │                     │
│  ┌───────────────────────┐  ┌───────────────────────┐ │  ● api-migration    │
│  │ ▔▔▔▔▔▔▔▔▔▔▔▔▔ [amber] │  │ ▔▔▔▔▔▔▔▔▔▔▔ [emerald] │ │  > writing AC-3…   │
│  │ q3-review-deck        │  │ api-migration         │ │                    │
│  │ ⏸ Gate: approve plan? │  │ ⚙ working · phase 2   │ │  ● upload-endpoint │
│  │  [Approve] [Reject]   │  │  "writing AC-3…"     │ │  > rate-limit fn   │
│  │  ▤ pitch.html  v4     │  │  ▤ spec.html  v1     │ │                    │
│  │  Chat Build Doc Video │  │  Chat Build Doc Video │ │  ● auth-refactor   │
│  └───────────────────────┘  └───────────────────────┘ │  > failed 12m ago  │
│                                                       │   [open run]       │
│  QUIET  (5)                             [expand ▾]    │                    │
│  ○ smoke-tests · 6d    ○ legacy-spike · 8d            │                    │
│  ○ notes · 2d          ○ scratch · new                │                    │
│                                                       │                    │
│  ▸ Not in a project (1)                               │                    │
└───────────────────────────────────────────────────────┴──────────────────────┘
   ~980px wall                                            ~460px live feed
```

**Chrome (48px):** logo slot (32×32, see §3.1), product name in `--font-sans` medium weight, connection status dot (green = live, amber = reconnecting, red = disconnected), settings icon. Nothing else. The chrome earns zero pixels for decoration.

**The wall (left, ~68% of viewport):** The UXFIX-001 band model, expressed in the new visual language. ACTIVE cards are ~200px tall; quiet-band rows are ~48px. The proportions are from the data, not from a fixed grid: 3 ACTIVE cards fit side by side at ~308px each; 2 wide at ~460px each. The grid is `auto-fill, minmax(280px, 1fr)`.

**The live feed (right, ~32% of viewport):** A narrow column with no header, no scrollbar. Each active project that has a running agent gets a block: a colored dot + project name (dim, small), then the last 2 narration lines in monospace. Blocks are separated by 8px gap. New lines fade in at the top of each block; old lines fade away when the block exceeds 3 lines. The feed subscribes to the same runtime store as the cards — it is not a separate socket.

### 1.4 Where live telemetry lives

**On the card (NEEDS YOU band):**
- A 2px accent-status bar at the very top of the card — color encodes the card's leading signal kind (`--status-gate` = amber, `--status-run` = emerald, `--status-fail` = red).
- One narration line below the project header — the last meaningful line from `boardAttention.ts`'s headline derivation rule (§3.4b of DES-MERGE-001), in `--font-mono`, `--text-sm`.
- The gate chip (if a gate is active) — the highest-contrast element on the card, amber pill, `[Approve] [Reject]` inline.

**In the live feed (right sidebar):**
- All active projects, not just those in NEEDS YOU. A project that is `executing` but whose attention score is just below the triage threshold still appears in the live feed — it is doing work, and the operator deserves peripheral awareness of it.
- The live feed is the ONLY place where cross-project narration aggregates. The cards are per-project; the feed is the system's heartbeat.

**In the project thread (inside a project):**
- Full narration stream per DES-MERGE-001 §3.4a — `LiveNarration`, collapsible, 4KB tail. This is unchanged.

### 1.5 How density becomes beauty

The three reference products the experience checklist judges against:

**Linear's restraint:** Dense monospace numbers, no chrome overhead, focus on text as information rather than decoration. Lesson: restraint IS the design. Every pixel that isn't information is a pixel that obscures information.

**Vercel/Railway's live-data surfaces:** Deployment status with colored state indicators, live build logs, sparkline activity charts. Lesson: live data IS the aesthetic. A live log streaming in a terminal-style pane is more beautiful than a static screenshot because it communicates liveness. The data IS the motion.

**A trading terminal's glanceability:** Everything the trader needs is visible without interaction. Color is used ONLY for signal (green = up, red = down, amber = alert). Typography is two faces: sans for labels, mono for numbers. Motion is reserved for state changes (a price tick blinks once when it changes). Lesson: visual hierarchy comes from contrast, not from decoration.

The wicked-studio aesthetic principles derived from these three:

1. **Information is the aesthetic.** No decorative gradients, no abstract imagery, no ornament that doesn't communicate. If a pixel doesn't carry data or affordance, it is background.

2. **One accent, used sparingly.** The accent color (the customizable one, default violet-indigo) appears on: the active mode segment, gate chips, primary action buttons, the logo slot border. Status colors are NOT the accent — they are a separate semantic layer. Everything else is surface and ink ramps.

3. **Two typefaces, one rule.** `--font-sans` (Inter) for labels, prose, project names, mode names. `--font-mono` (JetBrains Mono or system mono) for narration lines, code paths, version numbers, timestamps. The contrast between faces is the primary visual rhythm of the product — it makes the live data visually distinct from the chrome that frames it.

4. **The card is a micro-dashboard.** The ACTIVE card's beauty comes from packing meaning into a fixed space: the 2px status bar communicates state at a glance; the narration line communicates activity; the gate chip communicates demand; the doc tiles communicate production. Nothing competes for attention without earning it.

5. **Motion is state change, never decoration.** Cards transition between bands on attention-score change (300ms ease-out, transform + opacity). The narration line's newest line fades in (120ms ease-out). The gate chip pulses once on arrival (one 600ms pulse, not a loop). Nothing else moves unless state changes.

### 1.6 The motion grammar

| Trigger | Element | Motion | Duration | Easing |
|---|---|---|---|---|
| Card moves QUIET → NEEDS YOU | Card | slides up into NEEDS YOU band, height expands from 48px to ~200px | 300ms | `--ease-out` |
| Card moves NEEDS YOU → QUIET | Card | collapses to 48px row, slides into QUIET band | 300ms | `--ease-out` |
| New narration line arrives | Narration text | newest line fades in at top (opacity 0→1) | 120ms | `--ease-out` |
| Gate chip appears | Gate pill | opacity 0→1, then one amber pulse (scale 1→1.03→1) | 120ms + 600ms | `--ease-out`, `--ease-spring` |
| Gate answered | Gate chip | Approve→green flash then fade out; Reject→red flash then fade out | 400ms | `--ease-out` |
| Mode segment click | Active fill | slides to new segment (shared-element transition on the fill div) | 220ms | `--ease-out` |
| Live feed new block | Feed block | fades in at top | 220ms | `--ease-out` |
| Live feed old line removed | Line | fades out | 120ms | `--ease-out` |
| Band reorder | Board layout | CSS grid reorder, all cards animate to new positions | 380ms | `--ease-spring` |

**Rule: no animation loops.** The gate pulse runs once. Narration doesn't scroll; new lines appear. Nothing loops except the connection status dot's reconnecting animation (which is itself state communication, not decoration).

---

## 2 The design-token system

### 2.1 Principles

1. **Two layers: primitives and semantics.** Primitive tokens (`--_` prefix) hold raw values. Semantic tokens (no prefix) hold meaning. Components consume ONLY semantic tokens; they never reference primitives directly.
2. **One source of truth.** The token file is the product's visual contract. `tailwind.config.js` and any CSS-in-JS both derive from it — not the other way around.
3. **No component ships a raw color.** This is an enforced contract, not a convention (§2.13 lint rule). A hardcoded `#hex` anywhere a semantic token exists is a build error.
4. **Customization is token override.** Theming is `--_accent-h: 258` → change to `--_accent-h: 193`. The semantic layer recomputes automatically. No component code changes.
5. **Light theme is a theme instance.** Not a separate stylesheet or a rewrite — a `[data-theme="light"]` block that overrides the primitive surface and ink ramps. Every other token (spacing, motion, type) is theme-invariant.

### 2.2 The token hierarchy

```
primitives (--_)              semantics (no prefix)         components
─────────────────             ──────────────────────        ──────────
--_surface-0: #09090f   →     --surface-base                .card { background: var(--surface-card) }
--_surface-2: #1a1a26   →     --surface-card
--_accent-h: 258        →     --accent
--_accent-s: 72%        →     --accent-dim
--_accent-l: 62%        →     --accent-subtle
--_status-gate-h: 45    →     --status-gate
                              --status-gate-dim
```

Components never write `background: #1a1a26`. They write `background: var(--surface-card)`. The primitive that sets `--_surface-2` can be overridden by a theme; the semantic name stays stable.

### 2.3 Surface ramp (dark theme primitives)

```css
--_surface-0: #09090f;   /* deepest — page background */
--_surface-1: #11111a;   /* rail, sidebar backgrounds */
--_surface-2: #1a1a26;   /* card backgrounds */
--_surface-3: #242433;   /* raised elements, dropdowns */
--_surface-4: #2e2e40;   /* overlays, popovers */
```

Cold blue undertone (`hue ≈ 240°`) is deliberate: it reads as a serious tool and gives a natural base that the violet/indigo accent can sit on without fighting. Pure black (`#000`) was rejected — it collapses depth cues and makes the 2px status bar invisible on card edges.

Semantic surface tokens:
```css
--surface-base:    var(--_surface-0);  /* page bg */
--surface-rail:    var(--_surface-1);  /* rail, chrome */
--surface-card:    var(--_surface-2);  /* project cards */
--surface-raised:  var(--_surface-3);  /* dropdowns, chip popups */
--surface-overlay: var(--_surface-4);  /* modals, tooltips */
```

### 2.4 Ink ramp

```css
--_ink-a35: rgba(255, 255, 255, 0.35);
--_ink-a55: rgba(255, 255, 255, 0.55);
--_ink-a80: rgba(255, 255, 255, 0.80);
--_ink-100: #ffffff;
```

Semantic ink tokens:
```css
--ink-dim:    var(--_ink-a35);   /* timestamps, secondary labels */
--ink-muted:  var(--_ink-a55);   /* quiet-band project names, sublabels */
--ink-body:   var(--_ink-a80);   /* default prose, narration */
--ink-high:   var(--_ink-100);   /* project names in NEEDS YOU, gate text, primary actions */
```

### 2.5 Accent system

The accent is a **single hue**, expressed as HSL primitives so the customization layer (§3) only overwrites three numbers:

```css
--_accent-h: 258;    /* hue: violet-indigo default */
--_accent-s: 72%;    /* saturation */
--_accent-l: 62%;    /* lightness */
```

Semantic accent tokens (all auto-derived from the three primitives):
```css
--accent:        hsl(var(--_accent-h) var(--_accent-s) var(--_accent-l));
--accent-dim:    hsl(var(--_accent-h) var(--_accent-s) calc(var(--_accent-l) - 18%));
--accent-subtle: hsl(var(--_accent-h) calc(var(--_accent-s) * 0.35) calc(var(--_accent-l) - 30%));
--accent-fg:     var(--ink-high);   /* text ON accent — always white in dark theme */
```

Usage discipline: `--accent` appears on the active mode segment fill, gate chip confirm-state, primary action backgrounds, the logo slot border, and focus rings. It does NOT appear on status indicators (which use `--status-*`), on narration text, or on surface backgrounds.

### 2.6 Status colors

Status colors are **not the accent** and are **not customizable**. They are semantic signals — amber means "blocked", red means "failed", emerald means "running" — and their meaning depends on visual distinctness from each other AND from the accent. The mapper (§4.5) enforces this.

```css
/* primitives */
--_sg-h: 45;    /* gate: amber hue */
--_sf-h: 4;     /* failing: red hue */
--_sr-h: 148;   /* running: emerald hue */

/* semantics — light and dim variants for pill background vs pill text */
--status-gate:      hsl(var(--_sg-h) 90% 68%);
--status-gate-dim:  hsl(var(--_sg-h) 55% 22%);
--status-fail:      hsl(var(--_sf-h) 88% 62%);
--status-fail-dim:  hsl(var(--_sf-h) 45% 18%);
--status-run:       hsl(var(--_sr-h) 58% 58%);
--status-run-dim:   hsl(var(--_sr-h) 38% 16%);
--status-done:      var(--_ink-a35);
--status-done-dim:  transparent;
```

Usage: the 2px status bar on ACTIVE cards uses the `--status-*` (full) token. Gate chips use `--status-gate` text on `--status-gate-dim` background. Running narration pulse uses `--status-run-dim` as a subtle glow.

### 2.7 Spacing scale

Base unit: 4px. Scale is multiples:

```css
--space-1: 4px;   --space-2: 8px;   --space-3: 12px;  --space-4: 16px;
--space-5: 20px;  --space-6: 24px;  --space-8: 32px;  --space-10: 40px;
--space-12: 48px; --space-16: 64px;
```

Card internal padding is `--space-4`. Rail width uses `--space-16` as a reference (256px = 64 × 4). The chrome height is `--space-12`.

### 2.8 Type scale

Two faces. The face choice is never per-component — it follows the rule: prose/labels in sans, data/narration in mono.

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;

--text-2xs: 10px;
--text-xs:  11px;
--text-sm:  13px;
--text-md:  15px;
--text-lg:  18px;
--text-xl:  22px;
--text-2xl: 28px;

--weight-normal: 400;
--weight-medium: 500;
--weight-semi:   600;
--weight-bold:   700;

--leading-tight:  1.2;
--leading-body:   1.5;
--leading-loose:  1.75;
```

Typography hierarchy:
| Element | Font | Size | Weight | Color |
|---|---|---|---|---|
| Project name (NEEDS YOU card) | sans | `--text-md` | semi | `--ink-high` |
| Project name (quiet row) | sans | `--text-sm` | normal | `--ink-muted` |
| Mode tab label | sans | `--text-sm` | medium | active: `--ink-high`, inactive: `--ink-muted` |
| Active mode summary line | sans | `--text-xs` | normal | `--ink-dim` |
| Narration line (card, feed) | mono | `--text-xs` | normal | `--ink-body` |
| Gate chip text | sans | `--text-xs` | semi | `--status-gate` |
| Phase / status label | sans | `--text-2xs` | medium | `--ink-dim` |
| Purpose statement (Build) | sans | `--text-sm` | normal | `--ink-body` |
| Run intent label | sans | `--text-sm` | normal | `--ink-high` |
| Thread prose | sans | `--text-md` | normal | `--ink-body` |
| Thread narration | mono | `--text-sm` | normal | `--ink-body` |

### 2.9 Radius and shadow

```css
--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:  12px;
--radius-xl:  16px;
--radius-full: 9999px;   /* pills, dots */

/* Shadows encode elevation, not decoration */
--shadow-card:    0 1px 3px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05);
--shadow-raised:  0 4px 12px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.08);
--shadow-overlay: 0 8px 24px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.10);
```

Cards use `--radius-lg` and `--shadow-card`. Popovers use `--radius-xl` and `--shadow-overlay`. Pills use `--radius-full`. The 1px inset border in shadows prevents cards from disappearing into the dark background without adding visual border weight.

### 2.10 Motion tokens

```css
--ease-out:    cubic-bezier(0.16, 1, 0.3, 1);    /* smooth deceleration — most transitions */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* slight overshoot — gate pulse, board reorder */
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);      /* bidirectional — mode segment slide */

--dur-instant:  80ms;   /* hover state changes */
--dur-fast:    120ms;   /* narration line appear, chip micro-transitions */
--dur-base:    220ms;   /* mode segment slide, standard transitions */
--dur-slow:    300ms;   /* card band change */
--dur-slower:  380ms;   /* board reorder */
```

### 2.11 The contract: no component ships a raw color

**The rule:** No `.tsx`, `.css`, or `.ts` file in `src/` may contain a literal hex color (`#rrggbb` or `#rgb`), an `rgb()` or `rgba()` call with literal values, or an `hsl()` call with literal values — UNLESS it is in the token definition file itself (`src/styles/tokens.css`) or in the theme override files (`src/styles/themes/*.css`).

**Enforcement:** An ESLint rule using `no-restricted-syntax` targeting JSX `style` props with string color values, plus a PostCSS plugin (`postcss-no-raw-colors`) that fails the build on raw color values in `.css` files outside the token files. The rule runs in CI on every PR.

**Migration:** The slice-1 PR establishes the lint rule in warn mode; subsequent slices convert components to tokens and the rule moves to error mode by slice 3.

### 2.12 CSS custom property architecture

```
src/styles/
  tokens.css        ← primitive and semantic tokens (the single source of truth)
  themes/
    dark.css        ← the default; primitives that differ from tokens.css defaults
    light.css       ← light theme primitive overrides ([data-theme="light"])
  global.css        ← body/html resets, font loading; imports tokens.css
```

`tokens.css` is imported once in `main.tsx` (or in `global.css` which main imports). No component imports it directly — the cascade handles it.

`tailwind.config.js` extends colors using CSS var references:
```js
colors: {
  surface: { base: 'var(--surface-base)', card: 'var(--surface-card)', /* … */ },
  ink: { dim: 'var(--ink-dim)', body: 'var(--ink-body)', /* … */ },
  accent: 'var(--accent)',
  status: { gate: 'var(--status-gate)', /* … */ },
}
```

This gives Tailwind classes like `bg-surface-card`, `text-ink-body`, `border-status-gate` — all resolved at runtime from the CSS vars. No Tailwind color is hardcoded; every color class is a semantic alias.

### 2.13 The default dark theme expressed in tokens

The default theme (dark) IS `tokens.css` — no separate override needed. The file sets all primitives and all semantics. A browser with no `data-theme` attribute gets the dark theme.

The themes directory is for OVERRIDES only:
- `dark.css` is empty (or documents "this is the default; see tokens.css")
- `light.css` overrides the surface and ink primitives only (see §2.14)
- Per-install customization overrides the accent primitives via an inline `style` on `<html>` (see §3.3)

### 2.14 Light theme as a theme instance

Light theme is not a separate codebase. It is exactly four ramp overrides:

```css
/* themes/light.css — applied via [data-theme="light"] on <html> */
[data-theme="light"] {
  --_surface-0: #f4f4f8;
  --_surface-1: #eeeef4;
  --_surface-2: #e5e5ef;
  --_surface-3: #d8d8e8;
  --_surface-4: #ccccdc;

  --_ink-a35: rgba(0, 0, 0, 0.30);
  --_ink-a55: rgba(0, 0, 0, 0.52);
  --_ink-a80: rgba(0, 0, 0, 0.78);
  --_ink-100: #080810;
}
```

The accent, status colors, spacing, type, radius, and motion tokens are unchanged — they work on both surfaces. The status colors' dark-background optimisation (they use a dimmer background tint `--status-*-dim`) needs a light-theme audit: `--status-gate-dim: hsl(45 55% 22%)` is correct for dark (near-black background reads the amber fill) but incorrect for light (medium-dark amber on a light background is unreadable). Each status `-dim` token gets a light-theme override in `light.css` with higher lightness (`hsl(45 80% 88%)` for gate on light). This is in scope for slice 1.

---

## 3 Customization

### 3.1 The logo slot

The top-left of the chrome currently shows a hardcoded `[W]` glyph. The vision: a **32×32px reserved slot** that is either the default wicked mark (an SVG path, not a font character — so it scales cleanly and respects the accent color for its stroke) or a custom asset.

**The slot contract:**
- The slot is exactly 32×32. The custom logo asset is `object-fit: contain` within it — never stretched, never cropped. If the asset's aspect ratio differs from 1:1, it is letterboxed with transparent padding.
- `clearspace`: the slot has `--space-2` (8px) margin to all adjacent elements (the product name text and the left viewport edge). Nothing encroaches on this space.
- The default wicked mark uses `stroke: var(--accent)` — so it responds to accent color changes. A custom logo asset is rendered as-is (it is an external image; studio cannot restyle it).
- The asset is served from crew's settings API (see §3.3) — it is a URL, never an inline data URI in the bundle.
- When no custom logo is set, the default SVG mark renders. The `[W]` character fallback is removed (it is not a proper rendering of the mark at small size).

**Sizing and clearspace rules for custom logos:**
- Minimum legible size: 20×20 (scale down inside the 32×32 slot with 6px padding)
- Maximum pixel density: the slot is `@2x` aware — the URL is served via `srcset` if the API provides it, or fetched once and cached
- Monochrome logos are recommended (they work on any surface ramp). Multi-color logos are supported but not modified

### 3.2 Accent + palette surface in Settings

The Settings panel (`/system`, `SystemSettings.tsx`) gains a **Appearance** section — not a new page, a section within the existing Settings surface, consistent with the single-surface philosophy.

```
APPEARANCE
────────────────────────────────────────────────────────────
Logo
  [current logo thumbnail, 48×48]  [Upload or enter URL…]  [Remove]

Accent color
  [hue wheel, 240px diameter]
  Saturation ─────────────────●──── 72%
  Lightness  ─────────────────●──── 62%
  
  Preview:  [●●●● mode switcher preview ●●●●]  [gate chip]  [+ Build button]
            [Reset to default]

(Status colors — gate amber, failing red, running emerald — are fixed semantic
 signals and are not customizable.)
────────────────────────────────────────────────────────────
```

**The hue wheel:** A canvas-rendered HSL wheel (standard UX, 240px diameter). Dragging the handle updates `--_accent-h` live. The saturation and lightness sliders below it fine-tune the remaining two primitives. All three updates apply immediately to the page via an inline style override on `<html>` — this IS the live preview.

**The preview strip:** Three elements that use the accent token — the mode switcher's active fill, a gate chip (so the user sees accent vs status-gate side by side), and a primary action button — render in a constrained preview band using the live token values. The user sees contrast in context, not just a color swatch.

**Reset to default:** Restores `--_accent-h: 258`, `--_accent-s: 72%`, `--_accent-l: 62%`. Calls the settings API to persist. The logo is separate from the accent reset — logo and accent are independent.

### 3.3 Per-install persistence (crew settings API)

Studio reads and writes appearance settings through crew's settings API. The key is `studio.appearance`:

```json
{
  "studio.appearance": {
    "accent_h": 258,
    "accent_s": 72,
    "accent_l": 62,
    "logo_url": null
  }
}
```

On startup, `App.tsx` calls `GET /api/v1/settings` (or a targeted `GET /api/v1/settings/studio.appearance`), reads the appearance object, and applies it as an inline style on `document.documentElement`:

```typescript
document.documentElement.style.setProperty('--_accent-h', String(appearance.accent_h));
document.documentElement.style.setProperty('--_accent-s', `${appearance.accent_s}%`);
document.documentElement.style.setProperty('--_accent-l', `${appearance.accent_l}%`);
```

Inline style overrides CSS custom properties declared in `:root {}` in the stylesheet — the cascade mechanism that makes this work without a `!important` or runtime stylesheet injection.

The logo URL is applied as:
```typescript
if (appearance.logo_url) {
  document.documentElement.style.setProperty('--logo-url', `url(${JSON.stringify(appearance.logo_url)})`);
}
```

The logo slot's CSS uses `background-image: var(--logo-url, none)` and shows the default SVG when `none`.

**Persistence on change:** Every accent slider move debounces (400ms) before calling `PUT /api/v1/settings/studio.appearance`. The UI never waits for the PUT to complete before reflecting the change — optimistic update; the PUT is fire-and-forget with a silent retry on failure.

ASSUMPTION[external-transform] library=crew settings API transform=GET/PUT `/api/v1/settings` — the exact route shape and whether it is a flat key-value store or supports namespaced keys like `studio.appearance` needs verification against the crew codebase confidence=needs-research :: The studio side can adapt to either shape; what matters is that crew persists arbitrary JSON under a per-install namespace and returns it on the next GET. If the crew API does not yet have a settings endpoint, slice 7 must add it (crew-side, out of scope here as it crosses repo boundaries — flag for the implementing engineer).

### 3.4 Live preview

The live preview is NOT a modal with a sandboxed component tree. It is the ACTUAL PAGE — the accent token override on `<html>` immediately affects all rendered elements. The "preview strip" in Settings (§3.2) is just a convenient NEARBY example of the accent in use; the whole board and chrome behind the Settings panel is updating live.

This means:
- No preview iframe
- No "apply" step for the accent — what you see IS the current state
- The only "apply" step is the debounced PUT to persist it (so it survives a refresh)

### 3.5 Reset to default

Two resets are available:
1. **Accent reset** — restores the three accent primitives to defaults. Available in the Appearance section.
2. **Logo reset** — removes the custom logo, reverts to the default wicked mark. Available alongside the logo slot.

There is no "reset everything" button — logo and accent are independent choices. A user who spent time learning their brand's accent should not lose it when they remove a mistakenly uploaded logo.

---

## 4 Brand learning — the skill

### 4.1 The loop

wicked-interactive already learns themes from a URL, PDF, or image (§4.6 of DES-MERGE-001). Studio already proxies interactive through crew (`/api/v1/projects/:projectId/interactive/*`). The `learnTheme` and `listThemes` API wrappers are already typed in `src/api/interactive.ts`.

The loop is:

```
operator points at source → studio calls learnTheme → bridge queues the learn job →
agent extracts brand DNA → listThemes shows the theme as learned → mapper validates
and converts to studio token overrides → Settings panel previews → operator confirms →
PUT /api/v1/settings/studio.appearance persists
```

The skill is a **garden skill** (garden is THE skill catalog). It orchestrates this loop — it is not a new service. All capability exists; the skill is the coordination layer and the mapper is the only net-new code.

### 4.2 The garden skill definition

```yaml
# .garden/skills/studio-learn-brand.yaml
name: wicked-studio:theming:learn-brand
description: >
  Extract a brand's visual identity from a URL, PDF, or image using
  wicked-interactive's theme-learn machinery, map it to studio's
  design-token set, and apply it as the per-install appearance.

inputs:
  source:
    type: string
    description: >
      The brand source. One of:
        • A live URL (https://…) — captured headlessly by the interactive bridge.
          The SSRF guard (loopback/private/link-local rejection) applies server-side;
          the skill sends the URL to the proxy, never fetches it directly.
        • An absolute local path to a PDF — read server-side, nothing uploads.
        • An absolute local path to an image (PNG/JPG/SVG) — read server-side.
    required: true
  project_id:
    type: string
    description: >
      The crew project whose interactive root is used. The brand theme
      is learned within this project's scope and applied per-install.
    required: true
  apply:
    type: boolean
    default: false
    description: >
      If true, the skill applies the theme immediately after preview
      without waiting for explicit confirmation. Use for automation;
      interactive use should leave this false (the Settings UI handles confirm).

outputs:
  theme_id:
    type: string
    description: The interactive bridge's identifier for the learned theme.
  token_overrides:
    type: object
    description: >
      The studio token overrides derived by the mapper. Keys: accent_h, accent_s,
      accent_l, logo_url (null when no logo asset was found).
  applied:
    type: boolean
  mapper_adjustments:
    type: array
    description: >
      Any adjustments the mapper made to satisfy contrast or distinctness constraints.
      Each entry: { constraint, original, adjusted, reason }.
```

**Invocation** from the Settings panel is studio-direct (no garden agent spawned for the interactive path — the studio UI calls the API itself and runs the mapper in the client). The skill is invoked when the user wants to drive brand-learn from a wicked-garden context (e.g., a crew run that sets up a project's branding as part of its workflow). Both paths use the same mapper logic.

### 4.3 The studio Settings surface

The Appearance section (§3.2) gains a **Learn from brand source** row:

```
Learn from brand source
  ○ URL         ○ Local PDF         ○ Image file
  [https://brand.example.com…                    ] [Learn]
  
  status: ─ (idle) / "Queued — agent is reading the brand…" / "Ready — preview below"
  
  [preview accent chip]  [preview mode switcher]     [Apply]  [Discard]
```

The flow:
1. User enters source and clicks Learn.
2. Studio calls `learnTheme(projectId, { kind, url | path })` → gets `{ theme_id, status: 'queued', message }`.
3. Status shows the bridge's `message` verbatim (§3.3 actionable: show it, never paraphrase).
4. Studio polls `listThemes(projectId)` every 3s. When the `theme_id` appears in the list AND its `learned_at` is set, the learn is complete.
5. Studio calls `getTheme(projectId, theme_id)` (see §4.4) to retrieve the palette.
6. The mapper (§4.5) converts the palette to token overrides and checks constraints.
7. The preview strip updates with the mapped accent. Any adjustments are disclosed below the preview ("Contrast was adjusted: original lightness 45% raised to 55% for WCAG AA on dark surfaces").
8. User clicks Apply → the token overrides are written to the crew settings API. User clicks Discard → no change.

### 4.4 API path through the existing proxy

The existing typed wrappers cover `learnTheme` and `listThemes`. One new wrapper is needed:

```typescript
// src/api/interactive.ts (addition for §4.4)

/**
 * Full theme data for one learned theme — the palette the mapper consumes.
 * `GET /api/themes/:themeId` — bridge-root-relative, per (§4.6 of DES-MERGE-001).
 *
 * The shape is the interactive service's own theme JSON format (src/themes/*.json),
 * which the bridge already reads for `core/theme.js`. The fields here are the
 * minimum the mapper needs; additional fields are tolerated (tolerant reading).
 */
export interface ThemeDetail {
  name: string;
  primary?: string;    /* CSS color string — dominant brand color */
  secondary?: string;  /* CSS color string — secondary brand color, if extracted */
  background?: string; /* CSS color string — brand background, if extracted */
  logo_url?: string;   /* URL within the bridge to a logo asset, if found */
}

export function getTheme(projectId: string, themeId: string): Promise<ThemeDetail> {
  return iFetch<ThemeDetail>(`${interactiveBase(projectId)}/api/themes/${encodeURIComponent(themeId)}`);
}
```

ASSUMPTION[external-transform] library=wicked-interactive theme-learn agent transform=brand source (URL / PDF / image) → extracted palette JSON with primary, secondary, background color strings confidence=needs-research :: The interactive bridge's `learn-a-theme` machinery runs a garden specialist agent that reads the brand source and outputs a theme JSON. The exact fields in the output (whether `primary`, `secondary`, `background` are always present, and whether a `logo_url` is extracted) need verification against `src/themes/*.json` examples and the agent's output contract. The mapper must be tolerant: treat absent fields as null and derive what it can from what is present. If only `primary` is present, map it to accent and leave the rest as defaults.

### 4.5 What the mapper must guarantee

The mapper (`src/theming/brandMapper.ts`) takes `ThemeDetail` and returns `{ accent_h, accent_s, accent_l, logo_url, adjustments[] }`. It is a pure function with no side effects.

**Four guarantees, in priority order:**

1. **WCAG AA contrast floor — accent vs card surface.**
   `contrast(--accent, --surface-card) ≥ 4.5:1`. The mapper computes the actual contrast ratio of the candidate accent against `#1a1a26` (the dark card surface default). If below 4.5:1, it raises `accent_l` until the floor is met, caps at 90%. If the floor cannot be met by lightness alone (extremely low saturation), it raises saturation to 40% minimum. Each adjustment is logged as a `mapper_adjustment` entry.

2. **Status-color distinctness — minimum 30° hue separation.**
   The accent hue must be ≥30° from each status hue (gate: 45°, failing: 4°, running: 148°). If the extracted `primary` color's hue violates this, the mapper searches ±5° increments in both directions for the nearest non-conflicting hue. If both directions conflict (unlikely but possible), it selects the direction that maximizes total distance from all three status hues.

3. **Saturation and lightness clamps.**
   `accent_s ∈ [20%, 88%]` — prevents the accent from being a near-grey (below 20%) or a neon that dominates the dark surfaces (above 88%). `accent_l ∈ [42%, 78%]` in dark theme — prevents the accent from disappearing into the dark background (below 42%) or washing out as white (above 78%).

4. **Accent vs status visual distinctness (perceptual).**
   After hue-angle enforcement, the mapper checks that the accent's full computed color has a perceptual distance (CIEDE2000 or a simplified deltaE approximation) from each status color of ≥ 25 units. This catches the case where a 30°-apart hue still reads as nearly the same color due to saturation/lightness proximity. If perceptual distance is below threshold for any status color, lightness is adjusted by ±10% to push them apart.

**Logo handling:** If `ThemeDetail.logo_url` is present, the mapper returns it as `logo_url` — no transformation. The URL is bridge-relative; the Settings UI resolves it through `interactiveUrl(projectId, logo_url)` to get a same-origin URL. The crew settings API stores the fully resolved URL (not the bridge-relative path), because the logo must survive the bridge being unavailable (it is served by crew's settings layer at that point).

**No silent truncation:** If the mapper could not find a satisfying combination (all hue positions conflict, saturation cannot be raised), it returns an `adjustments` entry with `constraint: 'unsatisfiable'`, the original values, and a human-readable reason. The UI shows this and does not apply the theme silently.

---

## 5 Per-surface compositions

### 5.1 Orchestrator home (`/`)

The composition is §1.3's wireframe. Changes from UXFIX-001's implementation:

**New:** The live-feed sidebar (right column, ~460px). `LiveFeed.tsx` — a new component. Subscribes to the same runtime store as the cards. Shows narration from ALL projects with active runs (not just NEEDS YOU), newest lines at top per project block. Zero new sockets — the existing `/ws` subscription powers it.

**New:** The 2px status bar at the card top. The ACTIVE card gains a `border-top: 2px solid var(--status-gate)` (or `--status-run`, `--status-fail`) driven by the leading signal kind from `topSignal()`. This replaces the attention pill — the pill was a label; the bar IS the color.

**Changed:** Card visual language. The ACTIVE card now uses the token system throughout:
- `background: var(--surface-card)` (was hardcoded `#1f1f2d`)
- `box-shadow: var(--shadow-card)` 
- Project name: `font: var(--weight-semi) var(--text-md) var(--font-sans); color: var(--ink-high)`
- Narration: `font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-body)`
- Gate chip: `background: var(--status-gate-dim); color: var(--status-gate)`

**Preserved from UXFIX-001:**
- Attention decay model (`boardAttention.ts`) — unchanged
- Band structure (NEEDS YOU / QUIET / Not in a project) — unchanged
- Empty-state budget (one line per quiet card) — unchanged
- Answerable gate chips (inline Approve/Reject for simple gates) — unchanged

**Token usage in HomeBoard.tsx:**
```
--surface-base       → page background
--surface-card       → card background
--surface-rail       → band headers, live-feed background
--status-*           → status bar, gate chip, run chip color
--ink-*              → all text
--space-4            → card padding
--space-8            → card gap
--radius-lg          → card border-radius
--shadow-card        → card box-shadow
--font-sans          → all label text
--font-mono          → narration lines
--dur-slow           → card band-change transition
--ease-out           → all transitions
```

**Motion notes:**
- Board reorder on attention-score change: CSS grid + `transition: all var(--dur-slower) var(--ease-spring)` on each card. The QUIET band collapse/expand uses `max-height` + `opacity` transition.
- Live-feed new line: `@keyframes feedIn { from { opacity:0; transform: translateY(-4px) } to { opacity:1; transform:none } }`, `animation: feedIn var(--dur-fast) var(--ease-out)`.

### 5.2 Project shell + mode switcher

The project shell is the frame that holds the mode switcher and the active mode surface. It has four visual elements: the breadcrumb (project name linking back to `/`), the mode switcher, the mode surface, and the connection status.

**Mode switcher (new visual language):**

```
1440px project shell — mode switcher at top of content area (not in chrome)
┌──────────────────────────────────────────────────────────────────────────┐
│  [logo] wicked-studio  ▸  q3-review-deck        ● live  [⚙ settings]    │  chrome
│  ─────────────────────────────────────────────────────────────────────  │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐          │  │
│  │  │💬 Chat   │ │⚙ Build  │ │▤ Document    │ │▶ Video   │          │  │  switcher
│  │  │          │ │ [filled] │ │              │ │          │          │  │
│  │  └──────────┘ └──────────┘ └──────────────┘ └──────────┘          │  │
│  │  ship code, with checks                                            │  │  active summary
│  └────────────────────────────────────────────────────────────────────┘  │
│  ─────────────────────────────────────────────────────────────────────  │
│  [ mode surface ]                                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

The switcher is a `role="tablist"` with four `role="tab"` segments. The active segment uses:
```css
background: var(--accent);
color: var(--accent-fg);   /* = var(--ink-high) */
border-radius: var(--radius-md);
```

Inactive segments:
```css
background: transparent;
color: var(--ink-muted);
```
On hover:
```css
background: var(--surface-raised);
color: var(--ink-body);
```

The active summary line below the switcher: `font: var(--weight-normal) var(--text-xs) var(--font-sans); color: var(--ink-dim)`. This is always visible (not tooltip-only — the UXFIX-001 change carries forward).

**The active fill slides** between segments via a positioned `<div>` that transitions its `left` and `width`: `transition: left var(--dur-base) var(--ease-in-out), width var(--dur-base) var(--ease-in-out)`. The segment labels do not move — only the fill underlayer animates.

**Preserved from UXFIX-001:** Disabled modes remain `disabled` (not hidden) with a tooltip naming the enabling action. Glyphs match quick actions on the board.

### 5.3 Chat

```
PROJECT: q3-review-deck / CHAT MODE
┌──────────────────────────────────────────────────────────────────────────┐
│  💬 [Chat] ⚙ Build ▤ Document ▶ Video     talk it through                │  switcher
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
│         [thread when running — left 60%, narration right side]            │
│                                                                           │
│  ─  (first run, nothing typed)  ────────────────────────────────────────  │
│                                                                           │
│         Chat with an agent about this project.                            │
│         No run yet — describe what you want or say "make me a deck"       │
│         and I'll switch you to the right mode.                            │
│                                                                           │
│         ┌────────────────────────────────────────────────────────────┐   │
│         │ Describe what you want…                                     │   │
│         └────────────────────────────────────────────────────────────┘   │
│         [ + Add agents ]                                                  │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
```

**Token usage:** Composer background `var(--surface-raised)`, border `1px solid rgba(255,255,255,0.08)`, radius `var(--radius-xl)`. Thread messages use `var(--surface-card)` for agent bubbles, transparent for user. "Add agents" is `color: var(--accent)` — low-key but on-accent to signal it's interactive.

**Changes from UXFIX-001:** The visual language of the first-run state now uses the token system and the two-typeface rule. The instruction text is in `--font-sans --ink-body`; no change to the single-agent default, the opt-in roster, or the "Close" vs "End chat" vocabulary (already corrected by UXFIX-001).

**Motion:** The composer focus ring uses `box-shadow: 0 0 0 2px var(--accent-dim)` (not `--accent` at full opacity — too dominant). Multi-agent roster disclosure animates at `--dur-base` ease-out.

### 5.4 Build

```
PROJECT: api-migration / BUILD MODE
┌──────────────────────────────────────────────────────────────────────────┐
│  💬 Chat ⚙ [Build] ▤ Document ▶ Video     ship code, with checks         │
│  ─────────────────────────────────────────────────────────────────────  │
│  Build runs governed code work: an agent writes, an independent check     │  purpose (2 lines)
│  grades, and you approve the gates. Everything it produces is evidence.   │
│  ─────────────────────────────────────────────────────────────────────  │
│  ⏸ 1 gate needs you — approve the acceptance criteria? [review →]        │  gate inbox
│  ─────────────────────────────────────────────────────────────────────  │
│                                                                           │
│  RUNS                                                                     │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ⚙  Add rate-limiting to the upload endpoint        working  2/4  ▸ │  │  intent label
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ ⏸  Migrate the auth tables                         gate     3/4  ▸ │  │
│  ├───────────────────────────────────────────────────────────────────┤  │
│  │ ✓  Fix the flaky login test                         done     2h   ▸ │  │
│  └───────────────────────────────────────────────────────────────────┘  │
│                                                                           │
│  [ + Build something ]                                        cost: $0.24 │  footer stat
└──────────────────────────────────────────────────────────────────────────┘
```

**Token usage:** Purpose statement `--ink-body --text-sm`. Gate inbox pill `--status-gate-dim` background, `--status-gate` text. Run rows: intent label `--ink-high --text-sm`, phase label `--ink-dim --text-2xs --font-mono`, status icon color matches `--status-*`. Cost footer `--ink-dim --text-xs --font-mono` — the cost stat is a data point, not a hero; mono because it's a number.

**Changes from UXFIX-001:** Token system applied throughout. The RUNS list row now has a thin `border-left: 2px solid var(--status-*)` that encodes run state at the list edge — the eye can scan the left margin for color without reading labels. Everything else from UXFIX-001 slice 5 (purpose statement, no campaigns panel, intent labels, one primary action) is preserved.

**Motion:** Run row appears on creation with a fade-in (`--dur-fast`). State transitions (working → gate) recolor the status icon and border-left with `transition: color var(--dur-base), border-color var(--dur-base)`.

### 5.5 Document

```
PROJECT: q3-review-deck / DOCUMENT MODE — three-pane composition
┌──────────────────────────────────────────────────────────────────────────┐
│  💬 Chat ⚙ Build ▤ [Document] ▶ Video     a deck, page, or report        │
│  ─────────────────────────────────────────────────────────────────────  │
│  ┌──────────────────────────────────────┐  │  THREAD                     │
│  │                                      │  │  ┌───────────────────────┐  │
│  │   [canvas: rendered doc, sandboxed]  │  │  │ you: make a Q3 deck   │  │
│  │                                      │  │  │ agent: planning…      │  │
│  │                                      │  │  │ ▤ v1 landed           │  │
│  │                                      │  │  │ you: tighten slide 3  │  │
│  │                                      │  │  │ ▤ v2 landed           │  │
│  └──────────────────────────────────────┘  │  └───────────────────────┘  │
│  ┌── VERSION STRIP ─────────────────────┐  │  ┌───────────────────────┐  │
│  │ ◂ v1   ● v2   v3 ▸   [Themes][Export]│  │  │ Describe a change…   │  │
│  └──────────────────────────────────────┘  │  └───────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
  ~640px canvas + 36px strip              ~440px thread
```

**Token usage:** Canvas container `border: 1px solid rgba(255,255,255,0.08)` (subtle framing without a heavy stroke), `border-radius: var(--radius-lg)`. Version strip `background: var(--surface-rail)`, active version dot `background: var(--accent)`. Thread `background: var(--surface-base)`. Version tags in thread (`▤ v2 landed`) use `--status-done` with a `--radius-sm` badge.

**The cross-link animation:** Selecting a version in the strip scrolls the thread with `scrollIntoView({ behavior: 'smooth' })` AND briefly highlights the version-tag message with a 1s fade of `background: var(--accent-subtle)`.

**Changes from UXFIX-001:** Token system applied. The Themes button in the version strip now reads "Themes" (not "theme library") and its popover opens with the one-line explanation using `--font-sans --ink-body --text-sm`. Export button is adjacent to Themes. The canvas container is framed more cleanly. Everything from UXFIX-001 slice 6 (three-pane layout, cross-link, empty state) is preserved.

### 5.6 Video

```
PROJECT: q3-review-deck / VIDEO MODE
┌──────────────────────────────────────────────────────────────────────────┐
│  💬 Chat ⚙ Build ▤ Document ▶ [Video]     record a demo                  │
│  ─────────────────────────────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │  ▶  [player: the recorded video]                                    │ │
│  │  1  2  3  4  ← chapter thumbnails (storyboard)                     │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────────────────────────┐ │
│  │ THREAD                                                               │ │
│  │  you: record the upload flow   agent: authored the spec…             │ │
│  │  recording: step 2 of 5 — clicking Upload                           │ │
│  │  ▶ recording complete — v1                                           │ │
│  │  ┌──────────────────────────────────────────────────────────────┐   │ │
│  │  │ Comment on a step, or ask for a new recording…               │   │ │
│  │  └──────────────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────┘
```

Video mode is stacked vertically (player + storyboard on top, thread below) rather than side-by-side, because the player benefits from horizontal width. The storyboard chapter thumbnails use `background: var(--surface-raised)` with a `border: 2px solid var(--accent)` on the selected chapter.

**Token usage:** Player container same framing as canvas in Document mode. Recording status narration in `--font-mono --text-xs --ink-body`. Chapter thumb caption `--text-2xs --ink-dim`. The "recording complete" tag mirrors the version-tag badge from Document mode: visual consistency across modes.

**Preserved from UXFIX-001:** All narration rules (never bare "Working…", recording status names its subject and step), the ffmpeg-missing actionable state.

---

## 6 Slice plan

### 6.0 Ground rules

All rules from DES-UXFIX-001 §4.0 carry forward:
- Each PR is **≤350 LOC of production diff** (tests excluded from the count, never from the PR).
- Each PR is independently mergeable and independently revertable.
- Each PR follows the repo merge protocol (branch, open PR, wait 6–8 min for bots + CI, address, merge).
- **Every slice's gate is a named screenshot** at exactly 1440×900, captured via the existing `e2e/studio_standalone_test.py` Playwright harness, saved to `e2e/shots/vision/`, judged against the experience checklist (§6.1).
- Every slice preserves all UXFIX-001 behaviors it touches — the attention model, the band structure, the mode switcher weights, the empty-state budget. Regressions are build failures, not review findings.
- **Tokens first** — slice 1 is the enabler. No other slice ships new visual language until it can use semantic tokens.

### 6.1 The experience checklist (extends DES-UXFIX-001 §4.1)

EC1–EC10 from DES-UXFIX-001 carry forward unchanged. Added:

- **EC11 — Information is the aesthetic.** No decorative gradients, abstract imagery, or ornament without data meaning appear in the shot. (§1.5)
- **EC12 — Accent is singular.** Only one hue family appears as the interactive/brand accent; status colors (amber, red, emerald) are visually distinct from the accent. (§2.5, §2.6)
- **EC13 — Two typefaces, one rule.** Narration and data read in monospace; labels and prose read in the humanist sans. The contrast between faces is visible in any screenshot showing both. (§2.8)
- **EC14 — The live feed is live.** In any shot taken after a `unitOutputDelta` event, the live-feed sidebar reflects the update. (§5.1)
- **EC15 — Token discipline.** No `data-testid`-targeted element has a computed `background`, `color`, or `border-color` that is a literal hex — it resolves from a CSS custom property. (§2.11; asserted via `getComputedStyle` in Playwright, not just visual inspection.)
- **EC16 — Logo slot respected.** When a custom logo URL is set, the W mark is absent; the custom asset is contained within 32×32 without crop or distortion. (§3.1)

### 6.2 The W2 messy-reality fixture (carries over)

DES-UXFIX-001 §4.2's fixture is used unchanged. Every vision screenshot runs against it or a named subset. The fixture includes `legacy-spike` (8-day failure) and `upload-endpoint` (live run) — the pair that proves the decay math (EC4). Frozen `now` for deterministic ages.

### 6.3 Slices

---

**Slice 1 — Token foundation** *(~300 LOC, the enabler)* — serves §2 entirely.

Create `src/styles/tokens.css` (primitives + semantics); `src/styles/themes/light.css` (light-theme surface and ink overrides including light-theme status-dim corrections); update `tailwind.config.js` to extend colors from CSS vars; add the no-raw-color ESLint rule in **warn** mode; update `src/styles/global.css` to import `tokens.css`; convert `index.css` to import `global.css`.

No component changes. Zero visual change. The lint rule fires warnings on the ~40 hardcoded hex values across existing components — these are addressed slice by slice.

*DOM AC:* `document.documentElement.style.getPropertyValue('--surface-card')` is non-empty in a Playwright browser context; `npm run lint` exits 0 with warnings (not errors) on hardcoded hex in existing components; `npm run build` succeeds.
*Screenshots:* `vision-1-token-check.png` — the board unchanged, confirming zero visual regression. A Playwright `getComputedStyle` assertion on `[data-testid="project-card"]` confirms `background` resolves as `rgb` (from the existing hardcoded value), not yet from a token — this is the baseline the next slice moves from.
*Checklist:* EC15 (baseline recorded, not yet passing for components — passing is the target of slice 2+).
*UXFIX preserved:* No component changed; all UXFIX behaviors inherited by definition.

---

**Slice 2 — Orchestrator home reimagined** *(~340 LOC)* — §5.1.

`HomeBoard.tsx`: apply token system throughout (replace all hardcoded colors with semantic tokens); add the 2px status-bar to ACTIVE card top; convert narration text to `--font-mono`. Add `LiveFeed.tsx` (~120 LOC): subscribes to the runtime store, renders the streaming narration blocks. `ProjectCard.tsx`: token conversion + status bar. Move lint rule to **error** for all files touched in this slice.

*DOM AC:* `data-testid="live-feed"` is present and non-empty when at least one project has an active run; a `unitOutputDelta` event for project B updates `[data-testid="live-feed-block-B"]` within 2s without navigation; `getComputedStyle([data-testid="project-card"])` resolves `background` from `var(--surface-card)` (EC15 passing for these components). The 2px status bar's `border-top-color` matches `--status-gate` for the gate-waiting card in the W2 fixture.
*Screenshots:* `vision-2-home-live-feed.png` (full W2 board + live feed), `vision-2-active-card.png` (ACTIVE card closeup showing status bar + narration + gate chip in mono + tokens).
*Checklist:* EC3, EC4, EC11, EC12, EC13, EC14, EC15.
*UXFIX preserved:* Attention decay and band structure (boardAttention.ts untouched); empty-state budget (card quiet-summary still one line); answerable gate chips; all UXFIX-001 checklist items.

---

**Slice 3 — Chrome + mode switcher** *(~280 LOC)* — §3.1, §5.2.

App chrome (`AppChrome.tsx` or equivalent): logo slot (32×32, CSS var `--logo-url` fallback, default SVG mark using `stroke: var(--accent)`), product name, connection status dot, settings icon. Token conversion for all chrome elements. `ModeSwitcher.tsx`: the active fill slide animation (positioned `<div>` with transition on `left`/`width`), inactive/hover token states. Move lint rule to error for all files touched.

*DOM AC:* `[data-testid="logo-slot"]` has `background-image` resolving from `--logo-url` CSS var (even when empty/none); the active mode segment has `background` resolving from `var(--accent)` and `color` from `var(--accent-fg)` (EC15); the active fill `<div>` transition fires on mode change (assert via `page.waitForFunction` on computed left value changing); connection status dot has `data-state` attribute matching the websocket state.
*Screenshots:* `vision-3-chrome.png` (chrome closeup), `vision-3-switcher-active.png` (mode switcher with Build active, showing filled segment and summary line), `vision-3-switcher-transition.png` (mid-transition frame — capture via CDP timeline).
*Checklist:* EC8, EC11, EC12, EC15.
*UXFIX preserved:* All UXFIX-001 §2.5 mode-switcher properties (glyphs match board quick actions, active summary always visible, disabled modes remain disabled not hidden).

---

**Slice 4 — Chat + Build surfaces** *(~320 LOC)* — §5.3, §5.4.

`GroupChat.tsx`, `ChatPanel.tsx`: token conversion, first-run state visual (instruction text in sans/ink-body, composer focus ring using `--accent-dim`). `CenterDashboard.tsx`: token conversion, run row left-border encoding status (`border-left: 2px solid var(--status-*)`), cost footer in mono/dim. Move lint rule to error for all files touched.

*DOM AC:* `[data-testid="build-purpose"]` text is `color` resolving from `--ink-body` (EC15); a run row's computed `border-left-color` matches `--status-gate` when that run is at `awaiting_human`; the Chat mode first-run state shows the instruction text and `data-testid="add-agents"` is present but no `openChat` request fires on mount.
*Screenshots:* `vision-4-chat-firstrun.png`, `vision-4-build-runs.png` (Build mode with W2 fixture's running + gate runs visible, showing left-border coloring).
*Checklist:* EC7, EC10, EC11, EC13, EC15.
*UXFIX preserved:* Build purpose statement always visible; campaigns panel absent; intent labels on runs; Chat single-agent default; "Add agents" opt-in; all relevant UXFIX-001 checklist items.

---

**Slice 5 — Document + Video surfaces** *(~300 LOC)* — §5.5, §5.6.

`DocumentCanvas.tsx`, `VersionStrip.tsx`, `DocumentThread.tsx`: token conversion; version-tag cross-link highlight (`--accent-subtle` fade on scroll-to); Themes button label + popover one-liner in correct tokens. `VideoStoryboard.tsx`: token conversion, chapter thumb `border: 2px solid var(--accent)` on active chapter. Move lint rule to error for all files touched.

*DOM AC:* Version strip active dot computed `background` resolves from `var(--accent)` (EC15); the Themes popover `data-testid="themes-explanation"` is non-empty; selecting a chapter in the storyboard applies `border-color` from `--accent`.
*Screenshots:* `vision-5-document.png` (Document mode, three-pane, W3 flow: v2 selected, thread showing version tags), `vision-5-video.png` (Video mode with storyboard thumbnails).
*Checklist:* EC7, EC9, EC11, EC13, EC15.
*UXFIX preserved:* Document three-pane relationship; version cross-link scrolling; Themes explanation on open; Video narration rules (never bare "Working…").

---

**Slice 6 — Remaining component token conversion** *(~280 LOC)* — finishes §2.11.

Convert all remaining components that still have hardcoded colors (the ~40 remaining warnings from slice 1's lint baseline). This is a bulk conversion slice: no behavioral change, no new features. Move the lint rule from warn to **error** globally.

*DOM AC:* `npm run lint` exits 0 with NO warnings on hex color values across all of `src/`; a Playwright `getComputedStyle` sweep across 10 key `data-testid` elements confirms all `background`/`color`/`border-color` values resolve through `var()` references (EC15 passing globally).
*Screenshots:* `vision-6-token-complete.png` — the W2 board, confirming zero visual regression from slices 1–5 after the bulk conversion.
*Checklist:* EC15 (globally passing for the first time).
*UXFIX preserved:* All UXFIX behaviors unchanged — this slice is mechanical color replacement only.

---

**Slice 7 — Customization UI** *(~330 LOC)* — §3.

`SystemSettings.tsx` or a new `AppearanceSettings.tsx` section: logo slot (upload/URL input, preview, remove), accent picker (hue wheel via canvas, sat/lgt sliders), preview strip (mode segment + gate chip + primary button), reset-to-default. Settings read/write via crew settings API (`GET/PUT /api/v1/settings/studio.appearance`). `App.tsx` startup: reads appearance and applies via `document.documentElement.style.setProperty`.

*DOM AC:* On settings load, `document.documentElement.style.getPropertyValue('--_accent-h')` matches the stored value; dragging the hue wheel updates `--_accent-h` on `<html>` within one animation frame; a `PUT` to the settings endpoint fires after 400ms debounce (assert via `page.waitForRequest`); reset restores `--_accent-h: 258`; with a logo URL set, `[data-testid="logo-slot"]` has non-none `background-image` and `[data-testid="logo-wicked-mark"]` is absent.
*Screenshots:* `vision-7-appearance-settings.png` (Settings panel open, Appearance section visible with hue wheel and preview strip), `vision-7-custom-accent.png` (board and chrome with a custom accent hue applied, e.g. teal ≈ 180°).
*Checklist:* EC12 (custom accent is singular — no status color conflict visible), EC15, EC16.
*UXFIX preserved:* No UXFIX surfaces touched; Settings panel additions are additive.

---

**Slice 8 — Brand-learn skill + Settings integration** *(~320 LOC)* — §4.

`.garden/skills/studio-learn-brand.yaml` (the skill definition); `src/theming/brandMapper.ts` (~100 LOC, pure function: ThemeDetail → token overrides + adjustments, with the four guarantees of §4.5); `src/api/interactive.ts` addition: `getTheme` wrapper; Appearance Settings section: "Learn from brand source" UI (source type radio, input, Learn button, status display, preview update, Apply/Discard); polling logic (`listThemes` every 3s until learned).

*DOM AC:* Clicking Learn with a valid URL fires exactly one request to `/api/v1/projects/:id/interactive/api/theme/learn` and zero requests to the target URL itself (`page.on('request')` filter); the status `data-testid="learn-status"` shows the bridge's `message` verbatim; after polling finds the theme, the preview strip updates with the mapped accent; `PUT` to settings fires on Apply; clicking `http://169.254.169.254/` is rejected by the bridge (503 or 400) and the status shows the verbatim error with no outbound request to the metadata address; a mapper that produces an adjustment logs it in `data-testid="mapper-adjustments"`.
*Screenshots:* `vision-8-brand-learn-running.png` (Settings with a learn in progress, status message visible), `vision-8-brand-learn-applied.png` (board and chrome with a brand-learned accent from a test URL, showing EC12: accent distinct from status colors).
*Checklist:* EC12, EC15, EC16 (logo from brand if extracted).
*UXFIX preserved:* No UXFIX surfaces touched; brand-learn is a new capability, not a replacement.

### 6.4 Sequencing

```
Slice 1 (tokens) → must land first; blocks all others on EC15.

Slice 2 (home) → after slice 1; the keystone surface.
Slice 3 (chrome) → after slice 1; independent of slice 2.
Slices 2 and 3 can run in parallel.

Slices 4, 5 (surfaces) → after slices 1 and 3 (chrome tokens needed); parallel.

Slice 6 (bulk token conversion) → after slices 1–5 (converts what remains).

Slice 7 (customization UI) → after slice 1 and 3; independent of 4–6.

Slice 8 (brand-learn) → after slice 7 (uses the appearance persistence path).
```

**The single hard prerequisite chain:** 1 → { 2 ∥ 3 } → { 4 ∥ 5 } → 6 → 7 → 8.

No slice removes a behavior from the parity ledger (DES-MERGE-001 §4.10). No slice changes the IA (DES-MERGE-001 §1). Every slice is a pure addition or visual-language conversion.

---

## 7 Out of scope (named, so they are not assumed)

- **Light theme full QA pass.** `themes/light.css` establishes the primitive overrides in slice 1, but a full design review and acceptance-screenshot pass for light theme is a follow-on. Light theme is a theme instance that works; it is not a first-class design target of this arc.
- **Token adoption in crew, wicked-interactive, or any other repo.** The token system is studio-only. Interactive's theme machinery (§4.6) is embedded and untouched; it produces a palette, which the mapper consumes. The interactive bridge's own CSS is not tokenized by this design.
- **A hue-wheel component from scratch.** Slice 7 may use a small existing library (e.g. `@uiw/react-color`) for the hue wheel. If no acceptable library is found, a `<canvas>`-based wheel is within the 330 LOC budget. The choice is the implementor's; the design only specifies the UX behavior.
- **Remote or multi-user appearance settings.** Per-install persistence is via crew's local settings API. A multi-user or cloud-hosted story (where different users want different themes) is explicitly not in scope — it would require per-user settings, which crew doesn't model today.
- **Animated logo slot.** The logo slot is a static asset. Animated GIFs and SVG animations in the logo are supported by the browser but are not a design target; if they cause visual noise, the slot caps the frame rate via CSS `animation-play-state: paused` on `:hover`.
- **Brand-learn for non-crew projects.** The skill requires a crew project binding (the interactive proxy path encodes it). Brand-learn for a standalone interactive instance with no crew binding is out of scope.
- **Video mode brand learning.** The brand-learn skill extracts visual identity; it does not storyboard or author a demo. Video mode is a recording tool; it benefits from the accent theme but does not get a brand-specific workflow.
- **The DES-MERGE-001 post-merge items** (governed doc QE, crew-run document generation, DES-MERGE-002). None of these are addressed or deferred here; they are in the MERGE arc's out-of-scope list and remain there.
- **Server-side attention scoring.** Decay remains client-side per DES-UXFIX-001 §5.
- **Live doc thumbnails on board cards.** Placeholder tiles per DES-MERGE-001 §7.5; this design keeps them placeholders.

---

## 8 Traceability

### 8.1 Operator goals → design decisions

| Operator goal | Design decision | Section |
|---|---|---|
| "visually stunning" | Information-as-aesthetic; two typefaces; dense data surfaces; motion grammar | §1.5, §1.6 |
| "helpful information as the orchestrator" | Status wall + live-feed sidebar composition | §1.2, §1.3 |
| "drive the experience like someone doing multiple projects at once" | Live feed shows ALL active narration; ACTIVE cards have narration + gate inline | §1.3, §1.4 |
| "logo and color scheme should be customizable" | Token system with HSL accent primitives; logo slot; Settings Appearance section | §2, §3 |
| "create a skill that creates based on learning a brand like wicked-interactive did" | Brand-learn garden skill + mapper + Settings integration | §4 |

### 8.2 Slices → what each preserves from UXFIX-001

| Slice | UXFIX behaviors preserved |
|---|---|
| 1 | All (no component change) |
| 2 | Attention decay and bands; empty-state budget; gate chips; answerable gates |
| 3 | Mode switcher: disabled-not-hidden, glyphs match board, active summary visible |
| 4 | Build purpose statement; campaigns panel absent; intent labels; Chat single-agent default |
| 5 | Document three-pane; version cross-link; Themes explanation; Video narration rules |
| 6 | All (mechanical only) |
| 7, 8 | No UXFIX surfaces touched |

### 8.3 Experience checklist → slices

| Checklist item | Slices that establish it |
|---|---|
| EC1–EC10 (from UXFIX-001) | 2, 3, 4, 5 (by conversion) |
| EC11 information is the aesthetic | 2, 4, 5 |
| EC12 accent is singular | 2, 3, 7, 8 |
| EC13 two typefaces, one rule | 2, 4, 5 |
| EC14 live feed is live | 2 |
| EC15 token discipline (globally) | 1 (warn), 2–5 (per-surface), 6 (global error) |
| EC16 logo slot respected | 3, 7 |

**Done means:** all eight slices merged, every named screenshot captured at 1440×900 and passing its mapped checklist items, and a walkthrough of W1–W4 from DES-UXFIX-001 confirming the new visual language does not regress any walkthrough outcome, plus a fifth walkthrough — **W5: Operator customizes to their brand** — following the path: open Settings → Learn from brand URL → preview → apply → confirm the board and chrome reflect the brand accent with no status-color conflict.
