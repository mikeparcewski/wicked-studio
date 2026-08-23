import { describe, it, expect } from 'vitest';
import type { AgentSession, CoreEvent } from '../src/api/types.js';
import type { LoggedEvent } from '../src/store/runtime.js';
import {
  deriveRunClocks,
  durationWord,
  runShortId,
  runTitle,
  runWhenWord,
} from '../src/components/runIdentity.js';

/**
 * DES-UX-001 §7.5 (slice Y2, EC40): the synthesized-title + event-log-clock
 * derivations, pure and spelled once. The DOM rigs assert the rendered rows;
 * these pin the math the rows share.
 */

function session(id: string, problem: string, attempt = 0): AgentSession {
  return { id, problem, attempt } as unknown as AgentSession;
}

describe('runTitle (EC40: identical prompts never render identical titles)', () => {
  it('composes truncated intent · short-id · #ordinal (attempt is 0-based)', () => {
    expect(runTitle(session('3eda2129abcd', 'fix the auth flow', 1)))
      .toBe('fix the auth flow · 3eda21 · #2');
  });

  it('truncates a paragraph intent, keeping the short-id visible past it', () => {
    const long = 'refactor the ingestion pipeline so that every incoming webhook payload is validated';
    const t = runTitle(session('r-long-000', long));
    expect(t).toBe(`${long.slice(0, 40)}… · r-long · #1`);
  });

  it('two identical prompts differ by short-id alone', () => {
    const a = runTitle(session('r-auth-1234', 'refactor the auth middleware'));
    const b = runTitle(session('r-retry-999', 'refactor the auth middleware'));
    expect(a).not.toBe(b);
    expect(runShortId('r-auth-1234')).toBe('r-auth');
  });
});

describe('runWhenWord (the attach clock, honestly absent)', () => {
  const now = 1_000_000_000;
  it('renders the age word off the membership attach clock', () => {
    expect(runWhenWord(now - 13 * 60_000, now)).toBe('13m ago');
  });
  it('an unmirrored run says so — never a fabricated 0s', () => {
    expect(runWhenWord(undefined, now)).toBe('time unknown');
  });
});

describe('deriveRunClocks (§7.5: durable log wins; live arrival is "observed")', () => {
  const durable: CoreEvent[] = [
    { type: 'sessionStarted', session: 'r', ts: 1000 },
    { type: 'unitDone', session: 'r', ts: 2000 },
    { type: 'sessionFailed', session: 'r', ts: 61_000 },
  ];
  const live: LoggedEvent[] = [
    { seq: 1, type: 'sessionStarted', ts: 5000, detail: '' },
    { seq: 2, type: 'sessionCompleted', ts: 9000, detail: '' },
  ];

  it('reads start/end from durable ts, never arrival-stamped', () => {
    const c = deriveRunClocks(durable, live);
    expect(c.started).toEqual({ ms: 1000, observed: false });
    expect(c.ended).toEqual({ ms: 61_000, observed: false });
  });

  it('falls back to the arrival-stamped live log, labeled observed', () => {
    const c = deriveRunClocks([], live);
    expect(c.started).toEqual({ ms: 5000, observed: true });
    expect(c.ended).toEqual({ ms: 9000, observed: true });
  });

  it('an empty log yields null halves — the caller states the absence', () => {
    expect(deriveRunClocks([], [])).toEqual({ started: null, ended: null });
  });

  it('a live /ws frame without ts never becomes a clock', () => {
    const c = deriveRunClocks([{ type: 'sessionStarted', session: 'r' }], []);
    expect(c.started).toBeNull();
  });
});

describe('durationWord', () => {
  it('spells seconds, minutes+seconds, hours+minutes', () => {
    expect(durationWord(59_000)).toBe('59s');
    expect(durationWord(60_000)).toBe('1m 0s');
    expect(durationWord(3_600_000 + 5 * 60_000)).toBe('1h 5m');
  });
});
