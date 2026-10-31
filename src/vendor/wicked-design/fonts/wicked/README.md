# Wicked Serif, Wicked Script, Wicked Sans

`source/build_wicked_fonts.py` (the operator's file, kept unchanged in the wicked-web repository at
`packages/design-system/source/`, not shipped) is a placeholder: it imports
fontTools and prints a message, and builds no font. No design spec for the three faces exists yet
(the guide and mockups set type in Inter; the lockup draws six serif capitals and one script word as
outlines, not as a font).

When the real `.woff2` files exist, put them here as `WickedSans.woff2`, `WickedSerif.woff2` and
`WickedScript.woff2` with their licence, and uncomment the three `@font-face` blocks at the top of
`../../fonts.css`. The token stacks already list the Wicked faces first.
