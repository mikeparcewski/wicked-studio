import {
  steeringPath,
  STEERING_TYPE_LABELS,
  STEERING_TYPES,
  steeringTypeOf,
  type SteeringRule,
  type SteeringType,
} from '../api/steering.js';

/**
 * The `/steering` landing — a calm grid of seven compact type cards (Architecture … Design/UX),
 * each carrying that type's rule count. ONE rules fetch (the shell's), counted client-side with
 * the same fold every page uses (`steeringTypeOf`: absent/out-of-enum = architecture, the
 * engine's serde default) — so the counts agree with what each type page lists, on any engine.
 * Card click navigates to `/steering/<type>`.
 */

export interface TypeCount {
  active: number;
  retired: number;
}

/** The landing's count fold, exported pure so the counts-agree-with-the-pages contract is pinned. */
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

export function SteeringTypeCards({ rules, navigate }: {
  rules: SteeringRule[];
  navigate: (path: string) => void;
}): React.ReactElement {
  const counts = countByType(rules);
  return (
    <div
      data-testid="steering-type-cards"
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))' }}
    >
      {STEERING_TYPES.map((t) => {
        const c = counts[t];
        return (
          <a
            key={t}
            data-testid="steering-type-card"
            data-type={t}
            href={steeringPath(t)}
            onClick={(e) => { e.preventDefault(); navigate(steeringPath(t)); }}
            className="flex flex-col gap-1 rounded-lg p-3 transition-colors hover:bg-surface-raised"
            style={{
              background: 'var(--surface-rail)',
              border: '1px solid var(--surface-raised)',
              textDecoration: 'none',
            }}
          >
            <span className="text-[11px] font-semibold" style={{ color: 'var(--ink-high)' }}>
              {STEERING_TYPE_LABELS[t]}
            </span>
            <span data-testid="steering-type-card-count" className="text-lg font-semibold font-mono" style={{ color: 'var(--ink-high)' }}>
              {c.active}
            </span>
            <span className="text-[10px]" style={{ color: 'var(--ink-dim)' }}>
              {c.active === 1 ? 'active rule' : 'active rules'}
              {c.retired > 0 ? ` · ${c.retired} retired` : ''}
            </span>
          </a>
        );
      })}
    </div>
  );
}
