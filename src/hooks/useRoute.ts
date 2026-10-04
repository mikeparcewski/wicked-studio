import { useCallback, useEffect, useState } from 'react';
import { isSteeringSection, isSteeringType, type SteeringSection } from '../api/steering.js';
import { isTestingSubPage } from '../api/testing.js';
import { everythingPath } from '../board/everythingModel.js';
import { announceNavigateAway, inAppEntryState, isInAppEntry, replacedEntryState } from './useHistoryState.js';

// `everything` is "See everything" (`/everything`, DES-STUDIO-REBUILD-001 §5.4, slice S15c): four
// tabs — Sessions, Everything made, Helpers, Handed over — selected by `?tab=`; the Sessions tab keeps
// `?filter=` (the old `/work` words) and takes `?project=` for one project's sessions. The list and
// dashboard addresses it replaced are MOVES onto it (`hooks/useMovedRoutes.ts`): `/projects`,
// `/chats`, `/work`, `/execute`, `/vibe`, `/demo`, the retired `/make`, the bare `/runs` listing and
// `/p/:id/chronicle` all parse to `everything` (so the page renders on the pre-redirect tick) and are
// replaced with the real address. `/p/:id` (the project dashboard) parses to `everything` scoped to
// the project while `useMovedRoutes` finds the project's newest session and replaces the address with
// it; a project with no session stays on its (empty) Sessions tab. The run page (`/runs/:id`) and the
// project shell (`/p/:id/:mode`) are NOT moved yet — see useMovedRoutes.ts for why and when.
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
// the RETIRED addresses (wiki/rules/policies, coverage/domain, the flat
// campaigns, the list pages that moved onto `/everything`) keep their redirects:
// those are moves with a known destination, not typos.
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
export type Panel = 'home' | 'runs' | 'run-events' | 'run-files' | 'workflows' | 'skills' | 'mcp' | 'steering' | 'testing' | 'repos' | 'system' | 'theme' | 'repo-detail' | 'project-detail' | 'session' | 'editors' | 'watch' | 'rules' | 'everything' | 'not-found';

/** Every panel, exhaustively (the compile-time check below fails when the union grows without it). */
export const ALL_PANELS = ['home', 'runs', 'run-events', 'run-files', 'workflows', 'skills', 'mcp', 'steering', 'testing', 'repos', 'system', 'theme', 'repo-detail', 'project-detail', 'session', 'editors', 'watch', 'rules', 'everything', 'not-found'] as const satisfies readonly Panel[];
type MissingPanel = Exclude<Panel, (typeof ALL_PANELS)[number]>;
export const PANELS_EXHAUSTIVE: MissingPanel extends never ? true : MissingPanel = true;

const PANELS: Panel[] = ['runs', 'workflows', 'skills', 'mcp', 'repos', 'system', 'theme', 'repo-detail', 'watch'];

/** The list and dashboard addresses that MOVED onto `/everything` (S15c) — see `useMovedRoutes`. */
export const MOVED_LISTS: ReadonlySet<string> = new Set(['projects', 'chats', 'work', 'execute', 'vibe', 'demo', 'make', 'runs']);

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
  /** Non-null on the legacy `/projects/:id` panel AND on every `/p/*` route. */
  projectId: string | null;
  /** Non-null only on `/p/:projectId/:mode` — the active mode of the project shell. */
  mode: Mode | null;
  /** What the mode has open: run id (Build), thread id (Chat), doc id, demo id. */
  artifactId: string | null;
  /** True on `/p/:projectId/campaigns` (nav-reorg): the project-scoped Campaigns surface,
   *  re-homed under the project shell (a campaign is a DAG workload, not a project — so it
   *  is a project-scoped VIEW, not a fifth Mode). Rides no mode segment; `renderCenter`
   *  selects the campaign surface off this flag. The unscoped cross-project sweep keeps its
   *  own top-level `/testing/campaigns` route. */
  campaignsView: boolean;
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
  campaignsView: false,
  campaignId: null,
  steeringSection: null,
  testingPage: null,
  ruleId: null,
};

function route(over: Partial<Route>): Route {
  return { ...INERT, ...over };
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * `/p/:projectId` — since S15c (DES-STUDIO-REBUILD-001 §4.1) a MOVE: `useMovedRoutes` replaces it
 * with the project's newest session (`/s/:id`), or with its Sessions tab on "See everything" when
 * nothing has been started in it. The project dashboard it addressed no longer renders.
 */
export function projectPath(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}`;
}

/** Where `/projects/:id` lands — the project management page (Edit + Archive/Restore). */
export function projectDetailPath(projectId: string): string {
  return `/projects/${encodeURIComponent(projectId)}`;
}

/** Build a project-shell path. The single spelling of `/p/:projectId/:mode[/:artifactId]`. */
export function modePath(projectId: string, mode: Mode, artifactId?: string | null): string {
  const base = `${projectPath(projectId)}/${mode}`;
  return artifactId ? `${base}/${encodeURIComponent(artifactId)}` : base;
}

/** Where the work chronicle lives since S15c: one project's sessions on "See everything" (§4.1
 *  "reshape"). Callers that linked `/p/:id/chronicle` land on the live address with no edit. */
export function chroniclePath(projectId: string): string {
  return everythingPath({ tab: 'sessions', project: projectId });
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
  // A caller may hand a full address (`/everything?tab=made`, a palette row's href): the query is
  // not the route's business — `search` is read separately — so it is dropped before the split.
  const [, first = '', second = '', third = '', fourth = ''] = pathname.split('?')[0]!.split('/');
  // `/` is the orchestrator board (DES-MERGE-001 §1.5, slice 5). The flat run list it
  // replaced keeps its own route, `/runs` — the power-user escape hatch, not a redirect.
  if (first === '') {
    return route({ panel: 'home' });
  }
  // The project+mode parse runs AHEAD of the panel parse (DES-MERGE-001 §1.5); the
  // `Panel` union below is untouched and still owns every side panel.
  if (first === 'p' && second) {
    // `/p/:projectId/chronicle` MOVED (S15c): the chronicle is the project's Sessions tab on "See
    // everything" — parsed to it so the tab renders on the pre-redirect tick; `useMovedRoutes`
    // replaces the address. A bare `/p/:projectId` (the project dashboard) parses the same way while
    // the hook finds the project's newest session; with none, the Sessions tab IS where it lands.
    if (third === 'chronicle' || third === '') {
      return route({ panel: 'everything', projectId: safeDecode(second) });
    }
    // `/p/:projectId/campaigns` (nav-reorg): the project-scoped Campaigns surface. Rides no
    // mode (mode stays null — the ModeSwitcher's four-verb vocabulary is untouched); the
    // flag selects the campaign surface, exactly the chronicle idiom. Never an artifact named
    // "campaigns".
    if (third === 'campaigns') {
      return route({ projectId: safeDecode(second), campaignsView: true });
    }
    const mode = asMode(third);
    // A segment that names no mode (`/p/:id/bogus`) is a dead address — not-found, never a silent
    // swap onto the project (usability review #4).
    if (mode === null) return route({ panel: 'not-found' });
    const raw = fourth ? safeDecode(fourth) : null;
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
  // "See everything" (S15c) and the addresses that MOVED onto it — `/projects`, `/chats`, `/work`,
  // `/execute`, `/vibe`, `/demo`, the twice-retired `/make` and the bare `/runs` listing — all parse
  // to the page so it renders on the pre-redirect tick; `useMovedRoutes` replaces the address with
  // the real one (carrying `?filter=` and the tab). Deeper spellings are dead addresses.
  if (first === 'everything') return second ? route({ panel: 'not-found' }) : route({ panel: 'everything' });
  if (MOVED_LISTS.has(first) && !second) return route({ panel: 'everything' });
  // `/s/:sessionId` (DES-STUDIO-REBUILD-001 §5.4, slice S6a): a session — a chat and the runs
  // launched from it, or one run (`run:<id>`). A real route under every skin (a route is not a skin
  // concern). The id rides in `artifactId`, never `runId`: no run-selected machinery fires here.
  // `/s/:id/a/:artifact` belongs to S8; until then any deeper address is a dead one.
  // EP-P1: the editor plugin host's dev route and its conformance host page (no nav entry: no user
  // surface until EP-P2 places the first plugin).
  if (first === 'editors' && (second === 'dev' || second === 'conformance') && !third) {
    return route({ panel: 'editors', artifactId: second });
  }
  if (first === 's' && second) {
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
  // `/runs[...]` — the run detail / launch form. ONLY `/runs` reaches these arms: a garbage
  // top-level address is a dead address, not a run list. (The bare listing moved onto
  // "See everything" above.)
  if (first === 'runs') {
    if (second === 'new') return route({ panel: 'runs', showLaunch: true });
    if (second && third === 'events') return route({ panel: 'run-events', artifactId: safeDecode(second) });
    if (second && third === 'files') return route({ panel: 'run-files', artifactId: safeDecode(second) });
    if (second) return route({ panel: 'runs', runId: safeDecode(second) });
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
