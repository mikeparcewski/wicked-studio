// H3: who responded — the three responders (a seat, you, crew) and how each thread entry is named.
import { describe, expect, it } from 'vitest';
import {
  askingResponder, CREW, gateResponder, OPERATOR, producerOf, responderKey, seatResponder, turnResponder, unitResponder,
} from '../src/board/responder.js';
import { makeUnit, makeView } from './factories.js';

const ROSTER = [
  { key: 'claude', display_name: 'Claude Code', binary: 'claude' },
  { key: 'codex', display_name: 'Codex (judge)', binary: 'codex' },
];

describe('turnResponder', () => {
  it('you is the operator', () => {
    expect(turnResponder('you', ROSTER)).toEqual(OPERATOR);
  });
  it('a seat key is the seat, by its roster name (a role suffix is never part of the name)', () => {
    expect(turnResponder('claude', ROSTER)).toEqual({ role: 'seat', name: 'Claude Code', cli: 'claude' });
    expect(turnResponder('codex', ROSTER)).toEqual({ role: 'seat', name: 'Codex', cli: 'codex' });
  });
  it('a seat the roster has not listed is still a seat, by its key — never crew', () => {
    expect(turnResponder('pi', ROSTER)).toEqual({ role: 'seat', name: 'pi', cli: 'pi' });
    expect(turnResponder('pi', null)).toEqual({ role: 'seat', name: 'pi', cli: 'pi' });
  });
  it('a reply with no seat named is crew’s', () => {
    expect(turnResponder(null, ROSTER)).toEqual(CREW);
    expect(turnResponder('', ROSTER)).toEqual(CREW);
    expect(turnResponder('helper', ROSTER)).toEqual(CREW);
  });
});

describe('unit, gate and question responders', () => {
  const view = makeView({ id: 'r1', status: 'awaiting_human', unit_ix: 1 }, [
    makeUnit({ ord: 0, assigned_cli: 'claude', status: 'done' }),
    makeUnit({ ord: 1, assigned_cli: 'codex', status: 'distributed', stage: 'review' }),
    makeUnit({ ord: 2, assigned_cli: null }),
  ]);
  it('a unit with a seat is that seat; one without is crew', () => {
    expect(unitResponder(view, 1, ROSTER).name).toBe('Codex');
    expect(unitResponder(view, 2, ROSTER)).toEqual(CREW);
    expect(unitResponder(null, 1, ROSTER)).toEqual(CREW);
  });
  it('a gate is asked by the seat of its unit; a plan approval, or no gate, is crew’s', () => {
    expect(gateResponder(view, { ord: 1, gateKind: 'review' }, ROSTER)).toEqual({ role: 'seat', name: 'Codex', cli: 'codex' });
    expect(gateResponder(view, { ord: 1, gateKind: 'plan_approval' }, ROSTER)).toEqual(CREW);
    expect(gateResponder(view, undefined, ROSTER)).toEqual(CREW);
  });
  it('a live run’s question is asked through the seat running the current step', () => {
    expect(askingResponder(view, ROSTER).cli).toBe('codex');
  });
  it('an artifact is produced by the newest unit that ran on a seat', () => {
    expect(producerOf(view, ROSTER).cli).toBe('codex');
    expect(producerOf(makeView({}, [makeUnit({ ord: 0, assigned_cli: 'claude', status: 'pending' })]), ROSTER)).toEqual(CREW);
  });
});

describe('responderKey', () => {
  it('groups consecutive entries by the same responder', () => {
    expect(responderKey(CREW)).toBe(responderKey({ ...CREW }));
    expect(responderKey(seatResponder('claude', ROSTER))).not.toBe(responderKey(seatResponder('codex', ROSTER)));
    expect(responderKey(OPERATOR)).not.toBe(responderKey(CREW));
  });
});
