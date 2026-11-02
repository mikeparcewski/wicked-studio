import { useEffect, useRef, useState } from 'react';
import { isMemoryUnsupported, memoryCoverage } from '../api/memory.js';
import { proposalKind } from '../api/proposals.js';
import { HOME_FRESH_MS, useNeedsSources } from '../store/needsSources.js';
import type { MemoryReading } from '../board/deskModel.js';

/**
 * How much memory the workspace holds (`GET /memory/coverage`, all scopes), for the Desk's setup items
 * (operator 2026-10-17: "if user just installed it's not unreachable, just may not have data"). Read once
 * when the Desk opens: `ok` with the total, `down` with the daemon's reason when the read fails, and
 * `unknown` for a daemon without the route (never read as empty).
 */
export function useMemoryReading(enabled: boolean, refreshKey: unknown = null): MemoryReading {
  const [reading, setReading] = useState<MemoryReading>({ state: 'unknown' });
  // codex r2: read again when the operator comes back (the window regains focus) or the caller's key
  // changes (the Desk returns to Work), so an item for memory that has since been built goes away.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const again = (): void => { if (document.visibilityState !== 'hidden') setTick((n) => n + 1); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, [enabled]);
  // The tick the side reads last ran at: a newer one is the operator coming back, and reads them again whatever their
  // age (codex + agy on 9d). A key change (moving inside studio) keeps the queue's 30 s window, so walking Home ->
  // a run -> Work -> Home re-reads nothing (needs_shell).
  const readTick = useRef(0);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const maxAge = tick !== readTick.current ? 0 : HOME_FRESH_MS;
    readTick.current = tick;
    // With the coverage: the memory proposals waiting (the Memory page's own count) and the repositories estate has a
    // code graph for, so the Desk says what is actually missing. A side read that fails is left out (never "none").
    // Both are the Home queue's own inputs: read through its store (one in-flight read per wire, fresh for 30 s), so a
    // cold Home reads each once (needs_shell). Each settles to a count or undefined, whatever it answers, and never
    // rejects unobserved when the coverage read fails first (CI r9b).
    // A count only from a read that ANSWERED: the store keeps its last value through a failure (and makes a 404 an empty
    // list for the queue), so its own outcome decides; a failed, absent or malformed read is left out (codex + agy on 9d).
    const sources = useNeedsSources.getState();
    const answered = (source: 'proposals' | 'repos'): boolean => useNeedsSources.getState().readOk[source] === true;
    const pending = sources.loadProposals(maxAge)
      .then(() => (answered('proposals') ? useNeedsSources.getState().proposals : null))
      .then((ps) => (Array.isArray(ps) ? ps.filter((p) => proposalKind(p) === 'memory').length : undefined))
      .catch(() => undefined);
    const indexed = sources.loadRepos(maxAge)
      .then(() => (answered('repos') ? useNeedsSources.getState().repos : null))
      .then((repos) => (Array.isArray(repos)
        ? repos.filter((x) => typeof (x as { code_graph_db?: unknown }).code_graph_db === 'string' && (x as { code_graph_db: string }).code_graph_db !== '').length
        : undefined))
      .catch(() => undefined);
    memoryCoverage().then(
      // A coverage answer without a total says nothing about emptiness.
      async (c) => {
        if (!(typeof c.total === 'number' && Number.isFinite(c.total))) { if (live) setReading({ state: 'unknown' }); return; }
        const [p, r] = await Promise.all([pending, indexed]);
        if (live) setReading({ state: 'ok', total: c.total, ...(p !== undefined ? { pending: p } : {}), ...(r !== undefined ? { indexedRepos: r } : {}) });
      },
      (e: unknown) => {
        if (!live) return;
        setReading(isMemoryUnsupported(e) ? { state: 'unknown' } : { state: 'down', reason: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => { live = false; };
  }, [enabled, refreshKey, tick]);
  return reading;
}
