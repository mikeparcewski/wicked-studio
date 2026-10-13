import { describe, expect, it } from 'vitest';
import { readFilterParam } from '../src/components/watch/WatchtowerPage.js';

describe('Watchtower ?filter= (Desk v2: the Needs you block opens it filtered)', () => {
  it('reads a known kind', () => {
    expect(readFilterParam('?filter=decision')).toBe('decision');
    expect(readFilterParam('?filter=problem')).toBe('problem');
    expect(readFilterParam('?filter=approved')).toBe('approved');
  });
  it('treats a missing or unknown value as Everything', () => {
    expect(readFilterParam('')).toBeNull();
    expect(readFilterParam('?filter=nope')).toBeNull();
  });
});
