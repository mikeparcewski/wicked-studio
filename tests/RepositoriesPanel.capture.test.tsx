import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoriesPanel } from '../src/components/RepositoriesPanel.js';
import * as client from '../src/api/client.js';
import type { Project, RepoEntry, SystemSettings } from '../src/api/types.js';

/**
 * studio#1083 (crew#552): Add a repository says that a Capture learnings job follows the onboarding, and lets the person
 * register and onboard only. Clearing the box sends crew's one-off opt-out (`POST /repos {…, autoCapture: false}`,
 * crew `api/routes.ts` RegisterRepoSchema `autoCapture: z.boolean().optional()`); a ticked box sends nothing, so whether
 * a capture follows stays crew's (the `onboardingAutoCapture` setting, or the project's own `autoCapture` override).
 */

function proj(id: string, autoCapture: boolean | null): Project {
  return { id, name: id, description: null, status: 'active', scope: `project:${id}`, created_at: 1, updated_at: 1, autoCapture };
}

const REPO = { id: 'repo-1', name: 'my-repo', root_path: '/tmp/my-repo', default_branch: 'main', registered_at: 1 } as unknown as RepoEntry;

/** `GET /settings` as crew answers it: `{settings}` with the defaults applied (crew core/types.ts DEFAULT settings). */
function settings(onboardingAutoCapture: boolean | undefined): { settings: SystemSettings } {
  return { settings: (onboardingAutoCapture === undefined ? {} : { onboardingAutoCapture }) as SystemSettings };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listRuns').mockResolvedValue({ runs: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [proj('quiet', false), proj('loud', null)] });
  vi.spyOn(client.api, 'getSettings').mockResolvedValue(settings(true));
  vi.spyOn(client.api, 'registerRepo').mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttached: true });
  vi.spyOn(client.api, 'cloneAndRegisterRepo').mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttached: true });
});

async function fill(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByTestId('repo-name'), 'my-repo');
  await user.type(screen.getByTestId('repo-path'), '/tmp/my-repo');
}
async function submit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Register and onboard' }));
  await waitFor(() => expect(client.api.registerRepo).toHaveBeenCalledTimes(1));
}

describe('Add a repository: the chained Capture learnings job (studio#1083)', () => {
  it('says a Capture learnings job follows, ticked by default; a ticked box sends no opt-out', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    const box = await screen.findByTestId('repo-capture-after');
    expect(box).toBeChecked();
    await waitFor(() => expect(screen.getByTestId('repo-capture-note')).toHaveTextContent('A Capture learnings job follows on your helpers'));
    await fill(user);
    await submit(user);
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo', undefined);
  });

  it('cleared, it registers and onboards only: autoCapture false rides the register (local and cloned)', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    await user.click(await screen.findByTestId('repo-capture-after'));
    expect(screen.getByTestId('repo-capture-note')).toHaveTextContent('no Capture learnings job runs on it');
    await fill(user);
    await submit(user);
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo', undefined, { autoCapture: false });
  });

  it('a cloned repository carries the opt-out too', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    await user.click(await screen.findByTestId('repo-capture-after'));
    await user.click(screen.getByRole('radio', { name: 'From a URL' }));
    await user.type(screen.getByTestId('repo-git-url'), 'https://github.com/org/my-repo');
    await user.click(screen.getByRole('button', { name: 'Clone and onboard' }));
    await waitFor(() => expect(client.api.cloneAndRegisterRepo).toHaveBeenCalledTimes(1));
    expect(client.api.cloneAndRegisterRepo).toHaveBeenCalledWith('my-repo', 'https://github.com/org/my-repo', undefined, undefined, { autoCapture: false });
  });

  it('with automatic capture off in Settings it says none follows, offers no box and sends nothing extra', async () => {
    vi.mocked(client.api.getSettings).mockResolvedValue(settings(false));
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    expect(await screen.findByTestId('repo-capture-off')).toHaveTextContent('automatic capture is off in Settings');
    expect(screen.queryByTestId('repo-capture-after')).toBeNull();
    await fill(user);
    await submit(user);
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo', undefined);
  });

  it('a project whose own override is off says so for the project; one with none follows the setting', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select') as HTMLSelectElement;
    await waitFor(() => expect(select.options.length).toBeGreaterThan(2));
    await user.selectOptions(select, 'quiet');
    expect(await screen.findByTestId('repo-capture-off')).toHaveTextContent('automatic capture is off for this project');
    await user.selectOptions(select, 'loud');
    expect(await screen.findByTestId('repo-capture-after')).toBeChecked();
  });

  it('a settings read that fails still offers the opt-out, worded as conditional', async () => {
    vi.mocked(client.api.getSettings).mockRejectedValue(new Error('offline'));
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    await waitFor(() => expect(client.api.getSettings).toHaveBeenCalled());
    expect(await screen.findByTestId('repo-capture-note')).toHaveTextContent('When automatic capture is on');
  });
});

describe('the register wire carries only the opt-out (studio#1083)', () => {
  let bodies: unknown[] = [];
  beforeEach(() => {
    vi.restoreAllMocks();
    bodies = [];
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : undefined);
      return Promise.resolve(new Response(JSON.stringify({ repo: REPO, onboardRunId: 'r-1' }), { status: 201, headers: { 'content-type': 'application/json' } }));
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('POST /repos bodies, as crew\'s strict schema reads them', async () => {
    await client.api.registerRepo('a', '/w/a', undefined, { autoCapture: false });
    await client.api.registerRepo('b', '/w/b', 'p1');
    await client.api.cloneAndRegisterRepo('c', 'https://x/c', '/w/c', undefined, { autoCapture: false });
    await client.api.registerRepo('d', '/w/d', undefined, { autoCapture: true });
    expect(bodies).toEqual([
      { name: 'a', rootPath: '/w/a', autoCapture: false },
      { name: 'b', rootPath: '/w/b', projectId: 'p1' },
      { name: 'c', gitUrl: 'https://x/c', rootPath: '/w/c', autoCapture: false },
      { name: 'd', rootPath: '/w/d' },
    ]);
  });
});
