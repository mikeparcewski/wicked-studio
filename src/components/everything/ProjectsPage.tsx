import type { SessionView } from '../../api/types.js';
import type { NeedRow } from '../../board/needsYou.js';
import { readEverythingQuery } from '../../board/everythingModel.js';
import { PROJECTS_PATH } from '../../board/navModel.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { CalmHead, CalmPage } from '../calm/Calm.js';
import { ProjectsTab } from './ProjectsTab.js';

/**
 * PROJECTS (`/projects`, the sidebar's first WORK item, operator 2026-10-27). For now it is the projects
 * list See everything's Projects tab already shows (New project, Active / Archived, find, one card per
 * project), under the calm page's title and sentence. A designed Projects home replaces it once its
 * mockup is approved. `?filter=archived` is the Archived lens, as on the tab.
 */
export function ProjectsPage({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, navigate, search }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  navigate: Navigate;
  search: string;
}): React.ReactElement {
  const params = new URLSearchParams(search);
  params.set('tab', 'projects');
  const q = readEverythingQuery(`?${params.toString()}`);
  return (
    <CalmPage data-testid="projects-page">
      <CalmHead title={PAGE_NAMES.projects} sentence="Each project keeps the jobs and repositories that belong together." />
      <ProjectsTab q={q} runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns} needRows={needRows} navigate={navigate}
        lensPath={(filter) => (filter === 'archived' ? `${PROJECTS_PATH}?filter=archived` : PROJECTS_PATH)} />
    </CalmPage>
  );
}
