/**
 * The MCP tools wire (DES-MCP-TOOLS-001 §5, §8; crew slices S2 + S6, `wicked-crew-api-types`
 * 0.58.0 + 0.63.0), hand-mirrored VERBATIM from the contract package because studio's installed
 * `wicked-crew-api-types` (0.40.0) predates it. TEMPORARY, like `./skills-wire.ts`: delete this
 * file and re-export from `wicked-crew-api-types` the moment studio bumps to >= 0.63.0.
 * Types only: nothing here runs.
 */

/** How crew reaches an upstream MCP server. */
export type McpUpstreamKind = 'mcp-stdio' | 'mcp-http';
/**
 * A tool's class, from its own `tools/list` annotations (never from a carrier): `read` when
 * `readOnlyHint` is true; else `destructive` unless `destructiveHint` is false; else `write`. A tool
 * with no annotations, or with neither `readOnlyHint` nor `destructiveHint`, is `write`. An
 * operator's `classOverride` wins.
 */
export type McpToolClass = 'read' | 'write' | 'destructive';
/**
 * `registered`: the schema the operator saved is the one the server lists. `unregistered`: the
 * schema changed, or the server added the tool after the save; it is denied until previewed and
 * saved again. `gone`: the server no longer lists it (kept so old records resolve).
 */
export type McpToolStatus = 'registered' | 'unregistered' | 'gone';
/** `failing` after 3 consecutive failed probes; `never` = no probe has succeeded yet. */
export type McpHealthState = 'ok' | 'failing' | 'never';
/** `none` = the server needs no secret; `missing` = its reference resolves to nothing. */
export type McpAuthState = 'none' | 'set' | 'missing';

/** The spec's tool annotations, only the fields it defines. */
export interface McpToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Where a server's secret comes from and where crew injects it. The registry stores this
 * reference only, never a value. `ref` is `keychain:wicked-mcp/<name>` (written by
 * `PUT /mcp/servers/:name/secret`) or `env:<NAME>` (the daemon's env). An `mcp-stdio` server gets
 * the value in env variable `env`; an `mcp-http` server in header `header`, after `prefix`.
 */
export interface McpAuthConfig {
  ref: string;
  env?: string;
  header?: string;
  prefix?: string;
}

/** `POST /mcp/servers/preview`. `mcp-stdio` takes `command` (+ `args`); `mcp-http` takes `url`. */
export interface McpServerConfigBody {
  /** 1–63 of `a-z 0-9 _ -`; the `<server>` of the subject `mcp:<server>/<tool>`. */
  name: string;
  kind: McpUpstreamKind;
  command?: string;
  args?: string[];
  url?: string;
  auth?: McpAuthConfig | null;
}

export interface McpHealth {
  state: McpHealthState;
  consecutiveFailures: number;
  checkedAt: string | null;
  /** The last probe's error, with any secret scrubbed out. */
  lastError: string | null;
}

export interface McpTool {
  name: string;
  /** The policy token: `mcp:<server>/<tool>`. */
  subject: string;
  description: string | null;
  annotations: McpToolAnnotations | null;
  inputSchema: Record<string, unknown> | null;
  derivedClass: McpToolClass;
  classOverride: McpToolClass | null;
  /** `classOverride ?? derivedClass`: what a policy sees. */
  class: McpToolClass;
  enabled: boolean;
  status: McpToolStatus;
  /** The saved schema's hash; `null` = never saved. */
  schemaHash: string | null;
  /** The hash the last probe saw. */
  observedSchemaHash: string;
}

export interface McpServer {
  name: string;
  kind: McpUpstreamKind;
  command: string | null;
  args: string[];
  url: string | null;
  auth: McpAuthConfig | null;
  authState: McpAuthState;
  enabled: boolean;
  health: McpHealth;
  registeredAt: string;
  updatedAt: string;
  tools: McpTool[];
  /** Over the tools that are not `gone`. */
  counts: { total: number; enabled: number; registered: number; read: number; write: number; destructive: number };
}

/**
 * A server configured in a CLI's own home, by name only (never its command, URL or env).
 * `origin: 'worker'` is a server in a seat's worker home, which no wicked-handed server may be.
 */
export interface McpDiscoveredServer {
  name: string;
  cli: string;
  origin: 'operator' | 'worker';
  /** The config file, relative to `~` or `<worker home>`. */
  source: string;
  /** Whether a registered server has the same name. */
  managed: boolean;
}

/** `GET /mcp/servers`. */
export interface McpServersResponse {
  servers: McpServer[];
  discovered: McpDiscoveredServer[];
}

/** The difference between the registered tools and a probe, by tool name. */
export interface McpToolDiff {
  added: string[];
  removed: string[];
  changed: string[];
  unchanged: string[];
}

export interface McpPreviewTool {
  name: string;
  subject: string;
  description: string | null;
  annotations: McpToolAnnotations | null;
  inputSchema: Record<string, unknown> | null;
  class: McpToolClass;
  schemaHash: string;
}

/**
 * `POST /mcp/servers/preview`'s 200. Save it with `POST /mcp/servers {previewHash}` before
 * `expiresAt`. `diff` compares with the registered server of the same name, `null` when none.
 * A server that does not answer is a 502 `probe_failed`.
 */
export interface McpPreviewResponse {
  previewHash: string;
  expiresAt: string;
  server: { name: string; kind: McpUpstreamKind; command: string | null; args: string[]; url: string | null; auth: McpAuthConfig | null };
  serverInfo: { name: string; version: string } | null;
  tools: McpPreviewTool[];
  diff: McpToolDiff | null;
  /**
   * Each tool's decision per phase role × seat × mode under the current policies and approvals,
   * judged as if this preview were saved now (api-types 0.63.0); see `withdrawOnSave`. `null` when
   * the engine cannot preview.
   */
  policies?: McpPolicyPreviewResponse | null;
}

/** `POST /mcp/servers`. No `previewHash`, or one that is unknown or expired, is a 409. */
export interface SaveMcpServerBody {
  previewHash?: string;
}

/** `PATCH /mcp/servers/:name`. */
export interface PatchMcpServerBody {
  enabled: boolean;
}

/** `PATCH /mcp/tools/:subject` (subject URL-encoded). At least one field. */
export interface PatchMcpToolBody {
  enabled?: boolean;
  classOverride?: McpToolClass | null;
}

/** `POST /mcp/servers/:name/test`'s 200: a failed probe is `ok: false` and counts toward `failing`. */
export interface McpServerTestResponse {
  ok: boolean;
  error: string | null;
  /** `null` when the probe failed. */
  diff: McpToolDiff | null;
  server: McpServer;
}

/** `PUT /mcp/servers/:name/secret`: one line, 8–8192 characters. */
export interface PutMcpSecretBody {
  value: string;
}

/** The value is never echoed; `ref` goes into the server's `auth.ref`. 501 = no OS secret store. */
export interface McpSecretResponse {
  ref: string;
  set: true;
}

// ── MCP policies: the preview matrix and approvals (DES-MCP-TOOLS-001 §4.5, §4.7, §8, slice S6; api-types 0.63.0) ──

/** A policy decision: `ask` = the call waits for the operator's approval (it does not run). */
export type McpDecision = 'allow' | 'ask' | 'deny';
/**
 * The phase role a matrix row stands for: `creator` = a creator phase with full write posture;
 * `evaluator` = an evaluator phase (read-only); `recon` = a neutral phase with a read-only posture.
 */
export type McpPhaseRole = 'creator' | 'evaluator' | 'recon';
/** The run's mode (studio's launch autonomy): Gate every step / Gate by risk / Auto. */
export type McpRunMode = 'ask' | 'balanced' | 'autonomous';

/** One matrix cell: what a call from a unit of this shape would get now. Nothing is recorded. */
export interface McpPolicyCell {
  role: McpPhaseRole;
  seat: string;
  mode: McpRunMode;
  phaseId?: string;
  decision: McpDecision;
  /** The class the engine judged (the tool's override, else its annotations; none = `write`). */
  class: McpToolClass;
  /** The rules that decided: `engine:*` gates first, then steering rule ids (each a Steering row). */
  ruleIds: string[];
  obligations: string[];
  reason: string | null;
}

/** Whether a tool is approved in each ledger, and by which token (`server` = `mcp:<server>`). */
export interface McpApprovalState {
  /** `MCP-FIRST-USE`: the first use of a server asks in every mode until approved. */
  firstUse: 'server' | 'tool' | null;
  /** `MCP-POSTURE-WRITE`: in balanced mode a write asks until approved. */
  write: 'server' | 'tool' | null;
}

export interface McpPolicyPreviewTool {
  subject: string;
  server: string;
  tool: string;
  class: McpToolClass;
  status: McpToolStatus;
  /** The server and the tool are both enabled. */
  enabled: boolean;
  /** What the broker sends the engine: enabled and `registered`; otherwise D-5 denies it. */
  registered: boolean;
  approval: McpApprovalState;
  /** One per role × seat × mode, in `roles`, `seats`, `modes` order. */
  cells: McpPolicyCell[];
}

/** `POST /mcp/policies/preview`. Every field narrows; none = every tool, role, seat and mode. */
export interface McpPolicyPreviewBody {
  /** One tool: `mcp:<server>/<tool>`. */
  subject?: string;
  server?: string;
  phaseRole?: McpPhaseRole;
  seat?: string;
  mode?: McpRunMode;
  /** A workflow phase id a policy may name (`review`, `build`, ...). */
  phaseId?: string;
}

/** `POST /mcp/policies/preview`'s 200, and `McpPreviewResponse.policies`. */
export interface McpPolicyPreviewResponse {
  roles: McpPhaseRole[];
  seats: string[];
  modes: McpRunMode[];
  phaseId: string | null;
  /**
   * Server previews only (`[]` elsewhere): the approvals saving this preview withdraws, because a
   * saved tool's schema changed. The cells are judged under the CURRENT approvals, so a tool listed
   * here (or every tool, when `mcp:<server>` is listed) asks again after the save.
   */
  withdrawOnSave: string[];
  tools: McpPolicyPreviewTool[];
}

/** An approved subject and the ledgers that hold it. */
export interface McpApproval {
  subject: string;
  scope: 'server' | 'tool';
  firstUse: boolean;
  write: boolean;
}

/** A registered, enabled tool that would ask in balanced mode, and why. */
export interface McpPendingApproval {
  subject: string;
  server: string;
  tool: string;
  class: McpToolClass;
  needs: Array<'first-use' | 'write'>;
}

export interface McpLedgerState {
  id: string;
  /** `false` = the mcp-defaults pack was not seeded; approvals are refused (503). */
  present: boolean;
  /** A retired first-use ledger still asks: the engine reads it either way. */
  retired: boolean;
}

/** `GET /mcp/approvals`. */
export interface McpApprovalsResponse {
  approved: McpApproval[];
  pending: McpPendingApproval[];
  ledgers: { firstUse: McpLedgerState; write: McpLedgerState };
}

/**
 * `POST /mcp/approvals`, an audited edit of the ledger rules' `excludes`. `mcp:<server>` approves
 * the server's FIRST USE (`MCP-FIRST-USE`); its write tools still ask in balanced mode.
 * `mcp:<server>/<tool>` approves that tool's first use and its writes (`MCP-POSTURE-WRITE` too).
 * An approval never lifts an engine gate or an explicit deny rule.
 */
export interface McpApprovalBody {
  subject: string;
}

/** `POST /mcp/approvals` and `DELETE /mcp/approvals/:subject`: the ledger rules the edit changed. */
export interface McpApprovalResponse {
  subject: string;
  approved: boolean;
  rulesChanged: string[];
}
