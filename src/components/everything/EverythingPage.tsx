import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { Project } from '../../api/types.js';
import type { RosterSeat, SessionView } from '../../api/types.js';
import { deskReadState, needsByRun, needTextByRun, railGroups, signInLapsed, type RailGroup } from '../../board/deskModel.js';
import {
  EVERYTHING_TABS, EVERYTHING_VIEWS, everythingPath, filterGroups, handedRows, MADE_KINDS, MADE_WORD, madeRows, readEverythingQuery, searchGroups,
  SESSION_FILTERS, TAB_LABEL, type EverythingQuery, type EverythingTab, type HandedRow, type MadeRow,
} from '../../board/everythingModel.js';
import type { NeedRow } from '../../board/needsYou.js';
import { sessionIdOf, sessionPath, type SessionState } from '../../board/sessionModel.js';
import { filterRunRows, pageRunRows, runRows, sortRunRows, type RunSortKey, type SortDir } from '../../board/runsTableModel.js';
import { openSheet } from '../../store/sheets.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useRoster } from '../../hooks/useRoster.js';
import { modePath, projectDetailPath, projectPath, type Navigate, versionPath } from '../../hooks/useRoute.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useDocsCache } from '../../store/docsCache.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useLiveChatsStore } from '../../store/liveChats.js';
import { displayText as showTextOf } from '../../board/homePath.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useMembershipStore } from '../../store/membership.js';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import { useProjectsStore } from '../../store/projects.js';
import { ageWord } from '../DashboardTiles.js';
import { seatStandingWord } from '../HealthRailSection.js';
import { SignInPanel } from '../SignInPanel.js';
import { FinishedRunRow } from '../FinishedRunRow.js';
import { plainRunTitle } from '../../board/deskWords.js';
import { runTechParts, Tech } from '../Tech.js';
import { ProjectEntry, ProjectsTab } from './ProjectsTab.js';
import { projectRows } from '../../board/projectsModel.js';
import { GroundingChip } from '../GroundingChip.js';

/**
 * "SEE EVERYTHING" (`/everything`, DES-STUDIO-REBUILD-001 §5.4, slice S15c/S17a) — one page, five tabs,
 * under the shell of every skin: Sessions, Everything made, Helpers, Handed over, Projects. Render only: the
 * folds are `board/everythingModel.ts` over `useBoardModel`, the docs cache, the roster and the
 * delivery facts studio already reads.
 *
 *  - The tab, the Sessions filter (`?filter=`, the old `/work` words), the project scope (`?project=`)
 *    and the Made kind (`?kind=`) are the address: a tab is a page (pushed), a filter is a lens on it
 *    (replaced), so Back leaves the page the way the operator came.
 *  - Keyboard: the tabs are an ARIA tablist — arrows, Home and End move and pick (§5.6 rule 2); every
 *    row is a link.
 *  - Plain words, the Desk's palette, no KPI tile.
 */
export function EverythingPage({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, navigate, search, routeProjectId = null }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  navigate: Navigate;
  /** The current `location.search` — the tab, filter, scope and kind. */
  search: string;
  /** The project a moved `/p/:id[/chronicle]` address names, for the tick before the address is replaced. */
  routeProjectId?: string | null;
}): React.ReactElement {
  const q = readEverythingQuery(search);
  const project = q.project ?? routeProjectId;
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const pick = (tab: EverythingTab): void => { navigate(everythingPath({ ...q, tab, project: tab === 'projects' ? null : project, filter: tab === 'projects' || q.tab === 'projects' ? 'all' : q.filter })); };
  const onTabKey = (e: React.KeyboardEvent, i: number): void => {
    const n = EVERYTHING_TABS.length;
    let to: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = (i + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = (i - 1 + n) % n;
    else if (e.key === 'Home') to = 0;
    else if (e.key === 'End') to = n - 1;
    if (to === null) return;
    e.preventDefault();
    const tab = EVERYTHING_TABS[to]!;
    tabRefs.current[tab]?.focus();
    pick(tab);
  };

  return (
    <div data-testid="everything" data-tab={q.tab} className="wk-desk wk-everything">
      <div className="wk-desk-scroll" data-place-scroll="everything">
        <header className="wk-everything-head">
          <h1 className="wk-desk-hello">Everything</h1>
          <p className="wk-desk-date">Every session, everything made, your helpers, and what was handed over.</p>
          <div role="tablist" aria-label="Everything" className="wk-everything-tabs">
            {EVERYTHING_TABS.map((tab, i) => (
              <button
                key={tab}
                ref={(el) => { tabRefs.current[tab] = el; }}
                type="button"
                role="tab"
                id={`everything-tab-${tab}`}
                aria-selected={q.tab === tab}
                aria-controls="everything-panel"
                tabIndex={q.tab === tab ? 0 : -1}
                data-testid="everything-tab"
                data-tab={tab}
                onClick={() => pick(tab)}
                onKeyDown={(e) => onTabKey(e, i)}
                className="wk-everything-tab"
              >
                {TAB_LABEL[tab]}
              </button>
            ))}
          </div>
        </header>
        <section id="everything-panel" role="tabpanel" aria-labelledby={`everything-tab-${q.tab}`} data-testid="everything-panel" data-tab={q.tab} className="wk-everything-panel">
          {q.tab === 'sessions' && (
            <SessionsTab runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns} needRows={needRows} q={{ ...q, project }} navigate={navigate} go={go} />
          )}
          {q.tab === 'made' && <MadeTab runs={runs} q={q} navigate={navigate} go={go} />}
          {q.tab === 'helpers' && <HelpersTab />}
          {q.tab === 'handed' && <HandedTab runs={runs} runsLoaded={runsLoaded} go={go} />}
          {q.tab === 'projects' && <ProjectsTab q={q} runs={runs} needRows={needRows} navigate={navigate} />}
        </section>
      </div>
    </div>
  );
}

type Go = (path: string) => (e: React.MouseEvent) => void;

function useProjectName(): (id: string | null) => string {
  const projects = useProjectsStore((s) => s.projects);
  return (id) => (id === null ? 'Not in a project' : projects.find((p) => p.id === id)?.name ?? id);
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────

function SessionsTab({ runs, runsLoaded, runsError, onRetryRuns, needRows, q, navigate, go }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError: string | null;
  onRetryRuns: (() => void) | undefined;
  needRows: NeedRow[];
  q: EverythingQuery;
  navigate: Navigate;
  go: Go;
}): React.ReactElement {
  const { items, unfiled } = useBoardModel(runs);
  const projects = useProjectsStore((s) => s.projects);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const nameOf = useProjectName();
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), Number.POSITIVE_INFINITY, needTextByRun(needRows), runChatId, deliveredNow),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  // The search (S18b): a non-empty query lifts the state filter — it finds a session the chips hid.
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const problemOf = (runId: string): string | undefined => runs.find((v) => v.session.id === runId)?.session.problem;
  const shown: RailGroup[] = searching ? searchGroups(filterGroups(groups, 'all', q.project), query, problemOf) : filterGroups(groups, q.filter, q.project);
  // What the scope holds before the state filter: one project's sessions, or every project's — so
  // an empty project says "nothing started here", not "nothing matches this filter".
  const inScope = q.project === null ? groups : groups.filter((g) => g.projectId === q.project);
  const total = inScope.reduce((n, g) => n + g.sessions.length, 0);
  const read = deskReadState(runsLoaded, runsError);
  // The view (`?view=`) rides every Sessions lens so a chip click inside "Every run" stays there.
  const lens = (over: Partial<EverythingQuery>): string => everythingPath({ tab: 'sessions', filter: q.filter, project: q.project, view: q.view, ...over });
  // The full count in the tab header ("124 runs · 97 sessions") — runs scoped the same way as the
  // session total, archived excluded. A cheap reduce, never the row fold.
  const runCount = runs.reduce((n, v) => (v.session.archived_at == null && (q.project === null || dtoProjectOf(v) === q.project) ? n + 1 : n), 0);
  const scopeName = q.project !== null ? nameOf(q.project) : null;
  const viewOf = (runId: string): SessionView | undefined => runs.find((v) => v.session.id === runId);
  const showText = useDisplayText();
  // The retired Work page's archive: a finished run can be put away from its row (FinishedRunRow),
  // and the Archived lens lists what was put away, with Unarchive — the same two calls it made.
  // After the write, the list is re-read (the Work page called onRefresh too) so the row leaves.
  const archive = (id: string): void => { void api.archiveRun(id, true).then(() => onRetryRuns?.()).catch(() => { /* the row stays; the next read says */ }); };
  // Archived projects are their own read (`GET /projects?status=archived`): the board model keeps
  // the shared store to the active register, so the store cannot name them.
  const [archivedProjects, setArchivedProjects] = useState<Project[]>([]);
  const [scopedRepos, setScopedRepos] = useState<string[]>([]);
  const repoList = useNeedsSources((s) => s.repos);
  useEffect(() => {
    let cancelled = false;
    api.listProjects('archived')
      .then(({ projects: ps }) => { if (!cancelled) setArchivedProjects(ps.filter((p) => p.status === 'archived')); })
      .catch(() => { /* no register, no line — never a guessed one */ });
    return () => { cancelled = true; };
  }, [q.project]);
  useEffect(() => {
    if (q.project === null) return;
    let live = true;
    void api.listProjectMembers(q.project).then(({ members }) => {
      if (live) setScopedRepos(members.filter((m) => m.member_kind === 'crew.repo').map((m) => repoList?.find((r) => r.id === m.member_ref)?.name ?? m.member_ref));
    }).catch(() => undefined);
    return () => { live = false; setScopedRepos([]); };
  }, [q.project, repoList]);
  const scopedProject = q.project === null ? null : projects.find((p) => p.id === q.project) ?? archivedProjects.find((p) => p.id === q.project) ?? null;
  const projectHeader = scopedProject === null ? null : projectRows([scopedProject], items, groups, runs).map((row) => ({ ...row, repos: scopedRepos.length > 0 ? scopedRepos : row.repos }))[0] ?? null;

  return (
    <div data-testid="everything-sessions" data-count={total} data-filter={q.filter} data-project={q.project ?? ''}>
      {projectHeader !== null && <ProjectEntry row={projectHeader} navigate={navigate} header onStatusChanged={(changed) => setArchivedProjects((old) => changed.status === 'archived' ? [changed, ...old.filter((p) => p.id !== changed.id)] : old.filter((p) => p.id !== changed.id))} />}
      <div className="wk-everything-bar">
        <div role="group" aria-label="Show" className="wk-everything-chips">
          {SESSION_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              aria-pressed={q.filter === f.id}
              data-testid="everything-filter"
              data-filter={f.id}
              onClick={() => navigate(lens({ filter: f.id }), { replace: true })}
              className="wk-chip"
            >
              {f.label}
            </button>
          ))}
        </div>
        {scopeName !== null && (
          <p data-testid="everything-scope" data-project-id={q.project ?? ''} className="wk-everything-scope">
            In <b>{scopeName}</b>
            {' · '}
            <a href={lens({ project: null })} onClick={(e) => { e.preventDefault(); navigate(lens({ project: null }), { replace: true }); }} data-testid="everything-scope-clear">Every project</a>
          </p>
        )}
        {q.view === 'grouped' && q.filter !== 'archived' && (
          <input
            data-testid="everything-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="wk-runs-filter"
          />
        )}
        <div className="wk-everything-views">
          <div role="group" aria-label="View" className="wk-everything-viewswitch">
            {EVERYTHING_VIEWS.map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={q.view === v}
                data-testid="everything-view"
                data-view={v}
                onClick={() => navigate(lens({ view: v }), { replace: true })}
                className="wk-chip"
              >
                {v === 'grouped' ? 'Grouped' : 'Every run'}
              </button>
            ))}
          </div>
          <p data-testid="everything-count" data-runs={runCount} data-sessions={total} className="wk-everything-count wk-session-grey">
            {countWord(runCount, 'run')} · {countWord(total, 'session')}
          </p>
        </div>
      </div>
      {q.view === 'runs' && (
        <RunsTable
          runs={runs} runChatId={runChatId} projects={projects} q={q}
          runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns}
          navigate={navigate} go={go} archive={archive} viewOf={viewOf} showText={showText}
        />
      )}
      {q.view === 'grouped' && (<>
      {q.filter === 'archived' && <ArchivedRuns key={q.project ?? ''} navigate={navigate} runChatId={runChatId} project={q.project} onChanged={onRetryRuns} />}
      {q.filter !== 'archived' && read === 'checking' && <p data-testid="everything-checking" className="wk-session-grey">Reading your work…</p>}
      {q.filter !== 'archived' && read === 'failed' && (
        <p data-testid="everything-failed" role="alert" className="wk-session-grey">
          Couldn’t read your work ({showText(runsError ?? '')}).
          {onRetryRuns !== undefined && <> <button type="button" data-testid="everything-retry" onClick={onRetryRuns} className="wk-since-toggle">Try again</button></>}
        </p>
      )}
      {q.filter !== 'archived' && read === 'stale' && <p className="wk-session-grey">The last read failed ({showText(runsError ?? '')}); this is the list as last read.</p>}
      {q.filter !== 'archived' && (read === 'known' || read === 'stale') && total === 0 && (
        <p data-testid="everything-empty" className="wk-session-grey">
          {q.project !== null ? 'Nothing has been started in this project yet.' : 'Nothing has been started yet.'}
        </p>
      )}
      {q.filter !== 'archived' && (read === 'known' || read === 'stale') && total > 0 && shown.length === 0 && searching && (
        <p data-testid="everything-empty" className="wk-session-grey">
          No sessions match “{query.trim()}”{scopeName !== null ? ` in ${scopeName}` : ''}.{' '}
          <button type="button" data-testid="everything-search-clear" onClick={() => setQuery('')} className="wk-since-toggle">Clear the search</button>
        </p>
      )}
      {q.filter !== 'archived' && (read === 'known' || read === 'stale') && total > 0 && shown.length === 0 && !searching && (
        <p data-testid="everything-empty" className="wk-session-grey">
          No sessions match this filter{scopeName !== null ? ` in ${scopeName}` : ''}.{' '}
          <button type="button" data-testid="everything-show-all" onClick={() => navigate(lens({ filter: 'all' }), { replace: true })} className="wk-since-toggle">Show all</button>
        </p>
      )}
      {q.filter !== 'archived' && shown.map((g) => (
        <section key={g.projectId ?? 'unfiled'} data-testid="everything-group" data-project-id={g.projectId ?? ''} className="wk-desk-card wk-everything-group">
          <p className="wk-desk-card-title">
            <span>{g.name}</span>
            {g.projectId !== null && (
              <span className="wk-desk-card-aside wk-everything-aside">
                <a href={projectDetailPath(g.projectId)} onClick={go(projectDetailPath(g.projectId))} data-testid="everything-group-details">details</a>
                {' · '}
                <a href={`${projectPath(g.projectId)}/campaigns`} onClick={go(`${projectPath(g.projectId)}/campaigns`)} data-testid="everything-group-tests">tests</a>
              </span>
            )}
          </p>
          {g.sessions.map((s) => {
            // A finished run keeps the Work page's row and its next-use moves — Reuse as preset,
            // Draft update, archive (FinishedRunRow) — the behaviours the §5.4 move must not lose.
            const finished = FINISHED.has(s.state) && s.runIds.length === 1 ? viewOf(s.runId) : undefined;
            if (finished !== undefined) {
              return (
                <div key={s.id} data-testid="everything-session" data-session-id={s.id} data-run-id={s.runId} data-run-ids={s.runIds.join(' ')} data-state={s.state} data-finished="true" className="wk-everything-finished">
                  <FinishedRunRow view={finished} selectedRunId={null} onSelect={() => navigate(s.path)} onArchive={archive} />
                </div>
              );
            }
            return (
              <a
                key={s.id}
                href={s.path}
                onClick={go(s.path)}
                data-testid="everything-session"
                data-session-id={s.id}
                data-run-id={s.runId}
                data-run-ids={s.runIds.join(' ')}
                data-state={s.state}
                className="wk-desk-session"
              >
                <span aria-hidden className={`wk-desk-dot wk-desk-dot--${s.state}`} />
                <span className="wk-desk-need-body">
                  <span className="wk-desk-session-title">{showText(s.title)}</span>
                  <span className={`wk-desk-need-line${s.state === 'waiting' ? ' wk-desk-underline' : ''}`}>{showText(s.line)}</span>
                  {/* The run's handles with "Show technical details" on — the same parts the run row showed. */}
                  <Tech data-testid="tech-session-row" parts={s.runIds.length === 1 && viewOf(s.runId) !== undefined ? runTechParts(viewOf(s.runId)!.session) : s.runIds} block />
                </span>
              </a>
            );
          })}
        </section>
      ))}
      {q.filter !== 'archived' && q.project === null && <LiveChats known={new Set(groups.flatMap((g) => g.sessions.map((s) => s.id)))} go={go} />}
      {q.filter !== 'archived' && archivedProjects.length > 0 && (
        <p data-testid="everything-archived-projects" className="wk-session-grey">
          Archived projects:{' '}
          {archivedProjects.map((p, i) => (
            <span key={p.id}>{i > 0 ? ', ' : ''}<a href={projectDetailPath(p.id)} onClick={go(projectDetailPath(p.id))} data-testid="everything-archived-project" data-project-id={p.id}>{p.name}</a></span>
          ))}
          {' '}— open one to restore it.
        </p>
      )}
      </>)}
    </div>
  );
}

/** "N runs" / "1 run" — the count sentence's plural. */
function countWord(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── Every run (S17b): one row per RUN, sortable / filterable / paged ────────────────────────

/** The plain state word a run row shows — the chip labels, per state. */
const STATE_WORD: Readonly<Record<SessionState, string>> = {
  working: 'Working', waiting: 'Waiting on you', blocked: 'Blocked', done: 'Done', quiet: 'Stopped',
};

const RUN_COLS: readonly { key: RunSortKey; label: string }[] = [
  { key: 'status', label: 'State' },
  { key: 'title', label: 'What' },
  { key: 'project', label: 'Project' },
  { key: 'repo', label: 'Repo' },
  { key: 'workflow', label: 'Workflow' },
  { key: 'created', label: 'Started' },
  { key: 'updated', label: 'Updated' },
];

/**
 * The "Every run" table (S17b): paints the moment `GET /runs` answers — it reads only `runs`, the
 * projects store (a name fills in when known) and the `runsLoaded`/`runsError` gate, never the board
 * model's members fan-out. The Archived lens (`?filter=archived`) reads `GET /runs?include=archived`
 * and renders the same table with an inline Unarchive. Sort, text filter and paging are the pure
 * folds in `board/runsTableModel.ts`; only the 100-row page slice is painted.
 */
function RunsTable({ runs, runChatId, projects, q, runsLoaded, runsError, onRetryRuns, navigate, go, archive, viewOf, showText }: {
  runs: SessionView[];
  runChatId: boolean;
  projects: Project[];
  q: EverythingQuery;
  runsLoaded: boolean;
  runsError: string | null;
  onRetryRuns: (() => void) | undefined;
  navigate: Navigate;
  go: Go;
  archive: (id: string) => void;
  viewOf: (runId: string) => SessionView | undefined;
  showText: (t: string) => string;
}): React.ReactElement {
  const archivedMode = q.filter === 'archived';
  const nameOf = (id: string | null): string => (id === null ? 'Not in a project' : projects.find((p) => p.id === id)?.name ?? id);
  const [sortKey, setSortKey] = useState<RunSortKey>('updated');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [text, setText] = useState('');
  const [page, setPage] = useState(1);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The Archived lens is its own read (`GET /runs?include=archived`), scoped to the project when one is set.
  const [archivedViews, setArchivedViews] = useState<SessionView[] | null>(null);
  const [archivedFailed, setArchivedFailed] = useState(false);
  useEffect(() => {
    if (!archivedMode) return undefined;
    let cancelled = false;
    setArchivedViews(null);
    setArchivedFailed(false);
    api.listRuns(true)
      .then(({ runs: all }) => { if (!cancelled) setArchivedViews(all.filter((v) => v.session.archived_at != null && (q.project === null || dtoProjectOf(v) === q.project))); })
      .catch(() => { if (!cancelled) { setArchivedViews([]); setArchivedFailed(true); } });
    return () => { cancelled = true; };
  }, [archivedMode, q.project]);
  // Reset to the first page whenever the shape of the list changes under the operator.
  useEffect(() => { setPage(1); }, [text, q.filter, q.project]);

  const read = deskReadState(runsLoaded, runsError);
  const sourceViews = archivedMode ? (archivedViews ?? []) : runs;
  const allRows = useMemo(
    () => runRows(sourceViews, { runChatId, nameOf, includeArchived: archivedMode }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceViews, runChatId, projects, archivedMode],
  );
  const effFilter = archivedMode ? 'all' : q.filter;
  const filtered = useMemo(() => filterRunRows(allRows, { filter: effFilter, text }), [allRows, effFilter, text]);
  const sorted = useMemo(() => sortRunRows(filtered, sortKey, sortDir), [filtered, sortKey, sortDir]);
  const pageData = pageRunRows(sorted, page);
  const now = Date.now();

  const ready = archivedMode ? (archivedViews !== null && !archivedFailed) : (read === 'known' || read === 'stale');
  const onCol = (key: RunSortKey): void => {
    if (sortKey === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return; }
    setSortKey(key);
    setSortDir(key === 'updated' || key === 'created' ? 'desc' : 'asc');
  };
  const ariaSort = (key: RunSortKey): 'ascending' | 'descending' | 'none' => (sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none');
  const unarchive = (id: string): void => {
    void api.archiveRun(id, false)
      .then(() => { setArchivedViews((prev) => (prev === null ? prev : prev.filter((v) => v.session.id !== id))); onRetryRuns?.(); })
      .catch(() => { /* the row stays; the next read says */ });
  };

  return (
    <div data-testid="everything-runs" data-count={pageData.total} data-filter={q.filter}>
      {!archivedMode && read === 'checking' && <p data-testid="everything-checking" className="wk-session-grey">Reading your work…</p>}
      {!archivedMode && read === 'failed' && (
        <p data-testid="everything-failed" role="alert" className="wk-session-grey">
          Couldn’t read your work ({showText(runsError ?? '')}).
          {onRetryRuns !== undefined && <> <button type="button" data-testid="everything-retry" onClick={onRetryRuns} className="wk-since-toggle">Try again</button></>}
        </p>
      )}
      {!archivedMode && read === 'stale' && <p className="wk-session-grey">The last read failed ({showText(runsError ?? '')}); this is the list as last read.</p>}
      {archivedMode && archivedViews === null && <p data-testid="everything-checking" className="wk-session-grey">Reading what was archived…</p>}
      {archivedMode && archivedFailed && <p role="alert" className="wk-session-grey">Couldn’t read the archived runs.</p>}
      {ready && (
        <div className="wk-runs-controls">
          <input
            data-testid="runs-filter"
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Filter runs…"
            aria-label="Filter runs"
            className="wk-runs-filter"
          />
        </div>
      )}
      {ready && pageData.total === 0 && (
        <p data-testid="everything-empty" className="wk-session-grey">
          {archivedMode ? 'Nothing is archived.' : text.trim() !== '' ? 'No runs match this filter.' : q.project !== null ? 'Nothing has been started in this project yet.' : 'Nothing has been started yet.'}
        </p>
      )}
      {ready && pageData.total > 0 && (
        <div role="table" aria-label="Every run" data-testid="everything-runs-table" className="wk-runs-table">
          <div role="row" className="wk-runs-head">
            {RUN_COLS.map((c) => (
              <button
                key={c.key}
                type="button"
                role="columnheader"
                data-testid="runs-col"
                data-key={c.key}
                aria-sort={ariaSort(c.key)}
                onClick={() => onCol(c.key)}
                className="wk-runs-col"
              >
                {c.label}{sortKey === c.key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            ))}
            <span aria-hidden className="wk-runs-col wk-runs-col--menu" />
          </div>
          {pageData.slice.map((r) => {
            const path = sessionPath(r.sessionId);
            const finished = !archivedMode && FINISHED.has(r.status) ? viewOf(r.runId) : undefined;
            const open = menuFor === r.runId;
            return (
              <div key={r.runId} data-testid="runs-row" data-run-id={r.runId} data-session-id={r.sessionId} data-state={r.status} className="wk-runs-row">
                <div className="wk-runs-line">
                  <a href={path} onClick={go(path)} className="wk-runs-cells">
                    <span className="wk-runs-cell wk-runs-cell--state"><span aria-hidden className={`wk-desk-dot wk-desk-dot--${r.status}`} />{STATE_WORD[r.status]}</span>
                    <span className="wk-runs-cell wk-runs-cell--title">{showText(r.title)}</span>
                    <span className="wk-runs-cell">{r.project}</span>
                    <span className="wk-runs-cell">{r.repo ?? '—'}</span>
                    <span className="wk-runs-cell">{r.workflow}</span>
                    <span className="wk-runs-cell">{r.created > 0 ? `${ageWord(Math.max(0, now - r.created))} ago` : '—'}</span>
                    <span className="wk-runs-cell">{r.updated > 0 ? `${ageWord(Math.max(0, now - r.updated))} ago` : '—'}</span>
                  </a>
                  {archivedMode && (
                    <button type="button" data-testid="everything-unarchive" data-run-id={r.runId} onClick={() => unarchive(r.runId)} className="wk-since-toggle">Unarchive</button>
                  )}
                  <button
                    type="button"
                    data-testid="runs-row-menu"
                    data-run-id={r.runId}
                    aria-expanded={open}
                    aria-label="Row actions"
                    onClick={() => setMenuFor(open ? null : r.runId)}
                    className="wk-sheet-open"
                  >⋯</button>
                </div>
                {open && (
                  <div className="wk-runs-menu">
                    <button type="button" data-testid="runs-row-open" onClick={() => navigate(path)} className="wk-since-toggle">Open</button>
                    <button type="button" data-testid="runs-row-look" onClick={() => openSheet({ kind: 'session', sessionId: `run:${r.runId}` }, 'steps')} className="wk-since-toggle">Look underneath</button>
                    {finished !== undefined && <FinishedRunRow view={finished} selectedRunId={null} onSelect={() => navigate(path)} onArchive={archive} />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ready && pageData.total > 0 && pageData.pages > 1 && (
        <div data-testid="runs-pager" className="wk-runs-pager">
          <button type="button" data-testid="runs-pager-prev" disabled={pageData.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="wk-since-toggle">Previous</button>
          <span data-testid="runs-pager-at">page {pageData.page} of {pageData.pages}</span>
          <button type="button" data-testid="runs-pager-next" disabled={pageData.page >= pageData.pages} onClick={() => setPage((p) => p + 1)} className="wk-since-toggle">Next</button>
        </div>
      )}
    </div>
  );
}

/** The project the DTO files a run under, or null. */
function dtoProjectOf(v: SessionView): string | null {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  return typeof p === 'string' && p !== '' ? p : null;
}

/** The session states that are over — the row is the Work page's finished row with its moves. */
const FINISHED: ReadonlySet<string> = new Set(['done', 'blocked', 'quiet']);

/** The Archived lens: `GET /runs?archived` on pick, each run with Unarchive (the Work page's two calls).
 *  studio#511: Unarchive re-reads the runs list through `onChanged` (the same re-read Archive on a finished
 *  row triggers), so the run shows under its state filter without leaving the page. */
function ArchivedRuns({ navigate, runChatId, project, onChanged }: { navigate: Navigate; runChatId: boolean; project: string | null; onChanged: (() => void) | undefined }): React.ReactElement {
  const [rows, setRows] = useState<SessionView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const showText = useDisplayText();
  useEffect(() => {
    let cancelled = false;
    // A new scope starts from nothing: no row (and no Unarchive) of the previous project's survives
    // the tick before this project's read lands.
    setRows(null);
    setFailed(false);
    api.listRuns(true)
      .then(({ runs: all }) => {
        if (cancelled) return;
        // Scoped to one project: the runs the DTO files under it — never another project's.
        setRows(all.filter((v) => v.session.archived_at != null && (project === null || dtoProjectOf(v) === project)));
      })
      .catch(() => { if (!cancelled) { setRows([]); setFailed(true); } });
    return () => { cancelled = true; };
  }, [project]);
  const unarchive = (id: string): void => {
    void api.archiveRun(id, false)
      .then(() => {
        setRows((prev) => (prev === null ? prev : prev.filter((v) => v.session.id !== id)));
        onChanged?.();
      })
      .catch(() => { /* the row stays; the next read says */ });
  };
  return (
    <div data-testid="everything-archived" data-count={rows?.length ?? ''}>
      {rows === null && <p data-testid="everything-checking" className="wk-session-grey">Reading what was archived…</p>}
      {failed && <p role="alert" className="wk-session-grey">Couldn’t read the archived runs.</p>}
      {rows !== null && !failed && rows.length === 0 && <p data-testid="everything-empty" className="wk-session-grey">Nothing is archived.</p>}
      {rows !== null && rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((v) => {
            const path = sessionPath(sessionIdOf(v, runChatId));
            return (
              <li key={v.session.id} data-testid="everything-archived-run" data-run-id={v.session.id} className="wk-desk-session wk-everything-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a href={path} onClick={(e) => { e.preventDefault(); navigate(path); }} className="wk-desk-need-body" style={{ flex: '1 1 auto', opacity: 0.7 }}>
                  {/* studio#510: the same word the rail uses — an onboarding run names its repository. */}
                  <span className="wk-desk-session-title">{showText(plainRunTitle(v.session.problem || v.session.id))}</span>
                  {v.session.archive_note ? <span className="wk-desk-need-line">{showText(v.session.archive_note)}</span> : null}
                </a>
                <button type="button" data-testid="everything-unarchive" onClick={() => unarchive(v.session.id)} className="wk-since-toggle">Unarchive</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The daemon's live-chat census (what the retired Chats page listed): the warm chats that are not
 * already a session here — a quiet chat with no run would otherwise be undiscoverable after a
 * reload. Read from the needs-you sources store, which holds the one `GET /chats` the app makes at
 * boot (needs_shell: walking the routes re-reads nothing); never a fetch of its own. Each opens
 * `/chat/:id`; End closes it (the zombie-cleanup affordance) and drops it from the shared census.
 */
function LiveChats({ known, go }: { known: ReadonlySet<string>; go: Go }): React.ReactElement | null {
  const census = useNeedsSources((s) => s.chats);
  // What THIS client learned since boot (store/liveChats.ts): a chat opened after the census is
  // listed too, and one the /ws fold retired (`chatClosed` → `remove`) leaves the list — the two
  // sources reconciled, no read of their own (the Chats page did the same).
  const live = useLiveChatsStore((s) => s.sessions);
  const retired = useLiveChatsStore((s) => s.retired);
  const end = (id: string): void => {
    void api.closeChat(id)
      .then(() => {
        const cur = useNeedsSources.getState().chats;
        if (cur !== null) useNeedsSources.getState().depositChats(cur.filter((c) => c.chatId !== id));
        useLiveChatsStore.getState().remove(id);
      })
      .catch(() => { /* best effort — the daemon's idle reaper collects either way */ });
  };
  const rows = useMemo(() => {
    const byId = new Map<string, { chatId: string; seats: readonly string[]; idleSecs: number | null; title?: string }>();
    for (const c of census ?? []) {
      byId.set(c.chatId, { chatId: c.chatId, seats: (c as { seats?: readonly string[] }).seats ?? [], idleSecs: (c as { idleSecs?: number | null }).idleSecs ?? null });
    }
    for (const sess of Object.values(live)) {
      const prev = byId.get(sess.chatId);
      byId.set(sess.chatId, { chatId: sess.chatId, seats: sess.seats.length > 0 ? sess.seats : prev?.seats ?? [], idleSecs: prev?.idleSecs ?? null, ...(sess.title !== undefined ? { title: sess.title } : {}) });
    }
    // A census chat this client has since seen end (`chatClosed` → the store's `remove`) is dropped
    // too: the census row predates the frame.
    return [...byId.values()].filter((c) => !known.has(c.chatId) && !retired.has(c.chatId));
  }, [census, live, retired, known]);
  if (rows.length === 0) return null;
  return (
    <section data-testid="everything-live-chats" data-count={rows.length} className="wk-desk-card wk-everything-group">
      <p className="wk-desk-card-title"><span>Live chats</span></p>
      {rows.map((c) => {
        const path = `/chat/${encodeURIComponent(c.chatId)}`;
        const idle = c.idleSecs === null ? null : c.idleSecs < 60 ? 'just now' : `${ageWord(c.idleSecs * 1000)} ago`;
        const seats = c.seats;
        return (
          <div key={c.chatId} data-testid="everything-live-chat" data-chat-id={c.chatId} className="wk-desk-session" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span aria-hidden className="wk-desk-dot wk-desk-dot--working" />
            <a href={path} onClick={go(path)} className="wk-desk-need-body" style={{ flex: '1 1 auto' }}>
              <span className="wk-desk-session-title">{c.title !== undefined ? showTextOf(c.title) : `Chat with ${seats.length > 0 ? seats.join(', ') : 'no seat yet'}`}</span>
              <span className="wk-desk-need-line">{idle !== null ? `last activity ${idle}` : 'open'}</span>
            </a>
            <button type="button" data-testid="everything-live-chat-end" onClick={() => end(c.chatId)} className="wk-since-toggle">End</button>
          </div>
        );
      })}
    </section>
  );
}

// ── Everything made ──────────────────────────────────────────────────────────────────────────

function MadeTab({ runs, q, navigate, go }: { runs: SessionView[]; q: EverythingQuery; navigate: Navigate; go: Go }): React.ReactElement {
  const byProject = useDocsCache((s) => s.byProject);
  const unavailable = useDocsCache((s) => s.unavailable);
  const index = useDocsCache((s) => s.index);
  const census = useDocsCache((s) => s.census);
  const progress = useDocsCache((s) => s.fanoutProgress);
  const projects = useProjectsStore((s) => s.projects);
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const nameOf = useProjectName();
  const showText = useDisplayText();
  // The daemon-wide index: one cheap read, once per session (never a bridge spawn); absent on an
  // older daemon, in which case the list is what the projects opened this session listed.
  useEffect(() => { void useDocsCache.getState().loadIndex(); }, []);
  const rows = useMemo(() => madeRows(byProject, runs, projectIdByRun, q.kind, q.project), [byProject, runs, projectIdByRun, q.kind, q.project]);
  const now = Date.now();
  // The kind is a lens on the scope: a chip click keeps `?project=` (S18b).
  const lens = (kind: EverythingQuery['kind'], project: string | null = q.project): string => everythingPath({ tab: 'made', kind, project });
  const scopeName = q.project !== null ? nameOf(q.project) : null;
  const hrefOf = (r: MadeRow): string => {
    if (r.runId !== undefined) return r.projectId !== null ? modePath(r.projectId, 'video', r.runId) : sessionPath(`run:${r.runId}`);
    // A registry document — a demo's script included — opens as a document: the video surface takes
    // a RUN id, and a document name is not one (the retired dashboard did the same).
    return versionPath(r.projectId ?? 'default', r.doc!.name, null, 'document');
  };
  const askable = projects.filter((p) => p.id !== 'default').map((p) => p.id);
  const loadAll = (): void => { void useDocsCache.getState().loadAll(askable); };
  const censusLine = index === 'untried' || (index === 'present' && census === 'opened')
    ? 'Reading what this daemon has made…'
    : census === 'daemon' ? 'Everything this daemon has made, from its index.'
    : census === 'fanout' ? 'Everything the projects listed, each asked in turn.'
    : index === 'failed' ? 'Couldn’t read the daemon’s index — this is what the projects opened this session listed.'
    : 'This daemon keeps no index — this is what the projects opened this session listed.';
  const offerLoad = (index === 'absent' || index === 'failed') && progress === null && askable.length > 0;

  return (
    <div data-testid="everything-made" data-count={rows.length} data-kind={q.kind} data-census={census} data-index={index}>
      <div className="wk-everything-bar">
        <div role="group" aria-label="Show" className="wk-everything-chips">
          {MADE_KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={q.kind === k.id} data-testid="everything-kind" data-kind={k.id} onClick={() => navigate(lens(k.id), { replace: true })} className="wk-chip">{k.label}</button>
          ))}
        </div>
        {scopeName !== null && (
          <p data-testid="everything-scope" data-project-id={q.project ?? ''} className="wk-everything-scope">
            In <b>{scopeName}</b>
            {' · '}
            <a href={lens(q.kind, null)} onClick={(e) => { e.preventDefault(); navigate(lens(q.kind, null), { replace: true }); }} data-testid="everything-scope-clear">Every project</a>
          </p>
        )}
      </div>
      <p data-testid="everything-made-census" className="wk-session-grey">
        {censusLine}
        {offerLoad && <> <button type="button" data-testid="everything-made-load" onClick={loadAll} className="wk-since-toggle" title="One list per project, in turn — a project's bridge may take a minute to start">Ask every project</button></>}
        {progress !== null && <>
          {' '}Asking {progress.current ?? '…'} ({progress.done} of {progress.total})…{' '}
          <button type="button" data-testid="everything-made-cancel" onClick={() => useDocsCache.getState().cancelFanout()} title="Stop after the project being asked answers — what landed stays listed" className="wk-since-toggle">Cancel</button>
        </>}
      </p>
      {Object.entries(unavailable).map(([pid, why]) => (
        <p key={pid} data-testid="everything-made-unavailable" data-project-id={pid} className="wk-session-grey">Couldn’t list {nameOf(pid)}: {showText(why)}</p>
      ))}
      {rows.length === 0 && index !== 'untried' && (
        <p data-testid="everything-empty" className="wk-session-grey">
          {q.kind === 'all' ? 'Nothing made yet' : `No ${q.kind} yet`}{scopeName !== null ? ` in ${scopeName}` : ''}.
        </p>
      )}
      {rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((r) => (
            <li key={r.key}>
              <a href={hrefOf(r)} onClick={go(hrefOf(r))} data-testid="everything-made-row" data-kind={r.kind} data-project-id={r.projectId ?? ''} {...(r.runId !== undefined ? { 'data-run-id': r.runId, 'data-status': r.runStatus ?? '' } : { 'data-name': r.doc!.name })} className="wk-desk-session wk-everything-row">
                <span className="wk-desk-need-body">
                  <span className="wk-desk-session-title">{showText(r.title)}</span>
                  <span className="wk-desk-need-line">
                    {MADE_WORD[r.kind]} · {nameOf(r.projectId)}{r.updatedAt !== null ? ` · ${ageWord(Math.max(0, now - r.updatedAt))} ago` : ''}
                  </span>
                  {r.doc?.grounding !== undefined && <span className="wk-desk-need-line"><GroundingChip grounding={r.doc.grounding} /></span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

function HelpersTab(): React.ReactElement {
  const roster = useRoster();
  // Amendment 5, decision 5: Sign in opens the one plain-words panel; the row clears when the
  // re-read finds the seat back (useRoster follows the deposit).
  const [signIn, setSignIn] = useState<RosterSeat | null>(null);
  return (
    <div data-testid="everything-helpers" data-count={roster?.length ?? ''}>
      <p className="wk-session-grey">The AI helpers this daemon can give work to, and whether each is signed in.</p>
      {signIn !== null && <SignInPanel seat={signIn} onClose={() => setSignIn(null)} />}
      {roster === null && <p data-testid="everything-checking" className="wk-session-grey">Reading the roster…</p>}
      {roster !== null && roster.length === 0 && <p data-testid="everything-empty" className="wk-session-grey">No helper is set up on this daemon yet.</p>}
      {roster !== null && roster.length > 0 && (
        <ul className="wk-everything-list">
          {roster.map((seat) => <HelperRow key={seat.key} seat={seat} onSignIn={() => setSignIn(seat)} />)}
        </ul>
      )}
    </div>
  );
}

function HelperRow({ seat, onSignIn }: { seat: RosterSeat; onSignIn: () => void }): React.ReactElement {
  const standing = seatStandingWord(seat);
  const showText = useDisplayText();
  const health = seat.health;
  // The daemon's own words for an inactive seat — through the home-path formatter, like every message.
  const message = health?.status === 'inactive' && health.message !== undefined && health.message !== '' ? showText(health.message) : null;
  const state = health === undefined ? 'unknown' : health.status;
  return (
    <li data-testid="everything-helper" data-seat={seat.key} data-standing={standing.kind} data-health={state} className="wk-desk-session wk-everything-row">
      <span aria-hidden className={`wk-desk-dot wk-desk-dot--${state === 'active' ? (standing.kind === 'signed-out' || standing.kind === 'ineligible' ? 'waiting' : 'done') : state === 'inactive' ? 'blocked' : 'quiet'}`} />
      <span className="wk-desk-need-body">
        <span className="wk-desk-session-title">{seat.display_name || seat.key}</span>
        <span className="wk-desk-need-line" title={standing.title ?? undefined}>
          {message ?? [state === 'unknown' ? null : state, standing.detail].filter((s): s is string => s !== null).join(' · ')}
          {signInLapsed(seat) && <> · <a href="/system" onClick={(e) => { e.preventDefault(); onSignIn(); }} data-testid="everything-helper-signin">Sign in →</a></>}
        </span>
      </span>
    </li>
  );
}

// ── Handed over ──────────────────────────────────────────────────────────────────────────────

function HandedTab({ runs, runsLoaded, go }: { runs: SessionView[]; runsLoaded: boolean; go: Go }): React.ReactElement {
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const nameOf = useProjectName();
  const rows = useMemo(() => handedRows(runs, deliveredNow, runChatId, projectIdByRun), [runs, deliveredNow, runChatId, projectIdByRun]);
  const now = Date.now();
  return (
    <div data-testid="everything-handed" data-count={rows.length}>
      <p className="wk-session-grey">Work that left this machine: a pull request opened, or a branch pushed.</p>
      {!runsLoaded && <p data-testid="everything-checking" className="wk-session-grey">Reading your work…</p>}
      {runsLoaded && rows.length === 0 && <p data-testid="everything-empty" className="wk-session-grey">Nothing has been handed over yet.</p>}
      {rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((r) => <HandedRowView key={r.runId} r={r} name={nameOf(r.projectId)} now={now} go={go} />)}
        </ul>
      )}
    </div>
  );
}

function HandedRowView({ r, name, now, go }: { r: HandedRow; name: string; now: number; go: Go }): React.ReactElement {
  const showText = useDisplayText();
  const when = r.when > 0 ? `${ageWord(Math.max(0, now - r.when))} ago` : null;
  const word = r.claim === 'pr-open' ? 'pull request open' : r.claim === 'pushed' ? `pushed${r.branch !== null ? ` to ${r.branch}` : ''}` : 'handed over';
  return (
    <li data-testid="everything-handed-row" data-run-id={r.runId} data-claim={r.claim} className="wk-desk-session wk-everything-row">
      <span aria-hidden className="wk-desk-dot wk-desk-dot--done" />
      <span className="wk-desk-need-body">
        <span className="wk-desk-session-title">{showText(r.title)}</span>
        <span className="wk-desk-need-line">
          {word} · {name}{when !== null ? ` · ${when}` : ''}
          {' · '}
          <a href={sessionPath(r.sessionId)} onClick={go(sessionPath(r.sessionId))} data-testid="everything-handed-open">Open the session →</a>
          {r.href !== null && <> · <a href={r.href} target="_blank" rel="noreferrer" data-testid="everything-handed-pr">Pull request ↗</a></>}
        </span>
      </span>
    </li>
  );
}
