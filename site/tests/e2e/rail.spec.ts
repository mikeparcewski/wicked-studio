import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The insight rail [data-rail] — 8 chips (Burn, Decisions, Governance,
 * Assumptions, Steering, Files, Term, Cov); clicking one swaps the caption
 * line to that panel's answer.
 */
test.describe('insight rail [data-rail]', () => {
  test('eight chips render; clicking one swaps the caption', async ({ page }) => {
    await page.goto('/');
    const rail = page.locator('[data-rail]');
    await bringIntoView(rail);
    await expect(rail.locator('[data-rail-chip]')).toHaveCount(8);

    // Burn is the default active chip and its caption shows.
    const line = page.locator('[data-rail-line]');
    await expect(rail.locator('[data-rail-chip].is-active')).toHaveText('Burn');
    await expect(line).toContainText('Tokens, cost, and rework');

    // Click Term → the PTY caption, with the real WS route.
    await rail.getByRole('button', { name: 'Term', exact: true }).click();
    await expect(line).toContainText('/ws/terminals/:id');
    await expect(rail.locator('[data-rail-chip].is-active')).toHaveText('Term');

    // Click Decisions → the ledger caption.
    await rail.getByRole('button', { name: 'Decisions' }).click();
    await expect(line).toContainText('who approved what');
  });
});
