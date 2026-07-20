import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { CoveragePerApp, CoverageReport, UnaccountedNode } from '../api/types.js';

type SortKey = 'name' | 'kind' | 'file' | 'app';
type SortDir = 'asc' | 'desc';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function GateStatus({ coverage, threshold }: { coverage: number; threshold: number }): React.ReactElement {
  const pass = coverage >= threshold;
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold font-mono"
      style={{
        background: pass ? 'rgba(63,185,80,0.12)' : 'rgba(248,81,73,0.12)',
        color: pass ? '#3fb950' : '#f85149',
        border: `1px solid ${pass ? 'rgba(63,185,80,0.3)' : 'rgba(248,81,73,0.3)'}`,
      }}
    >
      {pass ? 'GATE PASS' : 'GATE FAIL'}
    </span>
  );
}

function Ledger({ report }: { report: CoverageReport }): React.ReactElement {
  const stats = [
    { label: 'Total nodes', value: String(report.total) },
    { label: 'Behavior-bearing', value: String(report.behavior_bearing) },
    { label: 'Resolved', value: String(report.resolved) },
    { label: 'Risk-flagged', value: String(report.risk_flagged) },
    { label: 'Unaccounted', value: String(report.unaccounted) },
    { label: 'Coverage', value: pct(report.coverage) },
    { label: 'Resolved rate', value: pct(report.resolved_rate) },
    { label: 'Mean confidence', value: pct(report.mean_confidence) },
    { label: 'Threshold', value: pct(report.resolve_threshold) },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {stats.map(({ label, value }) => (
        <div
          key={label}
          className="rounded p-2 text-center"
          style={{ border: '1px solid rgba(230,237,243,0.07)', background: '#1b222e' }}
        >
          <p className="text-[11px]" style={{ color: 'rgba(230,237,243,0.4)' }}>{label}</p>
          <p className="text-sm font-semibold" style={{ color: '#e6edf3' }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function PerAppTable({ apps }: { apps: CoveragePerApp[] }): React.ReactElement {
  if (apps.length === 0) return <p className="text-xs" style={{ color: 'rgba(230,237,243,0.4)' }}>No per-app data.</p>;
  return (
    <table className="w-full text-[11px]">
      <thead>
        <tr className="border-b text-left" style={{ borderColor: 'rgba(230,237,243,0.08)', color: 'rgba(230,237,243,0.4)' }}>
          <th className="py-1 pr-3 font-medium">App</th>
          <th className="py-1 pr-3 font-medium text-right">Behavior-bearing</th>
          <th className="py-1 pr-3 font-medium text-right">Resolved</th>
          <th className="py-1 pr-3 font-medium text-right">Risk</th>
          <th className="py-1 pr-3 font-medium text-right">Unaccounted</th>
          <th className="py-1 font-medium text-right">Coverage</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.app} className="border-b" style={{ borderColor: 'rgba(230,237,243,0.06)' }}>
            <td className="py-1 pr-3 font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>{a.app}</td>
            <td className="py-1 pr-3 text-right" style={{ color: 'rgba(230,237,243,0.6)' }}>{a.behavior_bearing}</td>
            <td className="py-1 pr-3 text-right" style={{ color: '#3fb950' }}>{a.resolved}</td>
            <td className="py-1 pr-3 text-right" style={{ color: '#ffda19' }}>{a.risk_flagged}</td>
            <td className="py-1 pr-3 text-right" style={{ color: '#f85149' }}>{a.unaccounted}</td>
            <td className="py-1 text-right font-semibold" style={{ color: '#e6edf3' }}>{pct(a.coverage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NodeSortBtn({
  col,
  active,
  dir,
  onSort,
  children,
}: {
  col: SortKey;
  active: SortKey;
  dir: SortDir;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      className="font-medium transition-colors"
      style={{ color: active === col ? '#79c0ff' : 'rgba(230,237,243,0.4)' }}
    >
      {children}
      {active === col ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
    </button>
  );
}

function UnaccountedList({ nodes }: { nodes: UnaccountedNode[] }): React.ReactElement {
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('file');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [kindFilter, setKindFilter] = useState('');
  const [appFilter, setAppFilter] = useState('');

  const kinds = useMemo(() => [...new Set(nodes.map((n) => n.kind ?? '').filter(Boolean))].sort(), [nodes]);
  const apps = useMemo(() => [...new Set(nodes.map((n) => n.app ?? '').filter(Boolean))].sort(), [nodes]);

  const handleSort = useCallback(
    (k: SortKey) => {
      if (k === sortKey) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      else { setSortKey(k); setSortDir('asc'); }
    },
    [sortKey],
  );

  const filtered = useMemo(() => {
    let result = nodes;
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (n) =>
          (n.name ?? '').toLowerCase().includes(q) ||
          (n.file ?? '').toLowerCase().includes(q) ||
          (n.symbol_id ?? '').toLowerCase().includes(q),
      );
    }
    if (kindFilter) result = result.filter((n) => n.kind === kindFilter);
    if (appFilter) result = result.filter((n) => n.app === appFilter);
    return [...result].sort((a, b) => {
      const av = (sortKey === 'name' ? (a.name ?? a.symbol_id) : (a[sortKey] ?? '')) as string;
      const bv = (sortKey === 'name' ? (b.name ?? b.symbol_id) : (b[sortKey] ?? '')) as string;
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }, [nodes, query, kindFilter, appFilter, sortKey, sortDir]);

  const inputStyle = { background: '#161c26', border: '1px solid rgba(230,237,243,0.1)', color: '#e6edf3' };

  if (nodes.length === 0) {
    return <p className="text-xs" style={{ color: '#3fb950' }}>No unaccounted nodes — gate is satisfied.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          aria-label="Search by name, file, or symbol id"
          placeholder="Search name / file / id…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="rounded px-2 py-1 text-[11px] w-48 focus:outline-none"
          style={inputStyle}
        />
        <select
          aria-label="Filter by kind"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded px-2 py-1 text-[11px] focus:outline-none"
          style={inputStyle}
        >
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select
          aria-label="Filter by app"
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="rounded px-2 py-1 text-[11px] focus:outline-none"
          style={inputStyle}
        >
          <option value="">All apps</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="ml-auto text-[11px]" style={{ color: 'rgba(230,237,243,0.4)' }}>
          {filtered.length} / {nodes.length} hole{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b" style={{ borderColor: 'rgba(230,237,243,0.08)' }}>
            <th className="py-1 pr-3">
              <NodeSortBtn col="name" active={sortKey} dir={sortDir} onSort={handleSort}>Name</NodeSortBtn>
            </th>
            <th className="py-1 pr-3">
              <NodeSortBtn col="kind" active={sortKey} dir={sortDir} onSort={handleSort}>Kind</NodeSortBtn>
            </th>
            <th className="py-1 pr-3">
              <NodeSortBtn col="app" active={sortKey} dir={sortDir} onSort={handleSort}>App</NodeSortBtn>
            </th>
            <th className="py-1">
              <NodeSortBtn col="file" active={sortKey} dir={sortDir} onSort={handleSort}>File</NodeSortBtn>
            </th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((n) => (
            <tr
              key={n.symbol_id}
              className="border-b"
              style={{ borderColor: 'rgba(230,237,243,0.06)' }}
            >
              <td className="py-1 pr-3 font-mono" style={{ color: 'rgba(230,237,243,0.7)' }}>{n.name ?? n.symbol_id}</td>
              <td className="py-1 pr-3" style={{ color: 'rgba(230,237,243,0.45)' }}>{n.kind ?? '—'}</td>
              <td className="py-1 pr-3" style={{ color: 'rgba(230,237,243,0.45)' }}>{n.app ?? '—'}</td>
              <td className="py-1" style={{ color: 'rgba(230,237,243,0.35)' }} title={n.file}>
                <div className="truncate max-w-xs">{n.file ?? '—'}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CoverageView(): React.ReactElement {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { report: r } = await api.getCoverageReport();
      setReport(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: '#e6edf3' }}>Coverage gate</h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded px-2 py-1 text-[11px] disabled:opacity-50"
          style={{ border: '1px solid rgba(230,237,243,0.1)', color: 'rgba(230,237,243,0.6)' }}
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && (
        <p className="rounded px-3 py-2 text-xs" style={{ background: 'rgba(248,81,73,0.08)', color: '#f85149' }}>
          {error}
        </p>
      )}

      {!loading && !error && report === null && (
        <p className="text-xs" style={{ color: 'rgba(230,237,243,0.4)' }}>
          No coverage data — run{' '}
          <code className="font-mono" style={{ color: 'rgba(230,237,243,0.6)' }}>wicked-core rules ingest</code>{' '}
          to populate.
        </p>
      )}

      {report && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold" style={{ color: '#e6edf3' }}>{pct(report.coverage)}</span>
            <GateStatus coverage={report.coverage} threshold={report.resolve_threshold} />
          </div>

          <Ledger report={report} />

          {report.per_app.length > 0 && (
            <section className="flex flex-col gap-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
                Per-app
              </p>
              <PerAppTable apps={report.per_app} />
            </section>
          )}

          <section className="flex flex-col gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider font-mono" style={{ color: 'rgba(230,237,243,0.4)' }}>
              Coverage holes ({report.unaccounted})
            </p>
            <UnaccountedList nodes={report.unaccounted_nodes} />
          </section>
        </>
      )}
    </div>
  );
}
