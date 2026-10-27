import type { SystemAttention } from '../api/system.js';

/**
 * THE ROW HEADLINE HOOK: what a needs-you or slowing-work row says as its title, for one of crew's
 * attention items. The plain-cause headline ("No second helper is free to review this") is the Gate
 * lane's (branch `ui-v2-gate-needs`, not landed yet); the integrator wires its function in HERE, and
 * every row that names an attention item (the project home's Needs you, Nerve Center's Slowing work
 * now) follows. Until then it falls back to the item's current title, crew's own words.
 */
export function rowHeadline(item: SystemAttention): string {
  return item.text;
}
