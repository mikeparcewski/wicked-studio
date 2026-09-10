import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project, ProjectDetail } from '../src/api/types.js';

/**
 * studio#214 — ProjectDetailPage action layer: Edit, Archive, Restore, and the
 * default-project guard. These are the controls the redirect bug made unreachable;
 * the routing fix (removing the `/projects/:id → /p/:id` arm) is covered in
 * legacyRedirect.test.ts. This suite covers the component logic directly.
 */

const getProject = vi.fn();
const getProjectActivity = vi.fn();
const updateProject = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getProject: (...a: unknown[]) => getProject(...a),
    getProjectActivity: (...a: unknown[]) => getProjectActivity(...a),
    updateProject: (...a: unknown[]) => updateProject(...a),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
  },
}));

const { ProjectDetailPage } = await import('../src/components/ProjectDetailPage.js');

const NOW = 1_757_300_000_000;

function proj(id: string, extra: Partial<Project> = {}): Project {
  return {
    id, name: `Project ${id}`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 1000, updated_at: NOW - 1000,
    ...extra,
  };
}

function detail(p: Project): ProjectDetail {
  return { project: p, members: [] } as ProjectDetail;
}

beforeEach(() => {
  getProject.mockReset();
  getProjectActivity.mockReset();
  updateProject.mockReset();
  getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'proj-1' });
});
afterEach(cleanup);

async function renderLoaded(projectId: string, navigate = vi.fn()): Promise<void> {
  render(<ProjectDetailPage projectId={projectId} navigate={navigate} />);
  await waitFor(() => expect(getProject).toHaveBeenCalledWith(projectId));
  // wait for the page to finish loading
  await waitFor(() => expect(screen.queryByText('Loading…')).toBeNull());
}

describe('ProjectDetailPage — Edit', () => {
  it('opens an inline editor on Edit click and saves name + description via updateProject', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    updateProject.mockResolvedValue({ project: proj('proj-1', { name: 'renamed' }) });
    await renderLoaded('proj-1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByDisplayValue('Project proj-1') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', {
      name: 'renamed', description: '',
    }));
    // Cancel no longer in the DOM once saved
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
  });

  it('Save is disabled on an empty name', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    await renderLoaded('proj-1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const nameInput = screen.getByDisplayValue('Project proj-1') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('ProjectDetailPage — Archive / Restore', () => {
  it('Archive sends {status: "archived"} and the button flips to Restore', async () => {
    const active = proj('proj-1', { status: 'active' });
    getProject.mockResolvedValue(detail(active));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'archived' }) });
    await renderLoaded('proj-1');

    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'archived' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
  });

  it('Restore sends {status: "active"} and the button flips back to Archive', async () => {
    const archived = proj('proj-1', { status: 'archived' });
    getProject.mockResolvedValue(detail(archived));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'active' }) });
    await renderLoaded('proj-1');

    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'active' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});

describe('ProjectDetailPage — default-project guard', () => {
  it('the synthesized default project exposes neither Edit nor Archive/Restore', async () => {
    getProject.mockResolvedValue(detail(proj('default')));
    getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'default' });
    await renderLoaded('default');

    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });
});
