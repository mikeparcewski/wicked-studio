import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The hero console [data-console] — the page's signature: this IS the product.
 * Launch → the CoreEvent feed streams (700ms/step) → the steering gate raises →
 * the human resolves it. The submit handler resets + re-streams a fresh run,
 * which makes the flow deterministic regardless of the scroll-in auto-play.
 */
test.describe('the console [data-console]', () => {
  test('launch streams the feed, raises the gate, approve advances the run', async ({ page }) => {
    await page.goto('/');
    const console_ = page.locator('[data-console]');
    await bringIntoView(console_);

    // Relaunch deterministically (the widget also auto-runs on scroll-in;
    // submitting resets the feed and streams a fresh run).
    await console_.locator('[data-console-go]').click();

    const feed = console_.locator('[data-console-feed]');
    await expect(feed.locator('.cf-row').first()).toBeVisible();

    // The stream ends held at the gate: 7 feed rows, gate visible, verdict DENY.
    const gate = console_.locator('[data-console-gate]');
    await expect(gate).toBeVisible({ timeout: 15_000 });
    await expect(feed.locator('.cf-row')).toHaveCount(7);
    await expect(feed.locator('.cf-row').first()).toContainText('POST /api/v1/runs');
    await expect(feed.locator('.cf-row').last()).toContainText('held for your decision');
    const stamp = console_.locator('[data-cg-stamp]');
    await expect(stamp).toHaveText('DENY');

    // All three steering actions are offered and live.
    const approve = gate.locator('[data-cg-action="approve"]');
    await expect(approve).toBeEnabled();
    await expect(gate.locator('[data-cg-action="steer"]')).toBeEnabled();
    await expect(gate.locator('[data-cg-action="reject"]')).toBeEnabled();

    // Approve advances the flow: verdict flips, the override is logged on the
    // decisions ledger, the terminal posts the gate decision, buttons retire.
    await approve.click();
    await expect(stamp).toHaveText('ALLOW');
    await expect(gate).toHaveAttribute('data-verdict', 'allow');
    await expect(feed.locator('.cf-row').last()).toContainText('allowed');
    await expect(console_.locator('[data-console-term]')).toContainText('POST /api/v1/runs/r-7c19/gate');
    await expect(approve).toBeDisabled();
  });

  test('approve-with-steer opens the amendment and re-verifies to PASS', async ({ page }) => {
    await page.goto('/');
    const console_ = page.locator('[data-console]');
    await bringIntoView(console_);
    await console_.locator('[data-console-go]').click();

    const gate = console_.locator('[data-console-gate]');
    await expect(gate).toBeVisible({ timeout: 15_000 });

    // Steer opens an amendment input pre-filled with a real fix.
    await gate.locator('[data-cg-action="steer"]').click();
    const amend = gate.locator('.cg-amend input');
    await expect(amend).toBeVisible();
    await amend.fill('add rollback migration + regen schema');
    await amend.press('Enter');

    // The amendment rides the next prompt; the gate re-verifies to ALLOW and
    // the terminal resumes the run over the real route.
    await expect(console_.locator('[data-cg-stamp]')).toHaveText('ALLOW');
    const feed = console_.locator('[data-console-feed]');
    await expect(feed.locator('.cf-row').last()).toContainText('PASS');
    await expect(console_.locator('[data-console-term]')).toContainText('POST /api/v1/runs/r-7c19/resume');
  });

  test('reject holds the run — nothing ships', async ({ page }) => {
    await page.goto('/');
    const console_ = page.locator('[data-console]');
    await bringIntoView(console_);
    await console_.locator('[data-console-go]').click();

    const gate = console_.locator('[data-console-gate]');
    await expect(gate).toBeVisible({ timeout: 15_000 });

    await gate.locator('[data-cg-action="reject"]').click();
    await expect(console_.locator('[data-cg-stamp]')).toHaveText('DENY');
    await expect(gate).toHaveAttribute('data-verdict', 'deny');
    const feed = console_.locator('[data-console-feed]');
    await expect(feed.locator('.cf-row').last()).toContainText('awaiting a new diff');
    await expect(console_.locator('[data-console-term]')).toContainText('gate reject');
  });
});
