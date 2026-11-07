import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

/** The read, as the panel takes it: the checks; no such route (an older daemon — no panel); or a
 *  read that failed, with why (never an empty list pretending the page was never reviewed). */
import type { DocReviewerId, DocCheckSource, DocCheckFinding, DocCheck, DocChecksResponse } from 'wicked-crew-api-types';
export type { DocReviewerId, DocCheckSource, DocCheckFinding, DocCheck, DocChecksResponse };

/**
 * (api-types 0.197.0, DES-CHAT-ARTIFACTS-001 §11.2, PLAN G12) What crew checked on a version before it landed. A VERBATIM
 * mirror while this branch's pin lags 0.197.0: when the pin moves, these become re-exports.
 */
export interface DocNotes {
  /** The version these notes belong to: the asked version, or its nearest ancestor whose run recorded notes. */
  from_version: number;
  run_id: string;
  left_out: Array<{ claim: string; why: string }>;
  sources: Array<{ token: string; used: boolean }>;
  assumptions: string[];
  /** Sources crew struck before that run, with the reason (crew's record, not the writer's). */
  struck: Array<{ token: string; reason: string }>;
}
export interface DocFloorCheck {
  source: 'floor';
  version: number;
  run_id: string;
  verdict: 'pass' | 'unverified' | 'unavailable';
  pages: { count: number; measured: boolean; budget: number | null; exact: boolean } | null;
  summary: string;
  sha256: string;
  at: string;
}

/** `notes` / `floor`: `undefined` = the daemon does not serve them (before 0.197.0); `null` = none for this version. */
export type ChecksRead =
  | { state: 'ok'; checks: DocCheck[]; notes?: DocNotes | null; floor?: DocFloorCheck | null }
  | { state: 'absent' }
  | { state: 'failed'; why: string };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A notes record the panel can draw, else `null` (a malformed one is never drawn half). */
export function notesOf(v: unknown): DocNotes | null {
  if (!isObj(v) || typeof v['from_version'] !== 'number' || typeof v['run_id'] !== 'string') return null;
  const list = (k: string): unknown[] => (Array.isArray(v[k]) ? (v[k] as unknown[]) : []);
  return {
    from_version: v['from_version'],
    run_id: v['run_id'],
    left_out: list('left_out').filter((x): x is { claim: string; why: string } => isObj(x) && typeof x['claim'] === 'string' && typeof x['why'] === 'string'),
    sources: list('sources').filter((x): x is { token: string; used: boolean } => isObj(x) && typeof x['token'] === 'string' && typeof x['used'] === 'boolean'),
    assumptions: list('assumptions').filter((x): x is string => typeof x === 'string'),
    struck: list('struck').filter((x): x is { token: string; reason: string } => isObj(x) && typeof x['token'] === 'string' && typeof x['reason'] === 'string'),
  };
}
/** A floor record the panel can draw, else `null`. */
export function floorOf(v: unknown): DocFloorCheck | null {
  if (!isObj(v) || v['source'] !== 'floor' || typeof v['version'] !== 'number' || !['pass', 'unverified', 'unavailable'].includes(String(v['verdict']))) return null;
  const p = v['pages'];
  const pages = isObj(p) && typeof p['count'] === 'number' && typeof p['measured'] === 'boolean'
    ? { count: p['count'], measured: p['measured'], budget: typeof p['budget'] === 'number' ? p['budget'] : null, exact: p['exact'] === true }
    : null;
  return { source: 'floor', version: v['version'], run_id: String(v['run_id'] ?? ''), verdict: v['verdict'] as DocFloorCheck['verdict'], pages,
    summary: typeof v['summary'] === 'string' ? v['summary'] : '', sha256: String(v['sha256'] ?? ''), at: String(v['at'] ?? '') };
}

export async function getDocChecks(projectId: string, docId: string, version: number): Promise<ChecksRead> {
  try {
    const r = await apiFetch<DocChecksResponse & { notes?: unknown; floor?: unknown }>(`/projects/${encodeURIComponent(projectId)}/interactive/docs/${encodeURIComponent(docId)}/checks?version=${version}`);
    return {
      state: 'ok',
      checks: Array.isArray(r.checks) ? r.checks : [],
      // Present only where the daemon serves them; `null` there is a real answer ("none for this version").
      ...('notes' in r ? { notes: r.notes === null ? null : notesOf(r.notes) } : {}),
      ...('floor' in r ? { floor: r.floor === null ? null : floorOf(r.floor) } : {}),
    };
  } catch (e) {
    if (isRouteAbsent(e)) return { state: 'absent' };
    return { state: 'failed', why: e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e) };
  }
}
