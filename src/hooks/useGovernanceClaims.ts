import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError, isRouteAbsent } from '../api/errors.js';
import type { GovernanceClaim } from '../api/types.js';

/** The gate-check record (`GET /governance/claims`), read once per mount. A 501 or an absent route
 *  is `unsupported` (an older crew), never zero checks. */
export type ClaimsState =
  | { kind: 'loading' }
  | { kind: 'loaded'; claims: GovernanceClaim[] }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string };

export function useGovernanceClaims(): ClaimsState {
  const [claims, setClaims] = useState<ClaimsState>({ kind: 'loading' });
  useEffect(() => {
    let cancelled = false;
    api
      .listClaims()
      .then(({ claims: all }) => { if (!cancelled) setClaims({ kind: 'loaded', claims: all }); })
      .catch((e: unknown) => {
        if (cancelled) return;
        if ((e instanceof ApiError && e.status === 501) || isRouteAbsent(e)) setClaims({ kind: 'unsupported' });
        else setClaims({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    return () => { cancelled = true; };
  }, []);
  return claims;
}
