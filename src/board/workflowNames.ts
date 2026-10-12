/**
 * A workflow's name in plain words (studio#725). The daemon's catalog carries only keys, so every
 * surface that names a workflow to a person — the launch wizard, the Workflows page — says the key
 * sentence-cased, acronyms kept: "mcp-server" -> "MCP server", "domain-extraction" -> "Domain
 * extraction". The key itself stays on the wire, in URLs and in data attributes.
 */
const ACRONYMS = new Set(['mcp', 'qe', 'pr', 'api', 'ui', 'ux']);
/** Keys whose sentence-cased form is not plain words: said as the job they do. */
const PLAIN: Readonly<Record<string, string>> = {
  // The retired Testing landing opens the wizard here (operator 2026-10-12): "QE author tests" read as an internal label.
  'qe-author-tests': 'Write tests',
};

export function workflowLabel(key: string): string {
  const plain = PLAIN[key];
  if (plain !== undefined) return plain;
  const words = key.split(/[-_\s]+/).filter(Boolean).map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const [first, ...rest] = words;
  if (first === undefined) return key;
  return [first[0]!.toUpperCase() + first.slice(1), ...rest].join(' ');
}
