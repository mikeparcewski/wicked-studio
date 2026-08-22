import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DocSummary } from '../src/api/interactive.js';
import type { CoreEvent, Project, ProjectMember, SessionView } from '../src/api/types.js';
import { useGateStore } from '../src/store/gates.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { makeView } from './factories.js';

/**
 * The NEEDS YOU / QUIET bands over the W2 messy-reality fixture (DES-UXFIX-001
 * §4.2, slice-1 DOM AC): the 8-day failure does NOT lead, the live run does, a
 * gate leads regardless of age, drafts never leave QUIET, and the quiet band is
 * collapsed by default. The fixture shape is §4.2's table, ages computed from a
 * frozen `now`.
 */

let projects: Project[] = [];
let members: Record<string, ProjectMember[]> = {};
let docs: Record<string, DocSummary[]> = {};
let runEvents: Record<string, CoreEvent[]> = {};

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: members[id] ?? [] }),
    getRunEvents: (id: string) => Promise.resolve({ events: runEvents[id] ?? [] }),
  },
}));

vi.mock('../src/api/interactive.js', () => ({
  listDocs: (id: string) => Promise.resolve(docs[id] ?? []),
}));

const { HomeBoard } = await import('../src/components/HomeBoard.js');

const SEC = 1_000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function project(id: string, updated_at: number, over: Partial<Project> = {}): Project {
  return {
    id, name: id, description: null, status: 'active', scope: `project:${id}`,
    created_at: 1, updated_at, ...over,
  };
}

function member(project_id: string, member_ref: string): ProjectMember {
  return {
    id: `${project_id}:crew.run:${member_ref}`, project_id, member_kind: 'crew.run',
    member_ref, meta: null, attached_at: 1, attached_by: 'studio',
  };
}

function doc(name: string, at: number): DocSummary {
  return { name, kind: 'doc', head: 1, versions: 1, updated_at: new Date(at).toISOString() };
}

/** §4.2's rows, ages relative to `now`. Returns the run list the board receives. */
function seedW2(now: number): SessionView[] {
  projects = [
    // Touched an HOUR ago but failed 8 DAYS ago — the ladder's durable-log tail
    // (D3 step 2) must beat the fresh `updated_at` fallback, or this row leads.
    project('legacy-spike', now - HOUR),
    project('upload-endpoint', now),
    project('q3-review-deck', now - 30 * SEC),
    project('api-migration', now - 2 * MIN),
    project('auth-refactor', now - 12 * MIN),
    project('smoke-tests', now - 6 * DAY),
    project('notes', now - 2 * DAY, { interactiveRoot: '/tmp/wi' }),
    project('scratch', now),
  ];
  members = {
    'legacy-spike': [member('legacy-spike', 'r-legacy')],
    'upload-endpoint': [member('upload-endpoint', 'r-upload')],
    'q3-review-deck': [member('q3-review-deck', 'r-q3')],
    'api-migration': [member('api-migration', 'r-api')],
    'auth-refactor': [member('auth-refactor', 'r-auth')],
    'smoke-tests': [member('smoke-tests', 'r-smoke')],
  };
  docs = { notes: [doc('ideas', now - 2 * DAY), doc('todo', now - 3 * DAY)] };
  runEvents = {
    'r-legacy': [{ type: 'sessionFailed', session: 'r-legacy', ts: now - 8 * DAY }],
    'r-auth': [{ type: 'sessionFailed', session: 'r-auth', ts: now - 12 * MIN }],
  };
  useGateStore.setState({
    gates: {
      'r-q3': { runId: 'r-q3', ord: 0, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: now - 30 * SEC },
      'r-api': { runId: 'r-api', ord: 0, prompt: 'Pick a migration', lifecycle: 'open', receivedAt: now - 2 * MIN, choices: null },
    },
  });
  return [
    makeView({ id: 'r-legacy', status: 'failed' }),
    makeView({ id: 'r-upload', status: 'executing' }),
    makeView({ id: 'r-q3', status: 'awaiting_human' }),
    makeView({ id: 'r-api', status: 'awaiting_human' }),
    makeView({ id: 'r-auth', status: 'failed' }),
    makeView({ id: 'r-smoke', status: 'completed' }),
  ];
}

const needsYouIds = (): (string | null)[] =>
  [...screen.getByTestId('band-needs-you').querySelectorAll('[data-testid="project-card"]')]
    .map((c) => c.getAttribute('data-project-id'));

async function board(runs: SessionView[], expectedTotal = projects.length): Promise<void> {
  render(<HomeBoard runs={runs} navigate={() => {}} />);
  await vi.waitFor(() => {
    expect(screen.getByTestId('project-board')).toHaveAttribute('data-total', String(expectedTotal));
  });
}

describe('HomeBoard — NEEDS YOU / QUIET bands (slice 1)', () => {
  beforeEach(() => {
    projects = [];
    members = {};
    docs = {};
    runEvents = {};
    useGateStore.setState({ gates: {} });
    useRuntimeStore.setState({ outputs: {}, logs: {}, deltaSeq: {}, docActivity: {}, seq: 0 });
  });
  afterEach(cleanup);

  it('the 8d failure is NOT in NEEDS YOU and the live run IS — the F3 proof in the DOM', async () => {
    const runs = seedW2(Date.now());
    await board(runs);

    // The demotion waits on the durable-log backfill (D3 step 2): once the 8-day
    // `ts` lands, legacy-spike falls out of the live band despite its fresh
    // `updated_at` — exactly the trap R3 names.
    await vi.waitFor(() => {
      expect(screen.getByTestId('band-quiet')).toBeTruthy();
      expect(
        within(screen.getByTestId('band-quiet')).getByText('legacy-spike', { exact: false }),
      ).toBeTruthy();
    });
    expect(needsYouIds()).not.toContain('legacy-spike');
    expect(needsYouIds()).toContain('upload-endpoint');

    // Its card (mounted once QUIET expands) carries the decay verdict.
    fireEvent.click(screen.getByTestId('band-quiet-toggle'));
    const legacy = document.querySelector('[data-testid="project-card"][data-project-id="legacy-spike"]');
    expect(legacy).not.toBeNull();
    expect(legacy).toHaveAttribute('data-band', 'quiet');
    expect(legacy).toHaveAttribute('data-signal', 'failing');
  });

  it('orders NEEDS YOU by decayed score: gates, then the fresh failure, then the live run', async () => {
    const runs = seedW2(Date.now());
    await board(runs);

    await vi.waitFor(() => {
      expect(needsYouIds()).toEqual([
        'q3-review-deck',   // gate, 30s — no decay
        'api-migration',    // gate, 2m — no decay, older than q3
        'auth-refactor',    // failing, 12m — ≈67.6, still urgent
        'upload-endpoint',  // running now — 40
      ]);
    });
    // The band boundary, off the DOM: nothing below the threshold leads, nothing
    // above it hides (slice-1 AC / §5.5 assertion 6).
    const cards = [...document.querySelectorAll('[data-testid="project-card"]')];
    for (const c of cards) {
      const score = Number(c.getAttribute('data-score'));
      const inBand = c.closest('[data-testid="band-needs-you"]') !== null;
      expect(inBand).toBe(score >= 20);
    }
  });

  it('a gate leads regardless of age — even one older than the failure it outranks', async () => {
    const now = Date.now();
    projects = [project('ancient-gate', now - 8 * DAY), project('fresh-failure', now - 12 * MIN)];
    members = {
      'ancient-gate': [member('ancient-gate', 'r-gate')],
      'fresh-failure': [member('fresh-failure', 'r-fail')],
    };
    runEvents = { 'r-fail': [{ type: 'sessionFailed', session: 'r-fail', ts: now - 12 * MIN }] };
    useGateStore.setState({
      gates: {
        'r-gate': { runId: 'r-gate', ord: 0, prompt: 'Still waiting…', lifecycle: 'open', receivedAt: now - 8 * DAY },
      },
    });
    await board([
      makeView({ id: 'r-gate', status: 'awaiting_human' }),
      makeView({ id: 'r-fail', status: 'failed' }),
    ]);

    await vi.waitFor(() => {
      expect(needsYouIds()).toEqual(['ancient-gate', 'fresh-failure']);
    });
    // Scoped to the CARD: slice Q's river lanes above the wall carry the same
    // data-project-id (the card itself is unchanged — C3/C6).
    const gateCard = document.querySelector('[data-testid="project-card"][data-project-id="ancient-gate"]');
    expect(gateCard).toHaveAttribute('data-score', '100.00');
    expect(gateCard).toHaveAttribute('data-signal', 'gate');
  });

  it('drafts are a nudge, never a demand: notes (2 docs, 2d) sits in QUIET', async () => {
    const runs = seedW2(Date.now());
    await board(runs);

    await vi.waitFor(() => {
      expect(
        within(screen.getByTestId('band-quiet')).getByText('notes', { exact: false }),
      ).toBeTruthy();
    });
    expect(needsYouIds()).not.toContain('notes');
  });

  it('QUIET is collapsed by default; its cards mount only after the toggle', async () => {
    const runs = seedW2(Date.now());
    await board(runs);
    await vi.waitFor(() => expect(screen.getByTestId('band-quiet')).toHaveAttribute('data-expanded', 'false'));

    const quietCards = (): number =>
      screen.getByTestId('band-quiet').querySelectorAll('[data-testid="project-card"]').length;
    expect(quietCards()).toBe(0);
    // Collapsed, the calm majority is one demoted line each — the preview chips.
    expect(screen.getAllByTestId('quiet-chip').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('band-quiet-toggle'));
    expect(screen.getByTestId('band-quiet')).toHaveAttribute('data-expanded', 'true');
    await vi.waitFor(() => expect(quietCards()).toBeGreaterThan(0));

    fireEvent.click(screen.getByTestId('band-quiet-toggle'));
    expect(quietCards()).toBe(0);
  });

  it('with every project quiet, the board states it and no card leads', async () => {
    const now = Date.now();
    projects = [project('sleepy', now - 3 * DAY), project('dormant', now - 5 * DAY)];
    await board([]);

    expect(screen.getByTestId('board-all-quiet')).toHaveTextContent('Nothing needs you right now.');
    expect(screen.getByTestId('band-needs-you').querySelectorAll('[data-testid="project-card"]')).toHaveLength(0);
    expect(screen.getAllByTestId('quiet-chip')).toHaveLength(2);
  });

  it('the synthesized "default" project never renders — as a card, a chip, or a count (F5)', async () => {
    const now = Date.now();
    projects = [
      project('default', now, { name: 'Unfiled', scope: '' }),
      project('real-work', now - 3 * DAY),
    ];
    // `data-total` means non-default projects (unchanged meaning) — 1, not 2.
    await board([], 1);
    fireEvent.click(screen.getByTestId('band-quiet-toggle'));
    expect(document.querySelector('[data-project-id="default"]')).toBeNull();
    // V18: the word "Unfiled" appears nowhere on this surface.
    expect(screen.queryByText(/Unfiled/)).toBeNull();
  });

  it('the shelf is absent with nothing unfiled, and last + collapsed with one orphan run', async () => {
    const now = Date.now();
    projects = [project('filed', now)];
    members = { filed: [member('filed', 'r-filed')] };

    // Every run claimed ⇒ no shelf in the DOM at all.
    await board([makeView({ id: 'r-filed', status: 'executing' })]);
    await vi.waitFor(() => {
      expect(document.querySelector('[data-project-id="filed"]')).not.toBeNull();
    });
    expect(screen.queryByTestId('band-not-in-project')).toBeNull();
    cleanup();

    // One orphan ⇒ the shelf exists: LAST in document order, collapsed, counted.
    await board([
      makeView({ id: 'r-filed', status: 'executing' }),
      makeView({ id: 'r-orphan', status: 'executing', problem: 'stranded work' }),
    ]);
    const shelf = await screen.findByTestId('band-not-in-project');
    expect(shelf).toHaveAttribute('data-count', '1');
    expect(shelf).toHaveAttribute('data-expanded', 'false');
    expect(screen.queryByTestId('unfiled-run')).toBeNull();
    const boardEl = screen.getByTestId('project-board');
    expect(boardEl.lastElementChild).toBe(shelf);

    fireEvent.click(screen.getByTestId('band-not-in-project-toggle'));
    expect(screen.getByTestId('unfiled-run')).toHaveAttribute('data-run-id', 'r-orphan');
  });

  it('the 60s tick demotes a running project silent for a half-life — no new data needed', async () => {
    vi.useFakeTimers();
    try {
      const t0 = Date.now();
      projects = [project('silent', t0)];
      members = { silent: [member('silent', 'r-silent')] };
      render(
        <HomeBoard runs={[makeView({ id: 'r-silent', status: 'executing' })]} navigate={() => {}} />,
      );
      // Flush the project + binding loads (microtask chains, no timers involved).
      for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); });
      expect(needsYouIds()).toEqual(['silent']);

      // 31 minutes of narration silence: one half-life past 40 → ~19.5, under the
      // threshold. The tick alone must carry the card out of the live band (D7).
      await act(async () => { vi.advanceTimersByTime(31 * MIN); });
      expect(needsYouIds()).toEqual([]);
      expect(screen.getByTestId('quiet-chip')).toHaveAttribute('data-project-id', 'silent');
      expect(screen.getByTestId('board-all-quiet')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
