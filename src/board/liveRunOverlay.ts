import type { SessionView } from '../api/types.js';

/**
 * A page's own run read, overlaid by App's live run list (studio#1161 on a repository's page, studio#940 on
 * Repositories): a live entry wins by id; a run only the read knows stays, so a list that has not heard of a
 * just-launched run yet never blanks it. Once the live list has shown a run id it is authoritative for that id
 * (absent from it = gone): `seen` keeps the ids it has ever shown, so a run the page's read still remembers is not
 * brought back after it is archived out of the live list. Newest first.
 */
export function overlayLiveRuns(read: readonly SessionView[], live: readonly SessionView[], seen: Set<string>): SessionView[] {
  const liveIds = new Set(live.map((v) => v.session.id));
  for (const id of liveIds) seen.add(id);
  return [...live, ...read.filter((v) => !liveIds.has(v.session.id) && !seen.has(v.session.id))]
    .sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0));
}
