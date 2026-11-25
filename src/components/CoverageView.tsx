import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import type { CoveragePerApp, CoverageReport, GraphKind, RepoEntry, UnaccountedNode } from '../api/types.js';

/**
 * studio#1289: how long one coverage read may take before the pane stops waiting and offers Try again. On a loaded host
 * the read sat for 20 s and more behind a lone disabled "Loading…" button, with nothing said.
 */
export const COVERAGE_READ_TIMEOUT_MS = 30_000;

/** The read passed {@link COVERAGE_READ_TIMEOUT_MS}. */
class CoverageReadTimeout extends Error {}

type SortKey = 'name' | 'kind' | 'file' | 'app';
type SortDir = 'asc' | 'desc';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** Coverage as a percentage, or an em dash when there is nothing to take a ratio over.
 *
 *  `coverage` is `(resolved + risk_flagged) / behavior_bearing`, which the engine documents as
 *  "vacuously 1.0 when behavior_bearing == 0". Rendering that as "100.0%" told an operator their
 *  unannotated repo was fully covered (FINDING-009). 0/0 is undefined, not complete. */
export function coveragePct(r: { behavior_bearing: number; coverage: number; unaccounted: number }): string {
  if (r.behavior_bearing === 0) return '—';
  // Never let ROUNDING claim a completeness the gate denies. 9,999 of 10,000 is 99.99%, which
  // `toFixed(1)` renders as "100.0%" — displayed next to a GATE FAIL badge, since the engine gates
  // on the exact integer `unaccounted`. wicked-core's own comment names this trap: "on a large
  // graph a handful of bare nodes still round to 1.0000". Flagged in review of this change.
  if (r.unaccounted > 0 && r.coverage * 100 >= 99.95) return '<100%';
  return pct(r.coverage);
}

/** A percentage, or an em dash when its denominator is empty.
 *
 *  `coverage` is not the only vacuous ratio on this screen — `resolved_rate` is
 *  `resolved / (resolved + risk_flagged)` and `mean_confidence` is a mean over the RESOLVED set.
 *  On an unannotated repo all three have an empty denominator, and all three were rendering as
 *  100.0%. Fixing only `coverage` (the one the finding named) would have left two more of the same
 *  lie on the same card — the N-paths-one-hardened shape this codebase keeps paying for. */
function ratioPct(value: number, denominator: number): string {
  return denominator === 0 ? '—' : pct(value);
}

/** The gate's ACTUAL rule, as the engine states it (FINDING-009).
 *
 *  This badge used to be `coverage >= resolve_threshold`, which is wrong twice over:
 *
 *  1. `resolve_threshold` is the ANNOTATION-CONFIDENCE bar — "at/above which a `business_rule`
 *     annotation counts as RESOLVED" (default 0.75). It is not a coverage bar. Comparing a
 *     coverage ratio against it compares two different quantities.
 *  2. The engine gates on the exact integer `unaccounted == 0`, deliberately NOT on the rounded
 *     coverage float (`domain_model.rs`: on a large graph a handful of bare nodes still round to
 *     1.0000). Since wicked-core#190 it also requires `behavior_bearing >= 1`, so an unannotated
 *     repo cannot pass vacuously.
 *
 *  Measured divergence against the old rule — it claimed PASS in three of four cases where the
 *  engine denies, agreeing only when everything really was accounted:
 *
 *      case                bb   unacc   cov    old badge    engine
 *      unannotated repo     0       0   1.00   GATE PASS    DENY
 *      partly annotated   100      10   0.90   GATE PASS    DENY
 *      mostly annotated   100      20   0.80   GATE PASS    DENY
 *      fully annotated    100       0   1.00   GATE PASS    pass
 *
 *  A badge that re-derives a verdict from the wrong inputs is not a status, it is a second opinion
 *  presented as the first. The fields it needs were already on the report and already rendered two
 *  rows below; only this comparison was wrong. */
function gateVerdict(report: CoverageReport): 'pass' | 'deny' | 'no-data' {
  if (report.behavior_bearing === 0) return 'no-data';
  return report.unaccounted === 0 ? 'pass' : 'deny';
}

function GateStatus({ report }: { report: CoverageReport }): React.ReactElement {
  const verdict = gateVerdict(report);
  // `no-data` is called out separately rather than folded into FAIL: "nothing has been extracted
  // yet" and "extraction left holes" are different problems with different next actions, and
  // collapsing them is the defect this file already carries a note about.
  const style = {
    pass: { bg: 'var(--status-run-dim)', fg: 'var(--status-run)', bd: 'var(--status-run-dim)', label: 'GATE PASS' },
    deny: { bg: 'var(--status-fail-dim)', fg: 'var(--status-fail)', bd: 'var(--status-fail-dim)', label: 'GATE FAIL' },
    'no-data': {
      bg: 'var(--surface-raised)',
      fg: 'var(--ink-muted)',
      bd: 'var(--surface-raised)',
      label: 'NOT EXTRACTED',
    },
  }[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold font-mono"
      style={{ background: style.bg, color: style.fg, border: `1px solid ${style.bd}` }}
      title={
        verdict === 'no-data'
          ? 'No behavior-bearing nodes: nothing has been annotated, so coverage is undefined rather than complete.'
          : `Gate rule: behavior_bearing >= 1 and unaccounted == 0 (currently ${report.behavior_bearing} and ${report.unaccounted}).`
      }
    >
      {style.label}
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
    { label: 'Coverage', value: coveragePct(report) },
    { label: 'Resolved rate', value: ratioPct(report.resolved_rate, report.resolved + report.risk_flagged) },
    { label: 'Mean confidence', value: ratioPct(report.mean_confidence, report.resolved) },
    { label: 'Threshold', value: pct(report.resolve_threshold) },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
      {stats.map(({ label, value }) => (
        <div
          key={label}
          className="rounded p-2 text-center"
          style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-card)' }}
        >
          <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>{label}</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function PerAppTable({ apps }: { apps: CoveragePerApp[] }): React.ReactElement {
  if (apps.length === 0) return <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>No per-app data.</p>;
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b text-left" style={{ borderColor: 'var(--surface-raised)', color: 'var(--ink-dim)' }}>
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
          <tr key={a.app} className="border-b" style={{ borderColor: 'var(--surface-raised)' }}>
            <td className="py-1 pr-3 font-mono" style={{ color: 'var(--ink-muted)' }}>{a.app}</td>
            <td className="py-1 pr-3 text-right" style={{ color: 'var(--ink-muted)' }}>{a.behavior_bearing}</td>
            <td className="py-1 pr-3 text-right" style={{ color: 'var(--status-run)' }}>{a.resolved}</td>
            <td className="py-1 pr-3 text-right" style={{ color: 'var(--status-gate)' }}>{a.risk_flagged}</td>
            <td className="py-1 pr-3 text-right" style={{ color: 'var(--status-fail)' }}>{a.unaccounted}</td>
            <td className="py-1 text-right font-semibold" style={{ color: 'var(--ink-high)' }}>{coveragePct(a)}</td>
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
      style={{ color: active === col ? 'var(--accent)' : 'var(--ink-dim)' }}
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

  const inputStyle = { background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' };

  if (nodes.length === 0) {
    return <p className="text-xs" style={{ color: 'var(--status-run)' }}>No unaccounted nodes — gate is satisfied.</p>;
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
          className="rounded px-2 py-1 text-xs w-48 focus:outline-none"
          style={inputStyle}
        />
        <select
          aria-label="Filter by kind"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="rounded px-2 py-1 text-xs focus:outline-none"
          style={inputStyle}
        >
          <option value="">All kinds</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <select
          aria-label="Filter by app"
          value={appFilter}
          onChange={(e) => setAppFilter(e.target.value)}
          className="rounded px-2 py-1 text-xs focus:outline-none"
          style={inputStyle}
        >
          <option value="">All apps</option>
          {apps.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="ml-auto text-xs" style={{ color: 'var(--ink-dim)' }}>
          {filtered.length} / {nodes.length} hole{nodes.length !== 1 ? 's' : ''}
        </span>
      </div>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b" style={{ borderColor: 'var(--surface-raised)' }}>
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
              style={{ borderColor: 'var(--surface-raised)' }}
            >
              <td className="py-1 pr-3 font-mono" style={{ color: 'var(--ink-muted)' }}>{n.name ?? n.symbol_id}</td>
              <td className="py-1 pr-3" style={{ color: 'var(--ink-muted)' }}>{n.kind ?? '—'}</td>
              <td className="py-1 pr-3" style={{ color: 'var(--ink-muted)' }}>{n.app ?? '—'}</td>
              <td className="py-1" style={{ color: 'var(--ink-dim)' }} title={n.file}>
                <div className="truncate max-w-xs">{n.file ?? '—'}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** studio#1402: crew's answer for a registered repository with no code graph yet. Its coverage read answers
 *  `404 {code: 'not_indexed'}`; its graph summary answers `200 {kinds: [], code: 'not_indexed', error}` (crew#1887),
 *  or the same 404 on a daemon before it. */
const NOT_INDEXED = Symbol('not indexed');
const saysNotIndexed = (b: unknown): boolean =>
  typeof b === 'object' && b !== null && (b as { code?: unknown }).code === 'not_indexed';
function notIndexedOr(e: unknown): typeof NOT_INDEXED {
  if (e instanceof ApiError && e.status === 404 && saysNotIndexed(e.body)) return NOT_INDEXED;
  throw e;
}

export function CoverageView(): React.ReactElement {
  const [report, setReport] = useState<CoverageReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** The last read ran past {@link COVERAGE_READ_TIMEOUT_MS} (studio#1289). */
  const [timedOut, setTimedOut] = useState(false);
  /** The newest read: an older one's late answer (past its deadline, or for another repo) is dropped. */
  const readGen = useRef(0);
  // FINDING-009: coverage is per-repo (computed over the repo's OWN graph). The bare endpoint reads
  // the daemon store and reports a vacuous 1.0 that names no repo, so let the operator pick a repo.
  // `''` = the legacy daemon-wide view (kept so the panel still renders before any repo is chosen).
  const [repos, setRepos] = useState<RepoEntry[]>([]);
  const [repoRef, setRepoRef] = useState<string>('');
  // #122: the repo's code-graph summary (node counts by kind). Only meaningful per-repo — the daemon
  // store has no repo code graph — so it's null for the daemon-wide view.
  const [graphKinds, setGraphKinds] = useState<GraphKind[] | null>(null);
  // studio#1402: the chosen repo has no code graph yet (crew's `not_indexed`), so there is nothing to measure.
  const [notIndexed, setNotIndexed] = useState(false);

  /** Ends the read in flight: its requests and its deadline (a new read, leaving the pane). */
  const endRead = useRef<(() => void) | null>(null);

  const load = useCallback(async () => {
    endRead.current?.();
    const gen = ++readGen.current;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_done, fail) => {
      timer = setTimeout(() => { fail(new CoverageReadTimeout()); ctl.abort(); }, COVERAGE_READ_TIMEOUT_MS);
    });
    endRead.current = () => { clearTimeout(timer); ctl.abort(); };
    setLoading(true);
    setError(null);
    setTimedOut(false);
    // The pane never shows one read's numbers under another's question (a switched repo, a timed-out refresh).
    setReport(null);
    setGraphKinds(null);
    setNotIndexed(false);
    try {
      const signal = ctl.signal;
      // Coverage + graph summary for the chosen repo, in parallel (#122); the daemon-wide view has no code graph.
      const read = repoRef
        ? Promise.all([
          api.getCoverageReportForRepo(repoRef, { signal }).catch(notIndexedOr),
          api.getGraphKindsForRepo(repoRef, { signal }).catch(notIndexedOr),
        ])
          .then(([cov, graph]) => (cov === NOT_INDEXED || graph === NOT_INDEXED || saysNotIndexed(graph)
            ? { report: null, kinds: null, notIndexed: true }
            : { report: cov.report, kinds: graph.kinds as GraphKind[] | null, notIndexed: false }))
          .catch((e: unknown) => { ctl.abort(); throw e; }) // one half failed: end the other
        : api.getCoverageReport({ signal }).then(({ report: r }) => ({ report: r, kinds: null, notIndexed: false }));
      const got = await Promise.race([read, deadline]);
      if (readGen.current !== gen) return;
      setReport(got.report);
      setGraphKinds(got.kinds);
      setNotIndexed(got.notIndexed);
    } catch (e) {
      if (readGen.current !== gen) return;
      if (e instanceof CoverageReadTimeout) setTimedOut(true);
      setError(e instanceof CoverageReadTimeout ? '' : e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
      if (readGen.current === gen) {
        endRead.current = null;
        setLoading(false);
      }
    }
  }, [repoRef]);

  // Leaving the pane ends any read still running and drops its answer.
  useEffect(() => () => { readGen.current += 1; endRead.current?.(); endRead.current = null; }, []);

  // Load the repo list once so the picker can offer real, registered repos.
  useEffect(() => {
    void api
      .listRepos()
      .then(({ repos: rs }) => setRepos(rs))
      .catch(() => setRepos([])); // no repos endpoint / none registered → daemon-wide view only
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Coverage gate</h2>
        <div className="flex items-center gap-2">
          {/* FINDING-009: pick the repo to measure; `All` is the legacy daemon-wide (vacuous) view. */}
          <select
            aria-label="Coverage repo"
            value={repoRef}
            onChange={(e) => setRepoRef(e.target.value)}
            disabled={loading}
            className="rounded px-2 py-1 text-xs disabled:opacity-50"
            style={{ border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)', background: 'transparent' }}
          >
            <option value="">All (daemon)</option>
            {repos.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded px-2 py-1 text-xs disabled:opacity-50"
            style={{ border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* studio#1289: the read in flight is said, not only a disabled button. */}
      {loading && (
        <p role="status" data-testid="coverage-reading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          Reading coverage for {repoRef ? repos.find((r) => r.id === repoRef)?.name ?? 'this repository' : 'all repositories (daemon)'}…
        </p>
      )}

      {error !== null && (
        <div role="alert" data-testid="coverage-error" data-kind={timedOut ? 'timeout' : 'error'} className="flex items-start justify-between gap-3 rounded px-3 py-2 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          <p>
            {timedOut
              ? `Coverage didn’t answer within ${Math.round(COVERAGE_READ_TIMEOUT_MS / 1000)} s. The daemon may be busy; try again in a moment.`
              : <>Coverage couldn’t be read: {error}</>}
          </p>
          <button
            type="button"
            data-testid="coverage-retry"
            onClick={() => void load()}
            className="shrink-0 rounded px-2 py-1 text-xs"
            style={{ border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && error === null && notIndexed && (
        <p data-testid="coverage-not-indexed" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          {repos.find((r) => r.id === repoRef)?.name ?? 'This repository'} is not indexed yet, so there is no coverage to measure. Indexing the repository builds its code graph.
        </p>
      )}

      {!loading && error === null && !notIndexed && report === null && (
        <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          No coverage data — run{' '}
          <code className="font-mono" style={{ color: 'var(--ink-muted)' }}>wicked-core rules ingest</code>{' '}
          to populate. After a graph re-index (migration), re-run the annotation workflow to restore coverage.
        </p>
      )}

      {/* #122: what the repo's estate graph actually holds — node counts by kind. Only for a chosen
          repo (the daemon has no repo code graph). */}
      {graphKinds && (
        <section className="flex flex-col gap-1" aria-label="Code graph summary">
          <p className="text-xs font-semibold font-mono" style={{ color: 'var(--ink-dim)' }}>
            Code graph ({graphKinds.reduce((n, k) => n + k.count, 0)} nodes)
          </p>
          {graphKinds.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--ink-dim)' }}>
              This repo’s graph holds no nodes yet — onboard the repo to populate it.
            </p>
          ) : (
            <table className="text-xs" style={{ color: 'var(--ink-muted)' }}>
              <tbody>
                {graphKinds.map((k) => (
                  <tr key={k.kind}>
                    <td className="pr-4 font-mono">{k.kind}</td>
                    <td className="text-right tabular-nums">{k.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {report && (
        <>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold" style={{ color: 'var(--ink-high)' }}>{coveragePct(report)}</span>
            <GateStatus report={report} />
          </div>

          <Ledger report={report} />

          {report.per_app.length > 0 && (
            <section className="flex flex-col gap-1">
              <p className="text-xs font-semibold font-mono" style={{ color: 'var(--ink-dim)' }}>
                Per-app
              </p>
              <PerAppTable apps={report.per_app} />
            </section>
          )}

          <section className="flex flex-col gap-2">
            <p className="text-xs font-semibold font-mono" style={{ color: 'var(--ink-dim)' }}>
              Coverage holes ({report.unaccounted})
            </p>
            <UnaccountedList nodes={report.unaccounted_nodes} />
          </section>
        </>
      )}
    </div>
  );
}
