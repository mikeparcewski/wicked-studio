import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { DocSummary } from '../src/api/interactive.js';
import type { Project } from '../src/api/types.js';
import type { RailGroup } from '../src/board/deskModel.js';
import { makeView } from './factories.js';

/**
 * S18b — the classic skins' pieces of value, on the Desk's pages:
 *  - port 1c: the Sessions search (`searchGroups`, a pure fold beside `filterGroups`);
 *  - port 1d: the Made tab's fan-out Cancel and its `?project=` scope (`madeRows(..., kind, project)`);
 *  - port 1e: the project Documents root on `/projects/:id` (lifted from the retired dashboard).
 */

const updateProject = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, {
    get: (_t, k) => (k === 'updateProject' ? updateProject : () => Promise.resolve({})),
  }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/hooks/useBoardModel.js', async (orig) => {
  const real = await orig<typeof import('../src/hooks/useBoardModel.js')>();
  return { ...real, useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }) };
});

const { madeRows, searchGroups } = await import('../src/board/everythingModel.js');
const { EverythingPage } = await import('../src/components/everything/EverythingPage.js');
const { ProjectDocumentsRoot } = await import('../src/components/ProjectDocumentsRoot.js');
const { useDocsCache } = await import('../src/store/docsCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');

function session(id: string, title: string, runIds: string[] = [id]): RailGroup['sessions'][number] {
  return { id: `run:${id}`, runId: runIds[runIds.length - 1]!, runIds, title, state: 'done', badge: 0, line: 'done', path: `/s/run:${id}` };
}
const GROUPS: RailGroup[] = [
  { projectId: 'pay', name: 'Payments', sessions: [session('a', 'Fix the double charge'), session('b', 'Add a refund button')] },
  { projectId: 'docs', name: 'Docs', sessions: [session('c', 'Write the charge guide')] },
  { projectId: null, name: 'Not in a project', sessions: [session('d', 'Tidy the readme')] },
];

describe('searchGroups (port 1c)', () => {
  it('a blank query keeps every group', () => {
    expect(searchGroups(GROUPS, '   ').map((g) => g.sessions.length)).toEqual([2, 1, 1]);
  });

  it('matches the title across groups, case-insensitively, and drops emptied groups', () => {
    const out = searchGroups(GROUPS, 'CHARGE');
    expect(out.map((g) => g.projectId)).toEqual(['pay', 'docs']);
    expect(out.flatMap((g) => g.sessions.map((s) => s.title))).toEqual(['Fix the double charge', 'Write the charge guide']);
  });

  it('every word must match; the problem of any run of the session counts', () => {
    expect(searchGroups(GROUPS, 'charge guide').flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['run:c']);
    const problems: Record<string, string> = { d: 'Rewrite the onboarding section of the README' };
    expect(searchGroups(GROUPS, 'onboarding', (r) => problems[r]).flatMap((g) => g.sessions.map((s) => s.id))).toEqual(['run:d']);
    expect(searchGroups(GROUPS, 'onboarding')).toEqual([]);
  });
});

function doc(name: string, updated: string): DocSummary {
  return { name, kind: 'document', style: null, updated_at: updated } as unknown as DocSummary;
}

describe('madeRows with a project (port 1d)', () => {
  const BY = { pay: [doc('pay-spec', '2026-10-01T00:00:00Z')], docs: [doc('guide', '2026-10-02T00:00:00Z')] };
  it('no project lists every project; a project lists only its own', () => {
    expect(madeRows(BY, [], {}).map((r) => r.title)).toEqual(['guide', 'pay-spec']);
    expect(madeRows(BY, [], {}, 'all', 'pay').map((r) => r.title)).toEqual(['pay-spec']);
    expect(madeRows(BY, [], {}, 'videos', 'pay')).toEqual([]);
  });
});

describe('the Sessions search and the Made tab on /everything', () => {
  beforeEach(() => {
    useDocsCache.setState({ byProject: {}, unavailable: {}, index: 'absent', census: 'opened', fanoutProgress: null, fanoutDone: false });
    useProjectsStore.setState({ projects: [{ id: 'pay', name: 'Payments', status: 'active' } as unknown as Project] });
  });
  afterEach(cleanup);

  it('everything-search is in the Sessions bar', () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => {}} search="?tab=sessions" />);
    expect(screen.getByTestId('everything-search')).toBeTruthy();
  });

  it('Cancel sits beside the fan-out progress sentence and calls cancelFanout', () => {
    const cancelFanout = vi.fn();
    useDocsCache.setState({ fanoutProgress: { done: 1, total: 3, current: 'Payments' }, cancelFanout });
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => {}} search="?tab=made" />);
    expect(screen.getByTestId('everything-made-census').textContent).toContain('Asking Payments (1 of 3)');
    fireEvent.click(screen.getByTestId('everything-made-cancel'));
    expect(cancelFanout).toHaveBeenCalledTimes(1);
  });

  it('no fan-out running, no Cancel', () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => {}} search="?tab=made" />);
    expect(screen.queryByTestId('everything-made-cancel')).toBeNull();
  });

  it('?project= narrows the Made rows, says so in the scope line, and a kind chip keeps it', () => {
    useDocsCache.setState({ byProject: { pay: [doc('pay-spec', '2026-10-01T00:00:00Z')], docs: [doc('guide', '2026-10-02T00:00:00Z')] } });
    const navigate = vi.fn();
    render(<EverythingPage runs={[makeView({ id: 'x' })]} runsLoaded needRows={[]} navigate={navigate} search="?tab=made&project=pay" />);
    expect(screen.getAllByTestId('everything-made-row').map((r) => r.getAttribute('data-name'))).toEqual(['pay-spec']);
    expect(screen.getByTestId('everything-scope').textContent).toContain('Payments');
    fireEvent.click(screen.getAllByTestId('everything-kind').find((b) => b.getAttribute('data-kind') === 'documents')!);
    expect(navigate).toHaveBeenLastCalledWith('/everything?tab=made&project=pay&kind=documents', { replace: true });
    fireEvent.click(screen.getByTestId('everything-scope-clear'));
    expect(navigate).toHaveBeenLastCalledWith('/everything?tab=made', { replace: true });
  });
});

describe('the project Documents root (port 1e)', () => {
  const P = { id: 'pay', name: 'Payments', status: 'active' } as unknown as Project;
  beforeEach(() => { updateProject.mockReset(); });
  afterEach(cleanup);

  it('is not shown for the default project', () => {
    render(<ProjectDocumentsRoot projectId="default" project={{ ...P, id: 'default' }} />);
    expect(screen.queryByTestId('project-docs-root')).toBeNull();
  });

  it('Set… saves a root; Change… and Clear rewrite it', async () => {
    const onChanged = vi.fn();
    updateProject.mockResolvedValueOnce({ project: { ...P, interactiveRoot: '/docs/pay' } });
    const { rerender } = render(<ProjectDocumentsRoot projectId="pay" project={P} onChanged={onChanged} />);
    expect(screen.getByTestId('project-docs-root')).toHaveAttribute('data-bound', 'false');
    fireEvent.click(screen.getByTestId('project-docs-root-edit'));
    fireEvent.change(screen.getByTestId('project-docs-root-input'), { target: { value: ' /docs/pay ' } });
    await act(async () => { fireEvent.click(screen.getByTestId('project-docs-root-save')); });
    expect(updateProject).toHaveBeenCalledWith('pay', { interactiveRoot: '/docs/pay' });
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ interactiveRoot: '/docs/pay' })));

    const bound = { ...P, interactiveRoot: '/docs/pay' } as unknown as Project;
    rerender(<ProjectDocumentsRoot projectId="pay" project={bound} onChanged={onChanged} />);
    expect(screen.getByTestId('project-docs-root')).toHaveAttribute('data-bound', 'true');
    expect(screen.getByTestId('project-docs-root-value').textContent).toBe('/docs/pay');
    expect(screen.getByTestId('project-docs-root-edit').textContent).toBe('Change…');
    updateProject.mockResolvedValueOnce({ project: { ...P, interactiveRoot: null } });
    await act(async () => { fireEvent.click(screen.getByTestId('project-docs-root-clear')); });
    expect(updateProject).toHaveBeenLastCalledWith('pay', { interactiveRoot: null });
  });

  it('a refused write says why', async () => {
    updateProject.mockRejectedValueOnce(new Error('root must be absolute'));
    render(<ProjectDocumentsRoot projectId="pay" project={P} />);
    fireEvent.click(screen.getByTestId('project-docs-root-edit'));
    fireEvent.change(screen.getByTestId('project-docs-root-input'), { target: { value: 'rel' } });
    await act(async () => { fireEvent.click(screen.getByTestId('project-docs-root-save')); });
    expect(screen.getByTestId('project-docs-root-error').textContent).toBe('root must be absolute');
  });
});
