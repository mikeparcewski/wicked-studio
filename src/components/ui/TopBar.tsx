import type { RefObject } from 'react';
import { Plus, Search } from 'lucide-react';
import { openSearch } from '../../store/searchModal.js';
import { startNewJob } from '../desk/SessionRail.js';

/** The phone top bar (design/UI-CONTRACT.md §3): a 44x44 menu button, the wordmark, the Desk badge, then
 *  New job and Search (the rail's action row is in the drawer; Chat is the bubble). */
export function TopBar({ onMenu, menuOpen, badge, toggleRef, ambientProject = null }: {
  onMenu: () => void; menuOpen: boolean; badge: React.ReactNode; toggleRef?: RefObject<HTMLButtonElement>;
  /** The project on screen: New job starts there. */
  ambientProject?: string | null;
}): React.ReactElement {
  return (
    <header data-testid="phone-topbar" className="wk-topbar">
      <button
        ref={toggleRef} type="button" data-testid="rail-drawer-toggle" className="wk-btn wk-btn--quiet wk-btn--icon wk-topbar-menu"
        aria-label={menuOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={menuOpen} aria-controls="rail-drawer" onClick={onMenu}
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </button>
      <span className="wk-topbar-brand"><span aria-hidden className="wk-desk-dot" /> wicked <b>studio</b></span>
      <span className="wk-topbar-badge">{badge}</span>
      <button type="button" data-testid="topbar-new-job" className="wk-btn wk-btn--quiet wk-btn--icon wk-topbar-search" aria-label="New job" onClick={() => startNewJob(ambientProject)}>
        <Plus size={20} aria-hidden />
      </button>
      <button type="button" data-testid="topbar-search" className="wk-btn wk-btn--quiet wk-btn--icon wk-topbar-search" aria-label="Search" onClick={() => openSearch()}>
        <Search size={18} aria-hidden />
      </button>
    </header>
  );
}
