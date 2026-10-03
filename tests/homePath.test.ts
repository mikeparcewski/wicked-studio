// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { displayPath, displayText } from '../src/board/homePath.js';

/**
 * The one formatter for paths the daemon reports (studio#458, #460, #462; the rule #444 set): in the
 * default layer an absolute path under the operator's home directory reads as `~/…`, so a screen
 * share or a recording never prints the account name and the local folder layout. The three desktop
 * spellings of a home directory are recognised (`/Users/<name>`, `/home/<name>` and `/root`,
 * `<drive>:\Users\<name>` in any case); any other absolute path is left exactly as it is.
 */
describe('displayPath — a path under the home directory reads as ~', () => {
  it('abbreviates the three desktop spellings of a home directory', () => {
    expect(displayPath('/Users/mika/.wicked-crew/settings.json')).toBe('~/.wicked-crew/settings.json');
    expect(displayPath('/home/mika/.wicked-crew/skills')).toBe('~/.wicked-crew/skills');
    expect(displayPath('/root/.wicked-crew/core.db')).toBe('~/.wicked-crew/core.db');
    expect(displayPath('C:\\Users\\mika\\.wicked-crew\\settings.json')).toBe('~\\.wicked-crew\\settings.json');
    expect(displayPath('c:/users/mika/repos/api')).toBe('~/repos/api');
    expect(displayPath("C:\\Users\\O'Neil\\repos\\api")).toBe('~\\repos\\api');
    expect(displayPath('D:\\USERS\\alice\\repo')).toBe('~\\repo');
    expect(displayPath('C:\\Users\\Jane Doe\\repo')).toBe('~\\repo');
    expect(displayPath('C:\\Users\\Jane  Doe\\repo')).toBe('~\\repo');
    expect(displayPath('C:\\Users\\Jane Doe')).toBe('C:\\Users\\Jane Doe'); // a bare spaced Windows name: left whole, never half-abbreviated
  });
  it('accepts the account names people have: dotted, hyphenated, underscored, digits', () => {
    expect(displayPath('/Users/michael.parcewski/Projects/x')).toBe('~/Projects/x');
    expect(displayPath('/home/ci-runner_2/work')).toBe('~/work');
  });
  it('is the home directory itself, with nothing after it', () => {
    expect(displayPath('/Users/mika')).toBe('~');
    expect(displayPath('/home/mika/')).toBe('~/');
    expect(displayPath('/root')).toBe('~');
  });
  it('leaves every other path alone', () => {
    expect(displayPath('/tmp/w2/studio-api')).toBe('/tmp/w2/studio-api');
    expect(displayPath('/var/root/x')).toBe('/var/root/x');
    expect(displayPath('/Users')).toBe('/Users');
    expect(displayPath('/Users/')).toBe('/Users/');
    expect(displayPath('/homebrew/bin')).toBe('/homebrew/bin');
    expect(displayPath('/rootfs/etc')).toBe('/rootfs/etc');
    expect(displayPath('/root notes/file')).toBe('/root notes/file');
    expect(displayPath('/root:backup/file')).toBe('/root:backup/file');
    expect(displayPath('src/App.tsx')).toBe('src/App.tsx');
    expect(displayPath('~/.wicked-crew')).toBe('~/.wicked-crew');
    expect(displayPath('')).toBe('');
  });
  it('only abbreviates a prefix, never a home-looking segment inside a path', () => {
    expect(displayPath('/srv/Users/mika/x')).toBe('/srv/Users/mika/x');
  });
});

describe('displayText — every home path inside prose reads as ~', () => {
  it('rewrites each occurrence, wherever it sits in the sentence', () => {
    const t = 'indexed /tmp/reel-repos/offsite-plan (/Users/mika/.wicked-crew/repo-graphs/offsite-plan-9c1e/estate.db) → 4 nodes';
    expect(displayText(t)).toBe('indexed /tmp/reel-repos/offsite-plan (~/.wicked-crew/repo-graphs/offsite-plan-9c1e/estate.db) → 4 nodes');
    expect(displayText('Pushes to origin (/home/ci/bare.git) and `/root/x` on C:\\Users\\mika\\y'))
      .toBe('Pushes to origin (~/bare.git) and `~/x` on ~\\y');
  });
  it('keeps the prose punctuation after a bare home directory', () => {
    expect(displayText('Saved in /home/alice, then exited')).toBe('Saved in ~, then exited');
    expect(displayText('The state home is /Users/michael.parcewski.')).toBe('The state home is ~.');
    expect(displayText('home: /Users/mika; root: /Users/mika/w')).toBe('home: ~; root: ~/w');
    expect(displayText('under "/Users/mika" today')).toBe('under "~" today');
    expect(displayText('Saved in /home/alice! Then /home/alice? Yes')).toBe('Saved in ~! Then ~? Yes');
    expect(displayText("under 'C:\\Users\\alice' today")).toBe("under '~' today");
    expect(displayText('indexed C:\\Users\\Jane Doe\\repo (4 nodes)')).toBe('indexed ~\\repo (4 nodes)');
  });
  it('leaves text without a home path untouched, including words that only look like one', () => {
    expect(displayText('see /tmp/w2/studio-api/.codegraph and src/Users/list.ts')).toBe('see /tmp/w2/studio-api/.codegraph and src/Users/list.ts');
    expect(displayText('the /home of the brave')).toBe('the /home of the brave');
    expect(displayText('already ~/x and /var/root/y')).toBe('already ~/x and /var/root/y');
    expect(displayText('')).toBe('');
  });
});
