import type { Project, SessionView } from '../api/types.js';
import { sessionIdOf, sessionPath } from '../board/sessionModel.js';
import { humanTitle } from '../components/runIdentity.js';
import { everythingPath } from '../board/everythingModel.js';
import { modePath, projectDetailPath, projectPath, runEventsPath, runFilesPath, type Route } from '../hooks/useRoute.js';

/**
 * EVERY ROUTE IN ⌘K (the skin contract, DES-STUDIO-REBUILD-001 §10 / §14 Q2: "every route is
 * reachable under every skin, by its nav or ⌘K"; COVERAGE.md finding 1, wave 5).
 *
 * {@link ROUTE_SHAPES} names each address shape the router serves, with an example and the
 * predicate its parse satisfies; `tests/paletteRoutes.test.ts` enumerates the router (every panel,
 * every sub-route) against it. {@link routeTargets} turns the shapes into the palette's "Go to"
 * rows: one row per parameterless destination, and per item the app already holds (projects,
 * runs, sessions, live chats, campaigns) for the parametric ones. Pure: no store, no fetch.
 */

export interface RouteShape {
  /** Stable id (the reel's coverage matrix names routes by these). */
  id: string;
  /** An address of this shape. */
  example: string;
  /** What its parse must say. */
  is: (r: Route) => boolean;
}

export const ROUTE_SHAPES: readonly RouteShape[] = [
  { id: 'home', example: '/', is: (r) => r.panel === 'home' },
  { id: 'session', example: '/s/run:r1', is: (r) => r.panel === 'session' && r.artifactId !== null && r.artifactKey === null },
  // S16a-4a: a session with one artifact grown — reached from the artifact itself, never GO TO.
  { id: 'session-artifact', example: '/s/run:r1/a/r1%3Ap1%2Fd1', is: (r) => r.panel === 'session' && r.artifactKey !== null },
  { id: 'watch', example: '/watch', is: (r) => r.panel === 'watch' },
  { id: 'rules', example: '/rules', is: (r) => r.panel === 'rules' },
  // "See everything" (S15c/S17a): one page, five tabs in `?tab=`; the list pages that moved onto it
  // (`/work`, `/chats`, `/projects`, `/execute`, `/vibe`, `/demo`, `/p/:id/chronicle`) are redirects
  // (hooks/useMovedRoutes.ts), not shapes — a redirect is not a destination.
  { id: 'everything', example: '/everything', is: (r) => r.panel === 'everything' && r.projectId === null },
  // S16a-4e: `/chat/:id`, `/chat/new` and the shell's `/p/:pid/chat[/…]` MOVED (a chat is its session; a
  // new one starts in the Desk composer) — redirects, not shapes.
  { id: 'project-detail', example: '/projects/p1', is: (r) => r.panel === 'project-detail' && r.projectId !== null },
  // `/p/:id` moves directly to the project's scoped Sessions tab (S17a).
  { id: 'project', example: '/p/p1', is: (r) => r.panel === 'everything' && r.projectId !== null },
  { id: 'p-build', example: '/p/p1/build', is: (r) => r.mode === 'build' && r.artifactId === null && !r.showLaunch },
  { id: 'p-build-new', example: '/p/p1/build/new', is: (r) => r.mode === 'build' && r.showLaunch },
  // S16a-2d: `/p/:pid/build/:run`, `/runs/:id` and `/runs/:id/timeline` are MOVES to the run's
  // session (hooks/useMovedRoutes.ts) — redirects, not shapes; they parse as `session`.
  // S16a-4c: `/p/:pid/document[/:doc]` and `/p/:pid/video[/:run]` MOVED (a made thing opens in its
  // session, or on the project's Made list) — redirects, not shapes.
  { id: 'p-campaigns', example: '/p/p1/campaigns', is: (r) => r.campaignsView },
  { id: 'steering-dashboard', example: '/steering/dashboard', is: (r) => r.panel === 'steering' && r.steeringSection === 'dashboard' },
  { id: 'steering-policies', example: '/steering/policies', is: (r) => r.panel === 'steering' && r.steeringSection === 'policies' },
  { id: 'steering-memories', example: '/steering/memories', is: (r) => r.panel === 'steering' && r.steeringSection === 'memories' },
  { id: 'testing-campaigns', example: '/testing/campaigns', is: (r) => r.panel === 'testing' && r.testingPage === 'campaigns' && r.campaignId === null },
  { id: 'testing-campaign', example: '/testing/campaigns/k1', is: (r) => r.panel === 'testing' && r.campaignId !== null },
  { id: 'testing-evals', example: '/testing/evals', is: (r) => r.panel === 'testing' && r.testingPage === 'evals' },
  { id: 'repos', example: '/repos', is: (r) => r.panel === 'repos' && !r.showRegisterRepo },
  { id: 'repos-new', example: '/repos/new', is: (r) => r.panel === 'repos' && r.showRegisterRepo },
  { id: 'repo-detail', example: '/repo-detail/x1', is: (r) => r.panel === 'repo-detail' && r.repoId !== null },
  { id: 'runs-new', example: '/runs/new', is: (r) => r.panel === 'runs' && r.showLaunch && !r.chatMode && r.projectId === null },
  { id: 'run-events', example: '/runs/r1/events', is: (r) => r.panel === 'run-events' },
  { id: 'run-files', example: '/runs/r1/files', is: (r) => r.panel === 'run-files' },
  { id: 'workflows', example: '/workflows', is: (r) => r.panel === 'workflows' },
  { id: 'skills', example: '/skills', is: (r) => r.panel === 'skills' },
  { id: 'mcp', example: '/mcp', is: (r) => r.panel === 'mcp' },
  { id: 'system', example: '/system', is: (r) => r.panel === 'system' },
  { id: 'theme', example: '/theme', is: (r) => r.panel === 'theme' },
  { id: 'editors-dev', example: '/editors/dev', is: (r) => r.panel === 'editors' && r.artifactId === 'dev' },
  { id: 'editors-conformance', example: '/editors/conformance', is: (r) => r.panel === 'editors' && r.artifactId === 'conformance' },
];

/** The one shape that is not a destination: an address that matches nothing. */
export const NOT_A_DESTINATION = 'not-found';

/** The parameterless destinations, in the words the palette shows. */
const DESTINATIONS: ReadonlyArray<{ shape: string; label: string; href: string }> = [
  { shape: 'home', label: 'Desk — home', href: '/' },
  { shape: 'watch', label: 'Watchtower — the full feed', href: '/watch' },
  { shape: 'rules', label: 'Steering — what helpers are told', href: '/rules' },
  { shape: 'everything', label: 'Everything — every session', href: everythingPath({ tab: 'sessions' }) },
  { shape: 'everything', label: 'Everything made — documents, pages, decks, videos', href: everythingPath({ tab: 'made' }) },
  { shape: 'everything', label: 'Helpers — the CLIs and their sign-in', href: everythingPath({ tab: 'helpers' }) },
  { shape: 'everything', label: 'Handed over — pull requests and pushes', href: everythingPath({ tab: 'handed' }) },
  { shape: 'everything', label: 'Projects — all your projects', href: everythingPath({ tab: 'projects' }) },
  { shape: 'home', label: 'Start a chat', href: '/chat/new' },
  { shape: 'steering-dashboard', label: 'Steering dashboard — proposals to review', href: '/steering/dashboard' },
  { shape: 'steering-policies', label: 'Steering — all rules and policies', href: '/steering/policies' },
  { shape: 'steering-memories', label: 'Steering — memories', href: '/steering/memories' },
  { shape: 'testing-campaigns', label: 'Testing campaigns', href: '/testing/campaigns' },
  { shape: 'testing-evals', label: 'Steering evals', href: '/testing/evals' },
  { shape: 'repos', label: 'Repositories', href: '/repos' },
  { shape: 'repos-new', label: 'Register a repository', href: '/repos/new' },
  { shape: 'runs-new', label: 'Start a run', href: '/runs/new' },
  { shape: 'workflows', label: 'Workflows', href: '/workflows' },
  { shape: 'skills', label: 'Skills', href: '/skills' },
  { shape: 'mcp', label: 'MCP tools', href: '/mcp' },
  { shape: 'system', label: 'Configuration — settings', href: '/system' },
  { shape: 'theme', label: 'Theme and appearance', href: '/theme' },
  { shape: 'editors-dev', label: 'Editor plugins (dev host)', href: '/editors/dev' },
  { shape: 'editors-conformance', label: 'Editor plugins (conformance)', href: '/editors/conformance' },
];

/** One "Go to" row. */
export interface RouteTarget {
  shape: string;
  label: string;
  href: string;
  /** A row for one held item (a run, a project, a chat, a campaign), not a fixed destination. */
  perItem?: true;
}

/** What the palette already holds (stores and props — never a fetch). */
export interface RouteTargetData {
  projects: readonly Pick<Project, 'id' | 'name'>[];
  runs: readonly SessionView[];
  /** Run → its project (the membership mirror). */
  projectIdByRun: Readonly<Record<string, string | undefined>>;
  /** Live chats this tab knows (`/chat/:id`). */
  chats: ReadonlyArray<{ id: string; title: string }>;
  campaigns: ReadonlyArray<{ id: string; label: string }>;
  /** `capabilities.runChatId`: a run's session is its chat's. */
  runChatId: boolean;
}

/** Every "Go to" row: the parameterless destinations, then per item for the parametric shapes. */
export function routeTargets(d: RouteTargetData): RouteTarget[] {
  const out: RouteTarget[] = [...DESTINATIONS];
  const at = out.length;
  const seenSessions = new Set<string>();
  for (const v of d.runs) {
    const id = v.session.id;
    const title = humanTitle(v.session.problem || id);
    const sid = sessionIdOf(v, d.runChatId);
    if (!seenSessions.has(sid)) {
      seenSessions.add(sid);
      out.push({ shape: 'session', label: `${title} · session`, href: sessionPath(sid) });
    }
    out.push({ shape: 'run-events', label: `${title} · raw events`, href: runEventsPath(id) });
    out.push({ shape: 'run-files', label: `${title} · files and diff`, href: runFilesPath(id) });
    // S16a-2c: no "· in its project" row — a run lives in its session, not inside its project.
  }
  for (const p of d.projects) {
    if (p.id === 'default') continue;
    out.push(
      { shape: 'project-detail', label: `${p.name} · details`, href: projectDetailPath(p.id) },
      { shape: 'p-build', label: `${p.name} · build`, href: modePath(p.id, 'build') },
      { shape: 'p-build-new', label: `${p.name} · start a build`, href: `${modePath(p.id, 'build')}/new` },
      { shape: 'everything', label: `${p.name} · documents`, href: everythingPath({ tab: 'made', kind: 'documents', project: p.id }) },
      { shape: 'everything', label: `${p.name} · demos`, href: everythingPath({ tab: 'made', kind: 'videos', project: p.id }) },
      { shape: 'project', label: `${p.name} · sessions`, href: everythingPath({ tab: 'sessions', project: p.id }) },
      { shape: 'p-campaigns', label: `${p.name} · campaigns`, href: `${projectPath(p.id)}/campaigns` },
    );
  }
  for (const c of d.chats) out.push({ shape: 'session', label: `${c.title} · chat`, href: sessionPath(c.id) });
  for (const c of d.campaigns) {
    out.push({ shape: 'testing-campaign', label: `${c.label} · campaign`, href: `/testing/campaigns/${encodeURIComponent(c.id)}` });
  }
  return out.map((t, i) => (i < at ? t : { ...t, perItem: true as const }));
}

/**
 * The shapes the palette reaches through its OTHER groups (a project row `/p/:id`, a repo row
 * `/repo-detail/:id`) — so "Go to" does not repeat them. A run row opens its session (S16a-2d), a
 * shape GO TO already carries.
 */
export const REACHED_BY_OTHER_GROUPS: readonly string[] = ['project', 'repo-detail'];
