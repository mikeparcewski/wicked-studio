/**
 * ONE NAME PER PAGE (studio#725, reel UX gate): the rail, the ⌘K "Go to" rows and each page's
 * own title read these words, so a link never lands on a page that calls itself something else
 * ("Configuration" opening "System"). The sidebar regroup (ui-v2, 2026-10-26): `/` is "Home", the
 * Desk's old tabs are pages of their own (Jobs, Report, Understand, Evaluate), and `/system` is
 * "Settings", the title its page has always had (its first tab is General). Pure.
 */
export const PAGE_NAMES = {
  home: 'Home',
  /** `/projects` — the projects list (WORK's primary entry). */
  projects: 'Projects',
  /** `/needs` — everything waiting on you, in full (the landing's "N more waiting"). */
  needs: 'Needs you',
  jobs: 'Jobs',
  report: 'Report',
  understand: 'Understand',
  build: 'Build & settings',
  agents: 'Agents',
  /** `/watch` — the system dashboard (DES-SYSTEM-VIEW); `/health` redirects there. */
  watch: 'Nerve Center',
  skills: 'Skills',
  mcp: 'MCP',
  mcpInspect: 'MCP inspector',
  plugins: 'Plugins',
  steering: 'Steering',
  memory: 'Memory',
  testing: 'Testing',
  evals: 'Evaluate',
  learn: 'Learn',
  system: 'Settings',
  repos: 'Repositories',
  workflows: 'Workflows',
  theme: 'Theme',
} as const;

const BY_PATH: ReadonlyArray<[string, string]> = [
  ['/needs', PAGE_NAMES.needs],
  ['/jobs', PAGE_NAMES.jobs],
  ['/report', PAGE_NAMES.report],
  ['/understand', PAGE_NAMES.understand],
  ['/build', PAGE_NAMES.build],
  ['/steering', PAGE_NAMES.steering],
  ['/testing/evals', PAGE_NAMES.evals],
  ['/testing', PAGE_NAMES.testing],
  ['/watch', PAGE_NAMES.watch],
  ['/skills', PAGE_NAMES.skills],
  ['/mcp/inspect', PAGE_NAMES.mcpInspect],
  ['/mcp', PAGE_NAMES.mcp],
  ['/plugins', PAGE_NAMES.plugins],
  ['/agents', PAGE_NAMES.agents],
  ['/rules', PAGE_NAMES.steering],
  ['/memory', PAGE_NAMES.memory],
  ['/learn', PAGE_NAMES.learn],
  ['/health', PAGE_NAMES.watch],
  ['/system', PAGE_NAMES.system],
  ['/repos', PAGE_NAMES.repos],
  ['/workflows', PAGE_NAMES.workflows],
  ['/theme', PAGE_NAMES.theme],
];

/** The page's one name for an address (its path; a query is ignored), or null when it has none here. */
export function pageNameFor(href: string): string | null {
  const path = href.split('?')[0] ?? href;
  if (path === '/') return PAGE_NAMES.home;
  // Only the list itself: a project's own page (`/projects/:id`) is named by its project.
  if (path === '/projects') return PAGE_NAMES.projects;
  const hit = BY_PATH.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit === undefined ? null : hit[1];
}
