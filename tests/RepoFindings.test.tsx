import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import {
  REPO_CLEAN, REPO_INTREE_LIVE, REPO_INTREE_NO_LIVE, REPO_PREDATES_FINDINGS, REPO_ROOT_UNRESOLVABLE,
} from './fixtures/wave2.js';
import { makeView } from './factories.js';

/**
 * studio#251 — `RepoEntry.findings[]` (wicked-core#406 via crew#517, api-types 0.32.0)
 * rendered on the repo card (Repositories fleet), the repo detail header and the
 * project page's repo rows. Pinned on the four recorded records: clean (silent),
 * in-tree graph beside a LIVE graph (a warning chip, no action), in-tree graph with
 * NO live graph (the error chip + "Re-run onboarding" wired to the surface's EXISTING
 * onboard trigger), and the unresolvable root (an error chip, no action) — plus a
 * record that predates the field (silent, never a fabricated "no findings").
 */

const REPOS: RepoEntry[] = [REPO_CLEAN, REPO_PREDATES_FINDINGS, REPO_INTREE_LIVE, REPO_INTREE_NO_LIVE, REPO_ROOT_UNRESOLVABLE];

const listRepos = vi.fn(() => Promise.resolve({ repos: REPOS }));
const listRuns = vi.fn(() => Promise.resolve({ runs: [makeView({ id: 'r-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed' })] }));
const rerunOnboarding = vi.fn<(repoId: string) => Promise<{ runId: string }>>(() => Promise.resolve({ runId: 'run-reonboard' }));
const getRepoGraph = vi.fn(() => Promise.resolve({ graph: null }));
const getRepoGitHistory = vi.fn(() => Promise.resolve({ commits: [] }));
const getRepoContributors = vi.fn(() => Promise.resolve({ contributors: [] }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    rerunOnboarding: (id: string) => rerunOnboarding(id),
    getRepoGraph: () => getRepoGraph(),
    getRepoGitHistory: () => getRepoGitHistory(),
    getRepoContributors: () => getRepoContributors(),
    listProjects: () => Promise.resolve({ projects: [] }),
    attachProjectMember: () => Promise.reject(new Error('not in this suite')),
    detachProjectMember: () => Promise.reject(new Error('not in this suite')),
  },
}));

const { RepoFindings, findingNeedsReonboard, findingSeverity, findingLabel } = await import('../src/components/RepoFindings.js');
const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { ProjectRepositories } = await import('../src/components/ProjectRepositories.js');
const { clearRepoCache, fetchReposCached } = await import('../src/store/repoCache.js');

beforeEach(() => {
  listRepos.mockClear();
  rerunOnboarding.mockClear();
  clearRepoCache();
});
afterEach(() => cleanup());

describe('the finding rule (module functions)', () => {
  it('classifies the three recorded codes: live in-tree = warning, no-live in-tree = error + re-onboard, unresolvable = error', () => {
    const live = REPO_INTREE_LIVE.findings![0]!;
    const noLive = REPO_INTREE_NO_LIVE.findings![0]!;
    const root = REPO_ROOT_UNRESOLVABLE.findings![0]!;
    expect(findingNeedsReonboard(live)).toBe(false);
    expect(findingNeedsReonboard(noLive)).toBe(true);
    expect(findingNeedsReonboard(root)).toBe(false);
    expect(findingSeverity(live)).toBe('warning');
    expect(findingSeverity(noLive)).toBe('error');
    expect(findingSeverity(root)).toBe('error');
    expect(findingLabel(live)).toBe('in-tree graph ignored');
    expect(findingLabel(noLive)).toBe('in-tree graph ignored · no live graph');
    expect(findingLabel(root)).toBe('no graph root');
    // Forward-additive: an unknown code renders as a warning under its own name.
    const unknown = { code: 'some_new_code', message: 'x', path: null };
    expect(findingSeverity(unknown)).toBe('warning');
    expect(findingLabel(unknown)).toBe('some new code');
  });

  it('renders NOTHING for an absent or empty findings array', () => {
    const { container } = render(
      <>
        <RepoFindings findings={undefined} />
        <RepoFindings findings={[]} />
      </>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('the host\'s shared lock (`disabled`) disables the action WITHOUT claiming this repo is starting', () => {
    render(<RepoFindings findings={REPO_INTREE_NO_LIVE.findings} onRerunOnboarding={() => undefined} disabled />);
    const button = screen.getByTestId('repo-findings-reonboard');
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Re-run onboarding');
  });

  it('states the remedy without a button when the host has no onboarding trigger', () => {
    render(<RepoFindings findings={REPO_INTREE_NO_LIVE.findings} />);
    const row = screen.getByTestId('repo-findings-row');
    expect(row).toHaveAttribute('data-reonboard', 'true');
    expect(row.textContent).toContain('re-run onboarding');
    expect(screen.queryByTestId('repo-findings-reonboard')).toBeNull();
  });
});

describe('the repo card (RepositoriesPanel)', () => {
  async function fleet(): Promise<HTMLElement[]> {
    render(<RepositoriesPanel navigate={() => undefined} />);
    await screen.findByTestId('repos-list');
    return screen.getAllByTestId('repo-card');
  }
  const card = (cards: HTMLElement[], id: string): HTMLElement =>
    cards.find((c) => c.getAttribute('data-repo-id') === id)!;

  it('clean and predating records carry no findings block; the three finding records carry one each', async () => {
    const cards = await fleet();
    expect(within(card(cards, 'billing')).queryByTestId('repo-card-findings')).toBeNull();
    expect(within(card(cards, 'legacy')).queryByTestId('repo-card-findings')).toBeNull();
    for (const id of ['studio-api', 'wicked-studio', 'orphan']) {
      expect(within(card(cards, id)).getByTestId('repo-card-findings')).toHaveAttribute('data-count', '1');
    }
  });

  it('each finding row wears its code + severity and the engine message; only the no-live-graph case offers Re-run onboarding', async () => {
    const cards = await fleet();
    const live = within(card(cards, 'studio-api')).getByTestId('repo-card-findings-row');
    expect(live).toHaveAttribute('data-code', 'in_tree_code_graph_ignored');
    expect(live).toHaveAttribute('data-severity', 'warning');
    expect(live.textContent).toContain('the live graph is /w2/state/repo-graphs/studio-api-9c1e/estate.db');
    expect(within(live).queryByTestId('repo-card-findings-reonboard')).toBeNull();

    const noLive = within(card(cards, 'wicked-studio')).getByTestId('repo-card-findings-row');
    expect(noLive).toHaveAttribute('data-severity', 'error');
    expect(within(noLive).getByTestId('repo-card-findings-reonboard')).toHaveTextContent('Re-run onboarding');

    const root = within(card(cards, 'orphan')).getByTestId('repo-card-findings-row');
    expect(root).toHaveAttribute('data-code', 'code_graph_root_unresolvable');
    expect(root).toHaveAttribute('data-severity', 'error');
    expect(root.textContent).toContain('no repo-graph root resolves for this daemon');
    expect(within(root).queryByTestId('repo-card-findings-reonboard')).toBeNull();
  });

  it('Re-run onboarding posts the EXISTING onboard wire for that repo and does not navigate the card', async () => {
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} onSelectRun={() => undefined} />);
    await screen.findByTestId('repos-list');
    const cards = screen.getAllByTestId('repo-card');
    fireEvent.click(within(card(cards, 'wicked-studio')).getByTestId('repo-card-findings-reonboard'));
    await waitFor(() => expect(rerunOnboarding).toHaveBeenCalledWith('wicked-studio'));
    expect(rerunOnboarding).toHaveBeenCalledTimes(1);
    // The card is a role=link; the finding's action must not also open the detail.
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('the repo detail header (RepoDetailPage)', () => {
  it('renders the finding under the root path and wires Re-run onboarding to the page trigger', async () => {
    const onSelectRun = vi.fn();
    render(<RepoDetailPage repoId="wicked-studio" onSelectRun={onSelectRun} navigate={() => undefined} onOpenGraph={() => undefined} />);
    const block = await screen.findByTestId('repo-findings');
    expect(block).toHaveAttribute('data-count', '1');
    const row = within(block).getByTestId('repo-findings-row');
    expect(row).toHaveAttribute('data-reonboard', 'true');
    expect(row.textContent).toContain('re-run onboarding (POST /repos/wicked-studio/onboard)');
    fireEvent.click(within(block).getByTestId('repo-findings-reonboard'));
    await waitFor(() => expect(rerunOnboarding).toHaveBeenCalledWith('wicked-studio'));
    await waitFor(() => expect(onSelectRun).toHaveBeenCalledWith('run-reonboard'));
  });

  it('a clean record shows no findings block — and no empty spacer under the root path', async () => {
    const { container } = render(<RepoDetailPage repoId="billing" onSelectRun={() => undefined} navigate={() => undefined} onOpenGraph={() => undefined} />);
    await screen.findByText('billing');
    expect(screen.queryByTestId('repo-findings')).toBeNull();
    expect(container.querySelector('.mt-2:empty')).toBeNull();
  });
});

describe('the project page repo rows (ProjectRepositories)', () => {
  const MEMBERS = [
    { id: 'm-1', project_id: 'p-1', member_kind: 'crew.repo', member_ref: 'wicked-studio', attached_by: 'studio', attached_at: 1_757_500_000_000 },
    { id: 'm-2', project_id: 'p-1', member_kind: 'crew.repo', member_ref: 'billing', attached_by: 'studio', attached_at: 1_757_500_000_000 },
  ] as never[];

  it('renders findings once the registry cache is warm, states the started run inline, and stays silent for a clean member', async () => {
    await fetchReposCached(); // the palette / picker gesture warmed the ONE session cache
    render(<ProjectRepositories projectId="p-1" members={MEMBERS} onMembersChange={() => undefined} />);
    const rows = screen.getAllByTestId('project-repo-row');
    expect(rows).toHaveLength(2);
    const blocks = screen.getAllByTestId('project-repo-findings');
    expect(blocks, 'billing is clean — only wicked-studio carries a block').toHaveLength(1);
    // The clean member gets no padded wrapper either — silent means silent.
    const billingRow = rows.find((r) => r.getAttribute('data-repo') === 'billing')!;
    expect(billingRow.parentElement!.children).toHaveLength(1);
    fireEvent.click(within(blocks[0]!).getByTestId('project-repo-findings-reonboard'));
    await waitFor(() => expect(rerunOnboarding).toHaveBeenCalledWith('wicked-studio'));
    const note = await screen.findByTestId('project-repo-reonboard-note');
    expect(note).toHaveAttribute('data-failed', 'false');
    expect(note.textContent).toContain('onboarding run run-reonboard started');
  });

  it('the re-run holds the section\'s ONE mutation lock: Detach is disabled while it is in flight and released after', async () => {
    let release: (v: { runId: string }) => void = () => undefined;
    rerunOnboarding.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    await fetchReposCached();
    render(<ProjectRepositories projectId="p-1" members={MEMBERS} onMembersChange={() => undefined} />);
    fireEvent.click(screen.getByTestId('project-repo-findings-reonboard'));
    await waitFor(() => expect(screen.getByTestId('project-repo-findings-reonboard')).toBeDisabled());
    for (const b of screen.getAllByTestId('project-repo-detach')) expect(b).toBeDisabled();
    release({ runId: 'run-late' });
    await screen.findByTestId('project-repo-reonboard-note');
    expect(screen.getByTestId('project-repo-findings-reonboard')).not.toBeDisabled();
    for (const b of screen.getAllByTestId('project-repo-detach')) expect(b).not.toBeDisabled();
  });

  it('a refused re-run is stated as a failure, not swallowed', async () => {
    rerunOnboarding.mockRejectedValueOnce(new Error('the daemon refused this — repo is already onboarding'));
    await fetchReposCached();
    render(<ProjectRepositories projectId="p-1" members={MEMBERS} onMembersChange={() => undefined} />);
    fireEvent.click(screen.getByTestId('project-repo-findings-reonboard'));
    const note = await screen.findByTestId('project-repo-reonboard-note');
    expect(note).toHaveAttribute('data-failed', 'true');
    expect(note.textContent).toContain('re-run refused: the daemon refused this — repo is already onboarding');
  });
});
