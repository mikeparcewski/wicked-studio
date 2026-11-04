import type { AppDataPort, AppRows } from './appData.js';

/**
 * THE DASHBOARD PREVIEW'S DATA (K5; operator 2026-11-04 "dashboard should show real time information"): a card's
 * mini-preview is drawn from a SNAPSHOT of the app's last real render in this studio — the rows the app's own page
 * read when the person last had it open — never from reads of its own. So a preview costs a source nothing: the only
 * live reads on the dashboard are the cards' headline numbers (`liveTiles.ts`), which are what the card says is live.
 *
 * In memory only (this tab, until it reloads): rows from the person's sources are not written to disk. Kept per app
 * for ONE version (a newer version's render replaces it), at most 50 rows per query and 256 KB per app; a snapshot
 * of an older version than the card shows is not used (the preview then draws the app's shape with no rows, as K4).
 */

const ROWS_PER_QUERY = 50;
const BYTES_PER_APP = 256 * 1024;
const APPS_KEPT = 48;

interface Snapshot { version: number; at: number; bytes: number; results: Map<string, AppRows> }

const snaps = new Map<string, Snapshot>();

const keyOf = (query: string, params: Record<string, unknown>): string => `${query}\u0000${JSON.stringify(params, Object.keys(params).sort())}`;

/** The app's page read `query` with `params` on `version`: keep (a bounded copy of) what it showed. */
export function recordRender(slug: string, version: number, query: string, params: Record<string, unknown>, rows: AppRows): void {
  let s = snaps.get(slug);
  if (s === undefined || s.version !== version) {
    s = { version, at: Date.now(), bytes: 0, results: new Map() };
    snaps.delete(slug);
    snaps.set(slug, s);
    while (snaps.size > APPS_KEPT) snaps.delete(snaps.keys().next().value!);
  }
  const kept: AppRows = { ...rows, rows: rows.rows.slice(0, ROWS_PER_QUERY), truncated: rows.truncated || rows.rows.length > ROWS_PER_QUERY };
  const size = JSON.stringify(kept).length;
  const k = keyOf(query, params);
  const old = s.results.get(k);
  const next = s.bytes - (old === undefined ? 0 : JSON.stringify(old).length) + size;
  if (next > BYTES_PER_APP) return;
  s.results.set(k, kept);
  s.bytes = next;
  s.at = Date.now();
}

/** When the snapshot of `slug` at `version` was taken, or null when there is none. */
export function snapshotAt(slug: string, version: number): number | null {
  const s = snaps.get(slug);
  return s !== undefined && s.version === version && s.results.size > 0 ? s.at : null;
}

/** A read-only data port over the snapshot: rows the app's page showed, or "not seen" — never a request. */
export function snapshotPort(slug: string, version: number): AppDataPort {
  return {
    kind: { queries: 'crew', actions: 'crew' },
    query: async (v, query, params) => {
      const s = snaps.get(slug);
      const hit = s !== undefined && s.version === version && v === version ? s.results.get(keyOf(query, params)) : undefined;
      return hit !== undefined ? structuredClone(hit) : { error: 'unavailable', message: 'not in the last render' };
    },
    prepare: async () => ({ error: 'refused', message: 'a tile runs nothing' }),
    run: async () => ({ state: 'failed', reason: 'a tile runs nothing', sample: false }),
    viewer: () => ({ email: null, sample: false }),
  };
}

/** Wrap the app page's live data port so every answer it shows is kept for the dashboard's preview. */
export function recordingPort(slug: string, inner: AppDataPort): AppDataPort {
  return {
    ...inner,
    kind: inner.kind,
    query: async (version, query, params) => {
      const r = await inner.query(version, query, params);
      if (!('error' in r) && r.sample !== true) recordRender(slug, version, query, params, r);
      return r;
    },
    prepare: (version, action, params) => inner.prepare(version, action, params),
    run: (action, record) => inner.run(action, record),
    viewer: () => inner.viewer(),
  };
}

/** TESTS. */
export function resetSnapshots(): void { snaps.clear(); }
