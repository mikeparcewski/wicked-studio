import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type { ConformanceRule } from '../api/types.js';
import {
  getWikiMeta,
  getWikiScoreboard,
  isWikiUnsupported,
  listWikiRuleSets,
  parseProvenanceRef,
  scoreboardVerdict,
  SEED_COMMAND,
  SEED_RUNBOOK_PATH,
  SEED_RUNBOOK_URL,
  VERDICT_COPY,
  type WikiMeta,
  type WikiRuleSet,
  type WikiScoreboard,
  type WikiVerdict,
} from '../api/wiki.js';
import { useModalEscape } from './Modal.js';

/**
 * The Architecture Wiki surface (`/wiki`) — THE page that makes the graph-backed wiki exist
 * for humans. Everything else about the wiki is agent-facing (rules.recall / knowledge.recall
 * over estate MCP, gate denials citing rules); without this page no operator knows it is
 * there, so nothing keeps it alive.
 *
 * Four reads, every one with an honest degraded state (the campaigns adoption-seam pattern):
 *  - `GET /governance/wiki/scoreboard` (AW-23) — the health header. 501/route-absent =
 *    "this daemon's engine predates the wiki scoreboard", stated in-band, never an error card.
 *  - `GET /governance/wiki/meta` — seededness. `seeded: false` = the EMPTY state with the
 *    seed-runbook command shown; an unsupported meta route just means the page cannot tell,
 *    so it falls through to the rules browser's own empty copy.
 *  - `GET /governance/rules` — the SHIPPING rules wire; the browser filters client-side.
 *  - `GET /governance/wiki/rulesets` — AW-13 grouping; unsupported = flat list, said plainly.
 *
 * The kill switch (retire) calls the SHIPPING `DELETE /governance/rules/:id` behind a
 * typed-confirmation modal. The reason field is REQUIRED by the modal but the wire does not
 * carry it — deliberately: git is the source of truth (no rules.write), so the reason's
 * durable home is the doc PR that retires the doctrine; the modal echoes it back after the
 * retire so the operator carries it there instead of losing it.
 */

// ── Shared bits ───────────────────────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'var(--status-fail)',
  error: 'var(--status-fail)',
  warn: 'var(--status-gate)',
  info: 'var(--ink-muted)',
};

const VERDICT_COLOR: Record<WikiVerdict, string> = {
  empty: 'var(--ink-dim)',
  decaying: 'var(--status-fail)',
  populated: 'var(--status-done)',
  unproven: 'var(--status-gate)',
};

function SeverityChip({ severity }: { severity: string }): React.ReactElement {
  return (
    <span
      className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold font-mono"
      style={{ background: 'var(--surface-raised)', color: SEVERITY_COLOR[severity] ?? 'var(--ink-muted)' }}
    >
      {severity}
    </span>
  );
}

/** One health-header stat: the number, its label, and the honest sub-line when it cannot be measured. */
function Stat({ testid, label, value, sub }: {
  testid: string;
  label: string;
  value: string;
  sub?: string | undefined;
}): React.ReactElement {
  return (
    <div
      data-testid={testid}
      className="flex flex-col gap-0.5 rounded p-3 min-w-[10rem]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span className="text-lg font-semibold font-mono" style={{ color: 'var(--ink-high)' }}>{value}</span>
      {sub !== undefined && (
        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>{sub}</span>
      )}
    </div>
  );
}

const pct = (v: number | undefined): string => (v === undefined ? '—' : `${Math.round(v)}%`);

// ── The health header (AW-23 scoreboard) ──────────────────────────────────────────────────────

type ScoreboardState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'loaded'; scoreboard: WikiScoreboard };

function HealthHeader({ state }: { state: ScoreboardState }): React.ReactElement {
  if (state.kind === 'loading') {
    return <p data-testid="wiki-health-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Measuring wiki health…</p>;
  }
  if (state.kind === 'unsupported') {
    // The honest adoption state: the daemon is fine, it just predates the AW-23 scoreboard —
    // say that, and say what the page still does (the rules wire below ships today).
    return (
      <p
        data-testid="wiki-health-unsupported"
        className="rounded px-3 py-2 text-xs"
        style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
      >
        This daemon&rsquo;s engine predates the wiki scoreboard — population and connection cannot be
        measured here yet. The rules browser below still reads the live store.
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p data-testid="wiki-health-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
        {state.message}
      </p>
    );
  }
  const sb = state.scoreboard;
  const verdict = scoreboardVerdict(sb);
  return (
    <div data-testid="wiki-health" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="wiki-verdict"
          data-verdict={verdict}
          title={`${VERDICT_COPY[verdict]} (derived in studio from the raw AW-23 signals shown beside it)`}
          className="inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold"
          style={{ color: VERDICT_COLOR[verdict], border: `1px solid ${VERDICT_COLOR[verdict]}` }}
        >
          {verdict}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--ink-dim)' }}>{VERDICT_COPY[verdict]}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Stat
          testid="wiki-stat-rules"
          label="Rules"
          value={`${sb.rules_active} active`}
          sub={`${sb.rules_total} total · ${sb.rules_retired} retired`}
        />
        <Stat
          testid="wiki-stat-typed"
          label="Typed"
          value={sb.typing.available ? pct(sb.typing.percent) : 'not measured'}
          sub={
            sb.typing.available
              ? `${sb.typing.statements_typed} of ${sb.typing.statements_total} statements across ${sb.typing.docs_scanned} docs`
              : sb.typing.reason ?? 'no docs root supplied to the daemon'
          }
        />
        <Stat
          testid="wiki-stat-resolving"
          label="Refs resolving"
          value={sb.connection.rules_with_ref === 0 ? 'no refs' : pct(sb.connection.percent)}
          sub={`${sb.connection.refs_resolving} of ${sb.connection.rules_with_ref} symbol refs · ${sb.connection.rules_linked} rules linked to code`}
        />
        <Stat
          testid="wiki-stat-denials"
          label="Denials citing wiki"
          value={String(sb.evidence.denial_claims)}
          sub={`${sb.evidence.rules_evidenced} rules evidenced · ${sb.evidence.governs_evidence_total} governs-evidence total`}
        />
      </div>
      {!sb.recall_volume.available && (
        <p data-testid="wiki-recall-unavailable" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Recall volume: {sb.recall_volume.reason}
        </p>
      )}
    </div>
  );
}

// ── About this wiki ───────────────────────────────────────────────────────────────────────────

function AboutPanel(): React.ReactElement {
  return (
    <div
      data-testid="wiki-about"
      className="flex flex-col gap-2 rounded p-3 text-[11px]"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
    >
      <p style={{ color: 'var(--ink-high)' }} className="font-semibold">How doctrine gets here</p>
      <p>
        <span className="font-mono">doc PR → rules ingest → fanout → relink</span> — a frontmattered
        markdown doc merges to a repo, <span className="font-mono">wicked-core rules ingest</span> materializes
        its rules (fail-closed), fanout writes every lane (rules, RuleSets, knowledge chunks), and{' '}
        <span className="font-mono">rules relink</span> re-derives the Governs edges into the code the
        rules govern. Re-running the pipeline is idempotent — drift self-heals on the next ingest.
      </p>
      <p style={{ color: 'var(--ink-high)' }} className="font-semibold">How agents consume it</p>
      <p>
        Over estate MCP: <span className="font-mono">rules.recall</span> answers &ldquo;which rules govern this
        code?&rdquo; with provenance citations, and <span className="font-mono">
        knowledge.recall {'{scope_prefix: "wiki:"}'}</span> returns the rationale chunks each carrying its
        source URI. Gate denials cite rule ids, which lead back to the exact doc via the provenance ref.
      </p>
      <p style={{ color: 'var(--ink-high)' }} className="font-semibold">Authoring contract</p>
      <p>
        There is <strong>no rules.write</strong> — git is the source of truth. New or changed doctrine is a
        doc PR that re-ingests; the retire button here is the emergency kill switch only (it withdraws a
        rule from recall now — the doc PR that removes it is still yours to open). Seed runbook +
        authoring contract:{' '}
        <a
          data-testid="wiki-runbook-link"
          href={SEED_RUNBOOK_URL}
          target="_blank"
          rel="noreferrer"
          className="underline"
          style={{ color: 'var(--accent)' }}
        >
          {SEED_RUNBOOK_PATH}
        </a>
      </p>
    </div>
  );
}

// ── The retire kill switch ────────────────────────────────────────────────────────────────────

function RetireModal({ rule, onClose, onRetired }: {
  rule: ConformanceRule;
  onClose: () => void;
  onRetired: (reason: string) => void;
}): React.ReactElement {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useModalEscape(onClose);

  const armed = typed === rule.id && reason.trim() !== '' && !busy;

  const confirm = async (): Promise<void> => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await api.retireConformanceRule(rule.id);
      onRetired(reason.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'var(--scrim)' }}>
      <div
        data-testid="wiki-retire-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Retire ${rule.id}`}
        className="flex w-[28rem] max-w-[92vw] flex-col gap-3 rounded-xl p-4 shadow-2xl"
        style={{ background: 'var(--surface-card)', border: '1px solid var(--status-fail-dim)' }}
      >
        <h3 className="text-sm font-semibold" style={{ color: 'var(--status-fail)' }}>
          Retire {rule.id}
        </h3>
        <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Withdraws this rule from recall and every fan-out lane <em>now</em>. The record stays listed —
          past decisions cite it. Git stays the source of truth: carry your reason into the doc PR that
          retires the doctrine itself.
        </p>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Type the rule id to confirm
          <input
            data-testid="wiki-retire-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={rule.id}
            spellCheck={false}
            className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Reason (required)
          <textarea
            data-testid="wiki-retire-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this rule must stop enforcing now"
            className="min-h-[3.5rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        {error !== null && (
          <p data-testid="wiki-retire-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="wiki-retire-cancel"
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
          <button
            data-testid="wiki-retire-confirm"
            type="button"
            disabled={!armed}
            onClick={() => void confirm()}
            className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
            style={{ background: 'var(--status-fail)', color: 'var(--surface-base)' }}
          >
            {busy ? 'Retiring…' : 'Retire rule'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Rule detail ───────────────────────────────────────────────────────────────────────────────

function DetailRow({ label, testid, children }: {
  label: string;
  testid: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="w-32 shrink-0 text-[10px] uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>{label}</span>
      <span data-testid={testid} className="min-w-0 break-words" style={{ color: 'var(--ink-muted)' }}>{children}</span>
    </div>
  );
}

function RuleDetail({ rule, enforcementClass, evidence, onRetire }: {
  rule: ConformanceRule;
  /** From the meta docs join, when the daemon serves it — the class lives on the DOC. */
  enforcementClass: string | null;
  /** From the scoreboard's per-rule evidence join, when the scoreboard is served. */
  evidence: { denial_claims: number; governs_evidence: number } | null;
  onRetire: (rule: ConformanceRule) => void;
}): React.ReactElement {
  const ref = rule.provenance.ref;
  const parsed = ref !== undefined && ref !== '' ? parseProvenanceRef(ref) : null;
  return (
    <div
      data-testid="wiki-rule-detail"
      className="flex flex-col gap-1.5 rounded p-3"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <DetailRow label="Statement" testid="wiki-rule-statement">{rule.statement}</DetailRow>
      <DetailRow label="Enforcement class" testid="wiki-rule-class">
        {enforcementClass ?? (
          <span title="the class lives in doc frontmatter; this daemon does not serve the per-doc join">—</span>
        )}
      </DetailRow>
      <DetailRow label="Provenance" testid="wiki-rule-provenance">
        {parsed === null ? (
          <span title="this rule carries no provenance ref">—</span>
        ) : parsed.sha === null ? (
          <span className="font-mono" title="legacy ref without a blob digest — re-ingest to stamp one">
            {parsed.path} <span style={{ color: 'var(--status-gate)' }}>(no digest — re-ingest)</span>
          </span>
        ) : (
          <span className="font-mono">{parsed.path}@{parsed.sha.slice(0, 12)}</span>
        )}
      </DetailRow>
      <DetailRow label="Wiki URI" testid="wiki-rule-wiki-uri">
        {ref !== undefined && ref !== '' ? <span className="font-mono">{ref}</span> : '—'}
      </DetailRow>
      <DetailRow label="Evidence" testid="wiki-rule-evidence">
        {evidence === null ? (
          <span title="evidence counts ride the wiki scoreboard, which this daemon does not serve">—</span>
        ) : (
          `${evidence.denial_claims} denial claims · ${evidence.governs_evidence} governs evidence`
        )}
      </DetailRow>
      {rule.symbol_ref !== undefined && (
        <DetailRow label="Symbol ref" testid="wiki-rule-symbol-ref">
          <span className="font-mono">{rule.symbol_ref}</span>
        </DetailRow>
      )}
      <DetailRow label="Confidence" testid="wiki-rule-confidence">{rule.confidence}</DetailRow>
      {rule.compliance !== undefined && (
        <DetailRow label="Compliance" testid="wiki-rule-compliance">
          <span className="font-mono">{rule.compliance.framework} / {rule.compliance.control_id}</span>
        </DetailRow>
      )}
      <div className="flex justify-end pt-1">
        {rule.retired === true ? (
          <span data-testid="wiki-rule-retired-note" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            retired — withdrawn from recall; kept listed because past decisions cite it
          </span>
        ) : (
          <button
            data-testid="wiki-retire-open"
            type="button"
            onClick={() => onRetire(rule)}
            className="rounded px-2 py-1 text-[10px] font-semibold"
            style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
          >
            Retire…
          </button>
        )}
      </div>
    </div>
  );
}

// ── The rules browser ─────────────────────────────────────────────────────────────────────────

type StatusFacet = 'all' | 'active' | 'retired';

interface Facets {
  severity: string;
  layer: string;
  rule_type: string;
  status: StatusFacet;
}

const FACETS_ALL: Facets = { severity: 'all', layer: 'all', rule_type: 'all', status: 'all' };

/** Client-side facet filter over the shipping rules wire — pinned by unit test. */
export function filterRules(rules: ConformanceRule[], f: Facets): ConformanceRule[] {
  return rules.filter((r) => {
    if (f.severity !== 'all' && r.severity !== f.severity) return false;
    if (f.rule_type !== 'all' && r.rule_type !== f.rule_type) return false;
    if (f.layer !== 'all' && (r.targets.layer ?? '') !== f.layer) return false;
    const retired = r.retired === true;
    if (f.status === 'active' && retired) return false;
    if (f.status === 'retired' && !retired) return false;
    return true;
  });
}

function FacetSelect({ testid, label, value, options, onChange }: {
  testid: string;
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--ink-dim)' }}>
      {label}
      <select
        data-testid={testid}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded px-1.5 py-0.5 text-[10px] focus:outline-none"
        style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
      >
        <option value="all">all</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  );
}

function RuleRow({ rule, selected, onSelect }: {
  rule: ConformanceRule;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <button
      data-testid="wiki-rule-row"
      data-rule-id={rule.id}
      type="button"
      aria-expanded={selected}
      onClick={() => onSelect(rule.id)}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] hover:bg-surface-raised"
      style={{
        border: selected ? '1px solid var(--accent)' : '1px solid transparent',
        color: 'var(--ink-muted)',
      }}
    >
      <span className="w-20 shrink-0 font-mono" style={{ color: 'var(--ink-high)' }}>{rule.id}</span>
      <SeverityChip severity={rule.severity} />
      <span className="w-14 shrink-0 text-[10px]" style={{ color: 'var(--ink-dim)' }}>{rule.rule_type}</span>
      <span className="min-w-0 flex-1 truncate">{rule.statement}</span>
      {rule.targets.layer !== undefined && (
        <span className="shrink-0 text-[10px] font-mono" style={{ color: 'var(--ink-dim)' }}>{rule.targets.layer}</span>
      )}
      {rule.retired === true && (
        <span
          data-testid="wiki-rule-retired-chip"
          className="shrink-0 rounded px-1.5 text-[9px] font-semibold uppercase"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-dim)' }}
        >
          retired
        </span>
      )}
    </button>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────

type RuleSetsState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'loaded'; rulesets: WikiRuleSet[] };

export function WikiPage(): React.ReactElement {
  const [scoreboard, setScoreboard] = useState<ScoreboardState>({ kind: 'loading' });
  const [meta, setMeta] = useState<WikiMeta | null>(null);
  const [rules, setRules] = useState<ConformanceRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [rulesets, setRulesets] = useState<RuleSetsState>({ kind: 'loading' });
  const [facets, setFacets] = useState<Facets>(FACETS_ALL);
  const [grouped, setGrouped] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<ConformanceRule | null>(null);
  const [retiredNote, setRetiredNote] = useState<{ id: string; reason: string } | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);

  const loadRules = useCallback(async (): Promise<void> => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const { rules: rs } = await api.listConformanceRules();
      setRules(rs);
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : String(e));
    } finally {
      setRulesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadRules();
    void getWikiScoreboard()
      .then(({ scoreboard: sb }) => setScoreboard({ kind: 'loaded', scoreboard: sb }))
      .catch((e: unknown) => {
        if (isWikiUnsupported(e)) setScoreboard({ kind: 'unsupported' });
        else setScoreboard({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
    void getWikiMeta()
      // `?? null`: a mis-shaped payload (no `meta` wrapper) must degrade exactly like an
      // unanswerable meta route — it is a contract bug to report, never a page crash.
      .then(({ meta: m }) => setMeta(m ?? null))
      // An unsupported (or failed) meta route means the page cannot tell whether the store is
      // seeded — it must NOT claim "unseeded", so meta stays null and the browser's own empty
      // copy covers the zero-rules case.
      .catch(() => setMeta(null));
    void listWikiRuleSets()
      .then(({ rulesets: rss }) => setRulesets({ kind: 'loaded', rulesets: rss }))
      .catch(() => setRulesets({ kind: 'unsupported' }));
  }, [loadRules]);

  const layers = useMemo(
    () => [...new Set(rules.map((r) => r.targets.layer).filter((l): l is string => l !== undefined && l !== ''))].sort(),
    [rules],
  );
  const visible = useMemo(() => filterRules(rules, facets), [rules, facets]);
  const selected = selectedId === null ? null : visible.find((r) => r.id === selectedId) ?? null;

  /** enforcement_class join: rule → provenance path → meta.docs (the class lives on the DOC). */
  const classByPath = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of meta?.docs ?? []) {
      if (typeof d.enforcement_class === 'string' && d.enforcement_class !== '') m.set(d.path, d.enforcement_class);
    }
    return m;
  }, [meta]);
  const classOf = (r: ConformanceRule): string | null => {
    const ref = r.provenance.ref;
    if (ref === undefined || ref === '') return null;
    return classByPath.get(parseProvenanceRef(ref).path) ?? null;
  };

  /** evidence_count join: the AW-23 per-rule evidence rows, when the scoreboard is served. */
  const evidenceOf = (id: string): { denial_claims: number; governs_evidence: number } | null => {
    if (scoreboard.kind !== 'loaded') return null;
    const row = scoreboard.scoreboard.evidence.per_rule.find((r) => r.rule_id === id);
    return row ?? { denial_claims: 0, governs_evidence: 0 };
  };

  const onRetired = (reason: string): void => {
    const id = retiring?.id ?? '';
    setRetiring(null);
    setRetiredNote({ id, reason });
    // Reload so the row shows the SERVER's state, never this surface's optimism.
    void loadRules();
  };

  /** RuleSet grouping: domain → member rules (of the currently visible set), plus the ungrouped rest. */
  const groups = useMemo(() => {
    if (rulesets.kind !== 'loaded') return null;
    const byId = new Map(visible.map((r) => [r.id, r]));
    const claimed = new Set<string>();
    const out: { domain: string; rules: ConformanceRule[] }[] = [];
    for (const rs of rulesets.rulesets) {
      const members = rs.rule_ids.flatMap((id) => {
        const r = byId.get(id);
        if (r === undefined) return [];
        claimed.add(id);
        return [r];
      });
      if (members.length > 0) out.push({ domain: rs.domain, rules: members });
    }
    const ungrouped = visible.filter((r) => !claimed.has(r.id));
    if (ungrouped.length > 0) out.push({ domain: 'ungrouped', rules: ungrouped });
    return out;
  }, [rulesets, visible]);

  const detailFor = (r: ConformanceRule): React.ReactElement => (
    <RuleDetail rule={r} enforcementClass={classOf(r)} evidence={evidenceOf(r.id)} onRetire={setRetiring} />
  );

  const listBody = (): React.ReactElement => {
    if (rulesLoading) {
      return <p data-testid="wiki-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>;
    }
    if (rulesError !== null) {
      return (
        <p data-testid="wiki-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {rulesError}
        </p>
      );
    }
    if (visible.length === 0) {
      return (
        <p data-testid="wiki-rules-empty" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          {rules.length === 0 ? 'No rules in the store.' : 'No rules match these facets.'}
        </p>
      );
    }
    if (grouped && groups !== null) {
      return (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.domain} data-testid="wiki-ruleset-group" data-domain={g.domain}>
              <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--ink-dim)' }}>
                {g.domain} <span className="font-normal">({g.rules.length})</span>
              </h3>
              <div className="flex flex-col gap-0.5">
                {g.rules.map((r) => (
                  <div key={r.id}>
                    <RuleRow rule={r} selected={selected?.id === r.id} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
                    {selected?.id === r.id && detailFor(r)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-0.5">
        {visible.map((r) => (
          <div key={r.id}>
            <RuleRow rule={r} selected={selected?.id === r.id} onSelect={(id) => setSelectedId(id === selectedId ? null : id)} />
            {selected?.id === r.id && detailFor(r)}
          </div>
        ))}
      </div>
    );
  };

  // The EMPTY state is keyed on an EXPLICIT `seeded: false` from the meta route — a daemon that
  // cannot answer must not be accused of an unseeded store.
  if (meta !== null && meta.seeded === false) {
    return (
      <div data-testid="wiki-page" className="flex max-w-4xl flex-col gap-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Architecture Wiki</h2>
        <div
          data-testid="wiki-unseeded"
          className="flex flex-col gap-2 rounded p-4"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
            Wiki not seeded — run the seed runbook.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            No doctrine has been ingested into this store yet. The seed corpus and the repeatable
            driver live at{' '}
            <a href={SEED_RUNBOOK_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
              {SEED_RUNBOOK_PATH}
            </a>:
          </p>
          <code
            data-testid="wiki-seed-command"
            className="overflow-x-auto whitespace-pre rounded px-2 py-1.5 font-mono text-[10px]"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            {SEED_COMMAND}
          </code>
        </div>
        <AboutPanel />
      </div>
    );
  }

  return (
    <div data-testid="wiki-page" className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>Architecture Wiki</h2>
        <button
          data-testid="wiki-about-toggle"
          type="button"
          aria-expanded={aboutOpen}
          onClick={() => setAboutOpen((v) => !v)}
          className="text-[10px] hover:underline"
          style={{ color: 'var(--accent)' }}
        >
          {aboutOpen ? 'Hide' : 'About this wiki'}
        </button>
        <button
          type="button"
          onClick={() => void loadRules()}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Refresh
        </button>
      </div>

      {aboutOpen && <AboutPanel />}

      <HealthHeader state={scoreboard} />

      {retiredNote !== null && (
        <p
          data-testid="wiki-retired-note"
          className="rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          Retired <span className="font-mono">{retiredNote.id}</span> — withdrawn from recall. Carry your
          reason into the doc PR that retires the doctrine: <em>&ldquo;{retiredNote.reason}&rdquo;</em>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <FacetSelect
          testid="wiki-filter-severity"
          label="severity"
          value={facets.severity}
          options={['critical', 'error', 'warn', 'info']}
          onChange={(v) => setFacets((f) => ({ ...f, severity: v }))}
        />
        <FacetSelect
          testid="wiki-filter-layer"
          label="layer"
          value={facets.layer}
          options={layers}
          onChange={(v) => setFacets((f) => ({ ...f, layer: v }))}
        />
        <FacetSelect
          testid="wiki-filter-type"
          label="type"
          value={facets.rule_type}
          options={['pattern', 'policy']}
          onChange={(v) => setFacets((f) => ({ ...f, rule_type: v }))}
        />
        <FacetSelect
          testid="wiki-filter-status"
          label="status"
          value={facets.status}
          options={['active', 'retired']}
          onChange={(v) => setFacets((f) => ({ ...f, status: v as StatusFacet }))}
        />
        {rulesets.kind === 'loaded' ? (
          <button
            data-testid="wiki-group-toggle"
            type="button"
            aria-pressed={grouped}
            onClick={() => setGrouped((v) => !v)}
            className="ml-auto rounded px-2 py-0.5 text-[10px] font-semibold"
            style={{
              border: '1px solid var(--surface-raised)',
              background: grouped ? 'var(--surface-raised)' : 'var(--surface-rail)',
              color: 'var(--ink-high)',
            }}
          >
            {grouped ? 'Flat list' : 'Group by RuleSet'}
          </button>
        ) : rulesets.kind === 'unsupported' ? (
          <span data-testid="wiki-groups-unsupported" className="ml-auto text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            RuleSet grouping is not served by this daemon — flat list
          </span>
        ) : null}
      </div>

      {listBody()}

      {retiring !== null && (
        <RetireModal rule={retiring} onClose={() => setRetiring(null)} onRetired={onRetired} />
      )}
    </div>
  );
}
