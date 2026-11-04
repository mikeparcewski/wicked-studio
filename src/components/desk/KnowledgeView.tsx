import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { getKnowledgeMap, type KnowledgeMapEdge, type KnowledgeMapNode, type KnowledgeMapResponse } from '../../api/knowledgeShapes.js';
import { readErrorKind } from '../../api/errors.js';
import { sourcesPath } from '../../api/sources.js';
import { ProposalsSection } from '../ProposalsSection.js';
import { EmptyState, Skeleton, StateBanner } from '../ui/index.js';

const KnowledgeGraph = lazy(() => import('./KnowledgeGraph.js').then((m) => ({ default: m.KnowledgeGraph })));

/** The typed relations listed in words (the drawn structure, `contains` and `derived_from`, is not). */
const LISTED = new Set(['describes', 'joins', 'governed_by', 'measures', 'tracked_in', 'addresses', 'closes']);

const KIND_WORDS: Record<KnowledgeMapNode['kind'], string> = {
  source: 'Data source',
  table: 'Table',
  shape: 'Data shape',
  code: 'Code',
  repo: 'Repository',
  knowledge: 'Knowledge',
};

type MapRead = { phase: 'loading' } | { phase: 'ok'; map: KnowledgeMapResponse } | { phase: 'failed'; kind: 'offline' | 'error'; message: string };

/** One typed edge in words: "support.tickets joins support.regions (a foreign key)". */
export function edgeWords(e: KnowledgeMapEdge, byKey: ReadonlyMap<string, KnowledgeMapNode>): string {
  const name = (k: string): string => {
    const n = byKey.get(k);
    if (n === undefined) return k;
    return n.kind === 'code' && n.repo !== undefined ? `${n.label} in ${n.repo}` : n.label;
  };
  const ev = e.evidence ?? {};
  const basis = ev['basis'] === 'fk' ? 'a foreign key' : ev['basis'] === 'name_type' ? 'matching name and type' : ev['basis'] === 'name' ? 'named alike' : null;
  // A join's conditions (`on`, api-types 0.186.0): each `columns = references`; any cut or left out is said.
  const on = Array.isArray(ev['on']) ? (ev['on'] as unknown[]).filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null) : [];
  const conds = on
    .map((c) => (Array.isArray(c['columns']) && Array.isArray(c['references']) && (c['columns'] as unknown[]).length > 0 ? `${(c['columns'] as unknown[]).join(', ')} = ${(c['references'] as unknown[]).join(', ')}${c['cut'] === true ? '…' : ''}` : null))
    .filter((c): c is string => c !== null);
  const more = typeof ev['more'] === 'number' && ev['more'] > 0 ? `, and ${ev['more']} more` : '';
  const cols = conds.length > 0 ? ` on ${conds.join('; ')}${more}` : '';
  return `${name(e.from)} ${e.rel.replace('_', ' ')} ${name(e.to)}${cols}${basis !== null ? ` (${basis})` : ''}`;
}

/**
 * UNDERSTAND → KNOWLEDGE (DES-KNOWLEDGE-DATA-001 §10.3, a third view beside the code and requirements graphs): what is
 * connected to what across the stores. On top, the data shapes waiting for review (crew's one proposal queue, kind
 * `knowledge`); below, the map crew reads from estate: the source catalogs and only the APPROVED shapes, with their
 * typed edges, drawn and also listed in words (the list is the whole map for a narrow screen or a screen reader).
 */
export function KnowledgeView(): React.ReactElement {
  const [read, setRead] = useState<MapRead>({ phase: 'loading' });
  const [selected, setSelected] = useState<KnowledgeMapNode | null>(null);
  const load = useCallback((): void => {
    setRead((cur) => (cur.phase === 'ok' ? cur : { phase: 'loading' }));
    getKnowledgeMap().then(
      (map) => setRead({ phase: 'ok', map }),
      (e: unknown) => setRead({ phase: 'failed', kind: readErrorKind(e), message: e instanceof Error ? e.message : String(e) }),
    );
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const map = read.phase === 'ok' ? read.map : null;
  const byKey = useMemo(() => new Map((map?.nodes ?? []).map((n) => [n.key, n])), [map]);
  const typed = useMemo(() => (map?.edges ?? []).filter((e) => LISTED.has(e.rel)), [map]);
  const shapes = useMemo(() => (map?.nodes ?? []).filter((n) => n.kind === 'shape'), [map]);

  return (
    <div className="wk-know" data-testid="knowledge-view">
      <p className="wk-ue-sentence">
        Your data sources, your repositories and the data shapes you approved, in one map. A shape says what a table is: what it joins, which code describes it, which rule governs it. Agents propose shapes; nothing is added until you approve it here.
      </p>

      <ProposalsSection kind="knowledge" heading="Data shapes to review" onDecision={load} />

      <section className="wk-know-map" aria-labelledby="wk-know-map-title" data-testid="knowledge-map">
        <div className="wk-gk-row">
          <h2 id="wk-know-map-title" className="wk-section-title">The map</h2>
          <button type="button" className="wk-btn wk-btn--quiet wk-btn--sm" data-testid="knowledge-map-refresh" onClick={load}>Refresh</button>
        </div>
        {read.phase === 'loading' && <Skeleton data-testid="knowledge-map-loading" variant="card" />}
        {read.phase === 'failed' && <StateBanner data-testid="knowledge-map-error" kind={read.kind} what="the knowledge map" error={read.message} onRetry={load} />}
        {map !== null && map.nodes.length === 0 && (
          <EmptyState
            data-testid="knowledge-map-empty"
            title="Nothing to map yet."
            body="Add a data source and test its connection, then profile it on its sheet. Its tables appear here, and its shapes once you approve them."
            action={<a className="wk-link" href={sourcesPath()} data-testid="knowledge-map-sources">Open Data sources</a>}
          />
        )}
        {map !== null && map.nodes.length > 0 && (
          <>
            <p className="wk-gk-muted" data-testid="knowledge-map-summary">
              {map.sources.length === 1 ? '1 data source' : `${map.sources.length} data sources`}
              {' · '}{map.nodes.filter((n) => n.kind === 'table').length} tables
              {' · '}{shapes.length === 1 ? '1 approved shape' : `${shapes.length} approved shapes`}
              {' · '}{typed.length === 1 ? '1 connection' : `${typed.length} connections`}
              {map.truncated && ' · the largest maps are cut to fit'}
            </p>
            <ul className="wk-know-legend" aria-label="What the map draws">
              <li data-kind="source"><span className="wk-know-swatch" data-kind="source" aria-hidden />Data source</li>
              <li data-kind="table"><span className="wk-know-swatch" data-kind="table" aria-hidden />Table</li>
              <li data-kind="shape"><span className="wk-know-swatch" data-kind="shape" aria-hidden />Data shape</li>
              <li data-kind="repo"><span className="wk-know-swatch" data-kind="repo" aria-hidden />Repository</li>
              <li data-kind="code"><span className="wk-know-swatch" data-kind="code" aria-hidden />Code</li>
              <li data-rel="joins"><span className="wk-know-line" data-rel="joins" aria-hidden />joins</li>
              <li data-rel="describes"><span className="wk-know-line" data-rel="describes" aria-hidden />describes</li>
              <li data-rel="governed_by"><span className="wk-know-line" data-rel="governed_by" aria-hidden />governed by</li>
            </ul>
            <div className="wk-know-body">
              <div className="wk-know-canvas" data-testid="knowledge-graph">
                <Suspense fallback={<Skeleton variant="card" />}>
                  <KnowledgeGraph nodes={map.nodes} edges={map.edges} onSelect={setSelected} />
                </Suspense>
              </div>
              <div className="wk-know-side">
                {selected !== null && (
                  <div className="wk-gk-card" data-testid="knowledge-selected">
                    <span className="wk-tag">{KIND_WORDS[selected.kind]}</span>
                    <p className="wk-gk-strong">{selected.label}</p>
                    {selected.source !== undefined && <p className="wk-gk-muted">In data source {selected.source}</p>}
                    {selected.repo !== undefined && <p className="wk-gk-muted">In repository {selected.repo}</p>}
                    {selected.summary !== undefined && <p className="wk-gk-content">{selected.summary}</p>}
                  </div>
                )}
                <h3 className="wk-know-subtitle">Connections</h3>
                {typed.length === 0 ? (
                  <p className="wk-gk-muted" data-testid="knowledge-connections-empty">No approved shape connects anything yet. Approve a data shape above, and what it joins and describes is drawn here.</p>
                ) : (
                  <ul className="wk-know-edges" data-testid="knowledge-connections">
                    {typed.map((e) => (
                      <li key={`${e.rel}:${e.from}:${e.to}:${e.owner ?? ''}`} data-rel={e.rel} data-testid="knowledge-connection">
                        <span className="wk-know-line" data-rel={e.rel} aria-hidden />
                        <span>{edgeWords(e, byKey)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {map.notes.map((n) => <p key={n} className="wk-gk-muted" data-testid="knowledge-map-note">{n}</p>)}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
