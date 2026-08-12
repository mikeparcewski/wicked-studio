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
  test('the page claims pure-client status, never governance ownership', async ({ page }) => {
    await page.goto('/');

    // The seam section owns the honesty headline: zero crew source, one contract.
    const pair = page.locator('.pair');
    await bringIntoView(pair);
    await expect(pair).toContainText('zero');
    await expect(pair).toContainText('wicked-crew-api-types');
    await expect(pair).toContainText('there is no back channel');

    // The board credits governance to crew — the skin surfaces, never grades.
    const board = page.locator('.board');
    await bringIntoView(board);
    await expect(board).toContainText('never grades');
    await expect(board.getByRole('link', { name: 'crew’s' })).toHaveAttribute(
      'href',
      'https://wc.wickedagile.com'
    );
  });
});
