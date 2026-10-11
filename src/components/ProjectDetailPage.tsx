import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { readErrorKind } from '../api/errors.js';
import type { ActivityEntry, ProjectDetail, ProjectMember, SessionView } from '../api/types.js';
import { useProjectsStore } from '../store/projects.js';
import { ProjectRepositories } from './ProjectRepositories.js';
import { ProjectDocumentsRoot } from './ProjectDocumentsRoot.js';
import { ProjectCoverage, ProjectDomain, type ProjectReadIssue, type ProjectIssueHandler } from './product/ProjectAggregates.js';
import { everythingPath } from '../board/everythingModel.js';
import { sessionPath, sessionTitle } from '../board/sessionModel.js';
import { statusWord } from '../board/statusWords.js';
import { relTime } from '../board/relTime.js';
import { PageFrame, SectionTitle } from './ui/PageFrame.js';
import { StateBanner, Skeleton, EmptyState } from './ui/StateBanner.js';
import { StatLine } from './ui/StatLine.js';
import { TechDetails } from './ui/TechDetails.js';
import { OverflowMenu } from './ui/OverflowMenu.js';

const REPO_KIND = 'crew.repo';

function ActivityRow({ entry }: { entry: ActivityEntry }): React.ReactElement {
  return <div className="wk-list-row wk-pg-proj-row"><div>
    <span className="wk-list-row-title">{entry.summary.trim() !== '' ? entry.summary : 'Project activity'}</span>
    <p className="wk-list-row-meta" title={new Date(entry.ts).toLocaleString()}>{relTime(entry.ts)}</p>
    <TechDetails text={[entry.kind, entry.ref, entry.source]} />
  </div></div>;
}

function MemberRow({ member, known, onDetach, navigate, onIssue }: {
  member: ProjectMember; known: SessionView | undefined; onDetach: (id: string) => void; navigate: (path: string) => void; onIssue: ProjectIssueHandler;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('Untitled session');
  const [view, setView] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const isRun = member.member_kind === 'crew.run';
  const isChat = member.member_kind === 'crew.chat';
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    const key = `session:${member.id}`;
    setLoading(true);
    onIssue(key, null);
    void Promise.resolve().then(async () => {
      if (isRun) {
        const run = known ?? (await api.getRun(member.member_ref)).run;
        if (!cancelled) { setView(run); setTitle(run.session.problem?.trim() ? sessionTitle([], [run]) : 'Untitled session'); }
      } else if (isChat) {
        const chat = await api.getChat(member.member_ref);
        if (!cancelled) setTitle((chat.messages ?? []).some((m) => m.kind === 'user' && m.text?.trim()) ? sessionTitle(chat.messages ?? [], []) : 'Untitled session');
      } else if (!cancelled) setTitle(member.member_kind === 'crew.workflow' ? 'Attached workflow' : 'Attached document');
    }).catch((e: unknown) => {
      if (!cancelled) onIssue(key, { what: 'session titles', error: e instanceof Error ? e.message : String(e), retry });
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; onIssue(key, null); };
  }, [member.id, member.member_ref, member.member_kind, isRun, isChat, attempt, retry, onIssue, known]);
  const href = sessionPath(isRun ? `run:${member.member_ref}` : member.member_ref);
  const status = view !== null ? statusWord(view) : null;
  return <div className="wk-list-row wk-pg-proj-row">
    <div>
      {loading ? <Skeleton rows={1} variant="line" /> : isRun || isChat
        ? <a className="wk-link wk-list-row-title" href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}>{title}</a>
        : <span className="wk-list-row-title">{title}</span>}
      <p className="wk-list-row-meta" title={new Date(member.attached_at).toLocaleString()}>Added {relTime(member.attached_at)}</p>
      {status !== null && <span className="wk-list-row-status wk-tag"><span className="wk-status-dot" data-status={status.tone} aria-hidden /> {status.word}</span>}
    </div>
    <div className="wk-list-row-actions">
      {busy ? <p className="wk-field-note">Removing…</p> : (
        <OverflowMenu label={`More actions for ${title}`} items={[
          { id: 'detach', label: 'Remove from project', danger: true, onSelect: () => { setBusy(true); onDetach(member.id); } },
        ]} />
      )}
    </div>
  </div>;
}

const NO_RUNS: readonly SessionView[] = [];

interface Props {
  projectId: string;
  navigate: (path: string) => void;
  /** The runs App already holds: member titles and status come from here, no per-row read. */
  runs?: readonly SessionView[];
}

export function ProjectDetailPage({ projectId, navigate, runs = NO_RUNS }: Props): React.ReactElement {
  const { updateProject } = useProjectsStore();
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState<string | null>(null);

  const [archiveBusy, setArchiveBusy] = useState(false);

  const isDefault = projectId === 'default';
  const project = detail?.project ?? null;
  const members = detail?.members ?? [];
  const [issues, setIssues] = useState<Record<string, ProjectReadIssue>>({});
  const onIssue = useCallback<ProjectIssueHandler>((key, issue) => {
    setIssues((old) => { const next = { ...old }; if (issue === null) delete next[key]; else next[key] = issue; return next; });
  }, []);
  const otherMembers = members.filter((m) => m.member_kind !== REPO_KIND);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [det, act] = await Promise.all([
        api.getProject(projectId),
        api.getProjectActivity(projectId).catch((e: unknown) => {
          setError(e instanceof Error ? e.message : String(e));
          return { entries: [], nextCursor: null, projectId };
        }),
      ]);
      setDetail(det);
      setActivity(act.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);

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
      const { project: updated } = await api.updateProject(project.id, {
        name: trimName,
        description: editDesc.trim(),
      });
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
      const newStatus = project.status === 'active' ? 'archived' : 'active';
      const { project: updated } = await api.updateProject(project.id, { status: newStatus });
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
  return (
    <PageFrame title={project?.name ?? 'Project'} intro="Manage this project’s repositories, documents, and sessions." actions={<>
      <a className="wk-link" href={backHref} onClick={(e) => { e.preventDefault(); navigate(backHref); }}>All projects</a>
      {project && !isDefault && !editing && <>
        <button type="button" className="wk-btn wk-btn--primary" onClick={startEdit}>Edit</button>
        <button type="button" className="wk-btn wk-btn--secondary" onClick={() => void toggleArchive()} disabled={archiveBusy}>{project.status === 'active' ? 'Archive' : 'Restore'}</button>
        {archiveBusy && <p className="wk-field-note">Saving the project’s status…</p>}
      </>}
    </>}>
      {failure && <StateBanner kind={readErrorKind(failure.error)} what={failure.what} error={failures.map((f) => f.error).join('\n')} onRetry={() => failures.forEach((f) => f.retry())} retrying={loading} />}
      {loading ? <Skeleton rows={3} variant="card" /> : !project ? !error && <EmptyState title="Project not found" /> : <>
        {editing ? <section className="wk-card wk-pg-proj-stack">
          <SectionTitle>Edit project</SectionTitle>
          <label className="wk-pg-proj-field">Project name<input type="text" className="wk-field" value={editName} maxLength={120} onChange={(e) => setEditName(e.target.value)} autoFocus /></label>
          <label className="wk-pg-proj-field">Description<textarea className="wk-field" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} placeholder="Describe this project" /></label>
          <div className="wk-pg-proj-actions"><button type="button" className="wk-btn wk-btn--primary" onClick={() => void saveEdit()} disabled={editBusy || !editName.trim()}>{editBusy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="wk-btn wk-btn--quiet" onClick={() => setEditing(false)}>Cancel</button></div>
          {(editBusy || !editName.trim()) && <p className="wk-field-note">{editBusy ? 'Saving your changes…' : 'Enter a project name to save.'}</p>}
        </section> : <div className="wk-pg-proj-stack">
          {project.description && <p className="wk-pg-proj-note">{project.description}</p>}
          {(project.status === 'archived' || isDefault || project.created_at > 0) && <p className="wk-pg-proj-meta">
            {project.status === 'archived' && <span className="wk-tag">Archived</span>}
            {isDefault && <span className="wk-tag">Default project</span>}
            {project.created_at > 0 && <span className="wk-list-row-meta" title={new Date(project.created_at).toLocaleString()}>Created {relTime(project.created_at)}</span>}
          </p>}
        </div>}
        <ProjectDocumentsRoot projectId={projectId} project={project} onIssue={onIssue} onChanged={(updated) => setDetail((d) => d !== null && d.project.id === updated.id ? { ...d, project: updated } : d)} />
        <ProjectRepositories projectId={projectId} members={members} onIssue={onIssue} onMembersChange={(update) => setDetail((d) => d !== null && d.project.id === projectId ? { ...d, members: update(d.members) } : d)} />
        {projectId !== 'default' && <><ProjectCoverage projectId={projectId} navigate={navigate} onIssue={onIssue} /><ProjectDomain projectId={projectId} navigate={navigate} onIssue={onIssue} /></>}
        <section className="wk-card" aria-label="Sessions"><SectionTitle>Sessions</SectionTitle>
          <StatLine items={[{ label: otherMembers.length === 1 ? 'session' : 'sessions', value: failures.length === 0 ? otherMembers.length : null }]} />
          {otherMembers.length === 0 ? <EmptyState title="No sessions yet" body="Start work in this project to add a session." /> : otherMembers.map((m) => <MemberRow key={m.id} member={m} known={m.member_kind === 'crew.run' ? runs.find((v) => v.session.id === m.member_ref) : undefined} onDetach={handleDetach} navigate={navigate} onIssue={onIssue} />)}
        </section>
        <section className="wk-card"><SectionTitle>Activity</SectionTitle>
          {activity.length === 0 ? error === null && <EmptyState title="No activity yet" /> : activity.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}
        </section>
      </>}
    </PageFrame>
  );
}
