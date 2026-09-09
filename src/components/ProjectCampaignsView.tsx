import type { SessionView } from '../api/types.js';
import type { Navigate } from '../hooks/useRoute.js';
import { CampaignsPage } from './CampaignsPage.js';

/**
 * `/p/:projectId/campaigns` (nav-reorg): the project-scoped Test surface — the test landing
 * re-homed under the project shell. A test (an engine campaign) is a DAG workload, not a
 * project, so this is a project-scoped VIEW (mode stays null — the ModeSwitcher's four verbs are
 * untouched), reached from the project dashboard's "Test" door. The campaign store is not
 * project-partitioned on the wire yet, so the surface renders the full test command surface
 * framed by the project context; true per-project scoping is a data-layer follow-up. What the
 * project DOES scope today is creation: `CampaignsPage` pre-selects it in the launch panel.
 *
 * The route and testids keep the backend's `campaigns` vocabulary; every rendered word says
 * Test (wicked-studio#203).
 */
export function ProjectCampaignsView({ projectId, runs, navigate }: {
  projectId: string;
  runs: SessionView[];
  navigate: Navigate;
}): React.ReactElement {
  return (
    <div className="flex-1 overflow-y-auto" data-testid="project-campaigns" data-project-id={projectId}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '10px 24px 0', flexShrink: 0,
        }}
      >
        <button
          type="button"
          data-testid="project-campaigns-back"
          onClick={() => navigate(`/p/${encodeURIComponent(projectId)}`)}
          title="Back to the project dashboard"
          style={{
            background: 'transparent', border: 'none', color: 'var(--ink-dim)', cursor: 'pointer',
            fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)', padding: 0,
          }}
        >
          ‹ Project
        </button>
        <span aria-hidden style={{ color: 'var(--ink-dim)', fontSize: 'var(--text-xs)' }}>›</span>
        <span
          data-testid="project-campaigns-crumb"
          style={{ color: 'var(--ink-high)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)' }}
        >
          Tests
        </span>
      </div>
      <CampaignsPage runs={runs} navigate={navigate} projectId={projectId} />
    </div>
  );
}
