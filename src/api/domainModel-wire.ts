/**
 * (J6 S1) The domain model's wire, as crew api-types 0.230.0 (J6 K1) declares it. Hand-declared here until studio's
 * pinned `wicked-crew-api-types` carries these names; field for field the same (crew
 * `packages/crew-api-types/index.d.ts`, `DomainScope` … `DomainRulingResponse`).
 */

/** What a domain model run covers: the person's words, and the phrases they kept. */
export interface DomainScope {
  /** "What should the model cover?" (1–2000 chars). */
  intent: string;
  /** Phrases of the intent the person kept or typed (each 1–200 chars, at most 50). */
  phrases?: string[];
  /** The {@link DomainScopeCard.scopeHash} the person saw (launch only). */
  scopeHash?: string;
  description?: string;
}

/** The scope card of a `domain-extraction` preview (garden `scope.py` over the checkout; no model call). */
export interface DomainScopeCard {
  scopeHash: string;
  /** Phrase → the code names it matched. */
  phrases: Record<string, string[]>;
  /** Phrases that matched no code. */
  unmatchedPhrases: string[];
  files: string[];
  targets: number;
  reachedFrom: string[];
  reachedMore: number;
  questions: string[];
}

/** `POST /runs/preview`'s answer, with the J6 card fields. */
export interface DomainPreviewResponse {
  posture?: unknown;
  scopeCard?: DomainScopeCard;
  scopeError?: string;
}

export interface DomainRange { file: string; from: number; to: number }

export interface DomainRuling {
  action: 'confirm' | 'reject';
  by: string;
  /** Unix seconds. */
  at: number;
  note?: string;
}

export interface DomainClaim {
  i: number;
  type: string;
  text: string;
  when?: number[];
  unless?: number[];
  of?: number | null;
  ranges: DomainRange[];
  guardRanges?: DomainRange[];
}

/** One stated decision. A rejected statement is not here: it is under its target's `rejected`. */
export interface DomainStatement {
  id: string;
  key: string;
  requirementKey: string;
  status: 'Checked' | 'open' | 'confirmed' | 'stale';
  text: string;
  located: boolean;
  target: string | null;
  sourceRef: string | null;
  claims: DomainClaim[];
  checkedBy: 'codex' | 'you' | null;
  ruling: DomainRuling | null;
}

export interface DomainGroupSentence { id: string; text: string; cites: string[] }
export interface DomainWithheldSentence extends DomainGroupSentence { reason: string }

export interface DomainRuleGroup {
  id: string;
  title: string;
  area: string;
  kind: 'business' | 'housekeeping' | string;
  rule: DomainGroupSentence | null;
  details: DomainGroupSentence[];
  withheld: DomainWithheldSentence[];
  stale: boolean;
}

export interface DomainFollowup {
  id: string;
  n: number;
  /** `flagged` / `open` (a statement), `refused` (an unaccounted target), `scope` (a phrase that matched nothing). */
  kind: string;
  statement: string | null;
  target: string | null;
  where: { file: string; lines: [number, number] } | null;
  unknown: string;
  check: string;
  ruling: DomainRuling | null;
}

export interface DomainRejectedStatement { id: string; key: string; text: string; ruling: DomainRuling }

export interface DomainTarget {
  id: string;
  file: string;
  lines: [number, number];
  targetHash: string;
  accounted: boolean;
  stale: boolean;
  statements: string[];
  rejected: DomainRejectedStatement[];
  unaccountedReasons: string[];
  ruling: DomainRuling | null;
}

/** The domain model of a repository (schema 1.2.0): `GET /repos/:id/requirements`'s `model`. */
export interface DomainModel {
  schemaVersion: string;
  /** `open` counts open and rejected statements. */
  accounting: { targets: number; accounted: number; open: number; stale: number };
  statements: DomainStatement[];
  ruleGroups: DomainRuleGroup[];
  followups: DomainFollowup[];
  targets: DomainTarget[];
  builtAt: number | null;
}

/** Body of `POST /repos/:id/requirements/rulings`. */
export interface DomainRulingBody {
  statement?: string;
  target?: string;
  expect?: string;
  expectTarget: string;
  action: 'confirm' | 'reject';
  note?: string;
}

export interface DomainRulingResponse {
  ruling: DomainRuling & { subject: 'statement' | 'target'; id: string };
  build: { rebuilt: true; accounting: DomainModel['accounting'] } | { rebuilt: false; error: string };
}
