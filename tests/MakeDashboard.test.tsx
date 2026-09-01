import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { makeView } from './factories.js';

/**
 * The /make dashboard as a command surface (lane B): combined list + reporting
 * over made things. Pinned here: the partition invariant (Make = the verbatim
 * ChatsPage complement), the KPI band with honest window deltas, the
 * first-class FilterStrip, needs-you-first ordering + the gate jump, the
 * inline Retry (prefill, never a relaunch), derived titles (never raw
 * prompts), and the unchanged EC24 corpus label + explicit fan-out gesture.
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
const { clearRetryPrefill, peekRetryPrefill } = await import('../src/store/retryPrefill.js');

const project = (id: string, name: string): Project => ({
  id, name, description: null, status: 'active', scope: `project:${id}`,
  created_at: 1, updated_at: 1,
});

/** 2 chat runs + 4 make runs — the partition's mixed W2-shaped input. */
const RUNS = [
  makeView({ id: 'r-build-1', workflow_id: 'wf-w2', status: 'executing', problem: 'build the uploader' }),
  makeView({ id: 'r-chat-1', workflow_id: 'chat', status: 'executing', problem: 'talk it through' }),
  makeView({ id: 'r-build-2', workflow_id: 'wf-w2', status: 'completed', problem: 'migrate the API' }),
  makeView({ id: 'r-chat-2', workflow_id: undefined as unknown as string, status: 'completed', problem: 'legacy thread' }),
  makeView({ id: 'r-build-3', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'refactor auth' }),
  makeView({ id: 'r-build-4', workflow_id: 'wf-w2', status: 'failed', problem: 'ship the exporter' }),
];

const flatRunPath = (id: string): string => `/runs/${id}`;

function dash(navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<MakeDashboard runs={RUNS} navigate={navigate} runPath={flatRunPath} />);
}

beforeEach(() => {
  listDocs.mockClear();
  clearRetryPrefill();
  useDocsCache.setState({ byProject: {}, fanoutDone: false, fanoutProgress: null });
  useProjectsStore.setState({
    projects: [project('default', 'Unfiled'), project('p-notes', 'notes'), project('p-api', 'api-migration'), project('p-auth', 'auth-refactor')],
  });
  useMembershipStore.setState({
    projectNameByRun: { 'r-build-1': 'api-migration', 'r-build-3': 'auth-refactor' },
    projectIdByRun: { 'r-build-3': 'p-auth' },
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

  it('needs-you FIRST, then active, then terminal; titles are real links; project names off the mirror', () => {
    dash();
    const rows = screen.getAllByTestId('make-run-row');
    expect(rows.map((r) => r.getAttribute('data-run-id'))).toEqual(
      ['r-build-3', 'r-build-1', 'r-build-2', 'r-build-4'], // gated → active → terminal
    );
    const title = (row: HTMLElement) => within(row).getByTestId('make-run-title');
    expect(title(rows[0] as HTMLElement)).toHaveAttribute('href', '/runs/r-build-3');
    expect(rows[1]!.textContent).toContain('api-migration');
    expect(rows[2]!.textContent).toContain('Unfiled'); // unmapped run stays honest
  });

  it('a card is a door: clicking it navigates to the run', () => {
    const navigate = vi.fn();
    dash(navigate);
    const row = screen.getAllByTestId('make-run-row')
      .find((r) => r.getAttribute('data-run-id') === 'r-build-1')!;
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith('/runs/r-build-1');
  });
});

describe('the KPI band — items · runs consumed · active · failed', () => {
  it('renders the four tiles above the list with live values', () => {
    dash();
    const band = screen.getByTestId('make-kpis');
    const value = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-value') ?? null;
    expect(value('stat-items')).toBe('4');     // 4 windowed builds + 0 loaded docs
    expect(value('stat-runs')).toBe('4');
    expect(value('stat-active')).toBe('2');    // executing + awaiting_human (1 waiting on you)
    expect(value('stat-failed')).toBe('1');
    // EC28: the band precedes the list in DOM order.
    const list = screen.getByTestId('make-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('4 runs against a 30-run window has NO prior bucket — the delta reads "—"', () => {
    dash();
    expect(screen.getByTestId('stat-runs').getAttribute('data-delta')).toBe('none');
    expect(within(screen.getByTestId('stat-runs')).getByTestId('stat-delta')).toHaveTextContent('—');
  });

  it('the failed tile wears the fail token and doors into the failed filter', () => {
    dash();
    const failed = screen.getByTestId('stat-failed');
    expect((within(failed).getByTestId('stat-value') as HTMLElement).style.color).toBe('var(--status-fail)');
    fireEvent.click(failed);
    expect(screen.getByTestId('make-filter').getAttribute('data-filter')).toBe('failed');
    expect(screen.getAllByTestId('make-run-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-build-4']);
  });
});

describe('the action layer — needs-you jump + inline Retry', () => {
  it('a waiting run’s card jumps STRAIGHT to its gate (project known ⇒ the thread AT the gate)', () => {
    const navigate = vi.fn();
    dash(navigate);
    const jump = screen.getByTestId('make-needs-you');
    expect(jump.getAttribute('data-run-id')).toBe('r-build-3');
    fireEvent.click(jump);
    expect(navigate).toHaveBeenCalledWith('/p/p-auth/build/r-build-3#gate');
    expect(navigate).not.toHaveBeenCalledWith('/runs/r-build-3'); // no card navigation leaked
  });

  it('a FAILED item offers inline Retry — a prefill deposit + the composer, nothing auto-launches', () => {
    const navigate = vi.fn();
    dash(navigate);
    const retry = screen.getAllByTestId('make-retry').find((b) => b.getAttribute('data-run-id') === 'r-build-4')!;
    fireEvent.click(retry);
    const prefill = peekRetryPrefill();
    expect(prefill).not.toBeNull();
    expect(prefill!.retryOf).toBe('r-build-4');
    expect(prefill!.problem).toBe('ship the exporter');
    expect(navigate).toHaveBeenCalledWith('/runs/new');
  });
});

describe('the FilterStrip drives the grid', () => {
  it('status chips narrow the run cards; docs chip shows only documents', async () => {
    useDocsCache.getState().deposit('p-notes', [
      { name: 'roadmap', kind: 'doc', head: 2, versions: 2, updated_at: '2026-08-20T00:00:00Z' },
    ]);
    dash();
    const chip = (id: string) => screen.getAllByTestId('make-filter-chip')
      .find((c) => c.getAttribute('data-chip') === id)!;
    fireEvent.click(chip('needs-you'));
    expect(screen.getAllByTestId('make-run-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-build-3']);
    expect(screen.queryAllByTestId('make-doc-row')).toHaveLength(0);
    fireEvent.click(chip('docs'));
    expect(screen.queryAllByTestId('make-run-row')).toHaveLength(0);
    expect(screen.getAllByTestId('make-doc-row')).toHaveLength(1);
  });

  it('search narrows by derived title and project name', () => {
    dash();
    fireEvent.change(screen.getByTestId('make-filter-search'), { target: { value: 'uploader' } });
    expect(screen.getAllByTestId('make-run-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['r-build-1']);
  });
});

describe('full width + the creation verb', () => {
  it('the grid is a real CSS grid with no maxWidth anywhere on the surface', () => {
    dash();
    const grid = screen.getByTestId('make-runs-grid') as HTMLElement;
    expect(grid.style.maxWidth).toBe('');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
  });

  it('the header carries the section’s make entry — the same ＋ picker the rail forks', () => {
    dash();
    expect(screen.queryByTestId('make-picker')).toBeNull();
    fireEvent.click(screen.getByTestId('make-new'));
    const picker = screen.getByTestId('make-picker');
    const modes = within(picker as HTMLElement).getAllByTestId('make-picker-row')
      .map((r) => r.getAttribute('data-mode'));
    expect(modes).toEqual(['build', 'document', 'video']);
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
    // The landed corpus renders as cards: glyph/name · vN · versions · project.
    const docRows = screen.getAllByTestId('make-doc-row');
    expect(docRows).toHaveLength(2);
    expect(docRows[0]!.getAttribute('data-doc-kind')).toBe('demo');
    expect(docRows[0]!.textContent).toContain('launch-demo');
    expect(docRows[0]!.textContent).toContain('v1');
    expect(docRows[0]!.textContent).toContain('notes');
    expect(docRows[0]!.querySelector('a')).toHaveAttribute('href', '/p/p-notes/video/launch-demo');
    expect(docRows[1]!.querySelector('a')).toHaveAttribute('href', '/p/p-notes/document/roadmap');
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
