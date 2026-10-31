/**
 * The in-flight check's wire shapes (crew `src/inspect`, wicked-crew-api-types 0.153.0 `UnitInspection`), restated
 * here until studio's api-types pin moves past 0.153.0: studio reads only these fields.
 */
export type InspectVerdict = 'progressing' | 'looping' | 'stuck' | 'wasteful';
export type InspectAction = 'let_run' | 'steer' | 'stop';

export interface UnitInspection {
  id: string;
  runId: string;
  ord: number;
  attempt: number;
  state: 'checking' | 'done';
  requestedAt: number;
  finishedAt: number | null;
  workerSeat: string | null;
  seat: string | null;
  checkRunId: string | null;
  source: 'seat' | 'crew' | null;
  why: string | null;
  verdict: InspectVerdict | null;
  doing: string | null;
  progress: string | null;
  evidence: string[];
  action: InspectAction | null;
  note: string | null;
  cost: { inputTokens: number; outputTokens: number; costUsd: number | null } | null;
}

/** A `/ws` frame `unitInspection` (crew), or null. */
export function inspectionOf(frame: unknown): UnitInspection | null {
  if (typeof frame !== 'object' || frame === null) return null;
  const f = frame as { type?: unknown; inspection?: unknown };
  if (f.type !== 'unitInspection' || typeof f.inspection !== 'object' || f.inspection === null) return null;
  const i = f.inspection as Partial<UnitInspection>;
  return typeof i.id === 'string' && typeof i.runId === 'string' && typeof i.ord === 'number' ? (i as UnitInspection) : null;
}
