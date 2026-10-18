import { test, expect, type Page } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The hero demo: a working miniature of the Desk. These tests drive it the way a visitor does and
 * assert what each decision changes, so a demo that renders but does nothing fails here.
 */

async function atPlan(page: Page) {
  await page.goto('/');
  const ide = page.locator('[data-ide]');
  await bringIntoView(ide);
  // The job starts on its own once the demo is on screen, and always stops at the plan.
  await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible({ timeout: 10_000 });
  return ide;
}

async function atGate(page: Page) {
  const ide = await atPlan(page);
  await ide.getByRole('button', { name: 'Approve plan' }).click();
  await expect(ide.getByRole('button', { name: 'Send back' })).toBeVisible({ timeout: 10_000 });
  return ide;
}

test.describe('the demo', () => {
  test('nothing runs until the plan is approved', async ({ page }) => {
    const ide = await atPlan(page);
    await expect(ide.locator('.msg--user')).toContainText('100 requests a minute per API key');
    await expect(ide.locator('.ide-steps li.now')).toHaveText('Plan');
    await expect(ide.locator('[data-files]')).toHaveText('0');

    await ide.getByRole('button', { name: 'Not now' }).click();
    await expect(ide).toContainText('Parked. Nothing has started.');
    await page.waitForTimeout(2500);
    await expect(ide.locator('[data-files]')).toHaveText('0');
    await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible();
  });

  test('approving the plan builds, fills Changes, and holds at a review gate', async ({ page }) => {
    const ide = await atGate(page);
    await expect(ide.locator('.msg--gate')).toContainText('Codex');
    await expect(ide.locator('.msg--gate')).toContainText('per API key');
    await expect(ide.locator('[data-files]')).toHaveText('3');
    await expect(ide.locator('.files .file')).toHaveCount(3);
    await expect(ide.locator('.diff')).toContainText('req.ip');
    await expect(ide.locator('.ide-steps li.now')).toHaveText('Review');
    // The three real gate choices.
    for (const name of ['Approve', 'Approve with a note for the next step', 'Send back']) {
      await expect(ide.getByRole('button', { name, exact: true })).toBeVisible();
    }
  });

  test('Send back reruns the build, the reviewer approves, and the job delivers', async ({ page }) => {
    const ide = await atGate(page);
    await ide.getByRole('button', { name: 'Send back' }).click();
    await expect(ide.locator('.msg--done')).toContainText(
      'Done. Tests pass (38), and codex reviewed and approved it. Pull request #12 is open.',
      { timeout: 15_000 },
    );
    await expect(ide.locator('.diff')).toContainText("x-api-key");
    await expect(ide.locator('.ide-steps li.done')).toHaveCount(5);

    // Evidence opens the receipt: builder and reviewer are different agents.
    await ide.locator('.msg--done').getByRole('button', { name: 'Evidence' }).click();
    const rc = ide.locator('.rc');
    await expect(rc).toContainText('Claude Code');
    await expect(rc).toContainText('Codex');
    await expect(rc).toContainText('separate agent');
    await expect(rc).toContainText('38 pass');
  });

  test('Approve over the finding is recorded as your call', async ({ page }) => {
    const ide = await atGate(page);
    await ide.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(ide).toContainText('That is on the record as your call.');
    await expect(ide.locator('.msg--done')).toContainText('the receipt says so', { timeout: 15_000 });
  });

  test('Approve with a note carries the note', async ({ page }) => {
    const ide = await atGate(page);
    await ide.getByRole('button', { name: 'Approve with a note for the next step' }).click();
    const note = ide.locator('[data-note]');
    await expect(note).toBeFocused();
    await note.fill('Add a Retry-After header');
    await note.press('Enter');
    await expect(ide).toContainText('Your note goes to the next step: “Add a Retry-After header”');
    await expect(ide.locator('.msg--done')).toContainText('with a note', { timeout: 15_000 });
  });

  test('other jobs: answer a question, open a finished job', async ({ page }) => {
    const ide = await atPlan(page);
    await expect(ide.locator('[data-needs]')).toHaveText('2');

    await ide.locator('[data-id="flaky"]').click();
    await expect(ide.locator('[data-title]')).toHaveText('Fix the flaky checkout test');
    await expect(ide.locator('.msg--ask')).toContainText('Codex · is asking');
    await ide.getByRole('button', { name: 'Pass a clock in' }).click();
    await expect(ide).toContainText('You answered: Pass a clock in');
    await expect(ide.locator('[data-needs]')).toHaveText('1');
    await expect(ide.locator('.diff')).toContainText('clock.now()', { timeout: 10_000 });

    await ide.locator('[data-id="node"]').click();
    await expect(ide.locator('.msg--done')).toContainText('Pull request #9 is open.');
    await expect(ide.locator('[data-files]')).toHaveText('2');
  });

  test('New job resets the demo and the composer starts it', async ({ page }) => {
    const ide = await atGate(page);
    await ide.getByRole('button', { name: '+ New job' }).click();
    await expect(ide.locator('.empty')).toBeVisible();
    const input = ide.locator('[data-input]');
    await input.fill('Add pagination to the orders endpoint');
    await ide.getByRole('button', { name: 'Send' }).click();
    await expect(ide.locator('.msg--user')).toHaveText('Add pagination to the orders endpoint');
    await expect(ide).toContainText('This demo replays one recorded job');
    await expect(ide.getByRole('button', { name: 'Approve plan' })).toBeVisible({ timeout: 10_000 });
  });
});
