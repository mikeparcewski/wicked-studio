/**
 * PLAN S1 (plugins-complete): what a run made shows in its thread.
 *  - G1 / A4: an Unfiled run's document (chat-made or form-made) is found in the Unfiled mount by crew's `artifact_ref`,
 *    the daemon index's doc ↔ run binding, or the seam write root; a code run reads no document list at all.
 *  - A4 placement: a proposal card's run draws its slot there, and its own block leaves the made bubble out.
 *  - G2: a review run gets a Run insights slot; G3: an app turn gets the App card; G7.2: a demo's cut binds the card.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

const listDocs = vi.fn();
const listAllDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (orig) => ({ ...(await orig<typeof import('../src/api/interactive.js')>()), listDocs: (...a: unknown[]) => listDocs(...a), listAllDocs: () => listAllDocs() }));
const getDemo = vi.fn();
vi.mock('../src/api/demo.js', async (orig) => ({ ...(await orig<typeof import('../src/api/demo.js')>()), getDemo: (id: string) => getDemo(id) }));
// The cards themselves are the host's (tested elsewhere): here, which artifact is placed, where, and bound to what.
vi.mock('../src/components/session/ArtifactMorph.js', () => ({
  ArtifactMorph: (p: { projectId: string; docId: string; kind?: string; slot?: { kind: string }; artifactKey: string }) => (
    <div data-testid="placed" data-project={p.projectId} data-doc={p.docId} data-kind={p.slot?.kind ?? p.kind ?? ''} data-key={p.artifactKey} />
  ),
}));
vi.mock('../src/components/session/RunAppCard.js', async (orig) => ({
  ...(await orig<typeof import('../src/components/session/RunAppCard.js')>()),
  RunAppCard: ({ runId }: { runId: string }) => <div data-testid="run-app-card-stub" data-run={runId} />,
}));

const { RunArtifacts, docMountOf, isRunsDoc, resetRunArtifactsCache } = await import('../src/components/session/RunArtifacts.js');
const { docsIndexOf } = await import('../src/api/wave6-wire.js');

const DOC = { name: 'release-note-2de5acc6', kind: 'doc', style: 'doc', head: 1, versions: 2, updated_at: null };
const OTHER = { name: 'someone-elses', kind: 'doc', style: 'doc', head: 1, versions: 1, updated_at: null };

function run(session: Partial<SessionView['session']> & Record<string, unknown>): SessionView {
  return makeView({ id: 'r-1', status: 'completed', project_id: null, extra_write_roots: [], workflow_id: 'interactive-draft', ...session } as never);
}

beforeEach(() => {
  resetRunArtifactsCache();
  listDocs.mockReset().mockResolvedValue([DOC, OTHER]);
  listAllDocs.mockReset().mockResolvedValue(null);
  getDemo.mockReset();
});
afterEach(() => cleanup());

describe('G1: an Unfiled run finds the document it made', () => {
  it('a chat-made run: artifact_ref `_unfiled/<doc>` reads the Unfiled mount and places that document only', async () => {
    render(<RunArtifacts view={run({ artifact_ref: `_unfiled/${DOC.name}`, proposal_id: 'c:t' })} composerKey="k" only="made" />);
    const placed = await screen.findByTestId('placed');
    expect(listDocs).toHaveBeenCalledWith('default');
    expect(placed.dataset['project']).toBe('default');
    expect(placed.dataset['doc']).toBe(DOC.name);
    expect(screen.getAllByTestId('placed')).toHaveLength(1);
  });

  it('a form-made Unfiled run (no ref): its seam write root names the document', async () => {
    render(<RunArtifacts view={run({ extra_write_roots: [`/state/interactive-drafts/${DOC.name}`] })} composerKey="k" only="made" />);
    expect((await screen.findByTestId('placed')).dataset['doc']).toBe(DOC.name);
    expect(listDocs).toHaveBeenCalledWith('default');
  });

  it('the daemon index binds a document to the run (its `runs`), with no ref and no seam root', async () => {
    listAllDocs.mockResolvedValue(docsIndexOf({ docs: [{ projectId: 'default', name: DOC.name, kind: 'doc', head: 1, versions: 2, runs: ['r-1'] }] }));
    render(<RunArtifacts view={run({ workflow_id: 'docs' })} composerKey="k" only="made" />);
    expect((await screen.findByTestId('placed')).dataset['doc']).toBe(DOC.name);
  });

  it('a code run (no ref, no seam root, nothing in the index) never reads a document list: no Unfiled bridge is started', async () => {
    listAllDocs.mockResolvedValue([]);
    render(<RunArtifacts view={run({ workflow_id: 'bug', extra_write_roots: ['/repo/work'] })} composerKey="k" only="made" />);
    await waitFor(() => expect(listAllDocs).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(listDocs).not.toHaveBeenCalled();
    expect(screen.queryByTestId('placed')).toBeNull();
  });

  it('a filed run keeps its project mount', () => {
    expect(docMountOf(run({ project_id: 'proj_1' }))).toBe('proj_1');
    expect(docMountOf(run({ project_id: 'proj_1', artifact_ref: 'proj_2/x' }))).toBe('proj_2');
    expect(docMountOf(run({}))).toBe('default');
  });

  it('a doc is the run\'s by ref (same mount only), index or write root', () => {
    const v = run({ artifact_ref: '_unfiled/a' });
    expect(isRunsDoc(v, 'default', 'a', null)).toBe(true);
    expect(isRunsDoc(v, 'proj_1', 'a', null)).toBe(false);
    expect(isRunsDoc(v, 'default', 'b', new Map([['default/b', ['r-1']]]))).toBe(true);
    expect(isRunsDoc(v, 'default', 'b', new Map([['default/b', ['r-2']]]))).toBe(false);
  });

  it('the index reader keeps `runs`', () => {
    const [row] = docsIndexOf({ docs: [{ projectId: 'default', name: 'a', kind: 'doc', head: 1, versions: 1, runs: ['r-1', 7, ''] }] })!;
    expect(row!.runs).toEqual(['r-1']);
    expect(docsIndexOf({ docs: [{ projectId: 'default', name: 'a', kind: 'doc', head: 1, versions: 1, runs: [] }] })![0]).not.toHaveProperty('runs');
  });
});

describe('G2 / G3: insights and app runs place their artifact', () => {
  it('a review-recent-work run places a run-insights slot', async () => {
    render(<RunArtifacts view={run({ workflow_id: 'review-recent-work', extra_write_roots: ['/x/reviews/r-1/out'] })} composerKey="k" only="made" />);
    expect((await screen.findByTestId('placed')).dataset['kind']).toBe('run-insights');
  });

  it('an apps-turn run places the App card for its app', async () => {
    render(<RunArtifacts view={run({ id: 'apps-open-tickets-support-01f450e70f3c', workflow_id: 'apps-turn' })} composerKey="k" only="made" />);
    expect((await screen.findByTestId('run-app-card-stub')).dataset['run']).toBe('apps-open-tickets-support-01f450e70f3c');
  });

  it('the plan-only view places neither', () => {
    render(<RunArtifacts view={run({ workflow_id: 'review-recent-work' })} composerKey="k" only="plan" />);
    expect(screen.queryByTestId('placed')).toBeNull();
  });
});

describe('G7 piece 2: a demo\'s made cut binds its card', () => {
  const demoRun = (): SessionView => run({ id: 'd-1', workflow_id: 'demo', project_id: 'proj_1', team_plan: { preset: 'demo' } as never });
  it('with DemoView.document the card is bound to the cut (the demo adapter opens the cut); without, the recording', async () => {
    getDemo.mockResolvedValue({ stage: 'done', document: { projectId: 'proj_1', docId: 'demo-d-1' } });
    render(<RunArtifacts view={demoRun()} composerKey="k" only="made" />);
    await waitFor(() => expect(screen.getByTestId('placed').dataset['doc']).toBe('demo-d-1'));
    expect(screen.getByTestId('placed').dataset['kind']).toBe('demo-video');
  });

  it('no cut yet: the recording, unbound', async () => {
    getDemo.mockResolvedValue({ stage: 'done', document: null });
    render(<RunArtifacts view={demoRun()} composerKey="k" only="made" />);
    await waitFor(() => expect(getDemo).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('placed').dataset['doc']).toBe('');
  });
});
