import { useEffect } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { everythingPath, isSessionFilter } from '../board/everythingModel.js';
import { sessionIdOf, sessionPath } from '../board/sessionModel.js';
import type { Navigate } from './useRoute.js';

/**
 * THE §5.4 MOVES (DES-STUDIO-REBUILD-001 §5.4, slice S15c + S16a) — "redirects only for moves,
 * never for typos" (useRoute.ts). Every move REPLACES its history entry, so Back never re-enters
 * the old address, and none is skin-scoped: an address is not a skin concern.
 *
 * | Old address                  | Lands on                                                     |
 * |------------------------------|--------------------------------------------------------------|
 * | `/projects`                  | `/everything`                                                |
 * | `/chats`                     | `/everything?tab=sessions`                                   |
 * | `/work[?filter=f]`           | `/everything?tab=sessions[&filter=f]` (the old words kept)   |
 * | `/execute[?filter=f]`        | `/everything?tab=sessions[&filter=f]`                        |
 * | `/runs` (bare listing)       | `/everything?tab=sessions[&filter=f]`                        |
 * | `/make`                      | `/everything?tab=sessions`                                   |
 * | `/vibe`                      | `/everything?tab=made&kind=documents`                        |
 * | `/demo`                      | `/everything?tab=made&kind=videos`                           |
 * | `/p/:id/chronicle`           | `/everything?tab=sessions&project=:id`                       |
 * | `/p/:id`                     | the project's newest session, `/s/:sessionId`; with none,    |
 * |                              | `/everything?tab=sessions&project=:id`                       |
 * | `/runs/:id` (S16a)           | `/s/run:<id>` (bare or `/timeline`; any other suffix stays)  |
 * | `/p/:id/build/new` (S16a)    | `/runs/new`                                                  |
 * | `/p/:id/build/:runId` (S16a) | `/s/run:<runId>` (that run's session, no lookup)             |
 * | `/p/:id/chat/:chatId` (S16a) | `/chat/:chatId`                                              |
 * | `/p/:id/:mode` (S16a)        | `/s/:newestSessionId` (else `/everything?tab=sessions&…`)    |
 * | `/p/:id/document/:doc` (S16a)| `/s/:newestSessionId`  (artifact key discarded — no live route)|
 * | `/p/:id/video/:demo` (S16a)  | `/s/:newestSessionId`  (artifact key discarded — no live route)|
 */

/** The redirect table as data (the ⌘K coverage and the docs read it; the parse in `useRoute` and
 *  `movedAddress` are the behaviour). `/p/:id` and the S16a rows are dynamic. */
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
  { from: '/runs/:id', to: '/s/run:<id>' },
  { from: '/p/:id/build/new', to: '/runs/new' },
  { from: '/p/:id/build/:runId', to: '/s/run:<runId>' },
  { from: '/p/:id/chat/:chatId', to: '/chat/:chatId' },
  { from: '/p/:id/:mode', to: '/s/:newestSessionId (else /everything?tab=sessions&project=:id)' },
  { from: '/p/:id/document/:doc', to: '/s/:newestSessionId (artifact key discarded in S16a)' },
  { from: '/p/:id/video/:demo', to: '/s/:newestSessionId (artifact key discarded in S16a)' },
];

/** The static moves — the new address for an old one, or `null` when the address is not a move. */
export function movedAddress(pathname: string, search: string): string | null {
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
  // S16a static moves for /p/:id/build and /p/:id/chat (the run or chat is named in the URL).
  if (first === 'p' && second !== '' && third === 'build' && fourth === 'new' && restEmpty(5)) {
    return '/runs/new';
  }
  if (first === 'p' && second !== '' && third === 'build' && fourth !== '' && fourth !== 'new' && restEmpty(5)) {
    return sessionPath(`run:${decode(fourth)}`);
  }
  if (first === 'p' && second !== '' && third === 'chat' && fourth !== '' && restEmpty(5)) {
    return `/chat/${encodeURIComponent(decode(fourth))}`;
  }
  // S16a: `/runs/:id` and `/runs/:id/timeline` → `/s/run:<id>`.
  // Operator (c): only bare id or /timeline; any other suffix stays a dead address.
  // Exclusions: `/runs/new` (launch form stays), `/runs/:id/events` and `/runs/:id/files` (raw views stay).
  if (first === 'runs' && second !== '' && second !== 'new'
      && third !== 'events' && third !== 'files'
      && (third === '' || third === 'timeline') && restEmpty(4)) {
    return sessionPath(`run:${decode(second)}`);
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
    // Static moves fire for any panel — /runs/:id now parses to 'session', not 'everything'.
    const to = movedAddress(pathname, search);
    if (to !== null) {
      navigate(to, { replace: true });
      return;
    }

    // Dynamic moves (async) only make sense on 'everything'.
    if (panel !== 'everything') return;

    const [, first = '', second = '', third = ''] = pathname.split('/');
    if (first !== 'p' || second === '' || projectId === null) return;

    // `/p/:id` (bare) — the existing dynamic arm: find the project's newest session.
    if (third === '' || third === 'chronicle') {
      if (!runsLoaded && runsError === null) return;
      let cancelled = false;
      void resolveProjectNewestSession(projectId, runs, runChatId).then((sid) => {
        if (cancelled) return;
        navigate(sid !== null ? sessionPath(sid) : everythingPath({ tab: 'sessions', project: projectId }), { replace: true });
      });
      return () => { cancelled = true; };
    }

    // S16a: `/p/:id/:mode[/:artifact]` — find the project's newest session.
    // `/s/:id/a/:key` is not a live route in S16a, so artifact keys are discarded.
    // `/p/:id/campaigns` parses to its own panel (not 'everything') and never reaches here.
    if (!runsLoaded && runsError === null) return;
    let cancelled = false;
    void resolveProjectNewestSession(projectId, runs, runChatId).then((sid) => {
      if (cancelled) return;
      if (sid === null) {
        navigate(everythingPath({ tab: 'sessions', project: projectId }), { replace: true });
        return;
      }
      // The artifact key (document/:doc, video/:demo) is discarded: /s/:id/a/:key is not a live
      // route in S16a, so redirect to the session root. The session shows the document naturally.
      navigate(sessionPath(sid), { replace: true });
    });
    return () => { cancelled = true; };
  }, [panel, projectId, pathname, search, runs, runsLoaded, runsError, runChatId, navigate]);
}
