import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The shared-chrome SameGarden map (.same-garden) with wicked-studio's card
 * as the "you are here" marker — the map stays complete, the site never
 * promotes itself, and the sibling skin (wicked-interactive) stays linked.
 */
test.describe('SameGarden four-plane map (.same-garden)', () => {
  test('all four planes render with wicked-studio as "you are here"', async ({ page }) => {
    await page.goto('/');
    const map = page.locator('.same-garden');
    await bringIntoView(map);
    await expect(map).toBeVisible();

    // Four plane bands, three contract seams between them.
    await expect(map.locator('.sg-plane')).toHaveCount(4);
    await expect(map.locator('.sg-contract')).toHaveCount(3);

    // Studio's card is the non-link "you are here" marker.
    const here = map.locator('.sg-card--here');
    await expect(here).toHaveCount(1);
    await expect(here).toContainText('wicked-studio');
    await expect(here.locator('.sg-here-chip')).toHaveText('you are here');

    // The sibling skin shares the experience plane and stays linked.
    const experience = map.locator('.sg-plane--experience');
    await expect(experience.locator('.sg-card')).toHaveCount(2);
    await expect(map.getByRole('link', { name: 'Visit wicked-interactive' })).toBeVisible();

    // The rest of the family stays complete and linked.
    await expect(map.getByRole('link', { name: 'Visit wicked-crew' })).toBeVisible();
    await expect(map.getByRole('link', { name: 'Visit wicked-garden' })).toBeVisible();
    await expect(map.getByRole('link', { name: 'Visit wicked-estate' })).toBeVisible();
  });
});
