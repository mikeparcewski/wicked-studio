import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

/** Type `/` at the start of the problem box and read the menu's "Start work" rows. */
async function openMenuAndGetWorkflows(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.type(screen.getByTestId('launch-problem'), '/');
  let values: string[] = [];
  // waitFor handles the async listWorkflows resolution before asserting rows.
  await waitFor(() => {
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="composer-menu-item"][data-group="start-work"]');
    values = Array.from(rows).map((r) => r.dataset.workflow ?? '');
    // At least one user workflow must be present — proves the API response landed.
    expect(values.length).toBeGreaterThan(0);
  });
  return values;
}

describe('ChatInput workflow menu (S19b: `/` in the problem box; system-workflow filter)', () => {
  it('hides workflows with is_system: true from the menu', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [
        { id: 'chat',       is_system: true,  phases: [] },
        { id: 'onboarding', is_system: true,  phases: [] },
        { id: 'feature',    is_system: false, phases: [] },
        { id: 'custom-wf',                    phases: [] },
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const values = await openMenuAndGetWorkflows(user);

    expect(values).not.toContain('chat');
    expect(values).not.toContain('onboarding');
    expect(values).toContain('feature');
    expect(values).toContain('custom-wf');
  });

  it('trusts the daemon\'s is_system flag: studio keeps no system-id list of its own', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [
        { id: 'survey-repo', phases: [], is_system: true },
        { id: 'memories',    phases: [], is_system: true },
        { id: 'feature',     phases: [] },
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const values = await openMenuAndGetWorkflows(user);

    expect(values).not.toContain('survey-repo');
    expect(values).not.toContain('memories');
    expect(values).toEqual(['feature']);
  });

  it('a pick names the form\'s workflow, drops the token, and the pill reads /workflow-<key> (× clears it)', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [{ id: 'bug', phases: [{ id: 'fix' }] }, { id: 'feature', phases: [] }] as never,
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    await pickLaunchWorkflow(user, 'bug');
    const box = screen.getByTestId('launch-problem') as HTMLTextAreaElement;
    expect(box.value).toBe('');
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    expect(screen.getByTestId('launch-workflow-pill').textContent).toContain('/workflow-bug');
    expect(screen.queryByText(/Workflow: bug/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Clear /workflow-bug' }));
    expect(screen.queryByTestId('launch-workflow-pill')).toBeNull();
  });

  it('a mid-text `/` is a sentence (no menu); the keyboard picks; Escape closes without picking', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [{ id: 'bug', phases: [] }, { id: 'feature', phases: [] }] as never,
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const box = screen.getByTestId('launch-problem') as HTMLTextAreaElement;

    await user.type(box, 'fix /');
    expect(screen.queryByTestId('composer-menu')).toBeNull();

    await user.clear(box);
    await user.type(box, '/workflow-f');
    await waitFor(() => expect(screen.getByTestId('composer-menu')).toBeInTheDocument());
    expect(box.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    expect(screen.queryByTestId('launch-workflow-pill')).toBeNull();

    await user.clear(box);
    await user.type(box, '/workflow-f');
    await waitFor(() => expect(screen.getByTestId('composer-menu')).toBeInTheDocument());
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId('launch-workflow-pill').dataset.workflow).toBe('feature'));
    expect(box.value).toBe('');
  });

  it('S19b: the options drawer has no "Choose workflow", and no "Detected" banner ever shows', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({ workflows: [{ id: 'bug', phases: [] }] as never });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.type(screen.getByTestId('launch-problem'), 'fix the crash in checkout');
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(screen.queryByTestId('launch-workflow')).toBeNull();
    expect(screen.queryByText(/Choose workflow/)).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/Detected/);
  });
});

describe('codex r1 on S19b', () => {
  it('after Escape, a new leading `/` in a non-empty box opens the menu again', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({ workflows: [{ id: 'bug', phases: [] }] as never });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const box = screen.getByTestId('launch-problem') as HTMLTextAreaElement;
    await user.type(box, '/');
    await waitFor(() => expect(screen.getByTestId('composer-menu')).toBeInTheDocument());
    expect(screen.getByRole('listbox').getAttribute('aria-label')).toBe('Name the workflow this runs');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(screen.queryByTestId('composer-menu')).toBeNull();
    // The box is never emptied: the token goes (a space ends it), then a NEW leading `/` is typed.
    await user.type(box, ' fix it');
    await user.type(box, '{Home}{Delete}/');
    expect(box.value).toBe('/ fix it');
    // The caret sits after the `/` at the start: a fresh leading token, so the menu opens again.
    await waitFor(() => expect(screen.getByTestId('composer-menu')).toBeInTheDocument());
  });
});
