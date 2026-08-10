import type {
  CoreEvent,
  GateInfo,
  LaunchRunBody,
  OnboardRef,
  OpenTerminalBody,
  RepoEntry,
  RosterSeat,
  SessionView,
  ElicitationInfo,
  ElicitationResponse,
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
  if (!res.ok) {
    const text = await res.text();
    let msg: string;
    try {
      const body = JSON.parse(text) as { error?: unknown; message?: unknown };
      const raw = body.error ?? body.message ?? text;
      msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
    } catch { msg = text; }
    if (!msg) msg = res.statusText || String(res.status);
    throw new Error(`API ${res.status}: ${msg}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch a run's evidence bundle (`GET /runs/:id/evidence`) and hand it to the
 * browser as a file download.
 *
 * Deliberately NOT an `apiFetch` call: the response is an attachment the operator
 * keeps, not a JSON body the UI renders. The daemon names the file via
 * `Content-Disposition`; the `<run-id>-evidence.json` fallback keeps the download
 * named sensibly if a proxy strips the header.
 */
export async function downloadRunEvidence(runId: string): Promise<void> {
  const res = await fetch(`${apiBase()}/runs/${encodeURIComponent(runId)}/evidence`);
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const body = JSON.parse(text) as { error?: unknown };
      if (typeof body.error === 'string') msg = body.error;
    } catch { /* not JSON — keep the raw text */ }
    throw new Error(`API ${res.status}: ${msg || res.statusText || String(res.status)}`);
  }
  const filename =
    /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1]
    ?? `${runId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128)}-evidence.json`;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick — revoking synchronously can cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

  /** A run's durably-persisted event trail (`GET /runs/:id/events`). Used to backfill the event
   * store on a reload with no live `/ws` replay so Burn/insight panels are not empty (FINDING-013).
   * Rejects (503) when the engine build has no event-log binding — callers treat that as "no backfill". */
  getRunEvents: (id: string) =>
    apiFetch<{ events: CoreEvent[] }>(`/runs/${encodeURIComponent(id)}/events`),

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
  // ── Chat sessions (crew#165): warm seats + group fan-out ─────────────────
  openChat: (body: { chatId?: string; clis?: string[]; repoRef?: string }) =>
    apiFetch<{ chatId: string; seats: { cliKey: string; ok: boolean; error?: string }[] }>(`/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  sendChatMessage: (chatId: string, text: string, targets?: string[]) =>
    apiFetch<{ seats: string[] }>(`/chats/${encodeURIComponent(chatId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(targets === undefined ? { text } : { text, targets }),
    }),
  closeChat: (chatId: string) =>
    apiFetch<{ ok: boolean }>(`/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' }),
  /** A chat's warm seats. Empty means the chat is gone — the daemon does not 404 an unknown id. */
  getChat: (chatId: string) =>
    apiFetch<{ chatId: string; seats: string[] }>(`/chats/${encodeURIComponent(chatId)}`),
  /** Every live chat (FINDING-027). `idleSecs` is `number | null` — see the route's adapter. */
  listChats: () => apiFetch<{ chats: { chatId: string; seats: string[]; idleSecs: number | null }[] }>(`/chats`),

  /**
   * A unit's stored transcript.
   *
   * `output` is `null` whenever the daemon holds no transcript, and `outputUnavailable` then
   * says WHY — the unit was denied (deny-dominates stores no output past a deny), has not
   * finished, or the store disagrees with itself. Render that text rather than inventing a
   * message: "no transcript captured" is false for a denied unit, whose output was captured
   * and then deliberately not retained (FINDING-006).
   *
   * Optional because a daemon predating the field sends `{output: null}` alone — the studio
   * bundle is served BY the daemon, so that only happens against a separately-run older one,
   * and the callers fall back rather than render an empty pane.
   */
  getUnitOutput: (id: string, unitKey: string) =>
    apiFetch<{ output: string | null; outputUnavailable?: string }>(
      `/runs/${encodeURIComponent(id)}/units/${encodeURIComponent(unitKey)}/output`,
    ),

  /** The daemon-cached gate prompt for a paused run (late-join reconcile, §3.3). */
  getGate: (id: string) => apiFetch<GateInfo>(`/runs/${encodeURIComponent(id)}/gate`),

  /** The run's open elicitation, or null when there is none (404 -> null, DES-002). */
  getElicitation: async (id: string): Promise<ElicitationInfo | null> => {
    try {
      return await apiFetch<ElicitationInfo>(`/runs/${encodeURIComponent(id)}/elicitation`);
    } catch (e) {
      // A 404 is the normal "nothing pending" answer, not a failure. Anything else propagates —
      // swallowing a 500 here would show an empty panel for a broken daemon.
      if (e instanceof Error && /\b404\b/.test(e.message)) return null;
      throw e;
    }
  },

  /** Answer an open elicitation. A 409 means our elicitationId was stale (DES-002 v0.22). */
  respondToElicitation: (id: string, body: ElicitationResponse) =>
    apiFetch<{ status: string }>(`/runs/${encodeURIComponent(id)}/elicitation`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

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

  /** Clone a remote git URL, register it, and launch an onboarding run.
   *  `checkoutPath` (absolute) overrides the default ~/.wicked/repos/<name>. */
  cloneAndRegisterRepo: (name: string, gitUrl: string, checkoutPath?: string) =>
    apiFetch<{ repo: RepoEntry; onboardRunId: string }>('/repos', {
      method: 'POST',
      body: JSON.stringify({ name, gitUrl, ...(checkoutPath ? { rootPath: checkoutPath } : {}) }),
    }),

  /** Get the onboarding run id for a repo (null if not launched this daemon session). */
  getOnboardRun: (repoId: string) =>
    apiFetch<OnboardRef>(`/repos/${encodeURIComponent(repoId)}/onboard`),

  /** (Re-)launch the onboarding workflow for an already-registered repo. */
  rerunOnboarding: (repoId: string) =>
    apiFetch<{ runId: string }>(`/repos/${encodeURIComponent(repoId)}/onboard`, { method: 'POST' }),

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

  /**
   * Inject a message into one or all active agent sessions (POST /runs/:id/inject).
   * `target` is either `"all"` (broadcast) or a session-specific discriminator.
   * Used by the manager dashboard's send-to-agents panel (crew#73).
   */
  injectMessage: (runId: string, message: string, target: string) =>
    apiFetch<{ status: string }>(`/runs/${encodeURIComponent(runId)}/inject`, {
      method: 'POST',
      body: JSON.stringify({ message, target }),
    }),

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

  /** Server-side requirements search: tokenized AND-match + risk/domain filters + pagination. */
  listRequirements: (repoId: string, params: { q?: string; risk?: 'risk' | 'no-risk'; category?: 'functional' | 'config-data'; domain?: string; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set('q', params.q);
    if (params.risk) qs.set('risk', params.risk);
    if (params.category) qs.set('category', params.category);
    if (params.domain) qs.set('domain', params.domain);
    qs.set('offset', String(params.offset ?? 0));
    qs.set('limit', String(params.limit ?? 50));
    return apiFetch<import('./types.js').RequirementsPage>(`/repos/${encodeURIComponent(repoId)}/requirements?${qs.toString()}`);
  },
  getRequirement: (repoId: string, key: string) =>
    apiFetch<{ requirement: import('./types.js').RequirementDetail }>(`/repos/${encodeURIComponent(repoId)}/requirements/${encodeURIComponent(key)}`),
  patchRequirement: (repoId: string, key: string, patch: import('./types.js').RequirementPatch) =>
    apiFetch<{ requirement: import('./types.js').RequirementDetail }>(`/repos/${encodeURIComponent(repoId)}/requirements/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  /** The requirements_graph.json domain model; `graph` is null when not generated yet. */
  getDomainGraph: () => apiFetch<{ graph: import('./types.js').DomainGraph | null }>('/domain-graph'),

  /** Symbol-level code graph for a repo via wicked-estate graph-view; `graph` is null when not yet built.
   *  `focus` switches to ego-graph mode (slice seeded from one symbol; the navigation primitive). */
  getRepoGraph: (repoId: string, opts?: { focus?: string; limit?: number }) => {
    const qs = new URLSearchParams();
    if (opts?.focus) qs.set('focus', opts.focus);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    const suffix = qs.size > 0 ? `?${qs.toString()}` : '';
    return apiFetch<{ graph: import('./types.js').CodeGraphData | null }>(`/repos/${encodeURIComponent(repoId)}/graph${suffix}`);
  },
  /** Blast radius for a symbol name — dependents + the unresolved-call count. */
  getBlastRadius: (repoId: string, name: string) =>
    apiFetch<import('./types.js').BlastRadius>(`/repos/${encodeURIComponent(repoId)}/graph/blast-radius?name=${encodeURIComponent(name)}`),

  /** Git commit history for a repo (last 20 commits via git log). */
  getRepoGitHistory: (repoId: string) =>
    apiFetch<{ commits: import('./types.js').GitCommit[] }>(`/repos/${encodeURIComponent(repoId)}/git-history`),

  /** Top contributors for a repo by commit count (via git shortlog). */
  getRepoContributors: (repoId: string) =>
    apiFetch<{ contributors: import('./types.js').GitContributor[] }>(`/repos/${encodeURIComponent(repoId)}/contributors`),

  /** Per-repo domain graph from <repo>/.wicked-estate/requirements/requirements_graph.json.
   *  Also returns coverage stats (if available) so the UI can show annotation progress. */
  getRepoDomainGraph: (repoId: string) =>
    apiFetch<{ graph: import('./types.js').DomainGraph | null; coverage: import('./types.js').DomainCoverage | null }>(`/repos/${encodeURIComponent(repoId)}/domain-graph`),

  // ── Governance reads (crew#40/41/43) ────────────────────────────────────────

  /** All registered governance policies. */
  listPolicies: () => apiFetch<{ policies: import('./types.js').GovernancePolicy[] }>('/governance/policies'),

  /** All registered conformance rules. */
  listConformanceRules: () => apiFetch<{ rules: import('./types.js').ConformanceRule[] }>('/governance/rules'),

  /** Front-half coverage gate report; `report` is `null` on an empty store. */
  getCoverageReport: () => apiFetch<{ report: import('./types.js').CoverageReport | null }>('/governance/coverage'),

  /** Coverage for ONE registered repo, over that repo's OWN code graph (FINDING-009) — not the
   *  vacuous daemon-store report. The daemon rejects an unknown repo, surfaced here as a 404 throw. */
  getCoverageReportForRepo: (repoRef: string) =>
    apiFetch<{ report: import('./types.js').CoverageReport | null }>(
      `/governance/coverage?repo=${encodeURIComponent(repoRef)}`,
    ),

  /** A repo's code-graph summary — node counts by kind, over that repo's OWN store (#122). Repo-scoped
   *  only; the daemon 404s an unknown repo and 400s a missing one. */
  getGraphKindsForRepo: (repoRef: string) =>
    apiFetch<{ kinds: import('./types.js').GraphKind[] }>(
      `/governance/graph?repo=${encodeURIComponent(repoRef)}`,
    ),

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
   * Retire a governance policy — withdraw it from enforcement without deleting it. The record stays
   * listed (past decisions cite it), it just stops deciding gates. 404 if no policy has that id.
   */
  retirePolicy: (id: string) =>
    apiFetch<{ status: string; id: string }>(`/governance/policies/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Retire a conformance rule — withdraw it from recall. Same contract as `retirePolicy`. */
  retireConformanceRule: (id: string) =>
    apiFetch<{ status: string; id: string }>(`/governance/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),

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

  // ── System settings ──────────────────────────────────────────────────────────

  /** Read persisted system settings (defaults applied server-side). */
  getSettings: () =>
    apiFetch<{ settings: import('./types.js').SystemSettings }>('/settings'),

  /** Persist a partial settings update; returns the merged result. */
  updateSettings: (patch: Partial<import('./types.js').SystemSettings>) =>
    apiFetch<{ settings: import('./types.js').SystemSettings }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
};
