import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { makeView } from './factories.js';

/**
 * The /make dashboard (DES-FEEDBACK-003 §4.2, slice O): combined list +
 * reporting over made things. Pinned here: the EC24 corpus label + why
 * popover, the explicit fan-out gesture (zero doc requests on render, exactly
 * P on click), the §4.2.1 tile band with its named questions (EC19/EC28), and
 * the partition invariant — Make lists exactly the complement of ChatsPage's
 * verbatim filter.
 */

const listDocs = vi.fn((pid: string): Promise<DocSummary[]> =>
  Promise.resolve(pid === 'p-notes'
    ? [{ name: 'roadmap', kind: 'doc', head: 3, versions: 3, updated_at: '2026-08-21T00:00:00Z' },
       { name: 'launch-demo', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-21T01:00:00Z' }]
    : []));

vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (pid: string) => listDocs(pid),
}));

const { MakeDashboard } = await import('../src/components/MakeDashboard.js');
const { isChatRun } = await import('../src/components/ChatsPage.js');
const { useDocsCache } = await import('../src/store/docsCache.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');

const project = (id: string, name: string): Project => ({
  id, name, description: null, status: 'active', scope: `project:${id}`,
  created_at: 1, updated_at: 1,
});

/** 2 chat runs + 3 make runs — the partition's mixed W2-shaped input. */
const RUNS = [
  makeView({ id: 'r-build-1', workflow_id: 'wf-w2', status: 'executing', problem: 'build the uploader' }),
  makeView({ id: 'r-chat-1', workflow_id: 'chat', status: 'executing', problem: 'talk it through' }),
  makeView({ id: 'r-build-2', workflow_id: 'wf-w2', status: 'completed', problem: 'migrate the API' }),
  makeView({ id: 'r-chat-2', workflow_id: undefined as unknown as string, status: 'completed', problem: 'legacy thread' }),
  makeView({ id: 'r-build-3', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'refactor auth' }),
];

const flatRunPath = (id: string): string => `/runs/${id}`;

function dash(navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<MakeDashboard runs={RUNS} navigate={navigate} runPath={flatRunPath} />);
}

beforeEach(() => {
  listDocs.mockClear();
  useDocsCache.setState({ byProject: {}, fanoutDone: false, fanoutProgress: null });
  useProjectsStore.setState({
    projects: [project('default', 'Unfiled'), project('p-notes', 'notes'), project('p-api', 'api-migration'), project('p-auth', 'auth-refactor')],
  });
  useMembershipStore.setState({
    projectNameByRun: { 'r-build-1': 'api-migration', 'r-build-3': 'auth-refactor' },
    attachedAtByRun: { 'r-build-1': Date.now() - 3_600_000, 'r-build-3': Date.now() - 7_200_000 },
  });
  useRuntimeStore.setState({ logs: {} });
});
afterEach(() => cleanup());

describe('the partition invariant (§4.2/§3.3)', () => {
  it('lists exactly the non-chat runs — the verbatim ChatsPage complement', () => {
    dash();
    const rowIds = screen.getAllByTestId('make-run-row').map((r) => r.getAttribute('data-run-id'));
    const complement = RUNS.filter((v) => !isChatRun(v)).map((v) => v.session.id);
    expect(new Set(rowIds)).toEqual(new Set(complement));
    // Every run lands under exactly ONE path: Make ∪ Chat = all, Make ∩ Chat = ∅.
    for (const v of RUNS) {
      expect(rowIds.includes(v.session.id)).toBe(!isChatRun(v));
    }
  });

  it('rows are real links to runPath, active before terminal, with project names off the mirror', () => {
    dash();
    const rows = screen.getAllByTestId('make-run-row');
    expect(rows.map((r) => r.getAttribute('href'))).toEqual(
      ['/runs/r-build-1', '/runs/r-build-3', '/runs/r-build-2'], // active first
    );
    expect(rows[0]!.textContent).toContain('api-migration');
    expect(rows[2]!.textContent).toContain('Unfiled'); // unmapped run stays honest
  });
});

describe('the tile band (§4.2.1, EC19/EC28)', () => {
  it('renders the three tiles above the list, each with its named data-question', () => {
    dash();
    const band = screen.getByTestId('make-dashboard-tiles');
    const q = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-question') ?? null;
    expect(q('made-tile')).toBe('What is the shop producing, and of what kind?');
    expect(q('run-outcome-bar')).toBe('Are makes landing or failing?');
    expect(q('token-burn-sparkline')).toBe('What is making costing?');
    // EC28: the band precedes the list in DOM order.
    const list = screen.getByTestId('make-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the corpus label + fan-out gesture (§4.2.2, EC24)', () => {
  it('heads the list with the two-corpus label and the why popover', () => {
    dash();
    expect(screen.getByTestId('make-corpus-label').textContent).toContain(
      'Listing: build runs (all projects) · documents (projects opened this session)',
    );
    expect(screen.queryByTestId('make-corpus-why-popover')).toBeNull();
    fireEvent.click(screen.getByTestId('make-corpus-why'));
    // Quick win #5: plain words — no bridge internals in the popover.
    expect(screen.getByTestId('make-corpus-why-popover').textContent).toContain(
      'Documents load per project',
    );
  });

  it('Escape closes the why popover and returns focus to its trigger (review #10 overlay contract)', () => {
    dash();
    const trigger = screen.getByTestId('make-corpus-why');
    fireEvent.click(trigger);
    expect(screen.getByTestId('make-corpus-why-popover')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('make-corpus-why-popover')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('fires ZERO doc requests on render; the fan-out click fires exactly P (non-default projects)', async () => {
    dash();
    expect(listDocs).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('make-load-all-docs'));
    await waitFor(() => expect(screen.queryByTestId('make-load-all-docs')).toBeNull());
    expect(listDocs).toHaveBeenCalledTimes(3);
    expect(new Set(listDocs.mock.calls.map((c) => c[0]))).toEqual(new Set(['p-notes', 'p-api', 'p-auth']));
    // Cached for the session: the button collapses to the quiet note.
    expect(screen.getByText('docs loaded for all projects')).toBeInTheDocument();
    // The landed corpus renders: ▤/▶ name · vN · project rows.
    const docRows = screen.getAllByTestId('make-doc-row');
    expect(docRows).toHaveLength(2);
    expect(docRows[0]!.getAttribute('data-doc-kind')).toBe('demo');
    expect(docRows[0]!.textContent).toContain('launch-demo');
    expect(docRows[0]!.textContent).toContain('v1');
    expect(docRows[0]!.textContent).toContain('notes');
    expect(docRows[0]!.getAttribute('href')).toBe('/p/p-notes/video/launch-demo');
    expect(docRows[1]!.getAttribute('href')).toBe('/p/p-notes/document/roadmap');
  });

  it('renders session-known docs WITHOUT any gesture when the cache already holds them', () => {
    useDocsCache.getState().deposit('p-notes', [
      { name: 'roadmap', kind: 'doc', head: 2, versions: 2, updated_at: '2026-08-20T00:00:00Z' },
    ]);
    dash();
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.getAllByTestId('make-doc-row')).toHaveLength(1);
  });
});
