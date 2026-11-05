import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { useProvenanceStore } from '../store/provenance.js';
import { setRetryPrefill } from '../store/retryPrefill.js';

/**
 * The repository verbs the Repositories list and a repository's page share: Re-index as a PREFILL (nothing starts
 * until the person sends it) and Capture learnings (a real governed run).
 */

/**
 * Re-index as PREFILL (the Retry-as-prefill idiom, DES-UX-001 §4.3): the repo's recorded onboard run's setup is
 * deposited for the composer and the person lands on `/runs/new` to tweak-before-send. Nothing auto-launches.
 */
export function reindexAsPrefill(onboardRun: SessionView, repoId: string, navigate: (path: string) => void): void {
  const s = onboardRun.session;
  setRetryPrefill({
    retryOf: s.id,
    problem: s.problem,
    clis: s.clis,
    workflowId: s.workflow_id || null,
    repoRef: repoId,
    entityMode: s.entity_mode,
    humanConfirm: s.human_confirm,
    projectId: typeof s.project_id === 'string' ? s.project_id : null,
  });
  navigate('/runs/new');
}

/**
 * Capture learnings: launch the governed capture-learnings workflow over this repo (`POST /runs`), a REAL run the
 * person can watch. Filing (F-RC1-049 / F-E2E-015): entered from a project (the ambient project, carried to the
 * repository's page as `?project=`), the launch carries that `projectId`; otherwise NO `projectId` is sent and the run
 * stays Unfiled honestly (there is no repo-to-project guess).
 */
export async function launchCaptureLearnings(repoId: string, repoName: string, ambientProject: string | null): Promise<string> {
  const { runId } = await api.launchRun({
    problem: `Capture learnings from ${repoName}`,
    repoRef: repoId,
    workflow: 'capture-learnings',
    ...(ambientProject !== null ? { projectId: ambientProject } : {}),
  });
  // Studio witnessed this launch: the run's provenance line reads 'via studio', not the API fallback.
  useProvenanceStore.getState().markLaunchedHere(runId);
  return runId;
}

/**
 * A link's click, taken over only when it is a plain primary click: Cmd/Ctrl/Shift/Alt-click and a middle click keep
 * the browser's own behaviour (a new tab or window), as the link's href says.
 */
export function onPlainClick(navigate: (path: string) => void, path: string) {
  return (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault: () => void }): void => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(path);
  };
}
