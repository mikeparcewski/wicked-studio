import { test, expect } from '@playwright/test';

/**
 * wicked-web chrome (Topbar, bc5ca29) — theme toggle (#themeBtn ↔ data-theme on <html>,
 * persisted under localStorage 'wa-theme-v3', written only on a click), and the product path
 * "Wicked Agile / labs / wicked-studio" with the flask linking the lab (the Experiments menu is gone).
 */
test.describe('site chrome (wicked-web topbar)', () => {
  test('theme toggle flips data-theme on <html> and persists across reload', async ({ page }) => {
    await page.goto('/');
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    // loading a page persists nothing: only a click writes the choice
    expect(await page.evaluate(() => localStorage.getItem('wa-theme-v3'))).toBeNull();

    await page.locator('#themeBtn').click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wa-theme-v3')))
      .toBe('light');

    // Persists: the no-flash init re-applies the stored theme on reload.
    await page.reload();
    await expect(html).toHaveAttribute('data-theme', 'light');

    // And toggles back.
    await page.locator('#themeBtn').click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('wa-theme-v3')))
      .toBe('dark');
  });

  test('the product path is three links, Wicked Agile / labs / wicked-studio, and the flask links the lab', async ({ page }) => {
    await page.goto('/');
    const links = page.locator('.topbar').getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link');
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAccessibleName('Wicked Agile');
    await expect(links.nth(0)).toHaveAttribute('href', 'https://wickedagile.com/');
    await expect(links.nth(1)).toHaveText('labs');
    await expect(links.nth(1)).toHaveAttribute('href', 'https://wickedlabs.ai/');
    await expect(links.nth(2)).toHaveText('wicked-studio');
    await expect(links.nth(2)).toHaveAttribute('href', 'https://ws.wickedagile.com');
    await expect(links.nth(2)).toHaveAttribute('aria-current', 'page');
    for (const l of await links.all()) await expect(l).toBeVisible();
    await expect(page.locator('.topbar').getByRole('link', { name: 'Wicked Labs' })).toHaveAttribute('href', 'https://wickedlabs.ai/');
    // the Experiments menu is gone
    await expect(page.locator('#projectsBtn, #projectsMenu')).toHaveCount(0);
  });
});
