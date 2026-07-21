import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatPanel } from '../src/components/ChatPanel.js';
import * as client from '../src/api/client.js';
import { makeView, makeUnit } from './factories.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
});

describe('ChatPanel inject targeting (crew#74 — click avatar → target CLI)', () => {
  it('clicking an assigned-CLI avatar switches inject placeholder to that agent', async () => {
    const user = userEvent.setup();
    const view = makeView(
      { status: 'executing' },
      [makeUnit({ ord: 0, status: 'distributed', assigned_cli: 'claude' })],
    );
    render(
      <ChatPanel
        view={view}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send message to claude only/i }));
    expect(screen.getByPlaceholderText(/send message to claude/i)).toBeInTheDocument();
  });

  it('clearing the inject target restores broadcast-to-all placeholder', async () => {
    const user = userEvent.setup();
    const view = makeView(
      { status: 'executing' },
      [makeUnit({ ord: 0, status: 'distributed', assigned_cli: 'codex' })],
    );
    render(
      <ChatPanel
        view={view}
        onLaunched={vi.fn()}
        onNavigateBack={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: /send message to codex only/i }));
    expect(screen.getByPlaceholderText(/send message to codex/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/clear target/i));
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
  });
});
