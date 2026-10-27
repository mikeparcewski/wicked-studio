import type { Project, SessionView } from '../api/types.js';
import { sessionIdOf, sessionPath } from '../board/sessionModel.js';
import { humanTitle } from '../components/runIdentity.js';
import { everythingPath } from '../board/everythingModel.js';
import { projectDetailPath, projectRequirementsPath, runEventsPath, runFilesPath, type Route } from '../hooks/useRoute.js';
import { PAGE_NAMES } from '../board/pageNames.js';
import { SETTINGS_THEME_PATH } from '../board/settingsTabs.js';

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
  // The ui-v2 nav regroup: the Desk's old tabs as pages, and Build & settings.
  { id: 'needs', example: '/needs', is: (r) => r.panel === 'needs' },
  { id: 'jobs', example: '/jobs', is: (r) => r.panel === 'jobs' },
  { id: 'report', example: '/report', is: (r) => r.panel === 'report' },
  { id: 'understand', example: '/understand', is: (r) => r.panel === 'understand' },
  { id: 'build', example: '/build', is: (r) => r.panel === 'build' },
  { id: 'session', example: '/s/run:r1', is: (r) => r.panel === 'session' && r.artifactId !== null && r.artifactKey === null },
  // S16a-4a: a session with one artifact grown — reached from the artifact itself, never GO TO.
  { id: 'session-artifact', example: '/s/run:r1/a/r1%3Ap1%2Fd1', is: (r) => r.panel === 'session' && r.artifactKey !== null },
  { id: 'watch', example: '/watch', is: (r) => r.panel === 'watch' },
  { id: 'rules', example: '/rules', is: (r) => r.panel === 'rules' },
  // "See everything" (S15c/S17a): one page, five tabs in `?tab=` (a project's sessions ride
  // `?project=`). The retired addresses (`RETIRED_ADDRESSES` in hooks/useRoute.ts) are not shapes.
  { id: 'everything', example: '/everything', is: (r) => r.panel === 'everything' },
  { id: 'projects', example: '/projects', is: (r) => r.panel === 'projects' },
  { id: 'project-detail', example: '/projects/p1', is: (r) => r.panel === 'project-detail' && r.projectId !== null },
  { id: 'steering-proposals', example: '/steering/proposals', is: (r) => r.panel === 'steering' && r.steeringSection === 'proposals' },
  { id: 'steering-policies', example: '/steering/policies', is: (r) => r.panel === 'steering' && r.steeringSection === 'policies' },
  { id: 'memory', example: '/memory', is: (r) => r.panel === 'memory' },
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
  { id: 'project-requirements', example: '/projects/p1/requirements', is: (r) => r.panel === 'project-requirements' },
  // The retired Product page's address (operator 2026-10-12): it only redirects to a project dashboard.
  { id: 'product', example: '/product', is: (r) => r.panel === 'product' },
  { id: 'health', example: '/health', is: (r) => r.panel === 'health' },
  { id: 'mcp', example: '/mcp', is: (r) => r.panel === 'mcp' && r.artifactId === null },
  { id: 'mcp-inspect', example: '/mcp/inspect', is: (r) => r.panel === 'mcp' && r.artifactId === 'inspect' },
  { id: 'plugins', example: '/plugins', is: (r) => r.panel === 'plugins' },
  { id: 'agents', example: '/agents', is: (r) => r.panel === 'agents' },
  { id: 'learn', example: '/learn', is: (r) => r.panel === 'learn' },
  { id: 'system', example: '/system', is: (r) => r.panel === 'system' },
  { id: 'theme', example: '/theme', is: (r) => r.panel === 'theme' },
  { id: 'editors-dev', example: '/editors/dev', is: (r) => r.panel === 'editors' && r.artifactId === 'dev' },
  { id: 'editors-conformance', example: '/editors/conformance', is: (r) => r.panel === 'editors' && r.artifactId === 'conformance' },
];

/** The one shape that is not a destination: an address that matches nothing. */
export const NOT_A_DESTINATION = 'not-found';

/** The parameterless destinations, in the words the palette shows. */
const DESTINATIONS: ReadonlyArray<{ shape: string; label: string; href: string }> = [
  // The sidebar's pages, in its order (ui-v2 nav regroup), each named as the sidebar names it.
  { shape: 'home', label: `${PAGE_NAMES.home} — what needs you, what is running`, href: '/' },
  { shape: 'needs', label: `${PAGE_NAMES.needs} — what you need to decide`, href: '/needs' },
  { shape: 'projects', label: `${PAGE_NAMES.projects} — all your projects`, href: '/projects' },
  { shape: 'jobs', label: `${PAGE_NAMES.jobs} — every job, running and finished`, href: '/jobs' },
  { shape: 'report', label: `${PAGE_NAMES.report} — charts, spend and outcomes`, href: '/report' },
  { shape: 'understand', label: `${PAGE_NAMES.understand} — ask how your code fits together`, href: '/understand' },
  { shape: 'build', label: `${PAGE_NAMES.build} — skills, MCP, plugins, workflows and settings`, href: '/build' },
  { shape: 'watch', label: `${PAGE_NAMES.watch} — health of CLIs, runs, infra and governance, and the Watchtower feed`, href: '/watch' },
  { shape: 'agents', label: `${PAGE_NAMES.agents} — sign-in, safety checks and fixes`, href: '/agents' },
  { shape: 'rules', label: `${PAGE_NAMES.steering} — what agents are told`, href: '/rules' },
  { shape: 'everything', label: 'Everything — every session', href: everythingPath({ tab: 'sessions' }) },
  { shape: 'everything', label: 'Everything made — documents, pages, decks, videos', href: everythingPath({ tab: 'made' }) },
  { shape: 'everything', label: 'Handed over — pull requests and pushes', href: everythingPath({ tab: 'handed' }) },
  { shape: 'steering-proposals', label: `${PAGE_NAMES.steering} › Proposals — rules agents want, to review`, href: '/steering/proposals' },
  { shape: 'steering-policies', label: `${PAGE_NAMES.steering} › All rules — every rule and policy`, href: '/steering/policies' },
  { shape: 'memory', label: `${PAGE_NAMES.memory} — what agents remember`, href: '/memory' },
  { shape: 'memory', label: `${PAGE_NAMES.memory} › Proposals — memories agents want to keep, to review`, href: '/memory?view=proposals' },
  { shape: 'testing-evals', label: `${PAGE_NAMES.evals} — check steering rules against samples`, href: '/testing/evals' },
  { shape: 'repos', label: PAGE_NAMES.repos, href: '/repos' },
  { shape: 'repos-new', label: 'Register a repository', href: '/repos/new' },
  { shape: 'runs-new', label: 'Start a run', href: '/runs/new' },
  { shape: 'workflows', label: PAGE_NAMES.workflows, href: '/workflows' },
  { shape: 'skills', label: PAGE_NAMES.skills, href: '/skills' },
  { shape: 'mcp', label: `${PAGE_NAMES.mcp} — the tools helpers can call`, href: '/mcp' },
  { shape: 'mcp-inspect', label: `${PAGE_NAMES.mcpInspect} — test and debug an MCP server`, href: '/mcp/inspect' },
  { shape: 'plugins', label: `${PAGE_NAMES.plugins} — editor plugins, and making one`, href: '/plugins' },
  { shape: 'learn', label: 'Learn', href: '/learn' },
  { shape: 'system', label: `${PAGE_NAMES.system} — agents, notifications and the theme`, href: '/system' },
  // studio-settings-tabs: Theme is a tab of the Settings page (`/theme` only redirects there).
  { shape: 'system', label: `${PAGE_NAMES.theme} — light or dark, logo, site name`, href: SETTINGS_THEME_PATH },
  { shape: 'editors-dev', label: 'Editor test page — try an editor plugin', href: '/editors/dev' },
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
  /** Live chats this tab knows (each opens as its session, `/s/:id`). */
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
      { shape: 'everything', label: `${p.name} · documents`, href: everythingPath({ tab: 'made', kind: 'documents', project: p.id }) },
      { shape: 'everything', label: `${p.name} · demos`, href: everythingPath({ tab: 'made', kind: 'videos', project: p.id }) },
      { shape: 'everything', label: `${p.name} · sessions`, href: everythingPath({ tab: 'sessions', project: p.id }) },
      { shape: 'project-requirements', label: `${p.name} · requirements`, href: projectRequirementsPath(p.id) },
    );
  }
  for (const c of d.chats) out.push({ shape: 'session', label: `${c.title} · chat`, href: sessionPath(c.id) });
  for (const c of d.campaigns) {
    out.push({ shape: 'testing-campaign', label: `${c.label} · campaign`, href: `/testing/campaigns/${encodeURIComponent(c.id)}` });
  }
  return out.map((t, i) => (i < at ? t : { ...t, perItem: true as const }));
}

/**
 * The shapes the palette reaches through its OTHER groups (a repo row `/repo-detail/:id`) — so
 * "Go to" does not repeat them. A run row opens its session (S16a-2d) and a project row its
 * sessions on See everything, shapes GO TO already carries.
 */
export const REACHED_BY_OTHER_GROUPS: readonly string[] = ['repo-detail'];

/** Shapes with no ⌘K entry on purpose: `/editors/conformance` is the conformance host the CI harness
 *  drives (e2e/editor_conformance_test.py; operators reach editors from Plugins, X3), and the two
 *  redirect-only addresses (operator 2026-10-12): `/product` lands on a project dashboard and
 *  `/testing/campaigns` opens the launch wizard on the test-writing workflow; and `/health`, which lands
 *  on Nerve Center (`/watch`, DES-SYSTEM-VIEW) — its ⌘K entry says "health"; and `/theme`, which lands
 *  on the Settings page's Theme tab (its ⌘K row opens that tab). */
export const NOT_IN_PALETTE: readonly string[] = ['editors-conformance', 'product', 'testing-campaigns', 'health', 'theme'];
