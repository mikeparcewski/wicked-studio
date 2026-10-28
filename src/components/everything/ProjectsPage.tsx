import { useEffect, useMemo, useState } from 'react';
import type { Project, SessionView } from '../../api/types.js';
import type { SystemSnapshot } from '../../api/system.js';
import { deskReadState, needRunId } from '../../board/deskModel.js';
import { everythingPath } from '../../board/everythingModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { PROJECTS_PATH } from '../../board/navModel.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { filterProjectRows, projectAttention, projectCardWords, projectRows, projectsSentence, type ProjectRow } from '../../board/projectsModel.js';
import { useSystemStore } from '../../store/systemSnapshot.js';
import { relTime } from '../../board/relTime.js';
import { readErrorKind } from '../../api/errors.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { CalmAction, CalmEmpty, CalmHead, CalmLoading, CalmPage, CalmSearch, CalmSection, CalmSeg } from '../calm/Calm.js';
import { NewProjectModal } from '../NewProjectModal.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';
import { StateBanner, TechDetails } from '../ui/index.js';
import { useArchivedProjects, useProjectRows, useProjectSave } from './ProjectsTab.js';

/**
 * PROJECTS (`/projects`, the sidebar's first WORK item; the operator-approved mockup `ui-v2-projects`,
 * 2026-10-27). The calm page: the title and one sentence ("Three projects. One needs you."), New project,
 * then one card per project: its name, its state ("1 needs you", "On track", "Quiet"), one sentence of
 * status and its repositories. A card opens the project's home (`/projects/:id`).
 *
 * Nothing the old list did is lost: Active / Archived (`?filter=archived`) is the one filter, Find is the
 * quiet search, and Rename and Archive / Unarchive sit behind each card's ⋯. Work in no project is a card
 * too. Every word is derived from the project's own runs; a number the runs read has not answered is
 * not said.
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
  const archivedLens = new URLSearchParams(search).get('filter') === 'archived';
  const read = deskReadState(runsLoaded, runsError);
  const runsKnown = read === 'known' || read === 'stale';
  const { rows, unfiled, unfiledRunIds } = useProjectRows(runs, needRows);
  // A ranked crew's needs-you list decides "N needs you" (the rail's number); an older crew, the board's.
  // Until crew first answers, the counts are held (never the fold's number flashing before crew's).
  const snapshot = useSystemStore((s) => (s.mode === 'system' ? s.snapshot : null));
  const crewPending = useSystemStore((s) => s.mode === 'unknown' && s.healthError === null);
  const known = runsKnown && !crewPending;
  // Work in no project that waits on you: the same rule as a project's card (crew's list, else the board's fold).
  const unfiledWaiting = useMemo(() => {
    if (!known) return 0;
    const ranked = projectAttention(snapshot, unfiledRunIds);
    if (ranked !== null) return ranked.length;
    const ids = new Set(unfiledRunIds);
    return needRows.filter((r) => { const id = needRunId(r); return id !== null && ids.has(id); }).length;
  }, [known, snapshot, unfiledRunIds, needRows]);
  const { archived, archivedRead, archivedRepos } = useArchivedProjects(archivedLens);
  const [hidden, setHidden] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  const shown = archivedLens ? projectRows(archived, [], [], []).map((row) => ({ ...row, repos: archivedRepos[row.project.id] ?? [] })) : rows;
  const listed = filterProjectRows(shown, name).filter((row) => !archivedLens || !hidden.includes(row.project.id));
  const lens = (filter: 'all' | 'archived'): void => navigate(filter === 'archived' ? `${PROJECTS_PATH}?filter=archived` : PROJECTS_PATH, { replace: true });

  return (
    <CalmPage data-testid="projects-page">
      <CalmHead title={PAGE_NAMES.projects} sentenceTestId="projects-sentence"
        sentence={archivedLens ? 'Archived projects keep their jobs and repositories. Unarchive one to work in it again.' : projectsSentence(rows, known, snapshot, unfiledWaiting)}
        action={<CalmAction label="New project" testId="projects-new" onClick={() => setNewOpen(true)} />} />
      {read === 'failed' && <StateBanner data-testid="projects-failed" kind={readErrorKind(runsError)} what="your work" error={runsError} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />}
      <CalmSection label={archivedLens ? 'Archived' : 'Your projects'} data-testid="projects-tab"
        tools={<>
          <CalmSearch value={name} onChange={setName} placeholder="Find a project" label="Find project" testId="projects-find" />
          <CalmSeg label="Projects" data-testid="projects-filter" value={archivedLens ? 'archived' : 'all'} onChange={lens}
            options={[{ value: 'all', label: 'Active' }, { value: 'archived', label: 'Archived' }]} />
        </>}>
        {archivedLens && archivedRead === 'pending' && <CalmLoading rows={2} data-testid="projects-checking" label="Reading the archived projects" />}
        {archivedLens && archivedRead === 'failed' && <StateBanner data-testid="projects-archived-failed" kind="error" what="the archived projects" />}
        {(listed.length > 0 || (!archivedLens && runsKnown && unfiled > 0)) && (
          <ul className="wk-pj-cards" aria-label={archivedLens ? 'Archived projects' : 'Projects'}>
            {listed.map((row) => (
              <ProjectCard key={row.project.id} row={row} now={now} known={known && !archivedLens} snapshot={snapshot} navigate={navigate}
                onStatusChanged={(project) => { if (archivedLens && project.status === 'active') setHidden((ids) => [...ids, project.id]); }} />
            ))}
            {!archivedLens && runsKnown && unfiled > 0 && name.trim() === '' && <UnfiledCard count={unfiled} waiting={unfiledWaiting} navigate={navigate} />}
          </ul>
        )}
        {listed.length === 0 && (!archivedLens || archivedRead === 'ok') && (
          <CalmEmpty data-testid="projects-empty"
            title={name.trim() !== '' ? 'No project matches that name.' : archivedLens ? 'Nothing is archived.' : 'No projects yet.'}
            {...(name.trim() === '' && !archivedLens ? { body: 'A project groups the jobs and repositories that belong together.' } : {})} />
        )}
      </CalmSection>
      {newOpen && <NewProjectModal deskMode navigate={navigate} onClose={() => setNewOpen(false)} />}
    </CalmPage>
  );
}

const go = (navigate: Navigate, path: string) => (e: React.MouseEvent): void => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(path);
};

function ProjectCard({ row, now, known, snapshot, navigate, onStatusChanged }: {
  row: ProjectRow; now: number; known: boolean; snapshot: SystemSnapshot | null; navigate: Navigate; onStatusChanged: (project: Project) => void;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(row.project.name);
  const [description, setDescription] = useState(row.project.description ?? '');
  useEffect(() => { setName(row.project.name); setDescription(row.project.description ?? ''); }, [row.project.name, row.project.description]);
  const { apply, error, busy } = useProjectSave(row.project.id, onStatusChanged);
  const archived = row.project.status === 'archived';
  const path = projectDetailPath(row.project.id);
  const words = archived ? { state: 'Archived', tone: 'quiet' as const, sentence: row.project.description ?? 'Archived.' } : projectCardWords(row, now, known, (ms) => relTime(ms, now), snapshot);
  return (
    <li className="wk-pj-card" data-testid="projects-row" data-project-id={row.project.id} data-tone={words.tone}>
      {editing ? (
        <form className="wk-pj-card-edit" onSubmit={(e) => { e.preventDefault(); void apply({ name: name.trim(), description: description.trim() }).then((ok) => { if (ok) setEditing(false); }); }}>
          <label className="wk-project-edit-field"><span className="wk-field-label">Name</span><input className="wk-field" aria-label="Project name" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
          <label className="wk-project-edit-field"><span className="wk-field-label">Description</span><input className="wk-field" aria-label="Project description" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <span className="wk-pj-card-acts">
            <button type="submit" className="wk-calm-btn wk-calm-btn--primary" disabled={busy || name.trim() === ''}>Save</button>
            <button type="button" className="wk-calm-btn wk-calm-btn--secondary" onClick={() => setEditing(false)}>Cancel</button>
          </span>
        </form>
      ) : (
        <a href={path} className="wk-pj-card-main" data-testid="projects-row-open" onClick={go(navigate, path)}>
          <span className="wk-pj-card-top">
            <span className="wk-pj-card-name">{row.project.name}</span>
            {words.state !== '' && <span className="wk-pj-card-state" data-testid="projects-row-state" data-tone={words.tone}>{words.state}</span>}
          </span>
          <span className="wk-pj-card-sentence" data-testid="projects-row-sentence">{words.sentence}</span>
          {row.repos.length > 0 && (
            <span className="wk-pj-chips" aria-label="Repositories">
              {row.repos.map((r) => <span key={r} className="wk-pj-chip">{r}</span>)}
            </span>
          )}
        </a>
      )}
      {!editing && (
        <span className="wk-pj-card-menu">
          <OverflowMenu label={`More actions for ${row.project.name}`} data-testid="projects-row-menu" items={[
            { id: 'rename', label: 'Rename', testId: 'projects-row-rename', onSelect: () => setEditing(true) },
            archived
              ? { id: 'unarchive', label: 'Unarchive', testId: 'projects-row-unarchive', onSelect: () => { void apply({ status: 'active' }); }, disabled: busy ? 'Saving…' : null }
              : { id: 'archive', label: 'Archive', testId: 'projects-row-archive', onSelect: () => { void apply({ status: 'archived' }); }, disabled: busy ? 'Saving…' : null },
          ]} />
        </span>
      )}
      {error !== null && (
        <div role="alert" className="wk-pj-card-error" data-testid="projects-row-error">
          <p className="wk-field-note wk-field-note--bad">Couldn’t save the project.</p>
          <TechDetails text={error} />
        </div>
      )}
    </li>
  );
}

/** The work no project holds: a card like the projects beside it, its dashboard a project's dashboard. */
function UnfiledCard({ count, waiting, navigate }: { count: number; waiting: number; navigate: Navigate }): React.ReactElement {
  const path = projectDetailPath('default');
  const sessions = everythingPath({ tab: 'sessions' });
  return (
    <li className="wk-pj-card" data-testid="projects-unfiled" data-tone={waiting > 0 ? 'gate' : 'quiet'}>
      <a href={path} className="wk-pj-card-main" data-testid="projects-unfiled-open" onClick={go(navigate, path)}>
        <span className="wk-pj-card-top"><span className="wk-pj-card-name">Not in a project</span>
          {waiting > 0 && <span className="wk-pj-card-state" data-testid="projects-unfiled-state" data-tone="gate">{waiting} {waiting === 1 ? 'needs' : 'need'} you</span>}</span>
        <span className="wk-pj-card-sentence">{count === 1 ? 'One job is not filed in a project.' : `${count} jobs are not filed in a project.`}</span>
      </a>
      <span className="wk-pj-card-menu">
        <OverflowMenu label="More actions for work not in a project" data-testid="projects-unfiled-menu" items={[
          { id: 'sessions', label: 'See them in Sessions', testId: 'projects-unfiled-sessions', onSelect: () => navigate(sessions) },
        ]} />
      </span>
    </li>
  );
}
