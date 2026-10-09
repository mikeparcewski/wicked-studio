// studio#606 (3): an answer past its undo window is never dropped with the page — the gate POST is
// sent with `keepalive`, and leaving the page while it is in flight asks first (the undo window
// itself stays unguarded: a decision the operator could not see land must not land).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEEPALIVE_MAX_BYTES, api } from '../src/api/client.js';
import { IDLE_GATE_ACTION, answerInFlight, useGateActionStore } from '../src/board/gateActions.js';

afterEach(() => { useGateActionStore.setState({ byGate: {} }); vi.unstubAllGlobals(); });

describe('studio#606 — the in-flight gate answer', () => {
  it('the gate POST rides keepalive', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'executing' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    await api.confirmGate('r1', { approve: true });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBe(true);
    expect(init.method).toBe('POST');
  });

  it('a note too long for the keepalive budget goes as an ordinary POST', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ status: 'executing' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    await api.confirmGate('r1', { approve: true, amend: 'x'.repeat(KEEPALIVE_MAX_BYTES + 1) });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.keepalive).toBeUndefined();
  });

  it('leaving the page asks only while an answer is in flight — never during the undo window', () => {
    const leave = (): boolean => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; };
    expect(answerInFlight()).toBe(false);
    expect(leave()).toBe(false);
    useGateActionStore.setState({ byGate: { r1: { ...IDLE_GATE_ACTION, queued: true } } });
    expect(leave()).toBe(false);
    useGateActionStore.setState({ byGate: { r1: { ...IDLE_GATE_ACTION, busy: true } } });
    expect(answerInFlight()).toBe(true);
    expect(leave()).toBe(true);
  });
});
