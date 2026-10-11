// (operator ruling 2026-10-11) opencode is OPT-IN: off in every send until the operator picks it;
// a pick sticks; other seats keep the "on unless dropped" rule.
import { beforeEach, describe, expect, it } from 'vitest';
import { chosenSeats, defaultOn, isOptInKey, OPT_IN_NOTE, resetComposerSeats, seatOff, useComposerSeats } from '../src/store/composerSeats.js';
import { defaultDocSeats } from '../src/board/docSeats.js';
import type { RosterSeat } from '../src/api/types.js';

describe('composer seats: opt-in', () => {
  beforeEach(() => resetComposerSeats());

  it('opencode is off by default; every other seat is on', () => {
    const s = useComposerSeats.getState();
    expect(chosenSeats(['claude', 'opencode', 'pi'], s.dropped, s.picked)).toEqual(['claude', 'pi']);
    expect(seatOff('opencode#2', [], [])).toBe(true);
    expect(isOptInKey('codex')).toBe(false);
    expect(OPT_IN_NOTE).toBe('opt-in: known to stall');
  });

  it('ticking opencode picks it; ticking again unpicks it; other seats still drop', () => {
    useComposerSeats.getState().toggle('opencode');
    let s = useComposerSeats.getState();
    expect(chosenSeats(['claude', 'opencode'], s.dropped, s.picked)).toEqual(['claude', 'opencode']);
    useComposerSeats.getState().toggle('claude');
    s = useComposerSeats.getState();
    expect(chosenSeats(['claude', 'opencode'], s.dropped, s.picked)).toEqual(['opencode']);
    useComposerSeats.getState().toggle('opencode');
    s = useComposerSeats.getState();
    expect(chosenSeats(['claude', 'opencode'], s.dropped, s.picked)).toEqual([]);
  });

  it('default picks (launch form, new document) leave opencode out until it is picked', () => {
    const seat = (key: string) => ({ key, display_name: key, binary: key, enabled_for_council: true }) as RosterSeat;
    const roster = [seat('claude'), seat('opencode')];
    expect([...defaultDocSeats(roster, null).selected]).toEqual(['claude']);
    expect(defaultOn('opencode')).toBe(false);
    useComposerSeats.getState().toggle('opencode');
    expect(defaultOn('opencode')).toBe(true);
    expect([...defaultDocSeats(roster, null).selected]).toEqual(['claude', 'opencode']);
  });
});
