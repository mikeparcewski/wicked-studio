/**
 * The watch registry wire (DES-TRIGGER-REGISTRY-001 §4.5; crew TR-W4 / TR-W5a; `wicked-crew-api-types`
 * 0.70.0-0.73.0).
 *
 * Typed here, not imported, for the usual reason (`chat-wire.ts`, `mcp-wire.ts`): studio is pinned to
 * an older published api-types. These shapes are the subset studio reads, byte-equivalent to the
 * daemon's `WatchFinding` / `WatchFindingCleared` / `WatchEventFrame` / `WatchFeedResponse`; when the
 * pin catches up they are deleted and the import replaces them.
 *
 * The registry is advisory: a watch row can never allow, approve or block, and no watch row ever
 * becomes a needs-you row (the needs-you fold stays studio's own).
 */

export type WatchEmitAs = 'finding' | 'flag' | 'proposal';
export type WatchSeverity = 'high' | 'medium' | 'info';
/** The Watchtower's kind column. There is no `needs` kind. */
export type WatchKind = 'problem' | 'decision' | 'done' | 'quiet' | 'delivery';

export interface WatchAnchor {
  run_id: string;
  ord: number | null;
  attempt: number | null;
  /** Unix millis of the source event. */
  at: number;
}

export interface WatchFinding {
  run_id: string | null;
  ord: number | null;
  attempt: number | null;
  by: string;
  at: number;
  re: string;
  watch_id: string;
  entry_id: string;
  entry_version: number;
  check: string;
  kind: WatchEmitAs;
  severity: WatchSeverity;
  watch_kind: WatchKind;
  attach: 'gate' | null;
  project_id?: string;
  sentence: string;
  facts: Record<string, unknown>;
  anchor: WatchAnchor | null;
  evidence: unknown[];
  model: unknown;
  rolled_up: number;
}

interface WatchClearedBase {
  run_id: string | null;
  ord: number | null;
  attempt: number | null;
  by: string;
  at: number;
  re: string;
  watch_id: string;
  entry_id: string;
  entry_version: number;
  project_id?: string;
}

export type WatchFindingCleared =
  | (WatchClearedBase & { reason: 'resolved' })
  | (WatchClearedBase & { reason: 'dismissed'; dismissed_by: string })
  | (WatchClearedBase & { reason: 'rolled_up'; replaced_by: string });

export type WatchCoverage =
  | { entry_id: string; state: 'checked' }
  | { entry_id: string; state: 'not_checked'; reason: string };

/** `GET /watch?project=&kind=&run=&since=&limit=`. */
export interface WatchFeedResponse {
  findings: WatchFinding[];
  cleared?: WatchFindingCleared[];
  coverage?: WatchCoverage[];
}

export const WATCH_RAISED = 'wicked.crew.watch_finding.raised';
export const WATCH_CLEARED = 'wicked.crew.watch_finding.cleared';
