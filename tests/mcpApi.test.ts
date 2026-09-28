import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import {
  compileWhen,
  EMPTY_WHEN,
  isMcpRule,
  isMcpUnsupported,
  mcpApi,
  nextMcpPolicyId,
  postureSummary,
  type McpPolicyCell,
  type McpPolicyPreviewTool,
} from '../src/api/mcp.js';
import { policiesPath, readMcpFilter } from '../src/api/steering.js';

/**
 * The MCP tools surface's pure folds and calls (DES-MCP-TOOLS-001 §4.7, §7, §8):
 *  - `compileWhen` is judged the way the ENGINE judges a trigger: a regex search over the
 *    evaluation context's canonical JSON with sorted keys (serde_json without preserve_order,
 *    `mcp_gate::context`), so each case builds that exact string and matches the compiled regex;
 *  - the posture summary, the MCP-rule predicate and the policy-id suggestion;
 *  - every call rides the documented `/mcp/*` route.
 */

/** serde_json's compact output of a BTreeMap-backed Value: keys sorted at every level. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

/** The engine's context for one call (`mcp_gate::context`, §4.2). */
function ctx(o: { role: 'creator' | 'evaluator' | 'neutral'; seat: string; cls: 'read' | 'write' | 'destructive'; args?: unknown; annotations?: Record<string, boolean> }): string {
  return canonical({
    phase: 'build',
    scope: 'run',
    tool: 'mcp:jira/create_issue',
    work: 'mcp:jira/create_issue',
    args: o.args ?? {},
    mcp: {
      server: 'jira',
      tool: 'create_issue',
      subject: 'mcp:jira/create_issue',
      class: o.cls,
      kind: 'mcp-stdio',
      annotations: o.annotations ?? {},
      registered: true,
    },
    mode: 'balanced',
    phase_role: o.role,
    write_posture: o.role === 'creator' ? 'full' : 'read_only',
    seat: o.seat,
    carrier: 'shim',
  });
}

const fires = (trigger: string, context: string): boolean => new RegExp(trigger).test(context);

describe('compileWhen: the When builder compiles to a trigger the engine would match', () => {
  it('an empty spec is no trigger', () => {
    expect(compileWhen(EMPTY_WHEN)).toBe('');
  });

  it('role, class and seat must ALL hold (joined in sorted-key order, no lookarounds)', () => {
    const t = compileWhen({ roles: ['evaluator', 'recon'], seats: ['codex'], classes: ['write', 'destructive'], argPattern: '' });
    expect(t).not.toMatch(/\(\?[=!<]/);
    expect(fires(t, ctx({ role: 'evaluator', seat: 'codex', cls: 'write' }))).toBe(true);
    expect(fires(t, ctx({ role: 'neutral', seat: 'codex', cls: 'destructive', annotations: { destructiveHint: true } }))).toBe(true);
    expect(fires(t, ctx({ role: 'creator', seat: 'codex', cls: 'write' }))).toBe(false);
    expect(fires(t, ctx({ role: 'evaluator', seat: 'claude', cls: 'write' }))).toBe(false);
    expect(fires(t, ctx({ role: 'evaluator', seat: 'codex', cls: 'read', annotations: { readOnlyHint: true } }))).toBe(false);
  });

  it('recon rows are neutral phases in the engine context', () => {
    const t = compileWhen({ ...EMPTY_WHEN, roles: ['recon'] });
    expect(t).toBe('"phase_role":"neutral"');
    expect(fires(t, ctx({ role: 'neutral', seat: 'pi', cls: 'read' }))).toBe(true);
  });

  it('a class condition reads the broker class, not an argument named class', () => {
    const t = compileWhen({ ...EMPTY_WHEN, classes: ['write'] });
    expect(fires(t, ctx({ role: 'creator', seat: 'pi', cls: 'read', args: { class: 'write' } }))).toBe(false);
    expect(fires(t, ctx({ role: 'creator', seat: 'pi', cls: 'write' }))).toBe(true);
  });

  it('an argument pattern narrows by the call arguments', () => {
    const t = compileWhen({ ...EMPTY_WHEN, argPattern: '"project":"PAY"', roles: ['creator'] });
    expect(fires(t, ctx({ role: 'creator', seat: 'pi', cls: 'write', args: { project: 'PAY', summary: 'x' } }))).toBe(true);
    expect(fires(t, ctx({ role: 'creator', seat: 'pi', cls: 'write', args: { project: 'OPS' } }))).toBe(false);
  });

  it('a seat name is matched literally', () => {
    const t = compileWhen({ ...EMPTY_WHEN, seats: ['a.b'] });
    expect(fires(t, ctx({ role: 'creator', seat: 'axb', cls: 'write' }))).toBe(false);
    expect(fires(t, ctx({ role: 'creator', seat: 'a.b', cls: 'write' }))).toBe(true);
  });
});

function cell(over: Partial<McpPolicyCell>): McpPolicyCell {
  return { role: 'creator', seat: 'claude', mode: 'balanced', decision: 'allow', class: 'read', ruleIds: [], obligations: [], reason: null, ...over };
}

function tool(subject: string, cells: McpPolicyCell[]): McpPolicyPreviewTool {
  const [server = '', name = ''] = subject.slice(4).split('/');
  return { subject, server, tool: name, class: cells[0]?.class ?? 'read', status: 'registered', enabled: true, registered: true, approval: { firstUse: null, write: null }, cells };
}

describe('the posture summary', () => {
  it('counts each tool by what a creator unit gets in the chosen mode', () => {
    const tools = [
      tool('mcp:fx/a', [cell({ decision: 'allow', class: 'read' }), cell({ mode: 'ask', decision: 'allow', class: 'read' })]),
      tool('mcp:fx/b', [cell({ decision: 'ask', class: 'write' }), cell({ mode: 'autonomous', decision: 'allow', class: 'write' })]),
      tool('mcp:fx/c', [cell({ decision: 'deny', class: 'destructive' }), cell({ role: 'evaluator', decision: 'deny', class: 'destructive' })]),
    ];
    expect(postureSummary(tools, 'balanced')).toEqual({ allow: 1, ask: 1, deny: 1, text: '1 read run · 1 write ask · 1 denied' });
    expect(postureSummary(tools, 'autonomous').text).toBe('1 write run');
    expect(postureSummary([], 'balanced').text).toBe('no tools');
  });
});

describe('MCP rules on the Steering surface', () => {
  it('a rule governs MCP when it names an mcp token or ships in the mcp-defaults pack', () => {
    expect(isMcpRule({ id: 'MCP-POSTURE-WRITE' })).toBe(true);
    expect(isMcpRule({ id: 'SEC-1', applies_to: ['mcp:jira'] })).toBe(true);
    expect(isMcpRule({ id: 'SEC-2', applies_to: ['build'], excludes: ['mcp-mode:autonomous'] })).toBe(true);
    expect(isMcpRule({ id: 'SEC-3', applies_to: ['build', 'mcpx'] })).toBe(false);
  });

  it('suggests the next free MCP-POL id', () => {
    expect(nextMcpPolicyId([])).toBe('MCP-POL-100');
    expect(nextMcpPolicyId([{ id: 'MCP-POL-104' }, { id: 'POL-900' }])).toBe('MCP-POL-105');
  });

  it('the MCP filter rides ?mcp=1 beside the type filter', () => {
    expect(policiesPath(null, true)).toBe('/steering/policies?mcp=1');
    expect(policiesPath('security', true)).toBe('/steering/policies?type=security&mcp=1');
    expect(policiesPath('security')).toBe('/steering/policies?type=security');
    expect(readMcpFilter('?type=security&mcp=1')).toBe(true);
    expect(readMcpFilter('?mcp=0')).toBe(false);
  });
});

describe('the calls', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({});
  });

  it('ride the documented routes, subjects URL-encoded', async () => {
    await mcpApi.policies({ server: 'fx' });
    await mcpApi.approve('mcp:fx/wt_note');
    await mcpApi.revoke('mcp:fx/wt_note');
    await mcpApi.save('h1');
    await mcpApi.setTool('mcp:fx/wt_note', { enabled: false });
    expect(apiFetch.mock.calls.map((c) => [c[0], (c[1] as RequestInit | undefined)?.method, (c[1] as RequestInit | undefined)?.body])).toEqual([
      ['/mcp/policies/preview', 'POST', '{"server":"fx"}'],
      ['/mcp/approvals', 'POST', '{"subject":"mcp:fx/wt_note"}'],
      ['/mcp/approvals/mcp%3Afx%2Fwt_note', 'DELETE', undefined],
      ['/mcp/servers', 'POST', '{"previewHash":"h1"}'],
      ['/mcp/tools/mcp%3Afx%2Fwt_note', 'PATCH', '{"enabled":false}'],
    ]);
  });

  it('an absent route, a 501 and crew’s mcp_unavailable are "unsupported"; a named refusal is not', () => {
    expect(isMcpUnsupported(new ApiError(404, 'not found'))).toBe(true);
    expect(isMcpUnsupported(new ApiError(501, 'no preview'))).toBe(true);
    expect(isMcpUnsupported(new ApiError(503, 'x', { code: 'mcp_unavailable' }))).toBe(true);
    expect(isMcpUnsupported(new ApiError(503, 'x', { code: 'ledger_missing' }))).toBe(false);
    expect(isMcpUnsupported(new ApiError(404, 'no MCP server named fx'))).toBe(false);
  });
});
