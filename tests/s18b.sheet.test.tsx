import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeUnit, makeView } from './factories.js';

/**
 * S18b — port 1f (the sheets: the narrated Activity, the session's observed spend, the retry
 * lineage) and port 1g (the rail brand logo).
 */

// The run sections need a run model; the lineage is what this suite pins, so the section body is a probe.
vi.mock('../src/hooks/useRunModel.js', () => ({ useRunModel: () => ({ session: { id: 'r1' } }) }));
vi.mock('../src/components/WhatWhere.js', () => ({
  WhatWhere: ({ retriedAs }: { retriedAs?: readonly string[] }) => <p data-testid="probe-retried-as">{(retriedAs ?? []).join(',')}</p>,
}));
vi.mock('../src/hooks/useBoardModel.js', async (orig) => {
  const real = await orig<typeof import('../src/hooks/useBoardModel.js')>();
  return { ...real, useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null, failedAt: null }) };
});
vi.mock('../src/components/StandingOrdersPanel.js', () => ({ StandingOrdersPanel: () => <div data-testid="standing-orders" /> }));
vi.mock('../src/components/DeliveryFreezeSwitch.js', () => ({ DeliveryFreezeSwitch: () => <div data-testid="delivery-freeze" /> }));

const { ObjectSheet } = await import('../src/components/sheets/ObjectSheet.js');
const { SessionRail } = await import('../src/components/desk/SessionRail.js');
const { openSheet, useSheets } = await import('../src/store/sheets.js');
const { useRuntimeStore } = await import('../src/store/runtime.js');
const { DEFAULT_APPEARANCE, useAppearanceStore } = await import('../src/theming/appearance.js');

const NOW = Date.now();
const RUN = makeView({ id: 'r1', status: 'failed', problem: 'fix the double charge', unit_ix: 0 }, [
  makeUnit({ id: 'r1:u0', session_id: 'r1', ord: 0, status: 'done', assigned_cli: 'claude', description: 'build — fix it' }),
]);
const RETRY = makeView({ id: 'r2', status: 'executing', problem: 'fix the double charge', retry_of: 'r1' } as never);

let events: unknown[] = [];
beforeEach(() => {
  events = [];
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  useRuntimeStore.setState({ logs: {} });
  useAppearanceStore.setState({ appearance: DEFAULT_APPEARANCE, loaded: true });
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    const body = path.endsWith('/events') ? { events }
      : path === '/diagnostics' ? { components: { crew: '0.8.6' }, daemon: { uptimeMs: 60_000 }, recentErrors: [], stores: [] }
      : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the session sheet’s Activity tab narrates (port 1f)', () => {
  it('one sentence per frame, newest first, with its tone and age — never the raw type', async () => {
    events = [
      { type: 'sessionStarted', session: 'r1', ts: NOW - 120_000, seq: 1 },
      { type: 'someUnspokenFrame', session: 'r1', ts: NOW - 100_000, seq: 2 },
      { type: 'stepFailed', session: 'r1', ord: 0, detail: 'tests failed', ts: NOW - 60_000, seq: 3 },
    ];
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r1' }, 'activity'));
    const lines = await screen.findAllByTestId('sheet-activity-line');
    expect(lines.map((l) => l.getAttribute('data-tone'))).toEqual(['fail', 'work']);
    expect(lines[0]!.textContent).toContain('Step failed on');
    expect(lines[0]!.textContent).toContain('1m');
    expect(lines[1]!.textContent).toContain('Run started');
    expect(screen.getByTestId('sheet-activity').textContent).not.toContain('someUnspokenFrame');
  });
});

describe('the Desk sheet’s "Studio itself" tab — the observed spend (port 1f)', () => {
  it('is absent until a cliUsage frame reported a cost', async () => {
    render(<ObjectSheet runs={[RUN]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'desk' }, 'studio'));
    await screen.findByTestId('sheet-studio');
    expect(screen.queryByTestId('sheet-studio-spend')).toBeNull();
    act(() => useRuntimeStore.setState({ logs: { r1: [{ seq: 1, type: 'cliUsage', costUsd: 0.42 }, { seq: 2, type: 'cliUsage', costUsd: 1.08 }] as never } }));
    expect(screen.getByTestId('sheet-studio-spend').textContent).toBe('$1.50 observed this session');
    expect(screen.getByTestId('sheet-studio-spend')).toHaveAttribute('data-frames', '2');
  });
});

describe('a run section on the sheet carries the retry lineage (port 1f)', () => {
  it('retriedAs is derived from the runs, as the run page does', async () => {
    render(<ObjectSheet runs={[RUN, RETRY]} navigate={() => {}} needCount={0} />);
    act(() => openSheet({ kind: 'session', sessionId: 'run:r1' }, 'whatwhere'));
    await waitFor(() => expect(screen.getByTestId('probe-retried-as').textContent).toBe('r2'));
  });
});

describe('the rail brand logo (port 1g)', () => {
  it('no logo: the dot', () => {
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const brand = screen.getByTestId('desk-rail-brand');
    expect(screen.queryByTestId('desk-rail-logo')).toBeNull();
    expect(brand.querySelector('.wk-desk-dot')).not.toBeNull();
  });

  it('a logo: a 32 px contain-fit image in the dot’s place', () => {
    useAppearanceStore.setState({ appearance: { ...DEFAULT_APPEARANCE, logo_url: 'data:image/png;base64,AAAA' }, loaded: true });
    render(<SessionRail runs={[]} needRows={[]} navigate={() => {}} pathname="/" />);
    const logo = screen.getByTestId('desk-rail-logo');
    expect(logo.style.width).toBe('32px');
    expect(logo.style.height).toBe('32px');
    expect(logo.style.backgroundSize).toBe('contain');
    expect(logo.style.backgroundImage).toContain('data:image/png;base64,AAAA');
    expect(screen.getByTestId('desk-rail-brand').querySelector('.wk-desk-dot')).toBeNull();
  });
});
