import { defineConfig } from 'astro/config';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The install CTA's version stamp is injected at build time from the repo's
// own package.json (the published `wicked-studio` npm manifest), so the stamp
// can never re-stale the way a hardcoded string does (it sat at v0.1.0, then
// v0.4.0, while npm moved on). Deliberately NOT an npm-registry fetch: that
// would make the build non-hermetic. The release train keeps package.json in
// sync with npm, so stamp == npm at every deploy from main. (DT-7)
const studioPkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

// Shared chrome lives in the `wicked-web` package. Develop against the local
// source when it sits beside this repo (../../wicked-web from this site dir),
// otherwise (CI) resolve the installed github:mikeparcewski/wicked-web package
// from node_modules.
const localUI = fileURLToPath(new URL('../../wicked-web/src', import.meta.url));
const alias = existsSync(localUI) ? { 'wicked-web': localUI } : {};

// https://astro.build/config
export default defineConfig({
  // Served at ws.wickedagile.com (custom domain, root path). No base prefix —
  // assets resolve from '/', so the CNAME root serves CSS/JS correctly.
  site: 'https://ws.wickedagile.com',
  output: 'static',
  // Astro's HTML compressor (on by default) deletes the whitespace between a text node and a
  // following inline tag rather than collapsing it to a single space, so prose wrapped as
  //     ...core returns
  //     <b>8 hits</b>
  // ships as "returns8 hits". It hit this page in a dozen places — "arebound to it",
  // "spanningRust", "donot resolve", "studio'sdedicated". The copy here wraps for readability, so
  // every line break landing before a <b> or <code> was a latent word-join, invisible in source
  // review and invisible to layout measurement. A few KB of retained whitespace is cheaper than
  // shipping mashed sentences. Pinned by tests/e2e/prose.spec.ts.
  compressHTML: false,
  vite: {
    resolve: { alias },
    define: { __WICKED_STUDIO_VERSION__: JSON.stringify(studioPkg.version) },
  },
});
