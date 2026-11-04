import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import * as client from '../src/api/client.js';

/**
 * S19b: the launch form names its workflow the composer's way — a leading `/` in the problem box
 * opens the "Start work" menu and a pick sets the form's workflow (the "Choose workflow" select is
 * gone). Call before typing the problem: the `/` must be the box's first token.
 */
export async function pickLaunchWorkflow(user: ReturnType<typeof userEvent.setup>, workflow: string): Promise<void> {
  // slash-catalog: the menu lists New job's catalog. A test that has not said which daemon it runs on
  // gets an older one (no catalog route: today's workflows); a test that mocked the catalog keeps it.
  if (!vi.isMockFunction(client.api.getWorkflowCatalog)) {
    vi.spyOn(client.api, 'getWorkflowCatalog').mockRejectedValue(new client.ApiError(404, 'Not found'));
  }
  const box = screen.getByTestId('launch-problem');
  await user.click(box);
  await user.type(box, '/');
  const sel = `[data-testid="composer-menu-item"][data-workflow="${workflow}"]`;
  await waitFor(() => expect(document.querySelector(sel)).not.toBeNull());
  await user.click(document.querySelector(sel) as HTMLElement);
  await waitFor(() => expect(screen.getByTestId('launch-workflow-pill').dataset.workflow).toBe(workflow));
}
