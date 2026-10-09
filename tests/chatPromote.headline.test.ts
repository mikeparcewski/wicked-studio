/**
 * studio#311 R1–R3: the "Continue in Build" prefill's PR-safe headline and its seats.
 */
import { describe, expect, it } from 'vitest';
import { chatPromotePrefill, promoteHeadline } from '../src/board/chatPromote.js';

describe('promoteHeadline (R1: every absolute-path shape is redacted)', () => {
  it.each([
    ['macOS home', 'why does /Users/alex/repo/build.sh fail', 'why does <path> fail'],
    ['linux home', 'read /home/alex/notes.md', 'read <path>'],
    ['/var', 'logs in /var/log/app.log', 'logs in <path>'],
    ['/opt', 'binary at /opt/tool/bin/run', 'binary at <path>'],
    ['/private', 'temp at /private/var/folders/x1', 'temp at <path>'],
    ['/tmp', 'look in /tmp/scratch/out.txt', 'look in <path>'],
    ['quoted', 'open "/srv/data/file"', 'open "<path>"'],
    ['windows backslash', 'see C:\\Users\\alex\\repo now', 'see <path> now'],
    ['windows forward slash', 'see D:/work/repo now', 'see <path> now'],
    ['bracketed', 'open [/srv/data/file]', 'open [<path>]'],
    ['after a comma', 'path,/srv/data/file', 'path,<path>'],
    ['sentence punctuation stays', 'read /var/log/app.log. then /a/b: and C:\\Users\\a\\repo, done', 'read <path>. then <path>: and <path>, done'],
  ])('%s', (_name, input, want) => {
    expect(promoteHeadline(input)).toBe(want);
  });

  it('keeps relative paths, URLs and single-segment words', () => {
    expect(promoteHeadline('edit src/board/chatPromote.ts')).toBe('edit src/board/chatPromote.ts');
    expect(promoteHeadline('see https://github.com/o/r/pull/1')).toBe('see https://github.com/o/r/pull/1');
    expect(promoteHeadline('and/or the /health route')).toBe('and/or the /health route');
  });
});

describe('promoteHeadline (R2: a multi-line ask is one line)', () => {
  it('collapses newlines and runs of whitespace before slicing to 72', () => {
    expect(promoteHeadline('first line\n\nsecond   line\tthird')).toBe('first line second line third');
    const long = `${'word '.repeat(10)}\n${'more '.repeat(20)}`;
    const h = promoteHeadline(long);
    expect(h.length).toBeLessThanOrEqual(72);
    expect(h).not.toMatch(/\n/);
  });
});

describe('chatPromotePrefill (R3: seats that answered ANY turn ride along)', () => {
  it('keeps a seat that answered an earlier turn, drops failed-only seats', () => {
    const p = chatPromotePrefill('chat-1', [
      { kind: 'user', text: 'q1' },
      { kind: 'seat', cliKey: 'claude', text: 'a1' },
      { kind: 'seat', cliKey: 'codex', text: 'a1b' },
      { kind: 'user', text: 'q2' },
      { kind: 'seat', cliKey: 'claude', text: 'a2' },
      { kind: 'seat', cliKey: 'pi', text: 'boom', ok: false },
    ], null);
    expect(p.clis).toEqual(['claude', 'codex']);
    expect(p.problem.split('\n')[0]).toBe('q1');
  });
});
