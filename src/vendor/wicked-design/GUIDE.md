# The wicked design guide

How the wicked surfaces look, and why. The tokens in `src/tokens.source.json` are the
machine-readable form of this guide; `dist/specimen.html` shows both themes side by side.

## Sources and the decision

**The default themes are the operator's pick of 2026-10-31: the design council's synthesis** (program
`design/DES-THEMES.md`, revision 3, option 3). After two rejected themes ("the dark mode looks like a
comic book"; "light mode is the blues… a 90s Microsoft site"; "why blues at all?"), two models were
briefed separately and both chose a monochrome UI. The synthesis takes the best of both. Tokens set
by it carry `from: "council"`.

The operator's original design source is kept unchanged in `source/` (in the wicked-web repository at
`packages/design-system/source/`; it is not part of the shipped files):

| File | What it still decides |
|---|---|
| `source/wicked-agile-lockup.svg`, `source/wicked-agile-icons.svg` | The brand mark and icons, which keep their own colours. |
| `source/appearance.md` | Personal and chat-generated themes, and the limits on custom CSS. Users who want colour make it there; the default stays restrained. |
| `source/ui-mockups/README.md`, `index.html` | The blue palette. No longer the UI palette, it survives in the brand mark and as a theme a user can choose. |

Where the synthesis is silent (spacing, motion, control sizes), the tokens keep studio's considered
values (`from: "studio"`).

## The mark

The lockup is a cable-stayed mast over a wave horizon, then `WICKED` in a flared serif and
`agile` in a rounded script. It draws with three tokens:

| Part | Token | Light | Dark |
|---|---|---|---|
| Mast, cables, `WICKED` | `--ink-primary` | dark blue `#064273` | pale `#def3f6` |
| Wave horizon, `agile` | `--accent-primary` | cyan `#1da2d8` | sky `#7fcdff` |
| The two spark triangles | `--accent-wicked` | signal yellow `#ffda19` | signal yellow `#ffda19` |

- Inline the SVG (`brand/wicked-agile-lockup.svg`) so the custom properties resolve. As an
  `<img>`, a favicon or in an email, use `dist/brand/wicked-agile-lockup.{light,dark}.svg`,
  which carry the resolved colours.
- Signal yellow is a small mark: the sparks, a dot. Never text, never a fill behind text.
- Give the mark clear space of at least the mast's height on every side. Do not recolour it
  outside the two theme mappings above.

**Icons** (`dist/icons/*.svg`: wave, trident, fin, retro, backlog, kraken) are 160-unit line
drawings at a 5.5 stroke. The split files draw in `currentColor`, so they take the text colour
they sit in. Use them at 24 px and up: the 5.5-unit stroke is then about 0.8 px, and smaller it
breaks up.

**The brand language for layouts.** Two shapes come from the mark: the **cable**, a fine
straight line that fans from one anchor point, and the **wave horizon**, one soft curve on a
baseline. Use them sparingly: a hairline rule under a page title, a single wave under the
active item, a progress track. They are accents, not texture.

## Colour

### Monochrome first

Neutral grounds, near-black and near-white ink, hairlines, and colour only where it means something.

| | Light | Dark |
|---|---|---|
| Page, rail | `#f5f5f4`, a recessed `#efefed` | `#121212`, a recessed `#0e0e0e` |
| Cards, raised, overlay | white | `#1a1a1a`, `#212121`, `#282828` |
| Ink: high, body, muted, dim | `#18181a`, `#3c3c38`, `#55554f`, `#66665f` | `#ededea`, `#cfcfca`, `#a9a9a3`, `#8f8f89` |
| Hairlines: subtle, default, strong, input | `#e6e6e2`, `#d6d6d1`, `#a8a8a1`, `#7e7e77` | `#232323`, `#2e2e2e`, `#4a4a48`, `#77776f` |
| Primary button | `#18181a`, text `#fafaf9` | `#ededea`, text `#141414` |
| Selected fill, edge | `#ecece9`, a 1.5px `#18181a` edge | `#262625`, a 1.5px `#ededea` edge |
| Hover / current wash | `rgba(24,24,26,.045)` | `rgba(237,237,234,.05)` |
| Focus | a 2px gap, then a 2px `#18181a` ring | the same in `#ededea` |
| Links | ink, underlined | ink, underlined |

### Colour with meaning

In the UI only status is chromatic, and each status keeps one hue in both themes: **waiting on you** violet
(`#6d3e9d` / `#c8a5f0`), **failed** red (`#b3261e` / `#ffaaa1`), **running / ok** green (`#176548` /
`#83c8a4`; progress bars use it), **warning** amber (`#875300` / `#ebc06b`). Each has a `-dim` tint for
its pill. The brand mark keeps its own colours (the wave in cyan or sky, the yellow spark) wherever it
appears; it does not colour the UI. One more exception, outside studio's UI: the family sites' four
**plane** hues (`--plane-experience` … `--plane-foundation`) label the platform map there.

### Roles (tokens)

- **Surfaces**, deepest to highest: `base` (the page), `rail` (recessed, a step under the page),
  `card`, `raised`, `overlay`.
- **Ink**, quietest to strongest: `dim`, `muted`, `body`, `high`. Titles use `high`, prose `body`.
- **Action**: `--accent` is the primary button's fill, `--accent-fg` its text.
- **Selection**: `--accent-subtle` fill, `--highlight` edge, and the check filled in `--accent`.
  The **current rail item** takes the same `--accent-subtle` fill with a 2px `--ink-high` bar at its left
  edge. `--accent-wash` is hover only.
- **Not chosen**: an unchecked option is muted (`--ink-muted`), never struck through and never faded.
- **The brand panel** tokens (`--surface-brand` …) are neutral aliases now; there is no blue panel.

## Type

| Slot | Token | Face today | Use |
|---|---|---|---|
| Sans | `--font-sans` | Inter (Wicked Sans when it ships) | Every UI word, titles included |
| Serif | `--font-serif` | Marcellus (Wicked Serif when it ships) | Brand moments only. UI titles are Inter |
| Script | `--font-script` | Dancing Script (Wicked Script when it ships) | Brand moments only, never UI text |
| Mono | `--font-mono` | JetBrains Mono | Code, ids, paths, data |

The synthesis sets three sizes for the UI: **titles** `--text-title` 20px at `--weight-heading` 600
and `--tracking-display` -0.02em; **body** `--text-body` 14px at 400; **labels** `--text-label` 12px at
`--weight-label` 500, in **sentence case** (no uppercase eyebrows in the UI). The wider scale
(`--text-2xs` 11 … `--text-3xl` 34) stays for the sites and for special cases; nothing on a decision
surface is smaller than 11px.

## Space, shape, elevation, motion

- Space: a 4 px grid (`--space-1` … `--space-16`).
- Radius: `sm` and `md` 6 (chips, controls) · `lg` 8 (cards) · `xl` 12 (panels) · `full` (pills, dots).
- Elevation: hairlines first. A card is a hairline (`--border-subtle`) with a whisper of shadow
  (`--shadow-card`, a 1px 2px drop); raised and overlaid surfaces take softer, deeper shadows. Messages
  carry no border or shadow: spacing groups them.
- Focus: `--focus-ring` is a 2px gap in the page colour, then a 2px near-black (light) or near-white
  (dark) line. It clears 3:1 alone. Plugins receive `focus-ring` in the theme handoff.
- Motion: `--ease-out` for most transitions, `--dur-fast` (120 ms) to `--dur-slow` (300 ms).
  Respect `prefers-reduced-motion`.

## Accessibility

Every pair the system promises is measured in CI (`scripts/contrast.mjs`, run by `npm test`), in
both themes:
- all four inks and links ≥ 4.5:1 on every surface (page, rail, card, raised, overlay), on the
  selected fill (`--accent-subtle`) and on the hover wash (`--accent-wash`);
- each status ink ≥ 4.5:1 on every surface and on **its own** tint (`--status-*-dim`). Other inks on a
  status tint are not promised (dark `--ink-dim` on a status tint is about 4.2:1): put a status pill's
  words in its status ink;
- text on the primary (`--accent-fg` on `--accent`, `--accent-hover`) ≥ 4.5:1, and the brand mark's
  ink (`--ink-primary`) ≥ 4.5:1 on every surface;
- input edges, selection edges, the selection check (also on the selected fill), focus rings and a
  progress fill on its track (`--status-run` on `--border-subtle`) ≥ 3:1 (WCAG 1.4.11). A new token that is meant to
carry text gets a pair there. `dist/specimen.html` shows a selection with its check, progress with its
value and a muted not-chosen row (`data-fixture` attributes).

## Personal themes (appearance.md)

Users can name their own colour schemes, add bounded custom CSS, or ask chat to generate a
theme; the default stays this palette. A personal theme overrides the semantic tokens only,
never the component CSS. It applies to that user alone and never publishes into an
organisation. Custom CSS is presentation data: validated against an allowlist, contained to
themeable surfaces, and it can never remove navigation, reset, focus indicators, status
semantics or readable contrast. `source/appearance.md` (in the repository) is the full policy.
