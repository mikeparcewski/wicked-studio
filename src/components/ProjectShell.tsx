import { useCallback, useEffect, useRef } from 'react';
import { UNFILED_MOUNT } from '../api/interactive.js';
import { usePreflight } from '../hooks/usePreflight.js';
import { MODES, modePath, projectPath, type Mode, type Navigate } from '../hooks/useRoute.js';
import { useConnectionStore } from '../store/connection.js';
import { useProjectsStore } from '../store/projects.js';
import {
  enablingAction, gateForMode, useProjectReadiness, useReadinessStore,
} from '../store/readiness.js';
import { InstallGate } from './InstallGate.js';
import { ModeSwitcher } from './ModeSwitcher.js';
import { ProjectSwitcher } from './ProjectSwitcher.js';

// The shell's breadcrumb bar is chrome (DES-VISION-001 §5.2: breadcrumb, mode
// switcher, mode surface, connection status) — token-resolved per §2.11.
const S = {
  bar:    'var(--surface-rail)',
  border: 'var(--surface-raised)',
  ink:    'var(--ink-high)',
  muted:  'var(--ink-muted)',
  dim:    'var(--ink-dim)',
};

/** The context header's word for each mode (§4.2) — the switcher's capitalization. */
export const MODE_LABEL: Record<Mode, string> = {
  chat: 'Chat',
  build: 'Build',
  document: 'Document',
  video: 'Video',
};

/** §4.2's type spec, shared by both breadcrumb segments: sans, sm, medium. */
const CRUMB: React.CSSProperties = {
  fontSize: 'var(--text-sm)',
  fontWeight: 'var(--weight-medium)',
  fontFamily: 'var(--font-sans)',
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

  const onSelectMode = useCallback(
    (next: Mode) => navigate(modePath(projectId, next, lastArtifact.current[next] ?? null)),
    [navigate, projectId],
  );

  const project = projects.find((p) => p.id === projectId) ?? null;
  // Slice U (DES-UX-001 §6.2): the synthesized `default` bucket never rides the
  // board's store mirror (F5 — it is not a project card), so at /p/default the
  // shell labels it the way run surfaces label Unfiled runs — the daemon's own
  // name for the bucket, "Unfiled" — instead of leaking the raw id.
  const name = project?.name ?? (projectId === UNFILED_MOUNT ? 'Unfiled' : projectId);

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
      {/* The project-context header (DES-FEEDBACK-001 §4.2, slice D): one slim
          32px band — "project › mode" — above the switcher in EVERY mode surface.
          It absorbed the shell's old breadcrumb rather than stacking beneath it;
          always visible, never collapses. It answers: "where am I, and how do I
          get back?" — the project name links back to the dashboard (§4.1). */}
      <header
        data-testid="project-context-header"
        style={{
          display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0,
          height: '32px', boxSizing: 'border-box', padding: '0 14px',
          background: S.bar, borderBottom: `1px solid ${S.border}`,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/')}
          title="All projects"
          style={{
            background: 'transparent', border: 'none', color: S.dim, cursor: 'pointer',
            fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', padding: 0,
          }}
        >
          ‹ Projects
        </button>
        {/* The project name is CONTEXT, not the current focus (§4.2): muted ink —
            and since slice J (DES-FEEDBACK-002 §4) it is the ProjectSwitcher's
            trigger in the crumb dress: 1-click pivot to a sibling project
            RETAINING the current mode verb. Selecting a sibling navigates to
            `modePath(nextId, mode)` — the SAME verb, no artifact id (the
            artifact belongs to the old project; carrying it would 404 or worse,
            silently show the wrong project's run). Selecting the current
            project is a no-op close. Zero requests: the projects store is
            already warm (loaded above) — no `onOpen` is passed. */}
        <ProjectSwitcher
          variant="crumb"
          triggerTestId="project-name"
          current={project ?? { id: projectId, name, description: null, status: 'active', scope: '', created_at: 0, updated_at: 0 }}
          projects={projects}
          onSelect={(nextId) => {
            if (nextId === null || nextId === projectId) return;
            navigate(modePath(nextId, mode));
          }}
          dashboard={{
            href: projectPath(projectId),
            onGo: () => navigate(projectPath(projectId)),
          }}
        />
        {/* The deep-linkable-real-link contract (DES-FEEDBACK-001 §4.2) the
            name used to carry: a small ⌂ directly after it stays a REAL link —
            middle-clickable — to the project dashboard. */}
        <a
          data-testid="project-home"
          href={projectPath(projectId)}
          onClick={(e) => { e.preventDefault(); navigate(projectPath(projectId)); }}
          title={`${name} — project dashboard`}
          style={{ ...CRUMB, color: S.dim, textDecoration: 'none' }}
        >
          ⌂
        </a>
        <span aria-hidden style={{ ...CRUMB, color: S.dim }}>›</span>
        <span data-testid="context-mode" style={{ ...CRUMB, color: S.ink }}>
          {MODE_LABEL[mode]}
        </span>
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
