/**
 * A workflow's name in plain words (studio#725). The daemon's catalog carries only keys, so every
 * surface that names a workflow to a person — the launch wizard, the Workflows page — says the key
 * sentence-cased, acronyms kept: "mcp-server" -> "MCP server", "domain-extraction" -> "Domain
 * extraction". The key itself stays on the wire, in URLs and in data attributes.
 */
const ACRONYMS = new Set(['mcp', 'qe', 'pr', 'api', 'ui', 'ux']);

export function workflowLabel(key: string): string {
  const words = key.split(/[-_\s]+/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const [first, ...rest] = words;
  if (first === undefined) return key;
  return [first[0]!.toUpperCase() + first.slice(1), ...rest].join(' ');
}
