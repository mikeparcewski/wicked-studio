import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import type { Project, SessionView } from '../../api/types.js';
import { needsByRun, needTextByRun, railGroups } from '../../board/deskModel.js';
import { everythingPath, type EverythingQuery } from '../../board/everythingModel.js';
import { filterProjectRows, projectRows, type ProjectRow } from '../../board/projectsModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import { useProjectsStore } from '../../store/projects.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { NewProjectModal } from '../NewProjectModal.js';
import { deskReadState } from '../../board/deskModel.js';
import { absTime, relTime } from '../../board/relTime.js';
import { readErrorKind } from '../../api/errors.js';
import { EmptyState, Skeleton, StatLine, StateBanner, TechDetails } from '../ui/index.js';

/** The counts line's words, in the one status vocabulary (board/statusWords.ts; studio#687 rows 35, 36). */
const COUNT_WORDS = [
  { state: 'waiting', label: 'waiting on you' },
  { state: 'working', label: 'working' },
  { state: 'blocked', label: 'failed' },
  { state: 'quiet', label: 'stopped or cancelled' },
  { state: 'done', label: 'finished' },
] as const;

export function useProjectRows(runs: SessionView[], needRows: NeedRow[]): { rows: ProjectRow[]; unfiled: number } {
  const projects = useProjectsStore((s) => s.projects);
  const { items, unfiled } = useBoardModel(runs);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const groups = useMemo(() => railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow), [items, unfiled, needRows, runChatId, deliveredNow]);
  return { rows: projectRows(projects.filter((p) => p.status === 'active'), items, groups, runs), unfiled: groups.find((g) => g.projectId === null)?.sessions.length ?? 0 };
}

export function ProjectEntry({ row, navigate, onStatusChanged, header = false, countsKnown = true }: {
  row: ProjectRow;
  navigate: Navigate;
  onStatusChanged?: (project: Project) => void;
  header?: boolean;
  /** False while the runs read has not answered (or failed): the counts are hidden, never "0" (studio#684 row 11). */
  countsKnown?: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.project.name);
  const [description, setDescription] = useState(row.project.description ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(row.project.name); setDescription(row.project.description ?? ''); }, [row.project.name, row.project.description]);
  const apply = async (body: { name: string; description: string } | { status: 'active' | 'archived' }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { project } = await api.updateProject(row.project.id, body);
      const store = useProjectsStore.getState();
      if (project.status === 'active' && !store.projects.some((p) => p.id === project.id)) store.addProject(project);
      else store.updateProject(project);
      onStatusChanged?.(project);
      setEditing(false);
    } catch (e) {
      // The sentence is plain; the raw error lives behind technical details (UI-CONTRACT §4.7).
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const archived = row.project.status === 'archived';
  const path = everythingPath({ tab: 'sessions', project: row.project.id });
  return <section data-testid={header ? 'everything-project-header' : 'projects-row'} data-project-id={row.project.id} className="wk-desk-card wk-everything-group">
    {editing ? <form className="wk-project-edit" onSubmit={(e) => { e.preventDefault(); void apply({ name: name.trim(), description: description.trim() }); }}>
      <label className="wk-project-edit-field"><span className="wk-field-label">Name</span><input className="wk-field" aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="wk-project-edit-field"><span className="wk-field-label">Description</span><input className="wk-field" aria-label="Project description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <span className="wk-project-actions">
        <button type="submit" className="wk-btn wk-btn--sm wk-btn--primary" disabled={busy || name.trim() === ''}>Save</button>
        <button type="button" className="wk-btn wk-btn--sm wk-btn--quiet" onClick={() => setEditing(false)}>Cancel</button>
      </span>
    </form> : <><h2 className="wk-project-title">{row.project.name}</h2>{row.project.description ? <p className="wk-everything-note wk-project-desc" title={row.project.description}>{row.project.description}</p> : null}</>}
    {row.repos.length > 0 && <p className="wk-everything-note">Repositories: {row.repos.join(', ')}</p>}
    {/* studio#687 row 35: one line of the non-zero states (no "working: 0" dump), hidden until the runs read answered. */}
    {countsKnown && <StatLine data-testid="project-counts" items={COUNT_WORDS.map((c) => ({ label: c.label, value: row.counts[c.state] }))} />}
    {countsKnown && row.latestMs > 0 && (
      <p className="wk-everything-note">Last activity <time dateTime={new Date(row.latestMs).toISOString()} title={absTime(row.latestMs)}>{relTime(row.latestMs)}</time></p>
    )}
    {/* studio#687 row 37: one button system — Open, Rename and Archive are the same secondary buttons. */}
    <div className="wk-project-actions">
      {!header && <a href={path} data-testid="projects-row-open" className="wk-btn wk-btn--sm wk-btn--secondary" onClick={(e) => { e.preventDefault(); navigate(path); }}>Open</a>}
      <button type="button" className="wk-btn wk-btn--sm wk-btn--secondary" data-testid={header ? 'everything-project-rename' : 'projects-row-rename'} onClick={() => setEditing(true)}>Rename</button>
      <button type="button" className="wk-btn wk-btn--sm wk-btn--secondary" disabled={busy} data-testid={header ? 'everything-project-archive' : archived ? 'projects-row-unarchive' : 'projects-row-archive'} onClick={() => { void apply({ status: archived ? 'active' : 'archived' }); }}>{archived ? 'Unarchive' : 'Archive'}</button>
    </div>
    {error !== null && (
      <div role="alert" data-testid="projects-row-error">
        <p className="wk-field-note wk-field-note--bad">Couldn’t save the project.</p>
        <TechDetails text={error} />
      </div>
    )}
  </section>;
}

export function ProjectsTab({ q, runs, runsLoaded = true, runsError = null, onRetryRuns, needRows, navigate }: {
  q: EverythingQuery; runs: SessionView[]; runsLoaded?: boolean; runsError?: string | null; onRetryRuns?: (() => void) | undefined; needRows: NeedRow[]; navigate: Navigate;
}): React.ReactElement {
  const read = deskReadState(runsLoaded, runsError);
  const countsKnown = read === 'known' || read === 'stale';
  const { rows, unfiled } = useProjectRows(runs, needRows);
  const [archived, setArchived] = useState<Project[]>([]);
  // The Archived lens's own read: 'empty' is said only after it answered (never while pending or failed).
  const [archivedRead, setArchivedRead] = useState<'pending' | 'ok' | 'failed'>('pending');
  const [archivedRepos, setArchivedRepos] = useState<Record<string, string[]>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const archivedLens = q.filter === 'archived';
  useEffect(() => {
    if (!archivedLens) return;
    let live = true;
    setArchivedRead('pending');
    void api.listProjects('archived').then(async ({ projects }) => {
      const found = projects.filter((p) => p.status === 'archived');
      if (live) { setArchived(found); setArchivedRead('ok'); }
      const pairs = await Promise.all(found.map(async (project) => {
        const members = await api.listProjectMembers(project.id).then((r) => r.members).catch(() => []);
        const repos = useNeedsSources.getState().repos;
        return [project.id, members.filter((m) => m.member_kind === 'crew.repo').map((m) => repos?.find((r) => r.id === m.member_ref)?.name ?? m.member_ref)] as const;
      }));
      if (live) setArchivedRepos(Object.fromEntries(pairs));
    }).catch(() => { if (live) setArchivedRead('failed'); });
    return () => { live = false; };
  }, [archivedLens]);
  const shown = archivedLens ? projectRows(archived, [], [], []).map((row) => ({ ...row, repos: archivedRepos[row.project.id] ?? [] })) : rows;
  const lens = (filter: 'all' | 'archived') => navigate(everythingPath({ tab: 'projects', filter }), { replace: true });
  const listed = filterProjectRows(shown, name).filter((row) => !archivedLens || !hidden.includes(row.project.id));
  return <div data-testid="projects-tab" className="wk-projects-tab">
    {read === 'failed' && <StateBanner data-testid="projects-failed" kind={readErrorKind(runsError)} what="your work" error={runsError} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />}
    {/* studio#687 row 37: the filters sit left, in one row with the button; no control floats mid-row. */}
    <div className="wk-everything-bar wk-projects-bar">
      <button type="button" className="wk-btn wk-btn--sm wk-btn--primary" data-testid="projects-new" onClick={() => setNewOpen(true)}>New project</button>
      {/* studio#613: the Active / Archived lens is the See everything tabs' chip group, not two bare buttons. */}
      <div role="group" aria-label="Projects" data-testid="projects-filter" className="wk-everything-chips">
        <button type="button" className="wk-chip" aria-pressed={!archivedLens} onClick={() => lens('all')}>Active</button>
        <button type="button" className="wk-chip" aria-pressed={archivedLens} onClick={() => lens('archived')}>Archived</button>
      </div>
      <input type="search" className="wk-field wk-projects-find" aria-label="Find project" placeholder="Find a project" value={name} onChange={(e) => setName(e.target.value)} />
    </div>
    {/* The unfiled sessions are a card like the projects beside them, said only once the runs read answered. */}
    {!archivedLens && countsKnown && unfiled > 0 && (
      <section data-testid="projects-unfiled" className="wk-desk-card wk-everything-group">
        <h2 className="wk-project-title">Not in a project</h2>
        <StatLine items={[{ label: unfiled === 1 ? 'session' : 'sessions', value: unfiled }]} />
        <div className="wk-project-actions">
          <a href={everythingPath({ tab: 'sessions' })} className="wk-btn wk-btn--sm wk-btn--secondary" data-testid="projects-unfiled-open" onClick={(e) => { e.preventDefault(); navigate(everythingPath({ tab: 'sessions' })); }}>See them in Sessions</a>
        </div>
      </section>
    )}
    {listed.map((row) => <ProjectEntry key={row.project.id} row={row} countsKnown={countsKnown} navigate={navigate} onStatusChanged={(project) => { if (archivedLens && project.status === 'active') setHidden((ids) => [...ids, project.id]); }} />)}
    {archivedLens && archivedRead === 'pending' && <Skeleton data-testid="projects-checking" rows={2} variant="card" />}
    {archivedLens && archivedRead === 'failed' && <StateBanner data-testid="projects-archived-failed" kind="error" what="the archived projects" />}
    {listed.length === 0 && (!archivedLens || archivedRead === 'ok') && (
      <EmptyState data-testid="projects-empty"
        title={name.trim() !== '' ? 'No project matches that name.' : archivedLens ? 'Nothing is archived.' : 'No projects yet.'}
        {...(name.trim() === '' && !archivedLens ? { body: 'A project groups the sessions and repositories that belong together.' } : {})} />
    )}
    {newOpen && <NewProjectModal deskMode navigate={navigate} onClose={() => setNewOpen(false)} />}
  </div>;
}
