import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import type { Project } from '../../api/types.js';
import type { SessionView } from '../../api/types.js';
import { deskReadState, needsByRun, needTextByRun, railGroups, sessionLine, type RailGroup } from '../../board/deskModel.js';
import { canDeliver, DELIVERY_LABEL, deliveryOf, resolveDelivery } from '../delivery.js';
import { useIsSystemWorkflow } from '../../store/workflowCache.js';
import {
  EVERYTHING_TABS, EVERYTHING_VIEWS, everythingPath, filterGroups, handedRows, MADE_KINDS, MADE_WORD, madeRows, readEverythingQuery, searchGroups,
  SESSION_FILTERS, TAB_LABEL, type EverythingQuery, type EverythingTab, type HandedRow, type MadeRow,
} from '../../board/everythingModel.js';
import { endedAtMs, finishedAtMs, type NeedRow } from '../../board/needsYou.js';
import { sessionPath, type SessionState } from '../../board/sessionModel.js';
import { filterRunRows, pageRunRows, runRows, sortRunRows, type RunSortKey, type SortDir } from '../../board/runsTableModel.js';
import { openSheet } from '../../store/sheets.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { projectTestsPath as testsPath } from '../../api/testing.js';
import { useCapabilities } from '../../store/capabilities.js';
import { useDocsCache } from '../../store/docsCache.js';
import { useNeedsSources } from '../../store/needsSources.js';
import { useLiveChatsStore } from '../../store/liveChats.js';
import { displayText as showTextOf } from '../../board/homePath.js';
import { useDisplayText } from '../../hooks/useHomePath.js';
import { useMembershipStore } from '../../store/membership.js';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import { useProjectsStore } from '../../store/projects.js';
import { jobTitle } from '../../board/deskWords.js';
import { runTechParts, Tech } from '../Tech.js';
import { ProjectEntry, ProjectsTab } from './ProjectsTab.js';
import { projectRows } from '../../board/projectsModel.js';
import { GroundingChip } from '../GroundingChip.js';
import { madeOpenAddress } from '../../board/madeMoves.js';
import { MadeOpen } from './MadeOpen.js';
import { NewDocument } from './NewDocument.js';
import { DEMO_VIDEO_ID, openLaunchWizard } from '../../store/launchWizard.js';
import { DocDeleteConfirm } from '../DocDelete.js';
import { EmptyState, OverflowMenu, Skeleton, StateBanner, TechDetails } from '../ui/index.js';
import { readErrorKind } from '../../api/errors.js';
import { statusWord, chatStatusWord, type StatusTone } from '../../board/statusWords.js';
import { absTime, relTime } from '../../board/relTime.js';
import { FinishedRunMenu } from './FinishedRunMenu.js';

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
export function EverythingPage({ runs, runsLoaded, runsError = null, onRetryRuns, needRows, navigate, search }: {
  runs: SessionView[];
  runsLoaded: boolean;
  runsError?: string | null;
  onRetryRuns?: () => void;
  needRows: NeedRow[];
  navigate: Navigate;
  /** The current `location.search` — the tab, filter, scope and kind. */
  search: string;
}): React.ReactElement {
  const q = readEverythingQuery(search);
  const project = q.project;
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
          <h1 className="wk-page-title">Everything</h1>
          <p className="wk-page-intro">Every session, everything made, and what was handed over.</p>
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
          {q.tab === 'handed' && <HandedTab runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns} go={go} />}
          {q.tab === 'projects' && <ProjectsTab q={q} runs={runs} runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns} needRows={needRows} navigate={navigate} />}
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
  // studio#684 row 11: a count is said only once the runs read answered — a failed read never says "0 runs".
  const known = read === 'known' || read === 'stale';
  // The view (`?view=`) rides every Sessions lens so a chip click inside "Every run" stays there.
  const lens = (over: Partial<EverythingQuery>): string => everythingPath({ tab: 'sessions', filter: q.filter, project: q.project, view: q.view, ...over });
  // The full count in the tab header ("124 runs · 97 sessions") — runs scoped the same way as the
  // session total, archived excluded. A cheap reduce, never the row fold.
  const runCount = runs.reduce((n, v) => (v.session.archived_at == null && (q.project === null || dtoProjectOf(v) === q.project) ? n + 1 : n), 0);
  const scopeName = q.project !== null ? nameOf(q.project) : null;
  const viewOf = (runId: string): SessionView | undefined => runs.find((v) => v.session.id === runId);
  const showText = useDisplayText();
  const isSystemWorkflow = useIsSystemWorkflow();
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
      {q.filter !== 'archived' && <RunsReadBanner read={read} runsError={runsError} onRetryRuns={onRetryRuns} />}
      {projectHeader !== null && <ProjectEntry row={projectHeader} countsKnown={known} navigate={navigate} header onStatusChanged={(changed) => setArchivedProjects((old) => changed.status === 'archived' ? [changed, ...old.filter((p) => p.id !== changed.id)] : old.filter((p) => p.id !== changed.id))} />}
      {read !== 'failed' && <div className="wk-everything-bar">
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
            <a href={lens({ project: null })} onClick={(e) => { e.preventDefault(); navigate(lens({ project: null }), { replace: true }); }} data-testid="everything-scope-clear" className="wk-link">Every project</a>
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
          {known && q.filter !== 'archived' && (
            <p data-testid="everything-count" data-runs={runCount} data-sessions={total} className="wk-everything-count">
              {countWord(runCount, 'run')} · {countWord(total, 'session')}
            </p>
          )}
        </div>
      </div>}
      {q.view === 'runs' && (
        <RunsTable
          runs={runs} runChatId={runChatId} projects={projects} q={q}
          runsLoaded={runsLoaded} runsError={runsError} onRetryRuns={onRetryRuns}
          navigate={navigate} go={go} archive={archive} viewOf={viewOf} showText={showText}
        />
      )}
      {q.view === 'grouped' && (<>
      {q.filter === 'archived' && <ArchivedRuns key={q.project ?? ''} navigate={navigate} project={q.project} onChanged={onRetryRuns} />}
      {q.filter !== 'archived' && read === 'checking' && <Skeleton data-testid="everything-checking" rows={4} />}
      {q.filter !== 'archived' && known && total === 0 && (
        <EmptyState data-testid="everything-empty"
          title={q.project !== null ? 'Nothing has been started in this project yet.' : 'Nothing has been started yet.'}
          body="Start something from the Desk; every session shows up here." />
      )}
      {q.filter !== 'archived' && known && total > 0 && shown.length === 0 && searching && (
        <p data-testid="everything-empty" className="wk-everything-note">
          No sessions match “{query.trim()}”{scopeName !== null ? ` in ${scopeName}` : ''}.{' '}
          <button type="button" data-testid="everything-search-clear" onClick={() => setQuery('')} className="wk-btn wk-btn--secondary wk-btn--sm">Clear the search</button>
        </p>
      )}
      {q.filter !== 'archived' && known && total > 0 && shown.length === 0 && !searching && (
        <p data-testid="everything-empty" className="wk-everything-note">
          No sessions match this filter{scopeName !== null ? ` in ${scopeName}` : ''}.{' '}
          <button type="button" data-testid="everything-show-all" onClick={() => navigate(lens({ filter: 'all' }), { replace: true })} className="wk-btn wk-btn--secondary wk-btn--sm">Show all</button>
        </p>
      )}
      {q.filter !== 'archived' && shown.map((g) => (
        <section key={g.projectId ?? 'unfiled'} data-testid="everything-group" data-project-id={g.projectId ?? ''} className="wk-desk-card wk-everything-group">
          <p className="wk-desk-card-title">
            <span>{g.name}</span>
            {g.projectId !== null && (
              <span className="wk-desk-card-aside wk-everything-aside">
                <a href={projectDetailPath(g.projectId)} onClick={go(projectDetailPath(g.projectId))} data-testid="everything-group-details" className="wk-link">Details</a>
                <a href={testsPath(g.projectId)} onClick={go(testsPath(g.projectId))} data-testid="everything-group-tests" className="wk-link">Write tests</a>
              </span>
            )}
          </p>
          {g.sessions.map((s) => {
            // One dot and ONE status word per row (studio#687 rows 35, 36): the word is `statusWord`'s,
            // the line a needs-you item's own words when the session has one.
            const views = s.runIds.map(viewOf).filter((v): v is SessionView => v !== undefined);
            // A live session (one run still working or waiting) says so, whatever its newest run did.
            const word = s.state === 'waiting' ? { word: 'Waiting on you', tone: 'gate' as const }
              : s.state === 'working' ? { word: 'Working', tone: 'run' as const }
              : views.length > 0 ? chatStatusWord(views) : null;
            const at = lastActivityMs(views);
            // A needs-you item's words, or a delivery line ("handed over just now"), are kept; the state's
            // generic sentence is replaced by the one status word.
            const generic = s.line === sessionLine(s.state, 0, null);
            const delivery = views.length === 1 && FINISHED.has(s.state) ? deliveryWord(views[0]!, isSystemWorkflow) : null;
            const line = s.badge > 0 || !generic ? showText(s.line) : [word?.word ?? showText(s.line), delivery].filter(Boolean).join(' · ');
            const link = (
              <a href={s.path} onClick={go(s.path)} className="wk-desk-session wk-everything-srow">
                <span aria-hidden className={`wk-everything-dot wk-everything-dot--${word?.tone ?? toneOfState(s.state)}`} />
                <span className="wk-desk-need-body">
                  <span className="wk-desk-session-title">{showText(s.title)}</span>
                  <span className={`wk-desk-need-line${s.state === 'waiting' ? ' wk-desk-underline' : ''}`}>
                    {line}
                    {at !== null && <> · <time dateTime={new Date(at).toISOString()} title={absTime(at)}>{relTime(at)}</time></>}
                  </span>
                  {/* The run's handles with "Show technical details" on — the same parts the run row showed. */}
                  <Tech data-testid="tech-session-row" parts={s.runIds.length === 1 && viewOf(s.runId) !== undefined ? runTechParts(viewOf(s.runId)!.session) : s.runIds} block />
                </span>
              </a>
            );
            // A finished run keeps the Work page's next-use moves — Reuse as preset, Draft update,
            // Archive — in ONE "⋯" menu on its row (FinishedRunMenu).
            const finished = FINISHED.has(s.state) && s.runIds.length === 1 ? viewOf(s.runId) : undefined;
            return (
              <div key={s.id} data-testid="everything-session" data-session-id={s.id} data-run-id={s.runId} data-run-ids={s.runIds.join(' ')} data-state={s.state} data-word={word?.word ?? ''} {...(finished !== undefined ? { 'data-finished': 'true' } : {})} className="wk-everything-session">
                {finished !== undefined
                  ? <FinishedRunMenu view={finished} title={showText(s.title)} onArchive={archive}>{link}</FinishedRunMenu>
                  : link}
              </div>
            );
          })}
        </section>
      ))}
      {q.filter !== 'archived' && q.project === null && <LiveChats known={new Set(groups.flatMap((g) => g.sessions.map((s) => s.id)))} go={go} />}
      {q.filter !== 'archived' && archivedProjects.length > 0 && (
        <p data-testid="everything-archived-projects" className="wk-everything-note">
          Archived projects:{' '}
          {archivedProjects.map((p, i) => (
            <span key={p.id}>{i > 0 ? ', ' : ''}<a href={projectDetailPath(p.id)} onClick={go(projectDetailPath(p.id))} data-testid="everything-archived-project" data-project-id={p.id} className="wk-link">{p.name}</a></span>
          ))}
          . Open one to restore it.
        </p>
      )}
      </>)}
    </div>
  );
}

/**
 * The one state banner of the Sessions tab (UI-CONTRACT §4.7; studio#684 rows 10, 11): offline or
 * error with Retry when the runs read failed, stale when an older list is shown. The raw error is only
 * ever inside its technical details.
 */
function RunsReadBanner({ read, runsError, onRetryRuns }: { read: ReturnType<typeof deskReadState>; runsError: string | null; onRetryRuns: (() => void) | undefined }): React.ReactElement | null {
  if (read === 'failed') return <StateBanner data-testid="everything-failed" kind={readErrorKind(runsError)} what="your work" error={runsError} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />;
  if (read === 'stale') return <StateBanner data-testid="everything-stale" kind="stale" error={runsError} {...(onRetryRuns !== undefined ? { onRetry: onRetryRuns } : {})} />;
  return null;
}

/** The session's newest clock (ms) — the Every-run table's "Updated": a run's end, else its launch; null when none is known. */
function lastActivityMs(views: readonly SessionView[]): number | null {
  let best = 0;
  for (const v of views) {
    const c = (v.session as unknown as { created_at?: unknown }).created_at;
    const n = endedAtMs(v) ?? finishedAtMs(v) ?? (typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0);
    if (n > best) best = n;
  }
  return best > 0 ? best : null;
}

/** What left this machine for a finished run, in the rail's words ("pull request open", "branch pushed"), or null. */
function deliveryWord(view: SessionView, isSystemWorkflow: ReturnType<typeof useIsSystemWorkflow>): string | null {
  if (!canDeliver(view, isSystemWorkflow)) return null;
  const { claim } = resolveDelivery(deliveryOf(view));
  return claim === 'none' || claim === 'in-flight' ? null : DELIVERY_LABEL[claim] || null;
}

/** A workflow's name for the table; a generated plan id ("wf-e08e99b9-…") is an internal handle, never shown. */
function workflowWord(workflow: string): string {
  return /^wf-[0-9a-f]{6,}/i.test(workflow) ? '—' : workflow;
}

/** A row's tone when no run view is at hand (a chat with no run yet): the session state's. */
function toneOfState(state: SessionState): StatusTone {
  return state === 'waiting' ? 'gate' : state === 'working' ? 'run' : state === 'blocked' ? 'fail' : state === 'done' ? 'ok' : 'quiet';
}

/** "N runs" / "1 run" — the count sentence's plural. */
function countWord(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ── Every run (S17b): one row per RUN, sortable / filterable / paged ────────────────────────

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
  const archivedViewOf = (id: string): SessionView | undefined => archivedViews?.find((v) => v.session.id === id);

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
      {/* The failed / stale banner is the Sessions tab's one RunsReadBanner, above the bar. */}
      {!archivedMode && read === 'checking' && <Skeleton data-testid="everything-checking" rows={5} />}
      {archivedMode && archivedViews === null && <Skeleton data-testid="everything-checking" rows={3} />}
      {archivedMode && archivedFailed && <StateBanner data-testid="everything-archived-failed" kind="error" what="the archived runs" />}
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
        <EmptyState data-testid="everything-empty"
          title={archivedMode ? 'Nothing is archived.' : text.trim() !== '' ? 'No runs match this filter.' : q.project !== null ? 'Nothing has been started in this project yet.' : 'Nothing has been started yet.'} />
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
            // studio#675: an archived run opens at its run address (its chat's session reads the live index).
            const path = sessionPath(archivedMode ? `run:${r.runId}` : r.sessionId);
            const view = archivedMode ? archivedViewOf(r.runId) : viewOf(r.runId);
            const word = view !== undefined ? statusWord(view) : { word: 'Unknown' as const, tone: 'quiet' as const };
            const finished = !archivedMode && FINISHED.has(r.status) ? view : undefined;
            const title = showText(r.title);
            const lead = [
              { id: 'open', label: 'Open', onSelect: () => navigate(path) },
              { id: 'steps', label: 'See the steps', onSelect: () => openSheet({ kind: 'session', sessionId: `run:${r.runId}` }, 'steps') },
            ];
            const cells = (
              <a href={path} onClick={go(path)} className="wk-runs-cells">
                <span className="wk-runs-cell wk-runs-cell--state"><span aria-hidden className={`wk-everything-dot wk-everything-dot--${word.tone}`} />{word.word}</span>
                <span className="wk-runs-cell wk-runs-cell--title" title={title}>{title}</span>
                <span className="wk-runs-cell">{r.project}</span>
                <span className="wk-runs-cell">{r.repo ?? '—'}</span>
                <span className="wk-runs-cell">{workflowWord(r.workflow)}</span>
                <span className="wk-runs-cell" title={r.created > 0 ? absTime(r.created) : undefined}>{r.created > 0 ? relTime(r.created, now) : '—'}</span>
                <span className="wk-runs-cell" title={r.updated > 0 ? absTime(r.updated) : undefined}>{r.updated > 0 ? relTime(r.updated, now) : '—'}</span>
              </a>
            );
            return (
              <div key={r.runId} data-testid="runs-row" data-run-id={r.runId} data-session-id={r.sessionId} data-state={r.status} data-word={word.word} className="wk-runs-row">
                {finished !== undefined ? (
                  <FinishedRunMenu view={finished} title={title} lead={lead} onArchive={archive} lineClassName="wk-runs-line" data-testid="runs-row-menu">{cells}</FinishedRunMenu>
                ) : (
                  <div className="wk-runs-line">
                    {cells}
                    {archivedMode && (
                      <button type="button" data-testid="everything-unarchive" data-run-id={r.runId} onClick={() => unarchive(r.runId)} className="wk-btn wk-btn--secondary wk-btn--sm">Unarchive</button>
                    )}
                    <OverflowMenu data-testid="runs-row-menu" label={`More actions for ${title}`} items={lead} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {ready && pageData.total > 0 && pageData.pages > 1 && (
        <div data-testid="runs-pager" className="wk-runs-pager">
          <button type="button" data-testid="runs-pager-prev" disabled={pageData.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="wk-btn wk-btn--secondary wk-btn--sm">Previous</button>
          <span data-testid="runs-pager-at">Page {pageData.page} of {pageData.pages}</span>
          <button type="button" data-testid="runs-pager-next" disabled={pageData.page >= pageData.pages} onClick={() => setPage((p) => p + 1)} className="wk-btn wk-btn--secondary wk-btn--sm">Next</button>
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
function ArchivedRuns({ navigate, project, onChanged }: { navigate: Navigate; project: string | null; onChanged: (() => void) | undefined }): React.ReactElement {
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
      {rows === null && <Skeleton data-testid="everything-checking" rows={3} />}
      {failed && <StateBanner data-testid="everything-archived-failed" kind="error" what="the archived runs" />}
      {rows !== null && !failed && rows.length === 0 && <EmptyState data-testid="everything-empty" title="Nothing is archived." />}
      {rows !== null && rows.length > 0 && (
        <ul className="wk-everything-list">
          {rows.map((v) => {
            // studio#675: an archived run opens at its own run address, which the session resolves through
            // GET /runs/:id. Its chat's session reads the live index, which leaves archived runs out.
            const path = sessionPath(`run:${v.session.id}`);
            return (
              <li key={v.session.id} data-testid="everything-archived-run" data-run-id={v.session.id} className="wk-desk-session wk-everything-row wk-everything-actrow">
                <a href={path} onClick={(e) => { e.preventDefault(); navigate(path); }} className="wk-desk-need-body wk-everything-grow">
                  {/* studio#510: the same word the rail uses — an onboarding run names its repository. */}
                  <span className="wk-desk-session-title">{showText(jobTitle(v.session))}</span>
                  {v.session.archive_note ? <span className="wk-desk-need-line">{showText(v.session.archive_note)}</span> : null}
                </a>
                <button type="button" data-testid="everything-unarchive" onClick={() => unarchive(v.session.id)} className="wk-btn wk-btn--secondary wk-btn--sm">Unarchive</button>
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
        // S16a-4e: a chat is its session.
        const path = sessionPath(c.chatId);
        const idle = c.idleSecs === null ? null : relTime(Date.now() - c.idleSecs * 1000);
        const seats = c.seats;
        return (
          <div key={c.chatId} data-testid="everything-live-chat" data-chat-id={c.chatId} className="wk-desk-session wk-everything-actrow">
            <span aria-hidden className="wk-everything-dot wk-everything-dot--run" />
            <a href={path} onClick={go(path)} className="wk-desk-need-body wk-everything-grow">
              <span className="wk-desk-session-title">{c.title !== undefined ? showTextOf(c.title) : `Chat with ${seats.length > 0 ? seats.join(', ') : 'no seat yet'}`}</span>
              <span className="wk-desk-need-line">{idle !== null ? `last activity ${idle}` : 'open'}</span>
            </a>
            <button type="button" data-testid="everything-live-chat-end" onClick={() => end(c.chatId)} className="wk-btn wk-btn--quiet wk-btn--sm">End chat</button>
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
  // S16a-4c: a made thing opens in the session that made it — a demo video at full size on its run's
  // session, a document on its bound run's session (live first, else newest, else archived), and a
  // document no run is bound to on this list, opened at full size (`?open=`).
  const runChatId = useCapabilities((s) => s.runChatId);
  const hrefOf = (r: MadeRow): string => {
    if (r.runId !== undefined) return madeOpenAddress('video', r.projectId ?? 'default', r.runId, runs, runChatId);
    return madeOpenAddress('document', r.projectId ?? 'default', r.doc!.name, runs, runChatId);
  };
  // S16a-4d: the Made list's two doors — "New document" (the bar; `?new=document` opens it) and a
  // "Delete…" on each document row (DocDeleteConfirm, its one "Are you sure?").
  const [deleting, setDeleting] = useState<{ projectId: string; name: string } | null>(null);
  const doorOpen = q.new === 'document';
  const withDoor = (open: boolean): string => everythingPath({ tab: 'made', kind: q.kind, project: q.project, ...(open ? { new: 'document' as const } : {}) });
  const opened = q.open !== null && q.open !== undefined ? rows.find((r) => r.doc !== undefined && r.doc.name === q.open && (q.project === null || r.projectId === q.project)) ?? null : null;
  const askable = projects.filter((p) => p.id !== 'default').map((p) => p.id);
  const loadAll = (): void => { void useDocsCache.getState().loadAll(askable); };
  // studio#687 row 75: plain words — no "daemon", no "index". The complete list says nothing about itself.
  const reading = index === 'untried' || (index === 'present' && census === 'opened');
  const censusLine = reading || census === 'daemon'
    ? null
    : census === 'fanout' ? 'What each project listed.'
    : index === 'failed' ? 'Couldn’t read the full list. Showing what the projects you opened listed.'
    : 'Showing what the projects you opened listed.';
  const offerLoad = (index === 'absent' || index === 'failed') && progress === null && askable.length > 0;

  return (
    <div data-testid="everything-made" data-count={rows.length} data-kind={q.kind} data-census={census} data-index={index}>
      {opened !== null && opened.doc !== undefined && (
        <MadeOpen projectId={opened.projectId ?? 'default'} docId={opened.doc.name} title={showText(opened.title)} style={opened.doc.kind ?? null} onClose={() => navigate(everythingPath({ tab: 'made', kind: q.kind, project: q.project }), { replace: true })} />
      )}
      <div className="wk-everything-bar">
        <div role="group" aria-label="Show" className="wk-everything-chips">
          {MADE_KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={q.kind === k.id} data-testid="everything-kind" data-kind={k.id} onClick={() => navigate(lens(k.id), { replace: true })} className="wk-chip">{k.label}</button>
          ))}
        </div>
        {!doorOpen && (
          <button type="button" data-testid="made-new-document" onClick={() => navigate(withDoor(true), { replace: true })} className="wk-btn wk-btn--secondary wk-btn--sm">New document</button>
        )}
        {/* studio#664: the videos list's own door — the New job wizard's Demo video form, in the list's
            project; an Unfiled list names the unfiled mount, so another project's saved draft never resumes. */}
        {q.kind === 'videos' && (
          <button type="button" data-testid="made-new-demo" onClick={() => openLaunchWizard({ workflowId: DEMO_VIDEO_ID, projectId: q.project ?? null })} className="wk-btn wk-btn--secondary wk-btn--sm">New demo video</button>
        )}
        {scopeName !== null && (
          <p data-testid="everything-scope" data-project-id={q.project ?? ''} className="wk-everything-scope">
            In <b>{scopeName}</b>
            {' · '}
            <a href={lens(q.kind, null)} onClick={(e) => { e.preventDefault(); navigate(lens(q.kind, null), { replace: true }); }} data-testid="everything-scope-clear" className="wk-link">Every project</a>
          </p>
        )}
      </div>
      {doorOpen && (
        <NewDocument
          projects={projects}
          initialProject={q.project}
          onClose={() => navigate(withDoor(false), { replace: true })}
          onCreated={(pid, name) => navigate(everythingPath({ tab: 'made', kind: 'documents', project: pid, open: name }), { replace: true })}
          onOpen={(pid, name) => navigate(everythingPath({ tab: 'made', kind: 'documents', project: pid, open: name }))}
        />
      )}
      {deleting !== null && (
        <DocDeleteConfirm projectId={deleting.projectId} docId={deleting.name} subject="document" onClose={() => setDeleting(null)} onDeleted={() => setDeleting(null)} />
      )}
      {reading && rows.length === 0 && <Skeleton data-testid="everything-made-reading" rows={3} />}
      {(censusLine !== null || offerLoad || progress !== null) && (
        <p data-testid="everything-made-census" className="wk-everything-note">
          {censusLine}
          {offerLoad && <> <button type="button" data-testid="everything-made-load" onClick={loadAll} className="wk-btn wk-btn--secondary wk-btn--sm" title="One list per project, in turn. A project may take a minute to answer.">Ask every project</button></>}
          {progress !== null && <>
            {' '}Asking {progress.current ?? '…'} ({progress.done} of {progress.total})…{' '}
            <button type="button" data-testid="everything-made-cancel" onClick={() => useDocsCache.getState().cancelFanout()} title="Stop after the project being asked answers. What landed stays listed." className="wk-btn wk-btn--quiet wk-btn--sm">Cancel</button>
          </>}
        </p>
      )}
      {Object.entries(unavailable).map(([pid, why]) => (
        <div key={pid} data-testid="everything-made-unavailable" data-project-id={pid} className="wk-everything-note">
          <p className="wk-everything-note">Couldn’t list what {nameOf(pid)} made.</p>
          <TechDetails text={showText(why)} />
        </div>
      ))}
      {rows.length === 0 && !reading && (
        <EmptyState data-testid="everything-empty"
          title={`${q.kind === 'all' ? 'Nothing made yet' : `No ${q.kind} yet`}${scopeName !== null ? ` in ${scopeName}` : ''}.`}
          body="Documents, pages, decks and demo videos your sessions make show up here." />
      )}
      {rows.length > 0 && (
        <ul className="wk-everything-list wk-desk-card wk-everything-group wk-everything-madelist">
          {rows.map((r) => (
            <li key={r.key} className="wk-made-li">
              <a href={hrefOf(r)} onClick={go(hrefOf(r))} data-testid="everything-made-row" data-kind={r.kind} data-project-id={r.projectId ?? ''} {...(r.runId !== undefined ? { 'data-run-id': r.runId, 'data-status': r.runStatus ?? '' } : { 'data-name': r.doc!.name })} className="wk-desk-session wk-everything-row">
                <span className="wk-desk-need-body">
                  <span className="wk-desk-session-title">{showText(r.title)}</span>
                  <span className="wk-desk-need-line">
                    {MADE_WORD[r.kind]} · {nameOf(r.projectId)}{r.updatedAt !== null ? <> · <time title={absTime(r.updatedAt)}>{relTime(r.updatedAt, now)}</time></> : ''}
                  </span>
                  {r.doc?.grounding !== undefined && <span className="wk-desk-need-line"><GroundingChip grounding={r.doc.grounding} /></span>}
                </span>
              </a>
              {r.doc !== undefined && (
                <button type="button" data-testid="made-row-delete" data-name={r.doc.name} aria-label={`Delete ${r.title}`} onClick={() => setDeleting({ projectId: r.projectId ?? 'default', name: r.doc!.name })} className="wk-btn wk-btn--quiet wk-btn--sm wk-made-delete">Delete…</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Handed over ──────────────────────────────────────────────────────────────────────────────

function HandedTab({ runs, runsLoaded, runsError, onRetryRuns, go }: { runs: SessionView[]; runsLoaded: boolean; runsError: string | null; onRetryRuns: (() => void) | undefined; go: Go }): React.ReactElement {
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const projectIdByRun = useMembershipStore((s) => s.projectIdByRun);
  const nameOf = useProjectName();
  const rows = useMemo(() => handedRows(runs, deliveredNow, runChatId, projectIdByRun), [runs, deliveredNow, runChatId, projectIdByRun]);
  const now = Date.now();
  const read = deskReadState(runsLoaded, runsError);
  return (
    <div data-testid="everything-handed" data-count={rows.length}>
      <RunsReadBanner read={read} runsError={runsError} onRetryRuns={onRetryRuns} />
      <p className="wk-everything-note">Work that left this machine: a pull request opened, or a branch pushed.</p>
      {read === 'checking' && <Skeleton data-testid="everything-checking" rows={3} />}
      {(read === 'known' || read === 'stale') && rows.length === 0 && (
        <EmptyState data-testid="everything-empty" title="Nothing has been handed over yet."
          body="When a session opens a pull request or pushes a branch, it shows up here." />
      )}
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
  const when = r.when > 0 ? relTime(r.when, now) : null;
  const word = r.claim === 'pr-open' ? 'pull request open' : r.claim === 'pushed' ? `pushed${r.branch !== null ? ` to ${r.branch}` : ''}` : 'handed over';
  return (
    <li data-testid="everything-handed-row" data-run-id={r.runId} data-claim={r.claim} className="wk-desk-session wk-everything-row">
      <span aria-hidden className="wk-everything-dot wk-everything-dot--ok" />
      <span className="wk-desk-need-body">
        <span className="wk-desk-session-title">{showText(r.title)}</span>
        <span className="wk-desk-need-line">{word} · {name}{when !== null ? ` · ${when}` : ''}</span>
        <span className="wk-everything-acts">
          <a href={sessionPath(r.sessionId)} onClick={go(sessionPath(r.sessionId))} data-testid="everything-handed-open" className="wk-link">Open the session</a>
          {r.href !== null && <a href={r.href} target="_blank" rel="noreferrer" data-testid="everything-handed-pr" className="wk-link">Pull request ↗</a>}
        </span>
      </span>
    </li>
  );
}
