import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewWorkSeatsStore } from '../src/store/newWorkSeats.js';

const getSettings = vi.fn();
const updateSettings = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: {
  getSettings: () => getSettings(),
  updateSettings: (patch: unknown) => updateSettings(patch),
} }));

beforeEach(() => {
  useNewWorkSeatsStore.setState({ seats: null, state: 'idle', loaded: false, saving: false, error: null });
  getSettings.mockReset().mockResolvedValue({ settings: {} });
  updateSettings.mockReset().mockImplementation(async (patch: { newWorkSeats: string[] }) => ({ settings: patch }));
});

describe('crew’s new-work seat pool', () => {
  it.each([{ seats: undefined }, { seats: null }, { seats: [] }, { seats: ['pi', 'away-seat'] }])('preserves the meaning of a settings pool: $seats', async ({ seats }) => {
    getSettings.mockResolvedValue({ settings: { newWorkSeats: seats } });
    await useNewWorkSeatsStore.getState().load();
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: seats ?? null, state: 'ok', loaded: true });
  });

  it('shares an outstanding read across readers', async () => {
    let answer!: (value: unknown) => void;
    getSettings.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const first = useNewWorkSeatsStore.getState().load();
    const second = useNewWorkSeatsStore.getState().load();
    await vi.waitFor(() => expect(getSettings).toHaveBeenCalledTimes(1));
    answer({ settings: { newWorkSeats: ['pi'] } });
    await Promise.all([first, second]);
    expect(useNewWorkSeatsStore.getState().seats).toEqual(['pi']);
  });

  it('a failed initial read stays unknown and can be retried', async () => {
    getSettings.mockRejectedValueOnce(new Error('offline'));
    await useNewWorkSeatsStore.getState().load();
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: null, loaded: false, state: 'failed', error: expect.any(String) });
    expect(updateSettings).not.toHaveBeenCalled();
    await useNewWorkSeatsStore.getState().load();
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: null, loaded: true, state: 'ok', error: null });
  });

  it('can save a fully specified pool without a prior read', async () => {
    await useNewWorkSeatsStore.getState().set(['pi']);
    expect(updateSettings).toHaveBeenCalledWith({ newWorkSeats: ['pi'] });
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: ['pi'], state: 'ok', loaded: true });
  });

  it('restores the null default rule after a failed save, then saves an explicit empty pool on retry', async () => {
    await useNewWorkSeatsStore.getState().load();
    updateSettings.mockRejectedValueOnce(new Error('forbidden'));
    await useNewWorkSeatsStore.getState().set(['pi']);
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: null, state: 'failed', saving: false });
    await useNewWorkSeatsStore.getState().set([]);
    expect(updateSettings).toHaveBeenLastCalledWith({ newWorkSeats: [] });
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: [], state: 'ok', error: null });
  });

  it.each([undefined, null, [], ['codex']].map((answer) => ({ answer })))('rolls back when the daemon does not accept the sent pool: $answer', async ({ answer }) => {
    await useNewWorkSeatsStore.getState().load();
    updateSettings.mockResolvedValue({ settings: answer === undefined ? {} : { newWorkSeats: answer } });
    await useNewWorkSeatsStore.getState().set(['pi']);
    expect(useNewWorkSeatsStore.getState()).toMatchObject({
      seats: null, loaded: true, state: 'failed', saving: false,
      error: expect.stringMatching(/this daemon did not accept.*may need an upgrade/i),
    });
  });

  it('accepts an echoed pool with the same members in a different order', async () => {
    updateSettings.mockResolvedValue({ settings: { newWorkSeats: ['codex', 'pi'] } });
    await useNewWorkSeatsStore.getState().set(['pi', 'codex']);
    expect(useNewWorkSeatsStore.getState()).toMatchObject({ seats: ['pi', 'codex'], loaded: true, state: 'ok', error: null });
  });

  it('an earlier refresh cannot overwrite a subsequent save', async () => {
    await useNewWorkSeatsStore.getState().load();
    let answer!: (value: unknown) => void;
    getSettings.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const refresh = useNewWorkSeatsStore.getState().load();
    await vi.waitFor(() => expect(getSettings).toHaveBeenCalledTimes(2));
    await useNewWorkSeatsStore.getState().set(['pi']);
    answer({ settings: { newWorkSeats: ['old-seat'] } });
    await refresh;
    expect(useNewWorkSeatsStore.getState().seats).toEqual(['pi']);
  });
});
