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
  vi.spyOn(client.api, 'injectMessage').mockResolvedValue({ status: 'ok' });
});

describe('ChatInput inject mode (§11.7 — operator message injection)', () => {
  it('shows inject textarea when runStatus is "executing"', () => {
    render(
      <ChatInput
        runId="run-1"
        runStatus="executing"
        onLaunched={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });

  it('shows inject textarea when runStatus is "distributing"', () => {
    render(
      <ChatInput
        runId="run-1"
        runStatus="distributing"
        onLaunched={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
  });

  it('shows inject textarea when runStatus is "planning"', () => {
    render(
      <ChatInput
        runId="run-1"
        runStatus="planning"
        onLaunched={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/send message to all agents/i)).toBeInTheDocument();
  });

  it('calls api.injectMessage with runId, text, and default target "all"', async () => {
    const user = userEvent.setup();
    render(
      <ChatInput
        runId="run-42"
        runStatus="executing"
        onLaunched={vi.fn()}
      />
    );
    await user.type(screen.getByPlaceholderText(/send message/i), 'stop and summarise');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(client.api.injectMessage).toHaveBeenCalledWith('run-42', 'stop and summarise', 'all');
  });

  it('uses the injectTarget prop when targeting a specific CLI', async () => {
    const user = userEvent.setup();
    render(
      <ChatInput
        runId="run-42"
        runStatus="executing"
        injectTarget="claude"
        onLaunched={vi.fn()}
      />
    );
    expect(screen.getByPlaceholderText(/send message to claude/i)).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText(/send message/i), 'focus on tests');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(client.api.injectMessage).toHaveBeenCalledWith('run-42', 'focus on tests', 'claude');
  });

  it('shows a target badge and calls onClearInjectTarget when × is clicked', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(
      <ChatInput
        runId="run-42"
        runStatus="executing"
        injectTarget="codex"
        onClearInjectTarget={onClear}
        onLaunched={vi.fn()}
      />
    );
    const badge = screen.getByText(/codex/);
    expect(badge).toBeInTheDocument();
    await user.click(screen.getByLabelText(/clear target/i));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('clears the text field after a successful inject', async () => {
    const user = userEvent.setup();
    render(
      <ChatInput
        runId="run-42"
        runStatus="executing"
        onLaunched={vi.fn()}
      />
    );
    const field = screen.getByPlaceholderText(/send message/i);
    await user.type(field, 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));
    expect(client.api.injectMessage).toHaveBeenCalled();
    await waitFor(() => expect(field).toHaveValue(''));
  });
});
