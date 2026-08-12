import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The client seam [data-pair] — how the SPA finds its daemon. Two modes,
 * both real (src/api/client.ts): bundled/same-origin (window.location.origin)
 * and standalone (VITE_API_HOST baked at build time). The standalone proof
 * strip cites the scripted e2e.
 */
test.describe('the client seam [data-pair]', () => {
  test('defaults to bundled; flipping shows the standalone pairing', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('[data-pair]');
    await bringIntoView(panel);
    await expect(panel).toHaveAttribute('data-mode', 'bundled');

    // Bundled: same-origin resolution, one command.
    const bundled = panel.locator('.pair-stage--bundled');
    await expect(bundled).toBeVisible();
    await expect(bundled).toContainText('npx wicked-crew serve');
    await expect(bundled).toContainText("window.location.origin + '/api/v1'");
    await expect(panel.locator('.pair-stage--standalone')).toBeHidden();

    // Flip to standalone: VITE_API_HOST pairing against any daemon.
    await panel.getByRole('tab', { name: /standalone/ }).click();
    await expect(panel).toHaveAttribute('data-mode', 'standalone');
    const standalone = panel.locator('.pair-stage--standalone');
    await expect(standalone).toBeVisible();
    await expect(standalone).toContainText('VITE_API_HOST=127.0.0.1:7701');
    await expect(standalone).toContainText('http://127.0.0.1:7701/api/v1');
    await expect(bundled).toBeHidden();

    // The proof strip stays put in either mode: the carve's scripted e2e.
    const proof = panel.locator('.pair-proof');
    await expect(proof).toBeVisible();
    await expect(proof).toContainText('e2e/studio_standalone_test.py');
    await expect(proof).toContainText('approve a human gate');
  });
});
