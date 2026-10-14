// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { engineFailureOf } from '../src/board/engineFailure.js';

/** Run clarity: a failed run no step was refused for says the engine's own reason, in one plain line. */
const ev = (o: Record<string, unknown>): CoreEvent => ({ session: 'r', ...o }) as unknown as CoreEvent;

describe('engineFailureOf', () => {
  it('words the no-eligible-seat failure (rig run e5999520) and keeps the engine text whole', () => {
    const raw = 'council distribution failed: no eligible seat for r: every configured seat is benched — 5 of 5 seats benched: claude (signed out — launcher)';
    const f = engineFailureOf([ev({ type: 'unitPlanned', ord: 1 }), ev({ type: 'error', message: raw }), ev({ type: 'sessionFailed', ord: 0 })]);
    expect(f).toStrictEqual({ headline: 'No helper could take the work: every helper on this run was signed out or benched. Sign one in to try again.', raw });
  });

  it('a bare "no eligible seat" names no cause it cannot see (codex r2): signed-in seats can be ineligible', () => {
    const raw = 'council distribution failed: no eligible seat for r: no seat distinct from the creator seat';
    expect(engineFailureOf([ev({ type: 'error', message: raw })])).toStrictEqual({ headline: 'No helper was eligible to take the work — Technical details say why.', raw });
  });

  it('reads the newest error message, first line clipped', () => {
    const long = `boom ${'x'.repeat(300)}\nsecond line`;
    const f = engineFailureOf([ev({ type: 'error', message: 'old' }), ev({ type: 'error', message: long })])!;
    expect(f.raw).toBe(long);
    expect(f.headline.startsWith('It stopped with an error: boom ')).toBe(true);
    expect(f.headline.endsWith('…')).toBe(true);
    expect(f.headline).not.toMatch(/second line/);
  });

  it('claims nothing without an error message', () => {
    expect(engineFailureOf([])).toBeNull();
    expect(engineFailureOf([ev({ type: 'sessionFailed' }), ev({ type: 'error', message: '  ' }), ev({ type: 'error' })])).toBeNull();
  });
});

