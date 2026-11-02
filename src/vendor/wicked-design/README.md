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
| `fonts.css`, `fonts/`, `licenses/` | Self-hosted woff2 faces. The brand's own **Wicked Sans** (400, 600), **Wicked Serif** and **Wicked Script** in `fonts/wicked/`, first in every stack; then the SIL OFL 1.1 fallbacks with their licences (`licenses/LICENSE-<face>.txt`): Inter, Marcellus, Dancing Script, JetBrains Mono. |
| `fonts/wicked/wicked-agile-fonts-selfhost.css` | The four Wicked `@font-face` rules alone, `url()`s relative to the file (exported as `wicked-design/wicked-fonts.css`). `fonts.css` imports it. |
| `scripts/fonts/` | The font compiler (`build_wicked_fonts.py`, v2: every outline drawn in code), its check and a page renderer. Repository only. |
| `source/wicked-fonts/` | The same faces as `.otf` and `.ttf` for desktop use, and `wicked-agile-fonts.css` (the woff2 inlined as base64 data URLs, for self-contained documents). Repository only: not shipped. |
| `index.css` | `fonts.css` + `dist/tokens.css`. Import this once. |
| `brand/` | The lockup and icon sheet, byte-identical to `source/`. |
| `dist/brand/wicked-agile-lockup.{light,dark}.svg` | Generated. The lockup with resolved colours, for `<img>`, favicons, email. |
| `dist/icons/*.svg` | Generated. One file per icon, drawn in `currentColor`. |
| `source/` | The operator's design source, unchanged (guide, mockups, marks), plus `source/wicked-fonts/`. Only in the wicked-web repository (`packages/design-system/source/`): not in the shipped or vendored file set. |

## Commands

No dependencies; Node 20 or later.

```sh
npm run build    # regenerate dist/ from src/tokens.source.json and brand/
npm test         # dist/ is current, every contrast pair meets WCAG AA, fonts and licences exist
npm run test:fonts             # the Wicked faces: every glyph present and distinct, tabular digits (needs uv)
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
  `fonts.css` starts with `@import "./fonts/wicked/wicked-agile-fonts-selfhost.css"`: inline
  that file's rules in place of the `@import` (each `url('./X.woff2')` is then
  `fonts/wicked/X.woff2`) before turning the URLs into data URLs, or the Wicked faces are lost.
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
  copy of the OFL fallbacks in `fonts/*.woff2` (OFL allows it with the licence files). The
  Wicked faces in `fonts/wicked/` are not OFL (`LICENSE` part 3): a plugin outside the wicked
  products needs the project owner's permission to bundle them.

## Fonts and licences

| Face | Licence | Copyright (from its licence file) | Why |
|---|---|---|---|
| Wicked Sans 400, 600 | The project owner's (`LICENSE` part 3) | The project owner | `--font-sans`: every UI word |
| Wicked Serif | The project owner's (`LICENSE` part 3) | The project owner | `--font-display` (and `--font-serif`): display sizes, brand moments |
| Wicked Script | The project owner's (`LICENSE` part 3) | The project owner | `--font-script`: brand moments |
| Inter | SIL OFL 1.1 | The Inter Project Authors | `--font-sans` fallback: draws what Wicked Sans lacks |
| Marcellus | SIL OFL 1.1, Reserved Font Name "Marcellus" | Brian J. Bonislawsky (Astigmatic) | `--font-display` / `--font-serif` fallback |
| Dancing Script | SIL OFL 1.1, Reserved Font Name "Dancing Script" | The Dancing Script Project Authors | `--font-script` fallback |
| JetBrains Mono | SIL OFL 1.1 | The JetBrains Mono Project Authors | `--font-mono` |

The OFL files (`fonts/*.woff2`, not `fonts/wicked/`) are the unmodified @fontsource 5.3.0 latin and
latin-ext subsets. Inter and JetBrains Mono are the same files studio already self-hosts.

### The Wicked faces

`scripts/fonts/build_wicked_fonts.py` (v2, approved 2026-11-01) draws all three faces in code with
fontTools: no font is downloaded or traced. Every face has the Latin letters, ten distinct tabular
digits, UI punctuation, a few symbols (arrows, check, bullets, currency), and the six brand icons
in the Private Use Area (U+E000 to U+E005).

**Known gaps** (the browser draws these characters in the next face of the stack, so text never
goes missing, but it changes face mid-word):

- No accented or non-Latin letters (é, ü, ß, Greek, Cyrillic): Inter, Marcellus or Dancing Script draws them.
- No hinting: small sizes on low-density Windows screens render softer than Inter.
- Wicked Sans has two faces, Regular (400) and SemiBold (600). Their `@font-face` rules claim weight
  ranges, so every weight picks one of them: 100 to 499 draw Regular, 500 to 900 (including
  `--weight-label` 500) draw SemiBold. Wicked Serif and Wicked Script have one face each, which
  claims 100 to 900, so a bold request draws the regular face rather than a faux bold.
- Wicked Serif and Wicked Script lowercase is v1: small capitals, not true lowercase. The serif
  small capitals are narrowed to 86% of their advance but not of their outline, so their ink runs
  past the advance (`m`: ink to x=670 on a 589 advance) and tight runs can touch. Set lowercase
  serif runs with positive letter-spacing, or keep Wicked Serif to capitals.
- No kerning table.

**Rebuilding.** Needs [uv](https://docs.astral.sh/uv/) (or Python 3 with `fonttools` and `brotli`).
From `packages/design-system/`:

```sh
pkg="$PWD"; out="$(mktemp -d)"; cd "$out"     # the compiler writes into the current folder
uv run --with fonttools --with brotli python -I "$pkg/scripts/fonts/build_wicked_fonts.py"
cp *.woff2 wicked-agile-fonts-selfhost.css "$pkg/fonts/wicked/"
cp *.otf *.ttf wicked-agile-fonts.css "$pkg/source/wicked-fonts/"
cd "$pkg" && npm run test:fonts && npm run test:fonts:chromium && npm test
```

Then look at the faces, not only the check: open `dist/specimen.html`, or render any page that
loads them with `scripts/fonts/render_wicked_fonts_sample.py <page.html> <out.png>` (Playwright).
CI (`design-system.yml`, job `fonts`) runs the same check on every face and format, and fails a
face with a missing or empty glyph, letters or digits that collapsed onto one outline, or
proportional digits, and a stylesheet whose `font-weight` ranges are not the ones above. It then
checks in Chromium, through `fonts.css` and both Wicked stylesheets, which face draws each weight:
Wicked Sans 500 must draw SemiBold, and every weight of a face must draw the same pixels as the
face's own weight, so nothing is faux-bolded (`scripts/fonts/check_wicked_fonts_chromium.py`).

**Brand marks and the Wicked faces**: the lockup, the icons and the three Wicked faces were created by the project owner. The source folder
carries no licence for them, and `LICENSE` grants none yet; they are for the
wicked products until the owner says otherwise.
