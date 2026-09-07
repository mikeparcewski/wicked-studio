import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project } from '../src/api/types.js';
import type { DocSummary } from '../src/api/interactive.js';
import { makeView } from './factories.js';

/**
 * The three Made command surfaces the nav-reorg split `/make` into: Execute (`/execute`, the RUN
 * half), Vibe (`/vibe`, the DOCUMENT corpus), Demo (`/demo`, the DEMO corpus) — ONE parameterized
 * MadeDashboard. Pinned here: Execute is the verbatim ChatsPage complement (build runs only, no
 * docs) with the needs-you gate jump + the inline Retry-as-prefill; Vibe lists only non-demo docs
 * and Demo only demos; each header's ＋ does the right create gesture.
 */

const { MadeDashboard } = await import('../src/components/MadeDashboard.js');
const { useDocsCache } = await import('../src/store/docsCache.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { clearRetryPrefill, peekRetryPrefill } = await import('../src/store/retryPrefill.js');

const project = (id: string, name: string): Project => ({
  id, name, description: null, status: 'active', scope: `project:${id}`,
  created_at: 1, updated_at: 1,
});

/** 2 chat runs + 4 build runs — the partition's mixed input. */
const RUNS = [
  makeView({ id: 'r-build-1', workflow_id: 'wf-w2', status: 'executing', problem: 'build the uploader' }),
  makeView({ id: 'r-chat-1', workflow_id: 'chat', status: 'executing', problem: 'talk it through' }),
  makeView({ id: 'r-build-2', workflow_id: 'wf-w2', status: 'completed', problem: 'migrate the API' }),
  makeView({ id: 'r-chat-2', workflow_id: undefined as unknown as string, status: 'completed', problem: 'legacy thread' }),
  makeView({ id: 'r-build-3', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'refactor auth' }),
  makeView({ id: 'r-build-4', workflow_id: 'wf-w2', status: 'failed', problem: 'ship the exporter' }),
];

const flatRunPath = (id: string): string => `/runs/${id}`;

const DOCS: DocSummary[] = [
  { name: 'roadmap', kind: 'doc', head: 3, versions: 3, updated_at: '2026-08-21T00:00:00Z' },
  { name: 'launch-demo', kind: 'demo', head: 1, versions: 1, updated_at: '2026-08-21T01:00:00Z' },
];

function made(mode: 'execute' | 'vibe' | 'demo', navigate: (p: string) => void = () => {}): ReturnType<typeof render> {
  return render(<MadeDashboard mode={mode} runs={RUNS} navigate={navigate} runPath={flatRunPath} />);
}

beforeEach(() => {
  clearRetryPrefill();
  useDocsCache.setState({ byProject: {}, fanoutDone: false, fanoutProgress: null });
  useProjectsStore.setState({ projects: [project('p-notes', 'Notes')] });
  useMembershipStore.setState({
    projectNameByRun: { 'r-build-1': 'Notes' },
    projectIdByRun: { 'r-build-3': 'p-notes' },
    attachedAtByRun: {},
  });
});

afterEach(() => cleanup());

describe('Execute (the run half)', () => {
  it('lists build runs only — chats are never double-listed', () => {
    made('execute');
    expect(screen.getByRole('heading', { name: 'Execute' })).toBeInTheDocument();
    const ids = screen.getAllByTestId('execute-run-row').map((r) => r.dataset.runId);
    expect(ids).toContain('r-build-1');
    expect(ids).not.toContain('r-chat-1');
    expect(ids).not.toContain('r-chat-2');
    // No document/demo corpus on Execute.
    expect(screen.queryByTestId('vibe-list')).toBeNull();
    expect(screen.queryByTestId('execute-corpus-label')).toBeNull();
  });

  it('＋ Run navigates to the unbound launch form', () => {
    const navigate = vi.fn();
    made('execute', navigate);
    fireEvent.click(screen.getByTestId('execute-new'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
  });

  it('an awaiting-human run jumps straight to its gate; a failed run prefills a retry', () => {
    const navigate = vi.fn();
    made('execute', navigate);

    const needsYou = screen.getByTestId('execute-needs-you');
    expect(needsYou.dataset.runId).toBe('r-build-3');
    fireEvent.click(needsYou);
    // r-build-3 has a known project → the gate-open path (not the flat run route).
    expect(navigate).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('execute-retry'));
    expect(peekRetryPrefill()?.retryOf).toBe('r-build-4');
    expect(navigate).toHaveBeenCalledWith('/runs/new');
  });
});

describe('Vibe (the document corpus)', () => {
  beforeEach(() => {
    useDocsCache.setState({ byProject: { 'p-notes': DOCS }, fanoutDone: false, fanoutProgress: null });
  });

  it('lists only non-demo documents', () => {
    made('vibe');
    expect(screen.getByRole('heading', { name: 'Vibe' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('vibe-doc-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset.docKind).toBe('doc');
    expect(within(rows[0]!).getByText('roadmap')).toBeInTheDocument();
    // The demo does not appear on Vibe.
    expect(screen.queryByText('launch-demo')).toBeNull();
  });

  it('＋ Document opens a project-picker locked to Document', () => {
    made('vibe');
    fireEvent.click(screen.getByTestId('vibe-new'));
    const picker = screen.getByTestId('project-mode-picker');
    expect(picker.dataset.mode).toBe('document');
  });
});

describe('Demo (the demo corpus)', () => {
  beforeEach(() => {
    useDocsCache.setState({ byProject: { 'p-notes': DOCS }, fanoutDone: false, fanoutProgress: null });
  });

  it('lists only demos', () => {
    made('demo');
    expect(screen.getByRole('heading', { name: 'Demo' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('demo-doc-row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.dataset.docKind).toBe('demo');
    expect(within(rows[0]!).getByText('launch-demo')).toBeInTheDocument();
    expect(screen.queryByText('roadmap')).toBeNull();
  });

  it('＋ Demo opens a project-picker locked to Video', () => {
    made('demo');
    fireEvent.click(screen.getByTestId('demo-new'));
    expect(screen.getByTestId('project-mode-picker').dataset.mode).toBe('video');
  });
});
