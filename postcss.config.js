// PostCSS pipeline — Tailwind + autoprefixer, guarded by the §2.11 twin.
//
// DES-VISION-001 §2.11: no .css file outside the token sources ships a raw
// color. ESLint enforces the contract for .ts/.tsx (eslint.config.mjs); this
// inline plugin is the build-time twin for the stylesheets — it fails the
// build on a literal hex / rgb() / hsl() in any src/ stylesheet EXCEPT
// src/styles/tokens.css and src/styles/themes/*.css (the only files allowed
// to hold raw values). It checks in `Once`, BEFORE Tailwind expands its
// directives, so it judges exactly what the repo's stylesheets say — not the
// generated utilities or preflight (not ours to police). Files outside src/
// (e.g. xterm's CSS from node_modules) are skipped for the same reason.
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*\d|\bhsla?\(\s*[\d.]/;
const TOKEN_SOURCES = /src\/styles\/(tokens\.css|themes\/[^/]+\.css)$/;

function noRawColors() {
  return {
    postcssPlugin: 'no-raw-colors',
    Once(root) {
      // Judge each declaration by ITS OWN source file (an @import-inlined node
      // keeps the imported file as its source), so the token sources stay exempt
      // no matter whether the import was inlined before or after this pass.
      root.walkDecls((decl) => {
        const file = (decl.source?.input?.file ?? '').replace(/\\/g, '/');
        if (!file.includes('/src/') || file.includes('/node_modules/')) return;
        if (TOKEN_SOURCES.test(file)) return;
        if (RAW_COLOR.test(decl.value)) {
          throw decl.error(
            `Raw color in "${decl.prop}: ${decl.value}" — use a semantic token from src/styles/tokens.css (DES-VISION-001 §2.11).`,
          );
        }
      });
    },
  };
}
noRawColors.postcss = true;

export default {
  plugins: [noRawColors, tailwindcss, autoprefixer],
};
