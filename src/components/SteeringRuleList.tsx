import { useMemo, useState } from 'react';
import {
  STEERING_TYPE_LABELS,
  steeringTypeOf,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';
import { SeverityChip } from './SteeringChips.js';

/**
 * The type page's rule LIST — one calm row per rule: severity chip, id + statement on a single
 * truncated line, the weight chip only when it is non-default, the retired chip when withdrawn.
 * Everything richer (effect, provenance, applies_to/excludes, evidence, retire/edit) lives in
 * the drawer a row click opens — nothing renders open by default here.
 *
 * Facets stay client-side over the one shipping rules wire, exactly as before; they are
 * page-local state, reset by the shell remounting this list per type navigation.
 */

type StatusFacet = 'all' | 'active' | 'retired';

export interface Facets {
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
      <SeverityChip severity={rule.severity} />
      <span className="w-20 shrink-0 font-mono" style={{ color: 'var(--ink-high)' }}>{rule.id}</span>
      <span className="min-w-0 flex-1 truncate">{rule.statement}</span>
      {rule.weight !== undefined && rule.weight !== 1.0 && (
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

export function SteeringRuleList({ rules, type, loading, error, selectedId, onSelect }: {
  /** The FULL store — this list applies the page scope itself, one predicate everywhere. */
  rules: SteeringRule[];
  type: SteeringType;
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.ReactElement {
  const [facets, setFacets] = useState<Facets>(FACETS_ALL);

  const layers = useMemo(
    () => [...new Set(rules.map((r) => r.targets.layer).filter((l): l is string => l !== undefined && l !== ''))].sort(),
    [rules],
  );
  const visible = useMemo(() => filterSteeringRules(rules, type, facets), [rules, type, facets]);
  const typeTotal = useMemo(
    () => rules.filter((r) => steeringTypeOf(r) === type).length,
    [rules, type],
  );

  const body = (): React.ReactElement => {
    if (loading) {
      return <p data-testid="steering-rules-loading" className="text-xs" style={{ color: 'var(--ink-dim)' }}>Loading rules…</p>;
    }
    if (error !== null) {
      return (
        <p data-testid="steering-rules-error" className="rounded px-2 py-1 text-xs" style={{ background: 'var(--status-fail-dim)', color: 'var(--status-fail)' }}>
          {error}
        </p>
      );
    }
    if (visible.length === 0) {
      // Three DIFFERENT kinds of empty, each named: facets hid rules that exist; this TYPE has
      // none (the store does — the Add menu is the way in); the store is empty.
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
          <RuleRow key={r.id} rule={r} selected={selectedId === r.id} onSelect={onSelect} />
        ))}
      </div>
    );
  };

  return (
    <div data-testid="steering-rule-list" className="flex flex-col gap-3">
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
      {body()}
    </div>
  );
}
