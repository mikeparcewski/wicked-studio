import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';

/**
 * `/vibe` (and `/demo`) list what the daemon SERVES, not what this browser opened (acceptance
 * finding F-A45-008 MEDIUM): a fresh browser on a daemon holding three documents read
 * "DOCUMENTS 0 — projects opened this session" and the Home door said "Vibe 0 documents". The
 * corpus now defaults to a once-per-session census — `ensureAll` asks every project the cache does
 * not know yet (crew has no daemon-wide docs route; `GET /projects/:id/interactive/api/docs` is
 * per project) — with the current project first and the per-project view as a filter chip.
 */

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a) as Promise<DocSummary[]>,
}));

const { MadeDashboard } = await import('../src/components/MadeDashboard.js');
const { useDocsCache } = await import('../src/store/docsCache.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const project = (id: string, name: string): Project => ({
  id, name, description: null, status: 'active', scope: `project:${id}`, created_at: 0, updated_at: 0,
} as unknown as Project);

const doc = (name: string, kind: DocSummary['kind'] = 'doc', updated_at = '2026-09-10T00:00:00Z'): DocSummary => ({ name, kind, head: 1, versions: 1, updated_at });

const NOTES = [doc('ideas'), doc('todo', 'doc', '2026-09-09T00:00:00Z')];
const DECK = [doc('launch-demo', 'demo'), doc('brief', 'doc', '2026-09-11T00:00:00Z')];

function made(mode: 'vibe' | 'demo' = 'vibe'): ReturnType<typeof render> {
  return render(<MadeDashboard mode={mode} runs={[]} navigate={() => {}} runPath={(id) => `/runs/${id}`} />);
}

beforeEach(() => {
  listDocs.mockReset();
  listDocs.mockImplementation((pid: unknown) => Promise.resolve(pid === 'notes' ? NOTES : pid === 'q3-review-deck' ? DECK : []));
  useDocsCache.setState({ byProject: {}, fanoutDone: false, fanoutProgress: null });
  useProjectsStore.setState({ projects: [project('default', 'Unfiled'), project('notes', 'notes'), project('q3-review-deck', 'q3-review-deck'), project('scratch', 'scratch')] });
  useMembershipStore.setState({ projectNameByRun: {}, projectIdByRun: {}, attachedAt: {} } as never);
  window.history.replaceState(null, '', '/vibe');
});
afterEach(() => cleanup());

describe('ensureAll — the once-per-session census', () => {
  it('asks only the projects the cache does not know, marks the census done, and never asks twice', async () => {
    useDocsCache.setState({ byProject: { notes: NOTES } });
    await act(() => useDocsCache.getState().ensureAll(['notes', 'q3-review-deck', 'scratch']));
    expect(listDocs.mock.calls.map(([p]) => p)).toEqual(['q3-review-deck', 'scratch']);
    expect(useDocsCache.getState().fanoutDone).toBe(true);
    expect(useDocsCache.getState().byProject['q3-review-deck']).toEqual(DECK);
    expect(useDocsCache.getState().byProject['scratch']).toEqual([]);
    await act(() => useDocsCache.getState().ensureAll(['notes', 'q3-review-deck', 'scratch']));
    expect(listDocs).toHaveBeenCalledTimes(2);
  });

  it('every project already known ⇒ no request at all, census done', async () => {
    useDocsCache.setState({ byProject: { notes: NOTES } });
    await act(() => useDocsCache.getState().ensureAll(['notes']));
    expect(listDocs).not.toHaveBeenCalled();
    expect(useDocsCache.getState().fanoutDone).toBe(true);
  });

  it('a bridge that cannot answer is an honest empty list, not a failed census', async () => {
    listDocs.mockRejectedValue(new Error('no interactive root'));
    await act(() => useDocsCache.getState().ensureAll(['scratch']));
    expect(useDocsCache.getState().byProject['scratch']).toEqual([]);
    expect(useDocsCache.getState().fanoutDone).toBe(true);
  });
});

describe('/vibe — the corpus defaults to every project (F-A45-008)', () => {
  it('a fresh session fans out on mount (one GET per non-default project), lists every document, and the tile says "all 3 projects" — never "opened this session"', async () => {
    made('vibe');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['brief', 'ideas', 'todo']);
    expect(new Set(listDocs.mock.calls.map(([p]) => p))).toEqual(new Set(['notes', 'q3-review-deck', 'scratch']));
    expect(listDocs).not.toHaveBeenCalledWith('default');
    const tile = screen.getByTestId('stat-vibe-items');
    expect(tile).toHaveTextContent('3');
    expect(tile).toHaveTextContent('all 3 projects');
    expect(tile).not.toHaveTextContent('opened this session');
    const label = screen.getByTestId('vibe-corpus-label');
    expect(label).toHaveAttribute('data-census', 'all-projects');
    expect(label).toHaveTextContent('Listing: documents (all 3 projects)');
    expect(screen.getByTestId('vibe-load-all')).toHaveTextContent('reload all projects');
    expect(screen.getByTestId('vibe-load-all')).toHaveAttribute('data-census', 'done');
  });

  it('per-project chips carry live counts, "All projects" is the default, and a chip narrows the list', async () => {
    made('vibe');
    await screen.findAllByTestId('vibe-doc-row');
    const strip = screen.getByTestId('vibe-filter');
    const chips = within(strip).getAllByRole('button').filter((b) => /All projects|notes|q3-review-deck/.test(b.textContent ?? ''));
    // Label and count are sibling spans — compare whitespace-free.
    expect(chips.map((c) => c.textContent?.replace(/\s+/g, ''))).toEqual(['Allprojects3', 'notes2', 'q3-review-deck1']);
    fireEvent.click(chips[1]!);
    await waitFor(() => expect(screen.getAllByTestId('vibe-doc-row')).toHaveLength(2));
    expect(screen.getAllByTestId('vibe-doc-row').map((r) => within(r).getByRole('link').textContent)).toEqual(['ideas', 'todo']);
    // The tile's count is the corpus, the filter narrows the grid only.
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('3');
  });

  it('the CURRENT project (the address names it) lists first — rows and chips', async () => {
    window.history.replaceState(null, '', '/p/notes/document');
    made('vibe');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['ideas', 'todo', 'brief']);
    const strip = screen.getByTestId('vibe-filter');
    const chips = within(strip).getAllByRole('button').filter((b) => /All projects|notes|q3-review-deck/.test(b.textContent ?? ''));
    // Label and count are sibling spans — compare whitespace-free.
    expect(chips.map((c) => c.textContent?.replace(/\s+/g, ''))).toEqual(['Allprojects3', 'notes2', 'q3-review-deck1']);
  });

  it('a project already deposited this session is not asked again; the reload button asks every project', async () => {
    useDocsCache.setState({ byProject: { notes: NOTES } });
    made('vibe');
    await screen.findAllByTestId('vibe-doc-row');
    await waitFor(() => expect(useDocsCache.getState().fanoutDone).toBe(true));
    expect(new Set(listDocs.mock.calls.map(([p]) => p))).toEqual(new Set(['q3-review-deck', 'scratch']));
    fireEvent.click(screen.getByTestId('vibe-load-all'));
    await waitFor(() => expect(listDocs.mock.calls.filter(([p]) => p === 'notes')).toHaveLength(1));
  });

  it('/demo runs the same census and lists only demos', async () => {
    made('demo');
    const rows = await screen.findAllByTestId('demo-doc-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset.docKind).toBe('demo');
    expect(screen.getByTestId('stat-demo-items')).toHaveTextContent('all 3 projects');
  });

  it('while the census runs the tile and the label say so', async () => {
    let release: (v: DocSummary[]) => void = () => {};
    listDocs.mockImplementation(() => new Promise<DocSummary[]>((r) => { release = r; }));
    made('vibe');
    await waitFor(() => expect(listDocs).toHaveBeenCalled());
    expect(screen.getByTestId('vibe-corpus-label')).toHaveAttribute('data-census', 'loading');
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent(/loading 0 of 3 projects…/);
    expect(screen.getByTestId('vibe-fanout-progress')).toHaveTextContent('loading… 0/3');
    await act(async () => { release([]); await Promise.resolve(); });
  });
});
