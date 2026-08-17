import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
