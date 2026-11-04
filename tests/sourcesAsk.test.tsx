import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import type { McpServer, SourceConnectionTestResponse } from '../src/api/sources.js';
import { AskData, checkWords } from '../src/components/sources/AskData.js';
import { connectionTestLines } from '../src/components/sources/ConnectionTest.js';
import { DataPanel } from '../src/components/sources/DataPanel.js';
import { SourceSheet } from '../src/components/sources/SourceSheet.js';
import { SourcesPage } from '../src/components/sources/SourcesPage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { CATALOG, pgServer, READ_ONLY, WRITER } from './sourcesFixtures.js';

/**
 * Operator 2026-11-03: "the option to test the connection and to ask a question of the data to test it".
 *  - Test connection on a saved source (the sheet, and the data panel's row menu) replaces Describe again,
 *    and shows the new-source test's lines (connected in N ms, TLS, read-only or what the login can
 *    change) plus the read check and the time; a failure says why; nothing echoes a secret.
 *  - Ask: the SQL and the seat's one line show first and nothing has run; Run is live only for the exact
 *    text crew checked (an edit needs a new check); the rows show here, capped, "shown to you only".
 */

let calls: Array<{ path: string; method: string; body: unknown }> = [];
type Handler = (path: string, method: string, body: Record<string, unknown> | undefined) => Promise<unknown> | undefined;
let handler: Handler;

beforeEach(() => {
  calls = [];
  handler = () => undefined;
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
    calls.push({ path, method, body });
    const r = handler(path, method, body);
    if (r !== undefined) return r;
    if (path === '/sources/support-pg/catalog') return Promise.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

const OK_TEST: SourceConnectionTestResponse = {
  name: 'support-pg', kind: 'sql', driver: 'postgres', ok: true, ms: 41, testedAt: '2026-11-03T18:04:11.000Z', tls: 'verified',
  catalog: { name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) },
  readCheck: { ok: true, text: 'SELECT count(*) AS n FROM "support"."tickets"', relation: 'support.tickets' },
};

/** OK_TEST as a failure: no catalog, no read check. */
const TEST_BASE: Omit<SourceConnectionTestResponse, 'catalog' | 'readCheck'> = (() => {
  const t: Partial<SourceConnectionTestResponse> = { ...OK_TEST };
  delete t.catalog;
  delete t.readCheck;
  return t as Omit<SourceConnectionTestResponse, 'catalog' | 'readCheck'>;
})();
/** A saved GraphQL source (no sql settings). */
function gqlServer(): McpServer {
  const s: Partial<McpServer> = pgServer({ name: 'tix', kind: 'graphql' });
  delete s.sql;
  return s as McpServer;
}

describe('Test connection', () => {
  it('the lines: connected in N ms, TLS, read-only (or what the login can change), the read check, the time', () => {
    const lines = connectionTestLines(OK_TEST).map((l) => l.text);
    expect(lines[0]).toBe('Connected and described in 41 ms · Postgres');
    expect(lines[1]).toBe('TLS verified (verify-full)');
    expect(lines[2]).toContain('Read only: reader can’t change any table');
    expect(lines[3]).toBe('Reads: a count of support.tickets passes the read policy (checked, not run)');
    expect(lines[4]).toMatch(/^Tested at /);
    const writer = connectionTestLines({ ...OK_TEST, tls: 'off', catalog: { ...OK_TEST.catalog!, privileges: WRITER } });
    expect(writer.find((l) => l.id === 'tls')).toMatchObject({ tone: 'warn', text: 'No TLS (allowed on this address)' });
    expect(writer.find((l) => l.id === 'privileges')?.tone).toBe('warn');
    const failed = connectionTestLines({ ...TEST_BASE, ok: false, code: 'source_connection', error: 'password authentication failed for user "reader"' });
    expect(failed.map((l) => l.tone)).toEqual(['fail', 'warn']);
    expect(failed[0]!.text).toBe('Not connected: password authentication failed for user "reader" (source_connection)');
  });

  it('a saved source\'s sheet has Test connection, not Describe again; it shows the lines and the fresh tables', async () => {
    handler = (path, method) => (path === '/sources/support-pg/test' && method === 'POST' ? Promise.resolve(OK_TEST) : undefined);
    const onDescribed = vi.fn();
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onDescribed={onDescribed} onClose={vi.fn()} />);
    expect(screen.queryByTestId('source-describe')).toBeNull();
    expect(screen.queryByText('Describe again')).toBeNull();
    fireEvent.click(screen.getByTestId('source-test-connection'));
    const box = await screen.findByTestId('source-connection-test');
    expect(within(box).getByTestId('source-connection-test-connected').textContent).toBe('Connected and described in 41 ms · Postgres');
    expect(within(box).getByTestId('source-connection-test-when').textContent).toMatch(/^Tested at /);
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
    expect(onDescribed).toHaveBeenCalledWith('support-pg');
  });

  it('opened from the menu under StrictMode (mount effects twice): the test runs once and its answer shows (live look r1)', async () => {
    let release: (v: unknown) => void = () => {};
    handler = (path) => (path === '/sources/support-pg/test' ? new Promise((r) => { release = r; }) : undefined);
    render(<StrictMode><SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="test" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} /></StrictMode>);
    await new Promise((r) => setTimeout(r, 0));
    // The mount's catalog read started; once the test owns the catalog, StrictMode's replay starts none.
    expect(calls.filter((c) => c.path === '/sources/support-pg/catalog')).toHaveLength(1);
    release(OK_TEST);
    expect((await screen.findByTestId('source-connection-test-connected')).textContent).toBe('Connected and described in 41 ms · Postgres');
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
  });

  it('a failed test is a result with its time, not an empty box', async () => {
    handler = (path) => (path === '/sources/support-pg/test' ? Promise.resolve({ ...TEST_BASE, ok: false, ms: 3, code: 'secret_missing', error: 'keychain:wicked-mcp/support-pg resolves to no secret: save the source again with its password' }) : undefined);
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    const box = await screen.findByTestId('source-connection-test');
    expect(box.getAttribute('data-ok')).toBe('no');
    expect(within(box).getByRole('alert').textContent).toContain('resolves to no secret');
  });

  it('the data panel\'s row menu: Test connection opens the sheet and tests at once; Ask a question… for SQL only', async () => {
    const onTest = vi.fn();
    const onAsk = vi.fn();
    const gql = gqlServer();
    render(<DataPanel sources={[pgServer(), gql]} loading={false} error={null} onAdd={vi.fn()} onOpen={vi.fn()} onTest={onTest} onAsk={onAsk} onDeclare={vi.fn()} actions={[]} onGrantAction={vi.fn()} />);
    fireEvent.click(screen.getByTestId('data-panel-source-menu-support-pg-button'));
    fireEvent.click(screen.getByTestId('data-panel-test'));
    expect(onTest).toHaveBeenCalledWith('support-pg');
    fireEvent.click(screen.getByTestId('data-panel-source-menu-support-pg-button'));
    fireEvent.click(screen.getByTestId('data-panel-ask'));
    expect(onAsk).toHaveBeenCalledWith('support-pg');
    fireEvent.click(screen.getByTestId('data-panel-source-menu-tix-button'));
    expect(screen.getByTestId('data-panel-test')).toBeTruthy();
    expect(screen.queryByTestId('data-panel-ask')).toBeNull(); // GraphQL keeps its test call
    // The sheet opened with focus "test" tests once, by itself.
    handler = (path) => (path === '/sources/support-pg/test' ? Promise.resolve(OK_TEST) : undefined);
    cleanup();
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="test" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTestId('source-connection-test');
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
  });
});

const DRAFT = {
  sql: "SELECT count(*) AS open_tickets FROM support.tickets WHERE status = 'open'",
  explanation: 'Counts the tickets whose status is open: one number.',
  seat: 'claude',
  check: { ok: true, columns: [{ name: 'open_tickets', type: 'bigint' }], params: [], relations: ['"support"."tickets"'] },
  confirm: 'a'.repeat(64),
};

describe('Ask a question of this data', () => {
  it('shows the drafted SQL and the seat\'s line first: nothing runs until Run, and Run sends exactly the checked text with crew\'s token', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve(DRAFT);
      if (path === '/sources/support-pg/query' && body?.['confirm'] !== undefined) return Promise.resolve({ ran: true, columns: [{ name: 'open_tickets', type: 'bigint' }], rows: [['60']], truncated: false, rowCap: 50, ms: 7 });
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many tickets are open?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    const sql = (await screen.findByTestId('source-ask-sql')) as HTMLTextAreaElement;
    expect(sql.value).toBe(DRAFT.sql);
    expect(screen.getByTestId('source-ask-explanation').textContent).toBe('claude: Counts the tickets whose status is open: one number.');
    expect(screen.getByTestId('source-ask-check').textContent).toContain('Nothing has run yet');
    expect(calls.filter((c) => c.path === '/sources/support-pg/query')).toHaveLength(0); // shown, not run
    expect(calls[0]!.body).toEqual({ question: 'How many tickets are open?' });
    fireEvent.click(screen.getByTestId('source-ask-run'));
    const result = await screen.findByTestId('source-ask-result');
    expect(calls.filter((c) => c.path === '/sources/support-pg/query').map((c) => c.body)).toEqual([{ sql: DRAFT.sql, confirm: DRAFT.confirm }]);
    expect(within(result).getByTestId('source-ask-rows').textContent).toContain('60');
    expect(result.textContent).toContain('Shown to you only; no model sees them.');
  });

  it('an edit drops the run: the new text is checked first (no token is reused for another text)', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve(DRAFT);
      if (path === '/sources/support-pg/query' && body?.['confirm'] === undefined) return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'b'.repeat(64) });
      if (path === '/sources/support-pg/query') return Promise.resolve({ ran: true, columns: [{ name: 'n', type: 'bigint' }], rows: [['1']], truncated: false, rowCap: 50, ms: 3 });
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    const sql = await screen.findByTestId('source-ask-sql');
    const edited = `${DRAFT.sql} AND id > 10`;
    fireEvent.change(sql, { target: { value: edited } });
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    expect(screen.getByTestId('source-ask-stale')).toBeTruthy();
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    await screen.findByTestId('source-ask-run');
    expect(calls.filter((c) => c.path === '/sources/support-pg/query').map((c) => c.body)).toEqual([{ sql: edited }]);
    fireEvent.click(screen.getByTestId('source-ask-run'));
    await screen.findByTestId('source-ask-result');
    expect(calls.filter((c) => c.path === '/sources/support-pg/query').at(-1)!.body).toEqual({ sql: edited, confirm: 'b'.repeat(64) });
  });

  it('a refused draft says why and offers no Run; a capped result says so', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve({ ...DRAFT, sql: 'DROP TABLE support.tickets', check: { ok: false, code: 'not_select', detail: 'a read is one SELECT' }, confirm: null });
      if (path === '/sources/support-pg/query' && body?.['confirm'] === undefined) return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'c'.repeat(64) });
      if (path === '/sources/support-pg/query') return Promise.resolve({ ran: true, columns: [{ name: 'id', type: 'integer' }], rows: Array.from({ length: 50 }, (_, i) => [i + 1]), truncated: true, rowCap: 50, ms: 5 });
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'Drop it' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    const check = await screen.findByTestId('source-ask-check');
    expect(check.textContent).toBe('Refused (not_select): a read is one SELECT. Nothing ran.');
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    fireEvent.change(screen.getByTestId('source-ask-sql'), { target: { value: 'SELECT id FROM support.tickets ORDER BY id' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    fireEvent.click(await screen.findByTestId('source-ask-run'));
    const result = await screen.findByTestId('source-ask-result');
    expect(result.getAttribute('data-truncated')).toBe('yes');
    expect(result.textContent).toContain('50 rows in 5 ms: there are more than shown (at most 50 rows and 1 MB come back).');
  });

  it('write the SQL yourself: no model, the same check and run; no seat says so in words', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.reject(new ApiError(409, 'no seat can take a turn to draft the query: sign a seat in from the Agents page, or write the SQL yourself', { code: 'no_seat' }));
      if (path === '/sources/support-pg/query' && body?.['confirm'] === undefined) return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'd'.repeat(64) });
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    expect((await screen.findByTestId('source-ask-error')).textContent).toContain('write the SQL yourself');
    fireEvent.click(screen.getByTestId('source-ask-write-own'));
    fireEvent.change(screen.getByTestId('source-ask-sql'), { target: { value: 'SELECT count(*) FROM support.tickets' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    await screen.findByTestId('source-ask-run');
    expect(calls.filter((c) => c.path === '/sources/support-pg/ask')).toHaveLength(1);
  });

  it('the sheet of a saved SQL source carries the Ask box; a GraphQL source\'s does not', () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId('source-ask')).toBeTruthy();
    cleanup();
    handler = (path) => (path === '/sources/tix/catalog' ? Promise.resolve({ name: 'tix', kind: 'graphql', catalog: { queries: [], mutations: [], enums: [] }, descriptorHash: 'e' }) : undefined);
    render(<SourceSheet target={{ mode: 'saved', server: gqlServer() }} existing={['tix']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    expect(screen.queryByTestId('source-ask')).toBeNull();
  });

  it('check words', () => {
    expect(checkWords({ ok: true, columns: [{ name: 'n', type: 'bigint' }], params: [], relations: [] }).text).toBe('Passes the read policy: returns n (bigint). Nothing has run yet.');
  });
});

describe('sources-ask review r1 folds (codex, pi)', () => {
  it('a run refused by crew spends the check: Run goes, the text is checked again; after a run the check no longer says nothing ran', async () => {
    let runs = 0;
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve(DRAFT);
      if (path === '/sources/support-pg/query' && body?.['confirm'] !== undefined) {
        runs += 1;
        return runs === 1 ? Promise.resolve({ ran: true, columns: [{ name: 'n', type: 'bigint' }], rows: [['7']], truncated: false, rowCap: 50, ms: 2 })
          : Promise.reject(new ApiError(409, 'relation support.tickets is not in the catalog', { code: 'relation' }));
      }
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    fireEvent.click(await screen.findByTestId('source-ask-run'));
    await screen.findByTestId('source-ask-result');
    expect(screen.getByTestId('source-ask-check').textContent).not.toContain('Nothing has run yet');
    fireEvent.click(screen.getByTestId('source-ask-run'));
    expect((await screen.findByTestId('source-ask-run-error')).textContent).toContain('Check it again');
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    expect(screen.queryByTestId('source-ask-check')).toBeNull(); // no stale "passes"
    expect(screen.getByTestId('source-ask-check-run')).toBeTruthy();
  });

  it('an edited draft drops the seat\'s line (it described the drafted SQL) and says it was edited; a new question drops it too', async () => {
    handler = (path) => (path === '/sources/support-pg/ask' ? Promise.resolve(DRAFT) : undefined);
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    const sql = await screen.findByTestId('source-ask-sql');
    expect(screen.getByTestId('source-ask-explanation')).toBeTruthy();
    fireEvent.change(sql, { target: { value: `${DRAFT.sql} AND id > 1` } });
    expect(screen.queryByTestId('source-ask-explanation')).toBeNull();
    expect(screen.getByText('SQL (drafted, then edited)')).toBeTruthy();
    fireEvent.change(sql, { target: { value: DRAFT.sql } });
    expect(screen.getByTestId('source-ask-explanation')).toBeTruthy();
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'Something else?' } });
    expect(screen.queryByTestId('source-ask-explanation')).toBeNull();
  });

  it('an older check answer never marks a newer text checked (the answer for the old text is dropped)', async () => {
    let release: (v: unknown) => void = () => {};
    handler = (path, _m, body) => (path === '/sources/support-pg/query' && body?.['confirm'] === undefined ? new Promise((r) => { release = r; }) : undefined);
    render(<AskData source="support-pg" />);
    fireEvent.click(screen.getByTestId('source-ask-write-own'));
    const sql = screen.getByTestId('source-ask-sql');
    fireEvent.change(sql, { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    fireEvent.change(sql, { target: { value: 'SELECT 2' } }); // edited while the check is out
    release({ ran: false, check: DRAFT.check, confirm: 'e'.repeat(64) });
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    expect(screen.queryByTestId('source-ask-check')).toBeNull();
  });

  it('nothing runs without the Run click: drafting, re-rendering and waiting send no confirmed query; typed SQL runs exactly what was typed; no request carries a row value', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve(DRAFT);
      if (path === '/sources/support-pg/query' && body?.['confirm'] === undefined) return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'f'.repeat(64) });
      if (path === '/sources/support-pg/query') return Promise.resolve({ ran: true, columns: [{ name: 'title', type: 'text' }], rows: [['ROWVAL-9137']], truncated: false, rowCap: 50, ms: 3 });
      return undefined;
    };
    const view = render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    await screen.findByTestId('source-ask-run');
    view.rerender(<AskData source="support-pg" />);
    await new Promise((r) => setTimeout(r, 30));
    expect(calls.filter((c) => (c.body as Record<string, unknown> | undefined)?.['confirm'] !== undefined)).toHaveLength(0);
    // Typed SQL: check, then run exactly that text with its token.
    fireEvent.change(screen.getByTestId('source-ask-sql'), { target: { value: 'SELECT title FROM support.tickets LIMIT 1' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    fireEvent.click(await screen.findByTestId('source-ask-run'));
    expect((await screen.findByTestId('source-ask-rows')).textContent).toContain('ROWVAL-9137');
    expect(calls.filter((c) => (c.body as Record<string, unknown> | undefined)?.['confirm'] !== undefined).map((c) => c.body)).toEqual([{ sql: 'SELECT title FROM support.tickets LIMIT 1', confirm: 'f'.repeat(64) }]);
    // The rows stay here: a later request carries none of them.
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'And now?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    await screen.findByTestId('source-ask-explanation');
    expect(calls.some((c) => JSON.stringify(c.body ?? null).includes('ROWVAL-9137'))).toBe(false);
  });

  it('a thrown test clears the earlier lines; the source menu opens and closes around each choice', async () => {
    let fail = false;
    handler = (path) => (path === '/sources/support-pg/test' ? (fail ? Promise.reject(new Error('the daemon went away')) : Promise.resolve(OK_TEST)) : undefined);
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    await screen.findByTestId('source-connection-test');
    fail = true;
    fireEvent.click(screen.getByTestId('source-test-connection'));
    const failed = await screen.findByTestId('source-connection-test-failed');
    expect(failed.textContent).toContain('the daemon went away');
    expect(screen.getByTestId('source-connection-test').getAttribute('data-ok')).toBe('no');
    // None of the stored describe's green lines stand in for the failed test.
    expect(screen.queryByTestId('source-test-ok')).toBeNull();
    expect(screen.getByTestId('source-test').textContent).not.toMatch(/TLS verified|Connected and described|Read only/);
  });

  it('opened for "Ask a question…", the question has the focus after the dialog took it', async () => {
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="ask" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByTestId('source-ask-question'));
  });
});

describe('the Sources page wiring (sources-ask review r1, codex R1/T3)', () => {
  it('the row menu\'s Test connection opens the sheet and tests once; Back then Forward does not test again', async () => {
    useCapabilities.setState({ loaded: true, dataSources: true });
    handler = (path) => {
      if (path === '/mcp/servers') return Promise.resolve({ servers: [pgServer()], discovered: [] });
      if (path === '/sources/support-pg/test') return Promise.resolve(OK_TEST);
      return undefined;
    };
    let search = '';
    const navigate = vi.fn((to: string) => { search = to.includes('?') ? to.slice(to.indexOf('?')) : ''; });
    const view = render(<SourcesPage navigate={navigate} search={search} />);
    fireEvent.click(await screen.findByTestId('data-panel-source-menu-support-pg-button'));
    expect(screen.getByTestId('data-panel-test')).toBeTruthy();
    fireEvent.click(screen.getByTestId('data-panel-test'));
    expect(screen.queryByTestId('data-panel-test')).toBeNull(); // the menu closed on the choice
    view.rerender(<SourcesPage navigate={navigate} search={search} />);
    await screen.findByTestId('source-connection-test');
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
    view.rerender(<SourcesPage navigate={navigate} search="" />); // Back
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('source-sheet')).toBeNull();
    view.rerender(<SourcesPage navigate={navigate} search="?source=support-pg" />); // Forward
    await screen.findByTestId('source-sheet');
    await new Promise((r) => setTimeout(r, 10));
    expect(calls.filter((c) => c.path === '/sources/support-pg/test')).toHaveLength(1);
  });
});

describe('sources-ask review r2 folds (codex, pi)', () => {
  it('an older catalog read\'s failure does not stand beside a newer successful test', async () => {
    let rejectCatalog: (e: unknown) => void = () => {};
    let releaseTest: (v: unknown) => void = () => {};
    handler = (path) => {
      if (path === '/sources/support-pg/catalog') return new Promise((_r, rej) => { rejectCatalog = rej; });
      if (path === '/sources/support-pg/test') return new Promise((r) => { releaseTest = r; });
      return undefined;
    };
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    rejectCatalog(new Error('old catalog read failed'));
    await new Promise((r) => setTimeout(r, 0));
    releaseTest(OK_TEST);
    await screen.findByTestId('source-connection-test-connected');
    expect(screen.queryByTestId('source-sheet-error')).toBeNull();
  });

  it('the same sheet on a replaced source (a new descriptor or snapshot) starts the Ask box and the test afresh', async () => {
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/test') return Promise.resolve(OK_TEST);
      if (path === '/sources/support-pg/query' && body?.['confirm'] === undefined) return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'a'.repeat(64) });
      return undefined;
    };
    const props = { existing: ['support-pg'], onSaved: vi.fn(), onAllowWrites: vi.fn(), onClose: vi.fn() };
    const view = render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} {...props} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    await screen.findByTestId('source-connection-test');
    fireEvent.click(screen.getByTestId('source-ask-write-own'));
    fireEvent.change(screen.getByTestId('source-ask-sql'), { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    await screen.findByTestId('source-ask-run');
    view.rerender(<SourceSheet target={{ mode: 'saved', server: pgServer({ descriptorHash: 'e'.repeat(64) }) }} {...props} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    expect(screen.queryByTestId('source-ask-sql')).toBeNull();
    expect(screen.queryByTestId('source-connection-test')).toBeNull();
  });

  it('under StrictMode, "Ask a question…" still ends with the focus in the question; "Write the SQL yourself" moves it into the editor', async () => {
    render(<StrictMode><SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="ask" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} /></StrictMode>);
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByTestId('source-ask-question'));
    const own = screen.getByTestId('source-ask-write-own');
    own.focus();
    fireEvent.click(own);
    expect(document.activeElement).toBe(screen.getByTestId('source-ask-sql'));
  });

  it('a check answered as a run is not shown as a check', async () => {
    handler = (path) => (path === '/sources/support-pg/query' ? Promise.resolve({ ran: true, columns: [{ name: 'n', type: 'bigint' }], rows: [['1']], truncated: false, rowCap: 50, ms: 1 }) : undefined);
    render(<AskData source="support-pg" />);
    fireEvent.click(screen.getByTestId('source-ask-write-own'));
    fireEvent.change(screen.getByTestId('source-ask-sql'), { target: { value: 'SELECT 1' } });
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    expect((await screen.findByTestId('source-ask-run-error')).textContent).toContain('never do');
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    expect(screen.queryByTestId('source-ask-result')).toBeNull();
  });
});

describe('sources-ask review r3 folds (pi, codex)', () => {
  it('a failed test drops a catalog read still out (no second error, no structure refreshed under "Not connected"); an unanswered test says studio waited', async () => {
    let rejectCatalog: (e: unknown) => void = () => {};
    let rejectTest: (e: unknown) => void = () => {};
    handler = (path) => {
      if (path === '/sources/support-pg/catalog') return new Promise((_r, rej) => { rejectCatalog = rej; });
      if (path === '/sources/support-pg/test') return new Promise((_r, rej) => { rejectTest = rej; });
      return undefined;
    };
    render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    rejectTest(new Error('down'));
    await screen.findByTestId('source-connection-test-failed');
    rejectCatalog(new Error('old catalog read failed'));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('source-sheet-error')).toBeNull();
    expect(screen.getByTestId('source-connection-test-when').textContent).toMatch(/no answer after \d+ ms of waiting/);
  });

  it('an old test answer released after the source was replaced lands nowhere', async () => {
    let releaseTest: (v: unknown) => void = () => {};
    handler = (path) => (path === '/sources/support-pg/test' ? new Promise((r) => { releaseTest = r; }) : undefined);
    const onDescribed = vi.fn();
    const props = { existing: ['support-pg'], onSaved: vi.fn(), onAllowWrites: vi.fn(), onDescribed, onClose: vi.fn() };
    const view = render(<SourceSheet target={{ mode: 'saved', server: pgServer() }} {...props} />);
    fireEvent.click(screen.getByTestId('source-test-connection'));
    view.rerender(<SourceSheet target={{ mode: 'saved', server: pgServer({ descriptorHash: 'e'.repeat(64) }) }} {...props} />);
    await new Promise((r) => setTimeout(r, 0));
    releaseTest(OK_TEST);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('source-connection-test')).toBeNull();
    expect(onDescribed).not.toHaveBeenCalled();
  });

  it('a run crew answers with a check shows that check and says nothing ran; the result scrolls by keyboard and says long values show cut', async () => {
    let runs = 0;
    handler = (path, _m, body) => {
      if (path === '/sources/support-pg/ask') return Promise.resolve(DRAFT);
      if (path === '/sources/support-pg/query' && body?.['confirm'] !== undefined) {
        runs += 1;
        return runs === 1 ? Promise.resolve({ ran: false, check: { ok: false, code: 'relation', detail: 'gone' }, confirm: null }) : Promise.resolve({ ran: true, columns: [{ name: 'n', type: 'bigint' }], rows: [['1']], truncated: false, rowCap: 50, ms: 1 });
      }
      if (path === '/sources/support-pg/query') return Promise.resolve({ ran: false, check: DRAFT.check, confirm: 'c'.repeat(64) });
      return undefined;
    };
    render(<AskData source="support-pg" />);
    fireEvent.change(screen.getByTestId('source-ask-question'), { target: { value: 'How many?' } });
    fireEvent.click(screen.getByTestId('source-ask-draft'));
    fireEvent.click(await screen.findByTestId('source-ask-run'));
    expect((await screen.findByTestId('source-ask-run-error')).textContent).toContain('Nothing ran');
    expect(screen.getByTestId('source-ask-check').textContent).toContain('Refused (relation)');
    expect(screen.queryByTestId('source-ask-run')).toBeNull();
    fireEvent.click(screen.getByTestId('source-ask-check-run'));
    fireEvent.click(await screen.findByTestId('source-ask-run'));
    await screen.findByTestId('source-ask-result');
    const scroll = screen.getByTestId('source-ask-scroll');
    expect(scroll.getAttribute('tabindex')).toBe('0');
    expect(scroll.getAttribute('aria-label')).toBe('Query result');
    expect(screen.getByTestId('source-ask-result').textContent).toContain('A very long value shows shortened');
  });
});

describe('sources-ask review r4 fold (codex)', () => {
  for (const late of ['resolves', 'rejects'] as const) {
    it(`under StrictMode, a failed menu test owns the catalog: a replayed catalog read that ${late} late changes nothing`, async () => {
      const catalogs: Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
      let rejectTest: (e: unknown) => void = () => {};
      handler = (path) => {
        if (path === '/sources/support-pg/catalog') return new Promise((resolve, reject) => { catalogs.push({ resolve, reject }); });
        if (path === '/sources/support-pg/test') return new Promise((_r, rej) => { rejectTest = rej; });
        return undefined;
      };
      render(<StrictMode><SourceSheet target={{ mode: 'saved', server: pgServer() }} focus="test" existing={['support-pg']} onSaved={vi.fn()} onAllowWrites={vi.fn()} onClose={vi.fn()} /></StrictMode>);
      await new Promise((r) => setTimeout(r, 0));
      rejectTest(new Error('down'));
      await screen.findByTestId('source-connection-test-failed');
      for (const c of catalogs) {
        if (late === 'resolves') c.resolve({ name: 'support-pg', kind: 'sql', catalog: CATALOG, privileges: READ_ONLY, descriptorHash: 'd'.repeat(64) });
        else c.reject(new Error('late'));
      }
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByTestId('source-described')).toBeNull();
      expect(screen.queryByTestId('source-test-ok')).toBeNull();
      expect(screen.queryByTestId('source-sheet-error')).toBeNull();
      expect(screen.getByTestId('source-connection-test').getAttribute('data-ok')).toBe('no');
    });
  }
});
