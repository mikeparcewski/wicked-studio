// The install gate in the shell — DES-MERGE-001 §5.6, §4.9, §1.3 rule 3 (slice 17).
//
// The model itself is pinned in `readiness.test.ts`; this suite is about what the shell
// DOES with it: which modes it stands in front of, what the tab says when a mode cannot
// open, and that "Continue anyway" hands the surface over for the rest of the session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ProjectShell } from '../src/components/ProjectShell.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useProjectsStore } from '../src/store/projects.js';
import { normalizeDeps, useReadinessStore } from '../src/store/readiness.js';
import type { Mode } from '../src/hooks/useRoute.js';

vi.mock('../src/api/client.js', () => ({
  api: { listProjects: () => Promise.resolve({ projects: [] }) },
  apiBase: () => '/api/v1',
}));

const PROJECT = 'proj-1';
const GARDEN_HINT = 'npm i -g wicked-garden';
const FFMPEG_HINT = 'brew install ffmpeg';
const BRIDGE_HINT = 'run `npx wicked-interactive serve` in this project’s root';

const GREEN = { garden: { ok: true }, ffmpeg: { ok: true }, 'python-pptx': { ok: true } };
const GARDEN_MISSING = { ...GREEN, garden: { ok: false, install: GARDEN_HINT } };
const FFMPEG_MISSING = { ...GREEN, ffmpeg: { ok: false, install: FFMPEG_HINT } };

/** Seed the model the way `usePreflight` would, without the request. */
function seed(deps: Record<string, unknown>): void {
  useReadinessStore.setState({
    byProject: { [PROJECT]: { bridge: 'ready', bridgeHint: null, deps: normalizeDeps({ deps }), continued: false } },
    attempt: 0,
  });
}

function shell(mode: Mode): ReturnType<typeof render> {
  return render(
    <ProjectShell projectId={PROJECT} mode={mode} artifactId={null} navigate={() => {}}>
      <p data-testid="mode-content">surface</p>
    </ProjectShell>,
  );
}

beforeEach(() => {
  // The shell's own preflight never resolves here; every case seeds the model directly.
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
  useProjectsStore.setState({
    projects: [{
      id: PROJECT, name: 'Merge the skins', description: null, status: 'active',
      scope: `project:${PROJECT}`, created_at: 1, updated_at: 1,
    }],
    loading: false,
    error: null,
  });
  useConnectionStore.setState({ status: 'connected' });
  useReadinessStore.setState({ byProject: {}, attempt: 0 });
  window.localStorage.clear();
});

afterEach(cleanup);

describe('a missing HARD dependency (§5.6)', () => {
  it('blocks Document with the service’s install command, verbatim', () => {
    seed(GARDEN_MISSING);
    shell('document');
    expect(screen.getByTestId('install-gate')).toHaveAttribute('data-mode', 'document');
    expect(screen.getByTestId('install-gate-dep')).toHaveAttribute('data-dep', 'garden');
    expect(screen.getByTestId('install-gate-command')).toHaveTextContent(GARDEN_HINT);
    // The surface never mounts, so a gated mode issues no doomed requests.
    expect(screen.queryByTestId('mode-content')).not.toBeInTheDocument();
  });

  it('blocks Video the same way, and NEVER Chat or Build (§1.3)', () => {
    seed(GARDEN_MISSING);
    shell('video');
    expect(screen.getByTestId('install-gate')).toHaveAttribute('data-mode', 'video');
    cleanup();

    for (const mode of ['chat', 'build'] as Mode[]) {
      shell(mode);
      expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
      expect(screen.getByTestId('mode-content')).toBeInTheDocument();
      cleanup();
    }
  });

  it('names the enabling action in the unavailable tabs, and only those (§1.3 rule 3)', () => {
    seed(GARDEN_MISSING);
    shell('chat');
    for (const mode of ['document', 'video']) {
      const tab = screen.getByTestId(`mode-tab-${mode}`);
      expect(tab).toHaveAttribute('data-unavailable', 'true');
      expect(tab.getAttribute('title')).toContain(GARDEN_HINT);
      // Unavailable, never inert: the gate it routes to is where the escape hatch is,
      // so an `aria-disabled` here would lock assistive-tech users out of it (§4.9).
      expect(tab).not.toHaveAttribute('aria-disabled');
      expect(tab).toBeEnabled();
    }
    for (const mode of ['chat', 'build']) {
      expect(screen.getByTestId(`mode-tab-${mode}`)).not.toHaveAttribute('data-unavailable');
    }
  });
});

describe('a missing OPTIONAL dependency (§4.4, §4.5)', () => {
  it('does not gate Document or Video — it degrades at point-of-use', () => {
    seed(FFMPEG_MISSING);
    shell('document');
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-content')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tab-video')).not.toHaveAttribute('data-unavailable');
    expect(screen.getByTestId('mode-tab-document').getAttribute('title')).not.toContain(FFMPEG_HINT);
  });
});

describe('all green, and the legs that claim nothing', () => {
  it('renders the surface untouched when every dependency is present', () => {
    seed(GREEN);
    shell('document');
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-content')).toBeInTheDocument();
  });

  it('does not gate on a bridge that could not start — the surface names that fix (§7.12)', () => {
    useReadinessStore.setState({
      byProject: { [PROJECT]: { bridge: 'unavailable', bridgeHint: BRIDGE_HINT, deps: [], continued: false } },
    });
    shell('document');
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-content')).toBeInTheDocument();
    // …but the mode still states what would enable it.
    expect(screen.getByTestId('mode-tab-document').getAttribute('title')).toContain(BRIDGE_HINT);
  });

  it('claims nothing while the daemon is unreachable — ConnectionStatus owns that', () => {
    seed(GARDEN_MISSING);
    useConnectionStore.setState({ status: 'disconnected' });
    shell('document');
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-tab-document')).not.toHaveAttribute('data-unavailable');
  });
});

describe('the escape hatch (§4.9, interactive #159)', () => {
  it('Continue anyway hands over the surface and re-enables the tabs, for the session', () => {
    seed(GARDEN_MISSING);
    const { rerender } = shell('document');
    fireEvent.click(screen.getByTestId('install-gate-continue'));

    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
    expect(screen.getByTestId('mode-content')).toBeInTheDocument();
    expect(screen.getByTestId('mode-tab-document')).not.toHaveAttribute('data-unavailable');

    // Still open after leaving the mode and coming back — the escape is the session's,
    // not this render's, and a fresh preflight reporting the same absence cannot revoke it.
    rerender(
      <ProjectShell projectId={PROJECT} mode="chat" artifactId={null} navigate={() => {}}>
        <p data-testid="mode-content">surface</p>
      </ProjectShell>,
    );
    act(() => useReadinessStore.getState().report(PROJECT, { deps: normalizeDeps({ deps: GARDEN_MISSING }) }));
    rerender(
      <ProjectShell projectId={PROJECT} mode="video" artifactId={null} navigate={() => {}}>
        <p data-testid="mode-content">surface</p>
      </ProjectShell>,
    );
    expect(screen.queryByTestId('install-gate')).not.toBeInTheDocument();
  });

  it('Re-check re-runs the preflight rather than asking for a reload', () => {
    seed(GARDEN_MISSING);
    shell('document');
    const before = useReadinessStore.getState().attempt;
    fireEvent.click(screen.getByTestId('install-gate-recheck'));
    expect(useReadinessStore.getState().attempt).toBe(before + 1);
    // Still gated: the model changes when the SERVICE says so, not when we ask again.
    expect(screen.getByTestId('install-gate')).toBeInTheDocument();
  });
});
