import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectShell } from '../src/components/ProjectShell.js';
import { useProjectsStore } from '../src/store/projects.js';
import { MODES, type Mode } from '../src/hooks/useRoute.js';

vi.mock('../src/api/client.js', () => ({
  api: { listProjects: () => Promise.resolve({ projects: [] }) },
  // The shell runs the merged preflight for every project it opens (slice 17); these
  // cases are about the SHELL, so the probe answers nothing and nothing is gated.
  apiBase: () => '/api/v1',
}));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('no preflight in this suite'))));
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

  // ── The project-context header (DES-FEEDBACK-001 §4.2, slice D) ────────────

  const MODE_WORD: Record<Mode, string> = {
    chat: 'Chat', build: 'Build', document: 'Document', video: 'Video',
  };

  it.each(MODES.map((m) => [m] as const))(
    'shows the project-context header in %s mode — project name › mode word (EC17)',
    (m) => {
      render(
        <ProjectShell projectId="proj-1" mode={m} artifactId={null} navigate={() => {}}>
          <p>surface</p>
        </ProjectShell>,
      );
      const header = screen.getByTestId('project-context-header');
      expect(header).toBeInTheDocument();
      expect(screen.getByTestId('project-name')).toHaveTextContent('Merge the skins');
      expect(screen.getByTestId('context-mode')).toHaveTextContent(MODE_WORD[m]);
    },
  );

  it('the header project name links back to the project dashboard (§4.2)', () => {
    const navigate = vi.fn();
    render(
      <ProjectShell projectId="proj-1" mode="build" artifactId={null} navigate={navigate}>
        <p>surface</p>
      </ProjectShell>,
    );
    const crumb = screen.getByTestId('project-name');
    expect(crumb).toHaveAttribute('href', '/p/proj-1');
    fireEvent.click(crumb);
    expect(navigate).toHaveBeenCalledWith('/p/proj-1');
  });

  it('no longer writes a last-used-mode memory — the dashboard replaced the redirect (slice D)', () => {
    render(
      <ProjectShell projectId="proj-1" mode="build" artifactId={null} navigate={() => {}}>
        <p>surface</p>
      </ProjectShell>,
    );
    expect(window.localStorage.getItem('wk.studio.lastMode.proj-1')).toBeNull();
  });
});
