/**
 * studio#1362: claude's sign-in link in studio's terminal opens on click, joined across the rows it spans, and an
 * OSC 52 copy is read (or refused) the way the terminal offers it to the person.
 *
 * Real shape: the rows come from a REAL xterm buffer (not opened: parsing needs no layout), fed the bytes a TUI writes.
 * claude's setup-token screen (Ink) turns mouse reporting on and wraps a long line itself at the terminal's width (core
 * `seat_login.rs` reads claude's token from a capture on exactly that rule: "a row that ended exactly at the terminal
 * width, the next row holds token characters alone"). The link is claude's OAuth authorize address in its public
 * shape (client id, PKCE challenge and state are made-up values here).
 */
import { describe, expect, it, vi } from 'vitest';
import { Terminal as XTerm } from '@xterm/xterm';
import { copyAskWords, copyNote, findUrls, linksAt, LINK_ROWS_MAX, openUrl, opensOnRelease, osc52Text, readRow, selectWords, type TermRow } from '../src/board/terminalLinks.js';

const LINK = 'https://claude.ai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000&response_type=code'
  + '&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference'
  + '&code_challenge=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE&code_challenge_method=S256&state=ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210';

async function screenOf(bytes: string, cols = 80, rows = 30): Promise<TermRow[]> {
  const term = new XTerm({ cols, rows, allowProposedApi: true });
  await new Promise<void>((r) => term.write(bytes, r));
  const out: TermRow[] = [];
  for (let i = 0; i < term.buffer.active.length; i++) out.push(readRow(term.buffer.active.getLine(i), cols));
  term.dispose();
  return out;
}

/** Ink's own wrap: the line cut at the width, each row on its own line, `indent` spaces before each. */
function inkWrapped(text: string, width: number, indent = 0): string {
  const room = width - indent;
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += room) rows.push(' '.repeat(indent) + text.slice(i, i + room));
  return rows.join('\r\n');
}

describe('a printed sign-in link (studio#1362)', () => {
  it('claude’s screen: mouse reporting on, the link wrapped by claude at the width, is one link from its first row to its last', async () => {
    const bytes = '\x1b[?1000h\x1b[?1006h' + 'Browser didn\'t open? Use the url below to sign in:\r\n\r\n' + inkWrapped(LINK, 80) + '\r\n\r\nPaste code here if prompted > ';
    const rows = await screenOf(bytes);
    const found = findUrls(rows, 80);
    expect(found.map((f) => f.url)).toEqual([LINK]);
    const rowsSpanned = Math.ceil(LINK.length / 80);
    expect(found[0]!.start).toEqual({ row: 2, col: 0 });
    expect(found[0]!.end).toEqual({ row: 2 + rowsSpanned - 1, col: (LINK.length - 1) % 80 });
  });

  it('indented by its box: each row is joined at the link’s own column', async () => {
    const rows = await screenOf('Sign in:\r\n' + inkWrapped(LINK, 60, 2) + '\r\n', 60);
    expect(findUrls(rows, 60).map((f) => f.url)).toEqual([LINK]);
  });

  it('wrapped by the terminal (no line break): one link too', async () => {
    const rows = await screenOf(`Open ${LINK} in your browser.\r\n`, 70);
    expect(rows[1]!.wrapped).toBe(true);
    expect(findUrls(rows, 70).map((f) => f.url)).toEqual([LINK]);
  });

  it('a link that ends before the width does not take the next row; the sentence’s full stop is not the link’s', async () => {
    const rows = await screenOf('See https://example.com/docs.\r\nnext-word\r\n(at https://example.com/a_(b))\r\n', 80);
    expect(findUrls(rows, 80).map((f) => f.url)).toEqual(['https://example.com/docs', 'https://example.com/a_(b)']);
  });

  it('a full-width link followed by prose is not joined to the prose', async () => {
    const url = 'https://example.com/' + 'x'.repeat(60);
    const rows = await screenOf(url + '\r\nThen paste the code here\r\n', 80);
    expect(findUrls(rows, 80).map((f) => f.url)).toEqual([url]);
  });

  it('a link whose scheme the terminal cut across two rows is still one link (review r1)', async () => {
    for (const pad of [74, 76, 79]) {
      const rows = await screenOf(`${'x'.repeat(pad)} ${LINK}\r\n`, 80);
      expect(findUrls(rows, 80).map((f) => f.url)).toEqual([LINK]);
    }
  });

  it('two addresses on two rows stay two links, even when the first fills the width (review r1)', async () => {
    const first = 'https://example.com/' + 'a'.repeat(60);
    const rows = await screenOf(`${first}\r\n${LINK.slice(0, 70)}\r\n`, 80);
    expect(findUrls(rows, 80).map((f) => f.url)).toEqual([first, LINK.slice(0, 70)]);
  });

  it('a shell prompt after a full-width link is not taken into it (review r1)', async () => {
    const url = 'https://example.com/' + 'b'.repeat(60);
    const rows = await screenOf(`${url}\r\nuser@host:~/work$ `, 80);
    expect(findUrls(rows, 80).map((f) => f.url)).toEqual([url]);
  });

  it('letters of any script stay in the link; a cut address is never offered (review r1)', async () => {
    const rows = await screenOf('Docs: https://example.com/über/straße and https://café.example/menu\r\nhttps://\r\n', 80);
    expect(findUrls(rows, 80).map((f) => f.url)).toEqual(['https://example.com/über/straße', 'https://café.example/menu']);
  });

  it('a link longer than any fixed window is found whole from any of its rows; past the cap it is not offered (review r1)', async () => {
    const long = 'https://claude.ai/oauth/authorize?state=' + 'z'.repeat(1000);
    const rows = await screenOf(inkWrapped(long, 40) + '\r\n\r\n> ', 40, 60);
    const read = (i: number): TermRow => rows[i] ?? { text: '', cols: [], wrapped: false, lastCol: -1 };
    const spanned = Math.ceil(long.length / 40);
    expect(spanned).toBeGreaterThan(25);
    for (const y of [0, 13, spanned - 1]) expect(linksAt(read, rows.length, y, 40).map((f) => f.url)).toEqual([long]);
    // More rows than the cap: the address could be cut, so nothing is offered.
    const huge = 'https://example.com/' + 'q'.repeat(40 * (LINK_ROWS_MAX + 5));
    const many = inkWrapped(huge, 40).split('\r\n').map((t) => ({ text: t, cols: [...t].map((_, i) => i), wrapped: false, lastCol: t.length - 1 }));
    expect(linksAt((i) => many[i]!, many.length, 0, 40)).toEqual([]);
  });

  it('a wide character at the row’s end, a whole blank wrapped row, a letter outside the first plane (review r2)', async () => {
    // 22 columns: 界 takes cells 20-21, so the row is full and the link goes on.
    expect(findUrls(await screenOf('https://example.com/界/next\r\n', 22, 10), 22).map((f) => f.url)).toEqual(['https://example.com/界/next']);
    // A link filling 40 columns, a row of 40 blanks the terminal wrapped, then a word: the word is not the link's.
    const url40 = 'https://example.com/' + 'c'.repeat(20);
    expect(findUrls(await screenOf(url40 + ' '.repeat(40) + 'tail\r\n', 40, 10), 40).map((f) => f.url)).toEqual([url40]);
    // claude's own wrap with 𐐀 (two UTF-16 units) in the next row.
    const deseret = 'https://example.com/' + 'd'.repeat(60) + '/𐐀𐐀/end';
    expect(findUrls(await screenOf(inkWrapped(deseret, 80) + '\r\n', 80, 10), 80).map((f) => f.url)).toEqual([deseret]);
  });

  it('a click opens; a drag, another button, or Option/Shift (they select) does not (review r1)', () => {
    const at = { button: 0, altKey: false, shiftKey: false, clientX: 100, clientY: 50 };
    expect(opensOnRelease(at, { x: 101, y: 50 })).toBe(true);
    expect(opensOnRelease(at, { x: 160, y: 50 })).toBe(false);
    expect(opensOnRelease({ ...at, button: 2 }, { x: 100, y: 50 })).toBe(false);
    expect(opensOnRelease({ ...at, altKey: true }, { x: 100, y: 50 })).toBe(false);
    expect(opensOnRelease({ ...at, shiftKey: true }, { x: 100, y: 50 })).toBe(false);
  });

  it('opens only http(s), in a new tab with no opener', () => {
    const open = vi.fn();
    expect(openUrl(LINK, open as unknown as typeof window.open)).toBe(true);
    expect(open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer');
    expect(openUrl('javascript:alert(1)', open as unknown as typeof window.open)).toBe(false);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('an OSC 52 copy (studio#1362)', () => {
  it('reads the text a program asks to copy; a query, a clear or a malformed write is none', () => {
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(LINK)));
    expect(osc52Text(`c;${b64}`)).toBe(LINK);
    expect(osc52Text(`;${btoa('é token')}`)).toBeNull(); // not UTF-8 once decoded as bytes: refused, not garbled
    expect(osc52Text(';' + btoa(String.fromCharCode(...new TextEncoder().encode('é token'))))).toBe('é token');
    expect(osc52Text('c;?')).toBeNull();
    expect(osc52Text('c;')).toBeNull();
    expect(osc52Text('c;%%%')).toBeNull();
    expect(osc52Text('nothing')).toBeNull();
  });
  it('asks before copying, says where the copy went, and what to do when the browser refused it, in this computer’s keys', () => {
    expect(copyAskWords(412)).toBe('The program in this terminal wants to copy 412 characters to your clipboard.');
    expect(copyNote(true)).toBe('Copied to your clipboard.');
    expect(copyNote(false, true)).toBe('Your browser didn’t allow the copy. To copy text from the terminal, hold Option (⌥) while you drag over it, then press ⌘C.');
    expect(selectWords(false)).toBe('To copy text from the terminal, hold Shift while you drag over it, then right-click it and choose Copy.');
  });
});
