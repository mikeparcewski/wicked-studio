import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * The project homepage's governed-knowledge band (DES-MEM-FACETED-001; governed-knowledge
 * dashboard): a "Needs review" KpiGroup tile counting pending memory + policy proposals, a door
 * straight into the dashboard's consolidated review inbox. Omitted entirely on a daemon that does
 * not serve the proposal queue — never a lying zero on the project home.
 */

const apiFetch = vi.fn();
const listProjectMembers = vi.fn();

vi.mock('../src/api/client.js', () => ({
  apiFetch: (...a: unknown[]) => apiFetch(...a),
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
  },
}));

const listDocs = vi.fn();
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: (...a: unknown[]) => listDocs(...a),
}));

const { ProjectDashboard } = await import('../src/components/ProjectDashboard.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useGateStore } = await import('../src/store/gates.js');
const { ApiError } = await import('../src/api/errors.js');
type Proposal = import('../src/api/proposals.js').Proposal;

const NOW = Date.now();
const PROJECT = {
  id: 'proj-1', name: 'The proj-1 project', description: null, status: 'active' as const,
  scope: 'project:proj-1', created_at: NOW - 1000, updated_at: NOW - 1000,
};

function proposals(): Proposal[] {
  return [
    { id: 'p-mem', kind_type: 'memory', payload: {}, facets: {}, provenance: {}, state: 'pending', created_at: 1 },
    { id: 'p-pol', kind_type: 'policy:security', payload: {}, facets: {}, provenance: {}, state: 'pending', created_at: 2 },
  ];
}

beforeEach(() => {
  apiFetch.mockReset();
  listProjectMembers.mockReset();
  listDocs.mockReset();
  listProjectMembers.mockResolvedValue({ members: [] });
  listDocs.mockResolvedValue([]);
  useGateStore.setState({ gates: {} });
  useProjectsStore.setState({ projects: [PROJECT], loading: false, error: null });
});
afterEach(cleanup);

describe('ProjectDashboard — the governed-knowledge band', () => {
  it('renders a Needs review tile counting pending proposals, doored into the dashboard', async () => {
    apiFetch.mockImplementation((path: unknown) =>
      String(path).startsWith('/proposals') ? Promise.resolve({ proposals: proposals() }) : Promise.resolve({}),
    );
    const navigate = vi.fn();
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={navigate} />);

    const tile = await screen.findByTestId('stat-needs-review');
    await waitFor(() => expect(tile).toHaveAttribute('data-value', '2'));
    // The tile is a real door into the consolidated review inbox.
    expect(tile.getAttribute('href')).toBe('/steering/dashboard');
    await userEvent.setup().click(tile);
    expect(navigate).toHaveBeenCalledWith('/steering/dashboard');
  });

  it('omits the band on a daemon that does not serve the proposal queue (no lying zero)', async () => {
    apiFetch.mockImplementation((path: unknown) =>
      String(path).startsWith('/proposals')
        ? Promise.reject(new ApiError(404, 'Not Found'))
        : Promise.resolve({}),
    );
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={vi.fn()} />);

    // The project KPI band still renders; the GK tile does not.
    await screen.findByTestId('project-kpis');
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(screen.queryByTestId('stat-needs-review')).toBeNull();
  });
});
