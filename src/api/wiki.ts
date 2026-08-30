/**
 * The architecture-wiki wire (AW-23 scoreboard + wiki meta + RuleSet grouping) — types and
 * calls for the read side of the Architecture Wiki surface (`/wiki`).
 *
 * ── INTEGRATION POINT (wiki-management build, paired crew lane) ──────────────────────────────
 * These shapes are hand-mirrored from the engine that PRODUCES them — wicked-core's
 * `crates/wicked-governance/src/scoreboard.rs` (`Scoreboard`, AW-23), `ruleset.rs`
 * (`RuleSetGrouping`, AW-13) and `provenance.rs` (the `<path>@<blob sha>#<RULE-ID>` ref
 * format, AW-10) — because the crew slice that serves them (`/governance/wiki/*`, built in a
 * parallel lane, presence-gated on core-ts methods like the campaigns routes) is not yet in
 * studio's installed `wicked-crew-api-types`. Like `Campaign` in `./campaigns.ts`, every
 * declaration here is TEMPORARY: **delete this block and re-export from
 * `wicked-crew-api-types`** the moment studio bumps to the api-types version that carries the
 * wiki contract. Field names and spellings are the engine's serde output, verbatim — a served
 * payload that disagrees is a contract bug, not an adoption gap.
 *
 * The support probe is the adoption seam, and it is TWO-LAYERED here:
 *  - a bare 404 (Fastify's unknown-route answer) means "this crew daemon predates the wiki
 *    routes entirely";
 *  - a 501 means "the crew daemon HAS the route but its embedded core-ts engine predates the
 *    wiki scoreboard method" (the campaigns presence-gate pattern, answered honestly in-band).
 * Both resolve to the same operator truth — this daemon cannot measure the wiki yet — and
 * {@link isWikiUnsupported} folds them so every caller renders the honest state, never a raw
 * refusal.
 *
 * The rules themselves ride the SHIPPING wire: `GET /governance/rules` (listConformanceRules)
 * and the retire kill switch `DELETE /governance/rules/:id` (retireConformanceRule) — nothing
 * here re-declares those.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

// ── AW-23 scoreboard (scoreboard.rs `Scoreboard`, serde snake_case) ───────────────────────────

/** Typing coverage — % of doctrine statements typed into enforcement classes (doc frontmatter). */
export interface WikiTypingCoverage {
  /** False when the daemon had no docs root to scan; `reason` says why, in-band. */
  available: boolean;
  reason?: string;
  docs_scanned: number;
  statements_total: number;
  statements_typed: number;
  /** Absent when there is nothing to divide by (serde skips `None`). */
  percent?: number;
  /** Statement count per enforcement class (`policy | validator | guidance`). */
  by_class: Record<string, number>;
  docs_untyped: string[];
}

/** Connection coverage — % of active rules whose `symbol_ref` resolves at the CURRENT epoch. */
export interface WikiConnectionCoverage {
  rules_with_ref: number;
  refs_resolving: number;
  refs_unresolvable: number;
  percent?: number;
  /** Rules carrying live `Governs` edges into code. */
  rules_linked: number;
}

/** One rule's enforcement evidence — deny claims citing it + accumulated Governs evidence. */
export interface WikiRuleEvidenceRow {
  rule_id: string;
  denial_claims: number;
  governs_evidence: number;
}

/** Enforcement evidence — gate denials that CITE wiki rules (evidenced_by edges). */
export interface WikiEnforcementEvidence {
  denial_claims: number;
  rules_evidenced: number;
  evidenced_by_edges: number;
  governs_evidence_total: number;
  per_rule: WikiRuleEvidenceRow[];
}

/** Recall volume — documented UNAVAILABLE by the engine (nothing writes recall telemetry yet);
 *  the struct exists so the report says so in-band instead of silently omitting the metric. */
export interface WikiRecallVolume {
  available: boolean;
  reason: string;
}

/** The AW-23 population/connection scoreboard, verbatim as the engine serializes it. */
export interface WikiScoreboard {
  rules_total: number;
  rules_active: number;
  rules_retired: number;
  typing: WikiTypingCoverage;
  connection: WikiConnectionCoverage;
  evidence: WikiEnforcementEvidence;
  recall_volume: WikiRecallVolume;
  [k: string]: unknown;
}

// ── Wiki meta (seededness) ─────────────────────────────────────────────────────────────────────

/** Per-doc metadata the meta route may carry — the frontmatter `enforcement_class` lives on the
 *  DOC, never on the rule node, so a rule's class renders only when this join is served. */
export interface WikiDocMeta {
  /** Root-relative doc path — joins against the parsed `provenance.ref` path. */
  path: string;
  /** `policy | validator | guidance`, or null/absent for an untyped doc. */
  enforcement_class?: string | null;
  [k: string]: unknown;
}

/** `GET /governance/wiki/meta` — is there a wiki here at all? */
export interface WikiMeta {
  /** False = no doctrine has ever been ingested into this store — the surface's EMPTY state. */
  seeded: boolean;
  rules_total?: number;
  rulesets?: number;
  docs?: WikiDocMeta[];
  [k: string]: unknown;
}

// ── RuleSet grouping (ruleset.rs `RuleSetGrouping`) ───────────────────────────────────────────

/** One doctrine domain's membership: the RuleSet parent plus the rule ids it contains. */
export interface WikiRuleSet {
  /** The doctrine domain — RuleSet node name (`plane-boundaries`, `storage-doctrine`, …). */
  domain: string;
  /** The `PAT-`/`POL-` ids of the rules this RuleSet contains. */
  rule_ids: string[];
  [k: string]: unknown;
}

// ── Calls ─────────────────────────────────────────────────────────────────────────────────────

/** `GET /governance/wiki/scoreboard` — 501 = engine predates the scoreboard; bare 404 = crew
 *  predates the wiki routes. Both are {@link isWikiUnsupported}, never an error card. */
export function getWikiScoreboard(): Promise<{ scoreboard: WikiScoreboard }> {
  return apiFetch<{ scoreboard: WikiScoreboard }>('/governance/wiki/scoreboard');
}

/** `GET /governance/wiki/meta` — `{ seeded: false }` is an ANSWER (the empty state), never a 404. */
export function getWikiMeta(): Promise<{ meta: WikiMeta }> {
  return apiFetch<{ meta: WikiMeta }>('/governance/wiki/meta');
}

/** `GET /governance/wiki/rulesets` — always 200 with `[]` on an ungrouped store. */
export function listWikiRuleSets(): Promise<{ rulesets: WikiRuleSet[] }> {
  return apiFetch<{ rulesets: WikiRuleSet[] }>('/governance/wiki/rulesets');
}

/**
 * True when this daemon cannot serve the wiki read yet: a 501 (route present, engine method
 * absent — the presence-gate's honest in-band answer) or Fastify's bare unknown-route 404
 * (crew predates the wiki routes entirely). A NAMED 404 from a daemon WITH the route is a
 * real answer and must surface as one.
 */
export function isWikiUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

// ── Provenance ref parsing (provenance.rs `parse_provenance_ref`, mirrored) ──────────────────

/** A parsed `provenance.ref`. Every field but `path` is optional because every HISTORICAL ref
 *  shape must keep parsing — a legacy `path#id` ref is drift residue, never a crash. */
export interface ParsedProvenanceRef {
  path: string;
  /** The git blob sha the rule was ingested at, when the ref carries one. */
  sha: string | null;
  /** The `#`-anchor (the rule id within the doc), when present. */
  anchor: string | null;
}

function isBlobSha(s: string): boolean {
  return /^[0-9a-f]{40}$/.test(s);
}

/**
 * Parse a provenance ref of any historical shape — `path@sha#id`, `path#id`, `path@sha`,
 * bare `path`, free-form. The sha is recognized ONLY as a trailing `@<40 lowercase hex>`
 * before the anchor — an `@` inside an ordinary path does not false-positive. Mirrors the
 * engine's `parse_provenance_ref` exactly so studio and the drift CLI read one ref the
 * same way.
 */
export function parseProvenanceRef(ref: string): ParsedProvenanceRef {
  const hash = ref.indexOf('#');
  const left = hash === -1 ? ref : ref.slice(0, hash);
  const anchor = hash === -1 ? null : ref.slice(hash + 1);
  const at = left.lastIndexOf('@');
  if (at !== -1 && isBlobSha(left.slice(at + 1))) {
    return { path: left.slice(0, at), sha: left.slice(at + 1), anchor };
  }
  return { path: left, sha: null, anchor };
}

// ── The populated-vs-decaying verdict ─────────────────────────────────────────────────────────

/**
 * The health header's one-word reading of the scoreboard. Derived HERE, in studio, from the
 * AW-23 raw signals (the engine deliberately reports signals, not adjectives) — and always
 * rendered BESIDE those raw numbers, never instead of them.
 */
export type WikiVerdict = 'empty' | 'populated' | 'decaying' | 'unproven';

export const VERDICT_COPY: Record<WikiVerdict, string> = {
  empty: 'No active rules — the wiki is not populated.',
  decaying:
    'Ingested once and drifting: unresolvable symbol refs or mostly-untyped doctrine. Re-run ingest/relink.',
  populated: 'Typed, connected to code, and cited by enforcement — the wiki is alive.',
  unproven:
    'Rules exist but nothing proves they are wired: no live code links or enforcement evidence yet.',
};

/**
 * The derivation, pinned by unit test:
 * - `empty`    — no active rules.
 * - `decaying` — a symbol ref no longer resolves at the current epoch (drift), or typing was
 *                measured and under half the doctrine is typed. Decay signals DOMINATE.
 * - `populated`— live `Governs` links into code AND enforcement evidence citing wiki rules
 *                (denials or accumulated Governs evidence).
 * - `unproven` — the honest middle: rules exist, nothing decayed, nothing proven.
 */
export function scoreboardVerdict(sb: WikiScoreboard): WikiVerdict {
  if (sb.rules_active === 0) return 'empty';
  const typingWeak =
    sb.typing.available && sb.typing.statements_total > 0 && (sb.typing.percent ?? 0) < 50;
  if (sb.connection.refs_unresolvable > 0 || typingWeak) return 'decaying';
  const evidenced = sb.evidence.denial_claims > 0 || sb.evidence.governs_evidence_total > 0;
  if (sb.connection.rules_linked > 0 && evidenced) return 'populated';
  return 'unproven';
}

// ── The seed runbook (the empty state's way out) ─────────────────────────────────────────────

/** Where the seed runbook + authoring contract live (AW-13). A repo path, not a wire. */
export const SEED_RUNBOOK_PATH = 'wicked-core/crates/wicked-governance/seed/README.md';
export const SEED_RUNBOOK_URL =
  'https://github.com/mikeparcewski/wicked-core/blob/main/crates/wicked-governance/seed/README.md';

/** The runbook's driver invocation, abbreviated to what identifies it (the README carries the
 *  full flag list — every store it writes is scratch-only, never a daemon-held store). */
export const SEED_COMMAND =
  'python3 crates/wicked-governance/seed/seed_wiki.py --core-bin <wicked-core> --estate-bin <wicked-estate> --scratch <dir> …';
