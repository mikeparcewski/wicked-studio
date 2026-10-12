import { useCallback, useEffect, useState } from 'react';
import type { ProjectIssueHandler } from './ProjectAggregates.js';
import { getProjectRequirements, type AggregateRead, type ProjectRequirementsResponse } from '../../api/product.js';
import { projectRequirementsPath } from '../../hooks/useRoute.js';
import { DRAFT_EPICS_ID, openLaunchWizard } from '../../store/launchWizard.js';
import { Skeleton } from '../ui/StateBanner.js';
import { TechDetails } from '../ui/TechDetails.js';

/**
 * The project dashboard's Requirements section (operator 2026-10-12: the Product page retired into
 * the project): the real count — "N requirements across M repositories" (crew#371's fold, read with
 * `limit=1`, only the totals used) — a link to the list, and "Draft epics" (the launch wizard's Draft
 * epics step, this project chosen). An older daemon without the fold draws nothing.
 */
export function ProjectRequirementsSection({ projectId, navigate, onIssue }: { projectId: string; navigate: (path: string) => void; onIssue?: ProjectIssueHandler }): React.ReactElement | null {
  const [got, setGot] = useState<{ id: string; read: AggregateRead<ProjectRequirementsResponse> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => { setGot(null); setAttempt((n) => n + 1); }, []);
  useEffect(() => {
    let live = true;
    void getProjectRequirements(projectId, { limit: 1 }).then((read) => { if (live) setGot({ id: projectId, read }); });
    return () => { live = false; };
  }, [projectId, attempt]);
  const read = got !== null && got.id === projectId ? got.read : null;
  // A failed read joins the page's one banner (UI-CONTRACT §4.7), whose Retry reads it again.
  const failedWhy = read?.state === 'failed' ? read.why : null;
  useEffect(() => {
    onIssue?.('requirements', failedWhy === null ? null : { what: 'requirements', error: failedWhy, retry });
    return () => onIssue?.('requirements', null);
  }, [failedWhy, retry, onIssue]);
  if (read?.state === 'absent') return null;
  const listHref = projectRequirementsPath(projectId);
  const totals = read?.state === 'ok' ? read.body.totals : null;
  const rows = read?.state === 'ok' ? read.body.rows : [];
  const withReqs = rows.filter((r) => r.state === 'ok' && r.corpus > 0).length;
  const line = totals === null ? null
    : totals.repos === 0 ? 'No repository attached yet, so no requirements to read.'
      // "None yet" only when every repository was read; otherwise the count is incomplete (codex on S5).
      : totals.total === 0 ? (totals.ok === totals.repos ? `No requirements yet in ${totals.repos === 1 ? 'its repository' : `its ${totals.repos} repositories`}.` : 'No requirements counted yet.')
        : `${totals.total} ${totals.total === 1 ? 'requirement' : 'requirements'} across ${withReqs} ${withReqs === 1 ? 'repository' : 'repositories'}`;
  // The repositories not counted, named (codex on S5): "no requirements map yet" is not a failure, so
  // it is said apart from a read that failed; the list page carries each one's reason and Retry.
  const unread = rows.filter((r) => r.state !== 'ok');
  const names = (rs: typeof rows): string => {
    const n = rs.map((r) => r.repo.name ?? r.repo.id);
    return n.length <= 2 ? n.join(' and ') : `${n.slice(0, 2).join(', ')} and ${n.length - 2} more`;
  };
  const noMap = unread.filter((r) => r.state === 'absent');
  const failed = unread.filter((r) => r.state !== 'absent');
  const unreadLine = [
    noMap.length > 0 ? `${names(noMap)} ${noMap.length === 1 ? 'has' : 'have'} no requirements map yet` : null,
    failed.length > 0 ? `${names(failed)} could not be read` : null,
  ].filter((x): x is string => x !== null).join(' · ');
  return (
    <section id="requirements" aria-labelledby="project-reqs-title" data-testid="project-requirements" className="wk-card">
      <div className="wk-desk-card-head">
        <h2 id="project-reqs-title" className="wk-section-title">Requirements</h2>
        {/* The list stays reachable while any repository is attached: it names each one's reason and Retry. */}
        {totals !== null && (totals.total > 0 || totals.ok < totals.repos) && (
          <a className="wk-link wk-desk-card-link" data-testid="project-requirements-link" href={listHref} onClick={(e) => { e.preventDefault(); navigate(listHref); }}>See the requirements</a>
        )}
      </div>
      {read === null ? <Skeleton rows={1} variant="line" /> : read.state === 'failed' ? (
        <>
          <p className="wk-pg-proj-note">The requirements could not be read.</p>
          {onIssue === undefined && <TechDetails text={read.why} />}
        </>
      ) : (
        <>
          <p data-testid="project-requirements-line" className="wk-pg-proj-note">{line}</p>
          {totals !== null && totals.repos > 0 && unreadLine !== '' && <p data-testid="project-requirements-unread" className="wk-field-note">{unreadLine}.</p>}
          {totals !== null && totals.total > 0 && (
            <div className="wk-pg-proj-actions">
              <button type="button" data-testid="project-draft-epics" className="wk-btn wk-btn--secondary"
                onClick={() => openLaunchWizard({ workflowId: DRAFT_EPICS_ID, projectId, composerKey: 'desk' })}>
                Draft epics
              </button>
              <span className="wk-field-note">Turns chosen requirements into a draft plan you review before anything is published.</span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
