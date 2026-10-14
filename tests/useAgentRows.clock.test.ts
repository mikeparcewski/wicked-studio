import { describe, expect, it } from 'vitest';
import { nextBenchEnd } from '../src/components/agents/useAgentRows.js';

describe('the Agents rows re-read the clock when a bench ends (codex #759 r1)', () => {
  const now = Date.parse('2026-10-13T08:00:00Z');
  const at = (min: number): string => new Date(now + min * 60_000).toISOString();

  it('returns the soonest bench end still ahead', () => {
    expect(nextBenchEnd([
      { recent_bench: { lifts_at: at(30) } },
      { recent_bench: { lifts_at: at(5) } },
      { recent_bench: { lifts_at: at(-5) } },
      { recent_bench: null },
      {},
    ], now)).toBe(now + 5 * 60_000);
  });

  it('is null with no roster, no bench, or only past or unreadable ends', () => {
    expect(nextBenchEnd(null, now)).toBeNull();
    expect(nextBenchEnd([{}, { recent_bench: { lifts_at: at(-1) } }, { recent_bench: { lifts_at: 'soon' } }], now)).toBeNull();
  });
});
