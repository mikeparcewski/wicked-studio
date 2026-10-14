import { deskTabPath } from '../desk/DeskV2.js';

/**
 * Where a move made inside the steering table editor (`?view=table`) goes (DES-steer-eval §2.2).
 * The table's own filter moves (type chips, the MCP switch, the unused filter) are
 * `/steering/policies…` addresses: they keep `view=table` so the editor and its assistant stay
 * mounted (codex r1 #7). Every steering address lands on the Desk's Steer tab directly (no
 * redirect hop); anything else (a run, a chat) is left as it is.
 */
export function tableAddress(path: string): string {
  if (path.startsWith('/steering/policies')) {
    const t = new URL(path, 'http://studio.local');
    t.searchParams.set('view', 'table');
    return deskTabPath('steer', `${t.pathname}${t.search}`);
  }
  if (path.startsWith('/steering') || path.startsWith('/rules')) return deskTabPath('steer', path);
  return path;
}
