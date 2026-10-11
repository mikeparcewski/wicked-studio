import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  isMemoryUnsupported, listMemories, memoryCoverage, retireMemory, retireMemoryItem,
  isEraseByIdUnsupported, type MemoryCoverage, type MemoryItem,
} from '../api/memory.js';
import { readErrorKind } from '../api/errors.js';
import { FacetAutocomplete } from './FacetAutocomplete.js';
import { KeyValueChips, shortContent } from './ProposalChips.js';
import { StateBanner, EmptyState, Skeleton, StatLine, Segmented, OverflowMenu, TechDetails } from './ui/index.js';

type Failure = { kind: 'offline' | 'error'; message: string };
function failure(e: unknown): Failure {
  return { kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e) };
}
function kindLabel(kind: string): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1).toLowerCase();
}

export function MemoriesPanel(): React.ReactElement {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [coverage, setCoverage] = useState<MemoryCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Failure | null>(null);
  const [coverageError, setCoverageError] = useState<Failure | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [query, setQuery] = useState('');
  const [queryInput, setQueryInput] = useState('');
  const [facet, setFacet] = useState<string | null>(null);
  const [kind, setKind] = useState('all');
  const [retiring, setRetiring] = useState<MemoryItem | null>(null);
  const [retireWidth, setRetireWidth] = useState<'item' | 'scope'>('item');
  const [retireCount, setRetireCount] = useState<number | null>(null);
  const [retireBusy, setRetireBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [retireError, setRetireError] = useState<Failure | null>(null);
  const [scopeError, setScopeError] = useState<Failure | null>(null);
  const [scopeGeneration, setScopeGeneration] = useState(0);
  const retiringScope = retireWidth === 'scope' ? (retiring?.scope ?? null) : null;

  useEffect(() => {
    if (retiringScope === null) return;
    let active = true;
    setScopeError(null);
    void memoryCoverage({ scope_prefix: retiringScope })
      .then(({ total }) => { if (active) setRetireCount(total ?? null); })
      .catch((e: unknown) => { if (active) { setRetireCount(null); setScopeError(failure(e)); } });
    return () => { active = false; };
  }, [retiringScope, scopeGeneration]);

  const loadGeneration = useRef(0);
  const load = useCallback(async (q: string): Promise<void> => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setError(null);
    setUnsupported(false);
    try {
      const rows = await listMemories(q === '' ? {} : { query: q });
      if (generation === loadGeneration.current) setMemories(rows);
    } catch (e) {
      if (generation === loadGeneration.current) {
        setMemories([]);
        if (isMemoryUnsupported(e)) setUnsupported(true);
        else setError(failure(e));
      }
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => { void load(query); }, [load, query]);

  const coverageGen = useRef(0);
  const loadCoverage = useCallback((): void => {
    const generation = ++coverageGen.current;
    setCoverage(null);
    setCoverageError(null);
    void memoryCoverage()
      .then((value) => { if (generation === coverageGen.current) setCoverage(value); })
      .catch((e: unknown) => {
        if (generation === coverageGen.current) {
          setCoverage(null);
          if (!isMemoryUnsupported(e)) setCoverageError(failure(e));
        }
      });
  }, []);
  useEffect(() => { loadCoverage(); }, [loadCoverage]);

  const facetPairs = useMemo(() => [...new Set(memories.flatMap((memory) => Object.entries(memory.facets).map(([key, value]) => `${key}=${value}`)))].sort(), [memories]);
  // The selected kind always stays an option, so the Kind control never loses its checked choice.
  const kinds = useMemo(() => [...new Set(['episodic', 'procedural', 'semantic', ...memories.map((memory) => memory.tier), ...(kind !== 'all' ? [kind] : [])])], [memories, kind]);
  const visible = useMemo(() => {
    const [key, value] = facet?.split(/=(.*)/s) ?? [];
    return memories.filter((memory) => (kind === 'all' || memory.tier === kind) && (facet === null || memory.facets[key ?? ''] === value));
  }, [memories, facet, kind]);
  const applyQuery = (): void => { setFacet(null); setQuery(queryInput.trim()); };
  const clearQuery = (): void => { setQueryInput(''); setFacet(null); setKind('all'); setQuery(''); };

  const confirmRetire = (): void => {
    if (retiring === null) return;
    const target = retiring;
    setRetireBusy(true);
    setNote(null);
    setRetireError(null);
    if (retireWidth === 'item') {
      void retireMemoryItem({ memory_id: target.id })
        .then(() => {
          setRetiring(null);
          setNote(`Retired: ${shortContent(target.content)}`);
          void load(query);
          loadCoverage();
        })
        .catch((e: unknown) => {
          if (isEraseByIdUnsupported(e)) setNote("Studio's service cannot retire a single memory yet. Nothing was deleted. You can retire everything in this scope using More actions.");
          else setRetireError(failure(e));
        })
        .finally(() => setRetireBusy(false));
      return;
    }
    void retireMemory({ scope_prefix: target.scope })
      .then(({ erased }) => {
        setRetiring(null);
        setRetireCount(null);
        setNote(`Retired everything in this scope: erased ${erased} memor${erased === 1 ? 'y' : 'ies'}.`);
        void load(query);
        loadCoverage();
      })
      .catch((e: unknown) => setRetireError(failure(e)))
      .finally(() => setRetireBusy(false));
  };

  const coverageTotal = typeof coverage?.total === 'number' ? coverage.total : null;
  const partial = query === '' && coverageTotal !== null && coverageTotal > memories.length;
  const countKnown = !loading && !unsupported && error === null && !partial;
  const listedCount = countKnown ? visible.length : null;
  const startRetire = (memory: MemoryItem, width: 'item' | 'scope'): void => {
    if (width === 'scope' && retiringScope !== memory.scope) setRetireCount(null);
    setRetireError(null);
    setScopeError(null);
    setRetireWidth(width);
    setRetiring(memory);
  };

  return (
    <div data-testid="memories-panel" className="wk-gk-page">
      <header className="wk-gk-stack">
        <div className="wk-gk-row">
          <h1 className="wk-page-title">Memories</h1>
          <button type="button" data-testid="memories-refresh" onClick={() => { void load(query); loadCoverage(); }} className="wk-btn wk-btn--quiet wk-btn--sm">Refresh</button>
        </div>
        <p className="wk-gk-muted">Browse what helpers remembered, search for a memory, or retire what is no longer useful.</p>
      </header>
      <div data-testid="memories-stats" className="wk-gk-stats">
        <div data-testid="mem-stat-total"><div data-testid="memories-coverage"><StatLine items={[{ label: listedCount === 1 ? 'memory' : 'memories', value: listedCount }]} showZero /></div></div>
        {Object.keys(coverage?.by_tier ?? {}).slice(0, 3).map((tier) => (
          <div key={tier} data-testid={`mem-stat-tier-${tier}`}><StatLine items={[{ label: kindLabel(tier).toLowerCase(), value: countKnown ? visible.filter((memory) => memory.tier === tier).length : null }]} /></div>
        ))}
        <div data-testid="mem-stat-facets"><StatLine items={[{ label: 'tags', value: countKnown ? new Set(visible.flatMap((memory) => Object.entries(memory.facets).map(([key, value]) => `${key}=${value}`))).size : null }]} /></div>
      </div>
      {coverageError !== null && <StateBanner kind={coverageError.kind} what="the memory summary" error={coverageError.message} onRetry={loadCoverage} />}
      <div className="wk-gk-search">
        <label className="wk-gk-field" htmlFor="memories-search">Search memories
          <input id="memories-search" data-testid="memories-search" type="text" value={queryInput} spellCheck={false} placeholder="Words to look for" onChange={(e) => setQueryInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyQuery(); } }} className="wk-field" />
        </label>
        <button type="button" data-testid="memories-search-go" onClick={applyQuery} className="wk-btn wk-btn--secondary">Search</button>
      </div>
      <div className="wk-gk-stack">
        <span className="wk-gk-muted">Kind</span>
        <Segmented label="Kind" value={kind} options={[{ value: 'all', label: 'All' }, ...kinds.map((value) => ({ value, label: kindLabel(value) }))]} onChange={setKind} />
      </div>
      {facetPairs.length > 0 && !loading && error === null && !unsupported && (
        <FacetAutocomplete testId="memories-facet-filter" options={facetPairs} value={facet} onChange={setFacet} label="Filter memories by tags" placeholder="Choose a tag" />
      )}
      {note !== null && <p data-testid="memories-note" role="status" className="wk-gk-note">{note}</p>}
      {retireError !== null && <StateBanner kind={retireError.kind} what="the retirement result" error={retireError.message} onRetry={confirmRetire} />}
      {retiring !== null && (
        <div data-testid="memory-retire-confirm-banner" className="wk-gk-card">
          {retireWidth === 'item' ? (
            <p className="wk-gk-content">Retire this memory? Only this memory is erased. Other memories in this scope stay. This cannot be undone.</p>
          ) : (
            <p className="wk-gk-content">Retire everything in this scope? {retireCount !== null ? `${retireCount} ${retireCount === 1 ? 'memory' : 'memories'} will be erased. ` : ''}Every memory in this scope and its child scopes will be erased. This cannot be undone.</p>
          )}
          <p className="wk-gk-content">{shortContent(retiring.content)}</p>
          <TechDetails text={[`memory_id: ${retiring.id}`, `scope: ${retiring.scope}`]} />
          {retireWidth === 'scope' && scopeError !== null && <StateBanner kind={scopeError.kind} what="the number of memories in this scope" error={scopeError.message} onRetry={() => setScopeGeneration((value) => value + 1)} />}
          <div className="wk-gk-row">
            <button type="button" data-testid="memory-retire-confirm" disabled={retireBusy} onClick={confirmRetire} className="wk-btn wk-btn--primary">{retireBusy ? 'Retiring…' : retireWidth === 'item' ? 'Retire this memory' : 'Retire everything in this scope'}</button>
            <button type="button" data-testid="memory-retire-cancel" onClick={() => { setRetiring(null); setRetireCount(null); setRetireError(null); }} className="wk-btn wk-btn--secondary">Cancel</button>
          </div>
        </div>
      )}
      {loading ? <Skeleton data-testid="memories-loading" variant="card" /> : unsupported ? (
        <EmptyState data-testid="memories-unsupported" title="Studio's service does not support memory management yet." />
      ) : error !== null ? (
        <StateBanner data-testid="memories-error" kind={error.kind} what="memories" error={error.message} onRetry={() => void load(query)} />
      ) : visible.length === 0 ? (
        <EmptyState data-testid="memories-empty" title={memories.length > 0 ? 'No memories match these filters.' : query !== '' && coverageTotal !== 0 ? `No memories match “${query}”.` : partial ? 'No memories are listed yet. Try a search.' : 'No memories listed yet.'} {...(query !== '' && coverageTotal !== 0 ? { action: <button type="button" onClick={clearQuery} className="wk-btn wk-btn--quiet wk-btn--sm">Clear search</button> } : {})} />
      ) : (
        <ul data-testid="memories-list" className="wk-gk-list">
          {visible.map((memory) => (
            <li key={memory.id} data-testid="memory-row" data-memory-id={memory.id} className="wk-gk-card">
              <div className="wk-gk-row wk-gk-row--top">
                <span data-testid="memory-content" className="wk-gk-content wk-gk-grow">{memory.content}</span>
                <div data-testid="memory-retire">
                  <OverflowMenu data-testid="memory-retire-one" label={`More actions for ${shortContent(memory.content)}`} items={[
                    { id: 'retire', label: 'Retire', danger: true, onSelect: () => startRetire(memory, 'item') },
                    { id: 'retire-scope', label: 'Retire everything in this scope…', onSelect: () => startRetire(memory, 'scope') },
                  ]} />
                </div>
              </div>
              <span data-testid="memory-tier" className="wk-tag">{kindLabel(memory.tier)}</span>
              <div data-testid="memory-scope"><KeyValueChips testid="memory-facets" entries={{ ...memory.facets, memory_id: memory.id, scope: memory.scope }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
