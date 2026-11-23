import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * studio#1332: crew answers `GET /health` without waiting on a busy engine (crew#1767), so a page opened while the
 * engine boots reads `ping: "busy"` and `chatWorkflows: []`. The store reads `/health` once more after a short wait, so
 * Understand's Ask gets `analyze` without a reload. An `ok` ping is read once.
 */
const getHealth = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_t, k) => (k === 'getHealth' ? getHealth : () => Promise.resolve({})) }),
}));

const { useCapabilities, BUSY_REREAD_MS } = await import('../src/store/capabilities.js');

// crew's HealthResponse (api-types `HealthResponse`: status, version, ping, capabilities).
const health = (ping: string, chatWorkflows: string[]) => ({ status: 'ok', version: '0.18.30', ping, capabilities: { runChatId: true, chatWorkflows } });

beforeEach(() => {
  vi.useFakeTimers();
  useCapabilities.setState({ loaded: false, chatWorkflows: [], runChatId: false });
  getHealth.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('capabilities after a busy ping', () => {
  it('reads /health once more, and keeps what the second answer says', async () => {
    getHealth.mockResolvedValueOnce(health('busy', [])).mockResolvedValueOnce(health('ok', ['analyze']));
    await useCapabilities.getState().load();
    expect(useCapabilities.getState()).toMatchObject({ loaded: true, runChatId: true, chatWorkflows: [] });
    expect(getHealth).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS);
    expect(getHealth).toHaveBeenCalledTimes(2);
    expect(useCapabilities.getState().chatWorkflows).toEqual(['analyze']);

    // Once only: a second busy answer is not chased.
    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS * 3);
    expect(getHealth).toHaveBeenCalledTimes(2);
  });

  it('busy twice: still only one re-read', async () => {
    getHealth.mockResolvedValue(health('busy', []));
    await useCapabilities.getState().load();
    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS * 5);
    expect(getHealth).toHaveBeenCalledTimes(2);
  });

  it('the re-read takes only chatWorkflows: a capability set since (a launch\u2019s fresh read) is kept', async () => {
    getHealth.mockResolvedValueOnce(health('busy', [])).mockResolvedValueOnce({ ...health('ok', ['analyze']), capabilities: { runChatId: false, powerMode: false, chatWorkflows: ['analyze'] } });
    await useCapabilities.getState().load();
    useCapabilities.setState({ powerMode: true });
    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS);
    expect(useCapabilities.getState()).toMatchObject({ powerMode: true, runChatId: true, chatWorkflows: ['analyze'] });
  });

  it('an ok ping is read once', async () => {
    getHealth.mockResolvedValue(health('ok', ['analyze']));
    await useCapabilities.getState().load();
    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS * 2);
    expect(getHealth).toHaveBeenCalledTimes(1);
    expect(useCapabilities.getState().chatWorkflows).toEqual(['analyze']);
  });

  it('a failed second read keeps the first answer', async () => {
    getHealth.mockResolvedValueOnce(health('busy', [])).mockRejectedValueOnce(new Error('daemon gone'));
    await useCapabilities.getState().load();
    await vi.advanceTimersByTimeAsync(BUSY_REREAD_MS);
    expect(useCapabilities.getState()).toMatchObject({ loaded: true, runChatId: true, chatWorkflows: [] });
  });
});
