import { describe, expect, it, vi } from 'vitest';
import { BridgeUnavailableError, type LearnedTheme } from '../src/api/interactive.js';
import { LEARN_POLL_DELAYS_MS, pollLearnedTheme } from '../src/theming/learnPoll.js';

/**
 * The bounded readback poll: 404→200 transition, cancellation at every seam,
 * async bridge refusals surfacing, and the hard cap — no loop outlives the
 * learn flow, by construction.
 */

const LEARNED: LearnedTheme = {
  document_id: 'brand-learn',
  learned_at: '2026-08-21T12:00:00.000Z',
  tokens: { name: 'acme', colors: { primary: '#0a2a5e' } },
};

/** An instant sleeper that logs the schedule it was asked for. */
function instantSleep(): { sleep: (ms: number) => Promise<void>; slept: number[] } {
  const slept: number[] = [];
  return { sleep: (ms: number) => { slept.push(ms); return Promise.resolve(); }, slept };
}

describe('pollLearnedTheme', () => {
  it('rides the 404 (null) → 200 transition and returns the learned result', async () => {
    const { sleep, slept } = instantSleep();
    const fetchLearned = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(LEARNED);
    const out = await pollLearnedTheme({
      fetchLearned, signal: new AbortController().signal, sleep,
    });
    expect(out).toEqual({ kind: 'learned', result: LEARNED });
    expect(fetchLearned).toHaveBeenCalledTimes(3);
    // Backoff honored: the two waits are the schedule's first two entries.
    expect(slept).toEqual([LEARN_POLL_DELAYS_MS[0], LEARN_POLL_DELAYS_MS[1]]);
  });

  it('cancel mid-sleep ends the loop with no further fetch', async () => {
    const ctl = new AbortController();
    const fetchLearned = vi.fn().mockResolvedValue(null);
    // A sleeper that aborts DURING the wait, as the real abortableSleep resolves early.
    const sleep = (): Promise<void> => { ctl.abort(); return Promise.resolve(); };
    const out = await pollLearnedTheme({ fetchLearned, signal: ctl.signal, sleep });
    expect(out).toEqual({ kind: 'cancelled' });
    expect(fetchLearned).toHaveBeenCalledTimes(1); // nothing after the abort
  });

  it('an already-aborted signal never fetches at all', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const fetchLearned = vi.fn();
    const out = await pollLearnedTheme({
      fetchLearned, signal: ctl.signal, sleep: () => Promise.resolve(),
    });
    expect(out).toEqual({ kind: 'cancelled' });
    expect(fetchLearned).not.toHaveBeenCalled();
  });

  it("surfaces the bridge's async refusal (status.posted error) with its OWN sentence", async () => {
    const { sleep } = instantSleep();
    const refusal = "Couldn't grab that URL: refusing to fetch 169.254.169.254: "
      + 'loopback, private and link-local addresses are blocked (SSRF guard)';
    let ticks = 0;
    const out = await pollLearnedTheme({
      fetchLearned: vi.fn().mockResolvedValue(null),
      bridgeError: () => (++ticks >= 2 ? refusal : null),
      signal: new AbortController().signal,
      sleep,
    });
    expect(out).toEqual({ kind: 'bridge-error', reason: refusal });
  });

  it('a flaky poll is not a failed learn — a thrown fetch keeps the loop alive', async () => {
    const { sleep } = instantSleep();
    const fetchLearned = vi.fn()
      .mockRejectedValueOnce(new Error('API 500: hiccup'))
      .mockResolvedValueOnce(LEARNED);
    const out = await pollLearnedTheme({
      fetchLearned, signal: new AbortController().signal, sleep,
    });
    expect(out).toEqual({ kind: 'learned', result: LEARNED });
  });

  it('the typed 503 ends the wait immediately — the bridge itself is gone', async () => {
    const out = await pollLearnedTheme({
      fetchLearned: vi.fn().mockRejectedValue(
        new BridgeUnavailableError('npm i -g wicked-interactive')),
      signal: new AbortController().signal,
      sleep: instantSleep().sleep,
    });
    expect(out.kind).toBe('bridge-error');
    if (out.kind === 'bridge-error') expect(out.reason).toMatch(/npm i -g wicked-interactive/);
  });

  it('hard cap: the schedule exhausts into a timeout carrying the attempt count', async () => {
    const { sleep, slept } = instantSleep();
    const fetchLearned = vi.fn().mockResolvedValue(null);
    const delays = [10, 20, 30];
    const out = await pollLearnedTheme({
      fetchLearned, signal: new AbortController().signal, sleep, delays,
    });
    expect(out).toEqual({ kind: 'timeout', attempts: 4, lastFetchError: null });
    expect(fetchLearned).toHaveBeenCalledTimes(4); // delays.length + 1, no more
    expect(slept).toEqual(delays);                 // every wait from the schedule, once
  });

  it('a timeout remembers the last non-fatal fetch error for the report', async () => {
    const out = await pollLearnedTheme({
      fetchLearned: vi.fn().mockRejectedValue(new Error('API 502: proxy blip')),
      signal: new AbortController().signal,
      sleep: instantSleep().sleep,
      delays: [1],
    });
    expect(out).toEqual({ kind: 'timeout', attempts: 2, lastFetchError: 'API 502: proxy blip' });
  });

  it('the default schedule is bounded (~66s) — the constraint, pinned', () => {
    const total = LEARN_POLL_DELAYS_MS.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(70_000);
    expect(LEARN_POLL_DELAYS_MS.every((d) => d >= 1_000 && d <= 5_000)).toBe(true);
  });
});
