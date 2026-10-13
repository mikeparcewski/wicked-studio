/**
 * ONE NAME PER PAGE (studio#725, reel UX gate): the rail, the ⌘K "Go to" rows and each page's
 * own title read these words, so a link never lands on a page that calls itself something else
 * ("Configuration" opening "System"). `/system` is "General" (rail restructure 2026-10-13; it was
 * "Configuration", listed on the retired "General settings" overview). Pure.
 */
export const PAGE_NAMES = {
  home: 'Desk',
  agents: 'Agents',
  watch: 'Watchtower',
  skills: 'Skills',
  mcp: 'MCP',
  mcpInspect: 'MCP inspector',
  plugins: 'Plugins',
  steering: 'Steering',
  testing: 'Testing',
  evals: 'Evals',
  learn: 'Learn',
  health: 'Health',
  system: 'General',
  repos: 'Repositories',
  workflows: 'Workflows',
  theme: 'Theme',
} as const;

const BY_PATH: ReadonlyArray<[string, string]> = [
  ['/testing/evals', PAGE_NAMES.evals],
  ['/testing', PAGE_NAMES.testing],
  ['/watch', PAGE_NAMES.watch],
  ['/skills', PAGE_NAMES.skills],
  ['/mcp/inspect', PAGE_NAMES.mcpInspect],
  ['/mcp', PAGE_NAMES.mcp],
  ['/plugins', PAGE_NAMES.plugins],
  ['/rules', PAGE_NAMES.steering],
  ['/learn', PAGE_NAMES.learn],
  ['/health', PAGE_NAMES.health],
  ['/system', PAGE_NAMES.system],
  ['/repos', PAGE_NAMES.repos],
  ['/workflows', PAGE_NAMES.workflows],
  ['/theme', PAGE_NAMES.theme],
];

/** The page's one name for an address (its path; a query is ignored), or null when it has none here. */
export function pageNameFor(href: string): string | null {
  const path = href.split('?')[0] ?? href;
  if (path === '/') return PAGE_NAMES.home;
  const hit = BY_PATH.find(([p]) => path === p || path.startsWith(`${p}/`));
  return hit === undefined ? null : hit[1];
}
