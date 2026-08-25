import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as client from '../src/api/client.js';
import { ProjectDashboard } from '../src/components/ProjectDashboard.js';
import { RightPanel } from '../src/components/RightPanel.js';
import { canDeliver, deliverySummary } from '../src/components/delivery.js';
import { useDeliveryStore } from '../src/store/delivery.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useRunEventStore } from '../src/store/events.js';
import { useProvenanceStore } from '../src/store/provenance.js';
import { clearCachedWorkflows, isSystemWorkflowIn } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import {
  DOC_THREAD_RUN_IDS,
  LIVE_RUN_IDS,
  LIVE_WORKFLOWS,
  materialised,
} from './fixtures/workflows.js';
import { NOTHING_REASON, REAL_DELIVER_OUTPUT, REAL_PR_URL } from './fixtures/deliverOutput.js';
import type { Project, SessionView, UnitStatus } from '../src/api/types.js';

/**
 * THE MATERIALISED PER-RUN DEF (wicked-studio#122, D5 re-opened).
 *
 * The first `is_system` fix was measured against the live corpus and moved
 * NOTHING: byte-identical census output warm, cold, and with no lookup at all.
 * The reason is in `fixtures/workflows.ts` — **86 of the 129 live runs carry
 * `workflow_id: "wf-<their own runId>"`, a def `GET /workflows` never serves**,
 * so the lookup answers `undefined` for them permanently, `deliverKindOf` falls
 * through to the five-id denylist, and every one of them classified 'build'.
 * Thirty interactive document threads therefore rendered a Delivery section
 * whose whole body read "This run has no deliver phase.", and one project's
 * census line read, in full, `8 no deliver phase`.
 *
 * The rule, and every case in this file:
 *
 *  - a run WITH a deliver unit is shown and counted **whatever its workflow id
 *    is** — 5c5e08b7 opened a real PR under a materialised def, and gating that
 *    arm on the catalog would hide it;
 *  - a run WITHOUT one is shown and counted only when a def IN HAND says the
 *    workflow is ordinary (`is_system === false`) — the same licence the remedy
 *    line has always required. `undefined` is not a licence.
 *
 * Fixtures here are the REAL ids off the daemon, never synthetic
 * `feature`/`chat` ones: synthetic ids are exactly what let the last round ship
 * a zero-delta fix with a green suite.
 */

const KNOWN = (id: string): boolean | undefined => isSystemWorkflowIn(LIVE_WORKFLOWS, id);
const NOW = Date.now();

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a),
}));

/** A run on a MATERIALISED def whose deliver phase is in the given state. */
function delivering(id: string, status: UnitStatus, denial: string | null = null): SessionView {
  return makeView(
    {
      id, workflow_id: materialised(id), status: 'completed',
      problem: `problem of ${id}`, workdir: '/w/tree', project_id: 'proj-1',
    },
    [
      makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status, denial_reason: denial }),
    ],
  );
}

/**
 * A wicked-interactive DOCUMENT thread, as the wire carries them: a materialised
 * def, `:outline`/`:draft` units, no deliver phase anywhere.
 */
function docThread(id: string): SessionView {
  return makeView(
    {
      id, workflow_id: materialised(id), status: 'completed', workdir: '/w/tree',
      problem: `Produce the first draft of the wicked-interactive document "${id}"`,
      project_id: 'proj-1',
    },
    [
      makeUnit({ id: `${id}:outline`, session_id: id, ord: 0, status: 'done' }),
      makeUnit({ id: `${id}:draft`, session_id: id, ord: 1, status: 'done' }),
    ],
  );
}

/** A CATALOG build run with no deliver phase — the arm that keeps its section. */
function catalogPlain(id: string, workflow_id = 'feature'): SessionView {
  return makeView(
    { id, workflow_id, status: 'completed', problem: `problem of ${id}`, workdir: '/w/tree', project_id: 'proj-1' },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })],
  );
}

describe('the predicate, over the real corpus shapes', () => {
  it('a materialised def is unknown to the catalog — permanently, not while loading', () => {
    expect(LIVE_WORKFLOWS.some((w) => w.id === materialised(LIVE_RUN_IDS.prOpened))).toBe(false);
    expect(KNOWN(materialised(LIVE_RUN_IDS.prOpened))).toBeUndefined();
    // 86 of 129 live runs are this shape. It is the corpus, not an edge case.
    expect(materialised(LIVE_RUN_IDS.prOpened)).toBe(`wf-${LIVE_RUN_IDS.prOpened}`);
  });

  const states: { name: string; status: UnitStatus; denial: string | null }[] = [
    { name: 'delivered', status: 'done', denial: null },
    { name: 'nothing-to-deliver', status: 'rejected', denial: NOTHING_REASON },
    { name: 'failed', status: 'rejected', denial: 'the push was refused' },
    { name: 'in-flight (pending)', status: 'pending', denial: null },
    { name: 'in-flight (distributed)', status: 'distributed', denial: null },
  ];
  for (const s of states) {
    it(`a materialised run WITH a deliver unit (${s.name}) stays deliverable — lookup or not`, () => {
      const view = delivering(LIVE_RUN_IDS.prOpened, s.status, s.denial);
      expect(canDeliver(view, KNOWN), 'warm cache').toBe(true);
      expect(canDeliver(view, () => undefined), 'cold cache').toBe(true);
      expect(canDeliver(view), 'no lookup at all').toBe(true);
    });
  }

  it('a materialised run with NO deliver unit is withheld in every cache state', () => {
    const view = docThread(DOC_THREAD_RUN_IDS[0]);
    expect(canDeliver(view, KNOWN), 'warm cache — still unknown, because it is not a catalog def').toBe(false);
    expect(canDeliver(view, () => undefined)).toBe(false);
    expect(canDeliver(view)).toBe(false);
  });

  it('a CATALOG non-system workflow with no deliver unit keeps its section', () => {
    expect(KNOWN('feature')).toBe(false);
    expect(canDeliver(catalogPlain('r-feature'), KNOWN)).toBe(true);
    // …but only with the def in hand. Before it lands, studio cannot say so.
    expect(canDeliver(catalogPlain('r-feature'), () => undefined)).toBe(false);
  });

  it('a CATALOG is_system workflow with no deliver unit is withheld, as before', () => {
    expect(KNOWN('interactive-draft')).toBe(true);
    expect(canDeliver(catalogPlain('r-draft', 'interactive-draft'), KNOWN)).toBe(false);
  });

  it('THE CENSUS: the eight document threads stop being a delivery finding', () => {
    const threads = DOC_THREAD_RUN_IDS.map(docThread);
    expect(threads).toHaveLength(8);
    // The live line, verbatim, before: a count of documents in a delivery census.
    expect(deliverySummary(threads, KNOWN)).toBe('');
    expect(deliverySummary(threads)).toBe('');
  });

  it('…while the runs that DID deliver are all still counted', () => {
    const line = deliverySummary(
      [
        delivering(LIVE_RUN_IDS.prOpened, 'done'),
        delivering(LIVE_RUN_IDS.deliverRan, 'done'),
        delivering('r-pending', 'pending'),
        ...DOC_THREAD_RUN_IDS.map(docThread),
      ],
      KNOWN,
    );
    expect(line).toBe('2 ran deliver · 1 deliver pending');
    expect(line).not.toContain('no deliver phase');
  });
});

describe('the rail (RightPanel)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearCachedWorkflows();
    useRunEventStore.setState({ byRun: {} });
    useDeliveryStore.setState({ byRun: {} });
    useProvenanceStore.setState({ byRun: {}, launchedHere: {} });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
    vi.spyOn(client.api, 'getAudit').mockResolvedValue({ entries: [] });
    vi.spyOn(client.api, 'getRun').mockImplementation((id: string) =>
      Promise.resolve({ run: docThread(id) }),
    );
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: REAL_DELIVER_OUTPUT });
  });
  afterEach(() => { cleanup(); clearCachedWorkflows(); });

  it('a document thread gets NO Delivery section — not before the defs land, not after', async () => {
    render(<RightPanel view={docThread(DOC_THREAD_RUN_IDS[0])} />);
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();

    // The defs land and change nothing: this id is in no catalog, ever.
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    await Promise.resolve();
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-delivery')).not.toBeInTheDocument();
    // The sentence that used to be there, about a run studio cannot classify.
    expect(document.body.textContent).not.toContain('This run has no deliver phase.');
  });

  it('5c5e08b7 — a materialised def that opened a REAL PR — keeps its section and its link', async () => {
    render(<RightPanel view={delivering(LIVE_RUN_IDS.prOpened, 'done')} />);

    // Present from the first paint: the deliver unit is the licence, not a def.
    const header = screen.getByRole('button', { name: /Delivery/ });
    expect(screen.getByTestId('run-delivery-badge')).toHaveTextContent('deliver ran');

    fireEvent.click(header);
    const link = await screen.findByTestId('run-delivery-link');
    expect(link).toHaveAttribute('href', REAL_PR_URL);
    expect(screen.getByTestId('run-delivery')).toHaveAttribute('data-state', 'pr-open');
  });

  it('665a9aeb still reads "deliver ran" — the phase, on a def no catalog carries', () => {
    render(<RightPanel view={delivering(LIVE_RUN_IDS.deliverRan, 'done')} />);

    const badge = screen.getByTestId('run-delivery-badge');
    expect(badge).toHaveAttribute('data-state', 'delivered');
    expect(badge).toHaveTextContent('deliver ran');
    expect(badge.textContent).not.toMatch(/\bPR\b/);
  });

  it('every delivering state keeps its section on a materialised def', () => {
    for (const [i, s] of ([
      ['done', null], ['rejected', NOTHING_REASON], ['rejected', 'the push was refused'],
      ['pending', null], ['distributed', null],
    ] as [UnitStatus, string | null][]).entries()) {
      render(<RightPanel view={delivering(`r-state-${i}`, s[0], s[1])} />);
      expect(screen.getByRole('button', { name: /Delivery/ }), `state ${s[0]}`).toBeInTheDocument();
      cleanup();
    }
  });

  it('a CATALOG feature run gets its section back once the defs land, remedy included', async () => {
    render(<RightPanel view={catalogPlain('r-feature-late')} />);
    // Cold: nothing is proven, so nothing is claimed — including the section.
    expect(screen.queryByRole('button', { name: /Delivery/ })).not.toBeInTheDocument();

    const header = await screen.findByRole('button', { name: /Delivery/ });
    fireEvent.click(header);
    const body = await screen.findByTestId('run-delivery');
    expect(body).toHaveAttribute('data-state', 'none');
    expect(body).toHaveTextContent('This run has no deliver phase.');
    expect(body).toHaveTextContent('launch with deliver: pr');
  });
});

describe('the project census surface', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearCachedWorkflows();
    listDocs.mockReset().mockResolvedValue([]);
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: LIVE_WORKFLOWS });
    vi.spyOn(client.api, 'listProjectMembers').mockResolvedValue({ members: [] });
    vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
    useGateStore.setState({ gates: {} });
    useRunEventStore.setState({ byRun: {} });
    useProjectsStore.setState({
      projects: [{
        id: 'proj-1', name: 'The proof project', description: null, status: 'active',
        scope: 'project:proj-1', created_at: NOW - 1000, updated_at: NOW - 100,
      } as Project],
      loading: false,
      error: null,
    });
  });
  afterEach(() => { cleanup(); clearCachedWorkflows(); });

  it('proj_178674023693500000: eight document threads, and NO census line at all', async () => {
    render(
      <ProjectDashboard projectId="proj-1" runs={DOC_THREAD_RUN_IDS.map(docThread)} navigate={() => {}} />,
    );

    await screen.findByTestId('dashboard-runs');
    expect(screen.getAllByTestId('dashboard-run').length).toBeGreaterThan(0);
    // Was: "8 no deliver phase" — the D5 complaint at 100% of the line.
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalled());
    expect(screen.queryByTestId('dashboard-delivery-summary')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('no deliver phase');
  });

  it('a mixed project still censuses everything that has a deliver phase', async () => {
    render(
      <ProjectDashboard
        projectId="proj-1"
        runs={[
          delivering(LIVE_RUN_IDS.prOpened, 'done'),
          delivering(LIVE_RUN_IDS.deliverRan, 'done'),
          delivering('r-inflight', 'pending'),
          ...DOC_THREAD_RUN_IDS.map(docThread),
        ]}
        navigate={() => {}}
      />,
    );

    const summary = await screen.findByTestId('dashboard-delivery-summary');
    expect(summary.textContent).toStrictEqual('2 ran deliver · 1 deliver pending');
  });

  it('D2: a row chips only what the rail would open — and reads no defs of its own', async () => {
    const runs = [
      delivering('r-chip-done', 'done'),
      delivering('r-chip-empty', 'rejected', NOTHING_REASON),
      delivering('r-chip-pending', 'pending'),
      ...DOC_THREAD_RUN_IDS.slice(0, 3).map(docThread),
    ];
    render(<ProjectDashboard projectId="proj-1" runs={runs} navigate={() => {}} />);

    const rows = await screen.findAllByTestId('dashboard-run');
    for (const row of rows) {
      const id = row.getAttribute('data-run-id') ?? '';
      const view = runs.find((v) => v.session.id === id) as SessionView;
      const chip = within(row).queryByTestId('run-delivery-chip');
      // The invariant: nothing may be chipped that the section itself withholds.
      if (chip !== null) expect(canDeliver(view, KNOWN), `${id} chipped`).toBe(true);
    }
    // …and the whole surface still costs ONE /workflows, zero per row.
    await waitFor(() => expect(client.api.listWorkflows).toHaveBeenCalledTimes(1));
    expect(client.api.listWorkflows).toHaveBeenCalledTimes(1);
  });
});
