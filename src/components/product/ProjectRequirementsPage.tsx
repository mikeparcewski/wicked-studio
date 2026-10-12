import { useEffect, useMemo, useState } from 'react';
import { PageFrame } from '../ui/PageFrame.js';
import { RequirementsBrowser, reqKey, COMPOSE_MAX, type ChosenRequirement } from './RequirementsBrowser.js';
import { useProjectsStore } from '../../store/projects.js';
import { DRAFT_EPICS_ID, openLaunchWizard } from '../../store/launchWizard.js';
import { projectDetailPath } from '../../hooks/useRoute.js';

/**
 * A project's requirements (operator 2026-10-12: the Product page retired; requirements are a part of
 * the project): `/projects/:id/requirements`, the list the dashboard's Requirements section links to.
 * Choose some and "Draft epics" opens the launch wizard on its Draft epics step with them.
 */
export function ProjectRequirementsPage({ projectId, navigate }: { projectId: string; navigate: (path: string) => void }): React.ReactElement {
  const projects = useProjectsStore((s) => s.projects);
  useEffect(() => { if (useProjectsStore.getState().projects.length === 0) void useProjectsStore.getState().load(); }, []);
  const name = projects.find((p) => p.id === projectId)?.name ?? 'This project';
  const [chosen, setChosen] = useState<ChosenRequirement[]>([]);
  const map = useMemo(() => new Map(chosen.map((r) => [reqKey(r.repoId, r.key), r] as const)), [chosen]);
  const toggle = (r: ChosenRequirement): void => setChosen((cur) => {
    const k = reqKey(r.repoId, r.key);
    if (cur.some((x) => reqKey(x.repoId, x.key) === k)) return cur.filter((x) => reqKey(x.repoId, x.key) !== k);
    return cur.length >= COMPOSE_MAX ? cur : [...cur, r];
  });
  const back = projectDetailPath(projectId);
  return (
    <PageFrame data-testid="project-requirements-page" title={`Requirements · ${name}`} intro="The requirements across this project’s repositories. Choose some to draft epics from them."
      actions={<>
        <a className="wk-btn wk-btn--quiet" href={back} onClick={(e) => { e.preventDefault(); navigate(back); }}>Back to {name}</a>
        <button type="button" data-testid="requirements-draft" className="wk-btn wk-btn--primary"
          onClick={() => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId, requirements: chosen, composerKey: 'desk' })}>
          {chosen.length === 0 ? 'Draft epics' : `Draft epics from ${chosen.length}`}
        </button>
      </>}>
      <section className="wk-card" aria-label="Requirements">
        <RequirementsBrowser projectId={projectId} navigate={navigate} selection={{ chosen: map, onToggle: toggle }} />
      </section>
    </PageFrame>
  );
}
