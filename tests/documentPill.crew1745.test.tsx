import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '../src/api/editors.js';
import type { SessionView } from '../src/api/types.js';

/**
 * crew#1745 (studio half): a document card with no version yet said "Building…" forever, even after the run making it
 * was stopped by a restart. The pill now says how that run stands: still building, stopped, or not made with crew's
 * reason under the title.
 */

vi.mock('../src/api/interactive.js', async (orig) => {
  const real = await orig<typeof import('../src/api/interactive.js')>();
  return { ...real, getVersions: vi.fn(async () => ({ head: 0, versions: [] })), listExports: vi.fn(async () => []) };
});
const interactive = await import('../src/api/interactive.js');

const { PluginCard } = await import('../src/components/editorHost/PluginCard.js');
const { InteractiveDocSurfaceAdapter } = await import('../src/editors/adapters/interactiveDoc.js');
const { attemptOfRun } = await import('../src/board/runAttempt.js');
const { resetArtifactSizes } = await import('../src/store/artifactSizes.js');

// The run's session as crew's run view writes it: `landing_failed` is `runTimingIndex.landingFailedOf(runId)`
// (crew packages/crew/src/api/routes.ts:2505-2506), recorded by `onBoundOutcome` (crew packages/crew/src/api/server.ts:
// 1189-1190) as `{ reason, at }`, with the boot reconcile's reason (crew packages/crew/src/interactive/draft-events.ts:1030).
const session = (over: Partial<SessionView['session']>): SessionView['session'] => ({
  id: 'run-doc-1', status: 'executing', proposal_id: 'chat-1:p1', artifact_ref: '_unfiled/q3-brief',
  ...over,
} as SessionView['session']);
const RESTARTED = session({ status: 'cancelled', landing_failed: { reason: 'interrupted by a restart', at: 1_763_900_000_000 } });

const EDITOR = {
  id: 'wicked-doc', title: 'Document', version: '0.1.0', sha256: 'c'.repeat(64), protocol: [1],
  kinds: ['document'], sizes: ['inline', 'pane', 'full'], enabled: true, first_party: true,
} as EditorView;
const binding = (attempt?: ReturnType<typeof attemptOfRun>) => ({
  artifactKey: 'run-doc-1:_unfiled/q3-brief', title: 'q3 brief', kind: 'document', source: 'interactive-doc' as const,
  projectId: '_unfiled', docId: 'q3-brief', runId: 'run-doc-1', composerKey: 'c', ...(attempt !== undefined ? { attempt } : {}),
});

// The card reads the document's HTML once its manifest is read: answered here, never by the network.
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 }))); });
afterEach(() => { cleanup(); resetArtifactSizes(); vi.unstubAllGlobals(); });

describe('attemptOfRun', () => {
  it('a run crew recorded as not landed is failed, with crew\'s reason', () => {
    expect(attemptOfRun(RESTARTED)).toEqual({ state: 'failed', why: 'interrupted by a restart' });
  });
  it('a run that ended cancelled or failed with no reason recorded is stopped', () => {
    expect(attemptOfRun(session({ status: 'cancelled' }))).toEqual({ state: 'stopped' });
    expect(attemptOfRun(session({ status: 'failed' }))).toEqual({ state: 'stopped' });
    expect(attemptOfRun(session({ status: 'failed', landing_failed: { reason: ' ', at: 1 } }))).toEqual({ state: 'stopped' });
  });
  it('a running or just-completed run is still working', () => {
    expect(attemptOfRun(session({ status: 'executing' }))).toEqual({ state: 'working' });
    expect(attemptOfRun(session({ status: 'completed' }))).toEqual({ state: 'working' });
  });
});

describe('interactive-doc pills', () => {
  // An adapter whose manifest has been read: head 0, no version.
  const a = async () => { const d = new InteractiveDocSurfaceAdapter(binding()); await d.refresh(); return d; };
  it('before a first version: building, stopped, or not made with why', async () => {
    expect((await a()).pills()).toEqual([{ id: 'version', text: 'Building…', tone: 'warn' }]);
    expect((await a()).pills({ state: 'working' })[0]!.text).toBe('Building…');
    expect((await a()).pills({ state: 'stopped' })[0]).toMatchObject({ text: 'Stopped', tone: 'bad' });
    expect((await a()).pills(attemptOfRun(RESTARTED))[0]).toEqual({
      id: 'version', text: 'Not made', tone: 'bad', why: 'The last attempt ended without a draft: interrupted by a restart.',
    });
  });

  it('xreview P2: a manifest not read yet is never "no version": a revision that failed over Version 2 reads Version 2', async () => {
    let answer!: (m: { head: number; versions: never[] }) => void;
    vi.mocked(interactive.getVersions).mockImplementationOnce(() => new Promise((r) => { answer = r; }));
    const doc = new InteractiveDocSurfaceAdapter(binding());
    const moved = doc.refresh();
    expect(doc.pills(attemptOfRun(RESTARTED))).toEqual([{ id: 'version', text: 'Reading…', tone: 'neutral' }]);
    expect(doc.pills({ state: 'stopped' })[0]!.text).toBe('Reading…');
    answer({ head: 2, versions: [] });
    await moved;
    expect(doc.pills(attemptOfRun(RESTARTED))).toEqual([{ id: 'version', text: 'Version 2', tone: 'neutral' }]);
  });

  it('xreview P2: a manifest that could not be read says nothing about the attempt', async () => {
    vi.mocked(interactive.getVersions).mockRejectedValueOnce(new Error('502'));
    const doc = new InteractiveDocSurfaceAdapter(binding());
    await doc.refresh().catch(() => null);
    expect(doc.pills(attemptOfRun(RESTARTED))[0]!.text).toBe('Reading…');
    expect(doc.pills({ state: 'working' })[0]!.text).toBe('Building…');
  });

  it('xreview P2: the first read that finds no version tells the card, though the head stays 0', async () => {
    const doc = new InteractiveDocSurfaceAdapter(binding());
    const told = vi.fn();
    doc.subscribe(told);
    await doc.refresh();
    expect(told).toHaveBeenCalled();
    expect(doc.pills({ state: 'stopped' })[0]!.text).toBe('Stopped');
    told.mockClear();
    await doc.refresh();
    expect(told).not.toHaveBeenCalled();
  });
});

describe('the document card', () => {
  it('follows the run: "Building…" while it works, then "Not made" and why once crew records the restart', async () => {
    const adapter = new InteractiveDocSurfaceAdapter(binding());
    await adapter.refresh();
    const { rerender } = render(<PluginCard binding={binding(attemptOfRun(session({})))} editor={EDITOR} adapter={adapter} src="about:blank" grants={['artifact.read']} />);
    expect(screen.getByTestId('plugin-card-pill').textContent).toBe('Building…');
    expect(screen.queryByTestId('plugin-card-pill-why')).toBeNull();
    // The same card (one adapter per artifact) re-renders with the run's new state.
    rerender(<PluginCard binding={binding(attemptOfRun(RESTARTED))} editor={EDITOR} adapter={adapter} src="about:blank" grants={['artifact.read']} />);
    expect(screen.getByTestId('plugin-card-pill').textContent).toBe('Not made');
    expect(screen.getByTestId('plugin-card-pill').getAttribute('data-tone')).toBe('bad');
    expect(screen.getByTestId('plugin-card-pill-why').textContent).toBe('The last attempt ended without a draft: interrupted by a restart.');
  });
});
