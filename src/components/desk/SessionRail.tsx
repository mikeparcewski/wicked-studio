import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, FolderPlus, LayoutGrid, MessageSquare, MessageSquarePlus, Plus, Search } from 'lucide-react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import { needsByRun, needTextByRun, needsYouWords, railGroups, railRecent, railRowWords } from '../../board/deskModel.js';
import { BUILD_ITEM, DESK_VIEW_PATH, NAV_GROUPS, navCurrent, type NavItem } from '../../board/navModel.js';
import { useRailCollapsed } from '../../hooks/useRailCollapsed.js';
import { useNeedsClock, useSettledNeeds } from '../../hooks/useNeedsRows.js';
import type { NeedRow } from '../../board/needsYou.js';
import { MoveToProject, MoveProjectStatus, useMovableBoardModel } from './MoveToProject.js';
import { useCapabilities } from '../../store/capabilities.js';
import { projectDetailPath, type Navigate } from '../../hooks/useRoute.js';
import { useAppearanceStore } from '../../theming/appearance.js';
import { openLaunchWizard } from '../../store/launchWizard.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import { NerveCenterTile } from './NerveCenterTile.js';
import { NewProjectModal } from '../NewProjectModal.js';
import { openSystemChat } from '../../store/askDock.js';
import { useChatWindow } from '../../store/chatWindow.js';
import { openSearch } from '../../store/searchModal.js';
import { pageComposerKey } from '../../store/composerSeed.js';
import { useProjectsStore } from '../../store/projects.js';

/** The modifier the shortcuts are said with (⌘ on a Mac, Ctrl elsewhere). */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';

/** New job where you are: the launch wizard, in the project on screen (never the Unfiled bucket),
 *  launching from the page's composer when it has one. The rail's and the phone top bar's New job. */
export function startNewJob(ambientProject: string | null): void {
  openLaunchWizard({ projectId: ambientProject !== null && ambientProject !== 'default' ? ambientProject : null, composerKey: pageComposerKey() ?? 'desk' });
}

/** The Recent list's fold key in `useRailCollapsed` (a project id never starts with NUL). */
const RECENT_KEY = '\u0000recent';

/** Width of the desk shell's session rail (px) — fixed, so nothing moves when a pane opens. */
export const SESSION_RAIL_PX = 236;

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4; the sidebar regroup of ui-v2,
 * operator 2026-10-26, mockup `desk-home-redesign`) — 236 px, on every route. Top to bottom:
 *
 *  - The wordmark (logo + site name), a label, not a link: Home is the first page below.
 *  - The action row, on every page (DES-SYSTEM-CHAT §1): four equal icon buttons — New job (the launch
 *    wizard), New project (the one New project modal), Chat (the floating system chat: restores a
 *    minimized one, else starts a new one) and Search (the ONE search modal, ⌘K). New job and Chat
 *    start in the project on screen (`ambientProject`), and say so in their names.
 *  - The pages, in three groups under small-caps labels (`NAV_GROUPS`, board/navModel.ts): WORK (Home,
 *    Jobs, Repositories), INSIGHT (Report, Understand, Evaluate), GOVERN (Steering, Memory, Agents).
 *    They replaced the Desk's tabs and its More menu. Home carries the needs-you badge (the fold's
 *    `needCount`, the Desk sentence's number — one source), and its accessible name says it ("Home,
 *    2 need you"). The page you are on is `aria-current="page"`.
 *  - RECENT, under the groups and folding as one: the sessions grouped by project (the board model's
 *    order), at most five between them (`railRecent`: every one that needs you, then live work, then
 *    the newest), then "All jobs" (the Jobs page). Each row has ONE status dot (four hues: waiting on
 *    you, working, failed, ended — its word in the row's hover title and accessible label) and the
 *    count of needs-you items that name it; a title is one line, cut with an ellipsis; same-named
 *    sessions in a group carry a short tag ("· 29d"). A group header folds its group (remembered per
 *    viewer, `useRailCollapsed`; a folded group still shows its needs-you count). A project group
 *    carries two quick icons (new session in it, open its page `/projects/:id`); the unfiled group
 *    ("Not in a project") carries only the open icon (`/projects/default`). A session opens `/s/:id`.
 *  - At the foot, "Build & settings" (one page listing Skills, MCP, Plugins, Workflows and Settings,
 *    the old Workspace links), then LAST the Nerve Center tile (DES-SYSTEM-VIEW, `NerveCenterTile`):
 *    one label, filled green / amber / red by the system's state with the worst item in words.
 *
 * Render only: the groups are `railGroups` (board/deskModel.ts) over `useBoardModel` + the fold.
 */
export function SessionRail({ runs, needRows, navigate, pathname, runsKnown = true, runsFailed = false, ambientProject = null }: {
  runs: SessionView[];
  needRows: NeedRow[];
  navigate: Navigate;
  pathname: string;
  /** Whether the first runs read answered, and whether the newest one failed (studio#723, #684):
   *  the badge is the Desk's settled count — nothing while it moves, the last count while a read fails. */
  runsKnown?: boolean;
  runsFailed?: boolean;
  /** The project on screen (its page, or a page carrying `?project=`): New job and Chat start there. */
  ambientProject?: string | null;
}): React.ReactElement {
  const { items, unfiled } = useMovableBoardModel(runs);
  const settled = useSettledNeeds(needRows, runsKnown, runsFailed);
  const count = settled.count ?? 0;
  const badgeText = settled.phase === 'partial' ? `${count}+` : String(count);
  // Home's name says the badge after its visible word (label-in-name, WCAG 2.5.3): "Home, 2 need you".
  const deskName = count > 0 ? `${PAGE_NAMES.home}, ${badgeText} ${badgeText === '1' ? 'needs' : 'need'} you` : PAGE_NAMES.home;
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  // The tags' and hover titles' clock: the queue's shared minute tick, so ages move while nothing else does.
  const now = useNeedsClock();
  const recent = useMemo(
    () => railRecent(railGroups(items, unfiled, needsByRun(needRows), Infinity, needTextByRun(needRows), runChatId, deliveredNow, now)),
    [items, unfiled, needRows, runChatId, deliveredNow, now],
  );
  const groups = recent.groups;
  const { collapsed, toggle } = useRailCollapsed();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // The project New job and Chat start in: the one on screen, never the Unfiled bucket.
  const projects = useProjectsStore((s) => s.projects);
  const inProject = ambientProject !== null && ambientProject !== 'default'
    ? { id: ambientProject, name: projects.find((p) => p.id === ambientProject)?.name ?? 'this project' }
    : null;
  // The Chat icon restores a minimized chat, shows an open one, and starts a new one when it is closed.
  const chatMode = useChatWindow((st) => st.mode);
  const chatName = chatMode === 'minimized' ? 'Show the chat' : chatMode !== 'closed' ? 'Chat'
    : inProject !== null ? `New chat in ${inProject.name}` : 'New chat';
  // A list that runs past the rail's fold fades out at its foot instead of slicing a row in half;
  // the fade lifts once the list is scrolled to its end.
  const groupsRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const el = groupsRef.current;
    if (el === null) return undefined;
    const check = (): void => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    check();
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    return () => { el.removeEventListener('scroll', check); ro?.disconnect(); };
  }, [groups, collapsed]);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const on = navCurrent(pathname);
  const recentFolded = collapsed.has(RECENT_KEY);
  const navLink = (item: NavItem, extra?: React.ReactNode, label?: string): React.ReactElement => (
    <a key={item.id} href={item.path} onClick={go(item.path)} data-testid={item.testId} data-nav-dest={`page:${item.id}`}
      aria-current={on === item.id ? 'page' : undefined} aria-label={label} title={label}
      className="wk-rail-link wk-rail-nav-item">
      <span className="wk-rail-nav-label">{item.label}</span>
      {extra}
    </a>
  );
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);
  // studio#512 (S18b): Theme › Logo takes the dot's place — the classic chrome's §3.1 slot, 32 px, contain-fit.
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);

  return (
    <nav data-testid="session-rail" aria-label="Studio" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      {/* The wordmark: logo and name, a label (Home is the first page below). studio#512: Theme › Site
          name and Theme › Logo are shown here. */}
      <div data-testid="desk-rail-wordmark" className="wk-rail-wordmark">
        <span data-testid="desk-rail-brand" className="wk-rail-brand">
          {logoUrl !== null
            ? <span
                aria-hidden
                data-testid="desk-rail-logo"
                style={{
                  width: 32, height: 32, flexShrink: 0,
                  backgroundImage: `url(${JSON.stringify(logoUrl)})`,
                  backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
                }}
              />
            : <span aria-hidden className="wk-desk-dot wk-desk-dot--waiting" />}
          <span className="wk-rail-brand-name">{siteName !== null ? <b>{siteName}</b> : <>wicked <b>studio</b></>}</span>
        </span>
      </div>
      {/* DES-SYSTEM-CHAT §1: the action row, on every page — four equal icon buttons, New job ·
          New project · Chat · Search (⌘K), each named and with a tooltip. New job and Chat start in the
          project on screen. The New project modal is portalled so the phone drawer — which closes when
          a modal opens over it — never clips it. */}
      <div className="wk-rail-actions wk-rail-actions--icons" role="group" aria-label="Start or find work" data-testid="desk-rail-actions">
        <button type="button" data-testid="desk-rail-new-job" className="wk-rail-action" aria-label={inProject !== null ? `New job in ${inProject.name}` : 'New job'} title={inProject !== null ? `New job in ${inProject.name}` : 'New job'}
          onClick={() => startNewJob(ambientProject)}>
          <Plus size={18} aria-hidden />
        </button>
        <button type="button" data-testid="desk-rail-new-project" className="wk-rail-action" aria-label="New project" title="New project" onClick={() => setNewProjectOpen(true)}>
          <FolderPlus size={17} aria-hidden />
        </button>
        <button type="button" data-testid="desk-rail-chat" data-chat-mode={chatMode} className="wk-rail-action" aria-label={chatName} title={chatName}
          onClick={() => openSystemChat(inProject?.id ?? null)}>
          {chatMode === 'closed' ? <MessageSquarePlus size={17} aria-hidden /> : <MessageSquare size={17} aria-hidden />}
        </button>
        <button type="button" data-testid="desk-rail-search" className="wk-rail-action" aria-label="Search" title={`Search (${MOD}K)`} aria-keyshortcuts="Meta+K Control+K" onClick={() => openSearch()}>
          <Search size={17} aria-hidden />
        </button>
      </div>
      {newProjectOpen && createPortal(<NewProjectModal deskMode navigate={navigate} onClose={() => setNewProjectOpen(false)} />, document.body)}

      <div ref={groupsRef} className="wk-rail-groups" data-more-below={moreBelow ? 'true' : 'false'}>
        <MoveProjectStatus />
        {/* The pages, in three groups (board/navModel.ts): they replaced the Desk's tabs and its More menu. */}
        <div className="wk-rail-nav" data-testid="rail-nav">
          {NAV_GROUPS.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`rail-sec-${g.id}`} data-testid={`rail-nav-${g.id}`} className="wk-rail-nav-group">
              <p id={`rail-sec-${g.id}`} className="wk-rail-sec">{g.label}</p>
              {g.items.map((item) => (item.id === 'home'
                ? navLink(item, count > 0 ? <span aria-hidden data-testid="desk-rail-badge" data-phase={settled.phase} className="wk-rail-badge wk-rail-badge--home">{badgeText}</span> : null, count > 0 ? deskName : undefined)
                : navLink(item)))}
            </div>
          ))}
        </div>

        {/* RECENT: the session/project list, folding as one, at most five sessions, then All jobs. */}
        {groups.length > 0 && (
        <section aria-labelledby="rail-recent-label" data-testid="rail-recent" data-folded={recentFolded ? 'true' : 'false'} className="wk-rail-recent">
          <button type="button" id="rail-recent-label" data-testid="rail-recent-toggle" aria-expanded={!recentFolded}
            aria-controls={recentFolded ? undefined : 'rail-recent-list'} onClick={() => toggle(RECENT_KEY)} className="wk-rail-sec wk-rail-sec-toggle">
            <span>Recent</span>
            <ChevronRight size={12} aria-hidden className="wk-rail-fold-chevron" />
          </button>
          {!recentFolded && (
          <div id="rail-recent-list">
            {groups.map((g, gi) => {
              const key = g.projectId ?? '';
              const folded = collapsed.has(key);
              const listId = `rail-group-list-${gi}`;
              const needs = g.sessions.reduce((n, s) => n + s.badge, 0);
              const rows = g.sessions;
              return (
              <div key={g.projectId ?? 'unfiled'} data-testid="rail-group" data-project-id={g.projectId ?? ''} data-folded={folded ? 'true' : 'false'}>
                <div className="wk-rail-group-row">
                  <button
                    type="button"
                    data-testid="rail-group-toggle"
                    className="wk-rail-group wk-rail-group-toggle"
                    aria-expanded={!folded}
                    aria-controls={folded ? undefined : listId}
                    title={g.name}
                    onClick={() => toggle(key)}
                  >
                    <ChevronRight size={12} aria-hidden className="wk-rail-fold-chevron" />
                    <span className="wk-rail-group-name">{g.name}</span>
                    {folded && needs > 0 && (
                      <span data-testid="rail-group-needs" className="wk-rail-badge wk-rail-badge--row" title={needsYouWords(needs)} aria-label={needsYouWords(needs)}>{needs}</span>
                    )}
                  </button>
                  {g.projectId !== null && g.projectId !== '' && (
                    <span className="wk-rail-group-icons">
                      <button
                        type="button"
                        data-testid="rail-group-new"
                        aria-label={`New work in ${g.name}`}
                        title={`New work in ${g.name}`}
                        className="wk-rail-icon-btn"
                        onClick={() => openLaunchWizard({ projectId: g.projectId, composerKey: 'desk' })}
                      >
                        <Plus size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        data-testid="rail-group-view"
                        aria-label={`Open ${g.name}`}
                        title={`Open ${g.name}`}
                        className="wk-rail-icon-btn"
                        onClick={() => { navigate(projectDetailPath(g.projectId!)); }}
                      >
                        <LayoutGrid size={14} aria-hidden />
                      </button>
                    </span>
                  )}
                  {g.projectId === null && (
                    <span className="wk-rail-group-icons">
                      <button
                        type="button"
                        data-testid="rail-group-view-unfiled"
                        aria-label="Open work not in a project"
                        title="Open work not in a project"
                        className="wk-rail-icon-btn"
                        onClick={() => { navigate(projectDetailPath('default')); }}
                      >
                        <LayoutGrid size={14} aria-hidden />
                      </button>
                    </span>
                  )}
                </div>
                {!folded && (
                  <div id={listId} className="wk-rail-group-list">
                    {rows.map((s) => {
                      const words = railRowWords(s, now);
                      return (
                      <div key={s.id} className="wk-rail-session-row" data-move-row={s.id}>
                        <a
                          href={s.path}
                          onClick={go(s.path)}
                          data-testid="rail-session"
                          data-session-id={s.id}
                          data-run-id={s.runId}
                          data-run-ids={s.runIds.join(' ')}
                          data-state={s.state}
                          data-status={s.status.word}
                          data-badge={s.badge}
                          title={words.title}
                          aria-label={words.label}
                          aria-current={pathname === s.path ? 'page' : undefined}
                          className="wk-rail-session"
                        >
                          <span aria-hidden data-testid="rail-session-dot" data-tone={s.status.tone} className={`wk-desk-dot wk-rail-dot wk-rail-dot--${s.status.tone}`} />
                          <span className="wk-rail-session-title">{s.title}</span>
                          {s.tag !== null && <span data-testid="rail-session-tag" className="wk-rail-session-tag">· {s.tag}</span>}
                          {s.badge > 0 && <span aria-hidden className="wk-rail-badge wk-rail-badge--row">{s.badge}</span>}
                        </a>
                        <MoveToProject session={s} projectId={g.projectId} runs={runs} />
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>
              );
            })}
            <a href={DESK_VIEW_PATH.runs} onClick={go(DESK_VIEW_PATH.runs)} data-testid="rail-all-jobs" className="wk-rail-showmore wk-rail-alljobs">
              {recent.hidden > 0 ? `All jobs · ${recent.hidden} more` : 'All jobs'}
            </a>
          </div>
          )}
        </section>
        )}
      </div>

      <div className="wk-rail-foot">
        {navLink(BUILD_ITEM)}
      </div>
      {/* DES-SYSTEM-VIEW: Nerve Center, pinned last — the one way to the system dashboard. Its own dock
          so it stays on screen at the bottom of the phone drawer, which scrolls as one. */}
      <div className="wk-nc-dock" data-testid="rail-nerve-dock">
        <NerveCenterTile navigate={navigate} pathname={pathname} waitingOnYou={count} />
      </div>
    </nav>
  );
}
