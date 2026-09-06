import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  isMemoryUnsupported,
  listMemories,
  memoryCoverage,
  MEMORY_UNSUPPORTED_COPY,
  retireMemory,
  type MemoryCoverage,
  type MemoryItem,
} from '../api/memory.js';
import { ProposalsSection } from './ProposalsSection.js';
import { KeyValueChips } from './ProposalChips.js';

/**
 * The Steering surface's MEMORIES sub-section (`/steering/memories`, DES-MEM-FACETED-001 unified
 * surface). One page that both MANAGES existing memories and REVIEWS memory proposals:
 *
 *  - the store BROWSER (`GET /memory`): every stored memory, with a text search that re-queries the
 *    wire and a client-side FACET filter (the facet key:value chips the loaded set carries). Each
 *    row shows content, tier, scope, and facets, with a RETIRE action.
 *  - RETIRE is honest about granularity: the wire erases a scope SUBTREE (`POST /memory/retire`
 *    with `scope_prefix`), so retiring a memory reaches everything filed at or under its scope — the
 *    confirm says so, and the note reports how many rows the server erased.
 *  - the MEMORY PROPOSALS section (ProposalsSection, below) reviews the agent-proposed memories
 *    awaiting a human approve/reject — the review half of this sub-section. It has its own adoption
 *    seam, so proposals still render even on a daemon whose memory-management wire is absent.
 *
 * Every write goes through crew's API (the governed operator path) — estate MCP stays read-only.
 */

export function MemoriesPanel(): React.ReactElement {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [coverage, setCoverage] = useState<MemoryCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  /** The applied recall query (drives the wire read); the input holds the in-flight text. */
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  /** The active facet filter (`key=value`) applied client-side over the loaded set, or null. */
  const [facet, setFacet] = useState<string | null>(null);
  /** The memory a retire confirm is open for, or null. */
  const [retiring, setRetiring] = useState<MemoryItem | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (q: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      const rows = await listMemories(q === '' ? {} : { query: q });
      setMemories(rows);
    } catch (e) {
      // Clear stale rows so the facet chips (derived from `memories`) don't linger on the
      // unsupported/error view — otherwise a prior successful load's chips render over the notice.
      setMemories([]);
      if (isMemoryUnsupported(e)) setUnsupported(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  useEffect(() => {
    // The coverage summary is a bonus header line — a daemon that cannot answer just omits it.
    void memoryCoverage()
      .then((c) => setCoverage(c))
      .catch(() => setCoverage(null));
  }, []);

  /** Every `key=value` facet pair the loaded set carries — the filter's chips. */
  const facetPairs = useMemo(() => {
    const seen = new Set<string>();
    for (const m of memories) {
      for (const [k, v] of Object.entries(m.facets)) seen.add(`${k}=${v}`);
    }
    return [...seen].sort();
  }, [memories]);

  const visible = useMemo(() => {
    if (facet === null) return memories;
    const [k, v] = facet.split(/=(.*)/s);
    return memories.filter((m) => m.facets[k ?? ''] === v);
  }, [memories, facet]);

  const applyQuery = (): void => {
    setFacet(null);
    setQuery(queryInput.trim());
  };

  const confirmRetire = (): void => {
    if (retiring === null) return;
    const target = retiring;
    setRetireBusy(true);
    setNote(null);
    void retireMemory({ scope_prefix: target.scope })
      .then(({ erased }) => {
        setRetiring(null);
        setNote(`Retired scope ${target.scope} — erased ${erased} memor${erased === 1 ? 'y' : 'ies'}.`);
        void load(query);
      })
      .catch((e: unknown) => {
        setNote(`Could not retire ${target.scope}: ${e instanceof Error ? e.message : String(e)}`);
      })
      .finally(() => setRetireBusy(false));
  };

  const coverageTotal = typeof coverage?.total === 'number' ? coverage.total : null;

  return (
    <div
      data-testid="memories-panel"
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6"
    >
      <div className="flex items-start gap-2">
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Steering · Memories</h2>
          <p className="mt-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            The agent memory store — browse and filter what has been remembered, retire a scope, and
            review the agent-proposed memories awaiting your approval below.
            {coverageTotal !== null && (
              <span data-testid="memories-coverage" className="ml-1 font-mono" style={{ color: 'var(--ink-dim)' }}>
                · {coverageTotal} in store
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          data-testid="memories-refresh"
          onClick={() => void load(query)}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Refresh
        </button>
      </div>

      {/* The store browser — search re-queries the wire; the facet chips narrow client-side. */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          data-testid="memories-search"
          type="text"
          value={queryInput}
          spellCheck={false}
          placeholder="Search memories (recall query)…"
          onChange={(e) => setQueryInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyQuery(); } }}
          className="min-w-[16rem] flex-1 rounded px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-1"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
        />
        <button
          type="button"
          data-testid="memories-search-go"
          onClick={applyQuery}
          className="rounded px-2 py-1 text-[11px] font-semibold focus:outline-none focus-visible:ring-1"
          style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
        >
          Search
        </button>
      </div>

      {facetPairs.length > 0 && (
        <div data-testid="memories-facet-filter" role="tablist" aria-label="Filter memories by facet" className="flex flex-wrap gap-1.5">
          <button
            type="button"
            role="tab"
            aria-selected={facet === null}
            data-testid="memories-facet-chip"
            data-facet="all"
            data-active={facet === null}
            onClick={() => setFacet(null)}
            className="rounded px-2 py-1 text-[10px] font-mono transition-colors"
            style={{
              background: facet === null ? 'var(--surface-raised)' : 'transparent',
              color: facet === null ? 'var(--ink-high)' : 'var(--ink-muted)',
              border: '1px solid var(--surface-raised)',
            }}
          >
            all
          </button>
          {facetPairs.map((pair) => {
            const active = facet === pair;
            return (
              <button
                key={pair}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid="memories-facet-chip"
                data-facet={pair}
                data-active={active}
                onClick={() => setFacet(active ? null : pair)}
                className="rounded px-2 py-1 text-[10px] font-mono transition-colors"
                style={{
                  background: active ? 'var(--surface-raised)' : 'transparent',
                  color: active ? 'var(--ink-high)' : 'var(--ink-muted)',
                  border: '1px solid var(--surface-raised)',
                }}
              >
                {pair}
              </button>
            );
          })}
        </div>
      )}

      {note !== null && (
        <p
          data-testid="memories-note"
          className="rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          {note}
        </p>
      )}

      {retiring !== null && (
        <div
          data-testid="memory-retire-confirm-banner"
          className="flex flex-col gap-2 rounded p-3"
          style={{ background: 'var(--status-fail-dim)', border: '1px solid var(--status-fail)' }}
        >
          <p className="text-[11px]" style={{ color: 'var(--ink-high)' }}>
            Retire the scope <span className="font-mono">{retiring.scope}</span>? Retire erases the whole
            SUBTREE — every memory filed at or under this scope — not just this one row. This cannot be undone.
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="memory-retire-confirm"
              disabled={retireBusy}
              onClick={confirmRetire}
              className="rounded px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
              style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail)' }}
            >
              {retireBusy ? 'Retiring…' : `Retire ${retiring.scope}`}
            </button>
            <button
              type="button"
              data-testid="memory-retire-cancel"
              onClick={() => setRetiring(null)}
              className="rounded px-2 py-1 text-[10px]"
              style={{ color: 'var(--ink-dim)', border: '1px solid var(--surface-raised)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p data-testid="memories-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading memories…</p>
      ) : unsupported ? (
        <p data-testid="memories-unsupported" className="rounded px-3 py-2 text-xs" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {MEMORY_UNSUPPORTED_COPY}
        </p>
      ) : error !== null ? (
        <p data-testid="memories-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {error}
        </p>
      ) : visible.length === 0 ? (
        <p data-testid="memories-empty" className="rounded px-3 py-2 text-xs" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {memories.length === 0 ? 'No memories in the store.' : 'No memories match this facet.'}
        </p>
      ) : (
        <ul data-testid="memories-list" className="flex flex-col gap-2">
          {visible.map((m) => (
            <li
              key={m.id}
              data-testid="memory-row"
              data-memory-id={m.id}
              className="flex flex-col gap-1.5 rounded p-3"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
            >
              <div className="flex items-start gap-2">
                <span data-testid="memory-content" className="min-w-0 flex-1 break-words text-[11px]" style={{ color: 'var(--ink-body)' }}>
                  {m.content}
                </span>
                <button
                  type="button"
                  data-testid="memory-retire"
                  onClick={() => setRetiring(m)}
                  title={`Retire the scope ${m.scope} (erases the whole subtree)`}
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold focus:outline-none focus-visible:ring-1"
                  style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
                >
                  Retire…
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span data-testid="memory-tier" className="rounded px-1.5 py-0.5 font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
                  {m.tier}
                </span>
                <span data-testid="memory-scope" className="font-mono" style={{ color: 'var(--ink-dim)' }}>
                  {m.scope}
                </span>
                <KeyValueChips testid="memory-facets" entries={m.facets} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* The REVIEW half of this sub-section — the agent-proposed memories. */}
      <ProposalsSection kind="memory" heading="Memory proposals" />
    </div>
  );
}
