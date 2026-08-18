import { useCallback, useEffect, useRef } from 'react';
import { modePath, rememberMode, type Mode, type Navigate } from '../hooks/useRoute.js';
import { useProjectsStore } from '../store/projects.js';
import { ModeSwitcher } from './ModeSwitcher.js';

const S = {
  bar:    '#161c26',
  border: 'rgba(230,237,243,0.1)',
  ink:    '#e6edf3',
  muted:  'rgba(230,237,243,0.55)',
};

interface Props {
  projectId: string;
  mode: Mode;
  /** What the current mode has open — remembered per mode so a switch never drops it. */
  artifactId: string | null;
  navigate: Navigate;
  /** The mode surface: an existing studio surface for Chat/Build, a placeholder otherwise. */
  children: React.ReactNode;
}

/**
 * The project shell (DES-MERGE-001 §1.2): mode switcher on top, mode surface below.
 *
 * The switcher lives OUTSIDE the surface, so switching modes re-renders the surface
 * without tearing down the shell, and each mode returns to the artifact it was last
 * showing — §1.3 rule 1, "switching modes never resets the conversation".
 */
export function ProjectShell({ projectId, mode, artifactId, navigate, children }: Props): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  const loadProjects = useProjectsStore((s) => s.load);

  useEffect(() => {
    if (projects.length === 0) void loadProjects();
  }, [projects.length, loadProjects]);

  // Per-mode artifact memory: Build → Chat → Build lands back on the same run rather
  // than on an empty surface. A ref (not state) because it never drives a render.
  const lastArtifact = useRef<Partial<Record<Mode, string>>>({});
  if (artifactId) lastArtifact.current[mode] = artifactId;

  useEffect(() => { rememberMode(projectId, mode); }, [projectId, mode]);

  const onSelectMode = useCallback(
    (next: Mode) => navigate(modePath(projectId, next, lastArtifact.current[next] ?? null)),
    [navigate, projectId],
  );

  const name = projects.find((p) => p.id === projectId)?.name ?? projectId;

  return (
    <div className="flex flex-1 flex-col overflow-hidden" data-testid="project-shell" data-project-id={projectId}>
      <header
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          padding: '10px 14px 8px', background: S.bar, borderBottom: `1px solid ${S.border}`,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          title="All projects"
          style={{ background: 'transparent', border: 'none', color: S.muted, cursor: 'pointer', fontSize: '12px', padding: 0 }}
        >
          ‹ Projects
        </button>
        <h1 data-testid="project-name" style={{ fontSize: '13px', fontWeight: 700, color: S.ink, margin: 0 }}>
          {name}
        </h1>
      </header>

      <ModeSwitcher mode={mode} onSelect={onSelectMode} />

      <div className="flex flex-1 overflow-hidden" data-testid="mode-surface" data-mode={mode}>
        {children}
      </div>
    </div>
  );
}
