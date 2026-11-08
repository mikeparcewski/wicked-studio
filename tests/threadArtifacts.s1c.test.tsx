/**
 * PLAN S1 A4: a run whose made artifacts are drawn at its proposal (the slot) leaves them out of its own block, so the
 * card renders once; any other run keeps them in its block (an Unfiled one included: G1).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../src/board/gateActions.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

vi.mock('../src/api/interactive.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/interactive.js')>()),
  listDocs: async () => [{ name: 'note-1', kind: 'doc', style: 'doc', head: 1, versions: 2, updated_at: null }],
  listAllDocs: async () => null,
}));
vi.mock('../src/components/session/ArtifactMorph.js', () => ({
  ArtifactMorph: (p: { projectId: string; docId: string }) => <div data-testid="placed" data-project={p.projectId} data-doc={p.docId} />,
}));
const { RunBlock } = await import('../src/components/session/SessionView.js');
const { resetRunArtifactsCache } = await import('../src/components/session/RunArtifacts.js');

const RUN = 'r-made';
const view = () => makeView({ id: RUN, status: 'completed', project_id: null, workflow_id: 'interactive-draft', artifact_ref: '_unfiled/note-1', proposal_id: 'c:t', problem: 'write a note' } as never);

beforeEach(() => {
  vi.restoreAllMocks();
  resetRunArtifactsCache();
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] } as never);
  vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: { [RUN]: IDLE_GATE_ACTION } });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => cleanup());

describe('RunBlock and the proposal slot (A4)', () => {
  it('an Unfiled run\'s document shows in its block', async () => {
    render(<RunBlock view={view()} badge={0} sessionId="chat:c" />);
    const placed = await screen.findByTestId('placed');
    expect(placed.dataset['project']).toBe('default');
    expect(screen.getByTestId('chat-artifacts')).toBeDefined();
  });

  it('drawn at its proposal instead: the block leaves it out', async () => {
    render(<RunBlock view={view()} badge={0} sessionId="chat:c" madeElsewhere />);
    await waitFor(() => expect(screen.getByTestId('session-run')).toBeDefined());
    await new Promise((r) => setTimeout(r, 30));
    expect(screen.queryByTestId('placed')).toBeNull();
    expect(screen.queryByTestId('chat-artifacts')).toBeNull();
  });
});
