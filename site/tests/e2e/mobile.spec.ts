import { test, expect, devices } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * Phone-native fallbacks (≤600px): the live console is a desktop affordance —
 * a phone gets the static launch → watch → steer story (.console-static)
 * instead, and the page never scrolls horizontally.
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
  test('the static console fallback replaces the live console', async ({ page }) => {
    await page.goto('/');

    // Live console hidden, static launch → watch → steer story shown.
    await expect(page.locator('[data-console]')).toBeHidden();
    const staticConsole = page.locator('.console-static');
    await expect(staticConsole).toBeVisible();
    await expect(staticConsole.locator('.cs-steps li')).toHaveCount(3);
    await expect(staticConsole).toContainText('Launch');
    await expect(staticConsole).toContainText('Steer');
    await expect(staticConsole).toContainText('DENY');
  });

  test('no horizontal overflow anywhere on the page', async ({ page }) => {
    await page.goto('/');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the projects card, seam panel, and four-plane map render on a phone', async ({ page }) => {
    await page.goto('/');

    // One project, two skins: the toggle still works with touch targets.
    const card = page.locator('[data-proj]');
    await bringIntoView(card);
    await expect(card).toBeVisible();
    await card.getByRole('tab', { name: /interactive · creator/ }).click();
    await expect(card).toHaveAttribute('data-skin', 'interactive');

    // The seam panel keeps both modes reachable.
    const pair = page.locator('[data-pair]');
    await bringIntoView(pair);
    await expect(pair).toBeVisible();
    await pair.getByRole('tab', { name: /standalone/ }).click();
    await expect(pair).toHaveAttribute('data-mode', 'standalone');

    // SameGarden is CSS-only and degrades — all four planes visible.
    const map = page.locator('.same-garden');
    await bringIntoView(map);
    await expect(map).toBeVisible();
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
