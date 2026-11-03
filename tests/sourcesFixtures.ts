/**
 * Wire fixtures for the Apps source sheet and data panel, shaped exactly like crew's K1 answers
 * (api-types 0.175.0; crew e9eab43 `src/sources/routes.ts`, `api/mcp.ts`).
 */
import type {
  McpPreviewResponse,
  McpServer,
  SourceCatalogRelation,
  SourcePrivilegeReport,
  SourceSafetyResponse,
  SqlSourceCatalog,
} from 'wicked-crew-api-types';

export const TICKETS: SourceCatalogRelation = {
  schema: 'support', name: 'tickets', kind: 'table', rowEstimate: 20400,
  columns: [
    { name: 'id', type: 'integer', nullable: false },
    { name: 'status', type: 'support.ticket_status', nullable: false, enumValues: ['open', 'pending', 'escalated', 'closed'] },
    { name: 'owner', type: 'text', nullable: true },
  ],
  primaryKey: ['id'], foreignKeys: [], rowSecurity: false,
};

export const ASSIGNMENTS: SourceCatalogRelation = {
  schema: 'support', name: 'assignments', kind: 'table', rowEstimate: 2,
  columns: [{ name: 'id', type: 'integer', nullable: false }, { name: 'ticket_id', type: 'integer', nullable: false }, { name: 'owner', type: 'text', nullable: false }],
  primaryKey: ['id'], foreignKeys: [],
};

export const CATALOG: SqlSourceCatalog = { dialect: 'postgres', database: 'support', relations: [ASSIGNMENTS, TICKETS], describedAt: '2026-11-03T14:00:00.000Z' };

export const READ_ONLY: SourcePrivilegeReport = {
  login: 'reader', superuser: false, readOnly: true,
  tables: [{ schema: 'support', table: 'tickets', select: true, selectSomeColumns: true, insert: false, update: false, delete: false }],
  writes: [],
};

export const WRITER: SourcePrivilegeReport = {
  login: 'writer', superuser: false, readOnly: false,
  tables: [
    { schema: 'support', table: 'tickets', select: true, selectSomeColumns: true, insert: false, update: true, delete: false },
    { schema: 'support', table: 'assignments', select: true, selectSomeColumns: true, insert: false, update: true, delete: false },
  ],
  writes: [],
};

export function pgServer(over: Partial<McpServer> = {}): McpServer {
  return {
    name: 'support-pg', kind: 'sql', command: null, args: [], url: null, auth: { ref: 'keychain:wicked-mcp/support-pg' },
    sql: { driver: 'postgres', host: 'db.support.internal', port: 5432, database: 'support', user: 'reader', tls: 'verify-full', ca: false, snapshot: null },
    viewsAllowed: [], allowWrites: false, descriptorHash: 'd'.repeat(64), address: { allow: ['10.40.2.0/24'], plaintext: false },
    authState: 'set', enabled: true, health: { state: 'ok', consecutiveFailures: 0, checkedAt: null, lastError: null },
    registeredAt: '2026-11-03T14:00:00.000Z', updatedAt: '2026-11-03T14:00:00.000Z', tools: [],
    counts: { total: 0, enabled: 0, registered: 0, read: 0, write: 0, destructive: 0 },
    ...over,
  };
}

export function pgPreview(name: string, privileges: SourcePrivilegeReport = READ_ONLY): McpPreviewResponse {
  return {
    previewHash: `ph-${name}`, expiresAt: '2026-11-03T14:10:00.000Z',
    server: { name, kind: 'sql', command: null, args: [], url: null, auth: { ref: `keychain:wicked-mcp/${name}` }, sql: { driver: 'postgres', host: 'db.support.internal', port: 5432, database: 'support', user: privileges.login, tls: 'verify-full', ca: false, snapshot: null } },
    source: { catalog: CATALOG, privileges },
    serverInfo: { name: 'postgres', version: '' }, tools: [], diff: null,
  };
}

/** crew's human words for an unconfirmed private host (`sources/dialer.ts` resolveTarget). */
export const UNCONFIRMED_WORDS = 'the server did not answer tools/list: db.support.internal (10.40.2.17) is a private address, which a source reaches only when the person confirms a range covering it for that source (e.g. 10.0.0.0/8)';

export const TRIGGER_UNSAFE: SourceSafetyResponse = {
  table: { schema: 'support', name: 'assignments' }, safe: false,
  reasons: [
    { code: 'user_trigger', detail: '`support.assignments` has trigger `audit_owner`: v1 row writes need a plain table' },
    { code: 'depend_net', detail: 'trigger audit_owner on table support.assignments depends on function support.audit_owner_fn(), outside pg_catalog: code attached to `support.assignments`' },
  ],
  fingerprint: 'f'.repeat(64),
};

export const TICKETS_SAFE: SourceSafetyResponse = { table: { schema: 'support', name: 'tickets' }, safe: true, reasons: [], fingerprint: 'a1b2c3d4e5f6'.padEnd(64, '0') };

/** A REST preview: one read, one write; `egress` when the base URL is not one of the document's servers. */
export function restPreview(hash: string, egress: McpPreviewResponse['egress'] = { origin: 'https://api.support.test', basePath: '/v1', servers: ['https://api.support.test/v1'], matches: true, privateAddress: false, resolved: true, confirmRequired: false }): McpPreviewResponse {
  const tool = (name: string, cls: 'read' | 'write') => ({ name, rest: null, subject: `mcp:tickets-api/${name}`, description: null, annotations: null, inputSchema: null, class: cls, classOverride: null, schemaHash: `h-${name}`, enabledOnSave: cls === 'read' });
  return {
    previewHash: hash, expiresAt: '2026-11-03T14:10:00.000Z',
    server: { name: 'tickets-api', kind: 'rest', command: null, args: [], url: 'https://api.support.test/v1', auth: null, openapiUrl: 'https://api.support.test/openapi.json' },
    serverInfo: null, tools: [tool('list_tickets', 'read'), tool('assign_ticket', 'write')], diff: null, egress,
  };
}
