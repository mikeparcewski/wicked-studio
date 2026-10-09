import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import { linkedIssueWords, linkedIssuesLine } from '../src/components/LinkedIssuesLine.js';
import * as client from '../src/api/client.js';
import type { LinkedIssuesPreviewBody, LinkedIssuesPreviewResponse } from '../src/api/types.js';
import { setRetryPrefill, takeRetryPrefill } from '../src/store/retryPrefill.js';

/**
 * studio#596 (crew#825): before Send, the launch form says which linked issues a workflow launch
 * will append, with a toggle per issue; a left-out ref rides `excludeLinkedIssues` — only to a daemon
 * that says it takes the key (`capabilities.linkedIssuesExclude`).
 */

const REF = 'mikeparcewski/wicked-studio#539';
function previewFor(body: LinkedIssuesPreviewBody): LinkedIssuesPreviewResponse {
  const out = (body.excludeLinkedIssues ?? []).includes(REF);
  return {
    issues: [
      // crew's own shape for a left-out ref: not read, so `resolved: false` (core/linked-issues.ts).
      out ? { ref: REF, resolved: false, excluded: true, error: 'left out by the launch (excludeLinkedIssues)' } : { ref: REF, resolved: true, title: 'Session thread: failed deliver', chars: 2140 },
      { ref: '#9999', resolved: false, error: 'issue not found' },
    ],
    appendedChars: out ? 0 : 2140,
  };
}

function health(linkedIssuesExclude: boolean | undefined): void {
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: 'test', capabilities: linkedIssuesExclude === undefined ? {} : { linkedIssuesExclude },
  } as never);
}

beforeEach(() => {
  vi.restoreAllMocks();
  takeRetryPrefill();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'previewLinkedIssues').mockImplementation(async (b) => previewFor(b));
  localStorage.clear();
  setRetryPrefill({
    retryOf: null, chatId: null, problem: `fix the session thread, see ${REF} for the repro and #9999`,
    clis: ['claude'], workflowId: 'chat', repoRef: null, entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null,
  });
});

/** Send; a workflow launch with no repo attached asks first (§7.8 preflight) — launch anyway. */
async function send(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByTestId('launch-submit'));
  const anyway = await screen.findByTestId('preflight-override').catch(() => null);
  if (anyway !== null) await user.click(anyway);
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
}

describe('studio#596 — the linked issues a launch appends', () => {
  it('the words: count + size, each ref with its title and size, unreadable and left-out said', () => {
    expect(linkedIssuesLine(previewFor({ problem: 'x' }))).toBe('1 linked issue will be appended (≈2,140 chars).');
    expect(linkedIssuesLine(previewFor({ problem: 'x', excludeLinkedIssues: [REF] }))).toBe('No linked issue will be appended.');
    expect(linkedIssuesLine({ issues: [], appendedChars: 0 })).toBeNull();
    expect(linkedIssueWords({ ref: REF, resolved: true, title: 'T', chars: 2140 })).toBe(`${REF} — T · 2,140 chars`);
    expect(linkedIssueWords({ ref: '#9', resolved: false, error: 'not found' })).toBe('#9 — could not be read: not found');
    expect(linkedIssueWords({ ref: REF, resolved: false, excluded: true, error: 'left out' })).toBe(`${REF} · left out`);
  });

  it('shows the issue before Send; leaving it out sends excludeLinkedIssues exactly as the preview spelled it', async () => {
    health(true);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    await waitFor(() => expect(screen.getByTestId('launch-linked-issues-line')).toHaveTextContent('1 linked issue will be appended (≈2,140 chars).'), { timeout: 3000 });
    const rows = screen.getAllByTestId('launch-linked-issue');
    expect(rows.map((r) => r.dataset.ref)).toEqual([REF, '#9999']);
    expect(rows[1]!).toHaveTextContent('could not be read');
    await user.click(screen.getByRole('checkbox', { name: `Append ${REF} to the launch` }));
    await waitFor(() => expect(screen.getByTestId('launch-linked-issues-line')).toHaveTextContent('No linked issue will be appended.'), { timeout: 3000 });
    expect(vi.mocked(client.api.previewLinkedIssues).mock.calls.at(-1)![0].excludeLinkedIssues).toEqual([REF]);
    // A left-out ref keeps its toggle (crew answers it `resolved: false`): it can be put back.
    expect(screen.getByRole('checkbox', { name: `Append ${REF} to the launch` })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: `Append ${REF} to the launch` }));
    await waitFor(() => expect(screen.getByTestId('launch-linked-issues-line')).toHaveTextContent('1 linked issue will be appended'), { timeout: 3000 });
    await user.click(screen.getByRole('checkbox', { name: `Append ${REF} to the launch` }));
    await waitFor(() => expect(screen.getByTestId('launch-linked-issues-line')).toHaveTextContent('No linked issue will be appended.'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await send(user);
    expect(vi.mocked(client.api.launchRun).mock.calls[0]![0].excludeLinkedIssues).toEqual([REF]);
  });

  it('a preview error is a line, never a blocker', async () => {
    health(true);
    vi.mocked(client.api.previewLinkedIssues).mockResolvedValue({ issues: [], appendedChars: 0, error: 'gh is not signed in' });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    await waitFor(() => expect(screen.getByTestId('launch-linked-issues-error')).toHaveTextContent('gh is not signed in'), { timeout: 3000 });
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  });

  it('a daemon without the capability is never asked, and the key is never sent', async () => {
    health(undefined);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="feature" />);
    await waitFor(() => expect(client.api.getHealth).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await send(user);
    expect(client.api.previewLinkedIssues).not.toHaveBeenCalled();
    expect('excludeLinkedIssues' in vi.mocked(client.api.launchRun).mock.calls[0]![0]).toBe(false);
    expect(screen.queryByTestId('launch-linked-issues')).toBeNull();
  });
});
