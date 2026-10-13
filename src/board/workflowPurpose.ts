/**
 * A workflow's one-line purpose for the New job cards (operator 2026-10-12: "each card has a small
 * illustration plus its name and its one-line purpose"). The daemon's catalog carries no description
 * (a def is an id and its phases), so the built-in workflows are said here as the job they do — the
 * same kind of copy `workflowLabel` keeps for names. A workflow studio does not know (a custom def,
 * a preset) keeps the line the catalog gives it: its phases or steps. Each line fits two lines of a
 * card at 4 across (about 45 characters); a longer one is clamped, its whole text in the tooltip.
 */
const PURPOSE: Readonly<Record<string, string>> = {
  bug: 'Reproduce a bug, fix it and prove the fix',
  feature: 'Design, build, test and review a new feature',
  migration: 'Move code to a new version or platform',
  'mcp-server': 'Build an MCP server that gives agents a tool',
  'domain-extraction': 'Map a codebase’s business domain',
  'editor-plugin': 'Build and install a document editor plugin',
  learn: 'Research a topic and write a walkthrough',
  'qe-author-tests': 'Find the gaps in your tests and fill them',
};

/** The purpose line for a workflow key, or `fallback` (the catalog's own line) for one studio does not know. */
export function workflowPurpose(key: string, fallback: string): string {
  // Own keys only (codex r1): a workflow named `constructor` is not Object's.
  return Object.prototype.hasOwnProperty.call(PURPOSE, key) ? PURPOSE[key]! : fallback;
}
