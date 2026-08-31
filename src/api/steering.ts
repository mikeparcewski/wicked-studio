/**
 * The steering wire — types and calls for the Steering surface (`/steering/:type`), the
 * governance surface that MERGED the wiki/rules model and the old policies model into one
 * steering-rule model (the STEERING program).
 *
 * ── INTEGRATION POINT (steering build, paired core/crew lanes) ────────────────────────────────
 * The unified rule shape is hand-mirrored from the engine that PRODUCES it — wicked-core's
 * `crates/wicked-governance/src/conformance.rs` (`ConformanceRule`, grown by the steering-model
 * lane with `steering_type` / `applies_to` / `excludes` / `weight` and the policy-side
 * `effect` / `trigger` / `obligations` / `criteria`) — because the crew slice that serves the
 * management wire (`POST /governance/steering/*`, built in a parallel lane) is not yet in
 * studio's installed `wicked-crew-api-types`. Like the wiki shapes in `./wiki.ts`, every
 * declaration here is TEMPORARY: **delete this block and re-export from `wicked-crew-api-types`**
 * the moment studio bumps to the api-types version that carries the steering contract. Every
 * grown field is OPTIONAL: a pre-0.7.5 daemon serves plain conformance rules, and this surface
 * must read them as what they are — architecture-typed (the engine's serde default), weightless,
 * recall-only.
 *
 * The support probe is the same two-layer adoption seam as the wiki reads: a bare 404 means
 * "this crew daemon predates the steering routes"; a 501 means "the route exists but the
 * embedded engine predates the steering methods". {@link isSteeringUnsupported} folds both so
 * every caller renders the honest state, never a raw refusal.
 *
 * Rule BROWSE and the write CRUD ride the SHIPPING wires — `GET /governance/rules`,
 * `POST /governance/rules` (upsert), `DELETE /governance/rules/:id` (retire) — nothing here
 * re-declares those. estate MCP stays READ-ONLY: every write below goes through crew's API,
 * the governed operator path (AW-11 holds).
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import type { ConformanceRule } from './types.js';

// ── The seven steering types (enum-as-string, engine serde default "architecture") ───────────

export const STEERING_TYPES = [
  'architecture',
  'development',
  'security',
  'testing',
  'operations',
  'compliance',
  'design-ux',
] as const;

export type SteeringType = (typeof STEERING_TYPES)[number];

/** The engine's serde default: a rule written before `steering_type` existed IS architecture. */
export const DEFAULT_STEERING_TYPE: SteeringType = 'architecture';

export const STEERING_TYPE_LABELS: Record<SteeringType, string> = {
  architecture: 'Architecture',
  development: 'Development',
  security: 'Security',
  testing: 'Testing',
  operations: 'Operations',
  compliance: 'Compliance',
  'design-ux': 'Design/UX',
};

export function isSteeringType(s: string): s is SteeringType {
  return (STEERING_TYPES as readonly string[]).includes(s);
}

/** The one spelling of a steering sub-page's route. */
export function steeringPath(type: SteeringType): string {
  return `/steering/${type}`;
}

// ── The unified steering rule ─────────────────────────────────────────────────────────────────

/** `Policy.effect`'s wire values (domain.rs `Effect`, serde snake_case) — optional on the
 *  unified rule: a rule WITHOUT an effect is recall-only, exactly as today. */
export type SteeringEffect = 'deny' | 'allow_with_conditions' | 'allow';

/**
 * The unified steering rule: `ConformanceRule` plus the fields the steering-model lane grows it
 * by. Every addition is optional here because every wire shipping today (crew ≤ 0.7.2) omits
 * them — absent reads as the engine's defaults, spelled per-field below.
 */
export type SteeringRule = ConformanceRule & {
  /** Enum-as-string; absent = `"architecture"` (the serde default). */
  steering_type?: string;
  /** Inclusion facets — same semantics as `Policy.applies_to`. Absent = `[]`. */
  applies_to?: string[];
  /** The NEW exclusion twin of `applies_to`. Absent = `[]`. */
  excludes?: string[];
  /** Ordering within severity + gate priority. Absent = `1.0` (the serde default). */
  weight?: number;
  /** From the merged policy model — a rule without one is recall-only. */
  effect?: SteeringEffect;
  trigger?: { contains?: string | null };
  obligations?: string[];
  criteria?: string;
};

/**
 * Which sub-page a rule belongs to. Absent/empty `steering_type` is the engine's serde default
 * (architecture); an out-of-enum value — which the engine's fail-closed validate should never
 * write — ALSO folds to architecture rather than vanishing from all seven pages: a rule the
 * operator cannot see is a rule the operator cannot retire.
 */
export function steeringTypeOf(rule: SteeringRule): SteeringType {
  const raw = rule.steering_type?.trim() ?? '';
  return isSteeringType(raw) ? raw : DEFAULT_STEERING_TYPE;
}

// ── The Add-rule template (the form's defaults, engine-invariant-conformant) ─────────────────

/**
 * Defaults for the Add-rule form. Every field passes the engine's fail-closed write invariants
 * (`wicked-governance::ConformanceRule::validate` — INV-C1 id shape, INV-C2 confidence in
 * [0,1], INV-C4 source_kinds from the wire enum), so a rule saved straight from the pristine
 * form can never bounce (the RuleManager-template regression, kept pinned by test). Provenance
 * source `"ui"` is FIRST-CLASS: UI-authored rules carry it durably, beside doc-ingested
 * `path@sha#id` refs and chat-authored `"chat"`.
 */
export const STEERING_RULE_TEMPLATE: SteeringRule = {
  id: 'PAT-100',
  rule_type: 'pattern',
  statement: '',
  severity: 'warn',
  confidence: 0.9,
  targets: {},
  provenance: { source: 'ui', source_kinds: ['doc'] },
  steering_type: DEFAULT_STEERING_TYPE,
  applies_to: [],
  excludes: [],
  weight: 1.0,
};

/**
 * The next free rule id for a prefix — `max ordinal + 1`, zero-padded to INV-C1's 3-digit
 * minimum. Derived from the LOADED rules, so it is a suggestion (the store is the authority;
 * a collision upserts, which is why the form leaves the id editable).
 */
export function nextRuleId(rules: SteeringRule[], ruleType: 'pattern' | 'policy'): string {
  const prefix = ruleType === 'pattern' ? 'PAT-' : 'POL-';
  let max = 99; // start suggestions at 100 — three digits, INV-C1's floor
  for (const r of rules) {
    const ord = r.id.startsWith(prefix) ? Number(r.id.slice(prefix.length)) : NaN;
    if (Number.isInteger(ord) && ord > max) max = ord;
  }
  return `${prefix}${String(max + 1).padStart(3, '0')}`;
}

/** INV-C1, client-side echo: `^(PAT|POL)-[0-9]{3,6}$` with the prefix agreeing with rule_type. */
export function isValidRuleId(id: string, ruleType: 'pattern' | 'policy'): boolean {
  const prefix = ruleType === 'pattern' ? 'PAT' : 'POL';
  return new RegExp(`^${prefix}-[0-9]{3,6}$`).test(id);
}

// ── Import (`POST /governance/steering/import`) ───────────────────────────────────────────────

export interface SteeringImportBody {
  steering_type: SteeringType;
  /** `.md` frontmattered doctrine or a `.json` rule batch — inferred from the picked file. */
  format: 'markdown' | 'json';
  filename: string;
  content: string;
}

/** One entry's fate, reported per-rule so a half-good batch renders honestly. */
export interface SteeringImportEntry {
  id?: string;
  statement?: string;
  status: 'created' | 'updated' | 'error';
  error?: string;
  [k: string]: unknown;
}

export function importSteeringRules(body: SteeringImportBody): Promise<{ results: SteeringImportEntry[] }> {
  return apiFetch<{ results: SteeringImportEntry[] }>('/governance/steering/import', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── Add with chat (`POST /governance/steering/author`) ────────────────────────────────────────

export interface SteeringAuthorBody {
  steering_type: SteeringType;
  instructions: string;
  /** File contents read client-side and carried inline — the authoring run's source material. */
  attachments?: { name: string; content: string }[];
}

/** Launches the authoring run; its PROPOSE gate arrives as a normal `awaitingHuman` frame on
 *  the returned run — the existing gate components render and answer it. */
export function authorSteeringRules(body: SteeringAuthorBody): Promise<{ run_id: string }> {
  return apiFetch<{ run_id: string }>('/governance/steering/author', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── The adoption seam ─────────────────────────────────────────────────────────────────────────

/**
 * True when this daemon cannot serve the steering management wire yet: a 501 (route present,
 * engine method absent — pre-0.7.5) or Fastify's bare unknown-route 404 (crew predates the
 * steering routes). A NAMED 404/4xx from a daemon WITH the route is a real answer and surfaces
 * as one.
 */
export function isSteeringUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/** The honest in-band copy for {@link isSteeringUnsupported} refusals. */
export const STEERING_UNSUPPORTED_COPY =
  'This daemon predates steering management (crew 0.7.5 / its engine) — import and chat-authoring are not served here yet. The rules browser, add/edit, and retire still work.';
