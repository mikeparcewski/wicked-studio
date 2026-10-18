import { test, expect, type Page } from '@playwright/test';

/**
 * The hero, demo included, has to fit a laptop screen.
 *
 * The hero's argument is the working demo, so the decision buttons must be on screen on load at
 * 1440x700 (900 is taller than a real laptop window once browser chrome is counted; at 900 an
 * earlier version of this page measured "fits" while its gate buttons sat 300px below the fold).
 * These assert against the viewport, not fixed pixel counts, so copy edits do not trip them.
 */

const LAPTOP = { width: 1440, height: 700 };
const LAPTOP_TALL = { width: 1440, height: 760 };

const barHeight = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('.topbar, header[class*="topbar"]');
    return bar ? Math.round(bar.getBoundingClientRect().height) : 0;
  });

for (const vp of [LAPTOP, LAPTOP_TALL]) {
  test.describe(`hero at ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp });

    test('the hero content fits with slack', async ({ page }) => {
      // The rendered .hero is clamped by min-height, so it reads "fits" right up until it does
      // not. Measure the content instead and require slack: CI's Linux runner renders this
      // page's webfonts ~24px taller than macOS.
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const { content } = await page.evaluate(() => {
        const hero = document.querySelector('.hero') as HTMLElement;
        const st = getComputedStyle(hero);
        let total = parseFloat(st.paddingTop) + parseFloat(st.paddingBottom);
        Array.from(hero.children).forEach((c) => {
          const el = c as HTMLElement;
          if (el.classList.contains('amber-floor')) return;
          const cs = getComputedStyle(el);
          total += el.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom);
        });
        return { content: Math.round(total) };
      });
      const usable = vp.height - (await barHeight(page));
      expect(usable - content, `.hero content is ${content}px in ${usable}px of usable height`).toBeGreaterThanOrEqual(20);
    });

    test('the plan and the gate decisions are on screen without scrolling', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const ide = page.locator('[data-ide]');
      const approvePlan = ide.getByRole('button', { name: 'Approve plan' });
      await expect(approvePlan).toBeVisible({ timeout: 10_000 });
      await expect(approvePlan).toBeInViewport({ ratio: 1 });

      await approvePlan.click();
      for (const name of ['Approve', 'Approve with a note for the next step', 'Send back']) {
        const btn = ide.getByRole('button', { name, exact: true });
        await expect(btn).toBeVisible({ timeout: 10_000 });
        // The thread scrolls inside the demo; the page itself never moves.
        await expect(btn, `"${name}" is below the fold`).toBeInViewport({ ratio: 1 });
      }
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
    });

    test('the platform band fits the viewport', async ({ page }) => {
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const h = await page.evaluate(() =>
        Math.round(document.querySelector('.same-garden')!.getBoundingClientRect().height),
      );
      const usable = vp.height - (await barHeight(page));
      expect(h, `.same-garden is ${h}px in ${usable}px of usable height`).toBeLessThanOrEqual(usable);
    });
  });
}
