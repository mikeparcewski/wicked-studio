import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeskStateRows, useDeskStates } from '../src/components/desk/DeskStateRows.js';
import { DeliveryFreezeSwitch } from '../src/components/DeliveryFreezeSwitch.js';
import { useDeliveryFreezeStore } from '../src/store/deliveryFreeze.js';

/**
 * COVERAGE.md finding 2 (wave 5): the delivery freeze and standing orders have a desk home — said on
 * the Desk while ON, switched under "Everything else" — so neither is lost when desk is the default.
 */

let orders = { away: false, awaySince: null as number | null, orders: [] as unknown[], outbox: [] as unknown[] };
const puts: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  puts.length = 0;
  orders = { away: false, awaySince: null, orders: [], outbox: [] };
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'PUT' || init?.method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      puts.push({ path, body });
      if (path.startsWith('/standing-orders')) orders = { ...orders, away: body['away'] === true };
    }
    const answer = path.startsWith('/standing-orders') ? orders : {};
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
  useDeliveryFreezeStore.setState({ status: 'ready', state: { frozen: false, since: null, by: null, reason: null }, busy: false, error: null });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Harness(): React.ReactElement {
  const s = useDeskStates();
  return <div><span data-testid="h" data-frozen={String(s.frozen)} data-away={String(s.away)} /><DeskStateRows frozen={s.frozen} away={s.away} /></div>;
}

describe('calm by default', () => {
  it('says nothing while thawed and present', async () => {
    render(<Harness />);
    await waitFor(() => expect(screen.getByTestId('h').getAttribute('data-away')).toBe('false'));
    expect(screen.queryByTestId('desk-state')).toBeNull();
  });
});

describe('frozen', () => {
  it('the Desk says who froze it and why, and unfreezes in place with its consequence', async () => {
    useDeliveryFreezeStore.setState({ state: { frozen: true, since: '2026-10-03T04:00:00Z', by: 'person:local', reason: 'incident 42' } });
    render(<Harness />);
    const row = await screen.findByTestId('desk-state');
    expect(row.getAttribute('data-state')).toBe('frozen');
    expect(screen.getByTestId('desk-state-line').textContent).toMatch(/Deliveries frozen by person:local since .* · incident 42\. Nothing is pushed/);
    expect(screen.queryByTestId('delivery-freeze-banner')).toBeNull(); // the row says it once
    fireEvent.click(screen.getByTestId('delivery-freeze-open'));
    const confirm = screen.getByTestId('delivery-freeze-confirm');
    expect(confirm.className).not.toMatch(/\bfixed\b/); // in place, not floating over the bar
    expect(confirm.getAttribute('data-action')).toBe('unfreeze');
    expect(puts).toStrictEqual([]); // the click only opened the consequence
  });

  it('the status bar keeps its floating confirm', () => {
    render(<DeliveryFreezeSwitch />);
    fireEvent.click(screen.getByTestId('delivery-freeze-open'));
    expect(screen.getByTestId('delivery-freeze-confirm').className).toMatch(/\bfixed\b/);
  });
});

describe('away', () => {
  it('the Desk says you are away and "I’m back" turns it off', async () => {
    orders = { ...orders, away: true };
    render(<Harness />);
    const row = await screen.findByTestId('desk-state');
    expect(row.getAttribute('data-state')).toBe('away');
    expect(screen.getByTestId('desk-state-line').textContent).toBe('No standing orders: every question waits for you.');
    await act(async () => { fireEvent.click(screen.getByTestId('desk-state-back')); });
    expect(puts.some((p) => p.path.startsWith('/standing-orders') && (p.body as { away?: unknown }).away === false)).toBe(true);
    await waitFor(() => expect(screen.queryByTestId('desk-state')).toBeNull());
  });
});
