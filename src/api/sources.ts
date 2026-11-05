/**
 * Apps data sources (DES-APPS-001 §5, §7.4; crew K1, api-types 0.175.0): the calls the source sheet and
 * the data panel make.
 *
 * A source is an entry of crew's ONE connector registry, added through the same preview and save as an
 * MCP server (`POST /mcp/servers/preview`, then `POST /mcp/servers {previewHash}`). The preview DIALS
 * and describes: for a `sql` or `graphql` source it answers the catalog (structure, never a row value)
 * and, for Postgres, the login's privilege report. A password rides the preview body as `secret` and
 * crew writes it to the OS keychain when the save commits; no response ever carries it back.
 *
 * `setAllowWrites` is the Allow writes switch's own call: `AllowWritesSwitch` is its only caller
 * (`tests/sourcesHumanOnly.test.ts` pins that), so no URL, palette verb, plugin request or chat path can
 * reach it. crew refuses it to anything but a human operator, too. `ask` and `query` are the same:
 * `AskData` is their only caller, and crew answers them to a human operator only.
 */

import { apiFetch } from './client.js';
import type {
  McpPreviewResponse,
  SourceCheckResponse,
  McpServer,
  McpServerConfigBody,
  McpServersResponse,
  SourceAllowWritesResponse,
  SourceCatalogResponse,
  SourcePrivilegeReport,
  SourceRowWrite,
  SourceSafetyBody,
  SourceSafetyResponse,
  SourceTestCallResponse,
  SourceUploadResponse,
} from 'wicked-crew-api-types';

export type {
  CrewSourceCatalog,
  GraphqlSourceCatalog,
  McpAddressPolicy,
  McpPreviewResponse,
  McpServer,
  McpServerConfigBody,
  SourceAllowWritesResponse,
  SourceCatalog,
  SourceCatalogColumn,
  SourceCatalogRelation,
  SourceCatalogResponse,
  SourceCheckResponse,
  SourcePrivilegeReport,
  SourceRowWrite,
  SourceSafetyBody,
  SourceSafetyResponse,
  SourceTestCallRequest,
  SourceTestCallResponse,
  SourceUploadResponse,
  SqlSourceCatalog,
  SqlSourceConfigBody,
} from 'wicked-crew-api-types';

// ── Test connection, and ask a question of the data (crew api-types 0.179.0) ─────────────────────
// Declared here, as crew's wire contract 0.179.0 spells them, until that version of
// wicked-crew-api-types is published; then they are imported from it like the rest.

/** `POST /sources/:name/test`: connect, describe again (saved) and check a probe read (never run). */
export interface SourceConnectionTestResponse {
  name: string;
  kind: 'sql' | 'graphql';
  driver: 'postgres' | 'mysql' | 'sqlite' | null;
  ok: boolean;
  ms: number;
  testedAt: string;
  tls: 'verified' | 'off' | 'local';
  catalog?: SourceCatalogResponse;
  readCheck?: ({ ok: true; text: string; relation: string } | { ok: false; text: string; relation: string; code: string; detail: string }) | null;
  code?: string;
  error?: string;
}

/** `POST /sources/:name/ask` (human operator only): one seat's draft, checked; nothing ran. */
export interface SourceAskResponse {
  sql: string;
  explanation: string;
  seat: string;
  check: SourceCheckResponse | null;
  confirm: string | null;
}

/** `POST /sources/:name/query` (human operator only): the check (`ran: false`), or the run. */
export type SourceQueryResponse =
  | { ran: false; check: SourceCheckResponse; confirm: string | null }
  | { ran: true; columns: Array<{ name: string; type: string }>; rows: unknown[][]; truncated: boolean; rowCap: number; ms: number };

/** The page's address: `/sources` (Build & settings → Data sources). `?source=<name>` opens one. */
export const SOURCES_PATH = '/sources';
export function sourcesPath(source?: string | null): string {
  return source ? `${SOURCES_PATH}?source=${encodeURIComponent(source)}` : SOURCES_PATH;
}
export function readSourceDeepLink(search: string): string | null {
  const v = new URLSearchParams(search).get('source');
  return v === null || v === '' ? null : v;
}

/** The built-in `crew` source: nothing to add, always on. */
export const CREW_SOURCE = 'crew';

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });
const at = (name: string, rest: string): string => `/sources/${encodeURIComponent(name)}/${rest}`;

export const sourcesApi = {
  /** Every registered server; the data panel keeps the data sources (and the API kinds an app may read). */
  list: () => apiFetch<McpServersResponse>('/mcp/servers'),
  /**
   * Describe a source that is not saved yet. `secret` is the password or token the person typed: it is
   * sent here, and only here, and crew holds it with the preview until the save.
   */
  preview: (body: McpServerConfigBody, secret: string | null) =>
    apiFetch<McpPreviewResponse>('/mcp/servers/preview', post(secret === null || secret === '' ? body : { ...body, secret })),
  /**
   * Register exactly the preview `previewHash` named (and write its secret to the keychain). `allowOrigin`
   * is the origin a REST preview's calls go to, sent only when the person confirmed it (G2).
   */
  save: (previewHash: string, allowOrigin?: string, enabledWrites?: readonly string[]) =>
    apiFetch<McpServer>('/mcp/servers', post({
      previewHash,
      ...(allowOrigin !== undefined ? { allowOrigin } : {}),
      // (G1) The person's write grant: the preview's write tools to register enabled (a PM sheet's ticked "Asks you" rows).
      ...(enabledWrites !== undefined && enabledWrites.length > 0 ? { enabledWrites: [...enabledWrites] } : {}),
    })),
  catalog: (name: string) => apiFetch<SourceCatalogResponse>(at(name, 'catalog')),
  /** Test connection: connect with the saved login, describe again (saved) and check a read; no row is read. */
  testConnection: (name: string) => apiFetch<SourceConnectionTestResponse>(at(name, 'test'), { method: 'POST' }),
  /** A seat drafts one read query from the question and the structure; crew checks it; nothing runs. */
  ask: (name: string, question: string) => apiFetch<SourceAskResponse>(at(name, 'ask'), post({ question })),
  /** Without `confirm`, crew checks `sql`; with crew's token for exactly that text, it runs it (read only, 50 rows). */
  query: (name: string, sql: string, confirm?: string) => apiFetch<SourceQueryResponse>(at(name, 'query'), post(confirm === undefined ? { sql } : { sql, confirm })),
  privileges: (name: string, writes: SourceRowWrite[]) => apiFetch<SourcePrivilegeReport>(at(name, 'privileges'), post({ writes })),
  safety: (name: string, body: SourceSafetyBody) => apiFetch<SourceSafetyResponse>(at(name, 'safety'), post(body)),
  /** The Allow writes switch. Human operator only (crew answers 403 to anything else). */
  setAllowWrites: (name: string, allowed: boolean) =>
    apiFetch<SourceAllowWritesResponse>(at(name, 'allow-writes'), { method: 'PUT', body: JSON.stringify({ allowed }) }),
  /** G6: without `confirm`, crew names the one request and sends nothing; with its hash, it sends exactly that. */
  testCall: (name: string, target: string, args: Record<string, unknown>, confirm?: string) =>
    apiFetch<SourceTestCallResponse>(at(name, 'test-call'), post({ target, args, ...(confirm !== undefined ? { confirm } : {}) })),
  /** A file becomes a `sql`/`sqlite` source (registered at once; a later upload of the same name replaces it). */
  upload: (name: string, file: File, header: 'yes' | 'no' | null) => {
    const q = new URLSearchParams({ name, filename: file.name });
    if (header !== null) q.set('header', header);
    return apiFetch<SourceUploadResponse>(`/apps/uploads?${q.toString()}`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  },
};
