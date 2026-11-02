import { test, expect } from '@playwright/test';

/**
 * The quieter lines inside the reach cards and the Get-it intro sit one step below their block's
 * text (body 14px under a lead 16px paragraph). Their rules need !important to beat the block's
 * `p` rule; the type pass once dropped it and they rendered at 16px.
 */
test('the reach limit is body size under a lead-size card paragraph', async ({ page }) => {
  await page.goto('/');
  const limit = page.locator('.reach-limit');
  await expect(limit).toHaveCount(1);
  await expect(limit).toHaveCSS('font-size', '14px');
});
