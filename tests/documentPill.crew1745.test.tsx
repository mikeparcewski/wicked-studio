import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => { cleanup(); resetArtifactSizes(); });

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
  const a = () => new InteractiveDocSurfaceAdapter(binding());
  it('before a first version: building, stopped, or not made with why', () => {
    expect(a().pills()).toEqual([{ id: 'version', text: 'Building…', tone: 'warn' }]);
    expect(a().pills({ state: 'working' })[0]!.text).toBe('Building…');
    expect(a().pills({ state: 'stopped' })[0]).toMatchObject({ text: 'Stopped', tone: 'bad' });
    expect(a().pills(attemptOfRun(RESTARTED))[0]).toEqual({
      id: 'version', text: 'Not made', tone: 'bad', why: 'The last attempt ended without a draft: interrupted by a restart.',
    });
  });
  it('a version on disk wins over the attempt', () => {
    const doc = a();
    (doc as unknown as { head: number }).head = 2;
    expect(doc.pills(attemptOfRun(RESTARTED))).toEqual([{ id: 'version', text: 'Version 2', tone: 'neutral' }]);
  });
});

describe('the document card', () => {
  it('follows the run: "Building…" while it works, then "Not made" and why once crew records the restart', () => {
    const adapter = new InteractiveDocSurfaceAdapter(binding());
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
