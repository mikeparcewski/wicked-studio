import { MCP_SERVER_KIND } from '../../api/editors.js';
import type { AdapterResult, ArtifactRef, McpHostBridge } from '../host.js';
import { registerAdapter, type SurfaceAdapter, type AdapterCapability, type ArtifactBinding } from '../hostApi.js';

/**
 * `mcp` (HOST-API §3): the plugin's artifact is the MCP server itself — no content beyond what
 * `mcp.state` says. Read-only.
 */
export class McpSurfaceAdapter implements SurfaceAdapter {
  readonly source = 'mcp' as const;
  private readonly at = new Date().toISOString();
  private readonly titleOf: () => string;

  constructor(title: string | (() => string), private readonly bridge?: McpHostBridge) {
    this.titleOf = typeof title === 'function' ? title : () => title;
  }

  mcpBridge(): McpHostBridge | undefined {
    return this.bridge;
  }

  capabilities(): readonly AdapterCapability[] {
    return ['read', 'mcp'];
  }

  artifact(): ArtifactRef {
    return { kind: MCP_SERVER_KIND, title: this.titleOf(), version: 1, head: 1, readonly: true, lockedParts: [] };
  }

  async read(): Promise<AdapterResult<{ version: number; content: Record<string, unknown> }>> {
    return { version: 1, content: { type: MCP_SERVER_KIND, title: this.titleOf() } };
  }

  async versions(): Promise<AdapterResult<{ versions: { version: number; parent: number | null; createdAt: string }[]; head: number }>> {
    return { versions: [{ version: 1, parent: null, createdAt: this.at }], head: 1 };
  }

  async write(): Promise<AdapterResult<{ version: number }>> {
    return { error: 'unsupported', message: 'an MCP server is not edited here' };
  }

  async undo(): Promise<AdapterResult<{ undone: true }>> {
    return { error: 'unsupported', message: 'an MCP server is not edited here' };
  }

  async fork(): Promise<AdapterResult<{ version: number }>> {
    return { error: 'unsupported', message: 'an MCP server is not edited here' };
  }
}

registerAdapter('mcp', (b: ArtifactBinding) => new McpSurfaceAdapter(() => b.title));
