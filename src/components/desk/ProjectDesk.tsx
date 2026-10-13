import { scrollBehavior } from '../ui/motion.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, MessageSquare, Plus } from 'lucide-react';
import { api } from '../../api/client.js';
import { readErrorKind } from '../../api/errors.js';
import type { ProjectDetail, ProjectMember, RepoEntry, SessionView } from '../../api/types.js';
import type { NeedRow } from '../../board/needsYou.js';
import { projectMeta, projectRuns, reposUsed } from '../../board/projectModel.js';
import { sessionPath, sessionTitle } from '../../board/sessionModel.js';
import { relTime } from '../../board/relTime.js';
import { useProjectsStore } from '../../store/projects.js';
import { fetchReposCached, getCachedRepos } from '../../store/repoCache.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { openAskDock } from '../../store/askDock.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { ProjectRepositories } from '../ProjectRepositories.js';
import { ProjectDocumentsRoot } from '../ProjectDocumentsRoot.js';
import { ProjectRequirementsSection } from '../product/ProjectRequirementsSection.js';
import { ProjectCoverage, ProjectDomain, type ProjectReadIssue, type ProjectIssueHandler } from '../product/ProjectAggregates.js';
import { SectionTitle } from '../ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from '../ui/StateBanner.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { DeskV2, deskTabPath, type HostedTab } from './DeskV2.js';

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
  navigate: Navigate;
  runs: SessionView[];
  needRows: NeedRow[];
  now: number;
  search: string;
  onRetryRuns?: () => void;
  runsLoaded: boolean;
  runsError?: string | null;
  hosted?: (tab: HostedTab, at: string, project: string | null) => React.ReactNode;
  onCommand?: () => void;
}

const NO_MEMBERS: ProjectMember[] = [];

/** A project's page is the shared Desk with its own runs, header and Work sections. */
export function ProjectDesk({ projectId, navigate, runs, needRows, now, search, onRetryRuns, runsLoaded, runsError, hosted, onCommand }: Props): React.ReactElement {
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
  const [register, setRegister] = useState<RepoEntry[] | null>(getCachedRepos());

  const isDefault = projectId === 'default';
  const project = detail?.project?.id === projectId ? detail.project : null;
  const members = project !== null ? detail?.members ?? NO_MEMBERS : NO_MEMBERS;
  const [issues, setIssues] = useState<Record<string, ProjectReadIssue>>({});
  const onIssue = useCallback<ProjectIssueHandler>((key, issue) => {
    setIssues((old) => { const next = { ...old }; if (issue === null) delete next[key]; else next[key] = issue; return next; });
  }, []);

  const loadVersion = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    setError(null);
    try {
      const loaded = await api.getProject(projectId);
      if (loadVersion.current === version) setDetail(loaded);
    } catch (e) {
      if (loadVersion.current === version) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (loadVersion.current === version) setLoading(false);
    }
  }, [projectId]);
  useEffect(() => {
    setEditing(false);
    setEditErr(null);
    setIssues({});
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);
  const base = projectDetailPath(projectId);
  const tab = new URLSearchParams(search).get('tab') ?? 'work';
  const [hashTick, setHashTick] = useState(0);
  const [scrollTarget, setScrollTarget] = useState<string | null>(null);
  useEffect(() => {
    const on = (): void => setHashTick((n) => n + 1);
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  const hash = window.location.hash;
  useEffect(() => {
    const target = hash === '#project-repos' ? 'repositories'
      : hash === '#requirements' || hash === '#project-documents' ? 'work' : null;
    if (target === null) return;
    if (target === 'repositories') {
      navigate(deskTabPath('repositories', undefined, base), { replace: true });
    } else if (tab !== 'work') {
      navigate(`${deskTabPath('work', undefined, base)}${hash}`, { replace: true });
    }
  }, [base, hash, hashTick, tab, navigate]);
  useEffect(() => {
    if (loading || tab !== 'work') return;
    const id = scrollTarget ?? (hash === '#requirements' || hash === '#project-documents' ? hash.slice(1) : null);
    if (id === null) return;
    const timer = setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ block: 'start', behavior: scrollBehavior() });
      setScrollTarget(null);
    }, 300);
    return () => clearTimeout(timer);
  }, [loading, tab, hash, hashTick, scrollTarget]);

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
  // The project's job list is read only when its own member reads have settled too (Happening's one
  // backfill per scope, the Runs stats and the Report would otherwise start from a partial list).
  const membersRead = missingKey === '' || extra.key === missingKey;
  const allRuns = useMemo(() => (extra.key !== missingKey || extra.runs.length === 0 ? runs : [...runs, ...extra.runs.filter((x) => !runs.some((v) => v.session.id === x.session.id))]), [runs, extra, missingKey]);
  const mine = useMemo(() => projectRuns(allRuns, members, projectId), [allRuns, members, projectId]);
  const mineIds = useMemo(() => new Set(mine.map((v) => v.session.id)), [mine]);
  // The membership is the truth for how many jobs a project holds, even one the run list no longer serves.
  const jobsCount = useMemo(() => new Set([...mineIds, ...members.filter((m) => m.member_kind === RUN_KIND).map((m) => m.member_ref)]).size, [mineIds, members]);
  // The register names the repositories the jobs used: read (the one shared cache) only when a job used one.
  const needsRegister = register === null && (members.some((m) => m.member_kind === REPO_KIND) || mine.some((v) => typeof v.session.repo_ref === 'string' && v.session.repo_ref !== ''));
  useEffect(() => { if (needsRegister) fetchReposCached().then(setRegister, () => setRegister([])); }, [needsRegister]);
  const used = useMemo(() => reposUsed(mine, members, register ?? getCachedRepos() ?? []), [mine, members, register]);
  const others = members.filter((m) => m.member_kind !== RUN_KIND && m.member_kind !== REPO_KIND);
  const firstRun = !loading && project !== null && !isDefault && jobsCount === 0 && !members.some((m) => m.member_kind === REPO_KIND);
  function startEdit(): void {
    if (!project) return;
    setEditName(project.name);
    setEditDesc(project.description ?? '');
    setEditErr(null);
    setEditing(true);
    if (tab !== 'work') navigate(deskTabPath('work', undefined, base));
  }
  async function saveEdit(): Promise<void> {
    if (!project) return;
    const trimName = editName.trim();
    if (!trimName) return;
    setEditBusy(true);
    setEditErr(null);
    try {
      const { project: updated } = await api.updateProject(project.id, { name: trimName, description: editDesc.trim() });
      setDetail((d) => d?.project.id === updated.id ? { ...d, project: updated } : d);
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
      setDetail((d) => d?.project.id === updated.id ? { ...d, project: updated } : d);
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
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const newJob = (workflowId: string | null = null): void => openLaunchWizard({ projectId: isDefault ? null : projectId, workflowId, composerKey: 'desk' });
  const chatHere = (): void => openAskDock({ projectId: isDefault ? null : projectId });
  const scrollTo = (id: string): void => {
    setScrollTarget(id);
    if (tab !== 'work') navigate(deskTabPath('work', undefined, base));
  };
  const attachedRepos = used.filter((u) => u.attached && u.repo !== null);
  const title = isDefault ? 'Not in a project' : project?.name ?? 'Project';

  const hostedForProject = (tab: HostedTab, at: string): React.ReactNode => {
    if (tab !== 'repositories') return hosted?.(tab, at, projectId);
    return <div className="wk-desk2-repos wk-project-desk-repos">
      {isDefault ? <p>Work not in a project has no repositories of its own. <a className="wk-link" href={deskTabPath('repositories')} onClick={go(deskTabPath('repositories'))}>Go to the Desk’s Repositories tab</a></p> : <>
        <div id="project-repos"><ProjectRepositories projectId={projectId} members={members} used={used} onIssue={onIssue} onMembersChange={(update) => setDetail((d) => d !== null && d.project.id === projectId ? { ...d, members: update(d.members) } : d)} /></div>
        {members.some((m) => m.member_kind === REPO_KIND) && <><ProjectCoverage projectId={projectId} navigate={navigate} onIssue={onIssue} /><ProjectDomain projectId={projectId} navigate={navigate} onIssue={onIssue} /></>}
      </>}
    </div>;
  };
  const workExtra = <div className="wk-project-desk-work">
    {editing && <section className="wk-card wk-pg-proj-stack">
      <SectionTitle>Edit project</SectionTitle>
      <label className="wk-pg-proj-field">Project name<input type="text" className="wk-field" value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} autoFocus /></label>
      <label className="wk-pg-proj-field">Description<textarea className="wk-field" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="Describe this project" /></label>
      <div className="wk-pg-proj-actions">
        <button type="button" className="wk-btn wk-btn--primary" onClick={() => void saveEdit()} disabled={editBusy || !editName.trim()}>{editBusy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="wk-btn wk-btn--quiet" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {(editBusy || !editName.trim()) && <p className="wk-field-note">{editBusy ? 'Saving your changes…' : 'Enter a project name to save.'}</p>}
    </section>}
    {firstRun && <section data-testid="project-first-run" aria-labelledby="project-first-title" className="wk-proj-first">
      <div className="wk-card wk-proj-first-steps">
        <h2 id="project-first-title" className="wk-section-title">Get this project going</h2>
        <ol className="wk-proj-steps">
          <li>
            <span className="wk-proj-step-title">Attach the repositories it works in</span>
            <span className="wk-proj-step-line">Jobs in this project read and change their code. Attach them on the Repositories tab.</span>
            <button type="button" className="wk-link" onClick={() => navigate(deskTabPath('repositories', undefined, base))}>Go to repositories</button>
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
    </section>}
    {!isDefault && <ProjectRequirementsSection projectId={projectId} navigate={navigate} onIssue={onIssue} />}
    <div id="project-documents"><ProjectDocumentsRoot projectId={projectId} project={project} onIssue={onIssue} onChanged={(updated) => setDetail((d) => d !== null && d.project.id === updated.id ? { ...d, project: updated } : d)} /></div>
    {others.length > 0 && <section className="wk-card" aria-labelledby="project-others-title">
      <h2 id="project-others-title" className="wk-section-title">Chats and other items</h2>
      <ul className="wk-pg-proj-list">{others.map((m) => <OtherMemberRow key={m.id} member={m} onDetach={handleDetach} navigate={navigate} />)}</ul>
    </section>}
  </div>;

  return <div data-testid="project-desk" data-project-id={projectId} className="wk-project-desk">
    {failure && <StateBanner kind={readErrorKind(failure.error)} what={failure.what} error={failures.map((f) => f.error).join('\n')} onRetry={() => failures.forEach((f) => f.retry())} retrying={loading} />}
    {unshown > 0 && <StateBanner data-testid="project-jobs-unshown" kind="partial" what={unshown === 1 ? '1 job in this project' : `${unshown} jobs in this project`} />}
    {loading ? <Skeleton rows={3} variant="card" /> : !project ? !error && <EmptyState title="Project not found" /> : <DeskV2
      projectId={projectId} runs={mine} needRows={needRows} now={now} navigate={navigate}
      runActions={(runId, runTitle) => { const m = members.find((x) => x.member_kind === RUN_KIND && x.member_ref === runId); return m === undefined ? [] : [{ id: 'detach', label: `Remove “${runTitle}” from this project`, danger: true, onSelect: () => handleDetach(m.id) }]; }}
      search={search} hosted={hostedForProject} runsLoaded={runsLoaded && membersRead} runsError={runsError ?? null}
      {...(onRetryRuns !== undefined ? { onRetryRuns } : {})} {...(onCommand !== undefined ? { onCommand } : {})} workExtra={workExtra}
      projectHead={{ title, meta: <>
        <span data-testid="project-meta">
          {project.status === 'archived' && <><span className="wk-tag">Archived</span>{' '}</>}
          {projectMeta(project.created_at > 0 ? `Created ${relTime(project.created_at, now)}` : null, jobsCount, used)}
        </span>
        {project.description && <span data-testid="project-desc" className="wk-project-desk-desc" title={project.description}>{project.description}</span>}
      </>, actions: <div className="wk-proj-actions" data-testid="project-actions">
        <button type="button" data-testid="project-new-job" className="wk-btn wk-btn--primary" aria-label="New job in this project" onClick={() => newJob()}><Plus size={14} aria-hidden />New job</button>
        <button type="button" data-testid="project-chat" className="wk-btn wk-btn--secondary" aria-label="Chat in this project" onClick={chatHere}><MessageSquare size={14} aria-hidden />Chat</button>
        {attachedRepos.length > 0 && <OverflowMenu label="Open a repository this project uses" text="Open repository" tone="secondary" items={attachedRepos.map((u) => ({ id: u.ref, label: u.name, onSelect: () => navigate(`/repo-detail/${encodeURIComponent(u.repo!.id)}`) }))} data-testid="project-open-repo" />}
        <button type="button" data-testid="project-documents" className="wk-btn wk-btn--secondary" onClick={() => scrollTo('project-documents')}><FileText size={14} aria-hidden />Documents</button>
        {!isDefault && <OverflowMenu label={`More actions for ${title}`} items={[
          { id: 'edit', label: 'Edit name and description', onSelect: startEdit },
          { id: 'archive', label: project.status === 'active' ? 'Archive this project' : 'Restore this project', onSelect: () => void toggleArchive(), disabled: archiveBusy ? 'Saving the project’s status…' : null },
        ]} />}
      </div> }}
    />}
  </div>;
}
