import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { languageWords } from '../board/repoRows.js';

/**
 * A repository's language for the Repositories row (calm v2), read from its code map. `GET /repos`
 * carries no language, so each row with a built map asks `GET /repos/:id/graph` once per page load,
 * two at a time, after the list has drawn; the row shows its readiness alone until the answer lands
 * and stays that way if the read fails. Session-scoped: going back to the page asks nothing again.
 */
const known = new Map<string, string | null>();
const asked = new Set<string>();
const queue: string[] = [];
const listeners = new Set<() => void>();
let running = 0;
const PARALLEL = 2;

function pump(): void {
  while (running < PARALLEL && queue.length > 0) {
    const id = queue.shift()!;
    running += 1;
    // A read that throws before it starts (no daemon, a test double without it) is a failed read, never a crash.
    Promise.resolve().then(() => api.getRepoGraph(id))
      .then(({ graph }) => { known.set(id, languageWords(graph)); }, () => { known.set(id, null); })
      .finally(() => { running -= 1; listeners.forEach((l) => l()); pump(); });
  }
}

export function useRepoLanguages(ids: readonly string[]): ReadonlyMap<string, string | null> {
  const [, tick] = useState(0);
  const key = ids.join('\u0000');
  useEffect(() => {
    const on = (): void => tick((n) => n + 1);
    listeners.add(on);
    for (const id of ids) if (!asked.has(id)) { asked.add(id); queue.push(id); }
    pump();
    return () => { listeners.delete(on); };
    // `key` stands for `ids` (a new array each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return known;
}

/** Test seam: forget every answer. */
export function resetRepoLanguages(): void {
  known.clear(); asked.clear(); queue.length = 0; running = 0;
}
