/** PLAN S1 G7 piece 2 (review r2): the run thread's own recording slot tells the verbs a cut opens (`cutOpens`). */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeView } from './factories.js';

vi.mock('../src/api/interactive.js', async (orig) => ({ ...(await orig<typeof import('../src/api/interactive.js')>()), listDocs: async () => [], listAllDocs: async () => null }));
vi.mock('../src/api/demo.js', async (orig) => ({ ...(await orig<typeof import('../src/api/demo.js')>()), getDemo: async () => ({ stage: 'done', document: null }) }));
vi.mock('../src/components/session/ArtifactMorph.js', () => ({
  ArtifactMorph: (p: { slot?: { body: (size: string, morph: () => void) => React.ReactNode } }) => <div data-testid="placed">{p.slot?.body('inline', () => undefined)}</div>,
}));
vi.mock('../src/components/session/WalkthroughEditor.js', () => ({ WalkthroughEditor: () => <div /> }));
vi.mock('../src/components/editorPorts/RecordingGateActions.js', () => ({
  recordingGateActions: (_b: unknown, _u: unknown, _e?: unknown, _s?: boolean, cutOpens?: boolean) => <span data-testid="rec-verbs" data-cut-opens={String(cutOpens === true)} />,
}));
const { RunArtifacts } = await import('../src/components/session/RunArtifacts.js');
afterEach(() => cleanup());

describe('the demo slot body', () => {
  it('passes cutOpens to the recording verbs', () => {
    const v = makeView({ id: 'd-1', status: 'completed', project_id: 'p', extra_write_roots: [], team_plan: { preset: 'demo' } } as never);
    render(<RunArtifacts view={v} composerKey="k" only="made" />);
    expect(screen.getByTestId('rec-verbs')).toHaveAttribute('data-cut-opens', 'true');
  });
});
