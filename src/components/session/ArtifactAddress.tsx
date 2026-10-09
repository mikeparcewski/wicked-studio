import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { ArtifactSize } from '../../board/artifactMorph.js';
import { addressFor, artifactPath } from '../../board/artifactAddress.js';
import type { Navigate } from '../../hooks/useRoute.js';
import { setArtifactSize, topmostArtifact, useArtifactSizes, useMountedArtifacts } from '../../store/artifactSizes.js';

/**
 * S16a-4a (§5.4): the session's artifact address and the morph store kept in step.
 *  - The ADDRESS writes the store on arrival and on every Back/Forward: `/s/:id/a/:key?size=` grows
 *    that artifact (once it is on the page); `/s/:id` folds whatever is open back into the thread.
 *  - The MORPH writes the address: a grow pushes one history entry per step; a shrink from an entry
 *    studio pushed goes Back; a shrink from a first-entry deep link replaces — so Back and Esc always
 *    shrink exactly one step and never leave the app.
 * The store stays what the morph renders from.
 */
type Writer = (key: string, from: ArtifactSize, to: ArtifactSize) => void;

interface ArtifactAddressValue {
  write: Writer;
  /** The artifact the address names, and the version picked to look at (S16a-4b), if any. */
  routeKey: string | null;
  routeVersion: number | null;
  /** Look at a version (`v`), or back at the working one (`null`): a lens pushes one entry; a
   *  restore drops `v` in place. */
  pickVersion: (key: string, version: number | null, how: 'push' | 'replace') => void;
}

const ArtifactAddressContext = createContext<ArtifactAddressValue | null>(null);

/** The writer an ArtifactMorph calls after its store write (`null` outside a session page). */
export function useArtifactAddressWriter(): Writer | null {
  return useContext(ArtifactAddressContext)?.write ?? null;
}

/** The address as the artifact reads it (`null` outside a session page). */
export function useArtifactAddress(): ArtifactAddressValue | null {
  return useContext(ArtifactAddressContext);
}

const RANK: Record<ArtifactSize, number> = { inline: 0, pane: 1, full: 2 };

const GROW_MARK = 'wkArtifactGrow';

/** Mark the entry just pushed as an artifact grow (merged into its existing state). */
function markGrowEntry(): void {
  const cur = (window.history.state ?? {}) as Record<string, unknown>;
  window.history.replaceState({ ...cur, [GROW_MARK]: true }, '');
}

function isGrowEntry(): boolean {
  const cur = window.history.state as Record<string, unknown> | null;
  return cur !== null && typeof cur === 'object' && cur[GROW_MARK] === true;
}

export function ArtifactAddressProvider({ sessionId, routeKey, routeSize, routeVersion = null, navigate, children }: {
  sessionId: string;
  /** The key the address names (`/s/:id/a/:key`), or null on the session's own address. */
  routeKey: string | null;
  routeSize: 'pane' | 'full';
  /** S16a-4b: `?v=N` on the artifact's address. */
  routeVersion?: number | null;
  navigate: Navigate;
  children: React.ReactNode;
}): React.ReactElement {
  // A grow marks the entry it pushes (in the entry's own history state, so browser Back / Forward
  // keep it exact — codex r1): a shrink from a marked entry goes Back to the step below it; from any
  // other entry (a first-entry deep link, a version lens) it replaces in place.
  const write = useCallback<Writer>((key, from, to) => {
    if (RANK[to] > RANK[from]) {
      navigate(addressFor(sessionId, key, to));
      markGrowEntry();
      return;
    }
    if (isGrowEntry()) {
      window.history.back();
      return;
    }
    navigate(addressFor(sessionId, key, to), { replace: true });
  }, [sessionId, navigate]);

  // The address → the store: grow the named artifact once it is on the page; the session's own
  // address folds the open one back.
  const mounted = useMountedArtifacts((s) => (routeKey !== null ? (s.keys[routeKey] ?? 0) > 0 : false));
  useEffect(() => {
    if (routeKey === null) {
      // Every grown one folds back (codex r1: not only the topmost).
      for (let top = topmostArtifact(useArtifactSizes.getState()); top !== null; top = topmostArtifact(useArtifactSizes.getState())) {
        setArtifactSize(top, 'inline');
      }
      return;
    }
    if (!mounted) return;
    if (useArtifactSizes.getState().sizes[routeKey] !== routeSize) setArtifactSize(routeKey, routeSize);
  }, [routeKey, routeSize, mounted]);

  const pickVersion = useCallback((key: string, version: number | null, how: 'push' | 'replace') => {
    const to = artifactPath(sessionId, key, 'full', version);
    // A lens entry is not a grow: shrinking from it replaces (one step), Back returns to the head.
    if (how === 'push') navigate(to); else navigate(to, { replace: true });
  }, [sessionId, navigate]);
  const value = useMemo<ArtifactAddressValue>(() => ({ write, routeKey, routeVersion, pickVersion }), [write, routeKey, routeVersion, pickVersion]);
  return <ArtifactAddressContext.Provider value={value}>{children}</ArtifactAddressContext.Provider>;
}

/** Whether the address names an artifact this session does not hold (boundary 3: say so, grow nothing). */
export function useArtifactMissing(routeKey: string | null, ready: boolean): boolean {
  const mounted = useMountedArtifacts((s) => (routeKey !== null ? (s.keys[routeKey] ?? 0) > 0 : true));
  return ready && routeKey !== null && !mounted;
}
