import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ProjectDashboard } from '../src/components/ProjectDashboard.js';
import { CenterDashboard } from '../src/components/CenterDashboard.js';
import { useGateStore } from '../src/store/gates.js';
import { useProjectsStore } from '../src/store/projects.js';
import { useRunEventStore } from '../src/store/events.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { makeUnit, makeView } from './factories.js';
import { LIVE_WORKFLOWS, SYSTEM_IDS } from './fixtures/workflows.js';
import type { Project, SessionView } from '../src/api/types.js';

/**
 * THE REQUEST BUDGET (wicked-studio#122 D-1), load-bearing.
 *
 * `is_system` is app-level reference data, so reading it must cost the app ONE
 * request — never one per run. A list surface rendering 120 rows fires at most
 * a single `GET /workflows` and ZERO per-row requests; the row chips read no
 * defs at all, and a second list surface mounting after it fires none, because
 * the cache is module state, not component state.
 *
 * Everything is counted at the client boundary — one `vi.fn` per api method,
 * plus a global `fetch` counter for the raw-transport call `client.ts:103`
 * makes (EC58's budget was asserted there, and this file keeps that).
 */

/** One counter per api method — `vi.hoisted` so the mock factory can see it. */
const calls = vi.hoisted(() => ({
  listWorkflows: vi.fn(),
  listProjectMembers: vi.fn(),
  listProjects: vi.fn(),
  listRepos: vi.fn(),
  getUnitOutput: vi.fn(),
  getRun: vi.fn(),
  getAudit: vi.fn(),
  confirmGate: vi.fn(),
  injectMessage: vi.fn(),
}));

vi.mock('../src/api/client.js', () => ({ api: calls }));

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a),
}));

const NOW = Date.now();
let fetchSpy: ReturnType<typeof vi.fn>;

function project(id: string): Project {
  return {
    id, name: `The ${id} project`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 1000, updated_at: NOW - 100,
  };
}

/**
 * 120 runs: 60 build runs that ran a deliver phase, and 60 spread across every
 * one of the eleven real system workflows — the ids the denylist could not see.
 */
function corpus(): SessionView[] {
  const build = Array.from({ length: 60 }, (_, i) =>
    makeView(
      { id: `b-${i}`, workflow_id: 'feature', status: 'completed', problem: `build ${i}`, project_id: 'proj-1' },
      [
        makeUnit({ id: `b-${i}:build`, session_id: `b-${i}`, ord: 0, status: 'done' }),
        makeUnit({ id: `b-${i}:deliver`, session_id: `b-${i}`, ord: 1, status: 'done' }),
      ],
    ),
  );
  const system = Array.from({ length: 60 }, (_, i) =>
    makeView(
      {
        id: `s-${i}`, workflow_id: SYSTEM_IDS[i % SYSTEM_IDS.length] as string,
        status: 'completed', problem: `system ${i}`, project_id: 'proj-1',
      },
      [makeUnit({ id: `s-${i}:build`, session_id: `s-${i}`, ord: 0, status: 'done' })],
    ),
  );
  return [...build, ...system];
}

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.listWorkflows.mockResolvedValue({ workflows: LIVE_WORKFLOWS });
  calls.listProjectMembers.mockResolvedValue({ members: [] });
  calls.listProjects.mockResolvedValue({ projects: [] });
  calls.listRepos.mockResolvedValue({ repos: [] });
  calls.getAudit.mockResolvedValue({ entries: [] });
  calls.confirmGate.mockResolvedValue({});
  calls.injectMessage.mockResolvedValue({});
  listDocs.mockReset().mockResolvedValue([]);
  clearCachedWorkflows();
  useGateStore.setState({ gates: {} });
  useRunEventStore.setState({ byRun: {} });
  useProjectsStore.setState({ projects: [project('proj-1')], loading: false, error: null });
  fetchSpy = vi.fn().mockRejectedValue(new Error('no raw request should reach the wire'));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearCachedWorkflows(); });

describe('120 runs, ONE workflows request', () => {
  it('the project page: 1 × /workflows, 0 per run', async () => {
    const runs = corpus();
    render(<ProjectDashboard projectId="proj-1" runs={runs} navigate={() => {}} />);
    await screen.findByTestId('dashboard-delivery-summary');

    expect(runs).toHaveLength(120);
    expect(calls.listWorkflows, 'ONE /workflows for the whole surface').toHaveBeenCalledTimes(1);
    expect(calls.getUnitOutput, 'zero per-run transcript reads').toHaveBeenCalledTimes(0);
    expect(calls.getRun, 'zero per-run detail reads').toHaveBeenCalledTimes(0);
    expect(calls.getAudit).toHaveBeenCalledTimes(0);
    expect(fetchSpy, 'zero raw-transport requests').toHaveBeenCalledTimes(0);
  });

  it('and the census is now about DELIVERABLE runs only', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);
    // 60 build runs delivered; the 60 system runs — chats, collab, and the five
    // interactive-* seams — are out entirely, not counted as "no deliver phase".
    const summary = await screen.findByTestId('dashboard-delivery-summary');
    expect(summary.textContent).toStrictEqual('60 ran deliver');
  });

  it('a SECOND list surface mounting after it fires none — the cache is app-level', async () => {
    render(<ProjectDashboard projectId="proj-1" runs={corpus()} navigate={() => {}} />);
    await screen.findByTestId('dashboard-delivery-summary');
    expect(calls.listWorkflows).toHaveBeenCalledTimes(1);

    cleanup();
    render(
      <CenterDashboard
        runs={corpus()}
        onSelectRun={() => {}}
        navigate={() => {}}
        onApproveGate={() => {}}
        onRejectGate={() => {}}
      />,
    );
    await screen.findAllByTestId('run-delivery-chip');

    expect(calls.listWorkflows, 'the second surface re-asked').toHaveBeenCalledTimes(1);
    expect(calls.getUnitOutput).toHaveBeenCalledTimes(0);
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});
