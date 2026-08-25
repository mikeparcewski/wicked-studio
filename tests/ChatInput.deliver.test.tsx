import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchRunBody } from '../src/api/types.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill, setRetryPrefill } from '../src/store/retryPrefill.js';

/**
 * studio#123 — the composer reaches for `deliver: 'pr'` (crew#293,
 * api-types index.d.ts:950), from the persisted `studio.composer` preference
 * rather than a hardcoded composer default:
 *   - a BUILD-kind run with a workflow AND a repo bound carries the key;
 *   - either guard unmet ⇒ the run still LAUNCHES, without the key — crew 400s
 *     on `deliver` without `workflow` (index.d.ts:955-956), and the deliver
 *     phase pushes to a remote it would not have;
 *   - the preference off ⇒ never sent;
 *   - and in every case the verdict is VISIBLE text above the composer before
 *     the operator sends, never a tooltip.
 */

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'feature', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  // The default-ON preference, as a fresh install loads it (no stored key).
  useComposerPrefsStore.setState({
    prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown',
  });
  localStorage.clear();
  clearRetryPrefill();
});

/** Bind workflow and/or repo through the launch options drawer — the controls
 *  the operator actually uses, not a prefill shortcut. */
async function bind(
  user: ReturnType<typeof userEvent.setup>,
  opts: { workflow?: string; repo?: string },
): Promise<void> {
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  if (opts.workflow !== undefined) {
    await waitFor(() => expect(screen.getByTestId('launch-workflow')).toBeInTheDocument());
    await user.selectOptions(screen.getByTestId('launch-workflow'), opts.workflow);
  }
  if (opts.repo !== undefined) {
    await user.click(screen.getByTestId(`launch-repo-${opts.repo}`));
  }
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

async function send(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByTestId('launch-problem'), text);
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
}

function sentBody(): LaunchRunBody {
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('ChatInput delivery (#123)', () => {
  it('a build run with workflow + repo bound sends deliver: pr, and says so first', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature', repo: 'studio-api' });

    // Visible before the send — the operator reads that a PR is coming.
    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverState).toBe('on');
    expect(notice.textContent).toMatch(/opens a PR/i);
    expect(notice.textContent).toMatch(/Merging stays yours/i);

    await send(user, 'add the delivery toggle');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.deliver).toBe('pr');
    expect(body.workflow).toBe('feature');
    expect(body.repoRef).toBe('studio-api');
  });

  it('GUARD — no workflow: launches WITHOUT deliver (crew would 400), and names the guard', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { repo: 'studio-api' });

    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverState).toBe('no-workflow');
    expect(notice.textContent).toMatch(/needs a workflow/i);

    // A non-code-shaped intent, so the §7.8 preflight is not what stops us here.
    await send(user, 'summarise the roster');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect('deliver' in body, 'no workflow = no deliver key at all').toBe(false);
    expect('workflow' in body).toBe(false);
  });

  it('GUARD — no repo: launches WITHOUT deliver (nothing to push to), and names the guard', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature' });

    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverState).toBe('no-repo');
    expect(notice.textContent).toMatch(/none is attached/i);

    // A workflow with no repo is code-shaped: §7.8 warn-and-blocks first, and
    // the override is the launch. Either way the body must carry no deliver.
    await send(user, 'add the delivery toggle');
    expect(client.api.launchRun).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('preflight-override'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect('deliver' in body, 'no repoRef = no deliver key at all').toBe(false);
    expect(body.workflow).toBe('feature');
  });

  it('the preference OFF sends no deliver key and renders no notice', async () => {
    useComposerPrefsStore.setState({ prefs: { deliverPr: false } });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature', repo: 'studio-api' });

    expect(screen.queryByTestId('deliver-notice')).toBeNull();

    await send(user, 'add the delivery toggle');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect('deliver' in sentBody(), 'preference off = no deliver key at all').toBe(false);
  });

  it('a retry prefill of an is_system workflow NOT on the denylist never delivers', async () => {
    // The denylist only "catches system workflows that predate the is_system
    // flag". A daemon shipping a system workflow under a NEW id is invisible to
    // it, and the retry prefill seeds `workflow` directly — bypassing the
    // selector that DOES read is_system. The authoritative flag must win.
    vi.mocked(client.api.listWorkflows).mockResolvedValue({
      workflows: [
        { id: 'feature', is_system: false, phases: [] },
        { id: 'estate-reindex', is_system: true, phases: [] },
      ],
    });
    setRetryPrefill({
      retryOf: 'r-old', problem: 'redo it', clis: ['claude'], workflowId: 'estate-reindex',
      repoRef: 'studio-api', entityMode: 'shared', humanConfirm: 'none', projectId: null,
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());

    // A system workflow has nothing to deliver — no notice, and no key.
    await waitFor(() => expect(screen.queryByTestId('deliver-notice')).toBeNull());
    await send(user, ' now');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.workflow).toBe('estate-reindex');
    expect('deliver' in body, 'is_system:true is not build work').toBe(false);
  });

  it('the chat surface (workflowOverride: chat) never delivers and stays silent', async () => {
    const user = userEvent.setup();
    render(
      <ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} workflowOverride="chat" />,
    );
    await bind(user, { repo: 'studio-api' });

    // A system workflow has nothing to deliver — no notice, no key.
    expect(screen.queryByTestId('deliver-notice')).toBeNull();

    await send(user, 'what changed in the api last week');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = sentBody();
    expect(body.workflow).toBe('chat');
    expect('deliver' in body, 'chat is not build work').toBe(false);
  });
});
