/**
 * The source sheet's and the data panel's pure model (DES-APPS-001 §5, §7.4; mockup state A).
 *
 * Everything here is a function of what the person typed and what crew answered, so every word the
 * sheet says is pinned by `tests/sourceModel.test.ts`. The secret is not here: it lives only in the
 * password input (`SecretField`) and is read at the send.
 */

import type {
  McpAddressPolicy,
  McpPreviewResponse,
  McpServer,
  McpServerConfigBody,
  SourceCatalog,
  SourceCatalogRelation,
  SourcePrivilegeReport,
  SourceRowWrite,
  SourceSafetyResponse,
  SqlSourceCatalog,
} from '../../api/sources.js';

/** The kinds rail, in the mockup's order. */
export type SheetKind = 'postgres' | 'mysql' | 'rest' | 'graphql' | 'mcp' | 'upload' | 'crew';

export const SHEET_KINDS: ReadonlyArray<{ kind: SheetKind; label: string; meta?: string }> = [
  { kind: 'postgres', label: 'Postgres' },
  { kind: 'mysql', label: 'MySQL' },
  { kind: 'rest', label: 'REST · OpenAPI' },
  { kind: 'graphql', label: 'GraphQL' },
  { kind: 'mcp', label: 'MCP server' },
  { kind: 'upload', label: 'Upload (CSV, XLSX, SQLite)' },
  { kind: 'crew', label: 'crew', meta: 'built in' },
];

export const isSqlKind = (k: SheetKind): k is 'postgres' | 'mysql' => k === 'postgres' || k === 'mysql';
export const isApiKind = (k: SheetKind): k is 'rest' | 'graphql' | 'mcp' => k === 'rest' || k === 'graphql' || k === 'mcp';

/** What the person typed, except the secret (which never enters React state). */
export interface SourceForm {
  kind: SheetKind;
  name: string;
  host: string;
  port: string;
  database: string;
  user: string;
  tls: 'verify-full' | 'disable';
  /** A CA certificate (PEM) for a server not signed by a public root. */
  ca: string;
  /** REST: the base URL; GraphQL: the endpoint; MCP: the server URL. */
  url: string;
  /** REST: the OpenAPI document URL. */
  openapiUrl: string;
  /** REST, GraphQL, MCP: the header the secret is sent in, and the scheme before it. */
  authHeader: string;
  authScheme: string;
  /**
   * The ranges the person ticked, one per loopback or private address crew named (a name can resolve to
   * several: `localhost` is `::1` and `127.0.0.1`), and the connection they were ticked for (`targetKey`).
   * A tick for another host, port or URL confirms nothing: `confirmedAddress` drops it.
   */
  confirm: { ranges: string[]; plaintext: boolean; forTarget: string } | null;
}

export const EMPTY_FORM: SourceForm = {
  kind: 'postgres', name: '', host: '', port: '', database: '', user: '', tls: 'verify-full', ca: '',
  url: '', openapiUrl: '', authHeader: '', authScheme: '', confirm: null,
};

export const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function defaultPort(kind: SheetKind): number | null {
  return kind === 'postgres' ? 5432 : kind === 'mysql' ? 3306 : null;
}

/** The connection a range confirmation is bound to: where crew will dial. */
export function targetKey(f: SourceForm): string {
  if (isSqlKind(f.kind)) return `${f.kind}|${f.host.trim().toLowerCase()}|${f.port.trim() || String(defaultPort(f.kind))}`;
  return `${f.kind}|${f.url.trim()}|${f.kind === 'rest' ? f.openapiUrl.trim() : ''}`;
}

/** The confirmation that still speaks for the form (`null` once the host, port or URL changed). */
export function confirmedAddress(f: SourceForm): McpAddressPolicy | null {
  if (f.confirm === null || f.confirm.forTarget !== targetKey(f) || f.confirm.ranges.length === 0) return null;
  return { allow: [...f.confirm.ranges], ...(f.confirm.plaintext ? { plaintext: true } : {}) };
}

/** The form with one asked range ticked or unticked (the other ticks for the same connection kept). */
export function withRange(f: SourceForm, range: string, on: boolean, plaintext: boolean): SourceForm {
  const forTarget = targetKey(f);
  const held = f.confirm !== null && f.confirm.forTarget === forTarget ? f.confirm.ranges : [];
  const ranges = on ? (held.includes(range) ? held : [...held, range]) : held.filter((r) => r !== range);
  return { ...f, confirm: ranges.length === 0 ? null : { ranges, plaintext, forTarget } };
}

/** The keychain entry a typed secret goes into: this source's own (crew's rule for a staged secret). */
export const keychainRef = (name: string): string => `keychain:wicked-mcp/${name}`;

/** A header scheme as sent: `Bearer` gets its space, `token=` stays as typed. */
export function schemePrefix(scheme: string): string {
  const s = scheme.trim();
  if (s === '') return '';
  return /[=:]$/.test(s) ? s : `${s} `;
}

/**
 * The preview body for the form. `hasSecret` says whether the person typed one (its VALUE is added at
 * the send, never here, so no key, log or state built from this body can hold it).
 */
export function configBody(f: SourceForm, hasSecret: boolean): McpServerConfigBody | null {
  const name = f.name.trim();
  const address = confirmedAddress(f);
  const withAddress = address !== null ? { address } : {};
  if (isSqlKind(f.kind)) {
    const port = f.port.trim() === '' ? undefined : Number(f.port.trim());
    return {
      name,
      kind: 'sql',
      sql: {
        driver: f.kind,
        host: f.host.trim(),
        ...(port !== undefined ? { port } : {}),
        database: f.database.trim(),
        user: f.user.trim(),
        tls: f.tls,
        ...(f.ca.trim() !== '' ? { ca: f.ca.trim() } : {}),
      },
      auth: hasSecret ? { ref: keychainRef(name) } : null,
      ...withAddress,
    };
  }
  if (isApiKind(f.kind)) {
    const header = f.authHeader.trim();
    const auth = hasSecret ? { ref: keychainRef(name), header: header === '' ? 'Authorization' : header, ...(schemePrefix(f.authScheme) !== '' ? { prefix: schemePrefix(f.authScheme) } : {}) } : null;
    const kind = f.kind === 'mcp' ? 'mcp-http' : f.kind;
    return { name, kind, url: f.url.trim(), ...(f.kind === 'rest' ? { openapiUrl: f.openapiUrl.trim() } : {}), auth, ...withAddress };
  }
  return null;
}

/** Why the form can't be tested yet, or `null` when it can. */
export function formBlocker(f: SourceForm): string | null {
  if (!NAME_RE.test(f.name.trim())) return 'Name: 1-63 of a-z 0-9 _ -, starting with a letter or digit';
  if (f.name.trim() === 'crew') return '"crew" is the built-in source; choose another name';
  if (isSqlKind(f.kind)) {
    if (f.host.trim() === '') return 'Host is needed';
    if (f.port.trim() !== '' && !(/^\d{1,5}$/.test(f.port.trim()) && Number(f.port.trim()) >= 1 && Number(f.port.trim()) <= 65535)) return 'Port is 1-65535';
    if (f.database.trim() === '') return 'Database is needed';
    if (f.user.trim() === '') return 'Login is needed';
    return null;
  }
  if (isApiKind(f.kind)) {
    if (!/^https?:\/\/\S+$/.test(f.url.trim())) return f.kind === 'rest' ? 'Base URL is an http(s) URL' : 'URL is an http(s) URL';
    if (f.kind === 'rest' && !/^https?:\/\/\S+$/.test(f.openapiUrl.trim())) return 'OpenAPI document URL is an http(s) URL';
    return null;
  }
  return null;
}

/**
 * The one key a preview answer belongs to: the whole config the person asked about, the confirmation
 * included, plus a COUNTER of secret edits (never the secret). A late answer for another key is dropped,
 * and Save sends only a preview whose key is the form's now.
 */
export function previewKey(f: SourceForm, hasSecret: boolean, secretEdits: number): string {
  return JSON.stringify([configBody(f, hasSecret), secretEdits]);
}

// ── the address confirmation (DES §5.2) ──────────────────────────────────────────────────────

export interface UnconfirmedAddress {
  /** The address crew resolved the host to, as crew wrote it. */
  address: string;
  cls: 'private' | 'loopback';
  /** The narrow range the sheet offers: a private IPv4 address's /24 (the mockup), else the address itself. */
  range: string;
}

/**
 * The address a 409 `address_unconfirmed` names. crew's words to a human are
 * "`<host> (<address>)` is a private address, which a source reaches only when the person confirms a
 * range covering it …" (an IP literal host is written bare). `null` when the words say neither.
 */
export function unconfirmedAddress(words: string): UnconfirmedAddress | null {
  const m = /(?:\(([0-9A-Fa-f.:]+)\)|(?<![\w.:])([0-9A-Fa-f.:]{2,}))\s+is a (private|loopback) address/.exec(words);
  if (m === null) return null;
  const address = (m[1] ?? m[2] ?? '').toLowerCase();
  const cls = m[3] as 'private' | 'loopback';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (v4 !== null) {
    if (v4.slice(1).some((o) => Number(o) > 255)) return null;
    return { address, cls, range: cls === 'private' ? `${v4[1]}.${v4[2]}.${v4[3]}.0/24` : `${address}/32` };
  }
  if (!address.includes(':')) return null;
  return { address, cls, range: `${address}/128` };
}

// ── what the sheet says ──────────────────────────────────────────────────────────────────────

export function isSqlCatalog(c: SourceCatalog | null | undefined): c is SqlSourceCatalog {
  return c !== null && c !== undefined && 'relations' in c;
}

/** The enum types a SQL catalog declares (by type name), in first-seen order. */
export function enumTypes(c: SqlSourceCatalog): string[] {
  const seen: string[] = [];
  for (const r of c.relations) for (const col of r.columns) {
    if (col.enumValues !== undefined && !seen.includes(col.type)) seen.push(col.type);
  }
  return seen;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** "6 tables · 58 columns" */
export function describedLine(c: SqlSourceCatalog): string {
  const cols = c.relations.reduce((n, r) => n + r.columns.length, 0);
  const tables = c.relations.filter((r) => r.kind === 'table' || r.kind === 'partitioned').length;
  const other = c.relations.length - tables;
  return [plural(tables, 'table'), ...(other > 0 ? [plural(other, 'view or other relation', 'views or other relations')] : []), plural(cols, 'column')].join(' · ');
}

/** "~20,400 rows" (a planner estimate), "5 rows" (exact, SQLite), or "rows unknown". */
export function rowsLine(r: SourceCatalogRelation, exact: boolean): string {
  if (r.rowEstimate === null || r.rowEstimate < 0) return 'rows unknown';
  return `${exact ? '' : '~'}${plural(Math.round(r.rowEstimate), 'row')}`;
}

/** A relation's display name: `schema.table` (SQLite has no schema). */
export function relationName(r: Pick<SourceCatalogRelation, 'schema' | 'name'>): string {
  return r.schema === null ? r.name : `${r.schema}.${r.name}`;
}

/** "What agents see" (DES §5.2): the structure, the declared enums, never a value. */
export function agentsSeeWords(kind: SheetKind | 'sqlite', catalog: SourceCatalog | null): string {
  const tail = 'No values from rows, ever. Agents building an app can’t call this source.';
  if (kind === 'crew') return 'The allowlisted routes and the shape of what each answers. Reads run in crew as the person viewing. Agents building an app can’t call this source.';
  if (kind === 'rest' || kind === 'mcp') {
    return 'Each operation’s name, arguments and response schema, and the enums the schema declares. No values from responses, ever. Agents building an app can’t call this source.';
  }
  if (kind === 'graphql') {
    const enums = catalog !== null && 'enums' in catalog ? catalog.enums.map((e) => e.name) : [];
    return `Root fields, their arguments and types${enums.length > 0 ? `, and the ${plural(enums.length, 'enum')} the schema declares (${enums.join(', ')})` : ''}. No values from responses, ever. Agents building an app can’t call this source.`;
  }
  if (!isSqlCatalog(catalog)) return `Table and column names, types, keys and row estimates. ${tail}`;
  const enums = enumTypes(catalog);
  const named = enums.map((t) => t.replace(/^[^.]+\./, ''));
  return `Table and column names, types, keys, row estimates${enums.length > 0 ? `, and the ${plural(enums.length, 'enum type')} the schema declares (${named.join(', ')})` : ''}. ${tail}`;
}

/** The tables this login can change (`schema.table (update, insert)`), from the privilege report. */
export function writableTables(p: SourcePrivilegeReport): string[] {
  return p.tables
    .filter((t) => t.update || t.insert || t.delete)
    .map((t) => `${t.schema}.${t.table} (${[t.update ? 'update' : null, t.insert ? 'insert' : null, t.delete ? 'delete' : null].filter((x) => x !== null).join(', ')})`);
}

/** The Test box's privilege line: read only, or how many tables this login can also change. */
export function privilegeLine(p: SourcePrivilegeReport): { tone: 'ok' | 'warn'; text: string } {
  if (p.superuser) return { tone: 'warn', text: `${p.login} is a superuser: it can read and change everything, and no check can narrow that. A read-only login is safer. Writes would still need Allow writes, a grant, and a card every time.` };
  if (p.readOnly) return { tone: 'ok', text: `Read only: ${p.login} can’t change any table.` };
  const n = writableTables(p).length;
  return { tone: 'warn', text: `This login can also write to ${n > 0 ? plural(n, 'table') : 'something here (a sequence, a view or a foreign table)'}. A read-only login is safer. Writes would still need Allow writes, a grant, and a card every time.` };
}

/** DES §7.4: what turning Allow writes on allows, in words. */
export const ALLOW_WRITES_ALLOWS =
  'When on, apps in this project may ask to change single rows through this login: updates of ordinary columns, and inserts or deletes on tables with no foreign keys, only on tables that pass the safety check. Each action is granted once and asks every time.';

export function allowWritesCanChange(p: SourcePrivilegeReport | null | undefined): string | null {
  if (p === null || p === undefined) return null;
  const t = writableTables(p);
  return t.length === 0 ? 'This login can’t change any table now.' : `This login can currently change: ${t.join(', ')}.`;
}

/** The kind chip a source row carries in the data panel. */
export function sourceChip(s: McpServer): string {
  if (s.kind === 'sql') return s.sql?.driver === 'sqlite' ? 'upload' : s.allowWrites === true ? 'sql · writes' : 'sql';
  if (s.kind === 'graphql') return 'graphql';
  if (s.kind === 'rest') return 'rest';
  return 'mcp';
}

/** The sheet kind a saved source opens as. */
export function sheetKindOf(s: McpServer): SheetKind {
  if (s.kind === 'sql') return s.sql?.driver === 'mysql' ? 'mysql' : s.sql?.driver === 'sqlite' ? 'upload' : 'postgres';
  if (s.kind === 'graphql') return 'graphql';
  if (s.kind === 'rest') return 'rest';
  return 'mcp';
}

/** The REST/MCP operations a preview lists, as reads and writes (crew's class: GET or readOnlyHint). */
export function operationsByClass(p: McpPreviewResponse): { reads: string[]; writes: string[] } {
  const reads = p.tools.filter((t) => t.class === 'read').map((t) => t.name);
  const writes = p.tools.filter((t) => t.class !== 'read').map((t) => t.name);
  return { reads, writes };
}

// ── row writes (DES §7.4 "What may be declared") ──────────────────────────────────────────────

export type RowWriteOp = 'update' | 'insert' | 'delete';

/**
 * The declaration a table's menu makes: the key is EVERY primary-key column; an update sets the
 * non-key columns the person picks; an insert supplies every column; a delete sets none. `string` is
 * why it can't be declared.
 */
export function declareRowWrite(r: SourceCatalogRelation, op: RowWriteOp, picked: readonly string[]): SourceRowWrite | string {
  if (r.schema === null) return 'Row writes are for Postgres tables only';
  if (r.kind !== 'table') return `${relationName(r)} is a ${r.kind === 'partitioned' ? 'partitioned table' : r.kind}: v1 row writes need a plain table`;
  if (r.primaryKey.length === 0) return `${relationName(r)} has no primary key: a row write is keyed on the whole primary key`;
  const key = [...r.primaryKey];
  if (op === 'delete') return { schema: r.schema, table: r.name, op, set: [], key };
  if (op === 'insert') return { schema: r.schema, table: r.name, op, set: r.columns.map((c) => c.name), key };
  const set = r.columns.map((c) => c.name).filter((c) => picked.includes(c) && !key.includes(c));
  if (set.length === 0) return 'Pick at least one column to set (the key columns are not changed)';
  return { schema: r.schema, table: r.name, op, set, key };
}

/** "UPDATE s.w SET owner WHERE id" — the declaration in one line. */
export function rowWriteLine(w: SourceRowWrite): string {
  const t = `${w.schema}.${w.table}`;
  const where = w.key.join(', ');
  if (w.op === 'update') return `UPDATE ${t} SET ${w.set.join(', ')} WHERE ${where}`;
  if (w.op === 'insert') return `INSERT INTO ${t} (${w.set.join(', ')})`;
  return `DELETE FROM ${t} WHERE ${where}`;
}

/**
 * Where a grant stands (DES §7.4, §9.4), in the order crew checks it: Allow writes first (nothing is
 * asked of the source while it is off), then the table safety check, then the login's privileges.
 */
export type GrantGate =
  | { step: 'writes-off'; source: string }
  | { step: 'unsafe'; table: string; reasons: SourceSafetyResponse['reasons'] }
  | { step: 'missing-grants'; missing: string[] }
  | { step: 'ready'; fingerprint: string };

export function grantGate(
  source: string,
  allowWrites: boolean,
  safety: SourceSafetyResponse | null,
  missing: readonly string[] | null,
): GrantGate | null {
  if (!allowWrites) return { step: 'writes-off', source };
  if (safety === null) return null;
  if (!safety.safe) return { step: 'unsafe', table: `${safety.table.schema}.${safety.table.name}`, reasons: safety.reasons };
  if (missing === null) return null;
  if (missing.length > 0) return { step: 'missing-grants', missing: [...missing] };
  return { step: 'ready', fingerprint: safety.fingerprint };
}

/** crew's words carry identifiers in backticks: split them so the sheet sets them as code. */
export function codeSpans(words: string): Array<{ code: boolean; text: string }> {
  const out: Array<{ code: boolean; text: string }> = [];
  const parts = words.split('`');
  parts.forEach((text, i) => {
    if (text === '') return;
    // An unpaired backtick leaves the rest as plain words.
    const code = i % 2 === 1 && i < parts.length - (parts.length % 2 === 0 ? 1 : 0);
    out.push({ code, text });
  });
  return out;
}
