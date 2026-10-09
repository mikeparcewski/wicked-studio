import { screen, waitFor } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';

/**
 * S19b: the launch form names its workflow the composer's way — a leading `/` in the problem box
 * opens the "Start work" menu and a pick sets the form's workflow (the "Choose workflow" select is
 * gone). Call before typing the problem: the `/` must be the box's first token.
 */
export async function pickLaunchWorkflow(user: ReturnType<typeof userEvent.setup>, workflow: string): Promise<void> {
  const box = screen.getByTestId('launch-problem');
  await user.click(box);
  await user.type(box, '/');
  const sel = `[data-testid="composer-menu-item"][data-workflow="${workflow}"]`;
  await waitFor(() => expect(document.querySelector(sel)).not.toBeNull());
  await user.click(document.querySelector(sel) as HTMLElement);
  await waitFor(() => expect(screen.getByTestId('launch-workflow-pill').dataset.workflow).toBe(workflow));
}
