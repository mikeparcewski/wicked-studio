import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The run board [data-board] — the SPA's real panels as an auto-cycling
 * switcher. Clicking a panel pins it (stage swaps name + API route + line);
 * the status button resumes the cycle.
 */
test.describe('the run board [data-board]', () => {
  test('eight real panels render; clicking one pins the stage to it', async ({ page }) => {
    await page.goto('/');
    const board = page.locator('[data-board]');
    await bringIntoView(board);
    await expect(board.locator('[data-board-item]')).toHaveCount(8);

    // Pin the workflows panel: the stage swaps to its name + real route.
    await board.getByRole('tab', { name: 'workflows' }).click();
    await expect(page.locator('[data-bs-name]')).toHaveText('workflows');
    await expect(page.locator('[data-bs-api]')).toHaveText('GET /workflows');
    await expect(page.locator('[data-bs-line]')).toContainText('WorkflowDef');
    await expect(board.getByRole('tab', { name: 'workflows' })).toHaveAttribute('aria-selected', 'true');

    // Pinning pauses the auto-cycle and says so.
    await expect(page.locator('[data-board-status-txt]')).toContainText('pinned');

    // Pin policies: honest line — the skin surfaces the gate, never grades.
    await board.getByRole('tab', { name: 'policies' }).click();
    await expect(page.locator('[data-bs-api]')).toHaveText('GET /governance/policies');
    await expect(page.locator('[data-bs-line]')).toContainText('never grades');

    // The status button resumes the auto-cycle.
    await page.locator('[data-board-toggle]').click();
    await expect(page.locator('[data-board-status-txt]')).toContainText('auto-cycling');
  });
});
