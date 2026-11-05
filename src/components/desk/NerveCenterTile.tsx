import { Activity } from 'lucide-react';
import { toneWord } from '../../board/nerveCenter.js';
import { PAGE_NAMES } from '../../board/pageNames.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { useNerveState } from '../../hooks/useNerveState.js';

/** Where Nerve Center lives. `/health` redirects here. */
export const NERVE_CENTER_PATH = '/watch';

/**
 * THE NERVE CENTER TILE (DES-SYSTEM-VIEW, "The rail entry"): ONE label pinned to the bottom of the
 * rail, larger than every other rail item, replacing the separate Health and Watchtower links. The
 * WHOLE tile takes the state colour (theme tokens `--nc-*`, AA text on each fill): a soft green fill
 * when all clear, solid amber when something needs a look, solid red when work is blocked; red
 * pulses once when it turns red. Colour is never the only signal: the worst item is said in words
 * beside the name, and the accessible name carries the state.
 *
 * Green only over a fresh, successful read (`nerveState`): a failed or stale read is yellow; a read that
 * has not answered yet is neutral grey (no verdict). The words are a summary ("disk low · 1 needs you"),
 * never an item's title.
 *
 * `compact` (the rail folded to icons, operator 2026-11-04: "nerve center should have colored icon too"): the
 * same tile at icon size, filled the same way by the same state, the words only in its name and tooltip.
 */
export function NerveCenterTile({ navigate, pathname, waitingOnYou, compact = false }: {
  navigate: Navigate;
  pathname: string;
  /** The Desk's settled needs-you count (an older crew's "run waiting on you"). */
  waitingOnYou: number;
  compact?: boolean;
}): React.ReactElement {
  const state = useNerveState(waitingOnYou);
  const here = pathname === NERVE_CENTER_PATH || pathname === '/health';
  // While crew has not answered yet the tile is neutral: no verdict, in colour or in words.
  // The quiet note (a CLI nobody set up) rides the name and tooltip of a green tile; it never colours
  // the tile, and never crowds a tile that has something to act on.
  const note = state.read === 'fresh' && state.tone === 'green' && state.info != null ? state.info : null;
  const info = note !== null ? `. ${note}` : '';
  const label = state.read === 'checking' ? `${PAGE_NAMES.watch}: ${state.words}` : `${PAGE_NAMES.watch}: ${state.words} — ${toneWord(state.tone)}${info}`;
  return (
    <a
      href={NERVE_CENTER_PATH}
      onClick={(e) => {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        navigate(NERVE_CENTER_PATH);
      }}
      data-testid="desk-rail-nerve"
      data-nav-dest="watch"
      data-tone={state.tone}
      data-read={state.read}
      data-info={note ?? undefined}
      aria-current={here ? 'page' : undefined}
      aria-label={label}
      title={label}
      data-rail-heading={compact ? 'watch' : undefined}
      className={`wk-nc-tile${compact ? ' wk-nc-tile--icon' : ''}`}
    >
      <span aria-hidden data-testid="nerve-center-light" data-tone={state.tone} className="wk-nc-light">
        <Activity size={compact ? 15 : 13} strokeWidth={2.5} />
      </span>
      {!compact && <span className="wk-nc-text">
        <span className="wk-nc-name">{PAGE_NAMES.watch}</span>
        <span className="sr-only"> · </span>
        <span data-testid="nerve-center-words" className="wk-nc-words">{state.words}</span>
      </span>}
    </a>
  );
}
