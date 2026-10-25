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
 * Green only over a fresh, successful read (`nerveState`): a failed, pending or stale read is yellow.
 */
export function NerveCenterTile({ navigate, pathname, waitingOnYou }: {
  navigate: Navigate;
  pathname: string;
  /** The Desk's settled needs-you count (an older crew's "run waiting on you"). */
  waitingOnYou: number;
}): React.ReactElement {
  const state = useNerveState(waitingOnYou);
  const here = pathname === NERVE_CENTER_PATH || pathname === '/health';
  const label = `${PAGE_NAMES.watch}: ${state.words} — ${toneWord(state.tone)}`;
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
      aria-current={here ? 'page' : undefined}
      aria-label={label}
      title={label}
      className="wk-nc-tile"
    >
      <span aria-hidden data-testid="nerve-center-light" data-tone={state.tone} className="wk-nc-light">
        <Activity size={13} strokeWidth={2.5} />
      </span>
      <span className="wk-nc-text">
        <span className="wk-nc-name">{PAGE_NAMES.watch}</span>
        <span className="sr-only"> · </span>
        <span data-testid="nerve-center-words" className="wk-nc-words">{state.words}</span>
      </span>
    </a>
  );
}
