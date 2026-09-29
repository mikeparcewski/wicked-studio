/**
 * The MCP tools surface's calls and pure folds (DES-MCP-TOOLS-001 §4.5, §4.7, §7, §8).
 *
 * Every call rides crew's `/api/v1/mcp/*` (the registry, slice S2; the policy preview and the
 * approvals, slice S6). An approval is an audited POLICY edit crew makes on the `mcp-defaults`
 * ledger rules, never a grant: studio only asks. The folds below are exported pure so the page's
 * numbers are pinned by test, and `compileWhen` is the one place the Steering "When" builder turns
 * phase role / seat / class / an argument pattern into the rule's `trigger.contains` regex over the
 * engine's canonical (sorted-key) evaluation context.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteUnsupported } from './errors.js';
import type {
  McpApprovalResponse,
  McpApprovalsResponse,
  McpCallDecision,
  McpDecision,
  McpPhaseRole,
  McpPolicyCell,
  McpPolicyPreviewBody,
  McpPolicyPreviewResponse,
  McpPolicyPreviewTool,
  McpPreviewResponse,
  McpRunMode,
  McpSecretResponse,
  McpServer,
  McpServerConfigBody,
  McpServersResponse,
  McpServerTestResponse,
  McpTool,
  McpToolClass,
  McpUsageResponse,
} from './mcp-wire.js';
import type { SteeringRule } from './steering.js';

export type * from './mcp-wire.js';

/** The page's address: `/mcp` (the rail heading between Skills and Steering). */
export function mcpPath(server?: string | null): string {
  return server ? `/mcp?server=${encodeURIComponent(server)}` : '/mcp';
}

/** `?view=usage` opens the Usage view; anything else is the Servers view. */
export type McpView = 'servers' | 'usage';
export function readMcpView(search: string): McpView {
  return new URLSearchParams(search).get('view') === 'usage' ? 'usage' : 'servers';
}

/** `?server=<name>` deep-links a server row open. */
export function readMcpServerDeepLink(search: string): string | null {
  const v = new URLSearchParams(search).get('server');
  return v === null || v === '' ? null : v;
}

const j = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

export const mcpApi = {
  servers: () => apiFetch<McpServersResponse>('/mcp/servers'),
  preview: (body: McpServerConfigBody) => apiFetch<McpPreviewResponse>('/mcp/servers/preview', j(body)),
  save: (previewHash: string) => apiFetch<McpServer>('/mcp/servers', j({ previewHash })),
  remove: (name: string) => apiFetch<{ removed: string }>(`/mcp/servers/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  test: (name: string) => apiFetch<McpServerTestResponse>(`/mcp/servers/${encodeURIComponent(name)}/test`, { method: 'POST' }),
  setTool: (subject: string, body: { enabled?: boolean; classOverride?: McpToolClass | null }) =>
    apiFetch<McpTool>(`/mcp/tools/${encodeURIComponent(subject)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  putSecret: (name: string, value: string) =>
    apiFetch<McpSecretResponse>(`/mcp/servers/${encodeURIComponent(name)}/secret`, { method: 'PUT', body: JSON.stringify({ value }) }),
  policies: (body: McpPolicyPreviewBody) => apiFetch<McpPolicyPreviewResponse>('/mcp/policies/preview', j(body)),
  approvals: () => apiFetch<McpApprovalsResponse>('/mcp/approvals'),
  approve: (subject: string) => apiFetch<McpApprovalResponse>('/mcp/approvals', j({ subject })),
  revoke: (subject: string) => apiFetch<McpApprovalResponse>(`/mcp/approvals/${encodeURIComponent(subject)}`, { method: 'DELETE' }),
  usage: (q: McpUsageFilter) => apiFetch<McpUsageResponse>(`/mcp/usage${usageQuery(q)}`),
};

// ── the usage view (slice S7) ────────────────────────────────────────────────────────────────

/** What the Usage view asks `GET /mcp/usage` for. `null` = no filter. */
export interface McpUsageFilter {
  days: 7 | 30;
  subject: string | null;
  seat: string | null;
  decision: McpCallDecision | null;
}

export const DEFAULT_USAGE_FILTER: McpUsageFilter = { days: 7, subject: null, seat: null, decision: null };

export const CALL_DECISIONS: McpCallDecision[] = ['allow', 'ask', 'deny', 'guard_error'];
export const CALL_DECISION_LABELS: Record<McpCallDecision, string> = { allow: 'allowed', ask: 'asked', deny: 'denied', guard_error: 'guard error' };

/** The query string for a filter; the unset filters are left out. */
export function usageQuery(q: McpUsageFilter): string {
  const p = new URLSearchParams({ days: String(q.days) });
  if (q.subject !== null) p.set('subject', q.subject);
  if (q.seat !== null) p.set('seat', q.seat);
  if (q.decision !== null) p.set('decision', q.decision);
  return `?${p.toString()}`;
}

/** `12 ms`, `1.4 s`; `—` when no call ran. */
export function formatMs(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

/** `14%`, `0.5%`; `—` when no call ran. */
export function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  const pct = rate * 100;
  if (pct === 0 || pct >= 10) return `${Math.round(pct)}%`;
  return `${pct.toFixed(1)}%`;
}

/** Each decision's share of `calls`, in {@link CALL_DECISIONS} order, zero shares left out. */
export function decisionShares(d: Record<McpCallDecision, number>, calls: number): Array<{ decision: McpCallDecision; count: number; share: number }> {
  if (calls === 0) return [];
  return CALL_DECISIONS.filter((k) => d[k] > 0).map((k) => ({ decision: k, count: d[k], share: d[k] / calls }));
}

/** A server row's usage line: `12 calls in 7 d · last used 3 h ago`, or that it has none. */
export function serverUsageText(u: { calls: number; lastCall: string } | undefined, days: number, now: number = Date.now()): string {
  if (u === undefined || u.calls === 0) return `no calls in ${days} d`;
  return `${u.calls} call${u.calls === 1 ? '' : 's'} in ${days} d · last used ${ageOf(u.lastCall, now)}`;
}

/**
 * "This daemon has no MCP tools surface": the route is absent (crew predates S2), a 501 (the
 * engine predates the preview binding), or crew's own 503 `mcp_unavailable`.
 */
export function isMcpUnsupported(e: unknown): boolean {
  if (isRouteUnsupported(e)) return true;
  return e instanceof ApiError && e.status === 503 && typeof e.body === 'object' && e.body !== null
    && (e.body as Record<string, unknown>)['code'] === 'mcp_unavailable';
}

// ── the matrix folds ─────────────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<McpPhaseRole, string> = { creator: 'Creator', evaluator: 'Evaluator', recon: 'Recon' };
export const MODE_LABELS: Record<McpRunMode, string> = { ask: 'Gate every step', balanced: 'Gate by risk', autonomous: 'Auto' };
export const DECISION_LABELS: Record<McpDecision, string> = { allow: 'runs', ask: 'asks', deny: 'denied' };

/** The one cell for `role × seat × mode`, or `null` when the preview did not judge it. */
export function cellOf(tool: McpPolicyPreviewTool, role: McpPhaseRole, seat: string, mode: McpRunMode): McpPolicyCell | null {
  return tool.cells.find((c) => c.role === role && c.seat === seat && c.mode === mode) ?? null;
}

/**
 * A server row's posture summary, e.g. "4 read run · 2 write ask · 1 denied": each tool counted by
 * what a CREATOR unit gets in `mode` (on the first seat judged, since a seat-narrowed policy is the
 * exception the matrix shows). Pure, pinned by test.
 */
export function postureSummary(tools: McpPolicyPreviewTool[], mode: McpRunMode): { allow: number; ask: number; deny: number; text: string } {
  const n = { allow: 0, ask: 0, deny: 0 };
  let readRun = 0;
  let writeRun = 0;
  let readAsk = 0;
  let writeAsk = 0;
  for (const t of tools) {
    const c = t.cells.find((x) => x.role === 'creator' && x.mode === mode);
    if (c === undefined) continue;
    n[c.decision] += 1;
    const read = c.class === 'read';
    if (c.decision === 'allow') { if (read) readRun += 1; else writeRun += 1; }
    if (c.decision === 'ask') { if (read) readAsk += 1; else writeAsk += 1; }
  }
  const parts: string[] = [];
  if (readRun > 0) parts.push(`${readRun} read run`);
  if (writeRun > 0) parts.push(`${writeRun} write run`);
  if (readAsk > 0) parts.push(`${readAsk} read ask`);
  if (writeAsk > 0) parts.push(`${writeAsk} write ask`);
  if (n.deny > 0) parts.push(`${n.deny} denied`);
  return { ...n, text: parts.length > 0 ? parts.join(' · ') : 'no tools' };
}

/** Whether a tool is in an ask state an operator can clear by approving it (any creator cell asks). */
export function canApprove(tool: McpPolicyPreviewTool): boolean {
  return tool.registered && tool.cells.some((c) => c.role === 'creator' && c.decision === 'ask');
}

/** The subject approving/revoking acts on at each scope. */
export function serverSubject(server: string): string {
  return `mcp:${server}`;
}

/** "3 hours ago"-style age of an ISO stamp, or "never". */
export function ageOf(iso: string | null, now: number = Date.now()): string {
  if (iso === null) return 'never';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 'unknown';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

// ── Steering: which rules are MCP policies, and the When builder ────────────────────────────

/** The MCP policy tokens: `mcp`, `mcp:<server>`, `mcp:<server>/<tool>`, `mcp-mode:<mode>`. */
export function isMcpToken(t: string): boolean {
  return t === 'mcp' || t.startsWith('mcp:') || t.startsWith('mcp-mode:');
}

/** A rule governs MCP calls when it names an MCP token (or is one of the `mcp-defaults` pack's). */
export function isMcpRule(rule: { id: string; applies_to?: string[]; excludes?: string[] }): boolean {
  if (rule.id.startsWith('MCP-')) return true;
  return (rule.applies_to ?? []).some(isMcpToken) || (rule.excludes ?? []).some(isMcpToken);
}

/** The phase-role wire the engine's context carries (`recon` rows are neutral phases). */
const ROLE_WIRE: Record<McpPhaseRole, string> = { creator: 'creator', evaluator: 'evaluator', recon: 'neutral' };

export interface WhenSpec {
  /** Empty = any role. */
  roles: McpPhaseRole[];
  /** Empty = any seat. */
  seats: string[];
  /** Empty = any class. */
  classes: McpToolClass[];
  /** A regex over the call's arguments' JSON, verbatim (e.g. `"to":"[^"]*@external\.com"`). */
  argPattern: string;
}

export const EMPTY_WHEN: WhenSpec = { roles: [], seats: [], classes: [], argPattern: '' };

const alt = (xs: string[]): string => (xs.length === 1 ? (xs[0] as string) : `(${xs.join('|')})`);
const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Compile a When spec to `trigger.contains`. The engine matches the regex against the evaluation
 * context's canonical JSON, whose keys are SORTED (`args`, `carrier`, `mcp{annotations, class, …}`,
 * `mode`, `phase`, `phase_role`, `scope`, `seat`, …) and compact, so the conditions join in that key
 * order with `.*`: every condition must hold, without lookarounds (the engine's regex has none).
 * An empty spec compiles to `''` (no trigger: the rule fires on its subject alone).
 */
export function compileWhen(w: WhenSpec): string {
  const parts: string[] = [];
  if (w.argPattern.trim() !== '') parts.push(`"args":.*${w.argPattern.trim()}`);
  // `annotations` is flat (the engine's `McpAnnotations` holds four optional booleans), so
  // `[^{}]*` spans it exactly; the same shape the `mcp-defaults` posture triggers use.
  if (w.classes.length > 0) parts.push(`"mcp":\\{"annotations":\\{[^{}]*\\},"class":"${alt(w.classes)}"`);
  if (w.roles.length > 0) parts.push(`"phase_role":"${alt([...new Set(w.roles.map((r) => ROLE_WIRE[r]))])}"`);
  if (w.seats.length > 0) parts.push(`"seat":"${alt(w.seats.map(reEscape))}"`);
  return parts.join('.*');
}

/**
 * Why a trigger regex would not compile in the engine, or `null`. The engine's regex (the Rust
 * `regex` crate) has no lookaround and no backreferences, so those are refused here, before an
 * operator saves a rule the engine cannot use; anything JS cannot parse is refused too.
 */
export function triggerIssue(pattern: string): string | null {
  if (pattern === '') return null;
  if (/\(\?<?[=!]/.test(pattern)) return 'lookaround ((?=, (?!, (?<=, (?<!) is not supported by the engine';
  if (/\\[1-9]/.test(pattern)) return 'backreferences (\\1 …) are not supported by the engine';
  try {
    new RegExp(pattern);
  } catch (e) {
    return `not a valid regex: ${e instanceof Error ? e.message : String(e)}`;
  }
  return null;
}

/** The `applies_to` tokens a Subject pick fills: a server, or one tool of it. */
export function subjectTokens(server: string, tool: string | null): string[] {
  return tool === null ? [`mcp:${server}`] : [`mcp:${server}/${tool}`];
}

// ── the "Add MCP policy" template ───────────────────────────────────────────────────────────

/**
 * A new MCP policy's defaults: a `security` deny, recall text to fill in, and an empty `applies_to`
 * the Subject picker fills (INV-S3: an effect-bearing rule needs one, so the form will not save
 * without it). The id sits outside the reserved `PAT-`/`POL-` namespace, as UI-minted ids may.
 */
export const MCP_POLICY_TEMPLATE: SteeringRule = {
  id: 'MCP-POL-100',
  rule_type: 'policy',
  statement: '',
  severity: 'error',
  confidence: 0.9,
  targets: {},
  provenance: { source: 'ui', source_kinds: ['doc'] },
  steering_type: 'security',
  applies_to: [],
  excludes: [],
  weight: 1.0,
  effect: 'deny',
};

/** The next free `MCP-POL-<n>` id over the loaded rules (a suggestion; the form keeps it editable). */
export function nextMcpPolicyId(rules: ReadonlyArray<{ id: string }>): string {
  let max = 99;
  for (const r of rules) {
    const m = /^MCP-POL-([0-9]{1,6})$/.exec(r.id);
    if (m !== null && Number(m[1]) > max) max = Number(m[1]);
  }
  return `MCP-POL-${max + 1}`;
}
