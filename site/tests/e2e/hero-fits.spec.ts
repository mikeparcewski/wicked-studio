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
      // The hero is exactly one frame and the demo flexes to fill it, so measure the part that does
      // not flex: the copy column must end with slack above the frame's bottom (CI's Linux runner
      // renders this page's webfonts ~24px taller than macOS), and nothing may overflow the hero.
      await page.goto('/');
      await page.evaluate(async () => { await document.fonts.ready; });
      const m = await page.evaluate(() => {
        const hero = document.querySelector('.hero') as HTMLElement;
        const copy = document.querySelector('.hero-copy') as HTMLElement;
        const hr = hero.getBoundingClientRect(), cr = copy.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(hero).paddingBottom);
        return { slack: Math.round(hr.bottom - pad - cr.bottom), sh: hero.scrollHeight, ch: hero.clientHeight, h: Math.round(hr.height) };
      });
      const usable = vp.height - (await barHeight(page));
      expect(m.h, `.hero is ${m.h}px in ${usable}px`).toBeLessThanOrEqual(usable);
      expect(m.sh, 'the hero overflows itself').toBeLessThanOrEqual(m.ch + 1);
      expect(m.slack, `the copy column ends ${m.slack}px above the frame's bottom`).toBeGreaterThanOrEqual(20);
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
