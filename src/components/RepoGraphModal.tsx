import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import type { RepoEntry, CodeGraphNode, CodeGraphEdge, CodeGraphData, DomainGraph, DomainCoverage } from '../api/types.js';
import { CytoGraph } from './CytoGraph.js';
import { HotspotsView } from './HotspotsView.js';

interface Props {
  repo: RepoEntry;
  onClose: () => void;
  onSelectRun?: (runId: string) => void;
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
}: {
  node: CodeGraphNode;
  edges: CodeGraphEdge[];
  onClose: () => void;
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
  const domains = Object.entries(graph.domains);
  return (
    <div className="h-full overflow-y-auto p-4 flex flex-col gap-3">
      {domains.length === 0 ? (
        <p className="text-sm text-center mt-8 font-mono" style={{ color: T.faint }}>No domains in this graph.</p>
      ) : (
        domains.map(([domainId, domain]) => {
          const reqs = Object.entries(domain.requirements ?? {});
          return (
            <div
              key={domainId}
              className="rounded-xl overflow-hidden border"
              style={{ border: `1px solid ${T.hairlineS}`, background: T.surface2 }}
            >
              <div
                className="px-4 py-2 border-b flex items-center gap-2"
                style={{ borderColor: T.hairline, background: T.canvas2 }}
              >
                <span className="text-[11px] font-semibold font-mono" style={{ color: T.ink }}>{domainId}</span>
                <span className="text-[10px] font-mono" style={{ color: T.faint }}>{reqs.length} reqs</span>
              </div>
              {domain.description && (
                <p className="text-[11px] px-4 pt-2 pb-1" style={{ color: T.muted }}>{domain.description}</p>
              )}
              {reqs.length > 0 && (
                <div className="divide-y" style={{ borderColor: T.hairline }}>
                  {reqs.map(([reqId, req]) => (
                    <div key={reqId} className="px-4 py-2" style={{ borderColor: T.hairline }}>
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
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
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

export function RepoGraphModal({ repo, onClose, onSelectRun }: Props): React.ReactElement {
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
    setLoading(true);
    api
      .getRepoGraph(repo.id)
      .then(({ graph }) => setCodeData(graph))
      .catch(() => setCodeData(null))
      .finally(() => setLoading(false));
  }, [repo.id]);

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
                    node in the code graph must be linked to a requirement.
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
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
