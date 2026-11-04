import { entryOffered, topEntries, type CatalogEntry, type CatalogView } from './workflowCatalog.js';

/**
 * The `/` menu's "Start work" rows off New job's catalog view (slash-catalog; the rules are in
 * ./workflowCommand.ts's header). Pure.
 */

/** One "Start work" row: a catalog entry, under the group New job lists it in. */
export interface CatalogRow {
  entry: CatalogEntry;
  /** `top` ("Your top"), a category id, or `all` (an older daemon's one list). */
  group: string;
  groupTitle: string;
  /** What the row's `data-cmd` says: `workflow-<id>` for a workflow (the command typed by hand), else the card id. */
  cmd: string;
  /** A pick starts it: ready, with a launch studio knows (else it is shown as coming soon or not available). */
  offered: boolean;
}

/** New job's "Your top" header. */
export const TOP_GROUP = { id: 'top', title: 'Your top' } as const;
/** A `/workflow-<key>` typed whole: the workflow it names, ahead of the groups. */
export const MATCH_GROUP = { id: 'match', title: 'Best match' } as const;
/** An older daemon's one uncategorised list (New job's "All workflows"). */
export const ALL_GROUP = { id: 'all', title: 'All workflows' } as const;
const WORKFLOW_PREFIX = 'workflow-';

/** Whether an entry answers what is typed after `/` (one word: the menu's token stops at a space). A
 *  `workflow-…` query names a workflow by its id, the command typed by hand; any other matches a word of
 *  the title, or the card's or workflow's id, by prefix. */
export function entryMatches(e: CatalogEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  const run = e.launchKind === 'run';
  if (q.startsWith(WORKFLOW_PREFIX)) return run && e.launchId.toLowerCase().startsWith(q.slice(WORKFLOW_PREFIX.length));
  if (run && WORKFLOW_PREFIX.startsWith(q)) return true;
  const words = e.title.toLowerCase().split(/[^\p{L}\p{N}]+/u);
  return words.some((w) => w !== '' && w.startsWith(q)) || e.title.toLowerCase().startsWith(q)
    || e.id.toLowerCase().startsWith(q) || (run && e.launchId.toLowerCase().startsWith(q));
}

/**
 * The "Start work" rows for a query, in New job's order: "Your top" (what this operator starts most,
 * recency-weighted), then each category in the catalog's order with its entries in catalog order (an
 * older daemon: one list). An entry is listed once: one in "Your top" is not repeated under its
 * category. `only` keeps the entries a box can start (the launch form names a workflow).
 */
export function catalogRows(view: CatalogView | null, query: string, now: number, only?: (e: CatalogEntry) => boolean): CatalogRow[] {
  if (view === null) return [];
  // New job's order over the WHOLE catalog, then `only` (codex r1: a box that lists fewer kinds keeps
  // New job's "Your top", never promotes its own).
  const pool = view.entries;
  const row = (e: CatalogEntry, group: string, groupTitle: string): CatalogRow => ({
    entry: e, group, groupTitle, cmd: e.launchKind === 'run' ? `${WORKFLOW_PREFIX}${e.launchId}` : e.id,
    offered: entryOffered(e),
  });
  const rows: CatalogRow[] = [];
  const listed = new Set<string>();
  const add = (e: CatalogEntry, group: string, title: string): void => {
    if (listed.has(e.id)) return;
    listed.add(e.id);
    rows.push(row(e, group, title));
  };
  for (const e of topEntries(pool, now)) add(e, TOP_GROUP.id, TOP_GROUP.title);
  if (view.source === 'fallback') for (const e of pool) add(e, ALL_GROUP.id, ALL_GROUP.title);
  else for (const c of view.categories) for (const e of pool) if (e.category === c.id) add(e, c.id, c.title);
  const out = rows.filter((r) => (only === undefined || only(r.entry)) && entryMatches(r.entry, query));
  // `/workflow-<key>` typed whole names that workflow: it leads, so Enter starts it and not a longer id
  // that shares its start (codex r1).
  const q = query.trim().toLowerCase();
  const exact = q.startsWith(WORKFLOW_PREFIX) ? q.slice(WORKFLOW_PREFIX.length) : null;
  const at = exact === null ? -1 : out.findIndex((r) => r.entry.launchKind === 'run' && r.entry.launchId.toLowerCase() === exact);
  // Under its own header, so its category is not split in two (pi r2).
  if (at > 0) out.unshift({ ...out.splice(at, 1)[0]!, group: MATCH_GROUP.id, groupTitle: MATCH_GROUP.title });
  return out;
}

/** The catalog's workflow entries (the launch form names a workflow; it starts nothing else). */
export function workflowsOnly(e: CatalogEntry): boolean {
  return e.launchKind === 'run';
}

/** The workflow entry `/workflow-<key>` names (an offered one first), or null: back-compat for the
 *  command typed by hand. Only a workflow the catalog lists is named — studio never invents one. */
export function workflowEntry(view: CatalogView | null, key: string): CatalogEntry | null {
  if (view === null) return null;
  const all = view.entries.filter((e) => e.launchKind === 'run' && e.launchId === key);
  return all.find((e) => e.status === 'ready') ?? all[0] ?? null;
}

/** What the composer says when a row cannot start. */
export function notOfferedLine(e: Pick<CatalogEntry, 'title' | 'status' | 'statusNote'>): string {
  const why = e.statusNote !== null && !/^(coming soon|not available)\.?$/i.test(e.statusNote) ? ` ${e.statusNote}` : '';
  return `${e.title} is ${e.status === 'soon' ? 'coming soon' : 'not available now'}.${why}`;
}
