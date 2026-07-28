import { useState, useEffect, useMemo } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, CodeGraphNode, CodeGraphEdge, CodeGraphData, DomainGraph, DomainCoverage } from '../api/types.js';
import { CytoGraph } from './CytoGraph.js';
import { HotspotsView } from './HotspotsView.js';

interface Props {
  repo: RepoEntry;
  onClose: () => void;
  onSelectRun?: (runId: string) => void;
  /** Deep-link: open focused on this symbol (ego-slice + selected node). */
  initialFocus?: string | null;
}

type TabId = 'graph' | 'hotspots';
type GraphType = 'code' | 'domain';

// Wicked design tokens (matches tokens.css)
const T = {
  canvas:       '#0d1117',
  canvas2:      '#161c26',
  surface:      '#1b222e',
  surface2:     '#0f1419',
  ink:          '#e6edf3',
  muted:        'rgba(230,237,243,0.55)',
  faint:        'rgba(230,237,243,0.24)',
  hairline:     'rgba(230,237,243,0.07)',
  hairlineS:    'rgba(230,237,243,0.14)',
  accent:       '#ffda19',
  accentInk:    '#0d1117',
  link:         '#79c0ff',
  ok:           '#3fb950',
  deny:         '#f85149',
  // Blue modal
  blue:         '#1c4053',
  blue2:        '#182f3c',
  blueS:        '#224a5e',
  blueS2:       '#1a3b4e',
};

const KIND_COLORS: Record<string, string> = {
  function:    '#10b981',
  method:      '#10b981',
  constructor: '#10b981',
  class:       '#f97316',
  struct:      '#f97316',
  interface:   '#3b82f6',
  type_alias:  '#3b82f6',
  trait:       '#3b82f6',
  enum:        '#8b5cf6',
  macro:       '#a855f7',
};
const LANG_COLORS: Record<string, string> = {
  typescript: '#10b981',
  javascript: '#10b981',
  rust:       '#f97316',
  python:     '#3b82f6',
  go:         '#06b6d4',
};
function symbolColor(n: CodeGraphNode): string {
  return KIND_COLORS[n.kind?.toLowerCase()] ?? LANG_COLORS[n.lang?.toLowerCase()] ?? '#9ca3af';
}

function NodeDetailPanel({
  node,
  edges,
  onClose,
  onBlast,
  onExpand,
  blast,
  blastBusy,
  expandBusy,
  onFocusDependent,
}: {
  node: CodeGraphNode;
  edges: CodeGraphEdge[];
  onClose: () => void;
  onBlast?: (node: CodeGraphNode) => void;
  onExpand?: (node: CodeGraphNode) => void;
  blast?: import('../api/types.js').BlastRadius | null;
  blastBusy?: boolean;
  expandBusy?: boolean;
  onFocusDependent?: (dep: { id: string; name: string }) => void;
}): React.ReactElement {
  const calledBy = edges.filter((e) => e.tgt === node.id);
  const calls = edges.filter((e) => e.src === node.id);
  const color = symbolColor(node);

  function shortName(symbolId: string): string {
    const parts = symbolId.split('/');
    return parts[parts.length - 1] ?? symbolId;
  }

  return (
    <div
      className="w-64 shrink-0 flex flex-col border-l overflow-hidden"
      style={{ background: T.canvas2, borderColor: T.hairline }}
    >
      <div
        className="flex items-center gap-1.5 px-3 py-2 border-b shrink-0 min-w-0"
        style={{ borderColor: T.hairline }}
      >
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <span
          className="text-[11px] font-semibold truncate flex-1 font-mono"
          style={{ color: T.ink }}
          title={node.name || node.id}
        >
          {node.name || node.id.split('/').pop()}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 leading-none text-base"
          style={{ color: T.faint }}
        >
          ×
        </button>
      </div>

      <div className="overflow-y-auto flex-1 p-3 flex flex-col gap-3 text-[11px]">
        {(onBlast !== undefined || onExpand !== undefined) && (
          <div className="flex gap-2">
            {onBlast !== undefined && (
              <button
                type="button"
                onClick={() => onBlast(node)}
                disabled={blastBusy}
                className="flex-1 px-2 py-1 rounded-lg text-[10px] font-mono font-semibold disabled:opacity-50"
                style={{ background: 'rgba(248,81,73,0.12)', color: T.deny, border: `1px solid ${T.hairline}` }}
              >
                {blastBusy ? 'Computing…' : '⚡ Blast radius'}
              </button>
            )}
            {onExpand !== undefined && (
              <button
                type="button"
                onClick={() => onExpand(node)}
                disabled={expandBusy}
                className="flex-1 px-2 py-1 rounded-lg text-[10px] font-mono font-semibold disabled:opacity-50"
                style={{ background: 'rgba(121,192,255,0.12)', color: T.link, border: `1px solid ${T.hairline}` }}
              >
                {expandBusy ? 'Expanding…' : '⤢ Expand neighbors'}
              </button>
            )}
          </div>
        )}
        {blast != null && (
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-mono uppercase" style={{ color: T.faint }}>
              blast radius · {blast.dependents.length} dependents
            </span>
            {blast.unresolved > 0 && (
              <span className="text-[10px] font-mono" style={{ color: T.deny }}>
                +{blast.unresolved} unresolved call(s) — impact may be larger
              </span>
            )}
            {blast.unresolved === -1 && (
              <span className="text-[10px] font-mono" style={{ color: T.deny }}>blast radius failed to compute</span>
            )}
            <ul className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
              {blast.dependents.slice(0, 30).map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    onClick={() => onFocusDependent?.(d)}
                    className="w-full text-left text-[10px] font-mono truncate hover:underline"
                    style={{ color: T.link }}
                    title={`${d.file}:${d.line}`}
                  >
                    {d.name} <span style={{ color: T.faint }}>({d.kind})</span>
                  </button>
                </li>
              ))}
              {blast.dependents.length > 30 && (
                <li className="text-[10px] font-mono" style={{ color: T.faint }}>+{blast.dependents.length - 30} more</li>
              )}
            </ul>
          </div>
        )}
        {node.kind && (
          <div className="flex items-center gap-2">
            <span
              className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase"
              style={{ background: T.surface, color: T.muted }}
            >
              {node.kind}
            </span>
            <span className="capitalize font-mono" style={{ color: T.faint }}>{node.lang || ''}</span>
          </div>
        )}

        {node.file && (
          <div>
            <p className="text-[10px] mb-0.5 font-mono uppercase tracking-wide" style={{ color: T.faint }}>File</p>
            <p className="font-mono text-[10px] break-all" style={{ color: T.muted }}>{node.file}</p>
          </div>
        )}

        <div className="flex gap-4">
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide mb-0.5" style={{ color: T.faint }}>Callers</p>
            <p className="font-mono font-bold" style={{ color: T.ink }}>{node.inDeg}</p>
          </div>
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide mb-0.5" style={{ color: T.faint }}>Calls</p>
            <p className="font-mono font-bold" style={{ color: T.ink }}>{node.outDeg}</p>
          </div>
        </div>

        {calledBy.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide mb-1" style={{ color: T.faint }}>
              Called by (in view) <span style={{ color: T.muted }}>{calledBy.length}</span>
            </p>
            <div className="flex flex-col gap-0.5">
              {calledBy.slice(0, 10).map((e) => (
                <p key={e.src} className="font-mono text-[10px] truncate" style={{ color: T.muted }} title={e.src}>{shortName(e.src)}</p>
              ))}
              {calledBy.length > 10 && <p className="text-[10px] font-mono" style={{ color: T.faint }}>+{calledBy.length - 10} more</p>}
            </div>
          </div>
        )}

        {calls.length > 0 && (
          <div>
            <p className="text-[10px] font-mono uppercase tracking-wide mb-1" style={{ color: T.faint }}>
              Calls (in view) <span style={{ color: T.muted }}>{calls.length}</span>
            </p>
            <div className="flex flex-col gap-0.5">
              {calls.slice(0, 10).map((e) => (
                <p key={e.tgt} className="font-mono text-[10px] truncate" style={{ color: T.muted }} title={e.tgt}>{shortName(e.tgt)}</p>
              ))}
              {calls.length > 10 && <p className="text-[10px] font-mono" style={{ color: T.faint }}>+{calls.length - 10} more</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DomainGraphView({ graph }: { graph: DomainGraph }): React.ReactElement {
  // A real GRAPH, not a listing (operator feedback): domains are nodes in the path
  // hierarchy (the only edge material the current artifact carries — requirement
  // `dependencies`/`entities` are empty at this fidelity), sized by requirement
  // count via the CytoGraph inDeg channel. Clicking a node opens its requirements
  // in a detail rail. The filter narrows to matching domains plus their ancestors
  // so the visible slice stays connected.
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { nodes, edges, reqCounts } = useMemo(() => {
    const paths = Object.keys(graph.domains);
    const present = new Set(paths);
    const counts = new Map<string, number>();
    for (const p of paths) counts.set(p, Object.keys(graph.domains[p]?.requirements ?? {}).length);
    const parentOf = (p: string): string | null => {
      if (p === '(root)') return null;
      let cur = p;
      while (cur.includes('/')) {
        cur = cur.slice(0, cur.lastIndexOf('/'));
        if (present.has(cur)) return cur;
      }
      return present.has('(root)') ? '(root)' : null;
    };
    const childCount = new Map<string, number>();
    const es: CodeGraphEdge[] = [];
    for (const p of paths) {
      const par = parentOf(p);
      if (par !== null) {
        es.push({ src: par, tgt: p });
        childCount.set(par, (childCount.get(par) ?? 0) + 1);
      }
    }
    const ns: CodeGraphNode[] = paths.map((p) => ({
      id: p,
      name: p === '(root)' ? '(root)' : p.slice(p.lastIndexOf('/') + 1),
      kind: 'domain',
      file: p,
      inDeg: Math.min(counts.get(p) ?? 0, 60),
      outDeg: childCount.get(p) ?? 0,
      lang: 'domain',
    }));
    return { nodes: ns, edges: es, reqCounts: counts };
  }, [graph]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (q === '') return { nodes, edges };
    const direct = new Set(
      nodes
        .filter(
          (n) =>
            n.id.toLowerCase().includes(q) ||
            Object.values(graph.domains[n.id]?.requirements ?? {}).some((r) =>
              (r.title ?? '').toLowerCase().includes(q),
            ),
        )
        .map((n) => n.id),
    );
    // Keep ancestors so the filtered slice stays a connected hierarchy.
    const keep = new Set(direct);
    const byId = new Map(edges.map((e) => [e.tgt, e.src]));
    for (const id of direct) {
      let cur = byId.get(id);
      while (cur !== undefined && !keep.has(cur)) {
        keep.add(cur);
        cur = byId.get(cur);
      }
    }
    return {
      nodes: nodes.filter((n) => keep.has(n.id)),
      edges: edges.filter((e) => keep.has(e.src) && keep.has(e.tgt)),
    };
  }, [nodes, edges, q, graph]);

  const selectedDomain = selected !== null ? graph.domains[selected] : undefined;

  if (nodes.length === 0) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <p className="text-sm text-center mt-8 font-mono" style={{ color: T.faint }}>No domains in this graph.</p>
      </div>
    );
  }
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b" style={{ borderColor: T.hairline }}>
        <span className="text-[11px] font-mono shrink-0" style={{ color: T.muted }}>
          {nodes.length} domains · {[...reqCounts.values()].reduce((a, b) => a + b, 0)} requirements
        </span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter domains + requirement titles…"
          className="flex-1 text-[11px] font-mono px-3 py-1.5 rounded-lg border outline-none"
          style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2, color: T.ink }}
        />
        {q !== '' && (
          <span className="text-[10px] font-mono shrink-0" style={{ color: T.faint }}>
            {visible.nodes.length === 1 ? '1 match' : `${visible.nodes.length} matches`}
          </span>
        )}
      </div>
      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-hidden" style={{ background: T.canvas }}>
          <CytoGraph
            nodes={visible.nodes}
            edges={visible.edges}
            externalSelectedId={selected}
            onNodeSelect={(n) => setSelected(n ? n.id : null)}
          />
        </div>
        {selected !== null && selectedDomain && (
          <DomainDetailPanel
            domainId={selected}
            domain={selectedDomain}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}

function DomainDetailPanel({
  domainId,
  domain,
  onClose,
}: {
  domainId: string;
  domain: DomainGraph['domains'][string];
  onClose: () => void;
}): React.ReactElement {
  const REQ_CAP = 150;
  const reqs = Object.entries(domain.requirements ?? {});
  return (
    <div
      className="w-[380px] shrink-0 border-l flex flex-col"
      style={{ borderColor: T.hairlineS, background: T.surface2 }}
    >
      <div className="px-4 py-2.5 border-b flex items-center gap-2 shrink-0" style={{ borderColor: T.hairline, background: T.canvas2 }}>
        <span className="text-[11px] font-semibold font-mono truncate" style={{ color: T.ink }}>{domainId}</span>
        <span className="text-[10px] font-mono ml-auto shrink-0" style={{ color: T.faint }}>{reqs.length} reqs</span>
        <button type="button" onClick={onClose} aria-label="Close domain details" className="text-sm shrink-0 px-1" style={{ color: T.muted }}>
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {domain.description && (
          <p className="text-[11px] px-4 pt-3 pb-1" style={{ color: T.muted }}>{domain.description}</p>
        )}
        {reqs.length === 0 ? (
          <p className="text-[11px] px-4 py-3 font-mono" style={{ color: T.faint }}>No requirements recorded for this domain.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: T.hairline }}>
            {reqs.slice(0, REQ_CAP).map(([reqId, req]) => (
              <div key={reqId} className="px-4 py-2.5" style={{ borderColor: T.hairline }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[10px] font-mono" style={{ color: T.faint }}>{reqId}</span>
                  {req.status && (
                    <span
                      className="text-[9px] uppercase font-semibold px-1.5 py-0.5 rounded font-mono"
                      style={{
                        background: req.status === 'active' ? 'rgba(63,185,80,0.15)' : req.status === 'deprecated' ? 'rgba(248,81,73,0.15)' : T.surface,
                        color: req.status === 'active' ? T.ok : req.status === 'deprecated' ? T.deny : T.muted,
                      }}
                    >
                      {req.status}
                    </span>
                  )}
                </div>
                <p className="text-[11px]" style={{ color: T.ink }}>{req.title}</p>
                {req.description && req.description !== req.title && (
                  <p className="text-[10px] mt-0.5" style={{ color: T.muted }}>{req.description.slice(0, 160)}</p>
                )}
              </div>
            ))}
            {reqs.length > REQ_CAP && (
              <p className="text-[10px] font-mono px-4 py-2" style={{ color: T.faint }}>
                +{reqs.length - REQ_CAP} more requirements
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Traffic-light dots — the wicked "panel" signature header decoration. */
function PanelDots(): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-3 h-3 rounded-full" style={{ background: T.deny }} />
      <span className="w-3 h-3 rounded-full" style={{ background: T.accent }} />
      <span className="w-3 h-3 rounded-full" style={{ background: T.ok }} />
    </div>
  );
}

export function RepoGraphModal({ repo, onClose, onSelectRun, initialFocus }: Props): React.ReactElement {
  const [tab, setTab] = useState<TabId>('graph');
  const [graphType, setGraphType] = useState<GraphType>('code');
  const [loading, setLoading] = useState(true);
  const [codeData, setCodeData] = useState<CodeGraphData | null>(null);
  const [domainData, setDomainData] = useState<DomainGraph | null>(null);
  const [domainCoverage, setDomainCoverage] = useState<DomainCoverage | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [annotating, setAnnotating] = useState(false);
  const [annotateError, setAnnotateError] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<CodeGraphNode | null>(null);
  const [hideTests, setHideTests] = useState(true);

  async function runAnnotation(): Promise<void> {
    setAnnotating(true);
    setAnnotateError(null);
    try {
      const { runId } = await api.rerunOnboarding(repo.id);
      onSelectRun?.(runId);
      onClose();
    } catch (e: unknown) {
      setAnnotateError(e instanceof Error ? e.message : String(e));
      setAnnotating(false);
    }
  }

  useEffect(() => {
    function handler(e: KeyboardEvent): void { if (e.key === 'Escape') onClose(); }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    setLoading(true);
    const opts = initialFocus != null && initialFocus !== '' ? { focus: initialFocus, limit: 120 } : undefined;
    api
      .getRepoGraph(repo.id, opts)
      .then(({ graph }) => {
        setCodeData(graph);
        // Deep-linked focus (e.g. from a requirement's component): select it on arrival.
        if (opts !== undefined && graph !== null) {
          const hit = graph.nodes.find((n) => n.id === initialFocus || n.name === initialFocus);
          if (hit) {
            setSelectedNode(hit);
            setHighlightId(hit.id);
          }
        }
      })
      .catch(() => setCodeData(null))
      .finally(() => setLoading(false));
  }, [repo.id, initialFocus]);

  useEffect(() => {
    if (graphType !== 'domain' || domainData !== null) return;
    setDomainLoading(true);
    api
      .getRepoDomainGraph(repo.id)
      .then(({ graph, coverage }) => { setDomainData(graph); setDomainCoverage(coverage); })
      .catch(() => { setDomainData(null); setDomainCoverage(null); })
      .finally(() => setDomainLoading(false));
  }, [graphType, domainData, repo.id]);

  function handleHotspotSelect(node: CodeGraphNode): void {
    setHighlightId(node.id);
    setSelectedNode(node);
  }

  function handleNodeSelect(node: CodeGraphNode | null): void {
    setSelectedNode(node);
    if (node !== null) setHighlightId(node.id);
    setBlast(null);
  }

  // ── Navigation actions (estate primitives via crew) ──────────────────────
  const [blast, setBlast] = useState<import('../api/types.js').BlastRadius | null>(null);
  const [blastBusy, setBlastBusy] = useState(false);
  const [expandBusy, setExpandBusy] = useState(false);

  function blastRadius(node: CodeGraphNode): void {
    setBlastBusy(true);
    api
      .getBlastRadius(repo.id, node.name || node.id)
      .then(setBlast)
      .catch(() => setBlast({ target: node.name, dependents: [], unresolved: -1 }))
      .finally(() => setBlastBusy(false));
  }

  /** MERGE a fetched ego-slice into the current view (progressive navigation). */
  function mergeSlice(graph: NonNullable<Awaited<ReturnType<typeof api.getRepoGraph>>['graph']>): void {
    setCodeData((prev) => {
          if (prev === null) return prev;
          const nodeIds = new Set(prev.nodes.map((n) => n.id));
          const mergedNodes = [...prev.nodes, ...graph.nodes.filter((n) => !nodeIds.has(n.id))];
          const edgeKey = (e: CodeGraphEdge): string => `${e.src}→${e.tgt}`;
          const edgeKeys = new Set(prev.edges.map(edgeKey));
          const mergedEdges = [...prev.edges, ...graph.edges.filter((e) => !edgeKeys.has(edgeKey(e)))];
          return {
            nodes: mergedNodes,
            edges: mergedEdges,
            stats: { nodeCount: mergedNodes.length, edgeCount: mergedEdges.length, fileCount: new Set(mergedNodes.map((n) => n.file)).size },
          };
    });
  }

  function expandNeighbors(node: CodeGraphNode): void {
    setExpandBusy(true);
    api
      .getRepoGraph(repo.id, { focus: node.id, limit: 60 })
      .then(({ graph }) => {
        if (graph !== null) mergeSlice(graph);
      })
      .catch(() => undefined)
      .finally(() => setExpandBusy(false));
  }

  /** Focus a blast-radius dependent: select in-slice, or fetch its ego-slice and merge first. */
  function focusDependent(dep: { id: string; name: string }): void {
    setBlast(null);
    const hit = codeData?.nodes.find((n) => n.id === dep.id);
    if (hit) {
      handleNodeSelect(hit);
      return;
    }
    api
      .getRepoGraph(repo.id, { focus: dep.id, limit: 60 })
      .then(({ graph }) => {
        if (graph === null) return;
        mergeSlice(graph);
        const fetched = graph.nodes.find((n) => n.id === dep.id) ?? graph.nodes.find((n) => n.name === dep.name);
        if (fetched) handleNodeSelect(fetched);
      })
      .catch(() => undefined);
  }

  function isTestFile(file: string): boolean {
    const lower = file.toLowerCase();
    const parts = lower.split('/');
    const basename = parts[parts.length - 1] ?? '';
    return (
      parts.some((p) => p === 'test' || p === 'tests' || p === 'spec' || p === 'specs' || p === '__tests__' || p === 'e2e') ||
      basename.startsWith('test_') ||
      /_(test|spec|tests|suite)\.[^.]+$/.test(basename) ||
      /\.(test|spec)\.[^.]+$/.test(basename)
    );
  }

  const localNodes = codeData
    ? codeData.nodes.filter((n) => {
        if (!n.file || n.file.startsWith('node_modules/')) return false;
        if (hideTests && isTestFile(n.file)) return false;
        return true;
      })
    : [];
  const codeEmpty = localNodes.length === 0;

  // ── Shared tab pill renderer ────────────────────────────────────────────
  function TabPill<T extends string>({
    value, current, label, onChange,
  }: { value: T; current: T; label: string; onChange: (v: T) => void }): React.ReactElement {
    const active = value === current;
    return (
      <button
        type="button"
        onClick={() => onChange(value)}
        className="rounded px-2.5 py-1 text-[11px] font-mono font-medium transition-colors"
        style={{
          background: active ? T.surface : 'transparent',
          color: active ? T.ink : T.muted,
          boxShadow: active ? '0 1px 4px rgba(0,0,0,0.4)' : 'none',
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.75)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal card — wicked teal-blue */}
      <div
        className="w-[92vw] h-[92vh] rounded-2xl flex flex-col overflow-hidden"
        style={{
          background: T.blue,
          border: `1px solid ${T.hairlineS}`,
          boxShadow: '0 40px 80px -20px rgba(0,0,0,0.8)',
        }}
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div
          className="flex items-center gap-3 px-5 py-3 border-b shrink-0"
          style={{ background: T.blue2, borderColor: T.hairline }}
        >
          {/* Repo name */}
          <span className="text-[13px] font-semibold font-mono mr-1" style={{ color: T.ink }}>
            {repo.name}
          </span>

          {/* Graph-type pills */}
          <div
            className="flex gap-0.5 rounded p-0.5"
            style={{ background: 'rgba(0,0,0,0.25)' }}
          >
            {(['code', 'domain'] as GraphType[]).map((t) => (
              <TabPill key={t} value={t} current={graphType} label={t === 'code' ? 'Code' : 'Domain'} onChange={setGraphType} />
            ))}
          </div>

          {/* Sub-tabs (code graph only) */}
          {graphType === 'code' && (
            <div
              className="flex gap-0.5 rounded p-0.5"
              style={{ background: 'rgba(0,0,0,0.25)' }}
            >
              {(['graph', 'hotspots'] as TabId[]).map((t) => (
                <TabPill key={t} value={t} current={tab} label={t === 'graph' ? 'Graph' : 'Hotspots'} onChange={setTab} />
              ))}
            </div>
          )}

          {/* Tests toggle */}
          {graphType === 'code' && (
            <button
              type="button"
              onClick={() => setHideTests((h) => !h)}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono font-medium transition-colors border"
              style={{
                borderColor: hideTests ? T.hairline : 'rgba(255,218,25,0.4)',
                background:  hideTests ? 'rgba(0,0,0,0.2)' : 'rgba(255,218,25,0.08)',
                color:       hideTests ? T.faint : T.accent,
              }}
            >
              {hideTests ? 'tests hidden' : 'tests shown'}
            </button>
          )}

          {/* Node / edge counts */}
          {codeData && graphType === 'code' && (
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded"
              style={{ background: 'rgba(0,0,0,0.2)', color: T.muted }}
            >
              {localNodes.length} nodes · {codeData.stats.edgeCount} edges
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-xl leading-none w-7 h-7 flex items-center justify-center rounded transition-colors"
            style={{ color: T.faint }}
            onMouseEnter={(e) => (e.currentTarget.style.color = T.ink)}
            onMouseLeave={(e) => (e.currentTarget.style.color = T.faint)}
          >
            ×
          </button>
        </div>

        {/* ── Content ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden" style={{ background: T.blue }}>
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-sm font-mono" style={{ color: T.muted }}>Loading…</span>
            </div>
          ) : graphType === 'domain' ? (
            domainLoading ? (
              <div className="flex items-center justify-center h-full">
                <span className="text-sm font-mono" style={{ color: T.muted }}>Loading domain graph…</span>
              </div>
            ) : !domainData ? (
              <div className="flex items-center justify-center h-full">
                <div
                  className="max-w-sm w-full mx-auto p-6 rounded-xl border flex flex-col gap-4"
                  style={{ border: `1px solid ${T.hairlineS}`, background: T.canvas2 }}
                >
                  <p className="text-sm font-semibold font-mono" style={{ color: T.ink }}>Domain graph not yet generated</p>
                  <p className="text-xs leading-relaxed" style={{ color: T.muted }}>
                    The domain model requires full annotation coverage — every behavior-bearing
                    node in the code graph must be linked to a requirement. To get there: run the
                    <span className="font-mono"> domain-extraction</span> workflow for this repo
                    (it annotates behavior nodes with requirement claims), then re-run Onboard —
                    its domain phase runs <span className="font-mono">wicked-core domain-graph</span>.
                  </p>
                  {domainCoverage ? (
                    <div className="rounded-lg p-4 flex flex-col gap-2 border" style={{ border: `1px solid ${T.hairline}` }}>
                      <div className="flex justify-between items-baseline">
                        <span className="text-[11px] font-mono" style={{ color: T.muted }}>Annotation coverage</span>
                        <span className="text-[11px] font-mono font-bold" style={{ color: T.ink }}>
                          {(domainCoverage.coverage * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: T.surface }}>
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.max(domainCoverage.coverage * 100, 0.5)}%`, background: T.ok }}
                        />
                      </div>
                      <div className="flex gap-4 mt-1 text-[10px] font-mono tabular-nums" style={{ color: T.faint }}>
                        <span>{domainCoverage.resolved.toLocaleString()} resolved</span>
                        <span>{domainCoverage.behavior_bearing.toLocaleString()} behavior-bearing</span>
                        <span>{domainCoverage.total.toLocaleString()} total</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] font-mono" style={{ color: T.faint }}>
                      No coverage data — run onboarding first.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => void runAnnotation()}
                    disabled={annotating}
                    className="self-start rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
                    style={{ background: T.accent, color: T.accentInk }}
                  >
                    {annotating ? 'Starting…' : 'Run annotation workflow →'}
                  </button>
                  {annotateError && (
                    <p className="text-[11px] font-mono" style={{ color: T.deny }}>{annotateError}</p>
                  )}
                </div>
              </div>
            ) : (
              <DomainGraphView graph={domainData} />
            )
          ) : codeEmpty ? (
            <div className="flex items-center justify-center h-full">
              <p className="text-sm font-mono" style={{ color: T.muted }}>
                Code graph not yet available — run onboarding first.
              </p>
            </div>
          ) : (
            <div className="h-full flex p-4 gap-4">
              {/* ── Left: graph panel + hotspots ─────────────────────────── */}
              <div className="flex-1 flex flex-col gap-3 min-w-0 overflow-hidden">

                {/* Graph panel — wicked .wf-preview / .gc style */}
                <div
                  className="rounded-xl overflow-hidden flex flex-col"
                  style={{
                    display: tab === 'graph' ? 'flex' : 'none',
                    flex: 1,
                    border: `1px solid ${T.hairlineS}`,
                    background: T.canvas2,
                    boxShadow: '0 20px 50px -20px rgba(0,0,0,0.6)',
                  }}
                >
                  {/* Panel header — traffic lights + title */}
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
                    style={{ background: T.canvas, borderColor: T.hairline }}
                  >
                    <PanelDots />
                    <span className="font-mono text-[10px] ml-1" style={{ color: T.faint }}>
                      code-graph · <span style={{ color: T.link }}>{repo.name}</span>
                    </span>
                    <span
                      className="ml-auto font-mono text-[9px] px-2 py-0.5 rounded"
                      style={{ background: T.surface, color: T.muted }}
                    >
                      {localNodes.length} nodes
                    </span>
                  </div>
                  {/* Graph canvas */}
                  <div className="flex-1 overflow-hidden" style={{ background: T.canvas }}>
                    <CytoGraph
                      nodes={localNodes}
                      edges={codeData!.edges}
                      externalSelectedId={highlightId}
                      onNodeSelect={handleNodeSelect}
                    />
                  </div>
                </div>

                {/* Hotspots panel */}
                <div
                  className="rounded-xl overflow-hidden flex flex-col"
                  style={{
                    display: tab === 'hotspots' ? 'flex' : 'none',
                    flex: 1,
                    border: `1px solid ${T.hairlineS}`,
                    background: T.canvas2,
                    boxShadow: '0 20px 50px -20px rgba(0,0,0,0.6)',
                  }}
                >
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 border-b shrink-0"
                    style={{ background: T.canvas, borderColor: T.hairline }}
                  >
                    <PanelDots />
                    <span className="font-mono text-[10px] ml-1" style={{ color: T.faint }}>
                      hotspots · <span style={{ color: T.link }}>{repo.name}</span>
                    </span>
                  </div>
                  <div className="flex-1 overflow-hidden" style={{ background: T.surface2 }}>
                    <HotspotsView
                      nodes={localNodes}
                      selectedId={selectedNode?.id ?? null}
                      onSelect={handleHotspotSelect}
                    />
                  </div>
                </div>
              </div>

              {/* ── Right: node detail panel ──────────────────────────────── */}
              {selectedNode && (
                <NodeDetailPanel
                  node={selectedNode}
                  edges={codeData!.edges}
                  onClose={() => setSelectedNode(null)}
                  onBlast={blastRadius}
                  onExpand={expandNeighbors}
                  blast={blast}
                  blastBusy={blastBusy}
                  expandBusy={expandBusy}
                  onFocusDependent={focusDependent}
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
