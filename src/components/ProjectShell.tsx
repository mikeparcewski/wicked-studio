import { useCallback, useEffect, useRef } from 'react';
import { usePreflight } from '../hooks/usePreflight.js';
import { MODES, modePath, rememberMode, type Mode, type Navigate } from '../hooks/useRoute.js';
import { useConnectionStore } from '../store/connection.js';
import { useProjectsStore } from '../store/projects.js';
import {
  enablingAction, gateForMode, useProjectReadiness, useReadinessStore,
} from '../store/readiness.js';
import { InstallGate } from './InstallGate.js';
import { ModeSwitcher } from './ModeSwitcher.js';

// The shell's breadcrumb bar is chrome (DES-VISION-001 §5.2: breadcrumb, mode
// switcher, mode surface, connection status) — token-resolved per §2.11.
const S = {
  bar:    'var(--surface-rail)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
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
 *
 * It is also where the merged preflight runs (slice 17): once per project, whatever mode
 * the user landed in, because the SWITCHER has to reflect readiness (§1.3 rule 3) and
 * because the request itself is what starts a cold bridge (§5.6). What the model blocks
 * it blocks HERE, in front of the surface — the surface never mounts, so a gated mode
 * issues no doomed requests — and only for Document and Video.
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

  // ── The merged readiness model (§5.6, slice 17) ───────────────────────────
  usePreflight(projectId);
  const readiness = useProjectReadiness(projectId);
  // Leg one of the fold: with the daemon unreachable there IS no preflight answer, so
  // the model claims nothing and `ConnectionStatus` keeps owning that failure.
  const crewReachable = useConnectionStore((s) => s.status === 'connected');
  const continueAnyway = useReadinessStore((s) => s.continueAnyway);
  const recheck = useReadinessStore((s) => s.recheck);

  const blockers = gateForMode(mode, readiness, crewReachable);
  const unavailable = Object.fromEntries(
    MODES.map((m) => [m, enablingAction(m, readiness, crewReachable)]),
  ) as Partial<Record<Mode, string | null>>;

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
          style={{
            background: 'transparent', border: 'none', color: S.muted, cursor: 'pointer',
            fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', padding: 0,
          }}
        >
          ‹ Projects
        </button>
        <h1
          data-testid="project-name"
          style={{
            fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semi)',
            fontFamily: 'var(--font-sans)', color: S.ink, margin: 0,
          }}
        >
          {name}
        </h1>
      </header>

      <ModeSwitcher mode={mode} onSelect={onSelectMode} unavailable={unavailable} />

      <div className="flex flex-1 overflow-hidden" data-testid="mode-surface" data-mode={mode}>
        {blockers.length > 0
          ? (
            <InstallGate
              mode={mode}
              blockers={blockers}
              onContinue={() => continueAnyway(projectId)}
              onRecheck={recheck}
            />
          )
          : children}
      </div>
    </div>
  );
}
