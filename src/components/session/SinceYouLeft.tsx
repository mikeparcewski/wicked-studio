import { useState } from 'react';
import type { SessionView } from '../../api/types.js';
import type { SinceCard } from '../../board/sessionModel.js';
import { humanTitle } from '../runIdentity.js';

/**
 * "Since you left" (R2, slice S6a): a session opened after 4 h away. The card OVERLAYS the top of
 * the thread (absolutely placed in the thread's frame), so opening, collapsing or reading it never
 * moves the thread. Collapsed, it is one line.
 */
export function SinceYouLeft({ card, runs }: { card: SinceCard; runs: readonly SessionView[] }): React.ReactElement {
  const [collapsed, setCollapsed] = useState(false);
  const name = (id: string): string => {
    const v = runs.find((r) => r.session.id === id);
    return v === undefined ? id : humanTitle(v.session.problem || id);
  };
  return (
    <aside data-testid="since-you-left" data-collapsed={collapsed ? 'true' : 'false'} aria-label="Since you left" className="wk-since">
      <p className="wk-since-head">
        <b>Since you left · {card.away}</b>
        <span data-testid="since-summary" className="wk-since-summary">{card.summary}</span>
        <button
          type="button"
          data-testid="since-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
          className="wk-since-toggle"
        >
          {collapsed ? 'expand ▾' : 'collapse ▴'}
        </button>
      </p>
      {!collapsed && (
        <div className="wk-since-cols">
          <div><p className="wk-since-col">Finished</p>{card.finished.length === 0 ? <p className="wk-since-none">—</p> : card.finished.map((id) => <p key={id}>{name(id)}</p>)}</div>
          <div><p className="wk-since-col">Stopped</p>{card.failed.length === 0 ? <p className="wk-since-none">—</p> : card.failed.map((id) => <p key={id}>{name(id)}</p>)}</div>
          <div><p className="wk-since-col">Needs you</p><p>{card.needsYou === 0 ? '—' : card.needsYou}</p></div>
        </div>
      )}
    </aside>
  );
}
