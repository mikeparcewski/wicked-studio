import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { ApiError } from '../src/api/errors.js';

/**
 * `/vibe` (and `/demo`) count what the daemon SERVES — bounded by the independent review of #263
 * (F-1/F-2). F-A45-008 found a fresh browser reading "DOCUMENTS 0 — projects opened this session"
 * over a daemon holding three documents; the first fix fanned out on mount and would have
 * cold-started one `wicked-interactive` bridge PER PROJECT on the landing (~60 s each, in parallel).
 * The bounded rule:
 *  - NO fan-out on mount. The one request the corpus surfaces make on their own is the CHEAP
 *    daemon-wide index (`GET /interactive/docs`, served from the ledgers — no bridge), presence-
 *    checked: a pre-0.36 daemon answers 404 and the corpus stays "documents in opened projects".
 *  - the per-project fan-out is the operator's explicit `[load for all projects]` gesture:
 *    SEQUENTIAL (one bridge at a time), the project being asked named, cancellable.
 *  - a project whose bridge cannot answer (503 bridge_unavailable) is UNREACHABLE, never "no
 *    documents": the label reads "N projects · M unreachable", the count excludes it.
 *  - the current project (the router's pathname names it) lists first; a per-project chip filters.
 */

const listDocs = vi.fn();
const listAllDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a) as Promise<DocSummary[]>,
  listAllDocs: () => listAllDocs() as Promise<unknown>,
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
const INDEX_ROWS = [
  ...NOTES.map((d) => ({ ...d, project_id: 'notes' })),
  ...DECK.map((d) => ({ ...d, project_id: 'q3-review-deck' })),
];

function made(mode: 'vibe' | 'demo' = 'vibe', pathname = '/vibe'): ReturnType<typeof render> {
  return render(<MadeDashboard mode={mode} runs={[]} navigate={() => {}} runPath={(id) => `/runs/${id}`} pathname={pathname} search="" />);
}

const chipTexts = (): string[] =>
  within(screen.getByTestId('vibe-filter')).getAllByRole('button')
    .map((b) => (b.textContent ?? '').replace(/\s+/g, ''))
    .filter((x) => /^(Allprojects|notes|q3-review-deck|scratch)\d+$/.test(x));

beforeEach(() => {
  listDocs.mockReset();
  listDocs.mockImplementation((pid: unknown) => Promise.resolve(pid === 'notes' ? NOTES : pid === 'q3-review-deck' ? DECK : []));
  listAllDocs.mockReset();
  // The pre-0.36 daemon: the index route is absent.
  listAllDocs.mockResolvedValue(null);
  useDocsCache.setState({ byProject: {}, unavailable: {}, census: 'opened', index: 'untried', fanoutDone: false, fanoutProgress: null });
  useProjectsStore.setState({ projects: [project('default', 'Unfiled'), project('notes', 'notes'), project('q3-review-deck', 'q3-review-deck'), project('scratch', 'scratch')] });
  useMembershipStore.setState({ projectNameByRun: {}, projectIdByRun: {}, attachedAt: {} } as never);
});
afterEach(() => cleanup());

describe('no fan-out on mount (F-1)', () => {
  it('a fresh session asks NOTHING per project: one presence-checked index read, zero listDocs; the tile says "documents in opened projects"', async () => {
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalledTimes(1));
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.queryByTestId('vibe-doc-row')).toBeNull();
    const tile = screen.getByTestId('stat-vibe-items');
    expect(tile).toHaveTextContent('0');
    expect(tile).toHaveTextContent('documents in opened projects');
    expect(tile).not.toHaveTextContent(/all \d+ projects/);
    const label = screen.getByTestId('vibe-corpus-label');
    expect(label).toHaveAttribute('data-census', 'opened');
    expect(screen.getByTestId('vibe-load-all')).toHaveTextContent('load for all projects');
    expect(screen.getByTestId('vibe-load-all')).toHaveAttribute('data-census', 'pending');
  });

  it('what a surface already deposited this session IS listed, and the label counts those projects honestly', async () => {
    useDocsCache.setState({ byProject: { notes: NOTES } });
    made('vibe');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['ideas', 'todo']);
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('documents in opened projects (1 of 3)');
    expect(listDocs).not.toHaveBeenCalled();
  });

  it('the index read is made ONCE per session — a second mount does not repeat it', async () => {
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalledTimes(1));
    cleanup();
    made('demo');
    await waitFor(() => expect(screen.getByTestId('stat-demo-items')).toBeInTheDocument());
    expect(listAllDocs).toHaveBeenCalledTimes(1);
  });
});

describe('the cheap daemon-wide index (0.36.0 `GET /interactive/docs`)', () => {
  it('when the daemon serves it, every project\'s documents list with no bridge asked, the tile says "all N projects", the chips carry live counts', async () => {
    listAllDocs.mockResolvedValue(INDEX_ROWS);
    made('vibe');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['brief', 'ideas', 'todo']);
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('all 3 projects');
    expect(screen.getByTestId('vibe-corpus-label')).toHaveAttribute('data-census', 'all-projects');
    expect(chipTexts()).toEqual(['Allprojects3', 'notes2', 'q3-review-deck1']);
    expect(screen.getByTestId('vibe-load-all')).toHaveTextContent('ask every bridge anyway');
  });

  it('an index that FAILS (a 500) leaves the corpus "opened projects" — nothing is invented', async () => {
    listAllDocs.mockRejectedValue(new ApiError(500, 'ledger unreadable'));
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalled());
    expect(screen.getByTestId('vibe-corpus-label')).toHaveAttribute('data-census', 'opened');
    expect(useDocsCache.getState().index).toBe('failed');
  });
});

describe('the explicit gesture — sequential, cancellable, honest about unreachable bridges (F-1/F-2)', () => {
  it('[load for all projects] asks the unknown projects ONE AT A TIME, names the one being asked, then reads "all N projects"', async () => {
    const pending: Array<(v: DocSummary[]) => void> = [];
    const order: string[] = [];
    listDocs.mockImplementation((pid: unknown) => new Promise<DocSummary[]>((r) => { order.push(String(pid)); pending.push(r); }));
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('vibe-load-all'));
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(1)); // sequential: exactly one in flight
    expect(order).toEqual(['notes']);
    const progress = screen.getByTestId('vibe-fanout-progress');
    expect(progress).toHaveTextContent('loading… 0/3 — asking notes (one bridge at a time)');
    expect(screen.getByTestId('vibe-corpus-label')).toHaveAttribute('data-census', 'loading');
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('loading 0 of 3 projects — notes…');
    await act(async () => { pending[0]!(NOTES); await Promise.resolve(); });
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(2));
    expect(order).toEqual(['notes', 'q3-review-deck']);
    await act(async () => { pending[1]!(DECK); await Promise.resolve(); });
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(3));
    await act(async () => { pending[2]!([]); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByTestId('vibe-corpus-label')).toHaveAttribute('data-census', 'all-projects'));
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('all 3 projects');
    expect(screen.getAllByTestId('vibe-doc-row').map((r) => within(r).getByRole('link').textContent)).toEqual(['brief', 'ideas', 'todo']);
    expect(screen.getByTestId('vibe-load-all')).toHaveTextContent('reload all projects');
  });

  it('a 503 bridge_unavailable is UNREACHABLE, not empty: the label says "N projects · 1 unreachable", the project is named, the count excludes it', async () => {
    listDocs.mockImplementation((pid: unknown) =>
      pid === 'scratch'
        ? Promise.reject(new ApiError(503, 'bridge unavailable: wicked-interactive did not answer within 60s'))
        : Promise.resolve(pid === 'notes' ? NOTES : DECK));
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('vibe-load-all'));
    await screen.findByTestId('vibe-unreachable');
    const label = screen.getByTestId('vibe-corpus-label');
    expect(label).toHaveAttribute('data-census', 'partial');
    expect(label).toHaveAttribute('data-unreachable', '1');
    expect(label).toHaveTextContent('3 projects · 1 unreachable');
    const un = screen.getByTestId('vibe-unreachable');
    expect(un).toHaveTextContent('1 unreachable — scratch (bridge did not answer; not counted)');
    expect(un).toHaveAttribute('title', 'scratch: bridge unavailable: wicked-interactive did not answer within 60s');
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('3');
    expect(useDocsCache.getState().byProject['scratch']).toBeUndefined();
    expect(useDocsCache.getState().unavailable['scratch']).toMatch(/did not answer/);
  });

  it('cancel stops after the project being asked answers — what landed stays listed, the rest is not asked', async () => {
    const pending: Array<(v: DocSummary[]) => void> = [];
    listDocs.mockImplementation(() => new Promise<DocSummary[]>((r) => { pending.push(r); }));
    made('vibe');
    await waitFor(() => expect(listAllDocs).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId('vibe-load-all'));
    await waitFor(() => expect(listDocs).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('vibe-fanout-cancel'));
    await act(async () => { pending[0]!(NOTES); await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByTestId('vibe-fanout-progress')).toBeNull());
    expect(listDocs).toHaveBeenCalledTimes(1);
    expect(screen.getAllByTestId('vibe-doc-row')).toHaveLength(2);
    expect(useDocsCache.getState().fanoutDone).toBe(true);
  });

  it('a second gesture after the census asks EVERY project again (a reload)', async () => {
    useDocsCache.setState({ byProject: { notes: NOTES, 'q3-review-deck': DECK, scratch: [] }, census: 'fanout', fanoutDone: true });
    made('vibe');
    await screen.findAllByTestId('vibe-doc-row');
    fireEvent.click(screen.getByTestId('vibe-load-all'));
    await waitFor(() => expect(useDocsCache.getState().fanoutProgress).toBeNull());
    expect(new Set(listDocs.mock.calls.map(([p]) => p))).toEqual(new Set(['notes', 'q3-review-deck', 'scratch']));
  });
});

describe('ordering and filtering (F-A45-008 / F-12)', () => {
  it('the CURRENT project — the router pathname names it — lists first, rows and chips; a chip narrows the grid, the tile keeps the corpus count', async () => {
    listAllDocs.mockResolvedValue(INDEX_ROWS);
    made('vibe', '/p/notes/document');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['ideas', 'todo', 'brief']);
    expect(chipTexts()).toEqual(['Allprojects3', 'notes2', 'q3-review-deck1']);
    fireEvent.click(within(screen.getByTestId('vibe-filter')).getAllByRole('button').find((b) => /^q3-review-deck/.test(b.textContent ?? ''))!);
    await waitFor(() => expect(screen.getAllByTestId('vibe-doc-row')).toHaveLength(1));
    expect(screen.getByTestId('stat-vibe-items')).toHaveTextContent('3');
  });

  it('with no current project the corpus is newest-first across projects and chips order by size', async () => {
    listAllDocs.mockResolvedValue(INDEX_ROWS);
    made('vibe', '/vibe');
    const rows = await screen.findAllByTestId('vibe-doc-row');
    expect(rows.map((r) => within(r).getByRole('link').textContent)).toEqual(['brief', 'ideas', 'todo']);
  });

  it('/demo shares the census and lists only demos', async () => {
    listAllDocs.mockResolvedValue(INDEX_ROWS);
    made('demo');
    const rows = await screen.findAllByTestId('demo-doc-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset.docKind).toBe('demo');
    expect(screen.getByTestId('stat-demo-items')).toHaveTextContent('all 3 projects');
  });
});
