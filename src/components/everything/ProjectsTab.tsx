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

export function useProjectRows(runs: SessionView[], needRows: NeedRow[]): { rows: ProjectRow[]; unfiled: number } {
  const projects = useProjectsStore((s) => s.projects);
  const { items, unfiled } = useBoardModel(runs);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const groups = useMemo(() => railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow), [items, unfiled, needRows, runChatId, deliveredNow]);
  return { rows: projectRows(projects.filter((p) => p.status === 'active'), items, groups, runs), unfiled: groups.find((g) => g.projectId === null)?.sessions.length ?? 0 };
}

export function ProjectEntry({ row, navigate, onStatusChanged, header = false }: {
  row: ProjectRow;
  navigate: Navigate;
  onStatusChanged?: (project: Project) => void;
  header?: boolean;
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
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  };
  const archived = row.project.status === 'archived';
  const path = everythingPath({ tab: 'sessions', project: row.project.id });
  return <section data-testid={header ? 'everything-project-header' : 'projects-row'} data-project-id={row.project.id} className="wk-desk-card wk-everything-group">
    {editing ? <form onSubmit={(e) => { e.preventDefault(); void apply({ name: name.trim(), description: description.trim() }); }}>
      <label>Name <input aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Description <input aria-label="Project description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <button type="submit" disabled={busy || name.trim() === ''}>Save</button>
      <button type="button" onClick={() => setEditing(false)}>Cancel</button>
    </form> : <><h2>{row.project.name}</h2><p>{row.project.description}</p></>}
    {row.repos.length > 0 && <p>Repositories: {row.repos.join(', ')}</p>}
    <p>{(['working', 'waiting', 'done', 'blocked', 'quiet'] as const).map((state) => <span key={state} data-state={state}>{state}: {row.counts[state]}{' · '}</span>)}</p>
    <p>Latest activity: <time dateTime={new Date(row.latestMs).toISOString()}>{new Date(row.latestMs).toLocaleString()}</time></p>
    <div>
      {!header && <a href={path} data-testid="projects-row-open" onClick={(e) => { e.preventDefault(); navigate(path); }}>Open</a>}{' '}
      <button type="button" data-testid={header ? 'everything-project-rename' : 'projects-row-rename'} onClick={() => setEditing(true)}>Rename</button>{' '}
      <button type="button" disabled={busy} data-testid={header ? 'everything-project-archive' : archived ? 'projects-row-unarchive' : 'projects-row-archive'} onClick={() => { void apply({ status: archived ? 'active' : 'archived' }); }}>{archived ? 'Unarchive' : 'Archive'}</button>
    </div>
    {error !== null && <p role="alert" data-testid="projects-row-error">{error}</p>}
  </section>;
}

export function ProjectsTab({ q, runs, needRows, navigate }: { q: EverythingQuery; runs: SessionView[]; needRows: NeedRow[]; navigate: Navigate }): React.ReactElement {
  const { rows, unfiled } = useProjectRows(runs, needRows);
  const [archived, setArchived] = useState<Project[]>([]);
  const [archivedRepos, setArchivedRepos] = useState<Record<string, string[]>>({});
  const [hidden, setHidden] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const archivedLens = q.filter === 'archived';
  useEffect(() => {
    if (!archivedLens) return;
    let live = true;
    void api.listProjects('archived').then(async ({ projects }) => {
      const found = projects.filter((p) => p.status === 'archived');
      if (live) setArchived(found);
      const pairs = await Promise.all(found.map(async (project) => {
        const members = await api.listProjectMembers(project.id).then((r) => r.members).catch(() => []);
        const repos = useNeedsSources.getState().repos;
        return [project.id, members.filter((m) => m.member_kind === 'crew.repo').map((m) => repos?.find((r) => r.id === m.member_ref)?.name ?? m.member_ref)] as const;
      }));
      if (live) setArchivedRepos(Object.fromEntries(pairs));
    }).catch(() => undefined);
    return () => { live = false; };
  }, [archivedLens]);
  const shown = archivedLens ? projectRows(archived, [], [], []).map((row) => ({ ...row, repos: archivedRepos[row.project.id] ?? [] })) : rows;
  const lens = (filter: 'all' | 'archived') => navigate(everythingPath({ tab: 'projects', filter }), { replace: true });
  return <div data-testid="projects-tab">
    <div className="wk-everything-bar">
      <button type="button" data-testid="projects-new" onClick={() => setNewOpen(true)}>New project</button>
      <div role="group" aria-label="Projects" data-testid="projects-filter">
        <button type="button" aria-pressed={!archivedLens} onClick={() => lens('all')}>Active</button>
        <button type="button" aria-pressed={archivedLens} onClick={() => lens('archived')}>Archived</button>
      </div>
      <label>Find project <input aria-label="Find project" value={name} onChange={(e) => setName(e.target.value)} /></label>
    </div>
    {!archivedLens && <p>Not in a project: {unfiled}</p>}
    {filterProjectRows(shown, name).filter((row) => !archivedLens || !hidden.includes(row.project.id)).map((row) => <ProjectEntry key={row.project.id} row={row} navigate={navigate} onStatusChanged={(project) => { if (archivedLens && project.status === 'active') setHidden((ids) => [...ids, project.id]); }} />)}
    {newOpen && <NewProjectModal deskMode navigate={navigate} onClose={() => setNewOpen(false)} />}
  </div>;
}
