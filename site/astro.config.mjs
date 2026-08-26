import { defineConfig } from 'astro/config';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
  vite: { resolve: { alias } },
});
