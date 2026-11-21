

// ── MCP policies: the preview matrix and approvals (DES-MCP-TOOLS-001 §4.5, §4.7, §8, slice S6; api-types 0.63.0) ──

// ── MCP usage: the fold over the call records (DES-MCP-TOOLS-001 §7 Usage, §8 `GET /mcp/usage`; slice S7; api-types 0.66.0) ──

import type { McpUpstreamKind, McpToolClass, McpToolStatus, McpHealthState, McpAuthState, McpToolAnnotations, McpAuthConfig, McpServerConfigBody, McpRestMapping, McpHealth, McpTool, McpServer, McpDiscoveredServer, McpServersResponse, McpGhCliState, McpToolDiff, McpPreviewTool, McpPreviewResponse as WireMcpPreviewResponse, SaveMcpServerBody, PatchMcpServerBody, PatchMcpToolBody, McpServerTestResponse, PutMcpSecretBody, McpSecretResponse, McpDecision, McpPhaseRole, McpRunMode, McpPolicyCell, McpApprovalState, McpPolicyPreviewTool, McpPolicyPreviewBody, McpPolicyPreviewResponse, McpApproval, McpPendingApproval, McpLedgerState, McpApprovalsResponse, McpApprovalBody, McpApprovalResponse, McpCallDecision, McpDecisionCounts, McpUsageStats, McpUsageTool, McpUsageServer, McpUsageRun, McpUsageChain, McpUsageDay, McpUsageResponse } from 'wicked-crew-api-types';
export type { McpUpstreamKind, McpToolClass, McpToolStatus, McpHealthState, McpAuthState, McpToolAnnotations, McpAuthConfig, McpServerConfigBody, McpRestMapping, McpHealth, McpTool, McpServer, McpDiscoveredServer, McpServersResponse, McpGhCliState, McpToolDiff, McpPreviewTool, McpPreviewResponse, SaveMcpServerBody, PatchMcpServerBody, PatchMcpToolBody, McpServerTestResponse, PutMcpSecretBody, McpSecretResponse, McpDecision, McpPhaseRole, McpRunMode, McpPolicyCell, McpApprovalState, McpPolicyPreviewTool, McpPolicyPreviewBody, McpPolicyPreviewResponse, McpApproval, McpPendingApproval, McpLedgerState, McpApprovalsResponse, McpApprovalBody, McpApprovalResponse, McpCallDecision, McpDecisionCounts, McpUsageStats, McpUsageTool, McpUsageServer, McpUsageRun, McpUsageChain, McpUsageDay, McpUsageResponse };

/** Local extension of the pinned api-types 0.216.0 preview for api-types 0.218.0 (crew#1558). */
interface McpPreviewResponse extends WireMcpPreviewResponse {
  /**
   * Human operator view only: sorted names for a non-empty stdio env, never values.
   * Advice for approving the per-server allowlist; runtime controls can affect startup,
   * code loading, package resolution or network trust. Not an authorization gate.
   */
  envNames?: Array<{ name: string; class: 'runtime_control' | 'app_setting' }>;
}
