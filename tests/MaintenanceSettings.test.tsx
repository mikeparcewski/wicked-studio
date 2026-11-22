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
