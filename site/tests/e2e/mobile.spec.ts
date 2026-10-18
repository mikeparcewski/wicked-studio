import { test, expect, devices } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * Phones (390x844): the demo is the same working demo, stacked. Jobs become a row of tabs, the
 * chat keeps its height, the side panel drops below it, and the page never scrolls sideways.
 */
// iPhone 12 geometry/UA only — the full descriptor carries
// defaultBrowserType: 'webkit', which would switch away from the cached Chromium.
const iphone12 = devices['iPhone 12'];
test.use({
  viewport: iphone12.viewport,
  userAgent: iphone12.userAgent,
  deviceScaleFactor: iphone12.deviceScaleFactor,
  isMobile: iphone12.isMobile,
  hasTouch: iphone12.hasTouch,
});

test.describe('mobile (390×844)', () => {
  test('the demo works on a phone', async ({ page }) => {
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    await expect(ide).toBeVisible();
    await ide.getByRole('button', { name: 'Approve plan' }).click({ timeout: 10_000 });
    await ide.getByRole('button', { name: 'Send back' }).click({ timeout: 10_000 });
    await expect(ide.locator('.msg--done')).toContainText('Pull request #12 is open.', { timeout: 15_000 });
    await expect(ide.locator('.ide-pane')).toBeVisible();
    await expect(ide.locator('.files .file')).toHaveCount(3);
  });

  test('no horizontal overflow anywhere on the page', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the proof sections and the four-plane map render on a phone', async ({ page }) => {
    await page.goto('/');
    for (const sel of ['.tab-grid', '.receipt', '.trio', '.hits', '.install--primary']) {
      const loc = page.locator(sel);
      await bringIntoView(loc);
      await expect(loc).toBeVisible();
    }
    const map = page.locator('.same-garden');
    await bringIntoView(map);
    await expect(map.locator('.sg-plane')).toHaveCount(4);
    await expect(map.locator('.sg-card--here')).toBeVisible();
  });

  test('the hamburger menu lists studio as a site link', async ({ page }) => {
    await page.goto('/');
    await page.locator('#menuBtn').click();
    const menu = page.locator('#mobileMenu');
    await expect(menu).toBeVisible();
    const studioRow = menu.getByRole('link', { name: /studio/ });
    await expect(studioRow).toHaveAttribute('href', 'https://ws.wickedagile.com');
  });
});
