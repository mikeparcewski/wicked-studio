import { useEffect, useMemo, useRef, useState } from 'react';
import { useDeliveredNow } from '../../store/postHocDeliver.js';
import type { SessionView } from '../../api/types.js';
import { ADDITIONAL_SETTINGS, DESK_RAIL_LINKS, needsByRun, needTextByRun, railGroups } from '../../board/deskModel.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useCapabilities } from '../../store/capabilities.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { SESSION_RAIL_PX } from '../../theming/skins.js';
import { useAppearanceStore } from '../../theming/appearance.js';
import { anyModalOpen, useLayerStore } from '../../store/layers.js';
import { HealthRailSection } from '../HealthRailSection.js';
import { WatchPill } from './WatchPill.js';
import { StandingOrdersPanel } from '../StandingOrdersPanel.js';
import { DeliveryFreezeSwitch } from '../DeliveryFreezeSwitch.js';

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4; Amendment 5 as revised,
 * S15c) — 236 px, on every route. Top to bottom:
 *
 *  - Desk, with the needs-you count as its badge (the fold's `needCount`, the Desk sentence's
 *    number — one source, so they never disagree).
 *  - Watchtower — the quiet pill (rule 10), where the bell was. There is no Notifications entry:
 *    the Desk is the notification surface, and Watchtower is the full feed.
 *  - Sessions grouped by project (the board model's order), each with a state dot and the count
 *    of needs-you items that name it. A session is a chat and its runs when the daemon stamps
 *    `chat_id` (C1, `capabilities.runChatId`), else one run; each opens `/s/:id` (S6a).
 *  - Skills · MCP tools · Steering — they change what in-flight work does, so they are one click
 *    away (`DESK_RAIL_LINKS`). Health. Then "Additional settings" — Configuration, Repositories,
 *    Workflows, Evals, Theme (`ADDITIONAL_SETTINGS`) and the orders/away and freeze controls.
 *
 * Render only: the groups are `railGroups` (board/deskModel.ts) over `useBoardModel` + the fold.
 */
export function SessionRail({ runs, needRows, navigate, pathname }: {
  runs: SessionView[];
  needRows: NeedRow[];
  navigate: Navigate;
  pathname: string;
}): React.ReactElement {
  const { items, unfiled } = useBoardModel(runs);
  const count = needCount(needRows);
  const runChatId = useCapabilities((s) => s.runChatId);
  const deliveredNow = useDeliveredNow();
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), undefined, needTextByRun(needRows), runChatId, deliveredNow),
    [items, unfiled, needRows, runChatId, deliveredNow],
  );
  const [more, setMore] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
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
  const startSomething = (): void => {
    navigate('/');
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="desk-composer-input"]')?.focus());
  };
  const current = (path: string): 'page' | undefined => (pathname === path || pathname.startsWith(`${path}/`) ? 'page' : undefined);
  const siteName = useAppearanceStore((s) => s.appearance.site_name?.trim() || null);

  return (
    <nav data-testid="session-rail" aria-label="Sessions" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      {/* studio#512: Theme › Site name is shown here under the Desk skin (the classic chrome is the other home). */}
      <div className="wk-rail-brand" data-testid="desk-rail-brand">
        <span aria-hidden className="wk-desk-dot wk-desk-dot--waiting" />
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
        {groups.map((g) => (
          <div key={g.projectId ?? 'unfiled'} data-testid="rail-group" data-project-id={g.projectId ?? ''}>
            <p className="wk-rail-group">{g.name}</p>
            {g.sessions.map((s) => (
              <a
                key={s.id}
                href={s.path}
                onClick={go(s.path)}
                data-testid="rail-session"
                data-session-id={s.id}
                data-run-id={s.runId}
                data-run-ids={s.runIds.join(' ')}
                data-state={s.state}
                data-badge={s.badge}
                title={s.line}
                aria-label={`${s.title} — ${s.line}${s.badge > 0 ? `, ${s.badge} need you` : ''}`}
                aria-current={pathname === s.path ? 'page' : undefined}
                className="wk-rail-session"
              >
                <span aria-hidden className={`wk-desk-dot wk-desk-dot--${s.state}`} />
                <span className="wk-rail-session-title">{s.title}</span>
                {s.badge > 0 && <span className="wk-rail-badge" aria-label={`${s.badge} need you`}>{s.badge}</span>}
              </a>
            ))}
          </div>
        ))}
        <button type="button" data-testid="desk-rail-start" onClick={startSomething} className="wk-rail-start">+ Start something</button>
      </div>

      <div className="wk-rail-foot">
        {DESK_RAIL_LINKS.map((l) => (
          <a key={l.dest} href={l.path} onClick={go(l.path)} data-testid={l.testId} data-nav-dest={l.dest} aria-current={current(l.path)} className="wk-rail-link">
            {l.label}
          </a>
        ))}
        <HealthRailSection open={healthOpen} onToggle={() => setHealthOpen((v) => !v)} />
        <div ref={moreRef}>
          <button
            ref={moreTrigger}
            type="button"
            data-testid="desk-rail-more"
            aria-expanded={more}
            aria-controls={more ? 'desk-rail-additional' : undefined}
            onClick={() => setMore((v) => !v)}
            className="wk-rail-link"
            style={{ width: '100%' }}
          >
            {more ? 'Additional settings ▸' : 'Additional settings ▾'}
          </button>
          {more && (
            <div id="desk-rail-additional" data-testid="desk-rail-additional" className="wk-rail-everything">
              {ADDITIONAL_SETTINGS.map((d) => (
                <a key={d.dest} href={d.path} data-nav-dest={d.dest} onClick={go(d.path)} className="wk-rail-link">
                  {d.label}
                </a>
              ))}
              {/* COVERAGE.md finding 2: the two switches that change what studio does while you
                  are away — never lost at the flip. On, the Desk says so too (DeskStateRows). */}
              <div data-testid="desk-rail-controls" aria-label="Standing orders and deliveries" role="group" className="wk-rail-controls">
                <StandingOrdersPanel />
                <DeliveryFreezeSwitch placement="inline" />
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
