import { useEffect, useMemo, useState } from 'react';
import { isMemoryUnsupported, memoryCoverage } from '../api/memory.js';
import { proposalKind } from '../api/proposals.js';
import { HOME_FRESH_MS, useNeedsSources } from '../store/needsSources.js';
import type { MemoryReading } from '../board/deskModel.js';

// `forProposals`: the queue's proposals list as it stood when this total was read. A pending count is published only next
// to a total read at the same moment, so accepting proposals (which empties the list) never pairs a fresh zero with a
// total read before the memories were saved (codex r8 on 9d).
type Coverage = { state: 'ok'; total: number; forProposals: unknown } | { state: 'down'; reason: string } | { state: 'unknown' };

/**
 * How much memory the workspace holds (`GET /memory/coverage`, all scopes), for the Desk's setup items
 * (operator 2026-10-17: "if user just installed it's not unreachable, just may not have data"). Read once
 * when the Desk opens: `ok` with the total, `down` with the daemon's reason when the read fails, and
 * `unknown` for a daemon without the route (never read as empty).
 *
 * With the total, the memory proposals waiting and the repositories estate has a code graph for, so the Desk says
 * what is actually missing. Those two are the Home queue's own inputs (`GET /proposals`, `GET /repos`): they are READ
 * from its store, never fetched here, so a cold Home reads each once (needs_shell) and nothing here writes into the
 * queue. A count shows only while the queue's last read of that wire answered; a failed, absent or malformed read is
 * left out (never "none"). The total never waits for them.
 */
export function useMemoryReading(enabled: boolean, refreshKey: unknown = null): MemoryReading {
  const [coverage, setCoverage] = useState<Coverage>({ state: 'unknown' });
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
  const proposals = useNeedsSources((s) => (s.readOk.proposals === true ? s.proposals : null));
  const repos = useNeedsSources((s) => (s.readOk.repos === true ? s.repos : null));
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    const asOf = proposals;
    // Entering the Desk (or coming back to the window) also asks the Home queue to refresh its inputs under its own
    // 30 s rule, so the counts below follow; a quick walk inside studio re-reads nothing (needs_shell), and a cold Home
    // shares the queue's first read (codex + agy r4/r5 on 9d).
    void useNeedsSources.getState().load(HOME_FRESH_MS);
    memoryCoverage().then(
      // A coverage answer without a total says nothing about emptiness.
      (c) => {
        if (!live) return;
        setCoverage(typeof c.total === 'number' && Number.isFinite(c.total) ? { state: 'ok', total: c.total, forProposals: asOf } : { state: 'unknown' });
      },
      (e: unknown) => {
        if (!live) return;
        setCoverage(isMemoryUnsupported(e) ? { state: 'unknown' } : { state: 'down', reason: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => { live = false; };
    // The queue's proposals changed (read again, or some accepted): the total is read again with them.
  }, [enabled, refreshKey, tick, proposals]);
  return useMemo((): MemoryReading => {
    if (coverage.state !== 'ok') return coverage;
    const pending = coverage.forProposals === proposals ? countMemoryProposals(proposals) : undefined;
    const indexedRepos = countIndexedRepos(repos);
    return { state: 'ok', total: coverage.total, ...(pending !== undefined ? { pending } : {}), ...(indexedRepos !== undefined ? { indexedRepos } : {}) };
  }, [coverage, proposals, repos]);
}

/** The memory proposals in the queue's list, or undefined when there is no list or an entry cannot be read (codex r4
 *  on 9d: a partial proposal must leave the count out, never throw while rendering the Desk). */
function countMemoryProposals(proposals: unknown): number | undefined {
  if (!Array.isArray(proposals)) return undefined;
  try {
    return proposals.filter((p) => proposalKind(p as Parameters<typeof proposalKind>[0]) === 'memory').length;
  } catch {
    return undefined;
  }
}

/** The repositories with a code graph, or undefined when there is no list or an entry is not a repository: an
 *  unreadable list leaves the count out, never a short count (codex r5 on 9d). */
function countIndexedRepos(repos: unknown): number | undefined {
  if (!Array.isArray(repos) || !repos.every((x) => x !== null && typeof x === 'object')) return undefined;
  return repos.filter((x) => typeof (x as { code_graph_db?: unknown }).code_graph_db === 'string' && (x as { code_graph_db: string }).code_graph_db !== '').length;
}
