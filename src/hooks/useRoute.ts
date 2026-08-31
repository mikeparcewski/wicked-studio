import { useCallback, useEffect, useState } from 'react';
import { isSteeringType } from '../api/steering.js';

// `make` is the round-4 primary-path dashboard route (DES-FEEDBACK-003 §2.1) —
// a CLIENT route (a new panel id in this union), not a wire. Slice M registers
// it with a placeholder surface; the real dashboard is slice O (§4.2).
// `steering` is the STEERING program's surface (`/steering/:type`) — the panels
// it replaced (`wiki`, `rules`) are gone from this union; their old paths parse
// to `steering` with a null type, which `useSteeringRedirect` normalizes.
export type Panel = 'home' | 'runs' | 'coverage' | 'workflows' | 'domain' | 'policies' | 'steering' | 'repos' | 'system' | 'theme' | 'chats' | 'work' | 'repo-detail' | 'projects' | 'project-detail' | 'make' | 'campaigns' | 'campaign-detail';

const PANELS: Panel[] = ['runs', 'coverage', 'workflows', 'domain', 'policies', 'repos', 'system', 'theme', 'chats', 'work', 'repo-detail', 'projects', 'project-detail', 'make', 'campaigns'];

/**
 * The four verbs on a project (DES-MERGE-001 §1.3). Mode is a ROUTE SEGMENT, not
 * app state: `/p/:projectId/:mode[/:artifactId]`, so it is deep-linkable,
 * back-button-correct and Playwright-addressable.
 */
export type Mode = 'chat' | 'build' | 'document' | 'video';

export const MODES: readonly Mode[] = ['chat', 'build', 'document', 'video'] as const;

function asMode(s: string): Mode | null {
  return (MODES as readonly string[]).includes(s) ? (s as Mode) : null;
}

interface Route {
  panel: Panel;
  /** Non-null only when panel === 'runs' and a run is selected. */
  runId: string | null;
  /** True when panel === 'runs' and the launch form is open. */
  showLaunch: boolean;
  /** Non-null only when panel === 'repo-detail'. */
  repoId: string | null;
  /** True when panel === 'repos' and the register form should auto-open. */
  showRegisterRepo: boolean;
  /** True when the launch form is in chat mode (vs. work mode). */
  chatMode: boolean;
  /** Non-null on the legacy `/projects/:id` panel AND on every `/p/*` route. */
  projectId: string | null;
  /** Non-null only on `/p/:projectId/:mode` — the active mode of the project shell. */
  mode: Mode | null;
  /** What the mode has open: run id (Build), thread id (Chat), doc id, demo id. */
  artifactId: string | null;
  /** True on `/p/:projectId/chronicle` (DES-UX-002 §5.2, slice BE): the work
   *  chronicle as a REAL route — deep-linkable, back-button-correct. It rides
   *  the Build surface (mode resolves to 'build'; the chronicle is a second
   *  VIEW of the project's build work, §3's adopted additive position), so
   *  this flag — not a fifth Mode — is what selects the view. */
  chronicleView: boolean;
  /** Non-null only on `/campaigns/:id` (DES-CAMPAIGN-001 §3.5 / TH-14) — the campaign label. */
  campaignId: string | null;
  /** The steering sub-page's type on `/steering/:type`. `null` while panel === 'steering' means
   *  an address that names no valid type (bare `/steering`, the legacy `/wiki` and `/rules`) —
   *  `useSteeringRedirect` replaces those with the Architecture page's real URL. */
  steeringType: string | null;
}

/** Route options a caller can override; everything else takes its inert default. */
const INERT: Route = {
  panel: 'runs',
  runId: null,
  showLaunch: false,
  repoId: null,
  showRegisterRepo: false,
  chatMode: false,
  projectId: null,
  mode: null,
  artifactId: null,
  chronicleView: false,
  campaignId: null,
  steeringType: null,
};

function route(over: Partial<Route>): Route {
  return { ...INERT, ...over };
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Where `/p/:projectId` (no mode) lands: the PROJECT DASHBOARD (DES-FEEDBACK-001
 * §4.1) — context before actions. This replaced the last-used-mode redirect
 * (slice D): entering a project no longer jumps into whatever mode was open
 * last; the operator sees the project's state and CHOOSES a mode.
 */
export function projectPath(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}`;
}

/** Build a project-shell path. The single spelling of `/p/:projectId/:mode[/:artifactId]`. */
export function modePath(projectId: string, mode: Mode, artifactId?: string | null): string {
  const base = `${projectPath(projectId)}/${mode}`;
  return artifactId ? `${base}/${encodeURIComponent(artifactId)}` : base;
}

/** The work chronicle's real route (DES-UX-002 §5.2, slice BE) — see `chronicleView`. */
export function chroniclePath(projectId: string): string {
  return `${projectPath(projectId)}/chronicle`;
}

/**
 * A run's evidence-timeline address (DES-UX-002 §5.2, slice BE): `/runs/:id/
 * timeline` — the §5.2 alias of `/runs/:id`, whose default layout the timeline
 * already is (slice BB, terminal runs). The parser resolves both spellings to
 * the run detail; entry points (the home board's ACTIVE card, §5.3) use this
 * one so the intent is legible in the URL.
 */
export function runTimelinePath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/timeline`;
}

/**
 * Where a document version lives (DES-MERGE-001 §4.2, slice 9): `?v=N` on the doc
 * route. A query param rather than a fifth path segment — the version is a LENS on
 * one artifact, not a different artifact — and it is still a real navigation, so a
 * selected version is deep-linkable and Back returns to the previously viewed one.
 * `null` addresses the manifest head, i.e. the bare doc route.
 *
 * `mode` defaults to Document; Video passes `'video'` (DES-FEEDBACK-001 §7.4 — a demo
 * is a doc whose storyboard versions are addressed the same way, on its own route).
 */
export function versionPath(
  projectId: string, docId: string, version: number | null, mode: Mode = 'document',
): string {
  const base = modePath(projectId, mode, docId);
  return version === null ? base : `${base}?v=${version}`;
}

/**
 * The routed version, read from a `location.search` string. Anything that is not a
 * positive integer is not a version and resolves to the head — a mangled bookmark
 * should show the document, not an error about its URL.
 */
export function routedVersion(search: string): number | null {
  const raw = new URLSearchParams(search).get('v');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parse(pathname: string): Route {
  const [, first = '', second = '', third = '', fourth = ''] = pathname.split('/');
  // `/` is the orchestrator board (DES-MERGE-001 §1.5, slice 5). The flat run list it
  // replaced keeps its own route, `/runs` — the power-user escape hatch, not a redirect.
  if (first === '') {
    return route({ panel: 'home' });
  }
  // The project+mode parse runs AHEAD of the panel parse (DES-MERGE-001 §1.5); the
  // `Panel` union below is untouched and still owns every side panel.
  if (first === 'p' && second) {
    // `/p/:projectId/chronicle` (DES-UX-002 §5.2, slice BE): the chronicle's
    // real route. It resolves to the Build surface with the chronicle VIEW
    // selected — never an artifact named "chronicle".
    if (third === 'chronicle') {
      return route({ projectId: safeDecode(second), mode: 'build', chronicleView: true });
    }
    const mode = asMode(third);
    const raw = mode !== null && fourth ? safeDecode(fourth) : null;
    // `/p/:projectId/:mode/new` is the project-scoped CREATE route (DES-FEEDBACK-001
    // §4.3, slice B): the launch form pre-bound to the project — never an artifact
    // named "new", so `artifactId` stays null and no run-selected machinery
    // (event backfill, kill shortcut) fires against a non-id.
    const isNew = raw === 'new';
    const artifactId = isNew ? null : raw;
    return route({
      projectId: safeDecode(second),
      mode,
      artifactId,
      showLaunch: isNew,
      // Build and Chat wire straight into the existing run surfaces, so the artifact IS
      // the run: every run-selected behaviour (event backfill, Ctrl+K kill, RightPanel,
      // gate toasts) keeps working unchanged inside the shell.
      runId: mode === 'build' || mode === 'chat' ? artifactId : null,
      chatMode: mode === 'chat',
    });
  }
  // `/steering/:type` — the STEERING surface: one page component, parameterized by type.
  // An address that names no valid type (bare `/steering`, a typo'd type) parses with
  // `steeringType: null`; `useSteeringRedirect` replaces it with the Architecture page.
  if (first === 'steering') {
    return route({ panel: 'steering', steeringType: isSteeringType(second) ? second : null });
  }
  // The RETIRED governance addresses: `/wiki` (the old Architecture Wiki page) and `/rules`
  // (the old RuleManager) both fold into Steering/Architecture — parsed here so the pages
  // render instantly, redirected (replace) so bookmarks land on the surface's real URL.
  if (first === 'wiki' || first === 'rules') {
    return route({ panel: 'steering', steeringType: null });
  }
  // `/campaigns/:id` — one campaign's scoreboard (DES-CAMPAIGN-001 §3.5 / TH-14); the bare
  // `/campaigns` list resolves through the PANELS catch-all below, same as `/repos`.
  if (first === 'campaigns' && second) {
    return route({ panel: 'campaign-detail', campaignId: safeDecode(second) });
  }
  if (first === 'repo-detail' && second) {
    return route({ panel: 'repo-detail', repoId: safeDecode(second) });
  }
  if (first === 'repo-detail') {
    return route({ panel: 'repos' });
  }
  if (first === 'repos' && second === 'new') {
    return route({ panel: 'repos', showRegisterRepo: true });
  }
  if (first === 'chat' && second === 'new') {
    return route({ panel: 'runs', showLaunch: true, chatMode: true });
  }
  // `/chat/:id` — a live chat SESSION's real URL (J4/C6: an opened chat is
  // findable again). The id is the pool session's chatId, carried in
  // `artifactId` (it is NOT a run — `runId` stays null so no run-selected
  // machinery fires against it). GroupChat rejoins the warm session, or says
  // honestly that it is gone.
  if (first === 'chat' && second) {
    return route({ panel: 'runs', chatMode: true, artifactId: safeDecode(second) });
  }
  if (first === 'projects' && second) {
    return route({ panel: 'project-detail', projectId: safeDecode(second) });
  }
  if ((PANELS as string[]).includes(first) && first !== 'runs') {
    return route({ panel: first as Panel });
  }
  if (second === 'new') return route({ panel: 'runs', showLaunch: true });
  if (second) return route({ panel: 'runs', runId: safeDecode(second) });
  return route({ panel: 'runs' });
}

/** `replace` swaps the current history entry — used by redirects so Back never re-enters them. */
export type Navigate = (path: string, opts?: { replace?: boolean }) => void;

export function useRoute(): Route & {
  navigate: Navigate;
  panelPath: (p: Panel) => string;
  /** The current URL search string, e.g. `"?v=2"`. Slice 9 uses `?v=N` to
   *  address document versions; both pathname AND search update on navigate so
   *  components reading either field re-render on every navigation. */
  search: string;
  /** The current pathname — the rail's route→heading map (DES-FEEDBACK-003
   *  §3.2) reads it to derive which primary path owns the route. */
  pathname: string;
} {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [search, setSearch] = useState(() => window.location.search);

  useEffect(() => {
    const handler = (): void => {
      setPathname(window.location.pathname);
      setSearch(window.location.search);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const navigate = useCallback<Navigate>((path, opts) => {
    if (opts?.replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    // Parse pathname-only for the panel/mode router (a hash like `#gate` must
    // not ride into the artifact id), but also capture the search string so
    // components keyed on ?v=N re-render on version selection (slice 9).
    const url = new URL(path, window.location.origin);
    setPathname(url.pathname);
    setSearch(url.search);
  }, []);

  const panelPath = useCallback((p: Panel) => (p === 'home' ? '/' : `/${p}`), []);

  return { ...parse(pathname), navigate, panelPath, search, pathname };
}
