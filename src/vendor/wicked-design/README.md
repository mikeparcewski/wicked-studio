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
| `fonts.css`, `fonts/`, `licenses/` | Self-hosted woff2 faces. **Wicked Sans** (400, 600; the fonts-v3 OFL cut of Inter), and the brand's own **Wicked Serif** and **Wicked Script**, in `fonts/wicked/`, first in every stack; then the SIL OFL 1.1 fallbacks with their licences (`licenses/LICENSE-<face>.txt`): Inter, Marcellus, Dancing Script, JetBrains Mono. |
| `fonts/wicked/wicked-agile-fonts-selfhost.css` | The four Wicked `@font-face` rules alone, `url()`s relative to the file (exported as `wicked-design/wicked-fonts.css`). `fonts.css` imports it. |
| `scripts/fonts/` | `build_wicked_sans.py` (the Wicked Sans cut of Inter), the v2 compiler `build_wicked_fonts.py` (Serif and Script, every outline drawn in code), their checks and a page renderer. Repository only. |
| `source/wicked-fonts/` | The same faces as `.otf` and `.ttf` for desktop use, and `wicked-agile-fonts.css` (the woff2 inlined as base64 data URLs, for self-contained documents). Repository only: not shipped. |
| `index.css` | `fonts.css` + `dist/tokens.css`. Import this once. |
| `brand/` | The marks (fonts-v3, 2026-11-02): the Shoreline + Wave W lockups (`wicked-{agile,studio}-wordmark{,-display,-small}.svg`), the lettering alone (`wicked-{agile,studio}-lettering{,-small}.svg`), the Shoreline mark (`shoreline{,-large}.svg`) and the favicon (`favicon.svg`), in `currentColor` (GUIDE.md, "The mark"). And the v2 lockup and icon sheet, byte-identical to `source/`. |
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
the sha; for anything beyond the chrome, import from the export path:

```js
import 'wicked-web/design/index.css';               // faces + tokens
import tokens from 'wicked-web/design/dist/tokens.json' with { type: 'json' };   // plain import in Vite/Astro
```

```html
<img src="…/wicked-web/design/dist/brand/wicked-agile-lockup.light.svg" alt="wicked agile">
```

The chrome already does this for every site: `wicked-web/styles/tokens.css` (which `global.css`
imports) imports this package (faces and tokens) and maps the family names the sites use onto them, so a
site that uses the shared `Base` gets the faces and Wicked Dark / Light by bumping the sha.

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
  Wicked Sans is OFL too (`licenses/LICENSE-WickedSans.txt`); Wicked Serif and Script in
  `fonts/wicked/` are not (`LICENSE` part 3): a plugin outside the wicked products needs the project
  owner's permission to bundle them.

## Fonts and licences

| Face | Licence | Copyright (from its licence file) | Why |
|---|---|---|---|
| Wicked Sans 400, 600 | SIL OFL 1.1 (a Modified Version of Inter 4.1; no Reserved Font Name) | The Inter Project Authors; modifications, The Wicked Agile Project Authors | `--font-sans`: every UI word |
| Wicked Serif | The project owner's (`LICENSE` part 3) | The project owner | `--font-display` (and `--font-serif`): display sizes, brand moments |
| Wicked Script | The project owner's (`LICENSE` part 3) | The project owner | `--font-script`: brand moments |
| Inter | SIL OFL 1.1 | The Inter Project Authors | `--font-sans` fallback: draws what Wicked Sans lacks (beyond Latin Extended-A) |
| Marcellus | SIL OFL 1.1, Reserved Font Name "Marcellus" | Brian J. Bonislawsky (Astigmatic) | `--font-display` / `--font-serif` fallback |
| Dancing Script | SIL OFL 1.1, Reserved Font Name "Dancing Script" | The Dancing Script Project Authors | `--font-script` fallback |
| JetBrains Mono | SIL OFL 1.1 | The JetBrains Mono Project Authors | `--font-mono` |

The OFL files at the top of `fonts/` are the unmodified @fontsource 5.3.0 latin and latin-ext
subsets. Inter and JetBrains Mono are the same files studio already self-hosts.

### Wicked Sans

Since 2026-11-02 (fonts-v3, the operator's pick) Wicked Sans is a cut of Inter 4.1, made by
`scripts/fonts/build_wicked_sans.py`: Inter's variable font instanced at 400 and 600 with the optical
size axis kept (opsz 14 to 32), the alternates that make it ours frozen into the cmap (open digits, a
tailed `l`, a serifed `I`, tabular figures by default on the ten digits only: Inter's `tnum` also maps
the hyphen to a 0.65 em figure-width dash, and the space and punctuation, which the fonts-v3 specimen
build froze too), the one UI glyph Inter lacks (the close mark ✕) drawn from its own strokes, renamed,
and subset to Latin-1, Latin Extended-A and the UI symbols. Unlike the fonts-v3 specimen build, it does
not carry the six brand icons (U+E000 to U+E005): inside an OFL font they would be under the OFL. They
stay in Wicked Serif and Script and in `dist/icons/`; the font check fails a Wicked Sans that has them. It is a Modified Version under the SIL OFL
1.1 (`licenses/LICENSE-WickedSans.txt`); Inter declares no Reserved Font Name. The files are
`fonts/wicked/WickedSansA-{Regular,SemiBold}.woff2` (the `A` is the fonts-v3 direction; the family
name is `Wicked Sans`). 0 and O still differ only by width.

Rebuilding it needs Inter's `Inter[opsz,wght].ttf` with its `OFL.txt` beside it (google/fonts
`ofl/inter`):

```sh
uv run --with fonttools --with brotli --with skia-pathops python -I scripts/fonts/build_wicked_sans.py \
  'Inter[opsz,wght].ttf' "$(mktemp -d)"
```

With fontTools 4.68.0 it reproduced the shipped files table for table (only `head`'s timestamps and checksum
differed). Another fontTools version can serialise GSUB and GPOS differently (lookup types, extension
lookups); compare cmap, glyf, gvar and hmtx, and run the font checks, rather than bytes.

### Wicked Serif and Wicked Script

`scripts/fonts/build_wicked_fonts.py` (v2, approved 2026-11-01) draws both faces in code with
fontTools: no font is downloaded or traced. (It drew the v2 Wicked Sans too; that face is retired,
and the compiler now writes only Serif and Script, plus stylesheets that also declare the shipped
Wicked Sans.) Every face has the Latin letters, ten distinct tabular digits, UI punctuation, a few
symbols (arrows, check, bullets, currency), and the six brand icons in the Private Use Area (U+E000
to U+E005).

**Known gaps** (the browser draws these characters in the next face of the stack, so text never
goes missing, but it changes face mid-word):

- No accented or non-Latin letters (é, ü, ß, Greek, Cyrillic): Marcellus or Dancing Script draws them.
- No hinting: small sizes on low-density Windows screens render softer than Inter.
- Weight ranges (every Wicked face): Wicked Sans has two faces, Regular (400) and SemiBold (600). Their `@font-face` rules claim weight
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

**Brand marks and the Wicked faces**: the marks, the lockups, the icons and Wicked Serif and Script were created by the project owner (Wicked Sans is OFL, above). The source folder
carries no licence for them, and `LICENSE` grants none yet; they are for the
wicked products until the owner says otherwise.
