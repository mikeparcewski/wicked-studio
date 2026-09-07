import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import {
  isProposalsUnsupported,
  listProposals,
  proposalKind,
  type Proposal,
} from '../api/proposals.js';
import {
  isMemoryUnsupported,
  listMemories,
  memoryCoverage,
  MEMORY_UNSUPPORTED_COPY,
  type MemoryItem,
} from '../api/memory.js';
import {
  memoriesPath,
  policiesPath,
  steeringTypeOf,
  STEERING_TYPE_LABELS,
  type SteeringRule,
} from '../api/steering.js';
import type { Navigate } from '../hooks/useRoute.js';
import { KpiBand, KpiGroup, StatTile } from './dashboardKit.js';
import { ProposalsSection } from './ProposalsSection.js';
import { FacetAutocomplete } from './FacetAutocomplete.js';
import { KeyValueChips } from './ProposalChips.js';
import { SeverityChip } from './SteeringChips.js';

/**
 * The GOVERNED-KNOWLEDGE dashboard (`/steering/dashboard`) — the review-forward Steering home
 * (DES-MEM-FACETED-001; governed-knowledge dashboard). The propose→promote recommendations are the
 * most valuable output of the estate, and they used to sit BURIED at the bottom of two long
 * management pages (policy proposals under the full policies grid, memory proposals under the memory
 * browser). This surface un-buries them: one place, prominent, both kinds together.
 *
 * Three parts, top to bottom (the SAME dashboard kit /projects wears — KpiBand / KpiGroup /
 * StatTile, so the two command surfaces read as one system):
 *  1. a KPI band — Needs review (the un-buried headline: pending proposals, memory + policy), the
 *     store size (Memories), and the Active-rules count with a severity breakdown;
 *  2. the REVIEW inbox — the consolidated propose→promote queue, BOTH kinds side by side, approve/
 *     reject inline (two reused {@link ProposalsSection}s under one Review heading);
 *  3. BROWSE — the memory store and the rule corpus, each narrowed by the `key=value` facet
 *     TYPEAHEAD ({@link FacetAutocomplete}); each row deep-links into its management deep-dive.
 *
 * Every read is best-effort and degrades honestly: a daemon that predates a wire renders its
 * unsupported/empty state in-band, never an error wall.
 */

const CSS = {
  page: { padding: 'var(--space-5) var(--space-6)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' },
  name: {
    fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)',
    fontFamily: 'var(--font-sans)', color: 'var(--ink-high)', margin: 0,
  },
  sub: { fontSize: 'var(--text-xs)', color: 'var(--ink-muted)', margin: '4px 0 0' },
  sectionHead: {
    fontSize: 'var(--text-2xs)', fontWeight: 'var(--weight-bold)',
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'var(--ink-muted)', margin: '0 0 8px',
  },
  deepLink: {
    fontSize: 'var(--text-2xs)', fontFamily: 'var(--font-mono)',
    color: 'var(--accent)', textDecoration: 'none', whiteSpace: 'nowrap',
  },
} as const satisfies Record<string, React.CSSProperties>;

/** The `key=value` facets a rule carries for the browse typeahead: its type, severity, each
 *  non-empty target, and its inclusion facets — the vocabulary the caller derives from the rows. */
function ruleFacets(r: SteeringRule): string[] {
  const out = [`type=${steeringTypeOf(r)}`, `severity=${r.severity}`];
  for (const [k, v] of Object.entries(r.targets ?? {})) if (typeof v === 'string' && v !== '') out.push(`${k}=${v}`);
  for (const v of r.applies_to ?? []) if (v !== '') out.push(`applies_to=${v}`);
  return out;
}

export function GovernanceDashboard({ navigate }: { navigate: Navigate }): React.ReactElement {
  // ── The three best-effort KPI reads ────────────────────────────────────────
  const [pending, setPending] = useState<Proposal[] | null>(null);
  const [proposalsUnsupported, setProposalsUnsupported] = useState(false);
  const [proposalsError, setProposalsError] = useState(false);
  const [coverageTotal, setCoverageTotal] = useState<number | null>(null);
  const [rules, setRules] = useState<SteeringRule[]>([]);

  const loadPending = useCallback(async (): Promise<void> => {
    try {
      const ps = await listProposals({ state: 'pending' });
      setPending(ps);
      setProposalsUnsupported(false);
      setProposalsError(false);
    } catch (e) {
      if (isProposalsUnsupported(e)) {
        setProposalsUnsupported(true);
        setPending([]);
      } else {
        // A real load failure must NOT read as "0 needs review" (an empty list is
        // indistinguishable from "no proposals"). Keep pending unknown (null) and flag the error so
        // the tile renders "—", never a fabricated zero.
        setProposalsError(true);
        setPending(null);
      }
    }
  }, []);

  const loadCoverage = useCallback((): void => {
    void memoryCoverage()
      .then((c) => setCoverageTotal(typeof c.total === 'number' ? c.total : null))
      .catch(() => setCoverageTotal(null));
  }, []);

  const loadRules = useCallback((): void => {
    void api.listConformanceRules()
      .then(({ rules: rs }) => setRules(rs as SteeringRule[]))
      .catch(() => setRules([]));
  }, []);

  useEffect(() => { void loadPending(); loadCoverage(); loadRules(); }, [loadPending, loadCoverage, loadRules]);

  const refreshHeadline = useCallback((): void => { void loadPending(); loadCoverage(); loadRules(); }, [loadPending, loadCoverage, loadRules]);

  const memPending = useMemo(() => (pending ?? []).filter((p) => proposalKind(p) === 'memory').length, [pending]);
  const polPending = useMemo(() => (pending ?? []).filter((p) => proposalKind(p) === 'policy').length, [pending]);
  const needsReview = memPending + polPending;

  const activeRules = useMemo(() => rules.filter((r) => r.retired !== true), [rules]);
  const sev = useMemo(() => {
    const s = { critical: 0, error: 0, warn: 0, info: 0 } as Record<string, number>;
    for (const r of activeRules) if (r.severity in s) s[r.severity] = (s[r.severity] ?? 0) + 1;
    return s;
  }, [activeRules]);

  const link = (path: string): { href: string; onClick: (e: React.MouseEvent) => void } => ({
    href: path,
    onClick: (e) => { e.preventDefault(); navigate(path); },
  });

  return (
    <div data-testid="governance-dashboard" className="flex-1 overflow-y-auto" style={CSS.page}>
      {/* ── Header ── */}
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <h1 style={CSS.name}>Governed Knowledge</h1>
          <span style={{ flex: 1 }} />
          <a {...link(policiesPath())} data-testid="governance-manage-policies" style={CSS.deepLink}>Manage policies →</a>
          <a {...link(memoriesPath())} data-testid="governance-manage-memories" style={CSS.deepLink}>Manage memories →</a>
          <button
            type="button"
            data-testid="governance-refresh"
            onClick={refreshHeadline}
            className="text-[10px] hover:underline"
            style={{ color: 'var(--ink-dim)' }}
          >
            Refresh
          </button>
        </div>
        <p style={CSS.sub}>
          The propose→promote recommendations — reviewed here, in one place, both kinds together.
          Policies and Memories remain the deep-dives for managing what is already promoted.
        </p>
      </header>

      {/* ── 1. KPI band ── */}
      <KpiBand testId="governance-kpis">
        <KpiGroup label="Review" grow={1}>
          <StatTile
            testId="gk-stat-needs-review"
            label="Needs review"
            value={proposalsUnsupported || proposalsError ? '—' : needsReview}
            valueColor={!proposalsError && needsReview > 0 ? 'var(--status-gate)' : undefined}
            context={
              proposalsUnsupported ? 'not served by this daemon'
                : proposalsError ? 'could not load — refresh'
                : needsReview === 0 ? 'nothing waiting'
                : `${memPending} memory · ${polPending} policy`
            }
            title="Pending proposals awaiting your approval — the review inbox is below"
          />
        </KpiGroup>
        <KpiGroup label="Knowledge" grow={2}>
          <StatTile
            testId="gk-stat-memories"
            label="Memories"
            value={coverageTotal ?? '—'}
            context={coverageTotal === null ? 'store size unavailable' : 'in the store'}
            title="Total memories in the store — open the Memories deep-dive"
            {...link(memoriesPath())}
            onOpen={() => navigate(memoriesPath())}
          />
          <StatTile
            testId="gk-stat-rules"
            label="Active rules"
            value={activeRules.length}
            context={`crit ${sev.critical} · err ${sev.error} · warn ${sev.warn}`}
            title="Active conformance rules by severity — open the Policies deep-dive"
            {...link(policiesPath())}
            onOpen={() => navigate(policiesPath())}
          />
        </KpiGroup>
        {/* TODO(date-filters): once api-types 0.23.0 lands the created_at/promoted_at wire fields,
            add a "Recently promoted" StatTile here (promotions in the last N days, with a delta). */}
      </KpiBand>

      {/* ── 2. Review inbox — the un-burying: both kinds, one place, approve/reject inline ── */}
      <section
        data-testid="governance-review"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--status-gate-dim)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)' }}
      >
        <p style={{ ...CSS.sectionHead, color: 'var(--status-gate)' }}>Review inbox</p>
        <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--ink-dim)', margin: '0 0 12px' }}>
          Agent-proposed memories and policies, each pending until you approve or reject it — the two
          queues that used to be buried at the bottom of the management pages, now front and center.
        </p>
        <div
          data-testid="governance-review-inbox"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 360px), 1fr))', gap: 'var(--space-4)', alignItems: 'start' }}
        >
          <ProposalsSection kind="memory" heading="Memory proposals" onDecision={refreshHeadline} />
          <ProposalsSection kind="policy" heading="Policy proposals" onDecision={refreshHeadline} />
        </div>
      </section>

      {/* ── 3. Browse — memory store + rule corpus, each with the facet typeahead ── */}
      <section data-testid="governance-browse" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        <p style={CSS.sectionHead}>Browse</p>
        <MemoriesBrowse link={link} />
        <RulesBrowse rules={activeRules} link={link} />
      </section>
    </div>
  );
}

// ── The memory-store browse (read-only preview; retire lives in the Memories deep-dive) ──────────

function MemoriesBrowse({ link }: {
  link: (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };
}): React.ReactElement {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [unsupported, setUnsupported] = useState(false);
  const [facet, setFacet] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listMemories()
      .then((rows) => { if (!cancelled) { setMemories(rows); setUnsupported(false); } })
      .catch((e: unknown) => { if (!cancelled) { setMemories([]); if (isMemoryUnsupported(e)) setUnsupported(true); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const facetPairs = useMemo(() => {
    const seen = new Set<string>();
    for (const m of memories) for (const [k, v] of Object.entries(m.facets)) seen.add(`${k}=${v}`);
    return [...seen].sort();
  }, [memories]);

  const visible = useMemo(() => {
    if (facet === null) return memories;
    const [k, v] = facet.split(/=(.*)/s);
    return memories.filter((m) => m.facets[k ?? ''] === v);
  }, [memories, facet]);

  return (
    <div data-testid="gk-browse-memories" className="flex flex-col gap-2 rounded p-3" style={{ border: '1px solid var(--surface-raised)' }}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
          Memories <span className="ml-1 font-mono" style={{ color: 'var(--ink-dim)' }}>({memories.length})</span>
        </h3>
        <span className="flex-1" />
        <a {...link(memoriesPath())} data-testid="gk-browse-memories-manage" style={CSS.deepLink}>Manage memories →</a>
      </div>
      {facetPairs.length > 0 && (
        <FacetAutocomplete
          testId="gk-memories-facet"
          options={facetPairs}
          value={facet}
          onChange={setFacet}
          label="Filter memories by facet"
        />
      )}
      {loading ? (
        <p data-testid="gk-memories-loading" className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>Loading memories…</p>
      ) : unsupported ? (
        <p data-testid="gk-memories-unsupported" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {MEMORY_UNSUPPORTED_COPY}
        </p>
      ) : visible.length === 0 ? (
        <p data-testid="gk-memories-empty" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {memories.length === 0 ? 'No memories in the store.' : 'No memories match this facet.'}
        </p>
      ) : (
        <ul data-testid="gk-memories-list" className="flex flex-col gap-2">
          {visible.slice(0, 20).map((m) => (
            <li
              key={m.id}
              data-testid="gk-memory-row"
              data-memory-id={m.id}
              className="flex flex-col gap-1.5 rounded p-2.5"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
            >
              <span className="break-words text-[11px]" style={{ color: 'var(--ink-body)' }}>{m.content}</span>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <span className="rounded px-1.5 py-0.5 font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>{m.tier}</span>
                <span className="font-mono" style={{ color: 'var(--ink-dim)' }}>{m.scope}</span>
                <KeyValueChips testid="gk-memory-facets" entries={m.facets} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── The rule-corpus browse (read-only preview; edit/retire live in the Policies deep-dive) ───────

function RulesBrowse({ rules, link }: {
  rules: SteeringRule[];
  link: (path: string) => { href: string; onClick: (e: React.MouseEvent) => void };
}): React.ReactElement {
  const [facet, setFacet] = useState<string | null>(null);

  const facetPairs = useMemo(() => {
    const seen = new Set<string>();
    for (const r of rules) for (const f of ruleFacets(r)) seen.add(f);
    return [...seen].sort();
  }, [rules]);

  const visible = useMemo(
    () => (facet === null ? rules : rules.filter((r) => ruleFacets(r).includes(facet))),
    [rules, facet],
  );

  return (
    <div data-testid="gk-browse-rules" className="flex flex-col gap-2 rounded p-3" style={{ border: '1px solid var(--surface-raised)' }}>
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
          Active rules <span className="ml-1 font-mono" style={{ color: 'var(--ink-dim)' }}>({rules.length})</span>
        </h3>
        <span className="flex-1" />
        <a {...link(policiesPath())} data-testid="gk-browse-rules-manage" style={CSS.deepLink}>Manage policies →</a>
      </div>
      {facetPairs.length > 0 && (
        <FacetAutocomplete
          testId="gk-rules-facet"
          options={facetPairs}
          value={facet}
          onChange={setFacet}
          label="Filter rules by facet"
        />
      )}
      {visible.length === 0 ? (
        <p data-testid="gk-rules-empty" className="rounded px-3 py-2 text-[11px]" style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {rules.length === 0 ? 'No active rules in the corpus.' : 'No rules match this facet.'}
        </p>
      ) : (
        <ul data-testid="gk-rules-list" className="flex flex-col gap-2">
          {visible.slice(0, 20).map((r) => (
            <li
              key={r.id}
              data-testid="gk-rule-row"
              data-rule-id={r.id}
              className="flex flex-col gap-1.5 rounded p-2.5"
              style={{ background: 'var(--surface-card)', border: '1px solid var(--surface-raised)' }}
            >
              <div className="flex items-start gap-2">
                <span className="font-mono text-[10px]" style={{ color: 'var(--ink-dim)' }}>{r.id}</span>
                <span className="min-w-0 flex-1 break-words text-[11px]" style={{ color: 'var(--ink-body)' }}>{r.statement}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[10px]">
                <SeverityChip severity={r.severity} />
                <span className="rounded px-1.5 py-0.5 font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
                  {STEERING_TYPE_LABELS[steeringTypeOf(r)]}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
