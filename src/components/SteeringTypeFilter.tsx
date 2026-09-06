import {
  policiesPath,
  STEERING_TYPE_LABELS,
  STEERING_TYPES,
  steeringTypeOf,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';

/**
 * The Policies view's TYPE FILTER — the segmented chip strip that COLLAPSED the old seven type
 * cards into one filter on one grid (DES-MEM-FACETED-001, unified surface): `All` + the seven
 * `STEERING_TYPES`. `All` shows every rule; a type chip scopes the grid to that type. The active
 * chip rides `?type=` in the URL (deep-linkable, back-button-correct) — clicking one is a real
 * navigation, exactly as the old cards were. Counts (active rules) come from the ONE rules fetch,
 * folded the same way every page folds type (`steeringTypeOf`: absent/out-of-enum = architecture).
 */

export interface TypeCount {
  active: number;
  retired: number;
}

/** The count fold, exported pure so the counts-agree-with-the-grid contract is pinned. */
export function countByType(rules: SteeringRule[]): Record<SteeringType, TypeCount> {
  const counts = Object.fromEntries(
    STEERING_TYPES.map((t) => [t, { active: 0, retired: 0 }]),
  ) as Record<SteeringType, TypeCount>;
  for (const r of rules) {
    const bucket = counts[steeringTypeOf(r)];
    if (r.retired === true) bucket.retired += 1;
    else bucket.active += 1;
  }
  return counts;
}

/** The total active-rule count across every type — the `All` chip's number. */
export function activeCount(rules: SteeringRule[]): number {
  return rules.reduce((n, r) => (r.retired === true ? n : n + 1), 0);
}

export function SteeringTypeFilter({ rules, activeType, navigate }: {
  rules: SteeringRule[];
  /** The active filter — `null` is the `All` view. */
  activeType: SteeringType | null;
  navigate: (path: string) => void;
}): React.ReactElement {
  const counts = countByType(rules);
  const chip = (type: SteeringType | null, label: string, count: number): React.ReactElement => {
    const active = activeType === type;
    return (
      <button
        key={type ?? 'all'}
        type="button"
        role="tab"
        aria-selected={active}
        data-testid="steering-type-chip"
        data-type={type ?? 'all'}
        data-active={active}
        onClick={() => navigate(policiesPath(type))}
        className="rounded px-2 py-1 text-[11px] font-semibold transition-colors"
        style={{
          background: active ? 'var(--surface-raised)' : 'transparent',
          color: active ? 'var(--ink-high)' : 'var(--ink-muted)',
          border: '1px solid var(--surface-raised)',
        }}
      >
        {label} <span style={{ color: 'var(--ink-dim)' }}>({count})</span>
      </button>
    );
  };
  return (
    <div
      data-testid="steering-type-filter"
      role="tablist"
      aria-label="Filter policies by steering type"
      className="flex flex-wrap gap-1.5"
    >
      {chip(null, 'All', activeCount(rules))}
      {STEERING_TYPES.map((t) => chip(t, STEERING_TYPE_LABELS[t], counts[t].active))}
    </div>
  );
}
