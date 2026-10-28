/**
 * Where a move made inside the steering table editor (`?view=table`) goes (DES-steer-eval §2.2).
 * The table's own filter moves (type chips, the MCP switch, the unused filter) are
 * `/steering/policies…` addresses: they keep `view=table` so the editor and its assistant stay
 * mounted (codex r1 #7). Every other address — another steering page, a run, a chat — is left as it
 * is: Steering is a page of its own (the ui-v2 nav regroup), so its addresses need no Desk wrapping.
 */
export function tableAddress(path: string): string {
  if (path.startsWith('/steering/policies')) {
    const t = new URL(path, 'http://studio.local');
    t.searchParams.set('view', 'table');
    return `${t.pathname}${t.search}`;
  }
  return path;
}
