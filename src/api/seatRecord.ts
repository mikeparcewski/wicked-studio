/**
 * The seat record wire — `GET /api/v1/roster/record?days=N` (wicked-crew#690): each seat's week,
 * folded by the daemon from the runs' durable event logs. Units run, first pass, rework, stalls,
 * bench and cost (`null` when no price was recorded, never 0), each also split by phase.
 *
 * ── INTEGRATION POINT ─────────────────────────────────────────────────────────────────────────
 * The shapes below mirror `SeatRecordResponse` / `SeatRecord` / `SeatPhaseRecord` from
 * `wicked-crew-api-types` 0.52.0, which studio's installed contract predates. Delete this block and
 * re-export from the contract package the moment studio bumps to the api-types version that carries it.
 */

export interface SeatPhaseRecord {
  units: number;
  gated: number;
  firstPass: number;
  rework: number;
  stalls: number;
}

export interface SeatRecord {
  cli: string;
  units: number;
  gated: number;
  firstPass: number;
  rework: number;
  stalls: number;
  benched: number;
  benchReasons: Record<string, number>;
  costUsd: number | null;
  costedUsage: number;
  byPhase: Record<string, SeatPhaseRecord>;
}

export interface SeatRecordResponse {
  days: number;
  since: number;
  until: number;
  runsRead: number;
  truncated: boolean;
  seats: SeatRecord[];
}
