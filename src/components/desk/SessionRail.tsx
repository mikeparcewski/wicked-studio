import { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionView } from '../../api/types.js';
import { DESK_DESTINATIONS, needsByRun, needTextByRun, railGroups } from '../../board/deskModel.js';
import { needCount } from '../../board/needsQueue.js';
import type { NeedRow } from '../../board/needsYou.js';
import { useBoardModel } from '../../hooks/useBoardModel.js';
import { useCapabilities } from '../../store/capabilities.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { SESSION_RAIL_PX } from '../../theming/skins.js';
import { HealthRailSection } from '../HealthRailSection.js';
import { NotificationBell } from '../NotificationBell.js';
import { WatchPill } from './WatchPill.js';

/**
 * THE SESSION RAIL (skin `desk`, DES-STUDIO-REBUILD-001 §4.2, slice S4) — 236 px, on every route.
 *
 *  - Desk, with the needs-you count as its badge (the fold's `needCount`, the Desk sentence's
 *    number — one source, so they never disagree).
 *  - Sessions grouped by project (the board model's order), each with a state dot and the count
 *    of needs-you items that name it. A session is a chat and its runs when the daemon stamps
 *    `chat_id` (C1, `capabilities.runChatId`), else one run; each opens `/s/:id` (S6a).
 *  - The foot: Watchtower (one quiet sentence), Rules, the bell, Health, and "Everything else" —
 *    every destination the other skins' nav reaches (the restated skin contract).
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
  const groups = useMemo(
    () => railGroups(items, unfiled, needsByRun(needRows), undefined, needTextByRun(needRows), runChatId),
    [items, unfiled, needRows, runChatId],
  );
  const [more, setMore] = useState(false);
  const [healthOpen, setHealthOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  const go = (path: string) => (e: React.MouseEvent): void => { e.preventDefault(); setMore(false); navigate(path); };
  // "Everything else" is a popover beside the rail (studio#421): Escape or a click outside closes it.
  useEffect(() => {
    if (!more) return;
    const onDown = (e: PointerEvent): void => {
      if (moreRef.current !== null && e.target instanceof Node && !moreRef.current.contains(e.target)) setMore(false);
    };
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') setMore(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [more]);
  const startSomething = (): void => {
    navigate('/');
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="desk-composer-input"]')?.focus());
  };

  return (
    <nav data-testid="session-rail" aria-label="Sessions" className="wk-rail" style={{ width: SESSION_RAIL_PX }}>
      <div className="wk-rail-brand"><span aria-hidden className="wk-desk-dot wk-desk-dot--waiting" /> wicked <b>studio</b></div>
      <a href="/" onClick={go('/')} data-testid="desk-rail-home" aria-current={pathname === '/' ? 'page' : undefined} className="wk-rail-desk">
        <span>Desk</span>
        {count > 0 && <span data-testid="desk-rail-badge" className="wk-rail-badge" aria-label={`${count} need you`}>{count}</span>}
      </a>
      {/* Outside every scroller, so its popover is never clipped. */}
      <div className="wk-rail-bell"><NotificationBell navigate={navigate} /></div>

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
        <WatchPill count={count} runs={runs} navigate={navigate} />
        <a href="/steering/policies" onClick={go('/steering/policies')} className="wk-rail-link">Rules</a>
        <HealthRailSection open={healthOpen} onToggle={() => setHealthOpen((v) => !v)} />
        <div ref={moreRef}>
          <button
            type="button"
            data-testid="desk-rail-more"
            aria-expanded={more}
            aria-controls={more ? 'desk-rail-everything' : undefined}
            onClick={() => setMore((v) => !v)}
            className="wk-rail-link"
            style={{ width: '100%' }}
          >
            {more ? 'Everything else ▸' : 'Everything else ▾'}
          </button>
          {more && (
            <div id="desk-rail-everything" data-testid="desk-rail-everything" className="wk-rail-everything">
              {DESK_DESTINATIONS.map((d) => (
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
