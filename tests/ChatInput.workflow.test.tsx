import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

async function openPopoverAndGetValues(user: ReturnType<typeof userEvent.setup>): Promise<string[]> {
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  let values: string[] = [];
  // waitFor handles the async listWorkflows resolution before asserting options.
  await waitFor(() => {
    const select = screen.getByTestId('launch-workflow');
    values = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    // At least one user workflow must be present — proves the API response landed.
    expect(values.length).toBeGreaterThan(1);
  });
  return values;
}

describe('ChatInput workflow selector (system-workflow filter)', () => {
  it('hides workflows with is_system: true from the ContextPopover dropdown', async () => {
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

    const values = await openPopoverAndGetValues(user);

    expect(values).not.toContain('chat');
    expect(values).not.toContain('onboarding');
    expect(values).toContain('feature');
    expect(values).toContain('custom-wf');
  });

  it('hides legacy system workflows by ID even when is_system flag is absent', async () => {
    const user = userEvent.setup();
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [
        // No is_system flag — caught by the SYSTEM_WORKFLOW_IDS denylist.
        { id: 'survey-repo',        phases: [] },
        { id: 'repo-graph',         phases: [] },
        { id: 'domain-graph-slice', phases: [] },
        { id: 'memories',           phases: [] },
        { id: 'feature',            phases: [] },
      ],
    });

    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const values = await openPopoverAndGetValues(user);

    expect(values).not.toContain('survey-repo');
    expect(values).not.toContain('repo-graph');
    expect(values).not.toContain('domain-graph-slice');
    expect(values).not.toContain('memories');
    expect(values).toContain('feature');
  });
});
