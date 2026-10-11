import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, LayoutGrid, Plus } from 'lucide-react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import { ADDITIONAL_SETTINGS, DESK_RAIL_LINKS, needsByRun, needTextByRun, railGroups } from '../../board/deskModel.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { MoveToProject, MoveProjectStatus, useMovableBoardModel } from './MoveToProject.js';
import { useCapabilities } from '../../store/capabilities.js';
import { productPath, type Navigate } from '../../hooks/useRoute.js';
import { useAppearanceStore } from '../../theming/appearance.js';
import { anyModalOpen, useLayerStore } from '../../store/layers.js';
import { seedNewChat } from '../../board/chatMoves.js';
import { useRailHealthDot } from '../../hooks/useRailHealthDot.js';
import { WatchPill } from './WatchPill.js';

/** Width of the desk shell's session rail (px) — fixed, so nothing moves when a pane opens. */
export const SESSION_RAIL_PX = 236;

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4; Amendment 5 as revised,
 * S15c; studio#421 rail polish) — 236 px, on every route. Top to bottom:
 *
 *  - Desk, with the needs-you count as its badge (the fold's `needCount`, the Desk sentence's
 *    number — one source, so they never disagree).
 *  - Watchtower — the quiet pill (rule 10), where the bell was. There is no Notifications entry:
 *    the Desk is the notification surface, and Watchtower is the full feed.
 *  - Sessions grouped by project (the board model's order), each with a state dot and the count
 *    of needs-you items that name it. A project group carries two quick icons (new session →
 *    `/` + the project's `@` chip, open project → `/product?project=<id>`); the
 *    unfiled group ("Not in a project") carries none. A session is a chat and its runs when the
 *    daemon stamps `chat_id` (C1), else one run; each opens `/s/:id` (S6a).
 *  - the "Workspace" group label, then Skills · MCP tools · Steering and the HEALTH LINK with its
 *    answered dot — what in-flight work is, one click away (`DESK_RAIL_LINKS`). The foot's top
 *    border separates the Product/support links above it from the run levers below, and carries a
 *    group label ("Workspace", studio#421 r3 change 18) styled like the project groups. Health is a
 *    link to `/health` (`desk-rail-health`); when it is not healthy the link names the state in
 *    muted text ("Health · degraded" / "Health · needs attention", change 16) and its dot is the
 *    rail-level heartbeat (`useRailHealthDot`). Then "Additional settings" — Configuration,
 *    Repositories, Workflows, Evals, Theme (`ADDITIONAL_SETTINGS`) — NAVIGATION ONLY (change 17:
 *    the orders/away and delivery-freeze controls are the Desk's, not the rail's).
 *
 * Render only: the groups are `railGroups` (board/deskModel.ts) over `useBoardModel` + the fold.
 */
export function SessionRail({ runs, needRows, navigate, pathname }: {
  runs: SessionView[];
  needRows: NeedRow[];
  navigate: Navigate;
  pathname: string;
}): React.ReactElement {
  const { items, unfiled } = useMovableBoardModel(runs);
  const count = needCount(needRows);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), undefined, needTextByRun(needRows), runChatId, deliveredNow),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  const dot = useRailHealthDot();
  const [more, setMore] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const moreTrigger = useRef<HTMLButtonElement | null>(null);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); setMore(false); navigate(path); };
  // "Additional settings" is a popover beside the rail (studio#421), on the overlay contract
  // (hooks/useDismissable): a click outside closes it; Escape closes it and returns focus to its
  // trigger — but only when no higher layer owns that Escape (store/layers.ts precedence: the
  // shortcut overlay, an open modal, or a surface that already handled it, like the palette).
  useEffect(() => {
    if (!more) return;
    const onDown = (e: PointerEvent): void => {
      if (moreRef.current !== null && e.target instanceof Node && !moreRef.current.contains(e.target)) setMore(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (useLayerStore.getState().shortcutOverlayOpen || anyModalOpen()) return;
      e.stopPropagation();
      setMore(false);
      moreTrigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [more]);
  const current = (path: string): 'page' | undefined => (pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined);
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);
  // studio#512 (S18b): Theme › Logo takes the dot's place — the classic chrome's §3.1 slot, 32 px, contain-fit.
  const logoUrl = useAppearanceStore((s) => s.appearance.logo_url);

  return (
    <nav data-testid="session-rail" aria-label="Sessions" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      {/* studio#512: Theme › Site name is shown here under the Desk skin (the classic chrome is the other home). */}
      <div className="wk-rail-brand" data-testid="desk-rail-brand">
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
        {siteName !== null ? <b>{siteName}</b> : <>wicked <b>studio</b></>}
      </div>
      <a href="/" onClick={go('/')} data-testid="desk-rail-home" aria-current={pathname === '/' ? 'page' : undefined} className="wk-rail-desk">
        <span>Desk</span>
        {count > 0 && <span data-testid="desk-rail-badge" className="wk-rail-badge" aria-label={`${count} need you`}>{count}</span>}
      </a>
      {/* Watchtower, where the bell was — outside every scroller, so its card is never clipped. */}
      <div className="wk-rail-watch" data-testid="desk-rail-watch" data-nav-dest="watch">
        <WatchPill needRows={needRows} runs={runs} navigate={navigate} onFeed={pathname === '/watch'} />
      </div>

      <div className="wk-rail-groups">
        <MoveProjectStatus />
        {groups.map((g) => (
          <div key={g.projectId ?? 'unfiled'} data-testid="rail-group" data-project-id={g.projectId ?? ''}>
            <div className="wk-rail-group-row">
              <p className="wk-rail-group" title={g.name}>{g.name}</p>
              {g.projectId !== null && g.projectId !== '' && (
                <span className="wk-rail-group-icons">
                  <button
                    type="button"
                    data-testid="rail-group-new"
                    aria-label={`New work in ${g.name}`}
                    title={`New work in ${g.name}`}
                    className="wk-rail-icon-btn"
                    onClick={() => { navigate('/'); seedNewChat(g.projectId, g.name); }}
                  >
                    <Plus size={14} aria-hidden />
                  </button>
                  <button
                    type="button"
                    data-testid="rail-group-view"
                    aria-label={`Open ${g.name}`}
                    title={`Open ${g.name}`}
                    className="wk-rail-icon-btn"
                    onClick={() => { setMore(false); navigate(productPath(g.projectId)); }}
                  >
                    <LayoutGrid size={14} aria-hidden />
                  </button>
                </span>
              )}
            </div>
            {g.sessions.map((s) => (
              <div key={s.id} className="wk-rail-session-row" data-move-row={s.id}>
                <a
                  href={s.path}
                  onClick={go(s.path)}
                  data-testid="rail-session"
                  data-session-id={s.id}
                  data-run-id={s.runId}
                  data-run-ids={s.runIds.join(' ')}
                  data-state={s.state}
                  data-badge={s.badge}
                  title={`${s.fullTitle ?? s.title} — ${s.line}`}
                  aria-label={`${s.fullTitle ?? s.title} — ${s.line}${s.badge > 0 ? `, ${s.badge} need you` : ''}`}
                  aria-current={pathname === s.path ? 'page' : undefined}
                  className="wk-rail-session"
                >
                  <span aria-hidden className={`wk-desk-dot wk-desk-dot--${s.state}`} />
                  <span className="wk-rail-session-title">{s.fullTitle ?? s.title}</span>
                  {s.badge > 0 && <span className="wk-rail-badge" aria-label={`${s.badge} need you`}>{s.badge}</span>}
                </a>
                <MoveToProject session={s} projectId={g.projectId} runs={runs} />
              </div>
            ))}
          </div>
        ))}
      </div>

      <div className="wk-rail-foot">
        {/* studio#421 r3 (change 18): the foot's group label, under the separator, styled like the
            project groups — the Product/support links below are the "Workspace". */}
        <p className="wk-rail-group" data-testid="rail-foot-label">Workspace</p>
        {DESK_RAIL_LINKS.map((l) => (
          <a key={l.dest} href={l.path} onClick={go(l.path)} data-testid={l.testId} data-nav-dest={l.dest} aria-current={current(l.path)} className="wk-rail-link">
            {l.label}
          </a>
        ))}
        <a
          href="/health"
          onClick={(e) => { e.preventDefault(); setMore(false); navigate('/health'); }}
          data-testid="desk-rail-health"
          data-nav-dest="health"
          aria-current={current('/health')}
          aria-label={dot.heartState === 'healthy' ? undefined : `Health, ${dot.heartState === 'unhealthy' ? 'a check is failing' : 'a check needs attention'}`}
          className="wk-rail-link wk-rail-health"
        >
          {/* studio#421 r4 (image-review row 1): the label + state word are one flex item so the link's
              gap never separates them — the dot's `margin-left:auto` (components.css) parks it at the
              right edge. Change 16: when not healthy the state word rides inside the same wrapper. */}
          <span>Health{dot.heartState !== 'healthy' && (
            <span data-testid="rail-health-state" className="wk-rail-health-state"> · {dot.heartState === 'degraded' ? 'degraded' : 'needs attention'}</span>
          )}</span>
          <span aria-hidden data-testid="rail-health-heart" data-health={dot.heartState} className="wk-rail-health-dot" style={{ background: dot.heartColor }} />
        </a>
        <div ref={moreRef}>
          <button
            ref={moreTrigger}
            type="button"
            data-testid="desk-rail-more"
            aria-expanded={more}
            aria-controls={more ? 'desk-rail-additional' : undefined}
            onClick={() => setMore((v) => !v)}
            className="wk-rail-link wk-rail-more"
            style={{ width: '100%' }}
          >
            <span>Additional settings</span>
            <ChevronDown size={14} aria-hidden className="wk-rail-chevron" />
          </button>
          {more && (
            <div id="desk-rail-additional" data-testid="desk-rail-additional" className="wk-rail-everything">
              {/* studio#421 r3 (change 17): NAVIGATION ONLY. The orders/away and delivery-freeze
                  controls live on the Desk (standing orders in the header, the freeze in the Desk's
                  "⋯" sheet) — the rail menu never carries a control that changes behaviour. */}
              {ADDITIONAL_SETTINGS.map((d) => (
                <a key={d.dest} href={d.path} data-nav-dest={d.dest} onClick={go(d.path)} className="wk-rail-link">
                  {d.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
