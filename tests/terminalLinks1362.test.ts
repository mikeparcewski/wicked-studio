/**
 * studio#1362: claude's sign-in link in studio's terminal opens on click, joined across the rows it spans, and an
 * OSC 52 copy is read (or refused) the way the terminal hands it to the clipboard.
 *
 * Real shape: the rows come from a REAL xterm buffer (not opened: parsing needs no layout), fed the bytes a TUI writes.
 * claude's setup-token screen (Ink) turns mouse reporting on and wraps a long line itself at the terminal's width (core
 * `seat_login.rs` reads claude's token from a capture on exactly that rule: "a row that ended exactly at the terminal
 * width, the next row holds token characters alone"). The link is claude's OAuth authorize address in its public
 * shape (client id, PKCE challenge and state are made-up values here).
 */
import { describe, expect, it, vi } from 'vitest';
import { Terminal as XTerm } from '@xterm/xterm';
import { copyNote, findUrls, openUrl, osc52Text, readRow, selectWords, type TermRow } from '../src/board/terminalLinks.js';

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
  it('says where the copy went, and what to do when the browser refused it, in this computer’s keys', () => {
    expect(copyNote(true)).toBe('Copied to your clipboard.');
    expect(copyNote(false, true)).toBe('The terminal tried to copy to your clipboard, but your browser didn’t allow it. To copy text from the terminal, hold Option (⌥) while you drag over it, then press ⌘C.');
    expect(selectWords(false)).toBe('To copy text from the terminal, hold Shift while you drag over it, then press Ctrl+Shift+C.');
  });
});
