import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';

/**
 * studio#446: a launch promoted from a chat ("Continue in Build") carries the chat's id on
 * `POST /runs` (`LaunchRunBody.chatId`, crew#619) — only when the daemon says it accepts the key
 * (`GET /health.capabilities.chatIdOnLaunch`) — so the run lands in that chat's session (S6a).
 */

function health(chatIdOnLaunch: boolean | undefined): void {
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: 'test', capabilities: chatIdOnLaunch === undefined ? {} : { chatIdOnLaunch },
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  localStorage.clear();
});

function promoted(): void {
  setRetryPrefill({
    retryOf: null, chatId: 'chat-pay', problem: 'write up the offsite agenda\n\n---\noperator: write it up',
    clis: ['claude'], workflowId: null, repoRef: null, entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
  });
}

async function launch(): Promise<LaunchBodyWithDeliver> {
  const user = userEvent.setup();
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('studio#446: chatId on a launch promoted from a chat', () => {
  it('rides the body when the daemon accepts it', async () => {
    health(true);
    promoted();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.getHealth).toHaveBeenCalled());
    const body = await launch();
    expect(body.chatId).toBe('chat-pay');
  });

  it('is never sent to a daemon that does not say it accepts it (an older strict schema 400s)', async () => {
    health(undefined);
    promoted();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.getHealth).toHaveBeenCalled());
    const body = await launch();
    expect('chatId' in body).toBe(false);
  });
});

describe('codex on studio#446', () => {
  it('a Send before the first health read lands asks the daemon then, rather than dropping the chat', async () => {
    vi.spyOn(client.api, 'getHealth')
      .mockReturnValueOnce(new Promise(() => undefined) as never)
      .mockResolvedValue({ status: 'ok', version: 'test', capabilities: { chatIdOnLaunch: true } } as never);
    promoted();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const body = await launch();
    expect(body.chatId).toBe('chat-pay');
  });
});
