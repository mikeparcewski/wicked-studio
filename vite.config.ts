import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { loadEnv } from 'vite';
import { defineConfig, configDefaults, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

// TH-13: ship the committed data-testid contract INSIDE the built dist, so consumers
// (test generators, the model-free campaign runner) verify selectors against the bundle
// actually served — never source recon alone. The committed file is the single source of
// truth: tests/testidInventory.test.ts fails CI whenever it drifts from src/, so what gets
// emitted here is CI-guaranteed to describe this build's sources. Regenerate with
// `npm run manifest:testids`.
function emitTestidInventory(): Plugin {
  return {
    name: 'emit-testid-inventory',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'testid-inventory.json',
        source: readFileSync(new URL('./testid-inventory.json', import.meta.url), 'utf8'),
      });
    },
  };
}

// DES-STUDIO-REBUILD-001 S1: the self-hosted fonts are SIL OFL 1.1, whose condition 2 wants the
// licence text to travel with the font files. Vite fingerprints the woff2 files into dist/assets;
// this emits each family's licence beside them as dist/fonts/LICENSE-*.txt (crew serves dist/).
function emitFontLicences(): Plugin {
  const dir = new URL('./src/assets/fonts/', import.meta.url);
  return {
    name: 'emit-font-licences',
    apply: 'build',
    generateBundle() {
      for (const name of readdirSync(dir).filter((f) => f.startsWith('LICENSE-'))) {
        this.emitFile({ type: 'asset', fileName: `fonts/${name}`, source: readFileSync(new URL(name, dir), 'utf8') });
      }
    },
  };
}

// EP-P1 (DES-EDITOR-PLUGINS-001 §8.2): the dev server serves the shell with the frame-src policy crew
// serves it with, so an editor plugin that navigates itself can reach only the editor bundle route and
// the interactive document route — on the page's own origin and on the daemon's (VITE_API_HOST).
// The daemon's host is the RESOLVED Vite env (`.env.development`'s VITE_API_HOST, `127.0.0.1:7701`),
// normalized as `apiBase()` does: a bare host gets `http://` (Copilot).
function editorFrameSrc(apiHost: string | undefined): Plugin {
  return {
    name: 'editor-frame-src',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const host = req.headers.host ?? '127.0.0.1:4200';
        const origins = [`http://${host}`];
        const api = (apiHost ?? '').trim().replace(/\/+$/, '');
        if (api !== '') origins.push(/^https?:\/\//.test(api) ? api : `http://${api}`);
        const src = origins.flatMap((o) => [`${o}/api/v1/editors/`, `${o}/api/v1/projects/`]).join(' ');
        res.setHeader('Content-Security-Policy', `frame-src ${src} blob: data:`);
        next();
      });
    },
  };
}

// EP-P2 (DES-EDITOR-PLUGINS-001 §8.6): the first-party editor plugins ship INSIDE studio's bundle —
// `<outDir>/editors/<id>/{index.html,editor.json}`, one self-contained HTML file each, which crew's
// registry discovers at boot and serves hash-pinned (scripts/build-editors.mjs). Every `vite build`
// emits them, so a same-origin build for the journeys carries them too.
function emitEditorBundles(): Plugin {
  let outDir = resolve(process.cwd(), 'dist');
  return {
    name: 'emit-editor-bundles',
    apply: 'build',
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); },
    async closeBundle() {
      const { buildEditors } = await import('./scripts/build-editors.mjs');
      await buildEditors(outDir);
    },
  };
}

// Program DES-PLUGIN-EVENTS spike 1: the first-party run-thread plugins ride INSIDE studio's own bundle as one module,
// `virtual:wicked-run-plugins` (id -> {version, html, sha256}), built from src/plugins/<id>/ the way the editors are. The
// run-thread slot frames each from a blob: URL, so it needs no route on the daemon and no daemon restart to appear.
// Tests read a stub (test.alias below): a jsdom frame never runs the plugin.
function runPluginsModule(): Plugin {
  const id = 'virtual:wicked-run-plugins';
  return {
    name: 'wicked-run-plugins',
    resolveId(source) { return source === id ? `\0${id}` : null; },
    async load(resolved) {
      if (resolved !== `\0${id}`) return null;
      const { RUN_PLUGINS, runPluginHtml } = await import('./scripts/build-editors.mjs');
      const out: Record<string, { version: string; html: string; sha256: string }> = {};
      for (const p of RUN_PLUGINS) {
        const built = await runPluginHtml(p);
        out[p] = { version: built.version, html: built.html, sha256: built.sha256 };
        // A change to any of its files rebuilds it (the dev server re-serves the module).
        const dir = resolve(process.cwd(), 'src', 'plugins', p);
        for (const f of readdirSync(dir)) this.addWatchFile(resolve(dir, f));
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), runPluginsModule(), emitTestidInventory(), emitFontLicences(), emitEditorBundles(), editorFrameSrc(loadEnv(mode, process.cwd(), '').VITE_API_HOST)],
  server: { port: 4200, host: '127.0.0.1' },
  preview: { port: 4200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    alias: { 'virtual:wicked-run-plugins': resolve(process.cwd(), 'tests/stubs/runPlugins.ts') },
    maxWorkers: process.env.CI ? undefined : '50%',
    // site/ is the marketing site — its own app with its own deps and a
    // Playwright suite (site/tests/e2e, run by the Site E2E workflow).
    // Without this, vitest's default include sweeps those *.spec.ts files
    // and fails resolving @playwright/test (installed only under site/).
    // wicked-worktrees/ holds governed-run worktrees (gitignored checkouts a
    // crew run makes INSIDE this repo) — same sweep problem, foreign suites.
    exclude: [...configDefaults.exclude, 'site/**', 'wicked-worktrees/**', 'tests/e2e/**'],
  },
}));
