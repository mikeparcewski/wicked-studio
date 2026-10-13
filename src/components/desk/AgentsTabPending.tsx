import type { Navigate } from '../../hooks/useRoute.js';
import { EmptyState } from '../ui/index.js';

/** The Desk's Agents tab until the Agents page (lane studio-agents-page) is merged and mounted here. */
export function AgentsTabPending({ navigate }: { navigate: Navigate }): React.ReactElement {
  return (
    <div className="wk-desk2-pending" data-testid="desk-agents-pending">
      <EmptyState
        title="The Agents page is on its way"
        body="Each agent's sign-in, checks and readiness will live on this tab. Until then, Health shows every agent's week."
        action={<a href="/health" className="wk-btn wk-btn--secondary" onClick={(e) => { e.preventDefault(); navigate('/health'); }}>Open Health</a>}
      />
    </div>
  );
}
