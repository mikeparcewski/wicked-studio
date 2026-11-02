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
    for (const sel of ['.why .trio', '.desk .explorer', '.receipt', '.steer .trio', '.hits', '.new .news', '.install--primary']) {
      const loc = page.locator(sel);
      await bringIntoView(loc);
      await expect(loc).toBeVisible();
    }
    const map = page.locator('.same-garden');
    await bringIntoView(map);
    await expect(map.locator('.sg-plane')).toHaveCount(4);
    await expect(map.locator('.sg-card--here')).toBeVisible();
  });

  test('driving the demo never changes the page height (the panel has a fixed height)', async ({ page }) => {
    // The side panel used to be max-height:300px in an auto-height body, so every tap grew or shrank
    // the hero by up to 170px and pushed every section below it.
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    const heroH = () => page.locator('.hero').evaluate((el) => Math.round(el.getBoundingClientRect().height));
    await ide.getByRole('button', { name: 'Approve plan' }).waitFor({ timeout: 10_000 });
    const h0 = await heroH();
    await ide.getByRole('button', { name: 'Approve plan' }).click();
    await expect(ide.getByRole('button', { name: 'Send back' })).toBeVisible({ timeout: 10_000 });
    expect(await heroH()).toBe(h0);
    await ide.getByRole('tab', { name: 'Receipt' }).click();
    expect(await heroH()).toBe(h0);
    await ide.getByRole('tab', { name: /Changes/ }).click();
    await ide.locator('.files .file').nth(2).click();
    expect(await heroH()).toBe(h0);
    await ide.locator('[data-id="flaky"]').click();
    expect(await heroH()).toBe(h0);
  });

  test('the jobs are a three-way switcher and every demo control is a 44px target', async ({ page }) => {
    await page.goto('/');
    const ide = page.locator('[data-ide]');
    await bringIntoView(ide);
    await ide.getByRole('button', { name: 'Approve plan' }).waitFor({ timeout: 10_000 });
    const tabs = ide.locator('.ide-sess');
    await expect(tabs).toHaveCount(3);
    // the short titles are what shows; the full title and status are the tabs' names
    await expect(ide.getByRole('tab', { name: /^Fix the flaky checkout test, Waiting on you$/ })).toBeVisible();
    // the Node 22 job runs to done in the background
    await expect(ide.getByRole('tab', { name: /^Move CI to Node 22, (Done|GitHub Copilot working)$/ })).toBeVisible();
    for (let k = 0; k < 3; k++) await expect(tabs.nth(k)).toBeInViewport();
    const short = await ide.locator('button, input, [role=tab]').evaluateAll((els) =>
      els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 44; })
        .map((e) => (e.textContent || '').trim().slice(0, 24) + ' ' + Math.round(e.getBoundingClientRect().height)),
    );
    expect(short).toEqual([]);
  });

  test('a tap that pins a tour or pauses a frame never changes the page height', async ({ page }) => {
    // Pause and Play were different widths, so the heading beside the button rewrapped on a tap and
    // the tablist jumped 25px under the finger (critic, 390x844).
    await page.goto('/');
    const desk = page.locator('#desk');
    await page.locator('#ex-tab-agents').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const d0 = await desk.evaluate((el) => (el as HTMLElement).offsetHeight);
    const doc0 = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.locator('#ex-tab-agents').tap();
    await expect(page.locator('.desk [data-play-toggle]')).toHaveAttribute('aria-pressed', 'true');
    expect(await desk.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(d0);
    const why = page.locator('#why');
    const btn = why.locator('[data-play-toggle]');
    await btn.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const w0 = await why.evaluate((el) => (el as HTMLElement).offsetHeight);
    await btn.tap();
    await expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(await why.evaluate((el) => (el as HTMLElement).offsetHeight)).toBe(w0);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(doc0);
  });

  test('the first screen names the product; the benefits stack and read in full', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero-pkg')).toBeVisible();
    await expect(page.locator('.hero-pkg')).toHaveText('wicked-studio');
    await expect(page.locator('.hero-pkg')).toBeInViewport();
    // three cards, one under the other, each the full width of the row
    const cards = await page.locator('.why .ben').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width) }; }));
    expect(cards).toHaveLength(3);
    expect(cards[0].l).toBe(cards[1].l);
    expect(cards[1].t).toBeGreaterThan(cards[0].t);
    expect(cards[2].t).toBeGreaterThan(cards[1].t);
    // the Learn schematic wraps instead of cutting words off
    const cut = await page.locator('.art-learn .al-row span').evaluateAll((ls) => ls.filter((l) => l.scrollWidth > l.clientWidth + 1).length);
    expect(cut).toBe(0);
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
