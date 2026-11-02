/** Operator 2026-10-29: never "local" as an actor — the local operator is "you". */
import { describe, expect, it } from 'vitest';
import { actorWords } from '../src/board/actorWords.js';

describe('actorWords', () => {
  it('says the local operator as "you", another person as recorded', () => {
    expect(actorWords('local')).toBe('you');
    expect(actorWords('local (human)')).toBe('you');
    expect(actorWords('mikep (user)')).toBe('mikep (user)');
    expect(actorWords('ana (human)')).toBe('ana');
  });
});
