import { defineConfig, devices } from '@playwright/test';

const PORT = 4200;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'on-first-retry',
  },
  // The viewport goes AFTER the device spread: the preset carries its own 1280×720, and a
  // project-level `use` beats the top-level one, so a top-level viewport would be silently lost.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 700 } } },
  ],
  webServer: {
    // Use the production preview server so VITE_API_HOST (.env.development) is NOT
    // injected — API calls hit window.location.origin and Playwright's page.route()
    // mocks intercept them cleanly. Build first so preview never serves a stale or missing dist/.
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
