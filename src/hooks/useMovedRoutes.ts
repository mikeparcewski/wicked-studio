import { useEffect } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { everythingPath, isSessionFilter } from '../board/everythingModel.js';
import { sessionIdOf, sessionPath } from '../board/sessionModel.js';
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
 * | `/p/:id`                 | the project's newest session, `/s/:sessionId`; with none,    |
 * |                          | `/everything?tab=sessions&project=:id`                       |
 *
 * NOT moved in S15c — two §5.4 rows wait for S16a: `/runs/:id` → `/s/:sessionId` and
 * `/p/:id/:mode[/:artifact]` → `/s/:sessionId[/a/:artifactKey]`. The run page and the project shell
 * still carry behaviours the session page does not (the gate trust record, re-run from a phase, the
 * reject-note banner, seat reassignment, the demo start form, the document canvas): 19 behaviour
 * journeys and 5 desk journeys prove them at those addresses, and the Desk's own sheets still send
 * "Full record →" to `/runs/:id`. Moving the address before the behaviours move would strand both.
 * `useLegacyRedirect` keeps filing `/runs/:id` into its project shell meanwhile.
 */

/** The redirect table as data (the ⌘K coverage and the docs read it; the parse in `useRoute` and
 *  `movedAddress` are the behaviour). `/p/:id` is the one dynamic row. */
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
  { from: '/p/:id', to: '/s/:newestSessionId (else /everything?tab=sessions&project=:id)' },
];

/** The static moves — the new address for an old one, or `null` when the address is not a move. */
export function movedAddress(pathname: string, search: string): string | null {
  const segs = pathname.split('/');
  const [, first = '', second = '', third = ''] = segs;
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
  return null;
}

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Membership kinds that make a run a member of a project (the `useLegacyRedirect` rule). */
const RUN_KINDS = new Set(['crew.run', 'crew.chat']);

function launchedMs(v: SessionView): number {
  const c = (v.session as unknown as { created_at?: unknown }).created_at;
  return typeof c === 'number' && Number.isFinite(c) ? c * 1000 : 0;
}

function projectOf(v: SessionView): string | null {
  const p = (v.session as unknown as { project_id?: unknown }).project_id;
  return typeof p === 'string' && p !== '' ? p : null;
}

/**
 * The project's newest session, from the run list in hand: the runs the DTO files under it
 * (`project_id`) plus the project's members (one `GET /projects/:id/members`; a failed read leaves
 * the DTO's word). The newest is the last launched; its session is its chat when the daemon stamps
 * `chat_id` (`runChatId`), else itself. `null` when nothing has been started in the project.
 */
export async function resolveProjectNewestSession(
  projectId: string,
  runs: readonly SessionView[],
  runChatId: boolean,
): Promise<string | null> {
  let members = new Set<string>();
  try {
    const { members: rows } = await api.listProjectMembers(projectId);
    members = new Set(rows.filter((m) => RUN_KINDS.has(m.member_kind)).map((m) => m.member_ref));
  } catch {
    /* the members read failed — the DTO's own project_id still files runs here */
  }
  // The board's placement rule (useBoardModel): the DTO's own `project_id` wins; membership files a
  // run only when the DTO names no project — so a stale membership row never claims another
  // project's run (codex on S15c).
  const mine = runs.filter((v) => {
    const p = projectOf(v);
    return p !== null ? p === projectId : members.has(v.session.id);
  });
  if (mine.length === 0) return null;
  const newest = mine.reduce((a, b) => (launchedMs(b) >= launchedMs(a) ? b : a));
  return sessionIdOf(newest, runChatId);
}

/**
 * Replace a moved address with where it lives now. The static moves fire at once; `/p/:id` waits for
 * the first `GET /runs` answer (or its failure — a failed read still resolves, onto the project's
 * Sessions tab, which says the read failed) and then goes to the newest session.
 */
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
  const { panel, projectId, pathname, search, runs, runsLoaded, runsError, runChatId, navigate } = args;
  useEffect(() => {
    if (panel !== 'everything') return;
    const to = movedAddress(pathname, search);
    if (to !== null) {
      navigate(to, { replace: true });
      return;
    }
    const [, first = '', second = '', third = ''] = pathname.split('/');
    if (first !== 'p' || second === '' || third !== '' || projectId === null) return;
    if (!runsLoaded && runsError === null) return; // the list is still on its way
    let cancelled = false;
    void resolveProjectNewestSession(projectId, runs, runChatId).then((sid) => {
      if (cancelled) return;
      navigate(sid !== null ? sessionPath(sid) : everythingPath({ tab: 'sessions', project: projectId }), { replace: true });
    });
    return () => { cancelled = true; };
  }, [panel, projectId, pathname, search, runs, runsLoaded, runsError, runChatId, navigate]);
}
