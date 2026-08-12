import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * prefers-reduced-motion: the page must load with zero pageerror events and
 * every key section visible. The console renders its run fully and instantly
 * (no 700ms streaming), ending at the gate; the board does not auto-cycle.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('reduced motion', () => {
  test('page loads clean and every key section renders', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('.hero h1')).toBeVisible();

    // The console's reduced path renders the whole run at once — all 7 rows
    // and the gate, with no waiting on the stream.
    const console_ = page.locator('[data-console]');
    await bringIntoView(console_);
    await expect(console_.locator('[data-console-gate]')).toBeVisible();
    await expect(console_.locator('.cf-row')).toHaveCount(7);

    // Every key section is present and visible.
    for (const sel of ['[data-board]', '[data-proj]', '[data-pair]', '.same-garden', '.install--primary']) {
      const loc = page.locator(sel);
      await bringIntoView(loc);
      await expect(loc).toBeVisible();
    }

    // The board stays put (no auto-cycle under reduced motion): the stage
    // still answers a click.
    await page.locator('[data-board]').getByRole('tab', { name: 'repos' }).click();
    await expect(page.locator('[data-bs-name]')).toHaveText('repos');

    expect(errors).toEqual([]);
  });
});
