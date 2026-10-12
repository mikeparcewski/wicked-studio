import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, MessageSquare, Plus } from 'lucide-react';
import { api } from '../api/client.js';
import { readErrorKind } from '../api/errors.js';
import type { ProjectDetail, ProjectMember, RepoEntry, SessionView } from '../api/types.js';
import { useProjectsStore } from '../store/projects.js';
import { ProjectRepositories } from './ProjectRepositories.js';
import { ProjectDocumentsRoot } from './ProjectDocumentsRoot.js';
import { ProjectRequirementsSection } from './product/ProjectRequirementsSection.js';
import { ProjectCoverage, ProjectDomain, type ProjectReadIssue, type ProjectIssueHandler } from './product/ProjectAggregates.js';
import { everythingPath } from '../board/everythingModel.js';
import { sessionIdOf, sessionPath, sessionTitle } from '../board/sessionModel.js';
import { relTime } from '../board/relTime.js';
import { durationWords, jobLanes, moneyWords, pulse, stories, WINDOWS, windowWords, type WindowDays } from '../board/deskPulse.js';
import { newestFirst, projectMeta, projectNeeds, projectRuns, reposUsed, stateCounts } from '../board/projectModel.js';
import { createdAtWindow } from '../board/windowStats.js';
import { displaySeats, seatLabel } from '../board/seatNames.js';
import type { NeedRow } from '../board/needsYou.js';
import { useCapabilities } from '../store/capabilities.js';
import { fetchReposCached, getCachedRepos } from '../store/repoCache.js';
import { openLaunchWizard } from '../store/launchWizard.js';
import { openAskDock } from '../store/askDock.js';
import { useRoster } from '../hooks/useRoster.js';
import { useWindowSpend } from '../hooks/useWindowSpend.js';
import { useQualityChecks } from '../hooks/useQualityChecks.js';
import { SectionTitle } from './ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from './ui/StateBanner.js';
import { StatBand, StatTile } from './ui/StatTile.js';
import { TechDetails } from './ui/TechDetails.js';
import { OverflowMenu } from './ui/OverflowMenu.js';
import { Segmented } from './ui/Segmented.js';
import { NeedsQueueSurface } from './NeedsYouQueue.js';
import { StepLegend, StepTrack } from './desk/Desk.js';

const RUN_KIND = 'crew.run';
/** At most this many run members the run list does not serve are read one by one. */
const MISSING_READ_CAP = 60;
const REPO_KIND = 'crew.repo';

/** What a first job is for: the five starts the first-run state teaches. Each opens the wizard on its
 *  kind of job (the daemon's workflow ids), except a question, which is a chat in this project. */
const FIRST_JOBS: readonly { label: string; workflowId: string | null; chat?: true }[] = [
  { label: 'Fix a bug', workflowId: 'bug' },
  { label: 'Build a feature', workflowId: 'feature' },
  { label: 'Ask a question about the code', workflowId: null, chat: true },
  { label: 'Learn from a repository', workflowId: 'learn' },
  { label: 'Plan tests', workflowId: 'qe-author-tests' },
];

function OtherMemberRow({ member, onDetach, navigate }: { member: ProjectMember; onDetach: (id: string) => void; navigate: (path: string) => void }): React.ReactElement {
  const isChat = member.member_kind === 'crew.chat';
  const [title, setTitle] = useState(isChat ? 'Chat' : member.member_kind === 'crew.workflow' ? 'Attached workflow' : 'Attached document');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!isChat) return;
    let live = true;
    api.getChat(member.member_ref).then((chat) => {
      if (live && (chat.messages ?? []).some((m) => m.kind === 'user' && m.text?.trim())) setTitle(sessionTitle(chat.messages ?? [], []));
    }, () => undefined);
    return () => { live = false; };
  }, [isChat, member.member_ref]);
  const href = sessionPath(member.member_ref);
  return (
    <li data-testid="project-member-row" data-kind={member.member_kind} className="wk-list-row wk-pg-proj-row">
      <div>
        {isChat ? <a className="wk-link wk-list-row-title" href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>{title}</a> : <span className="wk-list-row-title">{title}</span>}
        <p className="wk-list-row-meta" title={new Date(member.attached_at).toLocaleString()}>Added {relTime(member.attached_at)}</p>
      </div>
      <div className="wk-list-row-actions">
        {busy ? <p className="wk-field-note">Removing…</p> : (
          <OverflowMenu label={`More actions for ${title}`} items={[{ id: 'detach', label: 'Remove from project', danger: true, onSelect: () => { setBusy(true); onDetach(member.id); } }]} />
        )}
      </div>
    </li>
  );
}

interface Props {
  projectId: string;
  navigate: (path: string) => void;
  /** The runs App already holds: the project's jobs are read from here, no per-row read. */
  runs?: readonly SessionView[];
  /** The app's needs-you rows: the project's decisions and failures are the ones naming its runs. */
  needRows?: readonly NeedRow[];
  now?: number;
}

const NO_RUNS: readonly SessionView[] = [];
const NO_NEEDS: readonly NeedRow[] = [];
const NO_MEMBERS: ProjectMember[] = [];

/**
 * THE PROJECT DASHBOARD (DES-frontdoor concept P; operator decision 2026-10-12): `/projects/:id`.
 * A breadcrumb, the name and its facts; quick actions (New job in this project, Chat in this project,
 * Open repository, Documents, and ⋯ Edit / Archive); "How it's going" (`ui/StatTile`, 7/30/90 days):
 * jobs by state, started, delivered, quality checks passed, typical time to finish, spend; "Needs you
 * here"; the jobs with step tracks; repositories the jobs used beside the attached ones (Attach);
 * what happened here; documents; coverage and domains. A quiet window says so; a project with no
 * work and no repository teaches its first three steps instead of showing empty boxes.
 */
export function ProjectDetailPage({ projectId, navigate, runs = NO_RUNS, needRows = NO_NEEDS, now: nowProp }: Props): React.ReactElement {
  const now = nowProp ?? Date.now();
  const { updateProject } = useProjectsStore();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [days, setDays] = useState<WindowDays>(30);
  const [descOpen, setDescOpen] = useState(false);
  const [register, setRegister] = useState<RepoEntry[] | null>(getCachedRepos());

  const isDefault = projectId === 'default';
  const project = detail?.project ?? null;
  const members = detail?.members ?? NO_MEMBERS;
  const [issues, setIssues] = useState<Record<string, ProjectReadIssue>>({});
  const onIssue = useCallback<ProjectIssueHandler>((key, issue) => {
    setIssues((old) => { const next = { ...old }; if (issue === null) delete next[key]; else next[key] = issue; return next; });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getProject(projectId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);
  // `/projects/:id#requirements` (the retired /product address lands here): bring the section into view.
  // The hash is read on each render (the /product redirect changes the path, so it re-renders) and on
  // hashchange/popstate (Back or Forward between hash entries changes no path; codex on S5 r2). No in-app
  // link navigates hash-only to the anchor.
  const [hashTick, setHashTick] = useState(0);
  useEffect(() => {
    const on = (): void => setHashTick((n) => n + 1);
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  useEffect(() => {
    if (loading || hash !== '#requirements') return;
    const t = setTimeout(() => document.getElementById('requirements')?.scrollIntoView({ block: 'start' }), 300);
    return () => clearTimeout(t);
  }, [loading, hash, hashTick]);

  // A run member the run list does not serve (an archived run, an older one) is read on its own, so the
  // project shows every job it holds (the page read each member's run before concept P too).
  const [extra, setExtra] = useState<{ key: string; runs: SessionView[]; failed: number }>({ key: '', runs: [], failed: 0 });
  const missingAll = useMemo(() => members.filter((m) => m.member_kind === RUN_KIND && !runs.some((v) => v.session.id === m.member_ref)).map((m) => m.member_ref), [members, runs]);
  const missing = missingAll.slice(0, MISSING_READ_CAP);
  const missingKey = missing.join('\u0000');
  useEffect(() => {
    if (missingKey === '') { setExtra({ key: '', runs: [], failed: 0 }); return; }
    let live = true;
    void Promise.all(missingKey.split('\u0000').map((id) => Promise.resolve().then(() => api.getRun(id)).then((r) => r.run, () => null)))
      .then((got) => { if (live) setExtra({ key: missingKey, runs: got.filter((v): v is SessionView => v !== null), failed: got.filter((v) => v === null).length }); });
    return () => { live = false; };
  }, [missingKey]);
  // Jobs the page could not show (a failed read, or past the read cap): said, never silently dropped.
  const unshown = extra.key === missingKey ? extra.failed + (missingAll.length - missing.length) : 0;
  const allRuns = useMemo(() => (extra.runs.length === 0 ? runs : [...runs, ...extra.runs.filter((x) => !runs.some((v) => v.session.id === x.session.id))]), [runs, extra]);
  const mine = useMemo(() => projectRuns(allRuns, members, projectId), [allRuns, members, projectId]);
  const mineIds = useMemo(() => new Set(mine.map((v) => v.session.id)), [mine]);
  // The membership is the truth for how many jobs a project holds, even one the run list no longer serves.
  const jobsCount = useMemo(() => new Set([...mineIds, ...members.filter((m) => m.member_kind === RUN_KIND).map((m) => m.member_ref)]).size, [mineIds, members]);
  // The register names the repositories the jobs used: read (the one shared cache) only when a job used one.
  const needsRegister = register === null && (members.some((m) => m.member_kind === REPO_KIND) || mine.some((v) => typeof v.session.repo_ref === 'string' && v.session.repo_ref !== ''));
  useEffect(() => { if (needsRegister) fetchReposCached().then(setRegister, () => setRegister([])); }, [needsRegister]);
  const used = useMemo(() => reposUsed(mine, members, register ?? getCachedRepos() ?? []), [mine, members, register]);
  const needs = useMemo(() => projectNeeds(needRows, mineIds), [needRows, mineIds]);
  const p = useMemo(() => pulse(mine, days, now), [mine, days, now]);
  const states = useMemo(() => stateCounts(mine), [mine]);
  const inWindow = useMemo(() => newestFirst(createdAtWindow([...mine], days, now).current).map((v) => v.session.id), [mine, days, now]);
  const workPrint = String(mine.reduce((n, v) => n + (v.units ?? []).filter((u) => u.status === 'done').length, 0)) + mine.map((v) => v.session.status).join('');
  const quality = useQualityChecks(inWindow, workPrint);
  // Spend is read per project; the unfiled shelf has no project to scope it to, so it is not shown there.
  const spend = useWindowSpend(days, projectId, workPrint, !isDefault);
  const runChatId = useCapabilities((s) => s.runChatId);
  const roster = useRoster();
  const helperName = useCallback((cli: string): string | null => {
    const seat = displaySeats(roster).find((s) => s.key === cli);
    return seat === undefined ? null : seatLabel(seat);
  }, [roster]);
  const pathOf = useCallback((v: SessionView): string => sessionPath(sessionIdOf(v, runChatId)), [runChatId]);
  const lanes = useMemo(() => jobLanes(mine, now, { max: 12, projectName: () => null, pathOf, includeUndated: true }), [mine, now, pathOf]);
  const feed = useMemo(() => stories(mine, { max: 6, helperName }), [mine, helperName]);
  const others = members.filter((m) => m.member_kind !== RUN_KIND && m.member_kind !== REPO_KIND);
  const hasPrev = mine.some((v) => typeof v.session.created_at === 'number' && v.session.created_at * 1000 < now - days * 86_400_000);
  const firstRun = !loading && project !== null && !isDefault && jobsCount === 0 && !members.some((m) => m.member_kind === REPO_KIND);
  const quiet = !firstRun && mine.length > 0 && p.started.count === 0;
  const lastEnded = mine.map((v) => v.session.ended_at).filter((t): t is number => typeof t === 'number');
  const openFailures = needs.filter((r) => r.kind === 'failed-run').length;

  function startEdit(): void {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description ?? '');
    setEditErr(null);
    setEditing(true);
  }
  async function saveEdit(): Promise<void> {
    if (!project) return;
    const trimName = editName.trim();
    if (!trimName) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const { project: updated } = await api.updateProject(project.id, { name: trimName, description: editDesc.trim() });
      setDetail((d) => d ? { ...d, project: updated } : d);
      updateProject(updated);
      setEditing(false);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : String(e));
    } finally {
      setEditBusy(false);
    }
  }
  async function toggleArchive(): Promise<void> {
    if (!project || isDefault) return;
    setArchiveBusy(true);
    try {
      const { project: updated } = await api.updateProject(project.id, { status: project.status === 'active' ? 'archived' : 'active' });
      setDetail((d) => d ? { ...d, project: updated } : d);
      updateProject(updated);
    } catch (e) {
      setEditErr(e instanceof Error ? e.message : String(e));
    } finally {
      setArchiveBusy(false);
    }
  }
  function handleDetach(memberId: string): void {
    if (!project) return;
    void api.detachProjectMember(project.id, memberId).catch(() => {});
    setDetail((d) => d ? { ...d, members: d.members.filter((m) => m.id !== memberId) } : d);
  }

  const childIssues = Object.values(issues);
  const failures = [...(error !== null ? [{ what: 'project details', error, retry: () => void load() }] : []),
    ...(editErr !== null ? [{ what: 'project changes', error: editErr, retry: () => setEditErr(null) }] : []), ...childIssues];
  const failure = failures.find((f) => readErrorKind(f.error) === 'offline') ?? failures[0];
  const backHref = everythingPath({ tab: 'projects' });
  // The unfiled shelf's list is See everything › Projects (the rail's door for it); a project filters Sessions.
  const allJobsHref = isDefault ? everythingPath({ tab: 'projects' }) : everythingPath({ tab: 'sessions', project: projectId });
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const newJob = (workflowId: string | null = null): void => openLaunchWizard({ projectId: isDefault ? null : projectId, workflowId, composerKey: 'desk' });
  const chatHere = (): void => openAskDock({ projectId: isDefault ? null : projectId });
  const scrollTo = (id: string): void => document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const attachedRepos = used.filter((u) => u.repo !== null);
  const title = isDefault ? 'Not in a project' : project?.name ?? 'Project';
  const statesTotal = states.reduce((n, s) => n + s.count, 0);
  const qualityValue = quality.tally === null ? null : quality.tally.recorded === 0 ? null : `${quality.tally.passed} of ${quality.tally.recorded}`;
  const qualityNote = quality.tally === null ? 'Reading checks…'
    : quality.failed > 0 && quality.tally.read === 0 ? 'Checks could not be read'
    : quality.failed > 0 ? `${quality.failed} could not be read; ${quality.tally.recorded === 0 ? 'none recorded for the rest' : 'of the rest'}`
    : quality.tally.recorded === 0 ? (inWindow.length === 0 ? `no jobs in ${windowWords(days)}` : quality.capped ? `no checks recorded for the newest ${quality.tally.read} jobs` : `no checks recorded for these ${inWindow.length} ${inWindow.length === 1 ? 'job' : 'jobs'}`)
      : quality.capped ? `of the newest ${quality.tally.read} jobs` : 'checks passed of those recorded';
  const spendNote = isDefault ? 'Spend is counted per project'
    : spend.phase === 'loading' ? 'Reading spend…'
    : spend.current === null ? 'Not available yet: Health shows how to update Studio'
      : spend.partial ? 'at least: some helpers report no price'
        : spend.previous !== null ? `${moneyWords(spend.previous)} the ${days} days before` : 'no earlier spend to compare';

  return (
    <div data-testid="project-dashboard" data-project-id={projectId} className="wk-page wk-proj">
      <nav aria-label="Breadcrumb" className="wk-proj-crumbs">
        <a className="wk-link" href={backHref} onClick={go(backHref)}>Projects</a>
        <span aria-hidden> / </span>
        <span aria-current="page">{title}</span>
      </nav>
      <header className="wk-proj-head">
        <div className="wk-proj-head-text">
          <h1 className="wk-page-title">{title}</h1>
          {project !== null && (
            <p data-testid="project-meta" className="wk-proj-meta">
              {project.status === 'archived' && <span className="wk-tag">Archived</span>}{project.status === 'archived' ? ' ' : ''}
              {projectMeta(project.created_at > 0 ? `Created ${relTime(project.created_at, now)}` : null, jobsCount, used)}
            </p>
          )}
          {project?.description ? <>
            <p data-testid="project-desc" className={`wk-proj-desc${descOpen || project.description.length <= 220 ? '' : ' wk-proj-desc--clamped'}`}>{project.description}</p>
            {project.description.length > 220 && <button type="button" className="wk-link wk-proj-desc-toggle" aria-expanded={descOpen} onClick={() => setDescOpen((v) => !v)}>{descOpen ? 'Show less' : 'Show all'}</button>}
          </> : null}
        </div>
        {project !== null && !editing && (
          <div className="wk-proj-actions" data-testid="project-actions">
            <button type="button" data-testid="project-new-job" className="wk-btn wk-btn--primary" onClick={() => newJob()}><Plus size={14} aria-hidden />New job</button>
            <button type="button" data-testid="project-chat" className="wk-btn wk-btn--secondary" onClick={chatHere}><MessageSquare size={14} aria-hidden />Chat in this project</button>
            {attachedRepos.length > 0 && (
              <OverflowMenu
                label="Open a repository this project uses"
                text="Open repository"
                tone="secondary"
                items={attachedRepos.map((u) => ({ id: u.ref, label: u.name, onSelect: () => navigate(`/repo-detail/${encodeURIComponent(u.repo!.id)}`) }))}
                data-testid="project-open-repo"
              />
            )}
            <button type="button" data-testid="project-documents" className="wk-btn wk-btn--secondary" onClick={() => scrollTo('project-documents')}><FileText size={14} aria-hidden />Documents</button>
            {!isDefault && (
              <span className="wk-proj-more"><OverflowMenu label={`More actions for ${title}`} items={[
                { id: 'edit', label: 'Edit name and description', onSelect: startEdit },
                { id: 'archive', label: project.status === 'active' ? 'Archive this project' : 'Restore this project', onSelect: () => void toggleArchive(), disabled: archiveBusy ? 'Saving the project’s status…' : null },
              ]} /></span>
            )}
          </div>
        )}
      </header>
      {failure && <StateBanner kind={readErrorKind(failure.error)} what={failure.what} error={failures.map((f) => f.error).join('\n')} onRetry={() => failures.forEach((f) => f.retry())} retrying={loading} />}

      {loading ? <Skeleton rows={3} variant="card" /> : !project ? !error && <EmptyState title="Project not found" /> : <>
        {editing && <section className="wk-card wk-pg-proj-stack">
          <SectionTitle>Edit project</SectionTitle>
          <label className="wk-pg-proj-field">Project name<input type="text" className="wk-field" value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} autoFocus /></label>
          <label className="wk-pg-proj-field">Description<textarea className="wk-field" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="Describe this project" /></label>
          <div className="wk-pg-proj-actions"><button type="button" className="wk-btn wk-btn--primary" onClick={() => void saveEdit()} disabled={editBusy || !editName.trim()}>{editBusy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="wk-btn wk-btn--quiet" onClick={() => setEditing(false)}>Cancel</button></div>
          {(editBusy || !editName.trim()) && <p className="wk-field-note">{editBusy ? 'Saving your changes…' : 'Enter a project name to save.'}</p>}
        </section>}

        {firstRun ? (
          <section data-testid="project-first-run" aria-labelledby="project-first-title" className="wk-proj-first">
            <div className="wk-card wk-proj-first-steps">
              <h2 id="project-first-title" className="wk-section-title">Get this project going</h2>
              <ol className="wk-proj-steps">
                <li>
                  <span className="wk-proj-step-title">Attach the repositories it works in</span>
                  <span className="wk-proj-step-line">Jobs in this project read and change their code. Attach them below, under Repositories and branches.</span>
                  <button type="button" className="wk-link" onClick={() => scrollTo('project-repos')}>Go to repositories</button>
                </li>
                <li>
                  <span className="wk-proj-step-title">Start the first job</span>
                  <span className="wk-proj-step-line">Pick what it is; the wizard asks for the rest.</span>
                  <span className="wk-proj-chips">
                    {FIRST_JOBS.map((j) => <button key={j.label} type="button" data-testid="project-first-job" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => (j.chat === true ? chatHere() : newJob(j.workflowId))}>{j.label}</button>)}
                  </span>
                </li>
                <li>
                  <span className="wk-proj-step-title">Answer it when it asks</span>
                  <span className="wk-proj-step-line">A job stops for your yes before it changes anything. Its questions show here and on the Desk.</span>
                </li>
              </ol>
            </div>
            <div className="wk-card wk-proj-first-preview" aria-label="What you will see here">
              <h2 className="wk-section-title">What you’ll see here</h2>
              <p className="wk-proj-step-line">Once work starts: jobs by state, how many started, delivered, quality checks passed, the typical time to finish, and spend.</p>
            </div>
          </section>
        ) : (
          <section aria-labelledby="project-band-title" className="wk-proj-band">
            <div className="wk-desk-band-head">
              <h2 id="project-band-title" className="wk-section-title">How it’s going</h2>
              <Segmented label="Window" data-testid="project-window" value={String(days) as `${WindowDays}`}
                options={WINDOWS.map((d) => ({ value: String(d) as `${WindowDays}`, label: `${d} days`, testId: `project-window-${d}` }))}
                onChange={(v) => setDays(Number(v) as WindowDays)} />
            </div>
            {quiet && (
              <div data-testid="project-quiet" className="wk-proj-quiet" role="status">
                <span>
                  {`A quiet stretch here: no jobs started in ${windowWords(days)}`}
                  {lastEnded.length > 0 ? `; the last one ended ${relTime(Math.max(...lastEnded) * 1000, now)}` : ''}.
                  {openFailures > 0 ? ` ${openFailures} ${openFailures === 1 ? 'failure is' : 'failures are'} still open below.` : ''}
                </span>
                <button type="button" className="wk-btn wk-btn--secondary wk-btn--sm" onClick={() => newJob()}>New job</button>
              </div>
            )}
            <StatBand label={`How it’s going, ${windowWords(days)}`} data-testid="project-band">
              <div data-testid="project-stat-states" className="wk-stat">
                <span className="wk-stat-label">Jobs by state, all time</span>
                <span data-testid="stat-value" className="wk-stat-value">{statesTotal}</span>
                <span className="wk-stat-note">{states.filter((s) => s.count > 0).map((s) => `${s.count} ${s.label}`).join(' · ') || 'no jobs yet'}</span>
                {statesTotal > 0 && (
                  <span className="wk-proj-stack" role="img" aria-label={states.filter((s) => s.count > 0).map((s) => `${s.count} ${s.label}`).join(', ')}>
                    {states.filter((s) => s.count > 0).map((s) => <i key={s.key} data-tone={s.tone} style={{ flexGrow: s.count }} />)}
                  </span>
                )}
              </div>
              <StatTile data-testid="project-stat-started" label={`Started, last ${days} days`} value={p.started.count}
                delta={hasPrev ? { current: p.started.count, previous: p.started.previous, versus: `vs the ${days} days before` } : null}
                note={hasPrev ? null : `no jobs before the last ${days} days to compare`} />
              <StatTile data-testid="project-stat-delivered" label="Delivered" value={p.delivered} note={p.delivered === 0 ? `nothing delivered in ${windowWords(days)}` : null} />
              <StatTile data-testid="project-stat-quality" label="Quality checks passed" value={qualityValue} note={qualityNote} />
              <StatTile data-testid="project-stat-typical" label="Typical time to finish" value={p.typicalMin === null ? null : durationWords(p.typicalMin)}
                note={p.typicalMin === null ? `no job finished in ${windowWords(days)}` : `median of ${p.typicalOf} that finished`} />
              <StatTile data-testid="project-stat-spend" label={`Spend, last ${days} days`} value={isDefault || spend.current === null ? null : moneyWords(spend.current)} note={spendNote}
                {...(!isDefault && spend.phase === 'done' && spend.current === null ? { href: '/health', onOpen: go('/health') } : {})} />
            </StatBand>
          </section>
        )}

        <div className="wk-proj-body">
          <div className="wk-proj-main">
            {needs.length > 0 && (
              <div className="wk-card" data-testid="project-needs">
                <NeedsQueueSurface rows={needs as NeedRow[]} runs={runs as SessionView[]} navigate={navigate} now={now} />
              </div>
            )}
            {unshown > 0 && (
              <StateBanner data-testid="project-jobs-unshown" kind="partial" what={unshown === 1 ? '1 job in this project' : `${unshown} jobs in this project`} />
            )}
            {mine.length > 0 && (
              <section aria-labelledby="project-jobs-title" data-testid="project-jobs" className="wk-card">
                <div className="wk-desk-card-head">
                  <h2 id="project-jobs-title" className="wk-section-title">Jobs</h2>
                  <a className="wk-link wk-desk-card-link" href={allJobsHref} onClick={go(allJobsHref)}>{isDefault ? 'All work not in a project' : 'All jobs in this project'}</a>
                </div>
                <ul className="wk-desk-lanes" aria-label="This project’s jobs">
                  {lanes.map((l) => {
                    const member = members.find((m) => m.member_kind === RUN_KIND && m.member_ref === l.runId);
                    return (
                      <li key={l.runId} data-testid="project-job" data-run-id={l.runId} className="wk-desk-lane wk-proj-lane">
                        <div className="wk-desk-lane-text">
                          <a href={l.path} onClick={go(l.path)} title={l.fullTitle} className="wk-desk-lane-title">{l.title}</a>
                          {l.context !== '' && <span className="wk-desk-lane-meta">{l.context}</span>}
                        </div>
                        <StepTrack steps={l.steps} />
                        <span className="wk-desk-lane-word"><span aria-hidden className="wk-status-dot" data-status={l.tone} /> {l.word}</span>
                        {member !== undefined && !isDefault
                          ? <OverflowMenu label={`More actions for ${l.title}`} items={[{ id: 'detach', label: 'Remove from project', danger: true, onSelect: () => handleDetach(member.id) }]} />
                          : <span aria-hidden />}
                      </li>
                    );
                  })}
                </ul>
                <StepLegend />

              </section>
            )}
            {!isDefault && <div id="project-repos"><ProjectRepositories projectId={projectId} members={members} used={used} onIssue={onIssue} onMembersChange={(update) => setDetail((d) => d !== null && d.project.id === projectId ? { ...d, members: update(d.members) } : d)} /></div>}
            {!isDefault && <ProjectRequirementsSection projectId={projectId} navigate={navigate} onIssue={onIssue} />}
            {others.length > 0 && (
              <section className="wk-card" aria-labelledby="project-others-title">
                <h2 id="project-others-title" className="wk-section-title">Chats and other items</h2>
                <ul className="wk-pg-proj-list">{others.map((m) => <OtherMemberRow key={m.id} member={m} onDetach={handleDetach} navigate={navigate} />)}</ul>
              </section>
            )}
          </div>
          <aside className="wk-proj-side" aria-label="About this project">
            {feed.length > 0 && (
              <section aria-labelledby="project-feed-title" data-testid="project-feed" className="wk-card">
                <h2 id="project-feed-title" className="wk-section-title">What happened here</h2>
                <ul className="wk-desk-feed">
                  {feed.map((s) => {
                    const v = mine.find((x) => x.session.id === s.runId);
                    const href = v === undefined ? sessionPath(`run:${s.runId}`) : pathOf(v);
                    return (
                      <li key={s.key} className="wk-desk-feed-row">
                        <span aria-hidden className="wk-status-dot" data-status={s.tone} />
                        <span className="wk-desk-feed-text">
                          <span className="wk-desk-feed-sentence"><a href={href} onClick={go(href)} title={s.fullTitle} className="wk-desk-feed-title">{s.title}</a> {s.verb}{s.count > 1 ? `, ${s.count} times` : ''}.</span>
                          <span className="wk-desk-feed-meta">{[relTime(s.at, now), s.detail].filter((x) => x !== '').join(' · ')}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div id="project-documents"><ProjectDocumentsRoot projectId={projectId} project={project} onIssue={onIssue} onChanged={(updated) => setDetail((d) => d !== null && d.project.id === updated.id ? { ...d, project: updated } : d)} /></div>
            {/* Coverage and domains are about attached code: with none attached they would be empty boxes. */}
            {!isDefault && members.some((m) => m.member_kind === REPO_KIND) && <><ProjectCoverage projectId={projectId} navigate={navigate} onIssue={onIssue} /><ProjectDomain projectId={projectId} navigate={navigate} onIssue={onIssue} /></>}
          </aside>
        </div>
        {isDefault && <TechDetails summary="About this list" text="Work no project holds. Move a job into a project from the rail, or start one from a project." />}
      </>}
    </div>
  );
}
