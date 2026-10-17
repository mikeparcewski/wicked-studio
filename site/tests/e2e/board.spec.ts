import { test, expect } from '@playwright/test';
import { bringIntoView } from './utils';

/**
 * The Desk and its tabs [data-board] — the Desk's real tabs as an auto-cycling
 * switcher. Clicking a panel pins it (stage swaps name + API route + line);
 * the status button resumes the cycle.
 */
test.describe('the Desk and its surfaces [data-board]', () => {
  test('nine real surfaces render; clicking one pins the stage to it', async ({ page }) => {
    await page.goto('/');
    const board = page.locator('[data-board]');
    await bringIntoView(board);
    await expect(board.locator('[data-board-item]')).toHaveCount(9);
    // The Desk's real tabs, in order (DESK_TABS in src/components/desk/DeskV2.tsx); Work is first.
    await expect(board.locator('[data-board-item]').first()).toContainText('work');
    await expect(board.getByRole('tab', { name: 'steering' })).toHaveCount(0);

    // Pin the agents tab: the stage swaps to its name + real route.
    await board.getByRole('tab', { name: 'agents' }).click();
    await expect(page.locator('[data-bs-name]')).toHaveText('agents');
    await expect(page.locator('[data-bs-api]')).toHaveText('POST /seats/:cli/container-login');
    await expect(page.locator('[data-bs-line]')).toContainText('placeholders');
    await expect(board.getByRole('tab', { name: 'agents' })).toHaveAttribute('aria-selected', 'true');

    // Pinning pauses the auto-cycle and says so.
    await expect(page.locator('[data-board-status-txt]')).toContainText('pinned');

    // Steer and Memory are separate peers: rules with a reach, memory on its own route.
    await board.getByRole('tab', { name: 'steer' }).click();
    await expect(page.locator('[data-bs-api]')).toHaveText('GET /governance/rules');
    await expect(page.locator('[data-bs-line]')).toContainText('one repo');
    await board.getByRole('tab', { name: 'memory' }).click();
    await expect(page.locator('[data-bs-api]')).toHaveText('GET /memory');

    // The status button resumes the auto-cycle.
    await page.locator('[data-board-toggle]').click();
    await expect(page.locator('[data-board-status-txt]')).toContainText('auto-cycling');
  });
});
