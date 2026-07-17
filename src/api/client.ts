import type {
  GateInfo,
  LaunchRunBody,
  OnboardRef,
  OpenTerminalBody,
  RepoEntry,
  RosterSeat,
  SessionView,
} from './types.js';

export type * from './types.js';

/**
 * Origin-aware API base resolution (DES-STUDIO-SERVING-001 §4.2).
 *
 * - Prod / daemon-served (same-origin): derive from `window.location`, so the
 *   SPA calls whatever origin/port the daemon actually bound (`--port`/`CREW_PORT`
 *   "just work"; no hardcoded `7701` literal ships in the bundle).
 * - Dev (:4200 split): `VITE_API_HOST` (Vite env, set in `.env.development`)
 *   overrides both REST and WS so the dev server points at `127.0.0.1:7701`.
 */
function devApiHost(): string | undefined {
  const host = import.meta.env?.VITE_API_HOST;
  return typeof host === 'string' && host.length > 0 ? host : undefined;
}

/** REST base, e.g. `http://127.0.0.1:7701/api/v1`. */
export function apiBase(): string {
  const dev = devApiHost();
  if (dev) return `http://${dev}/api/v1`;
  return `${window.location.origin}/api/v1`;
}

/** WS origin, e.g. `ws://127.0.0.1:7701`. */
export function wsBase(): string {
  const dev = devApiHost();
  if (dev) return `ws://${dev}`;
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}`;
}

/**
 * The dedicated per-terminal WS channel (DES-TERMINAL-001 §6): raw PTY bytes flow
 * both ways over it — xterm keystrokes in, PTY output out. Distinct from the
 * daemon's `/ws` CoreEvent fan-out.
 */
export const terminalWsUrl = (id: string): string =>
  `${wsBase()}/ws/terminals/${encodeURIComponent(id)}`;

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Only advertise a JSON body when we actually send one — Fastify v5 rejects
  // an empty body with Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY),
  // which would 400 every bodyless POST (cancel / resume). This bit us before.
  const headers =
    init?.body !== undefined && init?.body !== null
      ? { 'Content-Type': 'application/json', ...init?.headers }
      : { ...init?.headers };
  const res = await fetch(`${apiBase()}${path}`, { ...init, headers });
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

  /** A unit's captured transcript (string, or `null`). Pass the unit key (the suffix after `<run>:`). */
  getUnitOutput: (id: string, unitKey: string) =>
    apiFetch<{ output: string | null }>(
      `/runs/${encodeURIComponent(id)}/units/${encodeURIComponent(unitKey)}/output`,
    ),

  /** The daemon-cached gate prompt for a paused run (late-join reconcile, §3.3). */
  getGate: (id: string) => apiFetch<GateInfo>(`/runs/${encodeURIComponent(id)}/gate`),

  /** The council seats for the launch form. */
  getRoster: () => apiFetch<{ roster: RosterSeat[] }>('/roster'),

  /** Registered repos → the target-repo picker. */
  listRepos: () => apiFetch<{ repos: RepoEntry[] }>('/repos'),

  /** Register a local git repo and launch an onboarding run. Returns the repo and run id. */
  registerRepo: (name: string, rootPath: string) =>
    apiFetch<{ repo: RepoEntry; onboardRunId: string }>('/repos', {
      method: 'POST',
      body: JSON.stringify({ name, rootPath }),
    }),

  /** Clone a remote git URL, register it, and launch an onboarding run. */
  cloneAndRegisterRepo: (name: string, gitUrl: string) =>
    apiFetch<{ repo: RepoEntry; onboardRunId: string }>('/repos', {
      method: 'POST',
      body: JSON.stringify({ name, gitUrl }),
    }),

  /** Get the onboarding run id for a repo (null if not launched this daemon session). */
  getOnboardRun: (repoId: string) =>
    apiFetch<OnboardRef>(`/repos/${encodeURIComponent(repoId)}/onboard`),

  /** Liveness (also proves the actor + event pump are up). */
  getHealth: () => apiFetch<{ status: string; version: string; ping: string }>('/health'),

  /**
   * Open a PTY terminal session → its id. Drive it over the terminal WS
   * (`terminalWsUrl(id)`); raw output arrives there. `governed` omitted = the safe
   * governed default (DES-TERMINAL-001 §7).
   */
  openTerminal: (body: OpenTerminalBody) =>
    apiFetch<{ id: string }>('/terminals', { method: 'POST', body: JSON.stringify(body) }),

  /** Resize a live terminal's PTY to `cols`x`rows`. */
  resizeTerminal: (id: string, cols: number, rows: number) =>
    apiFetch<{ status: string }>(`/terminals/${encodeURIComponent(id)}/resize`, {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    }),

  /** Close a live terminal (kill child, join reader). */
  closeTerminal: (id: string) =>
    apiFetch<{ status: string }>(`/terminals/${encodeURIComponent(id)}/close`, { method: 'POST' }),

  // ── Workflow viewer + domain-model browser (crew#44) ─────────────────────────

  /** All registered workflow definitions (built-ins + any loaded drop-ins). */
  listWorkflows: () => apiFetch<{ workflows: import('./types.js').WorkflowDef[] }>('/workflows'),

  /** One workflow definition by id; 404 if unknown. */
  getWorkflow: (id: string) => apiFetch<{ workflow: import('./types.js').WorkflowDef }>(`/workflows/${encodeURIComponent(id)}`),

  /** Register (or replace) a workflow definition. Returns the registered id. */
  createWorkflow: (def: import('./types.js').WorkflowDef) =>
    apiFetch<{ id: string; status: string }>('/workflows', {
      method: 'POST',
      body: JSON.stringify(def),
    }),

  /**
   * Save an inline script to `~/.wicked/scripts/` and return its absolute path.
   * The path can then be used as the command in a Tool-executor phase.
   */
  saveScript: (name: string, content: string, lang: 'bash' | 'python' | 'sh') =>
    apiFetch<{ path: string }>('/scripts', {
      method: 'POST',
      body: JSON.stringify({ name, content, lang }),
    }),

  /** The requirements_graph.json domain model; `graph` is null when not generated yet. */
  getDomainGraph: () => apiFetch<{ graph: import('./types.js').DomainGraph | null }>('/domain-graph'),

  // ── Governance reads (crew#40/41/43) ────────────────────────────────────────

  /** All registered governance policies. */
  listPolicies: () => apiFetch<{ policies: import('./types.js').GovernancePolicy[] }>('/governance/policies'),

  /** All registered conformance rules. */
  listConformanceRules: () => apiFetch<{ rules: import('./types.js').ConformanceRule[] }>('/governance/rules'),

  /** Front-half coverage gate report; `report` is `null` on an empty store. */
  getCoverageReport: () => apiFetch<{ report: import('./types.js').CoverageReport | null }>('/governance/coverage'),

  /** All recorded governance claims (decisions) from the conformance store. */
  listClaims: () => apiFetch<{ claims: import('./types.js').GovernanceClaim[] }>('/governance/claims'),

  // ── Governance writes (crew#42) ─────────────────────────────────────────────

  /** Upsert (create or update) a governance policy. */
  upsertPolicy: (policy: import('./types.js').GovernancePolicy) =>
    apiFetch<{ status: string }>('/governance/policies', { method: 'POST', body: JSON.stringify(policy) }),

  /** Upsert (create or update) a conformance rule. */
  upsertConformanceRule: (rule: import('./types.js').ConformanceRule) =>
    apiFetch<{ status: string }>('/governance/rules', { method: 'POST', body: JSON.stringify(rule) }),

  /**
   * Preview which conformance rules match a facet query (read-only, no actor impact).
   * Any omitted facet matches all values for that dimension.
   */
  recallRulesPreview: (query: import('./types.js').RulePreviewQuery) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v) params.set(k, v);
    }
    const queryString = params.toString();
    const qs = queryString ? `?${queryString}` : '';
    return apiFetch<{ rules: import('./types.js').ConformanceRule[] }>(`/governance/rules/preview${qs}`);
  },
};
