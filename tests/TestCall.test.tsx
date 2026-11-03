import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../src/api/client.js', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { ApiError } from '../src/api/errors.js';
import { TestCall } from '../src/components/sources/TestCall.js';

/**
 * The test call (G6, DES-APPS-001 §5.1; K3 acceptance): it shows its request before sending. "Name the
 * request" sends nothing and shows what would be sent; only "Send this request" sends, exactly once and
 * bound to the named hash; an edit drops the named request; a request that changed at crew is named again.
 */

const HASH = 'c'.repeat(64);
const REQUEST = { kind: 'rest' as const, summary: 'GET http://127.0.0.1:54729/v1/tickets?page=1', method: 'GET', url: 'http://127.0.0.1:54729/v1/tickets?page=1', headers: ['accept', 'Authorization'] };
let calls: Array<{ path: string; body: Record<string, unknown> }> = [];
let sendImpl: () => Promise<unknown>;

beforeEach(() => {
  calls = [];
  sendImpl = () => Promise.resolve({ sent: true, request: REQUEST, ok: true, status: 200, result: { data: { items: [{ id: 4800 }] } }, truncated: false });
  apiFetch.mockReset();
  apiFetch.mockImplementation((path: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ path, body });
    return body['confirm'] === undefined ? Promise.resolve({ sent: false, request: REQUEST, requestHash: HASH }) : sendImpl();
  });
});
afterEach(() => cleanup());

describe('the test call names its request before sending', () => {
  it('naming sends nothing and shows method, URL and header names; Send sends exactly that, once', async () => {
    render(<TestCall source="tickets-api" kind="rest" reads={['list_tickets', 'get_ticket']} />);
    expect(screen.queryByTestId('source-test-call-send')).toBeNull(); // nothing to send before it is named
    fireEvent.change(screen.getByTestId('source-test-call-args'), { target: { value: '{"page":1}' } });
    fireEvent.click(screen.getByTestId('source-test-call-name'));
    await screen.findByTestId('source-test-call-named');
    expect(screen.getByTestId('source-test-call-request-summary').textContent).toBe('GET http://127.0.0.1:54729/v1/tickets?page=1');
    expect(screen.getByTestId('source-test-call-request').textContent).toContain('Headers: accept, Authorization (names only; the secret’s value is never shown)');
    expect(calls).toEqual([{ path: '/sources/tickets-api/test-call', body: { target: 'list_tickets', args: { page: 1 } } }]);

    fireEvent.click(screen.getByTestId('source-test-call-send'));
    await screen.findByTestId('source-test-call-result');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ path: '/sources/tickets-api/test-call', body: { target: 'list_tickets', args: { page: 1 }, confirm: HASH } });
    // One named request, one send: sending again means naming it again.
    expect(screen.queryByTestId('source-test-call-send')).toBeNull();
  });

  it('an edit after naming drops the named request (nothing stale can be sent)', async () => {
    render(<TestCall source="g" kind="graphql" reads={[]} />);
    fireEvent.change(screen.getByTestId('source-test-call-query'), { target: { value: 'query { tickets { id } }' } });
    fireEvent.click(screen.getByTestId('source-test-call-name'));
    await screen.findByTestId('source-test-call-named');
    fireEvent.change(screen.getByTestId('source-test-call-query'), { target: { value: 'query { tickets { id owner } }' } });
    expect(screen.queryByTestId('source-test-call-named')).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('a request that changed at crew since it was named is named again, never sent', async () => {
    sendImpl = () => Promise.reject(new ApiError(409, 'the request is not the one confirmed: name it again, then confirm', { error: 'x', code: 'request_changed' }));
    render(<TestCall source="tickets-api" kind="rest" reads={['list_tickets']} />);
    fireEvent.click(screen.getByTestId('source-test-call-name'));
    await screen.findByTestId('source-test-call-named');
    fireEvent.click(screen.getByTestId('source-test-call-send'));
    await waitFor(() => expect(screen.getByTestId('source-test-call-error').textContent).toMatch(/changed since it was named/));
    expect(screen.queryByTestId('source-test-call-named')).toBeNull();
    expect(screen.queryByTestId('source-test-call-result')).toBeNull();
  });
});
