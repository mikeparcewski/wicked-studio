import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import type { McpServer, SourceCatalogRelation } from 'wicked-crew-api-types';
import { RowWriteDialog, type RowWriteGrantPort } from '../src/components/sources/RowWriteDialog.js';
import { ASSIGNMENTS, pgServer, TICKETS, TICKETS_SAFE, TRIGGER_UNSAFE, WRITER } from './sourcesFixtures.js';

/**
 * Declaring a row write from a table's menu and granting it (DES-APPS-001 §7.4, §9.4; K3 acceptance):
 *  - while Allow writes is off the grant is refused with why, the switch is offered in place, and
 *    nothing is asked of the source (0 safety, 0 privileges, 0 grants);
 *  - on a table with a trigger the grant is refused with crew's reason naming the trigger, and nothing
 *    is granted;
 *  - a table that passes reaches the host's grant with its fingerprint, once;
 *  - the offered switch turns writes on only after its own explicit confirmation.
 */

let calls: Array<{ path: string; method: string; body: unknown }> = [];
let safety = TRIGGER_UNSAFE;

beforeEach(() => {
  calls = [];
  safety = TRIGGER_UNSAFE;
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ path, method, body });
    if (path.endsWith('/safety')) return Promise.resolve(safety);
    if (path.endsWith('/privileges')) return Promise.resolve({ ...WRITER, writes: [{ write: (body as { writes: unknown[] }).writes[0], missing: [] }] });
    if (path.endsWith('/allow-writes') && method === 'PUT') return Promise.resolve({ name: 'support-pg-writer', allowWrites: (body as { allowed: boolean }).allowed, withdrawnGrants: 0 });
    return Promise.reject(new Error(`unexpected ${method} ${path}`));
  });
});
afterEach(() => cleanup());

/** The dialog under a host that keeps the source record (the switch's answer updates it, as SourcesPage does). */
function Host({ relation, writes, port }: { relation: SourceCatalogRelation; writes: boolean; port: RowWriteGrantPort }): React.ReactElement {
  const [source, setSource] = useState<McpServer>(pgServer({ name: 'support-pg-writer', allowWrites: writes, sql: { ...pgServer().sql!, user: 'writer' } }));
  return (
    <RowWriteDialog source={source} relation={relation} privileges={WRITER} declared={null} port={port}
      onDeclared={() => {}} onAllowWrites={(allowed) => setSource((s) => ({ ...s, allowWrites: allowed }))} onClose={() => {}} />
  );
}

function declareOwner(): void {
  fireEvent.click(screen.getByTestId('row-write-col-owner'));
  fireEvent.click(screen.getByTestId('row-write-declare'));
}

describe('granting a row write', () => {
  it('while Allow writes is off: refused with why, the switch offered, nothing asked of the source', async () => {
    const grant = vi.fn(async () => null);
    render(<Host relation={ASSIGNMENTS} writes={false} port={{ grant }} />);
    declareOwner();
    expect(screen.getByTestId('row-write-line').textContent).toBe('UPDATE support.assignments SET owner WHERE id');
    fireEvent.click(screen.getByTestId('row-write-grant'));
    const refused = await screen.findByTestId('row-write-refused');
    expect(refused.getAttribute('data-why')).toBe('writes-off');
    expect(refused.textContent).toContain('Can’t grant: Allow writes is off for support-pg-writer.');
    expect(refused.textContent).toContain('no row write on this source can be granted, prepared or run');
    // The switch is offered right there, off, with what it allows and what this login can change.
    const sw = within(refused).getByTestId('row-write-allow-writes-switch');
    expect(sw.getAttribute('aria-checked')).toBe('false');
    expect(within(refused).getByTestId('row-write-allow-writes-can-change').textContent).toContain('support.assignments (update)');
    expect(calls).toEqual([]);
    expect(grant).not.toHaveBeenCalled();
  });

  it('the offered switch turns writes on only after its own confirmation; then the grant goes on to the safety check', async () => {
    const grant = vi.fn(async () => null);
    render(<Host relation={TICKETS} writes={false} port={{ grant }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    await screen.findByTestId('row-write-refused');
    fireEvent.click(screen.getByTestId('row-write-allow-writes-switch'));
    expect(calls.filter((c) => c.path.endsWith('/allow-writes'))).toEqual([]); // the first click only asks
    fireEvent.click(screen.getByTestId('row-write-allow-writes-confirm-on'));
    await waitFor(() => expect(screen.queryByTestId('row-write-refused')).toBeNull());
    expect(calls.filter((c) => c.path.endsWith('/allow-writes'))).toEqual([{ path: '/sources/support-pg-writer/allow-writes', method: 'PUT', body: { allowed: true } }]);
    safety = TICKETS_SAFE;
    fireEvent.click(screen.getByTestId('row-write-grant'));
    await screen.findByTestId('row-write-outcome');
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('on a table with a trigger: refused with the reason naming the trigger; nothing granted', async () => {
    const grant = vi.fn(async () => null);
    render(<Host relation={ASSIGNMENTS} writes port={{ grant }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    const refused = await screen.findByTestId('row-write-refused');
    expect(refused.getAttribute('data-why')).toBe('unsafe');
    expect(refused.textContent).toContain('Can’t grant: support.assignments doesn’t pass the table safety check.');
    const reasons = within(refused).getAllByTestId('row-write-reason');
    expect(reasons[0]!.getAttribute('data-code')).toBe('user_trigger');
    expect(reasons[0]!.textContent).toBe('support.assignments has trigger audit_owner: v1 row writes need a plain table');
    expect(reasons[0]!.querySelectorAll('code')).toHaveLength(2);
    expect(calls.map((c) => c.path)).toEqual(['/sources/support-pg-writer/safety']);
    expect(calls[0]!.body).toEqual({ schema: 'support', table: 'assignments', write: { op: 'update', set: ['owner'], key: ['id'] } });
    expect(grant).not.toHaveBeenCalled();
  });

  it('a plain table passes: the missing privileges are asked for, then the host grants once with the fingerprint', async () => {
    safety = TICKETS_SAFE;
    const grant = vi.fn(async () => null);
    render(<Host relation={TICKETS} writes port={{ grant }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    const ok = await screen.findByTestId('row-write-outcome');
    expect(calls.map((c) => c.path)).toEqual(['/sources/support-pg-writer/safety', '/sources/support-pg-writer/privileges']);
    expect(grant).toHaveBeenCalledWith('support-pg-writer', { schema: 'support', table: 'tickets', op: 'update', set: ['owner'], key: ['id'] }, TICKETS_SAFE.fingerprint);
    expect(ok.textContent).toContain('Granted: UPDATE support.tickets SET owner WHERE id.');
  });

  it('a login missing a privilege: the exact GRANTs, and no grant', async () => {
    safety = TICKETS_SAFE;
    apiFetch.mockImplementation((path: string, init?: RequestInit) => {
      calls.push({ path, method: init?.method ?? 'GET', body: undefined });
      if (path.endsWith('/safety')) return Promise.resolve(TICKETS_SAFE);
      return Promise.resolve({ ...WRITER, writes: [{ write: {}, missing: ['GRANT SELECT ON support.tickets TO writer;'] }] });
    });
    const grant = vi.fn(async () => null);
    render(<Host relation={TICKETS} writes port={{ grant }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    expect((await screen.findByTestId('row-write-missing')).textContent).toBe('GRANT SELECT ON support.tickets TO writer;');
    expect(grant).not.toHaveBeenCalled();
  });
});

describe('review r1 folds (codex C13, pi P3)', () => {
  it('while a grant is being checked the declaration is locked, so the answer can only be for what is shown', async () => {
    let answer: (v: unknown) => void = () => {};
    apiFetch.mockImplementation(() => new Promise((r) => { answer = r; }));
    const grant = vi.fn(async () => null);
    render(<Host relation={TICKETS} writes port={{ grant }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    expect(screen.getByTestId('row-write-op-delete')).toBeDisabled();
    expect(screen.getByTestId('row-write-col-owner')).toBeDisabled();
    answer(TRIGGER_UNSAFE);
    await screen.findByTestId('row-write-refused');
    expect(screen.getByTestId('row-write-op-delete')).not.toBeDisabled();
  });

  it('a host that did not grant is not shown as a success', async () => {
    safety = TICKETS_SAFE;
    render(<Host relation={TICKETS} writes port={{ grant: async () => 'Nothing was granted: a grant belongs to an app.' }} />);
    declareOwner();
    fireEvent.click(screen.getByTestId('row-write-grant'));
    const out = await screen.findByTestId('row-write-outcome');
    expect(out.getAttribute('data-granted')).toBe('no');
    expect(out.className).not.toContain('okbox');
  });
});
