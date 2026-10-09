import { useEffect } from 'react';
import type { SessionView } from '../api/types.js';
import { everythingPath, isSessionFilter } from '../board/everythingModel.js';
import { sessionPath } from '../board/sessionModel.js';
import type { Navigate } from './useRoute.js';

/**
 * THE §5.4 MOVES (DES-STUDIO-REBUILD-001 §5.4, slice S15c) — "redirects only for moves, never for
 * typos" (useRoute.ts). Every move REPLACES its history entry, so Back never re-enters the old
 * address, and none is skin-scoped: an address is not a skin concern.
 *
 * | Old address              | Lands on                                                     |
 * |--------------------------|--------------------------------------------------------------|
 * | `/projects`              | `/everything`                                                |
 * | `/chats`                 | `/everything?tab=sessions`                                   |
 * | `/work[?filter=f]`       | `/everything?tab=sessions[&filter=f]` (the old words kept)   |
 * | `/execute[?filter=f]`    | `/everything?tab=sessions[&filter=f]`                        |
 * | `/runs` (bare listing)   | `/everything?tab=sessions[&filter=f]`                        |
 * | `/make`                  | `/everything?tab=sessions`                                   |
 * | `/vibe`                  | `/everything?tab=made&kind=documents`                        |
 * | `/demo`                  | `/everything?tab=made&kind=videos`                           |
 * | `/p/:id/chronicle`       | `/everything?tab=sessions&project=:id`                       |
 * | `/p/:id`                 | `/everything?tab=sessions&project=:id`                       |
 * | `/runs/:id`              | `/s/run%3A:id` (search and hash kept — `?jump=`, `#gate`, …) |
 * | `/runs/:id/timeline`     | `/s/run%3A:id` (search and hash kept)                        |
 * | `/p/:pid/build/:run`     | `/s/run%3A:run` (search and hash kept)                       |
 *
 * S16a-2d: the run page's addresses moved once the session carried what it did (S16a-1a…2c). Not
 * moves: `/runs/new`, `/p/:pid/build/new`, `/p/:pid/build`, `/runs/:id/events|files`, the project
 * shell's other modes (`/p/:id/:mode[/:artifact]` waits for S16a-4), and typos.
 */

/** The redirect table as data (the ⌘K coverage and the docs read it; the parse in `useRoute` and
 *  `movedAddress` are the behaviour). */
export const MOVES: readonly { from: string; to: string }[] = [
  { from: '/projects', to: '/everything' },
  { from: '/chats', to: '/everything?tab=sessions' },
  { from: '/work', to: '/everything?tab=sessions[&filter=…]' },
  { from: '/execute', to: '/everything?tab=sessions[&filter=…]' },
  { from: '/runs', to: '/everything?tab=sessions[&filter=…]' },
  { from: '/make', to: '/everything?tab=sessions' },
  { from: '/vibe', to: '/everything?tab=made&kind=documents' },
  { from: '/demo', to: '/everything?tab=made&kind=videos' },
  { from: '/p/:id/chronicle', to: '/everything?tab=sessions&project=:id' },
  { from: '/p/:id', to: '/everything?tab=sessions&project=:id' },
  { from: '/runs/:id', to: '/s/run%3A:id[?…][#…]' },
  { from: '/runs/:id/timeline', to: '/s/run%3A:id[?…][#…]' },
  { from: '/p/:pid/build/:run', to: '/s/run%3A:run[?…][#…]' },
];

/** The static moves — the new address for an old one, or `null` when the address is not a move. */
export function movedAddress(pathname: string, search: string, hash = ''): string | null {
  const segs = pathname.split('/');
  const [, first = '', second = '', third = '', fourth = ''] = segs;
  const restEmpty = (from: number): boolean => segs.slice(from).every((x) => x === '');
  const raw = new URLSearchParams(search).get('filter');
  const filter = isSessionFilter(raw) ? raw : undefined;
  const sessions = (): string => everythingPath({ tab: 'sessions', ...(filter !== undefined ? { filter } : {}) });
  // The WHOLE address must be the old one: `/work//typo` and `/work///typo` are typos, not moves.
  if (restEmpty(2)) {
    switch (first) {
      case 'projects': return everythingPath();
      case 'chats':
      case 'make': return everythingPath({ tab: 'sessions' });
      case 'work':
      case 'execute':
      case 'runs': return sessions();
      case 'vibe': return everythingPath({ tab: 'made', kind: 'documents' });
      case 'demo': return everythingPath({ tab: 'made', kind: 'videos' });
      default: return null;
    }
  }
  if (first === 'p' && second !== '' && third === 'chronicle' && restEmpty(4)) {
    return everythingPath({ tab: 'sessions', project: decode(second) });
  }
  if (first === 'p' && second !== '' && third === '' && restEmpty(3)) {
    return everythingPath({ tab: 'sessions', project: decode(second) });
  }
  // S16a-2d: the run page's addresses → the run's session thread; every query and fragment the old
  // page honoured rides along verbatim (`?jump=` from the Watchtower, `#gate`, `#governance`).
  const runSession = (id: string): string => `${sessionPath(`run:${decode(id)}`)}${search}${hash}`;
  if (first === 'runs' && second !== '' && second !== 'new'
    && ((third === '' && restEmpty(3)) || (third === 'timeline' && restEmpty(4)))) {
    return runSession(second);
  }
  if (first === 'p' && second !== '' && third === 'build' && fourth !== '' && fourth !== 'new' && restEmpty(5)) {
    return runSession(fourth);
  }
  return null;
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Replace a moved address with where it lives now. */
export function useMovedRoutes(args: {
  panel: string;
  projectId: string | null;
  pathname: string;
  search: string;
  runs: readonly SessionView[];
  runsLoaded: boolean;
  runsError: string | null;
  runChatId: boolean;
  navigate: Navigate;
}): void {
  const { panel, pathname, search, navigate } = args;
  useEffect(() => {
    // The S15c moves parse to Everything; the S16a-2d run moves parse straight to the session.
    if (panel !== 'everything' && panel !== 'session') return;
    if (panel === 'session' && pathname.startsWith('/s/')) return;
    const to = movedAddress(pathname, search, window.location.hash);
    if (to !== null) {
      navigate(to, { replace: true });
      return;
    }
  }, [panel, pathname, search, navigate]);
}
