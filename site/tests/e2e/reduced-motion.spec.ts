import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * prefers-reduced-motion: no pageerror, every section visible, and the demo skips its timing:
 * it reaches the plan at once and each decision lands its outcome at once.
 */
test.use({ contextOptions: { reducedMotion: 'reduce' } });

test.describe('reduced motion', () => {
  test('page loads clean and the demo runs without waiting', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/');
    await expect(page.locator('.hero h1')).toBeVisible();

    const ide = page.locator('[data-ide]');
    await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible();
    await ide.getByRole('button', { name: 'Approve plan' }).click();
    await ide.getByRole('button', { name: 'Send back' }).click();
    // No timers under reduced motion: the outcome is already there.
    await expect(ide.locator('.msg--done')).toContainText('Pull request #12 is open.', { timeout: 1_000 });
    await expect(ide.locator('[data-working]')).toHaveCount(0);

    // Every scene shows its final frame and nothing loops: no Pause buttons, the relay is complete,
    // the counters show their values and the command is typed out.
    await expect(page.locator('[data-scene][data-step="4"]')).toHaveCount(3);
    await expect(page.locator('[data-play-toggle]:visible')).toHaveCount(0);
    await expect(page.locator('.relay')).toHaveAttribute('data-tok', 'y');
    await expect(page.locator('.receipt tr.is-filled')).toHaveCount(5);
    await expect(page.locator('.hits [data-n="4"]')).toHaveText('4');
    await expect(page.locator('.hits caption')).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-typed]')).toHaveText('npx wicked-crew serve');

    for (const sel of ['.desk', '.review', '.steer', '.reach', '.new', '.same-garden', '.install--primary']) {
      const loc = page.locator(sel);
      await bringIntoView(loc);
      await expect(loc).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
});
