import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { DomainGraph, DomainGraphDomain, DomainGraphRequirement } from '../api/types.js';

function statusBadge(status: string | undefined): React.ReactElement | null {
  if (!status) return null;
  const styles: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    proposed: 'bg-yellow-100 text-yellow-800',
    deprecated: 'bg-red-100 text-red-800',
  };
  const cls = styles[status] ?? 'bg-gray-100 text-gray-600';
  return <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>;
}

function RequirementRow({ id, req }: { id: string; req: DomainGraphRequirement }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-gray-100 rounded">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="mt-0.5 shrink-0 text-[10px] text-gray-300">{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px] text-gray-400">{id}</span>
            <span className="text-[11px] font-medium text-gray-800 truncate">{req.title}</span>
            {statusBadge(req.status)}
            {req.disposition && (
              <span className="text-[10px] text-gray-400 italic">{req.disposition}</span>
            )}
          </div>
          {!open && req.description && (
            <p className="text-[10px] text-gray-500 truncate mt-0.5">{req.description}</p>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-gray-300">
          {req.business_rules?.length ?? 0}br · {req.validations?.length ?? 0}val
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2 text-[10px]">
          {req.description && <p className="text-gray-600">{req.description}</p>}

          {(req.business_rules?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Business rules</p>
              <ul className="flex flex-col gap-0.5">
                {(req.business_rules ?? []).map((br) => (
                  <li key={br.id} className="flex items-start gap-1.5">
                    <span className="font-mono text-gray-300 shrink-0">{br.id}</span>
                    <span className="text-gray-700">{br.statement}</span>
                    <span className="ml-auto shrink-0 text-gray-300">{(br.confidence * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(req.validations?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-gray-500 uppercase tracking-wider mb-1">Validations</p>
              <ul className="flex flex-col gap-0.5">
                {(req.validations ?? []).map((v) => (
                  <li key={v.id} className="flex items-start gap-1.5">
                    <span className="font-mono text-gray-300 shrink-0">{v.id}</span>
                    <span className="text-gray-700">{v.statement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(req.error_paths?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold text-red-400 uppercase tracking-wider mb-1">Error paths</p>
              <ul className="flex flex-col gap-0.5">
                {(req.error_paths ?? []).map((ep) => (
                  <li key={ep.id} className="flex items-start gap-1.5">
                    <span className="font-mono text-gray-300 shrink-0">{ep.id}</span>
                    <span className="text-red-700">{ep.statement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DomainSection({ name, domain }: { name: string; domain: DomainGraphDomain }): React.ReactElement {
  const [open, setOpen] = useState(true);
  const reqIds = Object.keys(domain.requirements ?? {});
  const entityIds = Object.keys(domain.entities ?? {});
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-left border-b border-gray-200 transition-colors"
      >
        <span className="text-[10px] text-gray-400">{open ? '▾' : '▸'}</span>
        <span className="font-semibold text-[12px] text-gray-800">{name}</span>
        <span className="text-[10px] text-gray-400">
          {reqIds.length} req · {entityIds.length} entity
        </span>
        {domain.cluster_id !== undefined && (
          <span className="ml-auto text-[10px] text-gray-300">cluster {domain.cluster_id}</span>
        )}
      </button>

      {open && (
        <div className="p-3 flex flex-col gap-2">
          {domain.description && (
            <p className="text-[10px] text-gray-500 italic">{domain.description}</p>
          )}

          {reqIds.length > 0 && (
            <div className="flex flex-col gap-1">
              {reqIds.map((id) => (
                <RequirementRow key={id} id={id} req={domain.requirements[id]!} />
              ))}
            </div>
          )}

          {entityIds.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Entities</p>
              <div className="flex flex-wrap gap-1">
                {entityIds.map((e) => (
                  <span
                    key={e}
                    title={domain.entities[e]?.description}
                    className="rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700 font-mono"
                  >
                    {e}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * FR: Domain-model browser (crew#44). Reads requirements_graph.json (produced by
 * `wicked-core domain-graph`) and renders an interactive domain/requirement/rule tree.
 */
export function DomainModelBrowser(): React.ReactElement {
  const [graph, setGraph] = useState<DomainGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { graph: g } = await api.getDomainGraph();
      setGraph(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <p className="text-xs text-gray-400">Loading domain model…</p>;
  if (error) return <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{error}</p>;
  if (!graph) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-gray-500">No domain model found.</p>
        <p className="text-[10px] text-gray-400">
          Run <span className="font-mono bg-gray-100 px-1 rounded">wicked-core domain-graph</span> to generate
          <span className="font-mono"> .wicked-estate/requirements/requirements_graph.json</span>.
        </p>
      </div>
    );
  }

  const lc = search.toLowerCase();
  const domainNames = Object.keys(graph.domains ?? {}).filter((name) => {
    if (!lc) return true;
    const d = graph.domains[name]!;
    if (name.toLowerCase().includes(lc)) return true;
    if (d.description?.toLowerCase().includes(lc)) return true;
    return Object.entries(d.requirements ?? {}).some(
      ([rid, r]) =>
        rid.toLowerCase().includes(lc) ||
        r.title?.toLowerCase().includes(lc) ||
        r.description?.toLowerCase().includes(lc),
    );
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-gray-800">Domain Model</h2>
        <span className="text-[10px] text-gray-400">
          schema {graph.metadata.schema_version} · {Object.keys(graph.domains).length} domains
        </span>
        <input
          aria-label="Search domains and requirements"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto rounded border border-gray-200 px-2 py-0.5 text-[11px] w-40 focus:outline-none focus:ring-1 focus:ring-blue-300"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] text-gray-400 hover:text-gray-700 underline"
        >
          Refresh
        </button>
      </div>

      {domainNames.length === 0 ? (
        <p className="text-xs text-gray-400">No domains match your search.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {domainNames.map((name) => (
            <DomainSection key={name} name={name} domain={graph.domains[name]!} />
          ))}
        </div>
      )}

      {graph.metadata.source && (
        <p className="text-[10px] text-gray-300">
          Source: <span className="font-mono">{graph.metadata.source}</span>
        </p>
      )}
    </div>
  );
}
