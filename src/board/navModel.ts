import { mcpPath } from '../api/mcp.js';
import { skillsPath } from '../api/skills.js';
import { PAGE_NAMES } from './pageNames.js';

/**
 * THE SIDEBAR (ui-v2 nav regroup, operator 2026-10-26; mockup `desk-home-redesign`): the Desk's page
 * tabs (Work · Runs · Repositories · Report · More ▾) became three groups of pages in the rail, each
 * page at an address of its own:
 *
 *   WORK     Projects · Jobs · Repositories
 *   INSIGHT  Report · Understand · Evaluate
 *   GOVERN   Steering · Memory · Agents
 *
 * Home is the wordmark at the rail's top (operator 2026-10-27: "remove Home from WORK, the wordmark
 * goes Home"); Projects is WORK's first item and its primary one (`primary`, a calm marker).
 * and, at the rail's foot above the Nerve Center tile, ONE "Build & settings" entry: a page listing
 * Skills, MCP, Plugins, Workflows and Settings (the rail's old Workspace links). A project's page keeps
 * its own tabs (`/projects/:id?tab=`): they scope a view to the project, which the sidebar does not.
 * The old global Desk addresses (`/?tab=…[&at=…]`) only redirect (`legacyDeskTarget`). Pure.
 */

/** A Desk view: the global ones are pages (`DESK_VIEW_PATH`), a project's are its tabs. */
export type DeskView = 'work' | 'inbox' | 'runs' | 'repositories' | 'report' | 'understand' | 'steer' | 'memory' | 'agents' | 'evaluate';
/** The views whose page another component owns (App renders it; the Desk only hosts it on a project). */
export type HostedView = 'repositories' | 'steer' | 'memory' | 'agents' | 'evaluate';
export const HOSTED_VIEWS: readonly HostedView[] = ['repositories', 'steer', 'memory', 'agents', 'evaluate'];
export function isHostedView(v: DeskView): v is HostedView { return (HOSTED_VIEWS as readonly string[]).includes(v); }

/** Each global view's own address (a hosted page's home; its sub-pages are its own addresses). */
export const DESK_VIEW_PATH: Record<DeskView, string> = {
  work: '/', inbox: '/needs', runs: '/jobs', repositories: '/repos', report: '/report', understand: '/understand',
  steer: '/rules', memory: '/memory', agents: '/agents', evaluate: '/testing/evals',
};

/** The page that lists Skills, MCP, Plugins, Workflows and Settings. */
export const BUILD_PATH = '/build';

/** The projects page (for now the projects list; a designed Projects home follows its mockup). */
export const PROJECTS_PATH = '/projects';

export type NavId = 'home' | 'projects' | 'jobs' | 'repos' | 'report' | 'understand' | 'evaluate' | 'steering' | 'memory' | 'agents' | 'build';

export interface NavItem {
  id: NavId;
  label: string;
  path: string;
  testId: string;
  /** Address prefixes that make this item the current page (besides `path` itself). */
  under: readonly string[];
  /** The group's primary entry (Projects): drawn a little stronger, never louder than the current page. */
  primary?: true;
}

export interface NavGroup { id: 'work' | 'insight' | 'govern'; label: string; items: readonly NavItem[] }

export const NAV_GROUPS: readonly NavGroup[] = [
  { id: 'work', label: 'Work', items: [
    { id: 'projects', label: PAGE_NAMES.projects, path: PROJECTS_PATH, testId: 'nav-projects', under: [PROJECTS_PATH], primary: true },
    { id: 'jobs', label: PAGE_NAMES.jobs, path: DESK_VIEW_PATH.runs, testId: 'nav-jobs', under: ['/jobs'] },
    { id: 'repos', label: PAGE_NAMES.repos, path: DESK_VIEW_PATH.repositories, testId: 'nav-repos', under: ['/repos', '/repo-detail'] },
  ] },
  { id: 'insight', label: 'Insight', items: [
    { id: 'report', label: PAGE_NAMES.report, path: DESK_VIEW_PATH.report, testId: 'nav-report', under: ['/report'] },
    { id: 'understand', label: PAGE_NAMES.understand, path: DESK_VIEW_PATH.understand, testId: 'nav-understand', under: ['/understand'] },
    { id: 'evaluate', label: PAGE_NAMES.evals, path: DESK_VIEW_PATH.evaluate, testId: 'nav-evaluate', under: ['/testing'] },
  ] },
  { id: 'govern', label: 'Govern', items: [
    { id: 'steering', label: PAGE_NAMES.steering, path: DESK_VIEW_PATH.steer, testId: 'nav-steering', under: ['/rules', '/steering'] },
    { id: 'memory', label: PAGE_NAMES.memory, path: DESK_VIEW_PATH.memory, testId: 'nav-memory', under: ['/memory'] },
    { id: 'agents', label: PAGE_NAMES.agents, path: DESK_VIEW_PATH.agents, testId: 'nav-agents', under: ['/agents'] },
  ] },
];

/** Build & settings' links, in order: the rail's old Workspace group. */
export const BUILD_LINKS: readonly { id: string; label: string; path: string; testId: string; hint: string }[] = [
  { id: 'skills', label: PAGE_NAMES.skills, path: skillsPath(), testId: 'build-link-skills', hint: 'What your agents know how to do, and what they are given when they start' },
  { id: 'mcp', label: PAGE_NAMES.mcp, path: mcpPath(), testId: 'build-link-mcp', hint: 'The tools agents can call, and when they need your approval' },
  { id: 'plugins', label: PAGE_NAMES.plugins, path: '/plugins', testId: 'build-link-plugins', hint: 'Editor plugins, and making one' },
  { id: 'workflows', label: PAGE_NAMES.workflows, path: '/workflows', testId: 'build-link-workflows', hint: 'The steps a job goes through' },
  { id: 'settings', label: PAGE_NAMES.system, path: '/system', testId: 'build-link-settings', hint: 'Agents, notifications and the theme for this computer' },
];

export const BUILD_ITEM: NavItem = {
  id: 'build', label: PAGE_NAMES.build, path: BUILD_PATH, testId: 'desk-rail-build',
  under: [BUILD_PATH, ...BUILD_LINKS.map((l) => l.path), '/theme', '/editors'],
};

const within = (pathname: string, prefix: string): boolean => pathname === prefix || pathname.startsWith(`${prefix}/`);

/** The sidebar item the address is on (one at most), or null (a session, Nerve Center…). `home` is the
 *  wordmark: Home and Needs you in full. A project's own page is under Projects. */
export function navCurrent(pathname: string): NavId | null {
  if (pathname === '/' || within(pathname, '/needs')) return 'home';
  for (const item of [...NAV_GROUPS.flatMap((g) => g.items), BUILD_ITEM]) {
    if (item.under.some((p) => within(pathname, p))) return item.id;
  }
  return null;
}

/** An `at` an old Desk address carried, if it is a path on this site (never another origin). */
function localPath(at: string | null): string | null {
  if (at === null || !at.startsWith('/') || at.startsWith('//') || at.startsWith('/\\')) return null;
  return at;
}

const VIEWS = Object.keys(DESK_VIEW_PATH) as DeskView[];

/**
 * Where an old global Desk address lands, or null when the address names no tab (it is Home). A hosted
 * view lands on the page its `at` named (else that page's home); Jobs, Report and Understand keep the
 * rest of the query (`/?tab=report&focus=spend` → `/report?focus=spend`); an unknown tab is Home.
 */
export function legacyDeskTarget(search: string): string | null {
  const q = new URLSearchParams(search);
  const tab = q.get('tab');
  if (tab === null) return null;
  const view = VIEWS.find((v) => v === tab);
  if (view === undefined) return '/';
  if (isHostedView(view)) return localPath(q.get('at')) ?? DESK_VIEW_PATH[view];
  q.delete('tab');
  q.delete('at');
  const rest = q.toString();
  return `${DESK_VIEW_PATH[view]}${rest === '' ? '' : `?${rest}`}`;
}
