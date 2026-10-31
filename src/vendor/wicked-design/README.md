# wicked-design

The wicked design system: one token source for light and dark, the brand lockup and icons,
and the type faces with their licences. **Not published to npm yet**: until a release is
approved, consumers take it by git reference or as a vendored copy (below).

- `GUIDE.md`: the design guide (palette, roles, type, mark, accessibility) and its sources.
- `dist/specimen.html`: every token, both themes side by side. Open it in a browser.

## What is in it

| Path | What |
|---|---|
| `src/tokens.source.json` | **The single source.** Every token, its light and dark value, and `from`: where the value came from (`guide`, `brand`, `studio`, `web` or `derived`, with a note). |
| `dist/tokens.css` | Generated. CSS custom properties: the scale on `:root`; colours for dark (default), light (`prefers-color-scheme: light` when no theme is set), and `[data-theme="light"\|"dark"]` (or studio's `wicked-light`/`wicked-dark`) on the root or on any subtree. All inside `@layer wicked-design`, so a consumer's unlayered rules win. |
| `dist/tokens.json` | Generated. The same tokens with concrete values (no `var()`), per theme, plus the scale, aliases, provenance and `pluginTokens`. For non-CSS consumers. |
| `fonts.css`, `fonts/`, `licenses/` | Self-hosted woff2 faces with their SIL OFL 1.1 licences (`licenses/LICENSE-<face>.txt`): Inter, Marcellus, Dancing Script, JetBrains Mono. Slots for Wicked Sans, Serif and Script (see `fonts/wicked/README.md`). |
| `index.css` | `fonts.css` + `dist/tokens.css`. Import this once. |
| `brand/` | The lockup and icon sheet, byte-identical to `source/`. |
| `dist/brand/wicked-agile-lockup.{light,dark}.svg` | Generated. The lockup with resolved colours, for `<img>`, favicons, email. |
| `dist/icons/*.svg` | Generated. One file per icon, drawn in `currentColor`. |
| `source/` | The operator's design source, unchanged (guide, mockups, marks, the font placeholder). Only in the wicked-web repository (`packages/design-system/source/`): not in the shipped or vendored file set. |

## Commands

No dependencies; Node 20 or later.

```sh
npm run build    # regenerate dist/ from src/tokens.source.json and brand/
npm test         # dist/ is current, every contrast pair meets WCAG AA, fonts and licences exist
npm run vendor -- <dest-dir>   # copy the shipped files into another repo, pinned to this commit
                               # (refuses a repo root, this package, or a non-empty non-vendored dir)
node scripts/contrast.mjs      # print every promised colour pair and its ratio
```

Change a token in `src/tokens.source.json`, run `npm run build`, commit both. CI
(`.github/workflows/design-system.yml`) fails when `dist/` is stale or a pair falls short.

## How each surface consumes it

### wicked-studio: a vendored copy

Studio takes a **vendored copy**, not a git dependency. wicked-web declares `astro` as a peer
dependency, and npm 7+ installs peers, so depending on wicked-web would pull Astro into
studio's tree.

1. From a wicked-web checkout at a merged commit:
   `node packages/design-system/scripts/vendor.mjs <studio>/src/vendor/wicked-design`.
   It writes `VENDORED.json` (version and commit) next to the files.
2. At the top of `src/index.css` (the one stylesheet `main.tsx` imports), add
   `@import './vendor/wicked-design/index.css';` before studio's own chain. Vite fingerprints the
   fonts. Point the licence emitter in `vite.config.ts` (today it reads `src/assets/fonts/` and keeps
   files named `LICENSE-*`) at `src/vendor/wicked-design/licenses/`; the package's licence files use
   the same `LICENSE-<face>.txt` names, so the OFL texts still ship in `dist/fonts/`.
3. Studio's `tokens.css` and `themes/wicked-{light,dark}.css` then keep only what is
   studio-specific (Nerve Center, agent and section hues, the accent-picker primitives) and
   map onto the package's names. Studio already uses the same semantic names (`--surface-*`,
   `--ink-*`, `--accent*`, `--status-*`, `--space-*`, `--radius-*`), so most components need
   no change.
4. Updating = re-run the vendor script at a newer commit; the diff shows exactly what moved.

When the operator approves an npm release, step 1 becomes `npm i wicked-design` and the import
becomes `wicked-design/index.css` (or `wicked-design`). The package exports the same paths as the
vendored copy (`index.css`, `fonts.css`, `dist/*`, `fonts/*`, `brand/*`, `licenses/*`), so nothing
else changes.

### The product sites: through their existing wicked-web dependency

Each site already pins `wicked-web` by commit (`github:mikeparcewski/wicked-web#<sha>`). Bump
the sha and import from the new export path:

```js
import 'wicked-web/design/index.css';               // faces + tokens
import tokens from 'wicked-web/design/dist/tokens.json' with { type: 'json' };   // plain import in Vite/Astro
```

```html
<img src="…/wicked-web/design/dist/brand/wicked-agile-lockup.light.svg" alt="wicked agile">
```

The existing `wicked-web/styles/tokens.css` (the family chrome palette) is unchanged; a site
moves to the design tokens when it is restyled.

### wicked-interactive: tokens in rendered output

Interactive renders HTML, PDF and PPTX. It takes a **vendored copy** the same way studio does
(it has no wicked-web dependency either).

- HTML and PDF: inline `dist/tokens.css` and `fonts.css` (fonts as data URLs, or files next to
  the document) into the document head, and set `data-theme` on the document root. Rendered
  documents then use the same `var(--ink-body)`, `var(--surface-card)` names as studio.
- PPTX and any non-CSS output: read `dist/tokens.json` → `themes.light` (or `.dark`) for the
  concrete colours, and `scale` for sizes.

### Plugins: tokens handed over by studio's plugin host

A sandboxed plugin never loads a stylesheet or a URL from the host. Studio's editor host
already sends resolved token values: `host.hello.theme` on connect, and `host.theme` through
`setTheme` (`src/editors/host.ts`), read from the names in `THEME_TOKENS` (`src/editors/theme.ts`).
The plan:

- the host's token list (`THEME_TOKENS`, custom-property names such as `--surface-base`) becomes
  `pluginProperties` from `dist/tokens.json`: the same names as `pluginTokens`, with the `--` prefix
  that `getComputedStyle().getPropertyValue()` needs (surfaces, ink, borders, accent, highlight,
  focus, the brand names, status, radius, fonts);
- a plugin sets each received `--name: value` on its own `:root` and styles with the same
  names, so a plugin follows the user's light, dark or personal theme with no code of its own;
- fonts reach a plugin as family names only. A plugin that wants the faces bundles its own
  copy of `fonts/` (OFL allows it with the licence files).

## Fonts and licences

| Face | Licence | Copyright (from its licence file) | Why |
|---|---|---|---|
| Inter | SIL OFL 1.1 | The Inter Project Authors | `--font-sans`: the accepted mockup sets every word in Inter |
| Marcellus | SIL OFL 1.1, Reserved Font Name "Marcellus" | Brian J. Bonislawsky (Astigmatic) | `--font-serif`: nearest to the lockup's flared capitals |
| Dancing Script | SIL OFL 1.1, Reserved Font Name "Dancing Script" | The Dancing Script Project Authors | `--font-script`: nearest to the lockup's rounded script |
| JetBrains Mono | SIL OFL 1.1 | The JetBrains Mono Project Authors | `--font-mono` |

The files are the unmodified @fontsource 5.3.0 latin and latin-ext subsets. Inter and JetBrains
Mono are the same files studio already self-hosts.

**Wicked Sans, Wicked Serif and Wicked Script** are slots, not files. The operator's
`source/build_wicked_fonts.py` names them but builds nothing, and no specification of their
design exists yet (the lockup draws six serif capitals and one script word as outlines). Each
slot comes first in its stack, so the real faces drop in without a token change.

**Brand marks**: the lockup and icons were created by the project owner. The source folder
carries no licence or ownership note for them, and `LICENSE` grants none yet; they are for the
wicked products until the owner says otherwise.
