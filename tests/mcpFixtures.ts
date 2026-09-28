import type {
  McpApprovalsResponse,
  McpDecision,
  McpPhaseRole,
  McpPolicyCell,
  McpPolicyPreviewResponse,
  McpPolicyPreviewTool,
  McpPreviewResponse,
  McpRunMode,
  McpServer,
  McpServersResponse,
  McpTool,
  McpToolClass,
} from '../src/api/mcp.js';

/**
 * One registered server `fx` with the design's three test tools (DES-MCP-TOOLS-001 Appendix A):
 * `wt_echo` (readOnlyHint), `wt_note` (destructiveHint) and `wt_plain` (no annotations = write),
 * and the matrix the engine answers for them before any approval: first use asks everywhere a
 * creator could run it, and D-1 denies the writes in evaluator and recon rows.
 */

export const SEATS = ['claude', 'codex'];
export const ROLES: McpPhaseRole[] = ['creator', 'evaluator', 'recon'];
export const MODES: McpRunMode[] = ['ask', 'balanced', 'autonomous'];

function tool(name: string, cls: McpToolClass, annotations: McpTool['annotations']): McpTool {
  return {
    name,
    subject: `mcp:fx/${name}`,
    description: `${name} tool`,
    annotations,
    inputSchema: { type: 'object' },
    derivedClass: cls,
    classOverride: null,
    class: cls,
    enabled: true,
    status: 'registered',
    schemaHash: `h-${name}`,
    observedSchemaHash: `h-${name}`,
  };
}

export const TOOLS: McpTool[] = [
  tool('wt_echo', 'read', { readOnlyHint: true }),
  tool('wt_note', 'destructive', { destructiveHint: true }),
  tool('wt_plain', 'write', null),
];

export function server(over: Partial<McpServer> = {}): McpServer {
  return {
    name: 'fx',
    kind: 'mcp-stdio',
    command: 'node',
    args: ['fixture-server.mjs'],
    url: null,
    auth: null,
    authState: 'none',
    enabled: true,
    health: { state: 'ok', consecutiveFailures: 0, checkedAt: new Date().toISOString(), lastError: null },
    registeredAt: '2026-09-28T10:00:00.000Z',
    updatedAt: '2026-09-28T10:00:00.000Z',
    tools: TOOLS,
    counts: { total: 3, enabled: 3, registered: 3, read: 1, write: 1, destructive: 1 },
    ...over,
  };
}

export function serversResponse(over: Partial<McpServersResponse> = {}): McpServersResponse {
  return { servers: [server()], discovered: [], ...over };
}

/** The decision a cell gets, with approvals `approved` (subjects) applied the way the engine does. */
function decide(t: McpTool, role: McpPhaseRole, mode: McpRunMode, approved: ReadonlySet<string>): { decision: McpDecision; ruleIds: string[] } {
  const write = t.class !== 'read';
  if (write && role !== 'creator') return { decision: 'deny', ruleIds: ['engine:mcp-phase-role'] };
  const firstUse = approved.has('mcp:fx') || approved.has(t.subject);
  if (!firstUse) return { decision: 'ask', ruleIds: ['engine:mcp-first-use'] };
  if (!write) return { decision: 'allow', ruleIds: ['MCP-POSTURE-READ'] };
  if (mode === 'ask') return { decision: 'ask', ruleIds: ['MCP-MODE-ASK-WRITE'] };
  if (mode === 'balanced' && !approved.has(t.subject)) return { decision: 'ask', ruleIds: ['MCP-POSTURE-WRITE'] };
  return { decision: 'allow', ruleIds: [] };
}

export function policyTool(t: McpTool, approved: ReadonlySet<string> = new Set()): McpPolicyPreviewTool {
  const cells: McpPolicyCell[] = [];
  for (const role of ROLES)
    for (const seat of SEATS)
      for (const mode of MODES) {
        const d = decide(t, role, mode, approved);
        cells.push({ role, seat, mode, class: t.class, obligations: d.decision === 'ask' ? ['mcp:approval'] : [], reason: null, ...d });
      }
  return {
    subject: t.subject,
    server: 'fx',
    tool: t.name,
    class: t.class,
    status: t.status,
    enabled: true,
    registered: true,
    approval: {
      firstUse: approved.has('mcp:fx') ? 'server' : approved.has(t.subject) ? 'tool' : null,
      write: approved.has(t.subject) ? 'tool' : null,
    },
    cells,
  };
}

export function policies(approved: ReadonlySet<string> = new Set(), tools: McpTool[] = TOOLS): McpPolicyPreviewResponse {
  return { roles: ROLES, seats: SEATS, modes: MODES, phaseId: null, withdrawOnSave: [], tools: tools.map((t) => policyTool(t, approved)) };
}

export function approvals(approved: ReadonlySet<string> = new Set()): McpApprovalsResponse {
  return {
    approved: [...approved].map((subject) => ({ subject, scope: subject.includes('/') ? 'tool' : 'server', firstUse: true, write: subject.includes('/') })),
    pending: TOOLS.filter((t) => !(approved.has('mcp:fx') || approved.has(t.subject)) || (t.class !== 'read' && !approved.has(t.subject))).map((t) => ({
      subject: t.subject,
      server: 'fx',
      tool: t.name,
      class: t.class,
      needs: [
        ...(!(approved.has('mcp:fx') || approved.has(t.subject)) ? (['first-use'] as const) : []),
        ...(t.class !== 'read' && !approved.has(t.subject) ? (['write'] as const) : []),
      ],
    })),
    ledgers: { firstUse: { id: 'MCP-FIRST-USE', present: true, retired: false }, write: { id: 'MCP-POSTURE-WRITE', present: true, retired: false } },
  };
}

export function preview(name = 'jira'): McpPreviewResponse {
  const tools = TOOLS.map((t) => ({ name: t.name, subject: `mcp:${name}/${t.name}`, description: t.description, annotations: t.annotations, inputSchema: t.inputSchema, class: t.class, schemaHash: t.schemaHash ?? '' }));
  return {
    previewHash: 'ph-1',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    server: { name, kind: 'mcp-stdio', command: 'npx', args: ['-y', '@acme/jira-mcp'], url: null, auth: null },
    serverInfo: { name: 'acme-jira', version: '1.0.0' },
    tools,
    diff: null,
    policies: {
      ...policies(new Set(), TOOLS),
      tools: policies(new Set(), TOOLS).tools.map((t) => ({ ...t, subject: t.subject.replace('mcp:fx/', `mcp:${name}/`), server: name })),
    },
  };
}
