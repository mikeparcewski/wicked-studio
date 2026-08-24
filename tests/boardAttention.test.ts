import { describe, it, expect } from 'vitest';
import {
  bandFor,
  bandOf,
  compareScored,
  scoreOf,
  topSignal,
  TRIAGE_THRESHOLD,
  type Signal,
} from '../src/board/boardAttention.js';

/**
 * Pins the decay curve (DES-UXFIX-001 §2.1.3, slice-1 AC) at the exact ages the
 * design names — 30 s, 12 min, 8 d — from a frozen `now`, so the F3 fix is
 * proven in arithmetic before anything renders it.
 */

const NOW = 1_700_000_000_000;
const S = 1_000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const at = (age: number): number => NOW - age;
const sig = (kind: Signal['kind'], age: number): Signal => ({ kind, at: at(age) });

describe('scoreOf — the decay curve at the AC ages', () => {
  it('a gate at 30s scores exactly 100 — no decay', () => {
    expect(scoreOf(sig('gate', 30 * S), NOW)).toBe(100);
  });

  it('a gate at 8d STILL scores exactly 100 — the ∞ half-life, asserted not assumed', () => {
    expect(scoreOf(sig('gate', 8 * DAY), NOW)).toBe(100);
  });

  it('a failure at 12min scores ≈67.62 — fresh, still above the threshold', () => {
    const score = scoreOf(sig('failing', 12 * MIN), NOW);
    expect(score).toBeCloseTo(70 * Math.pow(0.5, 12 / 240), 6);
    expect(Math.abs(score - 67.62)).toBeLessThan(0.01);
    expect(score).toBeGreaterThanOrEqual(TRIAGE_THRESHOLD);
  });

  it('a failure at 8d has decayed to ~0 — the F3 proof, in arithmetic', () => {
    // 8 d = 48 half-lives of 4 h: effectively zero, far below any live run.
    expect(scoreOf(sig('failing', 8 * DAY), NOW)).toBeLessThan(1e-6);
  });

  it('running scores 40 now and 20 after one 30-min half-life', () => {
    expect(scoreOf(sig('running', 0), NOW)).toBe(40);
    expect(scoreOf(sig('running', 30 * MIN), NOW)).toBeCloseTo(20, 9);
  });

  it('drafts at 2d score ≈12.31 and band as quiet — a draft never demands (D2)', () => {
    const score = scoreOf(sig('drafts', 2 * DAY), NOW);
    expect(Math.abs(score - 12.31)).toBeLessThan(0.01);
    expect(bandOf(score)).toBe('quiet');
  });

  it('clamps a negative Δ (clock skew) to 0 — never above the base', () => {
    expect(scoreOf({ kind: 'running', at: NOW + 5 * MIN }, NOW)).toBe(40);
    expect(scoreOf({ kind: 'failing', at: NOW + 5 * MIN }, NOW)).toBe(70);
  });
});

describe('topSignal', () => {
  it('picks the max over a mixed set and returns its signal', () => {
    const gate = sig('gate', 8 * DAY);
    const { score, signal } = topSignal(
      [sig('failing', 12 * MIN), gate, sig('running', 0), sig('drafts', 0)],
      NOW,
    );
    expect(score).toBe(100);
    expect(signal).toBe(gate);
  });

  it('an empty set scores 0 with a null signal', () => {
    expect(topSignal([], NOW)).toEqual({ score: 0, signal: null });
  });
});

describe('bandOf', () => {
  it('exactly the threshold is still needs-you', () => {
    expect(bandOf(TRIAGE_THRESHOLD)).toBe('needs-you');
    expect(bandOf(TRIAGE_THRESHOLD - 0.001)).toBe('quiet');
  });
});

describe('bandFor — the C6 status-first band verdict', () => {
  it('a project with ANY non-terminal run is NEVER quiet — however stale every clock is', () => {
    // The live-observed C6 bug: an executing run whose only clock was 15h old
    // scored ~0 and the project read "quiet" while the footer said "working".
    const stale: Signal[] = [{ kind: 'running', at: at(15 * HOUR), runId: 'r1' }];
    expect(bandFor(stale, true, NOW)).toBe('working');
    // Even with NO running signal at all (a fresh reload before any frame),
    // the DTO status alone holds the band.
    expect(bandFor([], true, NOW)).toBe('working');
  });

  it('a gate puts the project in NEEDS YOU — above working, regardless of age', () => {
    const s: Signal[] = [
      { kind: 'gate', at: at(8 * DAY), runId: 'rg' },
      { kind: 'running', at: at(0), runId: 'rr' },
    ];
    expect(bandFor(s, true, NOW)).toBe('needs-you');
  });

  it('a fresh failure is NEEDS YOU; an 8-day-old one is not (F3 decay preserved)', () => {
    expect(bandFor([sig('failing', 12 * MIN)], false, NOW)).toBe('needs-you');
    expect(bandFor([sig('failing', 8 * DAY)], false, NOW)).toBe('quiet');
    // …and a stale failure beside a live run leaves the project WORKING.
    expect(bandFor([sig('failing', 8 * DAY)], true, NOW)).toBe('working');
  });

  it('fresh doc activity (a running signal without an active run) is WORKING, not NEEDS YOU', () => {
    expect(bandFor([sig('running', 0)], false, NOW)).toBe('working');
    expect(bandFor([sig('running', 31 * MIN)], false, NOW)).toBe('quiet');
  });

  it('drafts never leave QUIET (D2), and no signals at all is QUIET', () => {
    expect(bandFor([sig('drafts', 0)], false, NOW)).toBe('quiet');
    expect(bandFor([], false, NOW)).toBe('quiet');
  });
});

describe('compareScored', () => {
  const item = (score: number, at: number, name: string): { score: number; at: number; name: string } =>
    ({ score, at, name });

  it('orders by score descending', () => {
    const sorted = [item(0, 9, 'quiet'), item(100, 1, 'gated'), item(40, 5, 'busy')].sort(compareScored);
    expect(sorted.map((i) => i.name)).toEqual(['gated', 'busy', 'quiet']);
  });

  it('breaks ties newest-signal-first, then name — never on list position', () => {
    const sorted = [item(0, 10, 'zulu'), item(0, 20, 'alpha'), item(0, 20, 'bravo')].sort(compareScored);
    expect(sorted.map((i) => i.name)).toEqual(['alpha', 'bravo', 'zulu']);
  });
});
