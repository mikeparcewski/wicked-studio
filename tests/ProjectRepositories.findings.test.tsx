import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ProjectMember } from '../src/api/types.js';
import { REPO_CLEAN, REPO_INTREE_NO_LIVE } from './fixtures/wave2.js';

/**
 * F-2R2-004 — the project dashboard's REPOSITORIES rows render the engine's finding and
 * "Re-run onboarding". The mount existed (`project-repo-findings`) but the row's registry
 * lookup stayed undefined until the attach picker's gesture warmed the repo cache, so the
 * checklist path "studio → project → repositories" showed nothing. A project WITH members
 * now warms the one session cache on mount; a project without them still fetches nothing.
 */

const listRepos = vi.fn();
const rerunOnboarding = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: (...a: unknown[]) => listRepos(...a),
    rerunOnboarding: (...a: unknown[]) => rerunOnboarding(...a),
    attachProjectMember: () => Promise.reject(new Error('not in this suite')),
    detachProjectMember: () => Promise.reject(new Error('not in this suite')),
  },
}));

const { ProjectRepositories } = await import('../src/components/ProjectRepositories.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const NOW = 1_757_300_000_000;

function member(ref: string): ProjectMember {
  return {
    id: `proj-1:crew.repo:${ref}`, project_id: 'proj-1', member_kind: 'crew.repo',
    member_ref: ref, meta: null, attached_at: NOW - 2000, attached_by: 'studio',
  };
}

beforeEach(() => {
  clearRepoCache();
  listRepos.mockReset();
  rerunOnboarding.mockReset();
  listRepos.mockResolvedValue({ repos: [REPO_INTREE_NO_LIVE, REPO_CLEAN] });
  rerunOnboarding.mockResolvedValue({ runId: 'run-reonboard' });
});
afterEach(cleanup);

describe('ProjectRepositories — the rows carry the engine\'s findings (F-2R2-004)', () => {
  it('a project with repo members warms the registry on mount and renders the finding + Re-run onboarding', async () => {
    render(<ProjectRepositories projectId="proj-1" members={[member('wicked-studio'), member('billing')]} onMembersChange={() => {}} />);
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    const rows = await screen.findAllByTestId('project-repo-row');
    expect(rows).toHaveLength(2);
    const findings = await screen.findByTestId('project-repo-findings');
    expect(findings).toHaveAttribute('data-count', '1');
    const row = within(findings).getByTestId('project-repo-findings-row');
    expect(row).toHaveAttribute('data-code', 'in_tree_code_graph_ignored');
    expect(row).toHaveAttribute('data-reonboard', 'true');
    // The clean repo's row shows no finding block.
    expect(screen.getAllByTestId('project-repo-findings')).toHaveLength(1);

    fireEvent.click(within(findings).getByTestId('project-repo-findings-reonboard'));
    await waitFor(() => expect(rerunOnboarding).toHaveBeenCalledWith('wicked-studio'));
    expect((await screen.findByTestId('project-repo-reonboard-note')).textContent).toContain('onboarding run run-reonboard started');
  });

  it('a project with NO repo members fetches nothing on mount (the picker gesture still owns that read)', async () => {
    render(<ProjectRepositories projectId="proj-1" members={[]} onMembersChange={() => {}} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(listRepos).not.toHaveBeenCalled();
    expect(screen.getByTestId('project-repos-empty')).toBeInTheDocument();
  });

  it('a failed registry read on mount stays silent — the picker gesture retries and reports it', async () => {
    listRepos.mockRejectedValueOnce(new Error('offline'));
    render(<ProjectRepositories projectId="proj-1" members={[member('wicked-studio')]} onMembersChange={() => {}} />);
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('project-repo-findings')).toBeNull();
    fireEvent.focus(screen.getByTestId('project-repo-search'));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));
    await screen.findByTestId('project-repo-findings');
  });
});
