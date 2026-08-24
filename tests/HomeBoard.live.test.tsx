import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocSummary } from '../src/api/interactive.js';
import type { CoreEvent, Project, ProjectMember, SessionStatus, SessionView } from '../src/api/types.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The board goes LIVE (DES-MERGE-001 §6.2 slice 6). These pin the ACs that do not
 * need a browser: a card updating in place from the shared runtime store while the
 * user sits on `/`, its neighbour left alone, a gate arrival re-sorting the board,
 * and a relayed interactive status landing on the owning project's card.
 *
 * Everything here goes through the store's real `ingest` — the same call `App`
 * makes for every `/ws` frame — so what is under test is the wiring, not a mock.
 */

let projects: Project[] = [];
let members: Record<string, ProjectMember[]> = {};
let docs: Record<string, DocSummary[]> = {};

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: members[id] ?? [] }),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: (id: string) => Promise.resolve(docs[id] ?? []),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

function project(id: string, name: string, over: Partial<Project> = {}): Project {
  return {
    id, name, description: null, status: 'active', scope: `project:${id}`,
    created_at: 1, updated_at: 1, ...over,
  };
}

function member(project_id: string, member_ref: string): ProjectMember {
  return {
    id: `${project_id}:crew.run:${member_ref}`, project_id, member_kind: 'crew.run',
    member_ref, meta: null, attached_at: 1, attached_by: 'studio',
  };
}

/** One in-flight run, on a unit whose phase + title is the rule-3 fallback line. */
const running = (id: string, status: SessionStatus = 'executing'): SessionView =>
  makeView({ id, status, unit_ix: 0 }, [makeUnit({ id: `${id}:u0`, session_id: id, ord: 0, stage: 'build', description: 'wire the board' })]);

const cardIds = (): (string | null)[] =>
  screen.getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));

const card = (id: string): HTMLElement =>
  document.querySelector(`[data-testid="project-card"][data-project-id="${id}"]`) as HTMLElement;

/** Push a frame the way `App` does: straight into the shared store's fold. */
const push = (event: CoreEvent): void => {
  act(() => { useRuntimeStore.getState().ingest(event); });
};

/** Slice 1 bands: quiet projects mount as cards only once QUIET is expanded, so
 *  "all cards mounted" is band-aware — expand the quiet band when it is there. */
async function expandQuiet(): Promise<void> {
  const toggle = screen.queryByTestId('band-quiet-toggle');
  if (toggle !== null) fireEvent.click(toggle);
  return Promise.resolve();
}

async function board(runs: SessionView[]): Promise<void> {
  render(<HomeBoard runs={runs} navigate={() => {}} />);
  await vi.waitFor(() => {
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', String(projects.length));
  });
  await expandQuiet();
  await vi.waitFor(() => {
    expect(screen.getAllByTestId('project-card')).toHaveLength(projects.length);
  });
}

describe('HomeBoard — live activity (slice 6)', () => {
  beforeEach(() => {
    projects = [];
    members = {};
    docs = {};
    useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {}, seq: 0 });
  });

  it('a unitOutputDelta for B updates B\'s headline in place and leaves A untouched', async () => {
    // Fresh `updated_at`: an executing run's clock is what ranks it (slice 1), and
    // the ACTIVE variant with the live line is what a NEEDS YOU card is (slice 2).
    projects = [project('p-a', 'Ay', { updated_at: Date.now() }), project('p-b', 'Bee', { updated_at: Date.now() })];
    members = { 'p-a': [member('p-a', 'run-a')], 'p-b': [member('p-b', 'run-b')] };
    await board([running('run-a'), running('run-b')]);

    // Before: both cards state their subject — since slice BA (DES-UX-002 §1.3)
    // an active-run card's subject is the current unit DESCRIPTION line (the
    // plan region), which replaces the generic `phase — title` narration
    // fallback; the live line renders only what genuinely streamed. No card is
    // ever blank, and neither says "Working…".
    const before = within(card('p-a')).getByTestId('active-unit-description').textContent;
    expect(before).toBe('wire the board');
    expect(within(card('p-a')).queryByTestId('live-line')).toBeNull();
    expect(within(card('p-b')).getByTestId('active-unit-description')).toHaveTextContent('wire the board');

    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'Writing the acceptance criteria for AC-3\n' } as CoreEvent);

    // The AC is "within 2s", not "synchronously": on a loaded runner the store->card
    // flush can land a beat after act() returns, so wait for it the way a user would.
    await vi.waitFor(() => {
      expect(within(card('p-b')).getByTestId('live-line'))
        .toHaveTextContent('build — Writing the acceptance criteria for AC-3');
    });
    // The AC's other half: the card the user was NOT looking at is unchanged —
    // still the plan-region subject, still no streamed line.
    expect(within(card('p-a')).getByTestId('active-unit-description').textContent).toBe(before);
    expect(within(card('p-a')).queryByTestId('live-line')).toBeNull();
  });

  it('keeps streaming: the newest line replaces the previous one, no scroll, no dump', async () => {
    projects = [project('p-b', 'Bee', { updated_at: Date.now() })];
    members = { 'p-b': [member('p-b', 'run-b')] };
    await board([running('run-b')]);

    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'Reading src/App.tsx\n' } as CoreEvent);
    push({ type: 'unitOutputDelta', session: 'run-b', ord: 0, text: 'Rewriting slide 3\n' } as CoreEvent);

    const line = within(card('p-b')).getByTestId('live-line');
    expect(line).toHaveTextContent('build — Rewriting slide 3');
    expect(line.textContent).not.toContain('Reading src/App.tsx');
  });

  it('a terminal run has no live line — the card is the QUIET one-liner, not "Nothing running"', async () => {
    projects = [project('p-done', 'Done')];
    members = { 'p-done': [member('p-done', 'run-done')] };
    await board([running('run-done', 'completed')]);

    expect(within(card('p-done')).queryByTestId('live-line')).toBeNull();
    // Slice 2's empty-state budget: absence is the ONE quiet-summary line.
    expect(card('p-done')).toHaveAttribute('data-variant', 'quiet');
    expect(within(card('p-done')).getAllByTestId('quiet-summary')).toHaveLength(1);
    expect(card('p-done')).not.toHaveTextContent('Nothing running');
  });

  it('a gate arrival re-sorts the board without remounting the unaffected card', async () => {
    // A sorts first while both are quiet (newer `updated_at` breaks the tie).
    projects = [project('p-a', 'Ay', { updated_at: 200 }), project('p-b', 'Bee', { updated_at: 100 })];
    members = { 'p-a': [member('p-a', 'run-a')], 'p-b': [member('p-b', 'run-b')] };
    const { rerender } = render(
      <HomeBoard runs={[running('run-a', 'completed'), running('run-b', 'completed')]} navigate={() => {}} />,
    );
    await vi.waitFor(() => expect(screen.queryByTestId('band-quiet-toggle')).not.toBeNull());
    await expandQuiet();
    await vi.waitFor(() => expect(cardIds()).toEqual(['p-a', 'p-b']));
    const untouched = card('p-a');

    // The gate lands: `useRuns` reconciles the run list, and attention re-sorts B first.
    rerender(
      <HomeBoard runs={[running('run-a', 'completed'), running('run-b', 'awaiting_human')]} navigate={() => {}} />,
    );

    await vi.waitFor(() => expect(cardIds()).toEqual(['p-b', 'p-a']));
    expect(card('p-b')).toHaveAttribute('data-attention', 'gate');
    // Slice 1 strengthens the claim: the gated card did not just sort first, it
    // moved INTO the NEEDS YOU band (a gate never decays, so it always leads).
    expect(within(screen.getByTestId('band-needs-you')).getByTestId('project-card'))
      .toHaveAttribute('data-project-id', 'p-b');
    // Keyed by project id, so the card that did not change is MOVED, not rebuilt —
    // which is what keeps a re-sort from throwing away the unaffected cards' state.
    expect(card('p-a')).toBe(untouched);
  });

  it('a relayed status.posted promotes the card to ACTIVE, adds a doc line and dates the tile', async () => {
    projects = [project('p-doc', 'Docs', { interactiveRoot: '/tmp/wi' })];
    docs = { 'p-doc': [{ name: 'launch-deck', kind: 'doc', head: 1, versions: 1, updated_at: null }] };
    await board([]);
    // Docs alone are a drafts nudge (D2): the card idles as the QUIET one-liner,
    // whose budget shows no tiles and no activity region (slice 2).
    expect(card('p-doc')).toHaveAttribute('data-variant', 'quiet');
    expect(within(card('p-doc')).queryByTestId('doc-tile')).toBeNull();

    push({
      type: 'interactiveEvent',
      event: {
        event_type: 'wicked.interactive.status.posted',
        payload: {
          project_id: 'p-doc',
          document_id: 'launch-deck',
          message: 'Rewriting slide 3 — tightening the headline',
        },
      },
    } as CoreEvent);

    // A doc being edited NOW is live work: the signal promotes the project into
    // NEEDS YOU, where the ACTIVE card carries the activity line and the tile.
    await vi.waitFor(() => {
      expect(card('p-doc')).toHaveAttribute('data-variant', 'active');
    });
    expect(within(card('p-doc')).getByTestId('doc-activity'))
      .toHaveTextContent('Rewriting slide 3 — tightening the headline');
    expect(screen.getByTestId('doc-tile')).toHaveTextContent('0s ago');
  });

  it('ignores a relayed status for a project that is not on this board', async () => {
    projects = [project('p-mine', 'Mine')];
    await board([]);

    push({
      type: 'interactiveEvent',
      event: { event_type: 'wicked.interactive.status.posted', payload: { project_id: 'p-other', message: 'elsewhere' } },
    } as CoreEvent);

    expect(within(card('p-mine')).queryByTestId('doc-activity')).toBeNull();
    expect(card('p-mine')).not.toHaveTextContent('elsewhere');
  });

  it('picks up a run attached after first paint — no reload to see a launched run', async () => {
    projects = [project('p-a', 'Ay', { updated_at: Date.now() })];
    const { rerender } = render(<HomeBoard runs={[]} navigate={() => {}} />);
    // A run-less project is quiet by construction (slice 1) — expand to its card,
    // which is the one-line QUIET variant (slice 2), never "No runs yet".
    await vi.waitFor(() => expect(screen.queryByTestId('band-quiet-toggle')).not.toBeNull());
    await expandQuiet();
    await vi.waitFor(() => expect(within(card('p-a')).getAllByTestId('quiet-summary')).toHaveLength(1));
    expect(card('p-a')).not.toHaveTextContent('No runs yet');

    // The run is launched and filed while the user sits on the board.
    members = { 'p-a': [member('p-a', 'run-new')] };
    rerender(<HomeBoard runs={[running('run-new')]} navigate={() => {}} />);

    await vi.waitFor(() => expect(within(card('p-a')).getByTestId('run-chip')).toHaveAttribute('data-run-id', 'run-new'));
    // Slice BA: the launched run's subject is the plan region's description
    // line (nothing has streamed yet — no generic narration fallback).
    expect(within(card('p-a')).getByTestId('active-unit-description')).toHaveTextContent('wire the board');
    expect(within(card('p-a')).getByTestId('phase-strip')).toBeInTheDocument();
  });
});
