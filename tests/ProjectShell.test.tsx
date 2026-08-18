import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectShell } from '../src/components/ProjectShell.js';
import { useProjectsStore } from '../src/store/projects.js';
import { lastMode } from '../src/hooks/useRoute.js';

vi.mock('../src/api/client.js', () => ({
  api: { listProjects: () => Promise.resolve({ projects: [] }) },
}));

beforeEach(() => {
  useProjectsStore.setState({
    projects: [{
      id: 'proj-1', name: 'Merge the skins', description: null, status: 'active',
      scope: 'project:proj-1', created_at: 1, updated_at: 1,
    }],
    loading: false,
    error: null,
  });
  window.localStorage.clear();
});

afterEach(cleanup);

describe('ProjectShell (DES-MERGE-001 §1.2)', () => {
  it('renders the switcher and the mode surface on a /p/* route', () => {
    render(
      <ProjectShell projectId="proj-1" mode="build" artifactId={null} navigate={() => {}}>
        <p>surface</p>
      </ProjectShell>,
    );
    expect(screen.getByTestId('mode-switcher')).toBeInTheDocument();
    expect(screen.getByTestId('mode-surface')).toHaveAttribute('data-mode', 'build');
    expect(screen.getByTestId('project-name')).toHaveTextContent('Merge the skins');
  });

  it('falls back to the project id when the project is not loaded — never a blank header', async () => {
    useProjectsStore.setState({ projects: [] });
    // The empty store triggers a load; await it inside act so the fetch settles here.
    await act(async () => {
      render(
        <ProjectShell projectId="proj-9" mode="chat" artifactId={null} navigate={() => {}}>
          <p>surface</p>
        </ProjectShell>,
      );
    });
    expect(screen.getByTestId('project-name')).toHaveTextContent('proj-9');
  });

  it('navigates to the mode route on a tab click', () => {
    const navigate = vi.fn();
    render(
      <ProjectShell projectId="proj-1" mode="chat" artifactId={null} navigate={navigate}>
        <p>surface</p>
      </ProjectShell>,
    );
    fireEvent.click(screen.getByTestId('mode-tab-build'));
    expect(navigate).toHaveBeenCalledWith('/p/proj-1/build');
  });

  it('remembers each mode\'s artifact, so a switch never drops what was open (§1.3 rule 1)', () => {
    const navigate = vi.fn();
    const { rerender } = render(
      <ProjectShell projectId="proj-1" mode="build" artifactId="run-9" navigate={navigate}>
        <p>surface</p>
      </ProjectShell>,
    );
    // Build → Chat …
    fireEvent.click(screen.getByTestId('mode-tab-chat'));
    expect(navigate).toHaveBeenLastCalledWith('/p/proj-1/chat');

    rerender(
      <ProjectShell projectId="proj-1" mode="chat" artifactId={null} navigate={navigate}>
        <p>surface</p>
      </ProjectShell>,
    );
    // … and back to Build lands on run-9 again, not on an empty run list.
    fireEvent.click(screen.getByTestId('mode-tab-build'));
    expect(navigate).toHaveBeenLastCalledWith('/p/proj-1/build/run-9');
  });

  it('records the last-used mode, which is where a bare /p/:projectId lands', () => {
    render(
      <ProjectShell projectId="proj-1" mode="build" artifactId={null} navigate={() => {}}>
        <p>surface</p>
      </ProjectShell>,
    );
    expect(lastMode('proj-1')).toBe('build');
  });
});
