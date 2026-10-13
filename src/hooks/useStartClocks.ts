import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { createdAtMs } from '../board/windowStats.js';
import { startedSecs, withStartClocks } from '../board/attention.js';

/**
 * A START TIME FOR RUNS THE RUN LIST LEAVES UNDATED. crew dates `session.created_at` only from a
 * run's `run.launched` audit entry, so runs launched before that entry existed (early onboarding
 * runs, CLI-driven runs) carry no `created_at` — yet each one's durable event log opens with
 * `sessionStarted`, whose `ts` (unix MILLIS) is when it really started. This reads that one event
 * (`GET /runs/:id/events?type=sessionStarted`) for exactly the undated, unarchived runs, once per
 * run per page load, and hands back the run list with `created_at` filled from it (unix SECONDS,
 * the wire's own unit). A run whose log cannot be read, or opens with no `sessionStarted`, stays
 * undated and is still counted as left out. Never a guess: no other clock stands in. The pure
 * halves (`startedSecs`, `withStartClocks`) are the attention model's (`board/attention.ts`).
 */

/** runId → start (unix SECONDS), or null once the log was read and holds none. Module-wide so a
 *  remount does not read again. */
const known = new Map<string, number | null>();
const reading = new Set<string>();
/** Every mounted hook: told when any read lands, so a Desk mounted mid-read still re-renders. */
const listeners = new Set<() => void>();

const READ_AT_ONCE = 4;

export function useStartClocks(runs: readonly SessionView[]): SessionView[] {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((n) => n + 1);
    listeners.add(bump);
    // A read that landed between this render and this subscription told no one here: catch up once.
    bump();
    return () => { listeners.delete(bump); };
  }, []);
  const undated = useMemo(
    () => runs.filter((v) => v.session.archived_at == null && createdAtMs(v) === null).map((v) => v.session.id),
    [runs],
  );
  useEffect(() => {
    const todo = undated.filter((id) => !known.has(id) && !reading.has(id));
    if (todo.length === 0) return;
    todo.forEach((id) => reading.add(id));
    const next = async (): Promise<void> => {
      for (let id = todo.shift(); id !== undefined; id = todo.shift()) {
        try {
          const page = await api.getRunEvents(id, ['sessionStarted']);
          known.set(id, startedSecs(page.events ?? []));
        } catch {
          known.set(id, null);
        } finally {
          reading.delete(id);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(READ_AT_ONCE, todo.length) }, next)).then(() => { for (const tell of listeners) tell(); });
  }, [undated]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the module map.
  return useMemo(() => withStartClocks(runs, known), [runs, version]);
}
