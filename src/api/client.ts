import type {
  GateInfo,
  LaunchRunBody,
  RepoEntry,
  RosterSeat,
  SessionView,
} from './types.js';

export type * from './types.js';

const BASE = 'http://127.0.0.1:7701/api/v1';

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one — Fastify v5 rejects
  // an empty body with Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which would 400 every bodyless POST (cancel / resume). This bit us before.
  const headers =
    init?.body !== undefined && init?.body !== null
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : { ...init?.headers };
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

/** Approve / reject payload for the steering gate (`POST /runs/:id/gate`). */
export interface GateDecision {
  approve: boolean;
  amend?: string;
}

/**
 * The daemon `/api/v1` surface, re-pointed onto the run model (DES-STUDIO-001
 * §2). `session`/`phase` verbs are gone; every call is a thin wrapper over one
 * daemon endpoint backed by one core-ts method.
 */
export const api = {
  /** Run list, actionable-first (daemon-sorted). Reconciles the daemon gate cache. */
  listRuns: () => apiFetch<{ runs: SessionView[] }>('/runs'),

  /** One run's detail (`SessionView`). */
  getRun: (id: string) => apiFetch<{ run: SessionView }>(`/runs/${encodeURIComponent(id)}`),

  /** Launch a run → the new run id. */
  launchRun: (body: LaunchRunBody) =>
    apiFetch<{ runId: string }>('/runs', { method: 'POST', body: JSON.stringify(body) }),

  /**
   * The steering gate (§11.1). `{approve:true}` = approve; `{approve:true, amend}`
   * = approve-with-steer; `{approve:false}` = reject (cancels the run).
   */
  confirmGate: (id: string, decision: GateDecision) =>
    apiFetch<{ status: string }>(`/runs/${encodeURIComponent(id)}/gate`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),

  /** Cancel a running or paused run (the distinct third action, §11.1). */
  cancelRun: (id: string) =>
    apiFetch<{ status: string }>(`/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  /** Advance a run: confirm-gate if paused, else resume from the cursor (§11.8). */
  resumeRun: (id: string) =>
    apiFetch<{ status: string }>(`/runs/${encodeURIComponent(id)}/resume`, { method: 'POST' }),

  /** A unit's captured transcript (string, or `null`). Unit id convention `<run>:u<ord>`. */
  getUnitOutput: (id: string, ord: number) =>
    apiFetch<{ output: string | null }>(
      `/runs/${encodeURIComponent(id)}/units/${ord}/output`,
    ),

  /** The daemon-cached gate prompt for a paused run (late-join reconcile, §3.3). */
  getGate: (id: string) => apiFetch<GateInfo>(`/runs/${encodeURIComponent(id)}/gate`),

  /** The council seats for the launch form. */
  getRoster: () => apiFetch<{ roster: RosterSeat[] }>('/roster'),

  /** Registered repos → the target-repo picker. */
  listRepos: () => apiFetch<{ repos: RepoEntry[] }>('/repos'),

  /** Register a git repo (validated: real git repo, >=1 commit). */
  registerRepo: (name: string, rootPath: string) =>
    apiFetch<{ repo: RepoEntry }>('/repos', {
      method: 'POST',
      body: JSON.stringify({ name, rootPath }),
    }),

  /** Liveness (also proves the actor + event pump are up). */
  getHealth: () => apiFetch<{ status: string; version: string; ping: string }>('/health'),
};
