import { useId, useMemo, useState } from 'react';
import type { Project, SessionView } from '../../api/types.js';
import { attentionRows } from '../../board/attention.js';
import { needRunId } from '../../board/deskModel.js';
import { repoNameOf } from '../../board/deskWords.js';
import { PROJECTS_PATH } from '../../board/navModel.js';
import type { NeedAction, NeedRow } from '../../board/needsYou.js';
import type { RepoUse } from '../../board/projectModel.js';
import { homeProgress, projectHomeSentence, weekWords } from '../../board/projectHome.js';
import { projectAttention, projectUnresolved } from '../../board/projectsModel.js';
import { preventsWork } from '../../board/nerveCenter.js';
import { tidyWords } from '../../board/nerveOverview.js';
import { actionPath, rowVerb, waitWords } from '../../board/rankedNeeds.js';
import { rowHeadline } from '../../board/rowHeadline.js';
import { UnfiledLine } from './UnfiledLine.js';
import { useSystemStore } from '../../store/systemSnapshot.js';
import { relTime } from '../../board/relTime.js';
import { sessionPath } from '../../board/sessionModel.js';
import { deskLiveCounts } from '../../board/statusWords.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { useNotificationStore } from '../../store/notifications.js';
import { setRetryPrefill } from '../../store/retryPrefill.js';
import { CalmHead, CalmLoading, CalmRow, CalmRows, CalmSection } from '../calm/Calm.js';
import { OverflowMenu, type MenuItem } from '../ui/OverflowMenu.js';
import { DESK_TABS, deskTabPath } from './DeskV2.js';

/** Needs you and In progress show at most this many rows; Needs you in full and the Jobs view have the rest. */
const ROWS_MAX = 5;

/** Needs you in full (every item, its moves, and the work to tidy up). */
const NEEDS_PATH = '/needs';

/** An older crew's fold: a failure older than this is not a needs-you item (the rule crew applies). */
const STALE_FAILURE_MS = 7 * 86_400_000;

const go = (navigate: Navigate, path: string) => (e: React.MouseEvent): void => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(path);
};

/** A need's own move, as the Desk's inbox makes it: open its page, or hand New job a prefill (nothing posts). */
function act(navigate: Navigate, a: NeedAction): void {
  if (a.kind === 'open') {
    if (a.ack !== undefined) { const { markRead } = useNotificationStore.getState(); for (const id of a.ack) markRead(id); }
    navigate(a.path);
    return;
  }
  if (a.kind === 'retry-prefill' || a.kind === 'reindex-prefill') { setRetryPrefill(a.prefill); navigate('/runs/new'); return; }
  navigate('/needs');
}

/** "Decide", "Retry", "Open": the move's own word, short. A gate is a decision. */
function moveWord(a: NeedAction, kind: NeedRow['kind']): string {
  if (kind === 'gate') return 'Decide';
  if (a.kind === 'retry-prefill') return 'Retry';
  if (a.kind === 'open') return /^approve|^review|^answer|^decide/i.test(a.label) ? 'Decide' : 'Open';
  return 'Open';
}

/**
 * A PROJECT'S HOME (`/projects/:id` with no `?tab=`; the operator-approved mockup `ui-v2-projects`): the
 * calm page. "← Projects", the title and one sentence, an ask box that starts a job in this project
 * (the one New job flow, the words carried in), Needs you, In progress (step x of y), the repositories
 * with "Add a repository", and one line about the week that links to the project's report.
 *
 * The project's views (Work and documents, Jobs, Repositories, Report…) keep their tabs at
 * `?tab=`; the foot names each of them, and the ⋯ holds the project's own moves (Documents, a
 * repository, Edit, Archive), so nothing the tabbed page did is out of reach.
 */
export function ProjectHome({ project, projectId, runs, allRuns, needRows, repos, now, known, loading, navigate, menu, isDefault }: {
  project: Project;
  projectId: string;
  /** This project's runs (its membership plus member runs the list no longer serves). */
  runs: SessionView[];
  /** Every run on the board (work in no project is filed from there). */
  allRuns: SessionView[];
  needRows: NeedRow[];
  repos: readonly RepoUse[];
  now: number;
  /** The runs read answered (and this project's own member reads settled). */
  known: boolean;
  loading: boolean;
  navigate: Navigate;
  /** The project's own moves, behind the header's ⋯. */
  menu: readonly MenuItem[];
  isDefault: boolean;
}): React.ReactElement {
  const askId = useId();
  const [ask, setAsk] = useState('');
  const base = projectDetailPath(projectId);
  const ids = useMemo(() => new Set(runs.map((v) => v.session.id)), [runs]);
  // THE NEEDS-YOU RULE, the rail's own source: a ranked crew's `attention[]` items whose run (or a run
  // they hold, `blockedRunIds`) is this project's. Failures older than a week and superseded work are
  // not there: they are crew's `unresolved[]`, folded into one "to tidy up" line with their spend.
  // An older crew: the board's fold, without failures older than a week. Until crew first answers, the
  // section is held (no number from the fold flashing before crew's).
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const crewPending = useSystemStore((s) => s.mode === 'unknown' && s.healthError === null);
  const items = useMemo(() => projectAttention(snapshot, ids), [snapshot, ids]);
  const tidy = useMemo(() => projectUnresolved(snapshot, ids), [snapshot, ids]);
  const tidySpend = tidy.some((u) => u.costUsd !== null) ? tidy.reduce((n, u) => n + (u.costUsd ?? 0), 0) : null;
  const folded = useMemo(() => attentionRows(needRows.filter((r) => {
    const id = needRunId(r);
    return id !== null && ids.has(id) && !(r.kind === 'failed-run' && r.at !== null && now - r.at > STALE_FAILURE_MS);
  })), [needRows, ids, now]);
  const waiting = items !== null ? items.length : folded.length;
  const held = useMemo(() => new Set(items !== null
    ? items.flatMap((a) => [a.runId, ...(a.blockedRunIds ?? [])]).filter((id): id is string => id != null)
    : folded.map(needRunId).filter((id): id is string => id !== null)), [items, folded]);
  const running = useMemo(() => deskLiveCounts(runs, held).working, [runs, held]);
  const progress = useMemo(() => homeProgress(runs, ROWS_MAX), [runs]);
  const shownRepos = repos.filter((u) => u.attached || u.jobs > 0);
  const ready = known && !crewPending;
  const sentence = projectHomeSentence({ known: ready, waiting, running, repos: shownRepos.length });
  const view = (row: NeedRow): SessionView | null => { const id = needRunId(row); return id === null ? null : runs.find((v) => v.session.id === id) ?? null; };
  const report = deskTabPath('report', undefined, base);
  const reposTab = deskTabPath('repositories', undefined, base);
  const jobs = deskTabPath('runs', undefined, base);

  const start = (e: React.FormEvent): void => {
    e.preventDefault();
    openLaunchWizard({ intent: ask.trim(), projectId: isDefault ? null : projectId, composerKey: 'desk' });
  };

  return (
    <div className="wk-calm wk-pj-home" data-testid="project-home" data-project-id={projectId}>
      <div className="wk-calm-col wk-pj-home-col">
        <div className="wk-pj-home-top">
          <a href={PROJECTS_PATH} onClick={go(navigate, PROJECTS_PATH)} className="wk-link wk-pj-back" data-testid="project-back"><span aria-hidden>←</span> Projects</a>
          <CalmHead title={isDefault ? 'Not in a project' : project.name} titleTestId="project-title" sentenceTestId="project-sentence" sentence={sentence}
            action={menu.length > 0 && !isDefault ? <span className="wk-calm-menu" data-testid="project-actions"><OverflowMenu label={`More actions for ${isDefault ? 'work not in a project' : project.name}`} items={menu} data-testid="project-menu" /></span> : undefined} />
          {project.description && !isDefault && <p className="wk-pj-home-desc" data-testid="project-desc" title={project.description}>{project.description}</p>}
        </div>

        {/* Work in no project is not a project: no ask box and no ⋯, one line that offers to file it. */}
        {isDefault
          ? <UnfiledLine runs={allRuns} needRows={needRows} />
          : <form className="wk-home-ask wk-pj-ask" role="search" aria-label="Start a job in this project" onSubmit={start} data-testid="project-ask">
            <label htmlFor={askId} className="sr-only">What do you want done in this project?</label>
            <input id={askId} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What do you want done in this project?"
              autoComplete="off" className="wk-home-ask-input" data-testid="project-ask-input" />
            <button type="submit" className="wk-calm-btn wk-calm-btn--primary" data-testid="project-ask-start">Start</button>
          </form>}

        {loading || !ready ? <CalmLoading rows={3} data-testid="project-home-loading" label="Reading this project’s jobs" /> : <>
          <CalmSection label="Needs you" data-testid="project-home-needs">
            {waiting === 0
              ? <p className="wk-calm-foot" data-testid="project-needs-calm">Nothing here is waiting on you.</p>
              : items !== null
                ? <CalmRows label="Needs you">
                  {items.slice(0, ROWS_MAX).map((a) => {
                    const runId = a.runId ?? a.blockedRunIds?.[0] ?? null;
                    const v = runId === null ? null : runs.find((x) => x.session.id === runId) ?? null;
                    const path = actionPath(a.action) ?? (runId !== null ? sessionPath(`run:${runId}`) : '/needs');
                    const gateKind = a.reason !== null && /deliver/i.test(a.reason) ? 'deliver' : null;
                    const sub = [a.reason, v !== null ? repoNameOf(v) : null, a.waitedSince != null ? `waiting ${waitWords(a.waitedSince, now)}` : null]
                      .filter((x): x is string => x !== null && x !== '').join(' · ');
                    return (
                      <CalmRow key={a.id} data-testid="project-need" data={{ key: a.id, kind: a.panel }}
                        tone={preventsWork(a) ? 'fail' : 'gate'} title={rowHeadline(a)} sub={sub === '' ? undefined : sub}
                        meta={<>{rowVerb(a, gateKind)} <span aria-hidden>→</span></>} metaTone="accent"
                        href={path} onOpen={() => navigate(path)} openTestId="project-need-open" />
                    );
                  })}
                </CalmRows>
                : <CalmRows label="Needs you">
                  {folded.slice(0, ROWS_MAX).map((row) => {
                    const v = view(row);
                    const path = row.action.kind === 'open' ? row.action.path : row.subjectPath;
                    const sub = [v !== null ? repoNameOf(v) : null, row.at !== null ? relTime(row.at, now) : null].filter((x): x is string => x !== null && x !== '').join(' · ');
                    return (
                      <CalmRow key={row.key} data-testid="project-need" data={{ key: row.key, kind: row.kind }}
                        tone={row.kind === 'failed-run' ? 'fail' : 'gate'} title={row.question ?? row.text} sub={sub === '' ? undefined : sub}
                        meta={<>{moveWord(row.action, row.kind)} <span aria-hidden>→</span></>} metaTone="accent"
                        href={path} onOpen={() => act(navigate, row.action)} openTestId="project-need-open" />
                    );
                  })}
                </CalmRows>}
            {waiting > ROWS_MAX && <a href={NEEDS_PATH} onClick={go(navigate, NEEDS_PATH)} className="wk-calm-more" data-testid="project-needs-more">{waiting - ROWS_MAX} more waiting <span aria-hidden>→</span></a>}
            {tidyWords(tidy.length, tidySpend) !== null && (
              <p className="wk-calm-foot wk-pj-tidy" data-testid="project-tidy" data-count={tidy.length}>
                {tidyWords(tidy.length, tidySpend)} · <a href={NEEDS_PATH} onClick={go(navigate, NEEDS_PATH)} className="wk-link" data-testid="project-tidy-open">Tidy up</a>
              </p>
            )}
          </CalmSection>

          <CalmSection label="In progress" data-testid="project-home-progress">
            {progress.rows.length === 0
              ? <p className="wk-calm-foot" data-testid="project-progress-quiet">Nothing is running here right now.</p>
              : <CalmRows label="In progress">
                {progress.rows.map((r) => {
                  const path = sessionPath(`run:${r.runId}`);
                  return <CalmRow key={r.runId} data-testid="project-progress-row" data={{ 'run-id': r.runId }} tone="run" title={r.title} sub={r.line}
                    meta="Working" metaTone="ok" href={path} onOpen={() => navigate(path)} />;
                })}
              </CalmRows>}
            {progress.total > progress.rows.length && <a href={jobs} onClick={go(navigate, jobs)} className="wk-calm-more" data-testid="project-progress-more">{progress.total - progress.rows.length} more in progress <span aria-hidden>→</span></a>}
          </CalmSection>
        </>}

        {!isDefault && (
          <CalmSection label="Repositories" data-testid="project-home-repos">
            <div className="wk-pj-chips wk-pj-chips--home">
              {shownRepos.map((u) => u.repo !== null
                ? <a key={u.ref} href={`/repo-detail/${encodeURIComponent(u.repo.id)}`} onClick={go(navigate, `/repo-detail/${encodeURIComponent(u.repo.id)}`)} className="wk-pj-chip wk-pj-chip--link" data-testid="project-repo-chip" data-attached={u.attached}>{u.name}</a>
                : <span key={u.ref} className="wk-pj-chip" data-testid="project-repo-chip" data-attached={u.attached}>{u.name}</span>)}
              <a href={reposTab} onClick={go(navigate, reposTab)} className="wk-link wk-pj-add" data-testid="project-add-repo">{shownRepos.length === 0 ? 'Attach a repository' : 'Add a repository'}</a>
            </div>
          </CalmSection>
        )}

        <div className="wk-pj-home-foot">
          {known && (
            <p className="wk-calm-foot" data-testid="project-week">
              {weekWords(runs, now)} · <a href={report} onClick={go(navigate, report)} className="wk-link" data-testid="project-week-report">Project report</a>
            </p>
          )}
          <nav aria-label="Everything in this project" className="wk-pj-views" data-testid="project-views">
            <span className="wk-pj-views-label">Everything in this project:</span>
            {DESK_TABS.map((t) => {
              const path = deskTabPath(t.id, undefined, base);
              return <a key={t.id} href={path} onClick={go(navigate, path)} className="wk-link" data-testid="project-view" data-tab={t.id}>{t.id === 'work' ? 'Work and documents' : t.label}</a>;
            })}
          </nav>
        </div>
      </div>
    </div>
  );
}
