import { readFileSync } from 'node:fs';

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

export default defineConfig({
  plugins: [react(), emitTestidInventory()],
  server: { port: 4200, host: '127.0.0.1' },
  preview: { port: 4200 },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // site/ is the marketing site — its own app with its own deps and a
    // Playwright suite (site/tests/e2e, run by the Site E2E workflow).
    // Without this, vitest's default include sweeps those *.spec.ts files
    // and fails resolving @playwright/test (installed only under site/).
    // wicked-worktrees/ holds governed-run worktrees (gitignored checkouts a
    // crew run makes INSIDE this repo) — same sweep problem, foreign suites.
    exclude: [...configDefaults.exclude, 'site/**', 'wicked-worktrees/**'],
  },
});
