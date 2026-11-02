# Wicked Sans, Wicked Serif, Wicked Script

Wicked Sans is the fonts-v3 cut of Inter 4.1 (the operator's pick 2026-11-02; SIL OFL 1.1,
`../../licenses/LICENSE-WickedSans.txt`), made by `scripts/fonts/build_wicked_sans.py`. Wicked Serif and
Wicked Script are the brand's own v2 faces (approved 2026-11-01), drawn in code by
`scripts/fonts/build_wicked_fonts.py`. Both scripts live in the wicked-web repository; neither is shipped.

| File | Family | Weight (OS/2) | CSS `font-weight` |
|---|---|---|---|
| `WickedSansA-Regular.woff2` | Wicked Sans | 400 (opsz 14-32 kept) | `100 499` |
| `WickedSansA-SemiBold.woff2` | Wicked Sans | 600 (opsz 14-32 kept) | `500 900` (so `--weight-label` 500 is SemiBold) |
| `WickedSerif-Regular.woff2` | Wicked Serif | 400 | `100 900` (never faux-bolded) |
| `WickedScript-Regular.woff2` | Wicked Script | 400 | `100 900` (never faux-bolded) |

`wicked-agile-fonts-selfhost.css` declares the four faces with `url('./<file>')`, so it resolves
wherever this folder is served or bundled. `../../fonts.css` imports it; to load only these
faces, import `wicked-design/wicked-fonts.css`.

The `.otf`/`.ttf` files and a base64-inlined stylesheet live in `source/wicked-fonts/` (repository
only). Licence: `../../LICENSE`, part 2 (Wicked Sans, OFL) and part 3 (Serif, Script). How to rebuild and the known gaps: `../../README.md`,
"The Wicked faces".
