// Reel ch58/ch59 (studio 0.7.8): no absolute or `~/` path, and no "floors"/"creator" engine words,
// renders in the DEFAULT layer of the repo and session surfaces. Paths and engine reasons may live
// only inside Technical details (a <details>), sanitized. Fails if a surface puts one back.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

const HOME_REPO = '/Users/reel-operator/wicked-rig/repos/billing';
const HOME_TREE = '/Users/reel-operator/wicked-rig/repos/billing/wicked-worktrees/r-str';
const REPOS: RepoEntry[] = [{ id: 'billing', name: 'billing', root_path: HOME_REPO, default_branch: 'main', registered_at: 1_760_000_000 }];

vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return {
    ...real,
    api: {
      ...real.api,
      listRepos: () => Promise.resolve({ repos: REPOS }),
      listRuns: () => Promise.resolve({ runs: [] }),
      listProjects: () => Promise.resolve({ projects: [] }),
      getRepoGraph: () => Promise.reject(new Error('no graph')),
      getWatch: () => Promise.resolve({ items: [], coverage: [
        { entry_id: 'scope_drift', state: 'not_checked', reason: 'no team member row in the registry (4 creator floors wait for it)' },
        { entry_id: 'tests', state: 'checked' },
      ] }),
    },
  };
});

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { WatchRunLines } = await import('../src/components/WatchLines.js');
const { StrandedCard } = await import('../src/components/session/StrandedCard.js');

/** The text a person sees by default: everything outside closed Technical details. */
function defaultLayer(el: HTMLElement): string {
  const c = el.cloneNode(true) as HTMLElement;
  c.querySelectorAll('details').forEach((d) => d.remove());
  return c.textContent ?? '';
}
const PATHY = /\/Users\/|\/home\/|~\/|\$TMPDIR/;

afterEach(() => cleanup());

describe('no home path on the primary layer (repo + session surfaces)', () => {
  it('the repo card names the repo; its checkout path is behind Technical details, as ~', async () => {
    const { container } = render(<RepositoriesPanel navigate={() => {}} />);
    await screen.findByText('billing');
    expect(defaultLayer(container)).not.toMatch(PATHY);
    const where = await screen.findByTestId('repo-card-path');
    expect(where.tagName).toBe('DETAILS');
    expect(where.textContent).toContain('~/wicked-rig/repos/billing');
    expect(where.textContent).not.toContain('/Users/');
  });

  it('opening "Where it is" on a repo card reads it in place — it does not open the repo', async () => {
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} />);
    const where = await screen.findByTestId('repo-card-path');
    fireEvent.click(where.querySelector('summary')!);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a stranded run says where its work is in words; the worktree path is behind details', () => {
    const view = makeView({ id: 'r-str', status: 'completed', workdir: HOME_TREE, delivery: 'stranded' } as never);
    const { container } = render(<StrandedCard view={view} />);
    expect(defaultLayer(container)).not.toMatch(PATHY);
    expect(screen.getByTestId('session-stranded-worktree')).toHaveTextContent('The work is saved on this machine.');
  });

  it('the session card says how many checks did not run, in plain words; the engine reason is detail', async () => {
    const { container } = render(<WatchRunLines runId="r1" jumped={false} isTerminal={false} endedMs={null} />);
    await waitFor(() => expect(screen.getByTestId('watch-coverage')).toHaveTextContent('1 check didn’t run on this run.'));
    expect(defaultLayer(container)).not.toMatch(/floor|creator|registry/i);
    expect(screen.getByTestId('watch-coverage-reasons').textContent).toContain('4 creator floors wait for it');
  });
});
