// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { displayPath, displayText } from '../src/board/homePath.js';

describe('studio C3 Windows home paths', () => {
  it.each([
    [String.raw`C:\\Users\\reel-operator\\repo`, String.raw`~\\repo`],
    [String.raw`C:\\Users\\reel-operator`, '~'],
    [String.raw`c:\\uSeRs\\reel-operator\\repo`, String.raw`~\\repo`],
    [String.raw`C:\Users\reel-operator\repo`, String.raw`~\repo`],
    ['C:/USERS/reel-operator/repo', '~/repo'],
    [String.raw`C:\\Users\\reel-operator/repo`, '~/repo'],
  ])('masks %s and preserves its following separator', (raw, masked) => {
    expect.soft(displayPath(raw)).toBe(masked);
    expect.soft(displayText(`Read "${raw}" then ${raw}.`)).toBe(`Read "${masked}" then ${masked}.`);
    expect.soft(displayPath(raw)).not.toContain('reel-operator');
  });

  it('masks a Windows path embedded in JSON without decoding its separator', () => {
    expect(displayText(JSON.stringify({ path: String.raw`C:\Users\reel-operator\repo` })))
      .toBe(String.raw`{"path":"~\\repo"}`);
  });

  it.each([String.raw`C:\\cache\\Users\\reel-operator\\repo`, String.raw`prefixC:\\Users\\reel-operator\\repo`, '/tmp/cache!/home/reel-operator/repo'])('keeps non-home tokens intact: %s', (raw) => {
    expect(displayPath(raw)).toBe(raw);
    expect(displayText(raw)).toBe(raw);
  });
});
