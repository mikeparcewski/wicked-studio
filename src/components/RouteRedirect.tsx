import { useEffect } from 'react';
import type { Navigate } from '../hooks/useRoute.js';
import { openLaunchWizard } from '../store/launchWizard.js';

/** A retired address that only redirects (replacing the history entry, so Back skips it). */
export function RouteRedirect({ to, navigate }: { to: string; navigate: Navigate }): React.ReactElement | null {
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return null;
}

/** The workflow QE tests run as (the governed test workflow the old Testing landing launched). */
export const TEST_WORKFLOW_ID = 'qe-author-tests';

/**
 * The retired Testing landing (`/testing/campaigns[?project=]`, operator 2026-10-12: "QE campaigns are
 * a workflow now"): opens the launch wizard on the test workflow, with the project the address names,
 * over the Desk. Nothing launches until the operator does.
 */
export function CampaignsRedirect({ search, navigate }: { search: string; navigate: Navigate }): React.ReactElement | null {
  useEffect(() => {
    const projectId = new URLSearchParams(search).get('project');
    navigate('/', { replace: true });
    openLaunchWizard({ workflowId: TEST_WORKFLOW_ID, projectId: projectId !== null && projectId !== '' && projectId !== 'default' ? projectId : null });
  }, [search, navigate]);
  return null;
}
