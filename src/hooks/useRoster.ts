import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { RosterSeat } from '../api/types.js';
import { getCachedRoster, setCachedRoster, subscribeRoster } from '../store/rosterCache.js';

/**
 * The roster, from the shared cache when any surface already read it; one `GET /roster` otherwise.
 * Follows later deposits too (Amendment 5, decision 5): when the sign-in panel's "check again"
 * re-reads the roster, every row built on this hook — the Desk's chore, the Helpers tab — clears
 * itself without a reload. Every surface that reads the roster for display goes through here
 * (studio#311 R8); the imperative re-reads (sign-in "check again", Settings, the Ask's send) deposit
 * into the same cache and this hook follows them.
 */
export function useRoster(): RosterSeat[] | null {
  const [roster, setRoster] = useState<RosterSeat[] | null>(() => getCachedRoster());
  useEffect(() => subscribeRoster(setRoster), []);
  useEffect(() => {
    if (roster !== null) return;
    let cancelled = false;
    // `Promise.resolve().then` turns a host without the method (a test double, an older client) into
    // the same silent miss as a rejected read — never a thrown effect.
    Promise.resolve()
      .then(() => api.getRoster())
      // A read that lost the race (unmounted, or a fresher deposit already landed) deposits nothing:
      // it would overwrite the newer roster for every subscriber.
      .then(({ roster: r }) => { if (cancelled) return; setCachedRoster(r); setRoster(r); })
      .catch(() => { /* no roster, no chore and no refusal — never a guessed one */ });
    return () => { cancelled = true; };
  }, [roster]);
  return roster;
}
