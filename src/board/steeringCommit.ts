import type { SteeringRule } from '../api/steering.js';

/**
 * A steering grid save, planned against the row as it is NOW (studio#476). A cell edits a copy of
 * the row taken when its edit began; by the time it saves, another save may have landed. So:
 *  - a save that changes nothing against its own copy sends nothing (a stale re-send of an older
 *    draft is exactly that — in the reel it would have overwritten the `vendor` just saved);
 *  - a field the save changes that ALSO moved on since its copy was taken is refused, by name;
 *  - otherwise the save is the current row plus its own changes (fields saved since are kept),
 *    and a refusal reverts to the row as it was when the save was made — never the older copy.
 */
export type CommitPlan =
  | { kind: 'send'; rule: SteeringRule; revertTo: SteeringRule }
  | { kind: 'nothing' }
  | { kind: 'stale'; fields: string[] };

/** Equality by value: an object's keys compared in sorted order (codex on #491); arrays keep their
 *  order (the order of `applies_to` / `excludes` is the operator's). */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v as Record<string, unknown>).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]));
  }
  return v ?? null;
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

export function planCommit(next: SteeringRule, prev: SteeringRule, current: SteeringRule | undefined): CommitPlan {
  const keys = [...new Set([...Object.keys(prev), ...Object.keys(next)])] as (keyof SteeringRule)[];
  const changed = keys.filter((k) => !same(next[k], prev[k]));
  if (changed.length === 0) return { kind: 'nothing' };
  if (current === undefined) return { kind: 'send', rule: next, revertTo: prev };
  const moved = changed.filter((k) => !same(prev[k], current[k]));
  if (moved.length > 0) return { kind: 'stale', fields: moved.map(String) };
  const rule = { ...current } as SteeringRule;
  for (const k of changed) (rule as unknown as Record<string, unknown>)[k] = next[k];
  return { kind: 'send', rule, revertTo: current };
}
