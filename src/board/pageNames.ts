/**
 * ONE NAME PER PAGE (studio#725, reel UX gate): the rail, the /settings overview, the ⌘K "Go to"
 * rows and each page's own title read these words, so a link never lands on a page that calls
 * itself something else ("Configuration" opening "System"). Pure.
 */
export const PAGE_NAMES = {
  home: 'Desk',
  watch: 'Watchtower',
  product: 'Product',
  skills: 'Skills',
  mcp: 'MCP tools',
  steering: 'Steering',
  testing: 'Testing',
  evals: 'Evals',
  learn: 'Learn',
  health: 'Health',
  settings: 'Additional settings',
  system: 'Configuration',
  repos: 'Repositories',
  workflows: 'Workflows',
  theme: 'Theme',
} as const;

const BY_PATH: ReadonlyArray<[string, string]> = [
  ['/testing/evals', PAGE_NAMES.evals],
  ['/testing', PAGE_NAMES.testing],
  ['/watch', PAGE_NAMES.watch],
  ['/product', PAGE_NAMES.product],
  ['/skills', PAGE_NAMES.skills],
  ['/mcp', PAGE_NAMES.mcp],
  ['/rules', PAGE_NAMES.steering],
  ['/learn', PAGE_NAMES.learn],
  ['/health', PAGE_NAMES.health],
  ['/settings', PAGE_NAMES.settings],
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
