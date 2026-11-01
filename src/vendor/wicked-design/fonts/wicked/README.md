# Wicked Sans, Wicked Serif, Wicked Script

The brand's own faces, v2 (approved 2026-11-01), drawn in code by
`scripts/fonts/build_wicked_fonts.py` (in the wicked-web repository; not shipped):

| File | Family | Weight (OS/2) | CSS `font-weight` |
|---|---|---|---|
| `WickedSans-Regular.woff2` | Wicked Sans | 400 | `100 499` |
| `WickedSans-SemiBold.woff2` | Wicked Sans | 600 | `500 900` (so `--weight-label` 500 is SemiBold) |
| `WickedSerif-Regular.woff2` | Wicked Serif | 400 | `100 900` (never faux-bolded) |
| `WickedScript-Regular.woff2` | Wicked Script | 400 | `100 900` (never faux-bolded) |

`wicked-agile-fonts-selfhost.css` declares the four faces with `url('./<file>')`, so it resolves
wherever this folder is served or bundled. `../../fonts.css` imports it; to load only these
faces, import `wicked-design/wicked-fonts.css`.

The `.otf`/`.ttf` files and a base64-inlined stylesheet live in `source/wicked-fonts/` (repository
only). Licence: `../../LICENSE`, part 3. How to rebuild and the known gaps: `../../README.md`,
"The Wicked faces".
