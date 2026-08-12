import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * One project, two skins [data-proj] — the experience-plane interchangeability
 * story. The same project (payments-refresh) re-renders under either skin;
 * the API call in the foot never changes, and the honest note keeps the
 * studio's own project browser labeled as landing.
 */
test.describe('one project, two skins [data-proj]', () => {
  test('defaults to the coder skin; flipping renders the same project as the creator skin', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('[data-proj]');
    await bringIntoView(card);
    await expect(card).toHaveAttribute('data-skin', 'studio');

    // The studio rendering shows; the interactive one is hidden.
    await expect(card.locator('.proj-feed--studio')).toBeVisible();
    await expect(card.locator('.proj-feed--interactive')).toBeHidden();
    await expect(card.locator('.proj-feed--studio li').first()).toContainText('run r-7c19');
    await expect(card.locator('[data-proj-skin-label]')).toHaveText('coder’s');

    // Flip to the creator skin — same project, other door.
    await card.getByRole('tab', { name: /interactive · creator/ }).click();
    await expect(card).toHaveAttribute('data-skin', 'interactive');
    await expect(card.locator('.proj-feed--studio')).toBeHidden();
    const intFeed = card.locator('.proj-feed--interactive');
    await expect(intFeed).toBeVisible();
    // The real bus vocabulary rides the creator rendering.
    await expect(intFeed.locator('li').first()).toContainText('wicked.interactive.doc.created');
    await expect(intFeed).toContainText('wicked.interactive.draft.completed');
    await expect(card.locator('[data-proj-skin-label]')).toHaveText('creator’s');

    // The project id and the API call never change — one room, two doors.
    await expect(card.locator('.proj-id')).toContainText('payments-refresh');
    await expect(card.locator('.proj-call')).toHaveText('GET /api/v1/projects/payments-refresh/activity');

    // And back.
    await card.getByRole('tab', { name: /studio · coder/ }).click();
    await expect(card).toHaveAttribute('data-skin', 'studio');
    await expect(card.locator('.proj-feed--studio')).toBeVisible();
  });

  test('the honest note ships: model shipped in the control plane, browser landing in the skin', async ({ page }) => {
    await page.goto('/');
    const note = page.locator('.proj .honest-note');
    await bringIntoView(note);
    await expect(note).toContainText('shipped in the control plane');
    await expect(note).toContainText('landing in this skin');
  });
});
