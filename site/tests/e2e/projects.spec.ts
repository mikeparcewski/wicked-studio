import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * One project, one feed [data-proj] — the same project (payments-refresh) and the
 * same merged activity feed, centred on the runs or on the document. The API call in
 * the foot never changes. The honest note says what studio ships today: a project is a
 * scope on the one Desk shell — the project shell, per-project dashboard and classic
 * skins retired (S18d).
 */
test.describe('one project, one feed [data-proj]', () => {
  test('defaults to the runs lens; flipping centres the same feed on the document', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('[data-proj]');
    await bringIntoView(card);
    await expect(card).toHaveAttribute('data-skin', 'studio');

    // The studio rendering shows; the interactive one is hidden.
    await expect(card.locator('.proj-feed--studio')).toBeVisible();
    await expect(card.locator('.proj-feed--interactive')).toBeHidden();
    await expect(card.locator('.proj-feed--studio li').first()).toContainText('run r-7c19');
    await expect(card.locator('[data-proj-skin-label]')).toHaveText('runs');

    // Labels were 'studio · coder' / 'interactive · creator' — the two-front-doors framing.
    // wicked-interactive is no longer a front door (its UI moved here), so the tabs describe the
    // VIEW, not a second product you could go visit.
    await card.getByRole('tab', { name: /centred on the document/ }).click();
    await expect(card).toHaveAttribute('data-skin', 'interactive');
    await expect(card.locator('.proj-feed--studio')).toBeHidden();
    const intFeed = card.locator('.proj-feed--interactive');
    await expect(intFeed).toBeVisible();
    // The real bus vocabulary rides the document rendering.
    await expect(intFeed.locator('li').first()).toContainText('wicked.interactive.doc.created');
    await expect(intFeed).toContainText('wicked.interactive.draft.completed');
    await expect(card.locator('[data-proj-skin-label]')).toHaveText('document');

    // The project id and the API call never change — one room, two views of it.
    await expect(card.locator('.proj-id')).toContainText('payments-refresh');
    await expect(card.locator('.proj-call')).toHaveText('GET /api/v1/projects/payments-refresh/activity');

    // And back.
    await card.getByRole('tab', { name: /centred on the runs/ }).click();
    await expect(card).toHaveAttribute('data-skin', 'studio');
    await expect(card.locator('.proj-feed--studio')).toBeVisible();
  });

  test('the honest note ships: model shipped in the control plane, a project is a scope in studio', async ({ page }) => {
    await page.goto('/');
    const note = page.locator('.proj .honest-note');
    await bringIntoView(note);
    await expect(note).toContainText('shipped in the control plane');
    await expect(note).toContainText('scope, not a separate shell');
    // The retired project shell must not come back as a claim.
    await expect(note).not.toContainText('four-mode shell');
    await expect(note).not.toContainText('dashboard');
    // The stale future-tense claim must never come back (docs-R9).
    await expect(note).not.toContainText('landing in this skin');
  });
});
