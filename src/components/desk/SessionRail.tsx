import { attentionCountWords } from '../../board/needsQueue.js';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BriefcaseBusiness, ChartColumn, ChevronRight, FolderPlus, GraduationCap, History, LayoutGrid, MessageSquare, MessageSquarePlus,
  PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, ShieldCheck, type LucideIcon,
} from 'lucide-react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import { needsByRun, needTextByRun, needsYouWords, railGroups, railRecent, railRowWords } from '../../board/deskModel.js';
import {
  BUILD_ITEM, DESK_VIEW_PATH, groupHolding, groupHome, LEARN_ITEM, navCurrent, navGroups, type NavItem, type SidebarSectionId,
} from '../../board/navModel.js';
import { useRailCollapsed } from '../../hooks/useRailCollapsed.js';
import { usePhone } from '../../hooks/usePhone.js';
import { useSidebar } from '../../store/sidebar.js';
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
import { ShorelineMark, StudioLettering, StudioLockup } from '../ui/BrandMarks.js';

/** The modifier the shortcuts are said with (⌘ on a Mac, Ctrl elsewhere). */
const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';

/** New job where you are: the launch wizard, in the project on screen (never the Unfiled bucket),
 *  launching from the page's composer when it has one. The rail's and the phone top bar's New job. */
export function startNewJob(ambientProject: string | null): void {
  openLaunchWizard({ projectId: ambientProject !== null && ambientProject !== 'default' ? ambientProject : null, composerKey: pageComposerKey() ?? 'desk' });
}

/** Width of the desk shell's session rail (px) — fixed, so nothing moves when a pane opens. */
export const SESSION_RAIL_PX = 236;

/** Width of the rail folded to its headings' icons (px). */
export const RAIL_ICONS_PX = 56;

/** The rail's width as the shell lays it out: folded to icons on a desktop, else full (a phone's drawer is full). */
export function railWidthPx(icons: boolean, phone: boolean): number {
  return icons && !phone ? RAIL_ICONS_PX : SESSION_RAIL_PX;
}

/** Each heading's icon: in the full sidebar beside its label, alone in the icon rail. A group the nav model
 *  adds later takes the grid until it is given one. */
const SECTION_ICON: Record<string, LucideIcon> = { work: BriefcaseBusiness, insight: ChartColumn, govern: ShieldCheck, recent: History };
const ITEM_ICON: Partial<Record<NavItem['id'], LucideIcon>> = { learn: GraduationCap, build: Settings };

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4; the sidebar regroup of ui-v2,
 * operator 2026-10-26, mockup `desk-home-redesign`) — 236 px, on every route. Top to bottom:
 *
 *  - The wordmark (logo + site name) is the link Home (`/`, named "Home"; operator 2026-10-27: Home left
 *    WORK, the wordmark goes Home). It carries the needs-you badge (the fold's `needCount`, the Desk
 *    sentence's number — one source), said as its description ("22 need you"), and is current on Home
 *    and on Needs you in full.
 *  - The action row, on every page (DES-SYSTEM-CHAT §1): four equal icon buttons — New job (the launch
 *    wizard), New project (the one New project modal), Chat (the floating system chat: restores a
 *    minimized one, else starts a new one) and Search (the ONE search modal, ⌘K). New job and Chat
 *    start in the project on screen (`ambientProject`), and say so in their names.
 *  - The pages, in three groups (`navGroups`, board/navModel.ts): WORK (Projects, Jobs, Repositories),
 *    INSIGHT (Report, Understand, Evaluate), GOVERN (Steering, Memory, Agents). They replaced the Desk's
 *    tabs and its More menu. Projects is WORK's primary entry: its words are a step stronger and a small
 *    accent mark sits before them. The page you are on is `aria-current="page"`.
 *  - Every heading folds (operator 2026-11-04): its label is a disclosure button (`aria-expanded`,
 *    `aria-controls`, a chevron that turns), and its icon is a link to its home page (`groupHome`). What is
 *    open is this viewer's, from their last session (store/sidebar.ts; nothing saved: Work open, the rest
 *    shut). The heading that holds the page on screen is marked (its home link `aria-current="true"`),
 *    and when that page is listed under a shut heading, the heading opens for this view only (not saved),
 *    so the page you are on is always in sight; shutting it (open for the view or saved open) holds while you
 *    stay on that page. A project folded inside Recent opens for the view the same way when it holds the session.
 *  - RECENT, under the groups, the last heading that folds: the sessions grouped by project (the board model's
 *    order), at most five between them (`railRecent`: every one that needs you, then live work, then
 *    the newest), then "All jobs" (the Jobs page). Each row has ONE status dot (four hues: waiting on
 *    you, working, failed, ended — its word in the row's hover title and accessible label) and the
 *    count of needs-you items that name it; a title is one line, cut with an ellipsis; same-named
 *    sessions in a group carry a short tag ("· 29d"). A group header folds its group (remembered per
 *    viewer, `useRailCollapsed`; a folded group still shows its needs-you count). A project group
 *    carries two quick icons (new session in it, open its page `/projects/:id`); the unfiled group
 *    ("Not in a project") carries only the open icon (`/projects/default`). A session opens `/s/:id`.
 *  - At the foot, Learn (always there: Home does the first run), "Build & settings" (one page listing Skills,
 *    MCP, Plugins, Workflows and Settings, the old Workspace links), then LAST the Nerve Center tile
 *    (DES-SYSTEM-VIEW, `NerveCenterTile`): one label, filled green / amber / red by the system's state with
 *    the worst item in words.
 *  - THE ICON RAIL (operator 2026-11-04): the fold control beside the wordmark folds the rail to 56 px,
 *    remembered like the headings. There, top to bottom: the brand and the expand control (both unfold it),
 *    the four actions, each heading's icon (Work, Insight, Govern: a link to its home page; Recent, which
 *    has none: unfolds the rail with Recent open), Learn, Build & settings, and Nerve Center as a small tile
 *    in its state's own fill, its state in its name. Every icon has a tooltip and a name. A phone keeps
 *    the drawer, always full.
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
  const count = settled.phase === 'complete' ? settled.count ?? 0 : 0;
  const badgeText = String(count);
  // The wordmark’s description uses Nerve Center’s count words.
  const needWords = attentionCountWords(count);
  const needsId = useId();
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
  // The headings that are open (this viewer's, store/sidebar.ts) and the rail folded to icons (never on a phone).
  const open = useSidebar((st) => st.open);
  const phone = usePhone();
  const icons = useSidebar((st) => st.icons) && !phone;
  // What the viewer shut while it held the page on screen: it stays shut on this address (whether it was open
  // for the view or saved open), and every new address starts over, coming back included. Keyed by the address,
  // so another page never reads it, and cleared when the address changes, so a return does not either.
  const [shutHere, setShutHere] = useState<{ path: string; ids: ReadonlySet<string> }>({ path: '', ids: new Set() });
  useEffect(() => { setShutHere((prev) => (prev.path === pathname || prev.ids.size === 0 ? prev : { path: '', ids: new Set() })); }, [pathname]);
  // A list that runs past the rail's fold fades out at its foot instead of slicing a row in half;
  // the fade lifts once the list is scrolled to its end.
  // One ResizeObserver and one scroll listener per list element, made when it attaches and dropped when it
  // detaches (the icon rail has no list, so unfolding attaches a new one). Re-creating the observer on every
  // change gave it a fresh first observation each time, and one made while the browser was delivering
  // observations was held to the next frame: WebKit reports that as "ResizeObserver loop completed with
  // undelivered notifications" (studio#970).
  const [moreBelow, setMoreBelow] = useState(false);
  const measureGroups = useRef<(() => void) | null>(null);
  const dropGroups = useRef<(() => void) | null>(null);
  const groupsEl = useRef<HTMLDivElement | null>(null);
  const groupsRef = useCallback((el: HTMLDivElement | null): void => {
    dropGroups.current?.();
    dropGroups.current = null;
    measureGroups.current = null;
    if (el === null) return;
    const check = (): void => setMoreBelow(el.scrollHeight - el.scrollTop - el.clientHeight > 2);
    el.addEventListener('scroll', check, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    ro?.observe(el);
    measureGroups.current = check;
    groupsEl.current = el;
    dropGroups.current = () => { el.removeEventListener('scroll', check); ro?.disconnect(); groupsEl.current = null; };
  }, []);
  // first-run P1: on a short window (1440x700 with Insight and Govern open) the page you are on could sit below the
  // fold, under the footer. Each new page scrolls the list just enough to show its entry (never on a re-render).
  useEffect(() => {
    const here = groupsEl.current?.querySelector<HTMLElement>('[aria-current="page"]');
    here?.scrollIntoView?.({ block: 'nearest' });
  }, [pathname]);
  // What the list holds changed (its rows, its open headings, the page): its height may have moved while its
  // box did not, so measure again, with the same observer.
  useEffect(() => { measureGroups.current?.(); }, [groups, collapsed, open, icons, shutHere, pathname]);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  // DES-APPS-001: Data sources is in Work only when the connected crew serves them (an older crew: Build & settings).
  const dataSources = useCapabilities((s) => s.dataSources);
  const capsLoaded = useCapabilities((s) => s.loaded);
  useEffect(() => { if (!capsLoaded) void useCapabilities.getState().load(); }, [capsLoaded]);
  const on = navCurrent(pathname, { sources: dataSources });
  // first-run P1: the primary entry's mark and weight show only while no other page is current (Home, or Projects
  // itself); beside another current page it read as a second selection.
  const primaryShown = on === null || on === 'home' || on === 'projects';
  const navLink = (item: NavItem): React.ReactElement => {
    const Icon = ITEM_ICON[item.id];
    const primary = item.primary === true && primaryShown;
    return (
      <a key={item.id} href={item.path} onClick={go(item.path)} data-testid={item.testId} data-nav-dest={`page:${item.id}`}
        data-primary={item.primary === true ? 'true' : undefined}
        aria-current={on === item.id ? 'page' : undefined}
        {...(icons ? { 'aria-label': item.label, title: item.label, 'data-rail-heading': item.id } : {})}
        className={`wk-rail-link wk-rail-nav-item${primary ? ' wk-rail-nav-item--primary' : ''}${Icon !== undefined ? ' wk-rail-nav-item--icon' : ''}`}>
        {primary && <span aria-hidden className="wk-rail-nav-mark" />}
        {Icon !== undefined && <Icon size={icons ? 18 : 15} aria-hidden className="wk-rail-nav-icon" />}
        {!icons && <span className="wk-rail-nav-label">{item.label}</span>}
      </a>
    );
  };
  const groupsNav = navGroups({ sources: dataSources });
  // The heading that holds the page on screen: marked, and opened for this view when it is shut (not saved).
  // A session's page is under Recent when its row is (and under its project's fold, which opens the same way).
  const rowHere = (rows: readonly { path: string }[]): boolean => rows.some((x) => x.path.split('#')[0] === pathname);
  const recentHere = groups.some((g) => rowHere(g.sessions));
  const holding: SidebarSectionId | null = groupHolding(groupsNav, on)?.id ?? (recentHere ? 'recent' : null);
  const shut = (id: string): boolean => shutHere.path === pathname && shutHere.ids.has(id);
  const keepShut = (id: string): void => setShutHere((prev) => ({ path: pathname, ids: new Set([...(prev.path === pathname ? prev.ids : []), id]) }));
  const peek = holding !== null && !open.has(holding) && !shut(holding) ? holding : null;
  const isOpen = (id: SidebarSectionId): boolean => open.has(id) || peek === id;
  const toggleSection = (id: SidebarSectionId): void => {
    // Shutting the heading that holds the page: it stays shut here. Only a saved state is ever written: a heading
    // open for this view only is shut without touching what the viewer saved.
    if (isOpen(id) && id === holding) keepShut(id);
    if (peek !== id) useSidebar.getState().toggle(id);
  };
  const recentFolded = !isOpen('recent');
  // Folding and unfolding the rail swaps its layout, so focus goes to the same control in the new one.
  const focusAfter = useRef<string | null>(null);
  useEffect(() => {
    const id = focusAfter.current;
    focusAfter.current = null;
    if (id !== null) document.getElementById(id)?.focus();
  }, [icons]);
  const setRailIcons = (next: boolean, focusId = 'rail-fold'): void => {
    focusAfter.current = focusId;
    useSidebar.getState().setIcons(next);
  };
  const recentNeeds = groups.reduce((n, g) => n + g.sessions.reduce((m, x) => m + x.badge, 0), 0);
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);
  // studio#512 (S18b): Theme › Logo takes the dot's place — the classic chrome's §3.1 slot, 32 px, contain-fit.
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);

  // The brand: Theme › Logo takes the mark's place (studio#512); in the icon rail the mark (or logo) alone.
  const logo = logoUrl !== null
    ? <span
        aria-hidden
        data-testid="desk-rail-logo"
        style={{
          width: 32, height: 32, flexShrink: 0,
          backgroundImage: `url(${JSON.stringify(logoUrl)})`,
          backgroundSize: 'contain', backgroundPosition: 'center', backgroundRepeat: 'no-repeat',
        }}
      />
    : null;
  const needsWordsEl = count > 0 ? <span id={needsId} className="wk-visually-hidden">{needWords}</span> : null;
  const homeBadge = count > 0
    ? <span aria-hidden data-testid="desk-rail-badge" data-phase={settled.phase} className="wk-rail-badge wk-rail-badge--home">{badgeText}</span>
    : null;
  const actions = (
    <>
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
    </>
  );
  const headingIcon = (id: string, size: number): React.ReactElement => {
    const Icon = SECTION_ICON[id] ?? LayoutGrid;
    return <Icon size={size} aria-hidden />;
  };

  if (icons) {
    return (
      <nav data-testid="session-rail" data-rail="icons" aria-label="Studio" className="wk-rail wk-rail--icons" style={{ width: RAIL_ICONS_PX }}>
        <div className="wk-rail-top">
          {/* The brand unfolds the rail too: a pointer's way, so it is out of the tab order and hidden from
              assistive tech (the expand control under it is the named one). It keeps Home's needs-you count,
              which the expand control says as its description. */}
          <button type="button" tabIndex={-1} aria-hidden data-testid="desk-rail-brand-expand" title={count > 0 ? `Expand the sidebar · ${needWords}` : 'Expand the sidebar'}
            className="wk-rail-brand-btn" onClick={() => setRailIcons(false)}>
            {logo ?? <ShorelineMark size={22} testId="desk-rail-mark" />}
            {homeBadge}
          </button>
          <button type="button" id="rail-fold" data-testid="rail-fold" className="wk-rail-icon-btn wk-rail-fold" aria-label="Expand the sidebar"
            title={count > 0 ? `Expand the sidebar · ${needWords}` : 'Expand the sidebar'} aria-describedby={count > 0 ? needsId : undefined}
            onClick={() => setRailIcons(false)}>
            <PanelLeftOpen size={17} aria-hidden />
          </button>
          {needsWordsEl}
        </div>
        {actions}
        {/* Each heading's icon: a group's opens its home page; Recent has none, so it unfolds the rail with Recent open. */}
        <div className="wk-rail-icons" data-testid="rail-icons">
          {groupsNav.map((g) => {
            const home = groupHome(g);
            const name = `${g.label}: ${home.label}`;
            return (
              <a key={g.id} href={home.path} onClick={go(home.path)} data-testid={`rail-sec-home-${g.id}`} data-rail-heading={g.id}
                aria-label={name} title={name} aria-current={holding === g.id ? 'true' : undefined} className="wk-rail-link wk-rail-icon-link">
                {headingIcon(g.id, 18)}
              </a>
            );
          })}
          {groups.length > 0 && (
            <button type="button" data-testid="rail-recent-expand" data-rail-heading="recent" aria-label="Recent: expand the sidebar" title="Recent"
              aria-current={holding === 'recent' ? 'true' : undefined} className="wk-rail-link wk-rail-icon-link"
              onClick={() => { useSidebar.getState().openSection('recent'); setRailIcons(false, 'rail-recent-label'); }}>
              {headingIcon('recent', 18)}
            </button>
          )}
        </div>
        <div className="wk-rail-foot">
          {navLink(LEARN_ITEM)}
          {navLink(BUILD_ITEM)}
        </div>
        <div className="wk-nc-dock" data-testid="rail-nerve-dock">
          <NerveCenterTile navigate={navigate} pathname={pathname} waitingOnYou={count} compact />
        </div>
      </nav>
    );
  }

  return (
    <nav data-testid="session-rail" data-rail="full" aria-label="Studio" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      <div className="wk-rail-top">
        {/* The wordmark: logo and name, the link Home, with the needs-you badge. studio#512: Theme › Site
            name and Theme › Logo are shown here. */}
        <a href="/" onClick={go('/')} data-testid="desk-rail-wordmark" data-nav-dest="page:home" aria-label={PAGE_NAMES.home}
          aria-describedby={count > 0 ? needsId : undefined} aria-current={on === 'home' ? 'page' : undefined}
          title={count > 0 ? `${PAGE_NAMES.home} · ${needWords}` : PAGE_NAMES.home} className="wk-rail-home wk-rail-wordmark">
          <span data-testid="desk-rail-brand" className="wk-rail-brand">
            {logo ?? (siteName !== null ? <ShorelineMark testId="desk-rail-mark" /> : null)}
            {/* The default is the drawn lockup (the Shoreline mark beside the Wave W lettering, fonts-v3); beside a
                custom logo, the lettering alone; a custom name is the user's words, in the text face, beside the mark. */}
            {siteName !== null
              ? <span className="wk-rail-brand-name"><b>{siteName}</b></span>
              : logoUrl !== null ? <StudioLettering testId="desk-rail-lettering" /> : <StudioLockup testId="desk-rail-lockup" />}
          </span>
          {homeBadge}
          {needsWordsEl}
        </a>
        {/* Fold the rail to its headings' icons (a desktop's; the phone drawer is always full). */}
        {!phone && (
          <button type="button" id="rail-fold" data-testid="rail-fold" className="wk-rail-icon-btn wk-rail-fold" aria-label="Collapse the sidebar" title="Collapse the sidebar"
            onClick={() => setRailIcons(true)}>
            <PanelLeftClose size={16} aria-hidden />
          </button>
        )}
      </div>
      {actions}

      <div ref={groupsRef} className="wk-rail-groups" data-more-below={moreBelow ? 'true' : 'false'}>
        <MoveProjectStatus />
        {/* The pages, in three groups (board/navModel.ts), each under a heading that folds. */}
        <div className="wk-rail-nav" data-testid="rail-nav">
          {groupsNav.map((g) => {
            const home = groupHome(g);
            const shown = isOpen(g.id);
            const listId = `rail-sec-list-${g.id}`;
            return (
              <div key={g.id} role="group" aria-labelledby={`rail-sec-${g.id}`} data-testid={`rail-nav-${g.id}`} data-open={shown ? 'true' : 'false'}
                data-here={holding === g.id ? 'true' : undefined} className="wk-rail-nav-group">
                <div className="wk-rail-sec-row">
                  <a href={home.path} onClick={go(home.path)} data-testid={`rail-sec-home-${g.id}`} aria-label={`${g.label}: ${home.label}`} title={`${g.label}: ${home.label}`}
                    aria-current={holding === g.id ? 'true' : undefined} className="wk-rail-sec-home">
                    {headingIcon(g.id, 14)}
                  </a>
                  <button type="button" id={`rail-sec-${g.id}`} data-testid={`rail-sec-toggle-${g.id}`} aria-expanded={shown} aria-controls={listId}
                    onClick={() => toggleSection(g.id)} className="wk-rail-sec wk-rail-sec-toggle">
                    <span>{g.label}</span>
                    <ChevronRight size={12} aria-hidden className="wk-rail-fold-chevron" />
                  </button>
                </div>
                <div id={listId} hidden={!shown} className="wk-rail-sec-list">
                  {shown && g.items.map((item) => navLink(item))}
                </div>
              </div>
            );
          })}
        </div>

        {/* RECENT: the session/project list, folding as one, at most five sessions, then All jobs. */}
        {groups.length > 0 && (
        <section aria-labelledby="rail-recent-label" data-testid="rail-recent" data-folded={recentFolded ? 'true' : 'false'}
          data-here={holding === 'recent' ? 'true' : undefined} className="wk-rail-recent">
          <div className="wk-rail-sec-row">
            <span aria-hidden className="wk-rail-sec-home wk-rail-sec-home--still">{headingIcon('recent', 14)}</span>
            <button type="button" id="rail-recent-label" data-testid="rail-recent-toggle" aria-expanded={!recentFolded}
              aria-controls="rail-recent-list" onClick={() => toggleSection('recent')} className="wk-rail-sec wk-rail-sec-toggle">
              <span>Recent</span>
              <ChevronRight size={12} aria-hidden className="wk-rail-fold-chevron" />
              {/* Shut, it still says how many of its sessions need you (as a folded project group does). */}
              {recentFolded && recentNeeds > 0 && (
                <>
                  <span aria-hidden data-testid="rail-recent-needs" className="wk-rail-badge wk-rail-badge--row">{recentNeeds}</span>
                  <span className="wk-visually-hidden">, {needsYouWords(recentNeeds)}</span>
                </>
              )}
            </button>
          </div>
          <div id="rail-recent-list" hidden={recentFolded}>
          {!recentFolded && (
          <>
            {groups.map((g, gi) => {
              const key = g.projectId ?? '';
              // A project fold holding the session on screen opens for this view too (the heading rule, one level down).
              const foldId = `group:${key}`;
              const groupPeek = collapsed.has(key) && rowHere(g.sessions) && !shut(foldId);
              const folded = collapsed.has(key) && !groupPeek;
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
                    onClick={() => { if (!folded && rowHere(g.sessions)) keepShut(foldId); if (!groupPeek) toggle(key); }}
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
          </>
          )}
          </div>
        </section>
        )}
      </div>

      <div className="wk-rail-foot">
        {navLink(LEARN_ITEM)}
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
