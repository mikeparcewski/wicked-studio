import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError, drainRefusal, DRAIN_WAY_ON } from '../src/api/errors.js';
import type { MaintenanceState } from '../src/api/maintenance-wire.js';

/**
 * studio#1253 (crew#1475): Settings > General > Maintenance. crew's `GET`/`POST /api/v1/maintenance` answer
 * `adapter.maintenanceState()` = `{draining, since, idle, active: [{runId, status}]}` (crew `api/routes.ts`); a drain
 * refusal is 503 `{code: 'maintenance_drain', error, hint}` (`maintenanceDrainBody`, from `MaintenanceDrainError`).
 */
const ADMITTING: MaintenanceState = { draining: false, since: null, idle: false, active: [{ runId: 'run-1', status: 'executing' }] };
let state: MaintenanceState;
const getMaintenance = vi.fn(() => Promise.resolve(state));
const setMaintenance = vi.fn((drain: boolean) => { state = { ...state, draining: drain, since: drain ? Date.now() : null }; return Promise.resolve(state); });

vi.mock('../src/api/client.js', () => ({
  api: {
    getMaintenance: () => getMaintenance(),
    setMaintenance: (drain: boolean) => setMaintenance(drain),
  },
}));
const { MaintenanceSettings, DRAIN_POLL_MS } = await import('../src/components/MaintenanceSettings.js');

beforeEach(() => { state = { ...ADMITTING, active: [...ADMITTING.active] }; getMaintenance.mockClear(); setMaintenance.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the drain toggle', () => {
  it('reads crew\'s state: off, one job working and listed (it opens)', async () => {
    const navigate = vi.fn();
    render(<MaintenanceSettings navigate={navigate} />);
    const sw = await screen.findByTestId('maintenance-drain-toggle');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByTestId('maintenance-busy').textContent).toBe('1 job is working.');
    fireEvent.click(screen.getByTestId('maintenance-active-run'));
    expect(navigate).toHaveBeenCalledWith('/s/run-1');
  });

  it('turning it on POSTs {drain: true}; it then says draining, and to wait for the job', async () => {
    render(<MaintenanceSettings navigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('maintenance-drain-toggle'));
    await waitFor(() => expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'true'));
    expect(setMaintenance).toHaveBeenCalledWith(true);
    expect(screen.getByTestId('maintenance-since').textContent).toMatch(/^Draining since /);
    expect(screen.getByTestId('maintenance-busy').textContent).toMatch(/Wait for it to finish before you update or restart/);
  });

  it('while draining it reads again until idle, then says it is safe, and stops reading', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state = { draining: true, since: Date.now(), idle: false, active: [{ runId: 'run-1', status: 'executing' }] };
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-busy');
    state = { ...state, idle: true, active: [] };
    await act(async () => { await vi.advanceTimersByTimeAsync(DRAIN_POLL_MS); });
    expect((await screen.findByTestId('maintenance-idle')).textContent).toBe('Idle: no job is working now. It’s safe to update or restart.');
    const reads = getMaintenance.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DRAIN_POLL_MS * 3); });
    expect(getMaintenance.mock.calls.length).toBe(reads);
  });

  it('a crew without the route (404 Not Found) says it can\'t drain', async () => {
    getMaintenance.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'not found', { error: 'not found' })));
    render(<MaintenanceSettings navigate={vi.fn()} />);
    expect((await screen.findByTestId('maintenance-unsupported')).textContent).toMatch(/can’t drain for maintenance/);
  });
});

describe('review r1: reads and writes never undo each other', () => {
  it('a read out before a toggle lands after it: the toggle\'s answer stands', async () => {
    let lateRead: (v: unknown) => void = () => undefined;
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-drain-toggle');
    getMaintenance.mockImplementationOnce(() => new Promise((r) => { lateRead = r as (v: unknown) => void; }));
    fireEvent.click(screen.getByTestId('maintenance-reread'));
    const before = { ...state };
    fireEvent.click(screen.getByTestId('maintenance-drain-toggle'));
    await waitFor(() => expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'true'));
    await act(async () => { lateRead(before); });
    expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  it('a read asked while a toggle is on its way never drops the toggle\'s answer', async () => {
    let post: (v: unknown) => void = () => undefined;
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-drain-toggle');
    setMaintenance.mockImplementationOnce((drain: boolean) => new Promise((r) => { post = () => r({ ...state, draining: drain, since: Date.now() }); }));
    fireEvent.click(screen.getByTestId('maintenance-drain-toggle'));
    // Check again is held while the toggle is out; crew's GET would still say "not draining".
    fireEvent.click(screen.getByTestId('maintenance-reread'));
    await act(async () => { post(undefined); });
    await waitFor(() => expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'true'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'true');
  });

  it('a toggle whose answer is lost makes no "safe" claim, says it isn\'t known, and reads crew again', async () => {
    state = { draining: true, since: Date.now(), idle: true, active: [] };
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-idle');
    setMaintenance.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    getMaintenance.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    const reads = getMaintenance.mock.calls.length;
    fireEvent.click(screen.getByTestId('maintenance-drain-toggle'));
    await screen.findByTestId('maintenance-unsure');
    expect(screen.queryByTestId('maintenance-idle')).toBeNull();
    expect(getMaintenance.mock.calls.length).toBe(reads + 1);
    // Once crew answers, its state is shown again.
    state = { draining: false, since: null, idle: true, active: [] };
    fireEvent.click(screen.getByTestId('maintenance-reread'));
    await waitFor(() => expect(screen.queryByTestId('maintenance-unsure')).toBeNull());
    expect(screen.getByTestId('maintenance-drain-toggle')).toHaveAttribute('aria-checked', 'false');
    // Reconciled: the "couldn't confirm" line goes too (review r2).
    expect(screen.queryByTestId('maintenance-write-error')).toBeNull();
  });

  it('review r2: while turning drain off is on its way, no "safe to update" claim', async () => {
    state = { draining: true, since: Date.now(), idle: true, active: [] };
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-idle');
    setMaintenance.mockImplementationOnce(() => new Promise(() => undefined));
    fireEvent.click(screen.getByTestId('maintenance-drain-toggle'));
    await waitFor(() => expect(screen.queryByTestId('maintenance-idle')).toBeNull());
    expect(screen.getByTestId('maintenance-status').textContent).not.toMatch(/safe to update/);
  });

  it('a read slower than the poll: one read at a time, and its answer lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state = { draining: true, since: Date.now(), idle: false, active: [{ runId: 'run-1', status: 'executing' }] };
    render(<MaintenanceSettings navigate={vi.fn()} />);
    await screen.findByTestId('maintenance-busy');
    let slow: (v: unknown) => void = () => undefined;
    getMaintenance.mockImplementation(() => new Promise((r) => { slow = r as (v: unknown) => void; }));
    const reads = getMaintenance.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(DRAIN_POLL_MS * 3); });
    expect(getMaintenance.mock.calls.length).toBe(reads + 1);
    await act(async () => { slow({ ...state, idle: true, active: [] }); });
    expect(await screen.findByTestId('maintenance-idle')).toBeTruthy();
    getMaintenance.mockImplementation(() => Promise.resolve(state));
  });
});

describe('a 503 maintenance_drain reads as crew\'s sentence and the way on', () => {
  const body = { code: 'maintenance_drain', error: 'This daemon is draining for maintenance and is refusing new work.', hint: 'Wait for maintenance to finish, or POST /api/v1/maintenance with {"drain":false} to admit work again.' };
  it('the message every surface shows names drain and Settings, never "the daemon refused this"', () => {
    const e = new ApiError(503, body.error, body);
    expect(e.message).toBe(`This daemon is draining for maintenance and is refusing new work. ${DRAIN_WAY_ON}`);
    expect(e.message).not.toMatch(/refused this/);
    expect(drainRefusal(e)).toBe(e.message);
  });
  it('another 503 is not a drain', () => {
    expect(drainRefusal(new ApiError(503, 'registry corrupt', { code: 'registry_corrupt', error: 'x' }))).toBeNull();
    expect(drainRefusal(new Error('x'))).toBeNull();
  });
});
