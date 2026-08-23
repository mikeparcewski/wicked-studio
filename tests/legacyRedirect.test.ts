import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { resolveRunProject, useLegacyRedirect } from '../src/hooks/useLegacyRedirect.js';

const listProjects = vi.fn();
const listProjectMembers = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: (...a: unknown[]) => listProjects(...a),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
  },
}));

function project(id: string, name = id): Project {
  return { id, name, description: null, status: 'active', scope: `project:${id}`, created_at: 1, updated_at: 1 };
}

function member(projectId: string, kind: string, ref: string): ProjectMember {
  return {
    id: `${projectId}:${kind}:${ref}`, project_id: projectId, member_kind: kind,
    member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio',
  };
}

/** Route shape for a legacy path; `mode: null` is what makes it legacy. */
const legacy = {
  runs: (runId: string) => ({ panel: 'runs', runId, projectId: null, mode: null, showLaunch: false }),
  projects: (projectId: string) => ({ panel: 'project-detail', runId: null, projectId, mode: null, showLaunch: false }),
};

beforeEach(() => {
  listProjects.mockReset();
  listProjectMembers.mockReset();
  window.localStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('resolveRunProject', () => {
  it('finds the project a run is filed under', async () => {
    listProjects.mockResolvedValue({ projects: [project('default', 'Unfiled'), project('proj-1'), project('proj-2')] });
    listProjectMembers.mockImplementation((id: string) =>
      Promise.resolve({ members: id === 'proj-2' ? [member('proj-2', 'crew.run', 'run-9')] : [] }));

    await expect(resolveRunProject('run-9')).resolves.toBe('proj-2');
    // `default` is the SYNTHESIZED unfiled project — never scanned, never a hit.
    expect(listProjectMembers).not.toHaveBeenCalledWith('default');
  });

  it('resolves a chat thread too (crew.chat is a member kind)', async () => {
    listProjects.mockResolvedValue({ projects: [project('proj-1')] });
    listProjectMembers.mockResolvedValue({ members: [member('proj-1', 'crew.chat', 'chat-3')] });
    await expect(resolveRunProject('chat-3')).resolves.toBe('proj-1');
  });

  it('returns null for an unfiled run, and ignores non-run member kinds', async () => {
    listProjects.mockResolvedValue({ projects: [project('proj-1')] });
    listProjectMembers.mockResolvedValue({ members: [member('proj-1', 'crew.repo', 'run-9')] });
    await expect(resolveRunProject('run-9')).resolves.toBeNull();
  });

  it('treats a project that fails to answer as a miss, not an error', async () => {
    listProjects.mockResolvedValue({ projects: [project('proj-1'), project('proj-2')] });
    listProjectMembers.mockImplementation((id: string) =>
      id === 'proj-1' ? Promise.reject(new Error('API 500')) : Promise.resolve({ members: [member('proj-2', 'crew.run', 'run-9')] }));
    await expect(resolveRunProject('run-9')).resolves.toBe('proj-2');
  });
});

describe('useLegacyRedirect (DES-MERGE-001 §1.5 — no bookmark breaks)', () => {
  it('/runs/:id → /p/<project>/build/:id, replacing the history entry', async () => {
    listProjects.mockResolvedValue({ projects: [project('proj-1')] });
    listProjectMembers.mockResolvedValue({ members: [member('proj-1', 'crew.run', 'run-9')] });
    const navigate = vi.fn();

    renderHook(() => useLegacyRedirect(legacy.runs('run-9'), navigate));

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/p/proj-1/build/run-9', { replace: true }));
  });

  it('leaves an unfiled run on the existing run view', async () => {
    listProjects.mockResolvedValue({ projects: [project('proj-1')] });
    listProjectMembers.mockResolvedValue({ members: [] });
    const navigate = vi.fn();

    renderHook(() => useLegacyRedirect(legacy.runs('run-9'), navigate));

    await waitFor(() => expect(listProjectMembers).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('leaves the run view alone when the projects surface is unreachable', async () => {
    listProjects.mockRejectedValue(new Error('API 503'));
    const navigate = vi.fn();

    renderHook(() => useLegacyRedirect(legacy.runs('run-9'), navigate));

    await waitFor(() => expect(listProjects).toHaveBeenCalled());
    expect(navigate).not.toHaveBeenCalled();
  });

  it('/projects/:id → /p/:id (the project dashboard), with no membership lookup', () => {
    const navigate = vi.fn();

    renderHook(() => useLegacyRedirect(legacy.projects('proj-1'), navigate));

    expect(navigate).toHaveBeenCalledWith('/p/proj-1', { replace: true });
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('a bare /p/:projectId is NOT redirected — it IS the dashboard (DES-FEEDBACK-001 §4.1)', () => {
    const navigate = vi.fn();
    renderHook(() => useLegacyRedirect(
      { panel: 'runs', runId: null, projectId: 'proj-1', mode: null, showLaunch: false }, navigate));
    expect(navigate).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('never redirects a route that is already in the shell, or the launch form', () => {
    const navigate = vi.fn();
    renderHook(() => useLegacyRedirect(
      { panel: 'runs', runId: 'run-9', projectId: 'proj-1', mode: 'build', showLaunch: false }, navigate));
    renderHook(() => useLegacyRedirect(
      { panel: 'runs', runId: null, projectId: null, mode: null, showLaunch: true }, navigate));
    renderHook(() => useLegacyRedirect(
      { panel: 'work', runId: null, projectId: null, mode: null, showLaunch: false }, navigate));

    expect(navigate).not.toHaveBeenCalled();
    expect(listProjects).not.toHaveBeenCalled();
  });
});

describe('slice Y (DES-UX-001 §7.4): the bare /runs listing retires into /work', () => {
  const bare = { panel: 'runs', runId: null, projectId: null, mode: null, showLaunch: false };

  it('/runs → /work, replacing the history entry, with no membership lookup', () => {
    window.history.replaceState(null, '', '/runs');
    const navigate = vi.fn();
    renderHook(() => useLegacyRedirect(bare, navigate));
    expect(navigate).toHaveBeenCalledWith('/work', { replace: true });
    expect(listProjects).not.toHaveBeenCalled();
  });

  it('carries the search string — /runs?filter=failed keeps its failure context', () => {
    window.history.replaceState(null, '', '/runs?filter=failed');
    const navigate = vi.fn();
    renderHook(() => useLegacyRedirect(bare, navigate));
    expect(navigate).toHaveBeenCalledWith('/work?filter=failed', { replace: true });
    window.history.replaceState(null, '', '/');
  });
});
