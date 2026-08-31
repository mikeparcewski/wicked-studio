import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  authorSteeringRules,
  importSteeringRules,
  isSteeringUnsupported,
  isValidRuleId,
  nextRuleId,
  steeringPath,
  STEERING_RULE_TEMPLATE,
  STEERING_TYPE_LABELS,
  STEERING_TYPES,
  STEERING_UNSUPPORTED_COPY,
  steeringTypeOf,
  type SteeringEffect,
  type SteeringImportEntry,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';
import {
  getWikiMeta,
  getWikiScoreboard,
  isWikiUnsupported,
  parseProvenanceRef,
  scoreboardVerdict,
  SEED_COMMAND,
  SEED_RUNBOOK_PATH,
  SEED_RUNBOOK_URL,
  VERDICT_COPY,
  type WikiMeta,
  type WikiScoreboard,
  type WikiVerdict,
} from '../api/wiki.js';
import { useGateStore } from '../store/gates.js';
import { useModalEscape } from './Modal.js';
import { SteeringGate } from './SteeringGate.js';

/**
 * The Steering surface (`/steering/:type`) — ONE page component parameterized by steering type,
 * seven sub-pages (Architecture … Design/UX). The STEERING program's user-facing reshape: the
 * wiki/rules model and the old policies model are ONE steering-rule model now, and this surface
 * replaces both the old Architecture Wiki page and the RuleManager.
 *
 * What generalized from the WikiPage base:
 *  - the health header (AW-23 scoreboard) — per-type numbers when the wire serves
 *    `by_steering_type`, the store-wide numbers labeled as store-wide when it does not, and the
 *    honest "engine predates the scoreboard" state on 501/route-absent;
 *  - the rules browser — client-side facets over the SHIPPING `GET /governance/rules` wire,
 *    page-scoped by `steering_type` (absent = architecture, the engine's serde default), rows
 *    carrying weight, applies_to/excludes and effect badges, detail joining provenance
 *    (path@sha for doc-ingested; `ui`/`chat` first-class for studio-authored) and evidence;
 *  - retire — the typed-confirmation kill switch over `DELETE /governance/rules/:id`
 *    (retired-not-deleted: past decisions must stay resolvable).
 *
 * What is NEW here — full management, the type always inferred FROM THE PAGE:
 *  - Import: a picked `.md` (frontmattered doctrine) or `.json` (rule batch) POSTs to
 *    `/governance/steering/import`; per-entry results render honestly (created/updated/error).
 *  - Add rule / Edit: a real form over the SHIPPING upsert CRUD (`POST /governance/rules`) —
 *    statement, severity, rule_type, applies_to/excludes chips, weight, optional effect+trigger.
 *  - Add with chat: `POST /governance/steering/author` launches the authoring run; its PROPOSE
 *    gate arrives as a normal awaitingHuman frame and renders through the EXISTING SteeringGate
 *    component — no second gate UI.
 * Every management write goes through crew's API (the governed operator path) — estate MCP
 * stays read-only (AW-11).
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

const EFFECT_COLOR: Record<SteeringEffect, string> = {
  deny: 'var(--status-fail)',
  allow_with_conditions: 'var(--status-gate)',
  allow: 'var(--status-done)',
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

/** The effect badge — rendered ONLY when the rule carries an effect; a rule without one is
 *  recall-only, exactly as today, and gets no badge to lie with. */
function EffectBadge({ effect }: { effect: SteeringEffect }): React.ReactElement {
  return (
    <span
      data-testid="steering-effect-badge"
      data-effect={effect}
      className="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold font-mono uppercase"
      style={{ color: EFFECT_COLOR[effect], border: `1px solid ${EFFECT_COLOR[effect]}` }}
    >
      {effect === 'allow_with_conditions' ? 'allow+cond' : effect}
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

/** Read a picked file as text. `File.text()` where the runtime has it (every shipping browser),
 *  the FileReader fallback where it does not (older DOM implementations — jsdom included). */
function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error(`could not read ${file.name}`));
    r.readAsText(file);
  });
}

// ── The health header (AW-23 scoreboard, per-type when served) ───────────────────────────────

type ScoreboardState =
  | { kind: 'loading' }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'loaded'; scoreboard: WikiScoreboard };

function HealthHeader({ state, type }: { state: ScoreboardState; type: SteeringType }): React.ReactElement {
  if (state.kind === 'loading') {
    return <p data-testid="steering-health-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Measuring steering health…</p>;
  }
  if (state.kind === 'unsupported') {
    // The honest adoption state: the daemon is fine, its engine just predates the scoreboard —
    // say that, and say what the page still does (the rules wire below ships today).
    return (
      <p
        data-testid="steering-health-unsupported"
        className="rounded px-3 py-2 text-xs"
        style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
      >
        This daemon&rsquo;s engine predates the governance scoreboard — population and connection cannot
        be measured here yet. The rules browser below still reads the live store.
      </p>
    );
  }
  if (state.kind === 'failed') {
    return (
      <p data-testid="steering-health-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
        {state.message}
      </p>
    );
  }
  const sb = state.scoreboard;
  const verdict = scoreboardVerdict(sb);
  // Per-type numbers ONLY when the wire serves them (`by_steering_type`, steering-model lane);
  // otherwise the store-wide numbers, labeled as store-wide — never a fabricated per-type zero.
  const perType = sb.by_steering_type?.[type];
  return (
    <div data-testid="steering-health" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span
          data-testid="steering-verdict"
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
        {perType !== undefined ? (
          <Stat
            testid="steering-stat-rules-type"
            label={`${STEERING_TYPE_LABELS[type]} rules`}
            value={`${perType.rules_active} active`}
            sub={`${perType.rules_total} total · ${perType.rules_retired} retired`}
          />
        ) : (
          <Stat
            testid="steering-stat-rules"
            label="Rules (store-wide)"
            value={`${sb.rules_active} active`}
            sub={`${sb.rules_total} total · ${sb.rules_retired} retired — this engine reports no per-type split`}
          />
        )}
        <Stat
          testid="steering-stat-typed"
          label="Typed"
          value={sb.typing.available ? pct(sb.typing.percent) : 'not measured'}
          sub={
            sb.typing.available
              ? `${sb.typing.statements_typed} of ${sb.typing.statements_total} statements across ${sb.typing.docs_scanned} docs`
              : sb.typing.reason ?? 'no docs root supplied to the daemon'
          }
        />
        <Stat
          testid="steering-stat-resolving"
          label="Refs resolving"
          value={sb.connection.rules_with_ref === 0 ? 'no refs' : pct(sb.connection.percent)}
          sub={`${sb.connection.refs_resolving} of ${sb.connection.rules_with_ref} symbol refs · ${sb.connection.rules_linked} rules linked to code`}
        />
        <Stat
          testid="steering-stat-denials"
          label="Denials citing rules"
          value={String(sb.evidence.denial_claims)}
          sub={`${sb.evidence.rules_evidenced} rules evidenced · ${sb.evidence.governs_evidence_total} governs-evidence total`}
        />
      </div>
    </div>
  );
}

// ── The retire kill switch (retired-not-deleted) ─────────────────────────────────────────────

function RetireModal({ rule, onClose, onRetired }: {
  rule: SteeringRule;
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
        data-testid="steering-retire-modal"
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
          Withdraws this rule from recall and enforcement <em>now</em>. The record stays listed —
          past gate decisions cite it, and deleting it would break that audit trail. A doc-ingested
          rule&rsquo;s doctrine still lives in its source doc: carry your reason into the doc PR that
          retires it there.
        </p>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Type the rule id to confirm
          <input
            data-testid="steering-retire-confirm-input"
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
            data-testid="steering-retire-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this rule must stop steering now"
            className="min-h-[3.5rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
        {error !== null && (
          <p data-testid="steering-retire-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            data-testid="steering-retire-cancel"
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1 text-[11px]"
            style={{ color: 'var(--ink-muted)', border: '1px solid var(--surface-raised)' }}
          >
            Cancel
          </button>
          <button
            data-testid="steering-retire-confirm"
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

function ChipList({ values }: { values: string[] }): React.ReactElement {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className="rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {v}
        </span>
      ))}
    </span>
  );
}

/** Provenance, honestly per source: doc-ingested refs render `path@sha` (flagging a digest-less
 *  legacy ref), while `ui`/`chat` authorship is FIRST-CLASS — named, never a dash. */
function provenanceText(rule: SteeringRule): React.ReactNode {
  const src = rule.provenance.source;
  const ref = rule.provenance.ref;
  if (ref !== undefined && ref !== '') {
    const parsed = parseProvenanceRef(ref);
    if (parsed.sha === null) {
      return (
        <span className="font-mono" title="legacy ref without a blob digest — re-ingest to stamp one">
          {parsed.path} <span style={{ color: 'var(--status-gate)' }}>(no digest — re-ingest)</span>
        </span>
      );
    }
    return <span className="font-mono">{parsed.path}@{parsed.sha.slice(0, 12)}</span>;
  }
  if (src === 'ui') return <span data-testid="steering-provenance-ui">authored in studio (ui)</span>;
  if (src === 'chat') return <span data-testid="steering-provenance-chat">authored by the chat run (chat)</span>;
  if (src !== '') return <span className="font-mono">{src}</span>;
  return <span title="this rule carries no provenance">—</span>;
}

function RuleDetail({ rule, evidence, onRetire, onEdit }: {
  rule: SteeringRule;
  /** From the scoreboard's per-rule evidence join, when the scoreboard is served. */
  evidence: { denial_claims: number; governs_evidence: number } | null;
  onRetire: (rule: SteeringRule) => void;
  onEdit: (rule: SteeringRule) => void;
}): React.ReactElement {
  return (
    <div
      data-testid="steering-rule-detail"
      className="flex flex-col gap-1.5 rounded p-3"
      style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
    >
      <DetailRow label="Statement" testid="steering-rule-statement">{rule.statement}</DetailRow>
      <DetailRow label="Steering type" testid="steering-rule-type-row">{steeringTypeOf(rule)}</DetailRow>
      <DetailRow label="Applies to" testid="steering-rule-applies">
        {(rule.applies_to?.length ?? 0) > 0 ? <ChipList values={rule.applies_to ?? []} /> : '—'}
      </DetailRow>
      <DetailRow label="Excludes" testid="steering-rule-excludes">
        {(rule.excludes?.length ?? 0) > 0 ? <ChipList values={rule.excludes ?? []} /> : '—'}
      </DetailRow>
      <DetailRow label="Weight" testid="steering-rule-weight">
        {rule.weight !== undefined ? <span className="font-mono">{rule.weight}</span> : (
          <span title="this wire predates weights — the engine defaults to 1.0">— (engine default 1.0)</span>
        )}
      </DetailRow>
      <DetailRow label="Effect" testid="steering-rule-effect">
        {rule.effect !== undefined ? (
          <span className="inline-flex items-center gap-2">
            <EffectBadge effect={rule.effect} />
            {rule.trigger?.contains != null && rule.trigger.contains !== '' && (
              <span className="font-mono text-[10px]" title="trigger.contains — the regex tested over the evaluated context">
                when /{rule.trigger.contains}/
              </span>
            )}
          </span>
        ) : (
          <span title="no effect — this rule informs recall, it never decides a gate">recall-only</span>
        )}
      </DetailRow>
      {(rule.obligations?.length ?? 0) > 0 && (
        <DetailRow label="Obligations" testid="steering-rule-obligations">
          <ChipList values={rule.obligations ?? []} />
        </DetailRow>
      )}
      {rule.criteria !== undefined && rule.criteria !== '' && (
        <DetailRow label="Criteria" testid="steering-rule-criteria">{rule.criteria}</DetailRow>
      )}
      <DetailRow label="Provenance" testid="steering-rule-provenance">{provenanceText(rule)}</DetailRow>
      {rule.provenance.ref !== undefined && rule.provenance.ref !== '' && (
        <DetailRow label="Source URI" testid="steering-rule-source-uri">
          <span className="font-mono">{rule.provenance.ref}</span>
        </DetailRow>
      )}
      <DetailRow label="Evidence" testid="steering-rule-evidence">
        {evidence === null ? (
          <span title="evidence counts ride the governance scoreboard, which this daemon does not serve">—</span>
        ) : (
          `${evidence.denial_claims} denial claims · ${evidence.governs_evidence} governs evidence`
        )}
      </DetailRow>
      {rule.symbol_ref !== undefined && (
        <DetailRow label="Symbol ref" testid="steering-rule-symbol-ref">
          <span className="font-mono">{rule.symbol_ref}</span>
        </DetailRow>
      )}
      <DetailRow label="Confidence" testid="steering-rule-confidence">{rule.confidence}</DetailRow>
      {rule.compliance !== undefined && (
        <DetailRow label="Compliance" testid="steering-rule-compliance">
          <span className="font-mono">{rule.compliance.framework} / {rule.compliance.control_id}</span>
        </DetailRow>
      )}
      <div className="flex items-center justify-end gap-2 pt-1">
        {rule.retired === true ? (
          <span data-testid="steering-rule-retired-note" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            retired — withdrawn from recall and enforcement; kept listed because past decisions cite it
          </span>
        ) : (
          <>
            <button
              data-testid="steering-edit-open"
              type="button"
              onClick={() => onEdit(rule)}
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--accent)', border: '1px solid var(--surface-raised)' }}
            >
              Edit…
            </button>
            <button
              data-testid="steering-retire-open"
              type="button"
              onClick={() => onRetire(rule)}
              className="rounded px-2 py-1 text-[10px] font-semibold"
              style={{ color: 'var(--status-fail)', border: '1px solid var(--status-fail-dim)' }}
            >
              Retire…
            </button>
          </>
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

/** The page-scope + facet predicate over the shipping rules wire — pinned by unit test.
 *  A rule belongs to exactly ONE page: `steeringTypeOf` (absent = architecture). */
export function filterSteeringRules(rules: SteeringRule[], type: SteeringType, f: Facets): SteeringRule[] {
  return rules.filter((r) => {
    if (steeringTypeOf(r) !== type) return false;
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
  rule: SteeringRule;
  selected: boolean;
  onSelect: (id: string) => void;
}): React.ReactElement {
  return (
    <button
      data-testid="steering-rule-row"
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
      {rule.effect !== undefined && <EffectBadge effect={rule.effect} />}
      {rule.weight !== undefined && (
        <span data-testid="steering-rule-weight-chip" className="shrink-0 text-[10px] font-mono" title="weight — ordering within severity + gate priority" style={{ color: 'var(--ink-dim)' }}>
          w={rule.weight}
        </span>
      )}
      {rule.retired === true && (
        <span
          data-testid="steering-rule-retired-chip"
          className="shrink-0 rounded px-1.5 text-[9px] font-semibold uppercase"
          style={{ background: 'var(--surface-raised)', color: 'var(--ink-dim)' }}
        >
          retired
        </span>
      )}
    </button>
  );
}

// ── The Add/Edit form ─────────────────────────────────────────────────────────────────────────

/** A chips editor: type, Enter (or comma) adds; each chip removable. */
function ChipsInput({ testid, label, values, onChange, placeholder }: {
  testid: string;
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}): React.ReactElement {
  const [draft, setDraft] = useState('');
  const commit = (): void => {
    const v = draft.trim().replace(/,+$/, '');
    if (v === '' || values.includes(v)) { setDraft(''); return; }
    onChange([...values, v]);
    setDraft('');
  };
  return (
    <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
      {label}
      <span className="flex flex-wrap items-center gap-1 rounded px-2 py-1" style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)' }}>
        {values.map((v) => (
          <span key={v} data-testid={`${testid}-chip`} className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
            {v}
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="hover:opacity-70"
              style={{ color: 'var(--ink-dim)' }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          data-testid={testid}
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
          }}
          onBlur={commit}
          className="min-w-[8rem] flex-1 bg-transparent text-[11px] focus:outline-none"
          style={{ color: 'var(--ink-high)' }}
        />
      </span>
    </label>
  );
}

interface FormState {
  /** Editing keeps the id/rule_type fixed (INV-C1 binds them); adding derives a fresh id. */
  editing: boolean;
  id: string;
  rule_type: 'pattern' | 'policy';
  statement: string;
  severity: string;
  applies_to: string[];
  excludes: string[];
  weight: string;
  effect: '' | SteeringEffect;
  triggerContains: string;
  /** Carried through an edit untouched — the form does not manage these. */
  base: SteeringRule;
}

function formFromRule(rule: SteeringRule): FormState {
  return {
    editing: true,
    id: rule.id,
    rule_type: rule.rule_type,
    statement: rule.statement,
    severity: rule.severity,
    applies_to: rule.applies_to ?? [],
    excludes: rule.excludes ?? [],
    weight: String(rule.weight ?? 1.0),
    effect: rule.effect ?? '',
    triggerContains: rule.trigger?.contains ?? '',
    base: rule,
  };
}

function freshForm(rules: SteeringRule[], type: SteeringType): FormState {
  const base: SteeringRule = { ...STEERING_RULE_TEMPLATE, steering_type: type };
  return {
    editing: false,
    id: nextRuleId(rules, 'pattern'),
    rule_type: 'pattern',
    statement: '',
    severity: 'warn',
    applies_to: [],
    excludes: [],
    weight: '1.0',
    effect: '',
    triggerContains: '',
    base,
  };
}

function RuleForm({ form, type, rules, onChange, onClose, onSaved }: {
  form: FormState;
  type: SteeringType;
  rules: SteeringRule[];
  onChange: (f: FormState) => void;
  onClose: () => void;
  onSaved: (id: string) => void;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const weightNum = Number(form.weight);
  const idOk = isValidRuleId(form.id, form.rule_type);
  const valid =
    idOk && form.statement.trim() !== '' && Number.isFinite(weightNum) && weightNum >= 0;

  const save = async (): Promise<void> => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    // Everything the form does not manage (confidence, targets, provenance, compliance,
    // obligations, criteria) rides through from `base` untouched; UI authorship stamps
    // provenance source "ui" on NEW rules only — an edit never rewrites where a rule came from.
    const rule: SteeringRule = {
      ...form.base,
      id: form.id.trim(),
      rule_type: form.rule_type,
      statement: form.statement.trim(),
      severity: form.severity as SteeringRule['severity'],
      steering_type: type,
      applies_to: form.applies_to,
      excludes: form.excludes,
      weight: weightNum,
      ...(form.effect !== '' ? { effect: form.effect } : {}),
      ...(form.effect !== '' && form.triggerContains.trim() !== ''
        ? { trigger: { contains: form.triggerContains.trim() } }
        : {}),
    };
    if (form.effect === '') {
      delete rule.effect;
      delete rule.trigger;
    }
    try {
      await api.upsertConformanceRule(rule);
      onSaved(rule.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="steering-rule-form"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          {form.editing ? `Edit ${form.base.id}` : 'Add rule'}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          type: {STEERING_TYPE_LABELS[type]} (this page)
        </span>
        <button
          data-testid="steering-form-cancel"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Cancel
        </button>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Rule type
          <select
            data-testid="steering-form-rule-type"
            aria-label="Rule type"
            value={form.rule_type}
            disabled={form.editing}
            onChange={(e) => {
              const rt = e.target.value as 'pattern' | 'policy';
              // A fresh id follows the prefix (INV-C1 binds PAT⇔pattern, POL⇔policy).
              onChange({ ...form, rule_type: rt, id: nextRuleId(rules, rt) });
            }}
            className="rounded px-1.5 py-1 text-[11px] focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            <option value="pattern">pattern</option>
            <option value="policy">policy</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Id
          <input
            data-testid="steering-form-id"
            type="text"
            value={form.id}
            readOnly={form.editing}
            spellCheck={false}
            onChange={(e) => onChange({ ...form, id: e.target.value })}
            className="w-28 rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{
              background: 'var(--surface-base)',
              border: `1px solid ${idOk ? 'var(--surface-raised)' : 'var(--status-fail)'}`,
              color: 'var(--ink-high)',
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Severity
          <select
            data-testid="steering-form-severity"
            aria-label="Severity"
            value={form.severity}
            onChange={(e) => onChange({ ...form, severity: e.target.value })}
            className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            {['info', 'warn', 'error', 'critical'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Weight
          <input
            data-testid="steering-form-weight"
            type="number"
            step="0.1"
            min="0"
            aria-label="Weight"
            value={form.weight}
            onChange={(e) => onChange({ ...form, weight: e.target.value })}
            className="w-20 rounded px-2 py-1 font-mono text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
        Statement
        <textarea
          data-testid="steering-form-statement"
          value={form.statement}
          onChange={(e) => onChange({ ...form, statement: e.target.value })}
          placeholder="The prescriptive sentence this rule enforces"
          className="min-h-[3rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
          style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
        />
      </label>

      <ChipsInput
        testid="steering-form-applies"
        label="Applies to (phases/tools — inclusion)"
        values={form.applies_to}
        onChange={(v) => onChange({ ...form, applies_to: v })}
        placeholder="add and press Enter"
      />
      <ChipsInput
        testid="steering-form-excludes"
        label="Excludes (exclusion twin)"
        values={form.excludes}
        onChange={(v) => onChange({ ...form, excludes: v })}
        placeholder="add and press Enter"
      />

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Effect (optional — none = recall-only)
          <select
            data-testid="steering-form-effect"
            aria-label="Effect"
            value={form.effect}
            onChange={(e) => onChange({ ...form, effect: e.target.value as FormState['effect'] })}
            className="rounded px-1.5 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            <option value="">none (recall-only)</option>
            <option value="deny">deny</option>
            <option value="allow_with_conditions">allow_with_conditions</option>
            <option value="allow">allow</option>
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Trigger regex (optional; needs an effect)
          <input
            data-testid="steering-form-trigger"
            type="text"
            value={form.triggerContains}
            disabled={form.effect === ''}
            spellCheck={false}
            onChange={(e) => onChange({ ...form, triggerContains: e.target.value })}
            placeholder="contains — tested over the evaluated context"
            className="rounded px-2 py-1 font-mono text-[11px] focus:outline-none disabled:opacity-50"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
        </label>
      </div>

      {error !== null && (
        <p data-testid="steering-form-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          data-testid="steering-form-save"
          type="button"
          disabled={!valid || busy}
          onClick={() => void save()}
          className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          {busy ? 'Saving…' : form.editing ? 'Save changes' : 'Add rule'}
        </button>
        {!idOk && (
          <span className="text-[10px]" style={{ color: 'var(--status-fail)' }}>
            id must match {form.rule_type === 'pattern' ? 'PAT' : 'POL'}-&lt;3–6 digits&gt;
          </span>
        )}
      </div>
    </div>
  );
}

// ── Import ────────────────────────────────────────────────────────────────────────────────────

type ImportState =
  | { kind: 'idle' }
  | { kind: 'busy'; filename: string }
  | { kind: 'unsupported' }
  | { kind: 'failed'; message: string }
  | { kind: 'done'; filename: string; results: SteeringImportEntry[] };

const IMPORT_STATUS_COLOR: Record<SteeringImportEntry['status'], string> = {
  created: 'var(--status-done)',
  updated: 'var(--status-run)',
  error: 'var(--status-fail)',
};

function ImportPanel({ type, state, onPick, onClose }: {
  type: SteeringType;
  state: ImportState;
  onPick: (file: File) => void;
  onClose: () => void;
}): React.ReactElement {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div
      data-testid="steering-import-panel"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Import {STEERING_TYPE_LABELS[type]} rules
        </span>
        <button
          data-testid="steering-import-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
        A frontmattered <span className="font-mono">.md</span> doctrine doc or a{' '}
        <span className="font-mono">.json</span> rule batch — every imported rule lands typed{' '}
        <span className="font-mono">{type}</span> (this page).
      </p>
      <input
        ref={fileInput}
        data-testid="steering-import-file"
        type="file"
        accept=".md,.markdown,.json"
        aria-label="Import steering rules file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) onPick(f);
          e.target.value = '';
        }}
        className="text-[10px]"
        style={{ color: 'var(--ink-muted)' }}
      />
      {state.kind === 'busy' && (
        <p data-testid="steering-import-busy" className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
          Importing {state.filename}…
        </p>
      )}
      {state.kind === 'unsupported' && (
        <p data-testid="steering-import-unsupported" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
          {STEERING_UNSUPPORTED_COPY}
        </p>
      )}
      {state.kind === 'failed' && (
        <p data-testid="steering-import-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {state.message}
        </p>
      )}
      {state.kind === 'done' && (
        <div className="flex flex-col gap-1">
          <p data-testid="steering-import-summary" className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
            {state.filename}: {state.results.filter((r) => r.status === 'created').length} created ·{' '}
            {state.results.filter((r) => r.status === 'updated').length} updated ·{' '}
            {state.results.filter((r) => r.status === 'error').length} failed
          </p>
          {state.results.map((r, i) => (
            <p
              key={`${r.id ?? i}-${i}`}
              data-testid="steering-import-result"
              data-status={r.status}
              className="flex items-baseline gap-2 text-[10px]"
            >
              <span className="font-semibold font-mono" style={{ color: IMPORT_STATUS_COLOR[r.status] }}>{r.status}</span>
              {r.id !== undefined && <span className="font-mono" style={{ color: 'var(--ink-high)' }}>{r.id}</span>}
              <span className="truncate" style={{ color: 'var(--ink-muted)' }}>
                {r.status === 'error' ? r.error ?? 'unspecified error' : r.statement ?? ''}
              </span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Add with chat ─────────────────────────────────────────────────────────────────────────────

function AuthorPanel({ type, onClose, onAuthored }: {
  type: SteeringType;
  onClose: () => void;
  /** Fires when the propose gate resolves — the page reloads rules for the server's state. */
  onAuthored: () => void;
}): React.ReactElement {
  const [instructions, setInstructions] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // The propose gate arrives as a normal awaitingHuman frame on the launched run — the app's
  // one /ws subscription already folds it into the gate store; this panel just watches for it
  // and renders the EXISTING gate card. No second gate UI, no polling.
  const gate = useGateStore((s) => (runId !== null ? s.gates[runId] : undefined));

  const launch = async (): Promise<void> => {
    if (busy || instructions.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const documents = await Promise.all(
        files.map(async (f) => ({ name: f.name, content: await readFileText(f) })),
      );
      const { runId } = await authorSteeringRules({
        instructions: instructions.trim(),
        type,
        ...(documents.length > 0 ? { documents } : {}),
      });
      setRunId(runId);
    } catch (e) {
      if (isSteeringUnsupported(e)) setUnsupported(true);
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="steering-author-panel"
      className="flex flex-col gap-2 rounded p-3"
      style={{ border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
          Add {STEERING_TYPE_LABELS[type]} rules with chat
        </span>
        <button
          data-testid="steering-author-close"
          type="button"
          onClick={onClose}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Close
        </button>
      </div>

      {runId === null ? (
        <>
          <p className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
            Launches a governed authoring run: it reads what you attach, drafts{' '}
            <span className="font-mono">{type}</span> steering rules, and STOPS at a propose gate —
            nothing is written until you approve it here.
          </p>
          <textarea
            data-testid="steering-author-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="What should these rules steer? Paste context or attach the docs below."
            className="min-h-[4rem] resize-y rounded px-2 py-1 text-[11px] focus:outline-none"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileInput}
              data-testid="steering-author-files"
              type="file"
              multiple
              aria-label="Attach files for the authoring run"
              onChange={(e) => {
                // Read the FileList EAGERLY: the value reset below clears `files`, and a lazy
                // read inside the state updater would see the already-emptied list.
                const picked = Array.from(e.target.files ?? []);
                setFiles((cur) => [...cur, ...picked]);
                e.target.value = '';
              }}
              className="text-[10px]"
              style={{ color: 'var(--ink-muted)' }}
            />
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} data-testid="steering-author-file-chip" className="inline-flex items-center gap-1 rounded px-1.5 text-[10px] font-mono" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
                {f.name}
                <button
                  type="button"
                  aria-label={`Remove ${f.name}`}
                  onClick={() => setFiles((cur) => cur.filter((_, j) => j !== i))}
                  style={{ color: 'var(--ink-dim)' }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          {unsupported && (
            <p data-testid="steering-author-unsupported" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--surface-raised)', color: 'var(--ink-muted)' }}>
              {STEERING_UNSUPPORTED_COPY}
            </p>
          )}
          {error !== null && (
            <p data-testid="steering-author-error" className="rounded px-2 py-1 text-[10px]" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
              {error}
            </p>
          )}
          <div>
            <button
              data-testid="steering-author-launch"
              type="button"
              disabled={busy || instructions.trim() === ''}
              onClick={() => void launch()}
              className="rounded px-3 py-1 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {busy ? 'Launching…' : 'Launch authoring run'}
            </button>
          </div>
        </>
      ) : gate === undefined ? (
        <p data-testid="steering-author-waiting" className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
          Authoring run <span className="font-mono">{runId.slice(0, 8)}</span> launched — its propose
          gate will appear here the moment the run asks. It also shows up everywhere gates do.
        </p>
      ) : (
        // The propose gate — the EXISTING gate card, reused verbatim. Approving (optionally with
        // steer text) is what writes the proposed rules; rejecting writes nothing.
        <SteeringGate
          runId={runId}
          ord={gate.ord}
          prompt={gate.prompt}
          onResolved={onAuthored}
        />
      )}
    </div>
  );
}

// ── The page ──────────────────────────────────────────────────────────────────────────────────

export function SteeringPage({ type, navigate }: {
  type: SteeringType;
  navigate: (path: string) => void;
}): React.ReactElement {
  const [scoreboard, setScoreboard] = useState<ScoreboardState>({ kind: 'loading' });
  const [meta, setMeta] = useState<WikiMeta | null>(null);
  const [rules, setRules] = useState<SteeringRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [facets, setFacets] = useState<Facets>(FACETS_ALL);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [retiring, setRetiring] = useState<SteeringRule | null>(null);
  const [retiredNote, setRetiredNote] = useState<{ id: string; reason: string } | null>(null);
  /** Which management panel is open — one at a time, like the rail accordion. */
  const [panel, setPanel] = useState<'form' | 'import' | 'author' | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [importState, setImportState] = useState<ImportState>({ kind: 'idle' });
  /** The post-save honesty note: where the SERVER actually filed the rule. */
  const [savedNote, setSavedNote] = useState<string | null>(null);

  const loadRules = useCallback(async (): Promise<SteeringRule[]> => {
    setRulesLoading(true);
    setRulesError(null);
    try {
      const { rules: rs } = await api.listConformanceRules();
      setRules(rs as SteeringRule[]);
      return rs as SteeringRule[];
    } catch (e) {
      setRulesError(e instanceof Error ? e.message : String(e));
      return [];
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
      // unanswerable meta route — a daemon that cannot answer is never accused of an
      // unseeded store.
      .then(({ meta: m }) => setMeta(m ?? null))
      .catch(() => setMeta(null));
  }, [loadRules]);

  // Type change is a NAVIGATION between sub-pages: page-local UI state resets with it.
  useEffect(() => {
    setSelectedId(null);
    setPanel(null);
    setForm(null);
    setImportState({ kind: 'idle' });
    setSavedNote(null);
    setRetiredNote(null);
  }, [type]);

  const layers = useMemo(
    () => [...new Set(rules.map((r) => r.targets.layer).filter((l): l is string => l !== undefined && l !== ''))].sort(),
    [rules],
  );
  const visible = useMemo(() => filterSteeringRules(rules, type, facets), [rules, type, facets]);
  const typeTotal = useMemo(
    () => rules.filter((r) => steeringTypeOf(r) === type).length,
    [rules, type],
  );
  const selected = selectedId === null ? null : visible.find((r) => r.id === selectedId) ?? null;

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

  const onSaved = (id: string): void => {
    setPanel(null);
    setForm(null);
    void loadRules().then((rs) => {
      // The honesty check: an older engine SILENTLY DROPS the unified fields (no
      // deny_unknown_fields on ConformanceRule), so a rule saved for this page can come back
      // filed under the serde default. Say where the server actually put it.
      const saved = rs.find((r) => r.id === id);
      const landed = saved === undefined ? null : steeringTypeOf(saved);
      if (landed !== null && landed !== type) {
        setSavedNote(
          `Saved ${id} — but this daemon's engine predates steering_type, so the server filed it under ${STEERING_TYPE_LABELS[landed]}.`,
        );
      } else {
        setSavedNote(`Saved ${id}.`);
      }
    });
  };

  const onImportPick = (file: File): void => {
    const isJson = file.name.toLowerCase().endsWith('.json');
    setImportState({ kind: 'busy', filename: file.name });
    void readFileText(file)
      .then((content) => {
        // .md = one doc entry through the MarkdownAdapter path; .json = a rule batch,
        // each object its own entry so a half-good batch reports per rule.
        const entries = isJson
          ? (JSON.parse(content) as Record<string, unknown>[]).map((rule) => ({
              kind: 'rule' as const,
              rule,
            }))
          : [{ kind: 'doc' as const, name: file.name, content }];
        return importSteeringRules({ type, entries });
      })
      .then(({ results }) => {
        setImportState({ kind: 'done', filename: file.name, results });
        // Something may have landed even in a half-good batch — show the server's state.
        void loadRules();
      })
      .catch((e: unknown) => {
        if (isSteeringUnsupported(e)) setImportState({ kind: 'unsupported' });
        else setImportState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      });
  };

  const openPanel = (p: 'form' | 'import' | 'author'): void => {
    if (p === 'form') setForm(freshForm(rules, type));
    setPanel((cur) => (cur === p ? null : p));
  };

  const openEdit = (rule: SteeringRule): void => {
    setForm(formFromRule(rule));
    setPanel('form');
  };

  const detailFor = (r: SteeringRule): React.ReactElement => (
    <RuleDetail rule={r} evidence={evidenceOf(r.id)} onRetire={setRetiring} onEdit={openEdit} />
  );

  const listBody = (): React.ReactElement => {
    if (rulesLoading) {
      return <p data-testid="steering-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>;
    }
    if (rulesError !== null) {
      return (
        <p data-testid="steering-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {rulesError}
        </p>
      );
    }
    if (visible.length === 0) {
      // Three DIFFERENT kinds of empty, each named: facets hid rules that exist; this TYPE has
      // none (the store does — the management flows are the way in); the store is empty.
      return (
        <p data-testid="steering-rules-empty" className="text-xs" style={{ color: 'var(--ink-dim)' }}>
          {typeTotal > 0
            ? 'No rules match these facets.'
            : rules.length > 0
              ? `No ${STEERING_TYPE_LABELS[type]} steering rules yet — import a doc, add one, or author with chat.`
              : 'No steering rules in the store.'}
        </p>
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

  // The EMPTY-STORE state keys on an EXPLICIT `seeded: false` from the meta route — a daemon
  // that cannot answer must not be accused of an unseeded store. Unlike the old wiki page it
  // does NOT replace the management bar: import/add/author are exactly how a store gets seeded
  // from here now, so the banner names both ways in.
  const unseeded = meta !== null && meta.seeded === false && rules.length === 0 && !rulesLoading;

  return (
    <div data-testid="steering-page" data-steering-type={type} className="flex max-w-5xl flex-col gap-4">
      <div className="flex items-center gap-3">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-high)' }}>
          Steering · {STEERING_TYPE_LABELS[type]}
        </h2>
        <button
          type="button"
          onClick={() => void loadRules()}
          className="ml-auto text-[10px] hover:underline"
          style={{ color: 'var(--ink-dim)' }}
        >
          Refresh
        </button>
      </div>

      {/* The sub-page strip: the seven steering types, each a real navigation. */}
      <nav data-testid="steering-tabs" aria-label="Steering types" className="flex flex-wrap gap-1">
        {STEERING_TYPES.map((t) => (
          <a
            key={t}
            data-testid="steering-tab"
            data-type={t}
            href={steeringPath(t)}
            aria-current={t === type ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); navigate(steeringPath(t)); }}
            className="rounded px-2 py-1 text-[11px] font-semibold"
            style={{
              textDecoration: 'none',
              color: t === type ? 'var(--ink-high)' : 'var(--ink-muted)',
              background: t === type ? 'var(--surface-raised)' : 'transparent',
              border: `1px solid ${t === type ? 'var(--surface-raised)' : 'transparent'}`,
            }}
          >
            {STEERING_TYPE_LABELS[t]}
          </a>
        ))}
      </nav>

      <HealthHeader state={scoreboard} type={type} />

      {unseeded && (
        <div
          data-testid="steering-unseeded"
          className="flex flex-col gap-2 rounded p-4"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)' }}
        >
          <p className="text-xs font-semibold" style={{ color: 'var(--ink-high)' }}>
            No steering rules seeded yet.
          </p>
          <p className="text-[11px]" style={{ color: 'var(--ink-muted)' }}>
            Import a doctrine doc, add a rule, or author with chat right here — or run the seed
            runbook at{' '}
            <a href={SEED_RUNBOOK_URL} target="_blank" rel="noreferrer" className="underline" style={{ color: 'var(--accent)' }}>
              {SEED_RUNBOOK_PATH}
            </a>:
          </p>
          <code
            data-testid="steering-seed-command"
            className="overflow-x-auto whitespace-pre rounded px-2 py-1.5 font-mono text-[10px]"
            style={{ background: 'var(--surface-base)', border: '1px solid var(--surface-raised)', color: 'var(--ink-high)' }}
          >
            {SEED_COMMAND}
          </code>
        </div>
      )}

      {/* The management bar — every flow writes through crew's API, typed from THIS page. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          data-testid="steering-import-open"
          type="button"
          aria-expanded={panel === 'import'}
          onClick={() => openPanel('import')}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--ink-high)', border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
        >
          Import
        </button>
        <button
          data-testid="steering-add-open"
          type="button"
          aria-expanded={panel === 'form'}
          onClick={() => openPanel('form')}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          Add rule
        </button>
        <button
          data-testid="steering-author-open"
          type="button"
          aria-expanded={panel === 'author'}
          onClick={() => openPanel('author')}
          className="rounded px-2 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--ink-high)', border: '1px solid var(--surface-raised)', background: 'var(--surface-rail)' }}
        >
          Add with chat
        </button>
      </div>

      {panel === 'import' && (
        <ImportPanel
          type={type}
          state={importState}
          onPick={onImportPick}
          onClose={() => { setPanel(null); setImportState({ kind: 'idle' }); }}
        />
      )}
      {panel === 'form' && form !== null && (
        <RuleForm
          form={form}
          type={type}
          rules={rules}
          onChange={setForm}
          onClose={() => { setPanel(null); setForm(null); }}
          onSaved={onSaved}
        />
      )}
      {panel === 'author' && (
        <AuthorPanel
          type={type}
          onClose={() => setPanel(null)}
          onAuthored={() => { void loadRules(); }}
        />
      )}

      {savedNote !== null && (
        <p
          data-testid="steering-saved-note"
          className="rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          {savedNote}
        </p>
      )}

      {retiredNote !== null && (
        <p
          data-testid="steering-retired-note"
          className="rounded px-3 py-2 text-[11px]"
          style={{ background: 'var(--surface-rail)', border: '1px solid var(--surface-raised)', color: 'var(--ink-muted)' }}
        >
          Retired <span className="font-mono">{retiredNote.id}</span> — withdrawn from recall and
          enforcement; the record stays listed. Your reason, for the doc PR if this rule came from
          one: <em>&ldquo;{retiredNote.reason}&rdquo;</em>
        </p>
      )}

      {!unseeded && (
        <div className="flex flex-wrap items-center gap-3">
          <FacetSelect
            testid="steering-filter-severity"
            label="severity"
            value={facets.severity}
            options={['critical', 'error', 'warn', 'info']}
            onChange={(v) => setFacets((f) => ({ ...f, severity: v }))}
          />
          <FacetSelect
            testid="steering-filter-layer"
            label="layer"
            value={facets.layer}
            options={layers}
            onChange={(v) => setFacets((f) => ({ ...f, layer: v }))}
          />
          <FacetSelect
            testid="steering-filter-type"
            label="type"
            value={facets.rule_type}
            options={['pattern', 'policy']}
            onChange={(v) => setFacets((f) => ({ ...f, rule_type: v }))}
          />
          <FacetSelect
            testid="steering-filter-status"
            label="status"
            value={facets.status}
            options={['active', 'retired']}
            onChange={(v) => setFacets((f) => ({ ...f, status: v as StatusFacet }))}
          />
        </div>
      )}

      {!unseeded && listBody()}

      {retiring !== null && (
        <RetireModal rule={retiring} onClose={() => setRetiring(null)} onRetired={onRetired} />
      )}
    </div>
  );
}
