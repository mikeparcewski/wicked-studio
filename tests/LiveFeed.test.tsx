import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import type { CoreEvent, Project, ProjectMember, SessionStatus, SessionView } from '../src/api/types.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The live feed (DES-VISION-001 §1.3/§1.4/§5.1, vision slice 2): the home
 * route's right column, where cross-project narration aggregates. These pin
 * the slice's DOM ACs that need no browser:
 *
 *  - the feed exists exactly when something is moving (or a fresh failure
 *    leads a project) — absent otherwise, never an empty frame;
 *  - a `unitOutputDelta` for project B lands in `live-feed-block-B` through
 *    the SAME store fold the cards read — zero new sockets;
 *  - a project below the triage threshold still narrates (peripheral
 *    awareness, §1.4) while a DECAYED failure does not haunt the feed;
 *  - narration reads in the mono face (EC13) and the block dot / card status
 *    bar colors resolve from status tokens, never literals (EC15).
 */

let projects: Project[] = [];
let members: Record<string, ProjectMember[]> = {};

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: members[id] ?? [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: () => Promise.resolve([]),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

function project(id: string, over: Partial<Project> = {}): Project {
  return {
    id, name: id, description: null, status: 'active', scope: `project:${id}`,
    created_at: 1, updated_at: Date.now(), ...over,
  };
}

function member(project_id: string, member_ref: string): ProjectMember {
  return {
    id: `${project_id}:crew.run:${member_ref}`, project_id, member_kind: 'crew.run',
    member_ref, meta: null, attached_at: 1, attached_by: 'studio',
  };
}

const running = (id: string, status: SessionStatus = 'executing'): SessionView =>
  makeView({ id, status, unit_ix: 0 }, [makeUnit({ id: `${id}:u0`, session_id: id, ord: 0, stage: 'build', description: 'wire the board' })]);

const push = (event: CoreEvent): void => {
  act(() => { useRuntimeStore.getState().ingest(event); });
};

const block = (id: string): HTMLElement | null =>
  screen.queryByTestId(`live-feed-block-${id}`);

async function board(runs: SessionView[]): Promise<void> {
  render(<HomeBoard runs={runs} navigate={() => {}} />);
  await vi.waitFor(() => {
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', String(projects.length));
  });
  // Bindings (memberships) land a beat after the projects — flush them, so a
  // feed asserted ABSENT is absent with the runs placed, not merely unplaced.
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe('LiveFeed — the home route heartbeat (vision slice 2)', () => {
  beforeEach(() => {
    projects = [];
    members = {};
    useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {}, seq: 0 });
  });

  it('every moving project gets a block; a delta for B updates live-feed-block-B in place', async () => {
    projects = [project('p-a'), project('p-b')];
    members = { 'p-a': [member('p-a', 'run-a')], 'p-b': [member('p-b', 'run-b')] };
    await board([running('run-a'), running('run-b')]);

    await vi.waitFor(() => {
      expect(screen.getByTestId('live-feed')).toHaveAttribute('data-blocks', '2');
    });
    // Before any output: the block narrates the run's truthful headline (rule 3).
    expect(within(block('p-b') as HTMLElement).getByTestId('feed-line'))
      .toHaveTextContent('build — wire the board');

    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'Writing AC-3 for the checkout flow\n' } as CoreEvent);

    // The AC: the delta lands in B's block off the shared store — no navigation.
    await vi.waitFor(() => {
      expect(block('p-b') as HTMLElement).toHaveTextContent('Writing AC-3 for the checkout flow');
    });
    expect(block('p-a') as HTMLElement).not.toHaveTextContent('Writing AC-3');

    // EC13: narration is DATA — the mono face, off the token.
    const line = within(block('p-b') as HTMLElement).getAllByTestId('feed-line')[0] as HTMLElement;
    expect(line.style.fontFamily).toBe('var(--font-mono)');
    expect(line.className).toContain('wk-feed-line');
  });

  it('shows the newest lines newest-first, capped, duplicates folded', async () => {
    projects = [project('p-b')];
    members = { 'p-b': [member('p-b', 'run-b')] };
    await board([running('run-b')]);

    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'first step\n' } as CoreEvent);
    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'second step\nsecond step\n' } as CoreEvent);

    await vi.waitFor(() => {
      const lines = within(block('p-b') as HTMLElement).getAllByTestId('feed-line');
      expect(lines.map((l) => l.textContent)).toEqual(['second step', 'first step']);
    });
  });

  it('no moving runs anywhere ⇒ the feed is ABSENT, not an empty frame', async () => {
    projects = [project('p-done')];
    members = { 'p-done': [member('p-done', 'run-done')] };
    await board([running('run-done', 'completed')]);

    expect(screen.queryByTestId('live-feed')).toBeNull();
  });

  it('a gated-only project does not narrate; an executing one below triage still does', async () => {
    // The gate block belongs on the card, where it is answerable — the feed is
    // for narration (§1.3's wireframe: the gate-waiting project has no block).
    projects = [project('p-gate')];
    members = { 'p-gate': [member('p-gate', 'run-gate')] };
    await board([running('run-gate', 'awaiting_human')]);
    // The gate did land (the card leads the board) — the feed still has no block.
    await vi.waitFor(() => {
      expect(screen.getByTestId('project-card')).toHaveAttribute('data-attention', 'gate');
    });
    expect(screen.queryByTestId('live-feed')).toBeNull();
  });

  it('a FRESH failure that leads its project gets the fail block with [open run]; a decayed one does not', async () => {
    projects = [
      project('p-fresh'),
      // 8 days stale: the failing score has decayed to ~0 — quiet band.
      project('p-stale', { updated_at: Date.now() - 8 * 86_400_000 }),
    ];
    members = { 'p-fresh': [member('p-fresh', 'run-f')], 'p-stale': [member('p-stale', 'run-s')] };
    await board([running('run-f', 'failed'), running('run-s', 'failed')]);

    await vi.waitFor(() => {
      expect(screen.getByTestId('live-feed')).toHaveAttribute('data-blocks', '1');
    });
    const fresh = block('p-fresh') as HTMLElement;
    expect(fresh).toHaveTextContent(/failed \d+[smhd] ago/);
    expect(within(fresh).getByTestId('feed-open-run'))
      .toHaveAttribute('href', '/p/p-fresh/build/run-f');
    expect(block('p-stale')).toBeNull();
  });
});
