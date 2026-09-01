/**
 * The diagnostics wire — `GET /api/v1/diagnostics` (read-only, camelCase), the daemon's
 * self-description: component versions, daemon vitals, store sizes, a bounded tail of recent
 * errors, and per-CLI ACP session/fallback counts folded from the durable run event logs
 * (`<home>/core.db.events/*.ndjson` — `acpSessionStarted` / `acpFallback`).
 *
 * ── INTEGRATION POINT (L1 diagnostics lane) ───────────────────────────────────────────────────
 * The shape below is the PINNED wire from the paired crew lane; it is not yet in studio's
 * installed `wicked-crew-api-types`. Delete this block and re-export from the contract package
 * the moment studio bumps to the api-types version that carries it. Fields the daemon cannot
 * answer are `null`/empty — never fabricated.
 *
 * PRESENCE GATE: older crews have no `/diagnostics` at all — a bare unknown-route 404 (or a 501
 * from a crew whose engine predates the fold). {@link isDiagnosticsUnsupported} folds both so
 * every consumer (the Ask context pack is consumer #1) says so honestly instead of erroring.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

/** One CLI's ACP health, folded from the durable run event logs. */
export interface DiagnosticsAcpCli {
  sessionsStarted: number;
  fallbacks: number;
  /** Fallback counts by kind (e.g. `{"spawn-failed": 3}`). Empty when none recorded. */
  fallbackKinds: Record<string, number>;
  /** Unix-millis of the newest `acpSessionStarted`; `null` when none recorded. */
  lastStartedTs: number | null;
  /** Unix-millis of the newest `acpFallback`; `null` when none recorded. */
  lastFallbackTs: number | null;
}

export interface DiagnosticsStore {
  name: string;
  path: string;
  bytes: number;
}

export interface DiagnosticsError {
  ts: number;
  source: string;
  line: string;
}

export interface Diagnostics {
  components: {
    crew: string;
    studioBundle: string | null;
    coreTs: string | null;
    /** Engine binary versions by name; `null` = the binary is present but unversionable. */
    engineBinaries: Record<string, string | null>;
  };
  daemon: {
    uptimeMs: number;
    startedAt: number;
    port: number;
  };
  stores: DiagnosticsStore[];
  /** Bounded tail, newest first. */
  recentErrors: DiagnosticsError[];
  acp: { byCli: Record<string, DiagnosticsAcpCli> };
}

/** `GET /diagnostics` — the daemon's self-description. Read-only. */
export function getDiagnostics(): Promise<Diagnostics> {
  return apiFetch<Diagnostics>('/diagnostics');
}

/**
 * True when this daemon cannot serve diagnostics yet: a bare unknown-route 404 (crew predates
 * the route) or a 501 (route present, fold absent). A NAMED 4xx from a daemon WITH the route is
 * a real answer and surfaces as one — the same two-layer adoption seam as the wiki/testing reads.
 */
export function isDiagnosticsUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}
