import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import type { DomainGraph, DomainGraphDomain, DomainGraphRequirement } from '../api/types.js';

function statusBadge(status: string | undefined): React.ReactElement | null {
  if (!status) return null;
  const colors: Record<string, string> = {
    active: '#3fb950',
    proposed: '#ffda19',
    deprecated: '#f85149',
  };
  const color = colors[status] ?? 'rgba(230,237,243,0.5)';
  return (
    <span
      className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ background: 'rgba(230,237,243,0.06)', color }}
    >
      {status}
    </span>
  );
}

function RequirementRow({ id, req }: { id: string; req: DomainGraphRequirement }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded" style={{ border: '1px solid rgba(230,237,243,0.07)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left transition-colors"
        style={{ background: 'transparent' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(230,237,243,0.03)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
      >
        <span className="mt-0.5 shrink-0 text-[10px]" style={{ color: 'rgba(230,237,243,0.25)' }}>{open ? '▾' : '▸'}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>{id}</span>
            <span className="text-[11px] font-medium truncate" style={{ color: '#e6edf3' }}>{req.title}</span>
            {statusBadge(req.status)}
            {req.disposition && (
              <span className="text-[10px] italic" style={{ color: 'rgba(230,237,243,0.4)' }}>{req.disposition}</span>
            )}
          </div>
          {!open && req.description && (
            <p className="text-[10px] truncate mt-0.5" style={{ color: 'rgba(230,237,243,0.4)' }}>{req.description}</p>
          )}
        </div>
        <span className="shrink-0 text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.25)' }}>
          {req.business_rules?.length ?? 0}br · {req.validations?.length ?? 0}val
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3 flex flex-col gap-2 text-[10px]" style={{ background: '#0f1419' }}>
          {req.description && <p style={{ color: 'rgba(230,237,243,0.55)' }}>{req.description}</p>}

          {(req.business_rules?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold uppercase tracking-wider mb-1 font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>Business rules</p>
              <ul className="flex flex-col gap-0.5">
                {(req.business_rules ?? []).map((br) => (
                  <li key={br.id} className="flex items-start gap-1.5">
                    <span className="font-mono shrink-0" style={{ color: 'rgba(230,237,243,0.25)' }}>{br.id}</span>
                    <span style={{ color: 'rgba(230,237,243,0.65)' }}>{br.statement}</span>
                    <span className="ml-auto shrink-0 font-mono" style={{ color: 'rgba(230,237,243,0.3)' }}>{(br.confidence * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(req.validations?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold uppercase tracking-wider mb-1 font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>Validations</p>
              <ul className="flex flex-col gap-0.5">
                {(req.validations ?? []).map((v) => (
                  <li key={v.id} className="flex items-start gap-1.5">
                    <span className="font-mono shrink-0" style={{ color: 'rgba(230,237,243,0.25)' }}>{v.id}</span>
                    <span style={{ color: 'rgba(230,237,243,0.65)' }}>{v.statement}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(req.error_paths?.length ?? 0) > 0 && (
            <div>
              <p className="font-semibold uppercase tracking-wider mb-1 font-mono" style={{ color: 'rgba(248,81,73,0.6)' }}>Error paths</p>
              <ul className="flex flex-col gap-0.5">
                {(req.error_paths ?? []).map((ep) => (
                  <li key={ep.id} className="flex items-start gap-1.5">
                    <span className="font-mono shrink-0" style={{ color: 'rgba(230,237,243,0.25)' }}>{ep.id}</span>
                    <span style={{ color: '#f85149' }}>{ep.statement}</span>
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
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(230,237,243,0.08)' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left transition-colors"
        style={{ background: '#1b222e', borderBottom: '1px solid rgba(230,237,243,0.07)' }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#1f2937'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = '#1b222e'; }}
      >
        <span className="text-[10px]" style={{ color: 'rgba(230,237,243,0.35)' }}>{open ? '▾' : '▸'}</span>
        <span className="font-semibold text-[12px]" style={{ color: '#e6edf3' }}>{name}</span>
        <span className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
          {reqIds.length} req · {entityIds.length} entity
        </span>
        {domain.cluster_id !== undefined && (
          <span className="ml-auto text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.25)' }}>cluster {domain.cluster_id}</span>
        )}
      </button>

      {open && (
        <div className="p-3 flex flex-col gap-2" style={{ background: '#161c26' }}>
          {domain.description && (
            <p className="text-[10px] italic" style={{ color: 'rgba(230,237,243,0.4)' }}>{domain.description}</p>
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
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-1 font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>Entities</p>
              <div className="flex flex-wrap gap-1">
                {entityIds.map((e) => (
                  <span
                    key={e}
                    title={domain.entities[e]?.description}
                    className="rounded px-2 py-0.5 text-[10px] font-mono"
                    style={{ background: 'rgba(230,237,243,0.06)', color: 'rgba(230,237,243,0.6)' }}
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

  if (loading) return <p className="text-xs" style={{ color: 'rgba(230,237,243,0.4)' }}>Loading domain model…</p>;
  if (error) return (
    <p className="rounded px-2 py-1 text-xs" style={{ background: 'rgba(248,81,73,0.08)', color: '#f85149' }}>
      {error}
    </p>
  );
  if (!graph) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm" style={{ color: 'rgba(230,237,243,0.5)' }}>No domain model found.</p>
        <p className="text-[10px]" style={{ color: 'rgba(230,237,243,0.4)' }}>
          Run{' '}
          <span
            className="font-mono rounded px-1"
            style={{ background: 'rgba(230,237,243,0.06)', color: 'rgba(230,237,243,0.6)' }}
          >
            wicked-core domain-graph
          </span>{' '}
          to generate{' '}
          <span className="font-mono" style={{ color: 'rgba(230,237,243,0.5)' }}>
            .wicked-estate/requirements/requirements_graph.json
          </span>.
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
        <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Domain Model</h2>
        <span className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.35)' }}>
          schema {graph.metadata.schema_version} · {Object.keys(graph.domains).length} domains
        </span>
        <input
          aria-label="Search domains and requirements"
          type="search"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto rounded px-2 py-0.5 text-[11px] w-40 focus:outline-none"
          style={{ background: '#161c26', border: '1px solid rgba(230,237,243,0.1)', color: '#e6edf3' }}
        />
        <button
          type="button"
          onClick={() => void load()}
          className="text-[10px] hover:underline"
          style={{ color: 'rgba(230,237,243,0.4)' }}
        >
          Refresh
        </button>
      </div>

      {domainNames.length === 0 ? (
        <p className="text-xs" style={{ color: 'rgba(230,237,243,0.4)' }}>No domains match your search.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {domainNames.map((name) => (
            <DomainSection key={name} name={name} domain={graph.domains[name]!} />
          ))}
        </div>
      )}

      {graph.metadata.source && (
        <p className="text-[10px] font-mono" style={{ color: 'rgba(230,237,243,0.25)' }}>
          Source: <span>{graph.metadata.source}</span>
        </p>
      )}
    </div>
  );
}
