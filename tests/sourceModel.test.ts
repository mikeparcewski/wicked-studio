/**
 * The source sheet's pure model (DES-APPS-001 §5, §7.4): the address a refusal names and the range the
 * sheet offers, the confirmation bound to the connection it was given for, the preview body (never the
 * secret), the row-write declaration rules, the grant gate's order, and the words.
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  agentsSeeWords,
  allowWritesCanChange,
  codeSpans,
  configBody,
  confirmedAddress,
  declareRowWrite,
  EMPTY_FORM,
  grantGate,
  previewKey,
  privilegeLine,
  rowWriteLine,
  plaintextOffered,
  rowWriteKey,
  targetKey,
  unconfirmedAddress,
  withEdit,
  withPlaintext,
  withRange,
  type SourceForm,
} from '../src/components/sources/sourceModel.js';
import { ASSIGNMENTS, CATALOG, READ_ONLY, TICKETS, TICKETS_SAFE, TRIGGER_UNSAFE, UNCONFIRMED_WORDS, WRITER } from './sourcesFixtures.js';

const PG: SourceForm = { ...EMPTY_FORM, kind: 'postgres', name: 'support-pg', host: 'db.support.internal', port: '5432', database: 'support', user: 'reader' };

describe('the address a refusal names (crew dialer words)', () => {
  it('a private host name: its resolved address, and the /24 the mockup offers', () => {
    expect(unconfirmedAddress(UNCONFIRMED_WORDS)).toEqual({ address: '10.40.2.17', cls: 'private', range: '10.40.2.0/24' });
  });
  it('an IP literal and a loopback address: the address itself', () => {
    expect(unconfirmedAddress('the server did not answer tools/list: 127.0.0.1 is a loopback address, which a source reaches only when …'))
      .toEqual({ address: '127.0.0.1', cls: 'loopback', range: '127.0.0.1/32' });
    expect(unconfirmedAddress('localhost (::1) is a loopback address, which …')).toEqual({ address: '::1', cls: 'loopback', range: '::1/128' });
  });
  it('words that name no address, or an impossible one, offer nothing', () => {
    expect(unconfirmedAddress('the server did not answer tools/list: connect ECONNREFUSED')).toBeNull();
    expect(unconfirmedAddress('10.300.2.17 is a private address')).toBeNull();
  });
});

describe('the confirmation is bound to the connection it was given for', () => {
  it('a tick rides the body; a host or port edit drops it', () => {
    const ticked = withRange(PG, '10.40.2.0/24', true);
    expect(confirmedAddress(ticked)).toEqual({ allow: ['10.40.2.0/24'] });
    expect(configBody(ticked, false)).toMatchObject({ address: { allow: ['10.40.2.0/24'] } });
    expect(confirmedAddress({ ...ticked, host: 'db2.support.internal' })).toBeNull();
    expect(configBody({ ...ticked, port: '6543' }, false)).not.toHaveProperty('address');
  });
  it('nothing is confirmed until a range is ticked; several addresses add up, unticking removes one', () => {
    expect(configBody(PG, false)).not.toHaveProperty('address');
    const both = withRange(withRange(PG, '::1/128', true), '127.0.0.1/32', true);
    expect(confirmedAddress(both)?.allow).toEqual(['::1/128', '127.0.0.1/32']);
    expect(confirmedAddress(withRange(both, '::1/128', false))?.allow).toEqual(['127.0.0.1/32']);
    expect(confirmedAddress(withRange(withRange(PG, '::1/128', true), '::1/128', false))).toBeNull();
  });
  it('the target key changes with where crew dials, so a stale tick confirms nothing', () => {
    expect(targetKey(PG)).not.toBe(targetKey({ ...PG, host: 'other' }));
    expect(targetKey({ ...EMPTY_FORM, kind: 'rest', url: 'https://a/v1', openapiUrl: 'https://a/o.json' }))
      .not.toBe(targetKey({ ...EMPTY_FORM, kind: 'rest', url: 'https://a/v1', openapiUrl: 'https://b/o.json' }));
  });
});

describe('no consent carries to another connection (review r1: codex S1, pi P2)', () => {
  it('"without TLS" given for host A is not carried to host B\'s range', () => {
    const a = withPlaintext(withRange({ ...PG, tls: 'disable' }, '10.40.2.0/24', true), true);
    expect(confirmedAddress(a)).toEqual({ allow: ['10.40.2.0/24'], plaintext: true });
    const b = withRange({ ...a, host: 'db-b.support.internal' }, '10.40.9.0/24', true);
    expect(confirmedAddress(b)).toEqual({ allow: ['10.40.9.0/24'] });
  });
  it('adding a range drops "without TLS": it was given for the ranges shown then (codex r2)', () => {
    const a = withPlaintext(withRange({ ...PG, tls: 'disable' }, '10.40.2.0/24', true), true);
    const widened = withRange(a, '10.40.9.0/24', true);
    expect(confirmedAddress(widened)).toEqual({ allow: ['10.40.2.0/24', '10.40.9.0/24'] });
    // Narrowing keeps it; re-ticking a range already held keeps it.
    const both = withPlaintext(widened, true);
    expect(confirmedAddress(withRange(both, '10.40.9.0/24', false))).toEqual({ allow: ['10.40.2.0/24'], plaintext: true });
    expect(confirmedAddress(withRange(both, '10.40.2.0/24', true))?.plaintext).toBe(true);
  });
  it('an edit that moves the connection drops the confirmation; a name edit keeps it', () => {
    const a = withRange(PG, '10.40.2.0/24', true);
    expect(withEdit(a, { host: 'elsewhere' }).confirm).toBeNull();
    expect(withEdit(a, { port: '6543' }).confirm).toBeNull();
    expect(withEdit(a, { database: 'other' }).confirm).not.toBeNull();
  });
  it('"without TLS" applies only to the connection it was given for', () => {
    const stale = { ...withRange(PG, '10.40.2.0/24', true), host: 'elsewhere' };
    expect(withPlaintext(stale, true)).toBe(stale);
  });
  it('plaintext is offered for SQL with TLS off, and for an http: API URL (codex K17)', () => {
    expect(plaintextOffered({ ...PG, tls: 'disable' })).toBe(true);
    expect(plaintextOffered(PG)).toBe(false);
    expect(plaintextOffered({ ...EMPTY_FORM, kind: 'graphql', url: 'http://10.40.2.17/graphql' })).toBe(true);
    expect(plaintextOffered({ ...EMPTY_FORM, kind: 'graphql', url: 'https://10.40.2.17/graphql' })).toBe(false);
    expect(plaintextOffered({ ...EMPTY_FORM, kind: 'rest', url: 'https://a/v1', openapiUrl: 'http://10.0.0.5/openapi.json' })).toBe(true);
  });
});

describe('a declaration\'s identity (review r1: codex C3, C4)', () => {
  it('differs in source, schema, table, operation, columns and key; never truncated', () => {
    const w = { schema: 'support', table: 'tickets', op: 'update' as const, set: ['owner'], key: ['id'] };
    const keys = [
      rowWriteKey('a', w), rowWriteKey('b', w), rowWriteKey('a', { ...w, schema: 'other' }), rowWriteKey('a', { ...w, set: ['status'] }),
      rowWriteKey('a', { ...w, op: 'delete', set: [] }), rowWriteKey('a', { ...w, table: 't'.repeat(120) }), rowWriteKey('a', { ...w, table: `${'t'.repeat(120)}x` }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(rowWriteKey('a', w)).toBe(rowWriteKey('a', { ...w }));
  });
});

describe('the preview body and key never hold the secret', () => {
  it('a typed secret only names its keychain entry; the key holds a counter, not a value', () => {
    const body = configBody(PG, true);
    expect(body).toEqual({
      name: 'support-pg', kind: 'sql',
      sql: { driver: 'postgres', host: 'db.support.internal', port: 5432, database: 'support', user: 'reader', tls: 'verify-full' },
      auth: { ref: 'keychain:wicked-mcp/support-pg' },
    });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(previewKey(PG, true, 1)).not.toBe(previewKey(PG, true, 2));
  });
  it('an API source sends its secret in a header, behind its scheme', () => {
    expect(configBody({ ...EMPTY_FORM, kind: 'graphql', name: 'g', url: 'https://api/graphql', authScheme: 'Bearer' }, true))
      .toMatchObject({ kind: 'graphql', auth: { ref: 'keychain:wicked-mcp/g', header: 'Authorization', prefix: 'Bearer ' } });
  });
});

describe('a row write from a table\'s menu (DES §7.4 "What may be declared")', () => {
  it('update: the whole primary key, the picked non-key columns', () => {
    expect(declareRowWrite(TICKETS, 'update', ['owner', 'id'])).toEqual({ schema: 'support', table: 'tickets', op: 'update', set: ['owner'], key: ['id'] });
    expect(declareRowWrite(TICKETS, 'update', [])).toMatch(/at least one column/);
  });
  it('insert supplies every column; delete sets none', () => {
    expect(declareRowWrite(TICKETS, 'insert', [])).toMatchObject({ op: 'insert', set: ['id', 'status', 'owner'], key: ['id'] });
    expect(declareRowWrite(TICKETS, 'delete', ['owner'])).toMatchObject({ op: 'delete', set: [] });
  });
  it('no primary key, a view or an upload: not declarable, with why', () => {
    expect(declareRowWrite({ ...TICKETS, primaryKey: [] }, 'update', ['owner'])).toMatch(/no primary key/);
    expect(declareRowWrite({ ...TICKETS, kind: 'view' }, 'update', ['owner'])).toMatch(/plain table/);
    expect(declareRowWrite({ ...TICKETS, schema: null }, 'update', ['owner'])).toMatch(/Postgres/);
  });
  it('the one line names the statement shape', () => {
    expect(rowWriteLine({ schema: 'support', table: 'tickets', op: 'update', set: ['owner'], key: ['id'] })).toBe('UPDATE support.tickets SET owner WHERE id');
  });
});

describe('the grant gate, in crew\'s order', () => {
  it('Allow writes off refuses first, before anything is asked of the source', () => {
    expect(grantGate('w', false, TRIGGER_UNSAFE, [])).toEqual({ step: 'writes-off', source: 'w' });
  });
  it('then the safety check, with every reason', () => {
    expect(grantGate('w', true, TRIGGER_UNSAFE, null)).toEqual({ step: 'unsafe', table: 'support.assignments', reasons: TRIGGER_UNSAFE.reasons });
  });
  it('then the missing privileges, then ready with the fingerprint', () => {
    expect(grantGate('w', true, TICKETS_SAFE, ['GRANT UPDATE ON support.tickets TO writer;'])).toEqual({ step: 'missing-grants', missing: ['GRANT UPDATE ON support.tickets TO writer;'] });
    expect(grantGate('w', true, TICKETS_SAFE, [])).toEqual({ step: 'ready', fingerprint: TICKETS_SAFE.fingerprint });
  });
});

describe('the words', () => {
  it('what agents see names the declared enum types and says no values', () => {
    expect(agentsSeeWords('postgres', { ...CATALOG, relations: [TICKETS, ASSIGNMENTS] }))
      .toBe('Table and column names, types, keys, row estimates, and the 1 enum type the schema declares (ticket_status). No values from rows, ever. Agents building an app can’t call this source.');
  });
  it('the privilege line: read only, or how many tables the login can also change', () => {
    expect(privilegeLine(READ_ONLY)).toEqual({ tone: 'ok', text: 'Read only: reader can’t change any table.' });
    expect(privilegeLine(WRITER).text).toMatch(/^This login can also write to 2 tables\. A read-only login is safer/);
  });
  it('Allow writes says which tables this login can change now', () => {
    expect(allowWritesCanChange(WRITER)).toBe('This login can currently change: support.tickets (update), support.assignments (update).');
    expect(allowWritesCanChange(READ_ONLY)).toBe('This login can’t change any table now.');
    // Not read only, yet no row-level write listed (TRUNCATE, a sequence, a view): never "can't change" (codex D19).
    expect(allowWritesCanChange({ ...READ_ONLY, readOnly: false })).toMatch(/can still change data another way/);
    expect(allowWritesCanChange(null)).toBeNull();
  });
  it('crew\'s backticked identifiers become code; an unpaired backtick stays words', () => {
    expect(codeSpans('`s.t` has trigger `t1`: plain')).toEqual([{ code: true, text: 's.t' }, { code: false, text: ' has trigger ' }, { code: true, text: 't1' }, { code: false, text: ': plain' }]);
    expect(codeSpans('a `b')).toEqual([{ code: false, text: 'a ' }, { code: false, text: 'b' }]);
  });
});
