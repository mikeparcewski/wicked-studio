import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DocSummary } from '../src/api/interactive.js';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The orchestrator board (DES-MERGE-001 §1.4, slice 5). These cases pin the four
 * ACs of §6.2 slice 5 that do not need a browser: attention order, the empty card
 * being the four quick actions, placeholder-only doc tiles (§7.5), and the board
 * windowing so 20 projects do not mount 20 cards.
 */

let projects: Project[] = [];
let members: Record<string, ProjectMember[]> = {};
let docs: Record<string, DocSummary[]> = {};

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos: [{ id: 'repo-1', name: 'wicked-studio' }] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: members[id] ?? [] }),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: (id: string) => Promise.resolve(docs[id] ?? []),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

function project(over: Partial<Project> & { id: string; name: string }): Project {
  return {
    description: null,
    status: 'active',
    scope: `project:${over.id}`,
    created_at: 1,
    updated_at: 1,
    ...over,
  };
}

function member(project_id: string, member_kind: string, member_ref: string): ProjectMember {
  return {
    id: `${project_id}:${member_kind}:${member_ref}`,
    project_id,
    member_kind,
    member_ref,
    meta: null,
    attached_at: 1,
    attached_by: 'studio',
  };
}

/** Wait for the async project + member + doc loads to settle into the board. */
async function boardWith(runs = [] as ReturnType<typeof makeView>[]): Promise<void> {
  render(<HomeBoard runs={runs} navigate={() => {}} />);
  await screen.findByTestId('project-board');
  // The bindings (members/docs) land one microtask-chain after the projects do.
  await vi.waitFor(() => {
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', String(projects.length));
  });
}

/** Slice 1 bands: a quiet project's CARD mounts only once QUIET is expanded. */
async function expandQuiet(): Promise<void> {
  await userEvent.setup().click(await screen.findByTestId('band-quiet-toggle'));
}

describe('HomeBoard — the orchestrator board', () => {
  beforeEach(() => {
    projects = [];
    members = {};
    docs = {};
  });

  it('sorts by attention: gate-waiting before running before empty', async () => {
    projects = [
      project({ id: 'p-quiet', name: 'Quiet' }),
      // Under decay (DES-UXFIX-001 §2.1.3) a live run's clock is what ranks it, so
      // the fixture is honest about it: a project executing NOW was touched now.
      project({ id: 'p-run', name: 'Running', updated_at: Date.now() }),
      project({ id: 'p-gate', name: 'Gated' }),
    ];
    members = {
      'p-gate': [member('p-gate', 'crew.run', 'run-gate')],
      'p-run': [member('p-run', 'crew.run', 'run-exec')],
    };
    await boardWith([
      makeView({ id: 'run-exec', status: 'executing' }),
      makeView({ id: 'run-gate', status: 'awaiting_human' }),
    ]);

    // Slice 1 bands: the projects that need a human are CARDS inside NEEDS YOU,
    // score-ordered; the quiet one is a one-line preview chip, not a card.
    await vi.waitFor(() => {
      const band = screen.getByTestId('band-needs-you');
      const cards = within(band).getAllByTestId('project-card');
      expect(cards.map((c) => c.getAttribute('data-project-id'))).toEqual(['p-gate', 'p-run']);
    });
    expect(screen.getByTestId('quiet-chip')).toHaveAttribute('data-project-id', 'p-quiet');
    // AC: the first card IS the gate-waiting one, and says so.
    const first = screen.getAllByTestId('project-card')[0];
    expect(first).toHaveAttribute('data-attention', 'gate');
    expect(first).toHaveAttribute('data-band', 'needs-you');
    expect(first).toHaveTextContent('gate');
  });

  it('a brand-new project is ONE invitation line + four differentiated actions (slice 2)', async () => {
    // "Just created" is literal (§2.1.2): the invitation needs a fresh created_at.
    projects = [project({ id: 'p-empty', name: 'Empty', created_at: Date.now() })];
    await boardWith();
    // An empty project is quiet by construction now (slice 1) — expand to reach its card.
    await expandQuiet();

    const card = await screen.findByTestId('project-card');
    expect(card).toHaveAttribute('data-variant', 'quiet');
    const actions = within(card).getAllByTestId('quick-action');
    expect(actions).toHaveLength(4);
    expect(actions.map((a) => a.getAttribute('data-mode'))).toEqual(['chat', 'build', 'document', 'video']);
    // Each launches INTO that project, pre-bound to a slice-4 mode route.
    expect(actions.map((a) => a.getAttribute('href'))).toEqual([
      '/p/p-empty/chat', '/p/p-empty/build', '/p/p-empty/document', '/p/p-empty/video',
    ]);
    // The empty-state budget (§2.1.2): ONE line — the first-run invitation — and
    // never a region of "nothing".
    const summaries = within(card).getAllByTestId('quiet-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent('Start by describing what you want');
    expect(card).not.toHaveTextContent('No documents yet');
    expect(card).not.toHaveTextContent('Nothing running');
    expect(card).not.toHaveTextContent('No runs yet');
    // First-run is where the sublabels teach what each verb PRODUCES (§2.2, F2).
    const sublabels = within(card).getAllByTestId('quick-action-sublabel');
    expect(sublabels.map((s) => s.textContent)).toEqual([
      'think out loud with an agent', 'ship code, with checks',
      'a deck, page, or report', 'record a demo',
    ]);
  });

  it('a quick action navigates into the project shell', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    projects = [project({ id: 'p-1', name: 'One' })];
    render(<HomeBoard runs={[]} navigate={navigate} />);
    await expandQuiet();

    const card = await screen.findByTestId('project-card');
    await user.click(within(card).getByText('Build'));
    expect(navigate).toHaveBeenCalledWith('/p/p-1/build');
  });

  it('doc tiles are PLACEHOLDERS — title, kind glyph, updated-at, never an iframe (§7.5)', async () => {
    // Tiles live on the ACTIVE variant (slice 2): a live run puts the card in
    // NEEDS YOU, and the docs it carries render as placeholder tiles there.
    projects = [project({ id: 'p-docs', name: 'Docs', interactiveRoot: '/tmp/wi', updated_at: Date.now() })];
    members = { 'p-docs': [member('p-docs', 'crew.run', 'run-docs')] };
    docs = {
      'p-docs': [
        { name: 'launch-deck', kind: 'doc', head: 2, versions: 2, updated_at: new Date(Date.now() - 3600_000).toISOString() },
        { name: 'demo-reel', kind: 'demo', head: 1, versions: 1, updated_at: null },
        { name: 'brief', kind: 'doc', head: 1, versions: 1, updated_at: null },
        { name: 'overflow-one', kind: 'doc', head: 1, versions: 1, updated_at: null },
      ],
    };
    await boardWith([makeView({ id: 'run-docs', status: 'executing' })]);

    const card = await screen.findByTestId('project-card');
    await vi.waitFor(() => expect(within(card).getAllByTestId('doc-tile')).toHaveLength(3));
    expect(card).toHaveAttribute('data-variant', 'active');
    expect(within(card).getByTestId('doc-overflow')).toHaveTextContent('1 more');
    expect(card).toHaveTextContent('launch-deck');
    expect(card).toHaveTextContent('1h ago');
    expect(card.querySelector('iframe')).toBeNull();
  });

  it('does not ask the interactive bridge about a project with no interactive root', async () => {
    projects = [project({ id: 'p-none', name: 'None' })];
    docs = { 'p-none': [{ name: 'never-shown', kind: 'doc', head: 1, versions: 1, updated_at: null }] };
    await boardWith();
    await expandQuiet();

    const card = await screen.findByTestId('project-card');
    expect(within(card).queryByTestId('doc-tile')).toBeNull();
    expect(card).not.toHaveTextContent('never-shown');
    // Slice 2: absence is the one quiet line, never a "No documents yet" region.
    expect(within(card).getAllByTestId('quiet-summary')).toHaveLength(1);
    expect(card).not.toHaveTextContent('No documents yet');
  });

  it('windows the grid: what is mounted is bounded by the viewport, not by the project count', async () => {
    const seed = (n: number): void => {
      projects = Array.from({ length: n }, (_, i) =>
        project({ id: `p-${i}`, name: `Project ${i}`, updated_at: 100 - i }),
      );
    };

    // Twenty quiet projects mount as CHIPS while collapsed (a capped preview strip),
    // and as a WINDOWED grid once expanded. Slice-2 quiet cards are one line tall,
    // so 20 may genuinely fit the viewport — the invariant is about the CEILING.
    seed(20);
    await boardWith();
    expect(screen.getAllByTestId('quiet-chip').length).toBeLessThan(20);
    await expandQuiet();
    const at20 = screen.getAllByTestId('project-card').length;
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', '20');
    expect(at20).toBeGreaterThan(0);
    expect(at20).toBeLessThanOrEqual(20);
    cleanup();

    // Tripling the board does NOT triple what is mounted — what mounts is bounded
    // by the viewport's row capacity (plus overscan), never by the project count.
    // That is the whole point of windowing; it keeps 20+ cards legible (§1.4).
    seed(60);
    await boardWith();
    await expandQuiet();
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', '60');
    const at60 = screen.getAllByTestId('project-card').length;
    expect(at60).toBeLessThan(30);
  });

  it('states what is missing rather than showing a blank board', async () => {
    await boardWith();
    expect(screen.getByTestId('project-board')).toHaveTextContent('No projects yet');
    expect(screen.getByTestId('create-first-project')).toBeTruthy();
  });
});
