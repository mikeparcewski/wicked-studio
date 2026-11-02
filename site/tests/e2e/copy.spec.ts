import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The install copy buttons + the page's honest-boundary copy.
 * Clipboard permissions granted; 127.0.0.1 is a secure context.
 */
test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

test.describe('install copy buttons', () => {
  test('bundled serve copy button copies the command and shows feedback', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: 'Copy the bundled serve command' });
    await bringIntoView(btn);
    await btn.click();

    await expect(btn).toHaveText('Copied');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('npx wicked-crew serve');

    // Feedback resets after ~1.4s.
    await expect(btn).toHaveText('Copy');
  });

  test('standalone copy button copies both commands', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: 'Copy the standalone build commands' });
    await bringIntoView(btn);
    await btn.click();

    await expect(btn).toHaveText('Copied');
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('VITE_API_HOST=127.0.0.1:7701 npm run build\nnpx serve dist');

    await expect(btn).toHaveText('Copy');
  });
});

test.describe('honest boundaries', () => {
  test('studio is a pure client and grades nothing', async ({ page }) => {
    await page.goto('/');

    const get = page.locator('.get');
    await bringIntoView(get);
    await expect(get).toContainText('pure client');
    await expect(get).toContainText('wicked-crew-api-types');

    // Review is crew's: the skin surfaces it, never grades it.
    const review = page.locator('.review');
    await bringIntoView(review);
    await expect(review).toContainText('never grades anything');
    await expect(review.getByRole('link', { name: 'crew’s' })).toHaveAttribute('href', 'https://wc.wickedagile.com');
    await expect(review).toContainText('reduced assurance');

    // Knowledge is estate's.
    await expect(page.locator('.steer').getByRole('link', { name: 'wicked-estate' })).toHaveAttribute(
      'href',
      'https://we.wickedagile.com',
    );
  });

  test('the demo says it is a demo', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-demo-note]')).toContainText('scripted demo');
  });
});

test.describe('the reviewed messaging', () => {
  test('rules reach every repository or one project, never one repo', async ({ page }) => {
    await page.goto('/');
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    // There is no per-repo rule target: rules apply everywhere or to one project, and can
    // target a language, layer or framework (core crates/wicked-governance/src/conformance.rs).
    expect(body).not.toMatch(/one repo\b/i);
    await expect(page.locator('.steer')).toContainText('a language, a layer or a framework');
  });

  test('under the hero: the default-review small print, three benefits, what is new, what is coming', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero .hero-fine')).toContainText('By default a different agent reviews the work.');
    await expect(page.locator('.hero .hero-fine')).toContainText('reduced assurance');
    const why = page.locator('.why');
    await expect(why.locator('.trio-card')).toHaveCount(3);
    await expect(why.locator('.tab-grid--4 .tab-tile')).toHaveCount(8);
    const soon = why.locator('.soon');
    await expect(soon).toContainText('Coming soon:');
    await expect(soon).toContainText('Apps');
    await expect(soon).not.toContainText(/20\d\d|Q[1-4]/);
  });

  test('QE acceptance names its five kinds of job', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.review .facts')).toContainText(
      'a feature, bug fix, migration, MCP server or editor plugin need QE acceptance',
    );
  });
});
