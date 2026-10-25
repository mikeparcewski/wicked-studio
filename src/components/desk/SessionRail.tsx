import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, ChevronUp, FolderPlus, LayoutGrid, MessageSquare, MessageSquarePlus, Plus, Search } from 'lucide-react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import { DESK_RAIL_LINKS, needsByRun, needTextByRun, needsYouWords, railGroups, railRowWords, type RailSession } from '../../board/deskModel.js';
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

/** Width of the desk shell's session rail (px) — fixed, so nothing moves when a pane opens. */
export const SESSION_RAIL_PX = 236;

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4; Amendment 5 as revised,
 * S15c; studio#421 rail polish) — 236 px, on every route. Top to bottom:
 *
 *  - The wordmark (logo + site name) — ONE link to the Desk, carrying the Desk's needs-you count as its
 *    badge (the fold's `needCount`, the Desk sentence's number — one source, so they never disagree);
 *    its accessible name says it ("Desk, 2 need you"). Operator IA 2026-10-13: there is no separate
 *    "Desk" item.
 *  - The action row, on every page (DES-SYSTEM-CHAT §1): four equal icon buttons — New project (the
 *    one New project modal), New job (the launch wizard), Chat (the floating system chat: restores a
 *    minimized one, else starts a new one) and Search (the ONE search modal, ⌘K). New job and Chat
 *    start in the project on screen (`ambientProject`), and say so in their names.
 *  - Sessions grouped by project (the board model's order), each with ONE status dot (four hues:
 *    waiting on you, working, failed, ended — its word in the row's hover title and accessible label)
 *    and the count of needs-you items that name it. A title is one line, cut with an ellipsis, its
 *    full words in the hover title; same-named sessions in a group carry a short tag ("· 29d",
 *    `disambiguate`). A group header folds its group (remembered per viewer in localStorage,
 *    `useRailCollapsed`; a folded group still shows its needs-you count), and a group shows its first
 *    few with "Show N more" for the rest (studio-rail-clean). A project group carries two quick icons (new session →
 *    `/` + the project's `@` chip, open project → its dashboard `/projects/:id`); the
 *    unfiled group ("Not in a project") carries only the open icon, to its own dashboard — the same
 *    project dashboard every project has (`/projects/default`, operator 2026-10-16). A session is a chat and its runs when the
 *    daemon stamps `chat_id` (C1), else one run; each opens `/s/:id` (S6a).
 *  - the "Workspace" group (operator IA 2026-10-13): Skills · MCP · Plugins · Workflows · Theme ·
 *    General (`DESK_RAIL_LINKS`; General is the `/system` page, and `/settings` redirects there).
 *    Repositories, Steering, Evals and Agents are Desk tabs, not rail links. The foot's top border
 *    separates the sessions above it from the Workspace below; its label is styled like the project
 *    groups and its links are the rail's secondary tier.
 *  - LAST, pinned to the bottom, the Nerve Center tile (DES-SYSTEM-VIEW, `NerveCenterTile`): one label,
 *    larger than every other item, filled green / amber / red by the system's state with the worst
 *    item in words. It replaced the Watchtower pill and the Health link; `/watch` and `/health` land
 *    on its dashboard.
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
  // The wordmark link's name says where it goes and the badge — "Desk", or "Desk, 2 need you" / "Desk, 1
  // needs you" — after the visible words (label-in-name, WCAG 2.5.3): "wicked studio — Desk, 2 need you".
  const deskName = count > 0 ? `${PAGE_NAMES.home}, ${badgeText} ${badgeText === '1' ? 'needs' : 'need'} you` : PAGE_NAMES.home;
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  // The tags' and hover titles' clock: the queue's shared minute tick, so ages move while nothing else does.
  const now = useNeedsClock();
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), undefined, needTextByRun(needRows), runChatId, deliveredNow, now),
    [items, unfiled, needRows, runChatId, deliveredNow, now],
  );
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
  // "Show N more" is this page's choice only; folding is what persists.
  const [showAll, setShowAll] = useState<ReadonlySet<string>>(() => new Set());
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
  }, [groups, collapsed, showAll]);
  const flipShowAll = (key: string): void => setShowAll((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); navigate(path); };
  const current = (path: string): 'page' | undefined => (pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined);
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);
  // studio#512 (S18b): Theme › Logo takes the dot's place — the classic chrome's §3.1 slot, 32 px, contain-fit.
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);

  return (
    <nav data-testid="session-rail" aria-label="Sessions" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      {/* Operator IA 2026-10-13: the wordmark IS the way to the Desk — logo, name and the Desk's needs-you
          badge are one link (its accessible name says the count). studio#512: Theme › Site name and
          Theme › Logo are shown here under the Desk skin. */}
      <a
        href="/"
        onClick={go('/')}
        data-testid="desk-rail-home"
        aria-current={pathname === '/' ? 'page' : undefined}
        aria-label={`${siteName ?? 'wicked studio'} — ${deskName}`}
        title={deskName}
        className="wk-rail-home"
      >
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
        {count > 0 && <span aria-hidden data-testid="desk-rail-badge" data-phase={settled.phase} className="wk-rail-badge">{badgeText}</span>}
      </a>
      {/* DES-SYSTEM-CHAT §1: the action row, on every page — four equal icon buttons, New project ·
          New job · Chat · Search (⌘K), each named and with a tooltip. New job and Chat start in the
          project on screen. The New project modal is portalled so the phone drawer — which closes when
          a modal opens over it — never clips it. */}
      <div className="wk-rail-actions wk-rail-actions--icons" role="group" aria-label="Start or find work" data-testid="desk-rail-actions">
        <button type="button" data-testid="desk-rail-new-project" className="wk-rail-action" aria-label="New project" title="New project" onClick={() => setNewProjectOpen(true)}>
          <FolderPlus size={17} aria-hidden />
        </button>
        <button type="button" data-testid="desk-rail-new-job" className="wk-rail-action" aria-label={inProject !== null ? `New job in ${inProject.name}` : 'New job'} title={inProject !== null ? `New job in ${inProject.name}` : 'New job'}
          onClick={() => startNewJob(ambientProject)}>
          <Plus size={18} aria-hidden />
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
        {groups.map((g, gi) => {
          const key = g.projectId ?? '';
          const folded = collapsed.has(key);
          const all = showAll.has(key);
          const listId = `rail-group-list-${gi}`;
          const needs = [...g.sessions, ...g.more].reduce((n, s) => n + s.badge, 0);
          const rows: RailSession[] = all ? [...g.sessions, ...g.more] : g.sessions;
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
                {g.more.length > 0 && (
                  <button
                    type="button"
                    data-testid="rail-group-more"
                    className="wk-rail-showmore"
                    aria-expanded={all}
                    onClick={() => flipShowAll(key)}
                  >
                    {all ? <ChevronUp size={12} aria-hidden /> : <ChevronDown size={12} aria-hidden />}
                    {all ? 'Show fewer' : `Show ${g.more.length} more`}
                  </button>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>

      <div className="wk-rail-foot">
        {/* studio#421 r3 (change 18): the foot's group label, under the separator, styled like the
            project groups — the links below are the "Workspace". */}
        <p className="wk-rail-group" data-testid="rail-foot-label">Workspace</p>
        {DESK_RAIL_LINKS.map((l) => (
          <a key={l.dest} href={l.path} onClick={go(l.path)} data-testid={l.testId} data-nav-dest={l.dest} aria-current={current(l.path)} className="wk-rail-link wk-rail-link--secondary">
            {l.label}
          </a>
        ))}
      </div>
      {/* DES-SYSTEM-VIEW: Nerve Center, pinned last — the one way to the system dashboard. Its own dock
          so it stays on screen at the bottom of the phone drawer, which scrolls as one. */}
      <div className="wk-nc-dock" data-testid="rail-nerve-dock">
        <NerveCenterTile navigate={navigate} pathname={pathname} waitingOnYou={count} />
      </div>
    </nav>
  );
}
