import { expect, test } from '@playwright/test';

// Shaped to the RosterSeat wire contract (src/api/wave6-wire.ts) so the rows render as they do live.
const ROSTER = {
  roster: [
    { key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true, health: { status: 'active' } },
    { key: 'codex', display_name: 'codex', binary: 'codex', enabled_for_council: true, health: { status: 'active' } },
    { key: 'pi', display_name: 'pi', binary: 'pi', enabled_for_council: true, health: { status: 'active' } },
    { key: 'copilot', display_name: 'copilot', binary: 'copilot', enabled_for_council: true, health: { status: 'active' } },
    { key: 'opencode', display_name: 'opencode', binary: 'opencode', enabled_for_council: true, health: { status: 'active' } },
  ],
};

// A governance payload with three long-message findings so the expanded section
// overflows the 572 px viewport budget at 1440×700 and the clip is deterministic.
const GOVERNANCE = {
  store: { path: '/state/core.db.governance/governance.db', source: 'core-db-sidecar' },
  records: { total: 512, sinceBoot: 41 },
  deadletters: {
    path: '/state/core.db.governance/emit-outbox.ndjson',
    count: 128,
    byType: { 'analytics.council': 61, 'agent.commit': 22, 'agent.session': 19, Event: 26 },
    byReason: { 'emit-failed': 88, 'no-consumer': 40 },
    timestamped: 120,
    untimestamped: 8,
    truncated: true,
    // oldestTs/newestTs must be null (not absent) — the guard is `!== null` and
    // `undefined !== null` is true, which would pass undefined to stamp() and throw.
    oldestTs: null,
    newestTs: null,
    legacyOutbox: { path: '/state/legacy/outbox.ndjson', bytes: 48213, scope: 'own' },
  },
  findings: [
    {
      kind: 'deadletters',
      severity: 'error',
      message: `no consumer drained the emit-outbox within the 30 s flush window; ${'x'.repeat(180)}`,
    },
    {
      kind: 'deadletters',
      severity: 'warning',
      message: `emit failed for agent.commit events; callback did not resolve within 30 s. ${'y'.repeat(180)}`,
    },
    {
      kind: 'store',
      severity: 'info',
      message: `governance database reopened after compaction; WAL checkpoint pending. ${'z'.repeat(180)}`,
    },
  ],
};

const DIAGNOSTICS = {
  components: {},
  daemon: {},
  stores: [],
  recentErrors: [],
  acp: { byCli: {} },
  governance: GOVERNANCE,
};

// Viewport is set globally in playwright.config.ts (1440×700).
test('expanded health rail clips at default 5-seat roster and must be scrollable to the last row', async ({
  page,
}) => {
  // Catch-all registered first (lowest priority — Playwright tries most-recently-
  // added routes first, so specific routes registered after will win).
  // Returns 404 so that apiFetch throws ApiError for unmocked routes, which all
  // stores handle via try-catch — avoids returning `{}` which breaks destructuring
  // (e.g. `{ projects: all }` from `{}` gives `all = undefined`, crashing render).
  await page.route('**/api/v1/**', r => r.fulfill({ status: 404, json: { error: 'not found' } }));
  // Specific mocks override the catch-all:
  await page.route('**/api/v1/settings',    r => r.fulfill({ json: { settings: {} } }));
  await page.route('**/api/v1/roster',      r => r.fulfill({ json: ROSTER }));
  await page.route('**/api/v1/health',      r => r.fulfill({ json: { status: 'ok', version: '0.0.0', ping: 'pong' } }));
  await page.route('**/api/v1/diagnostics', r => r.fulfill({ json: DIAGNOSTICS }));

  await page.goto('/');
  await page.getByTestId('rail-health-toggle').click();
  await expect(page.getByTestId('rail-seat-row')).toHaveCount(ROSTER.roster.length);
  // Each row renders as a healthy, keyed seat: a fixture that drifts from the wire contract
  // fails here instead of passing on a count of broken rows.
  for (const seat of ROSTER.roster) {
    await expect(page.locator(`[data-testid="rail-seat-row"][data-seat="${seat.key}"]`)).toContainText('✓');
  }

  const section = page.getByTestId('rail-health-section');
  // The expanded body is the direct child div of the section (toggle is a button sibling).
  // After the fix this element carries overflow-y-auto; we target it structurally so the
  // assertion is independent of class names.
  const body = section.locator(':scope > div');

  // 1. The body must overflow — i.e. content is taller than the visible box.
  await expect
    .poll(() => body.evaluate((el: HTMLElement) => el.scrollHeight > el.clientHeight))
    .toBe(true);

  // 2. Scrolling to the bottom must bring the last governance finding into view.
  await body.evaluate((el: HTMLElement) => { el.scrollTop = el.scrollHeight; });
  await expect(page.getByTestId('rail-governance-finding').last()).toBeInViewport();
});
