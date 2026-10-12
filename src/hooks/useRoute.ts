import { useCallback, useEffect, useState } from 'react';
import { isSteeringSection, isSteeringType, type SteeringSection } from '../api/steering.js';
import { isTestingSubPage } from '../api/testing.js';
import { announceNavigateAway, inAppEntryState, isInAppEntry, replacedEntryState } from './useHistoryState.js';

// `everything` is "See everything" (`/everything`, DES-STUDIO-REBUILD-001 §5.4, slices S15c/S17a): five
// tabs — Sessions, Everything made, Helpers, Handed over, Projects — selected by `?tab=`; the Sessions tab keeps
// `?filter=` and takes `?project=` for one project's sessions. X1 (operator ruling 2026-10-09: "we
// should just remove these"): the addresses that once MOVED onto it or onto a session — `/projects`,
// `/chats`, `/work`, `/execute`, `/vibe`, `/demo`, `/make`, the bare `/runs`, `/runs/:id[/timeline]`,
// every `/p/:id/…` project-shell address and `/chat/…` — no longer redirect: each is a dead address
// ({@link RETIRED_ADDRESSES}) and parses to `not-found`.
// `steering` is the unified governed-knowledge surface (`/steering/{policies,memories}`) — one
// home with two sub-sections, each carrying BOTH "manage existing" and "proposals (review)":
// Policies (the seven-type rule corpus — the seven pages collapsed into a `?type=` FILTER on one
// grid — plus policy proposals) and Memories (the memory store plus memory proposals). The panels
// it absorbed (`wiki`, `rules`, the old `policies` settings panel, and the standalone `proposals`
// review queue) are gone from this union; their old paths parse to `steering` and
// `useSteeringRedirect` normalizes them onto the right sub-section (`/steering/policies` by
// default, `/steering/memories` for `/proposals?type=memory`, `/steering/policies?type=<type>`
// for a legacy `/steering/:type`).
// `testing` is the Testing surface (`/testing/:page` — campaigns/evals; campaigns is
// the landing, and the retired `/testing/harness` redirects onto it);
// the flat campaign panels it absorbed (`campaigns`, `campaign-detail`) are gone
// from this union — their old paths parse to `testing` and `useTestingRedirect`
// rewrites the address onto `/testing/campaigns[...]`.
// The orphaned `coverage` and `domain` settings panels retired in the same wave:
// their paths parse to `system` and `useRetiredSettingsRedirect` rewrites the
// address onto `/system`.
// `not-found` is the honest dead-address state (usability review #4): an address
// that matches NO page renders a not-found view that PRESERVES the typed URL and
// offers the way out — it never silently normalizes onto a nearby default. Only
// the steering, settings and testing normalizers (wiki/policies/proposals,
// coverage/domain, the flat campaigns) still redirect.
// The standalone `proposals` review queue RETIRED into Steering (DES-MEM-FACETED-001, unified
// surface): policy proposals live under `/steering/policies`, memory proposals under
// `/steering/memories`. Its old `/proposals` address (and `?type=memory` deep link) fold into
// those sub-sections via `useSteeringRedirect`.
// `skills` is the Skills file manager (`/skills`, the skills keystone) — the catalog of the
// daemon's effective plugin root. A flat panel with no sub-routes: the one skill a deep link
// opens rides `?skill=<name>` in `search` (read via `readSkillDeepLink`), never a path segment.
// `watch` is the Watchtower (`/watch`, DES-STUDIO-REBUILD-001 §5.4, slice S14): TR's feed. Flat.
// `mcp` is the MCP tools page (`/mcp`, DES-MCP-TOOLS-001 §7): the registered servers, their tools and
// the policy matrix. Flat like `skills`: one server row a deep link opens rides `?server=<name>`.
// `run-events` / `run-files` (studio wave 1, "raw in one step"): a run's raw event JSON and its
// worktree files/diff as REAL routes — `/runs/:id/events`, `/runs/:id/files` — so the palette
// verb that opens them is one history entry and browser Back returns to where you were. The run
// id rides in `artifactId` (NOT `runId`: no run-selected machinery, no legacy shell redirect).
export type Panel = 'home' | 'runs' | 'run-events' | 'run-files' | 'workflows' | 'skills' | 'mcp' | 'steering' | 'testing' | 'repos' | 'system' | 'theme' | 'repo-detail' | 'project-detail' | 'session' | 'editors' | 'watch' | 'rules' | 'everything' | 'product' | 'project-requirements' | 'plugins' | 'learn' | 'health' | 'settings' | 'not-found';

/** Every panel, exhaustively (the compile-time check below fails when the union grows without it). */
export const ALL_PANELS = ['home', 'runs', 'run-events', 'run-files', 'workflows', 'skills', 'mcp', 'steering', 'testing', 'repos', 'system', 'theme', 'repo-detail', 'project-detail', 'session', 'editors', 'watch', 'rules', 'everything', 'product', 'project-requirements', 'plugins', 'learn', 'health', 'settings', 'not-found'] as const satisfies readonly Panel[];
type MissingPanel = Exclude<Panel, (typeof ALL_PANELS)[number]>;
export const PANELS_EXHAUSTIVE: MissingPanel extends never ? true : MissingPanel = true;

const PANELS: Panel[] = ['runs', 'workflows', 'skills', 'mcp', 'plugins', 'repos', 'system', 'theme', 'repo-detail', 'watch', 'learn', 'health', 'settings'];
/** studio#157's Product view retired (operator 2026-10-12): `/product[?project=<id>]` only redirects —
 *  to that project's dashboard (its Requirements section), or to the projects list. */
export function productRedirectPath(search: string): string {
  const projectId = new URLSearchParams(search).get('project');
  return projectId !== null && projectId !== '' && projectId !== 'default'
    ? `${projectDetailPath(projectId)}#requirements`
    : '/everything?tab=projects';
}

/** A project's requirements list (`/projects/:id/requirements`), the dashboard section's "See all". */
export function projectRequirementsPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/requirements`;
}

/**
 * X1: the RETIRED addresses — the S15c / S16a moves, removed by operator ruling (2026-10-09). Each
 * parses to `not-found`; `tests/notFoundRoute.test.tsx` pins the parse and `tests/linksResolve.test.ts`
 * fails when a link studio builds lands on any of them (or on any other dead address). One example
 * per shape (`:id` segments are filled with a sample id).
 */
export const RETIRED_ADDRESSES: readonly string[] = [
  '/projects', '/chats', '/work', '/execute', '/vibe', '/demo', '/make', '/runs',
  '/runs/:id', '/runs/:id/timeline',
  '/p/:id', '/p/:id/chronicle',
  '/p/:id/build', '/p/:id/build/new', '/p/:id/build/:id',
  '/p/:id/document', '/p/:id/document/:id', '/p/:id/video', '/p/:id/video/:id',
  '/p/:id/chat', '/p/:id/chat/:id', '/p/:id/campaigns',
  '/chat/new', '/chat/:id',
];

export interface Route {
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
  /** Non-null only on `/projects/:id` (the project management page). */
  projectId: string | null;
  /** The addressed thing: a session id (`/s/:id`), a run (`/runs/:id/events|files`), an editor. */
  artifactId: string | null;
  /** Non-null only on `/testing/campaigns/:id` (DES-CAMPAIGN-001 §3.5 / TH-14) — the campaign
   *  label. The legacy flat `/campaigns/:id` parses to the same route while `useTestingRedirect`
   *  rewrites the address. */
  campaignId: string | null;
  /** The steering sub-section on `/steering/{policies,memories}`. `null` while panel === 'steering'
   *  means an address that names no valid sub-section (bare `/steering`, a legacy `/steering/:type`,
   *  `/wiki`, `/policies`, the retired `/proposals`) — `useSteeringRedirect` replaces
   *  those with the right sub-section's real URL. The Policies type filter is NOT a route field:
   *  it rides `?type=` in `search`, read via `readSteeringTypeFilter`. */
  steeringSection: SteeringSection | null;
  /** The testing sub-page on `/testing/:page` (`campaigns` | `evals`). `null` while
   *  panel === 'testing' means an address that names no page (bare `/testing`, the retired
   *  `/testing/harness`) — `useTestingRedirect` replaces those with the Campaigns landing. */
  testingPage: string | null;
  /** Non-null only on `/rules/:ruleId` (DES-STUDIO-REBUILD-001 §5.4, slice S12): the rule the Rules
   *  page opens. Bare `/rules` parses with `panel: 'rules'` and `ruleId: null`. */
  ruleId: string | null;
  /** S16a-4a: on `/s/:sessionId/a/:artifactKey` — the grown artifact's key (the morph store's own,
   *  decoded); its size rides `?size=` (read with `board/artifactAddress.ts`). Null everywhere else. */
  artifactKey: string | null;
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
  artifactId: null,
  campaignId: null,
  steeringSection: null,
  testingPage: null,
  ruleId: null,
  artifactKey: null,
};

function route(over: Partial<Route>): Route {
  return { ...INERT, ...over };
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Where `/projects/:id` lands — the project management page (Edit + Archive/Restore). */
export function projectDetailPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/** A run's raw event JSON (`GET /runs/:id/events`) as a route — see `run-events`. */
export function runEventsPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/events`;
}

/** A run's worktree files / whole-run diff as a route — see `run-files`. */
export function runFilesPath(runId: string): string {
  return `/runs/${encodeURIComponent(runId)}/files`;
}

/**
 * Leave a routed view the way the operator arrived: browser Back when the current entry
 * was pushed by studio itself (so Back lands in studio), else `fallback` — a deep link
 * opened as the tab's first entry must never Back out of the app (wave 1 round 2).
 */
export function leaveRoute(navigate: Navigate, fallback = '/'): void {
  if (isInAppEntry()) window.history.back();
  else navigate(fallback);
}

function parse(pathname: string): Route {
  // A caller may hand a full address (`/everything?tab=made`, a palette row's href): the query is
  // not the route's business — `search` is read separately — so it is dropped before the split.
  const segs = pathname.split('?')[0]!.split('/');
  const [, first = '', second = '', third = '', fourth = ''] = segs;
  /** Nothing but empty segments from index `from` on — the whole address is the shape, not a prefix of it. */
  const restEmpty = (from: number): boolean => segs.slice(from).every((x) => x === '');
  // `/` is the Desk (DES-MERGE-001 §1.5, slice 5).
  if (first === '') {
    return route({ panel: 'home' });
  }
  // `/steering/{policies,memories}` — the unified governed-knowledge surface: one page per
  // sub-section, each managing existing items AND reviewing proposals. Bare `/steering` and a
  // LEGACY `/steering/:type` (a valid steering type — the seven pages collapsed into a `?type=`
  // filter on Policies) parse with `steeringSection: null` (they do NOT render directly);
  // `useSteeringRedirect` then replaces the address onto the canonical URL (bare →
  // `/steering/policies`, legacy type → `/steering/policies?type=<type>`). An address that names
  // neither a sub-section nor a valid type (a typo'd `/steering/foo`) is a dead address —
  // not-found, never a silent swap (usability review #4).
  if (first === 'steering') {
    if (!second) return route({ panel: 'steering', steeringSection: null });
    if (isSteeringSection(second)) return route({ panel: 'steering', steeringSection: second });
    return isSteeringType(second)
      ? route({ panel: 'steering', steeringSection: null })
      : route({ panel: 'not-found' });
  }
  // `/rules` and `/rules/:ruleId` — the Rules page (DES-STUDIO-REBUILD-001 §5.4, slice S12): the
  // address the old RuleManager held is a REAL route again, for every skin — DC's rule components
  // on one page frame; the steering grid stays reachable from it as "All rules".
  if (first === 'rules') {
    // `/rules/:ruleId/anything` names no page — not-found, never a silent swap onto the rule.
    if (third) return route({ panel: 'not-found' });
    return route({ panel: 'rules', ruleId: second ? safeDecode(second) : null });
  }
  // The RETIRED governance addresses: `/wiki` (the old Architecture Wiki page), `/policies` (the
  // old policies settings panel — merged into steering rules)
  // and `/proposals` (the standalone review queue — proposals now live inside the two
  // sub-sections) all fold into Steering — parsed here so a sub-section renders instantly,
  // redirected (replace) by `useSteeringRedirect` so bookmarks land on the surface's real URL
  // (`/proposals?type=memory` → Memories; everything else → Policies).
  if (first === 'wiki' || first === 'policies' || first === 'proposals') {
    return route({ panel: 'steering', steeringSection: null });
  }
  // The RETIRED `coverage`/`domain` settings panels (orphaned, context-free) fold into the
  // System settings page — parsed here so it renders instantly, redirected (replace) by
  // `useRetiredSettingsRedirect` so bookmarks land on `/system`.
  if (first === 'coverage' || first === 'domain') {
    return route({ panel: 'system' });
  }
  // `/testing/:page` — the Testing surface: one page component, parameterized by sub-page
  // (campaigns / evals), with `/testing/campaigns/:id` addressing one campaign's
  // scoreboard (DES-CAMPAIGN-001 §3.5 / TH-14, MOVED here from the flat `/campaigns/:id`).
  // A bare `/testing` — and the RETIRED `/testing/harness` (its creation verbs folded into
  // the Campaigns landing's header) — parse with `testingPage: null`; `useTestingRedirect`
  // replaces both with the Campaigns landing's real URL (a move, not a typo).
  if (first === 'testing') {
    if (second === 'campaigns' && third) {
      return route({ panel: 'testing', testingPage: 'campaigns', campaignId: safeDecode(third) });
    }
    // A typo'd sub-page (`/testing/harnes`) is a dead address: not-found, never a silent swap.
    if (!second || second === 'harness') return route({ panel: 'testing', testingPage: null });
    return isTestingSubPage(second)
      ? route({ panel: 'testing', testingPage: second })
      : route({ panel: 'not-found' });
  }
  // The RETIRED flat campaign addresses: `/campaigns` and `/campaigns/:id` fold into the
  // Testing surface — parsed here so the pages render instantly, redirected (replace) by
  // `useTestingRedirect` so bookmarks land on the surface's real URL.
  if (first === 'campaigns') {
    return route({
      panel: 'testing',
      testingPage: 'campaigns',
      campaignId: second ? safeDecode(second) : null,
    });
  }
  // "See everything" (S15c). Deeper spellings are dead addresses.
  if (first === 'everything') return restEmpty(2) ? route({ panel: 'everything' }) : route({ panel: 'not-found' });
  // `/s/:sessionId` (DES-STUDIO-REBUILD-001 §5.4, slice S6a): a session — a chat and the runs
  // launched from it, or one run (`run:<id>`). A real route under every skin (a route is not a skin
  // concern). The id rides in `artifactId`, never `runId`: no run-selected machinery fires here.
  // S16a-4a: `/s/:id/a/:artifactKey` is the session with that artifact grown (its size in `?size=`);
  // any other deeper address is a dead one.
  // EP-P1: the editor plugin host's dev route and its conformance host page (no nav entry: no user
  // surface until EP-P2 places the first plugin).
  if (first === 'editors' && (second === 'dev' || second === 'conformance') && !third) {
    return route({ panel: 'editors', artifactId: second });
  }
  if (first === 's' && second) {
    if (third === 'a' && fourth !== '' && restEmpty(5)) {
      return route({ panel: 'session', artifactId: safeDecode(second), artifactKey: safeDecode(fourth) });
    }
    return third ? route({ panel: 'not-found' }) : route({ panel: 'session', artifactId: safeDecode(second) });
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
  if (first === 'product') {
    return second === '' && restEmpty(2) ? route({ panel: 'product' }) : route({ panel: 'not-found' });
  }
  if (first === 'projects' && second && third === 'requirements' && restEmpty(4)) {
    return route({ panel: 'project-requirements', projectId: safeDecode(second) });
  }
  if (first === 'projects' && second) {
    return route({ panel: 'project-detail', projectId: safeDecode(second) });
  }
  if ((PANELS as string[]).includes(first) && first !== 'runs') {
    return route({ panel: first as Panel });
  }
  // `/runs/new` (the launch form) and a run's raw `/runs/:id/events|files`. Everything else under
  // `/runs` — the bare listing, `/runs/:id`, `/runs/:id/timeline` — is retired (X1): not-found.
  if (first === 'runs') {
    if (second === 'new') return route({ panel: 'runs', showLaunch: true });
    if (second && third === 'events') return route({ panel: 'run-events', artifactId: safeDecode(second) });
    if (second && third === 'files') return route({ panel: 'run-files', artifactId: safeDecode(second) });
    return route({ panel: 'not-found' });
  }
  return route({ panel: 'not-found' });
}

/** `replace` swaps the current history entry — used by redirects so Back never re-enters them. */
export type Navigate = (path: string, opts?: { replace?: boolean }) => void;

/** The pure address → route parse (tests and the palette's route coverage read it). */
export function parseRoute(pathname: string): Route {
  return parse(pathname);
}

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
    if (opts?.replace) history.replaceState(replacedEntryState(), '', path);
    else {
      // The LEAVING entry snapshots its view state first (useHistoryState), so Back restores it.
      announceNavigateAway();
      history.pushState(inAppEntryState(), '', path);
    }
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
