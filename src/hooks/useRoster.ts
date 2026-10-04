import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { RosterSeat } from '../api/types.js';
import { getCachedRoster, setCachedRoster, subscribeRoster } from '../store/rosterCache.js';

/**
 * The roster, from the shared cache when any surface already read it; one `GET /roster` otherwise.
 * Follows later deposits too (Amendment 5, decision 5): when the sign-in panel's "check again"
 * re-reads the roster, every row built on this hook — the Desk's chore, the Helpers tab — clears
 * itself without a reload.
 */
export function useRoster(): RosterSeat[] | null {
  const [roster, setRoster] = useState<RosterSeat[] | null>(() => getCachedRoster());
  useEffect(() => subscribeRoster(setRoster), []);
  useEffect(() => {
    if (roster !== null) return;
    let cancelled = false;
    api.getRoster()
      .then(({ roster: r }) => { setCachedRoster(r); if (!cancelled) setRoster(r); })
      .catch(() => { /* no roster, no chore and no refusal — never a guessed one */ });
    return () => { cancelled = true; };
  }, [roster]);
  return roster;
}
