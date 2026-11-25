/**
 * studio#1362: the sign-in window shows the helper's sign-in link OUTSIDE its terminal, as a real link with a Copy
 * button. In the terminal, claude's setup-token holds the mouse (mouse reporting on), so a click or drag there may
 * never reach the link; the box above it is a plain page link the person can click, drag, select and copy.
 *
 * Real shape: the screen is a REAL xterm buffer (not opened: parsing needs no layout), fed claude's setup-token screen
 * the way its Ink UI writes it (mouse reporting on, the link wrapped by claude at the width). The link is claude's
 * OAuth authorize address in its public shape (client id, PKCE challenge and state are made-up values).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal as XTerm } from '@xterm/xterm';
import { CELL_CHARS_MAX, findUrls, LINK_ROWS_MAX, linksAt, OVER_CAP, readRow, urlsIn, type TermRow } from '../src/board/terminalLinks.js';
import { linkCopyNote, SignInLink } from '../src/components/agents/containerSignIn.js';

const LINK = 'https://claude.ai/oauth/authorize?code=true&client_id=00000000-0000-4000-8000-000000000000&response_type=code'
  + '&redirect_uri=https%3A%2F%2Fconsole.anthropic.com%2Foauth%2Fcode%2Fcallback&scope=user%3Ainference'
  + '&code_challenge=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE&code_challenge_method=S256&state=ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210';

async function bufferOf(bytes: string, cols = 80, rows = 30): Promise<{ read: (i: number) => TermRow; length: number }> {
  const term = new XTerm({ cols, rows, allowProposedApi: true, scrollback: 2000 });
  await new Promise<void>((r) => term.write(bytes, r));
  const out: TermRow[] = [];
  for (let i = 0; i < term.buffer.active.length; i++) out.push(readRow(term.buffer.active.getLine(i), cols));
  term.dispose();
  return { read: (i) => out[i]!, length: out.length };
}

const inkWrapped = (text: string, width: number): string => {
  const rows: string[] = [];
  for (let i = 0; i < text.length; i += width) rows.push(text.slice(i, i + width));
  return rows.join('\r\n');
};

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the addresses on a terminal screen (urlsIn)', () => {
  it('claude’s setup-token screen: the one sign-in link, whole, joined across the rows claude wrapped it on', async () => {
    const b = await bufferOf('\x1b[?1000h\x1b[?1006h' + 'Browser didn\'t open? Use the url below to sign in:\r\n\r\n' + inkWrapped(LINK, 80) + '\r\n\r\nPaste code here if prompted > ');
    expect(urlsIn(b.read, b.length, 80)).toEqual([LINK]);
  });

  it('every address, oldest first (the window shows the newest)', async () => {
    const b = await bufferOf('Docs: https://example.com/docs\r\n' + inkWrapped(LINK, 80) + '\r\n');
    expect(urlsIn(b.read, b.length, 80)).toEqual(['https://example.com/docs', LINK]);
  });

  it('a link the read starts inside is read back to its start, whole (never its tail alone)', async () => {
    const b = await bufferOf('Sign in:\r\n' + inkWrapped(LINK, 40) + '\r\nPaste code here > ', 40);
    // The read starts on the link's third row: it reaches back to the link's first row.
    const rowsAfterStart = b.length - 1 - 2;
    expect(urlsIn(b.read, b.length, 40, rowsAfterStart)).toEqual([LINK]);
  });

  it('a run cut beyond reach offers nothing from it, not even another address inside its query', async () => {
    // At 10 columns, a 2,600-character address is 260 rows: more than the read reaches back (LINK_ROWS_MAX).
    const inner = 'https://tail.example/next';
    // (2,496: the inner address's `https` is not cut by a row end, where a row starting `tps://` would read as a new
    // address, findUrls' own rule on main.)
    const long = `https://example.com/a?${'x'.repeat(2_496)}&next=${inner}&end=1`;
    const b = await bufferOf(inkWrapped(long, 10) + '\r\ndone\r\n', 10, 30);
    const reads: number[] = [];
    const read = (i: number): TermRow => { reads.push(i); return b.read(i); };
    const maxRows = 20;
    expect(urlsIn(read, b.length, 10, maxRows)).toEqual([]);
    // Bounded: never reads further back than the window plus LINK_ROWS_MAX (and the one row before it).
    expect(Math.min(...reads)).toBeGreaterThanOrEqual(b.length - maxRows - LINK_ROWS_MAX - 1);
    // Read whole, the one address is found, and the address inside its query is not offered on its own.
    expect(urlsIn(b.read, b.length, 10, b.length)).toEqual([long]);
  });

  it('a cell stacked with combining marks is read only so far (bounded work per row)', () => {
    const marks = '́'.repeat(10_000);
    const line = {
      isWrapped: false,
      getCell: (x: number) => (x >= 3 ? undefined : { getChars: () => (x === 1 ? `a${marks}` : 'b'), getWidth: () => 1 }),
    } as unknown as Parameters<typeof readRow>[0];
    const row = readRow(line, 3);
    // Read as one mark, never as a cut part of the cell.
    expect(row.text).toBe(`b${OVER_CAP}b`);
    expect(row.text.length).toBeLessThan(3 + CELL_CHARS_MAX);
  });

  it('an address through a cell read only so far is not offered (never an address the screen did not show)', async () => {
    const marks = '\u0301'.repeat(CELL_CHARS_MAX + 2);
    // xterm keeps a character and all its combining marks in one cell.
    const b = await bufferOf(`Open https://example.com/cafe${marks}/menu\r\nOr https://example.com/plain\r\n`, 80);
    expect(urlsIn(b.read, b.length, 80)).toEqual(['https://example.com/plain']);
    // Under the cap the address is read whole, marks and all.
    const few = '\u0301'.repeat(2);
    const c = await bufferOf(`Open https://example.com/cafe${few}/menu\r\n`, 80);
    expect(urlsIn(c.read, c.length, 80)).toEqual([`https://example.com/cafe${few}/menu`]);
    // Cut across rows by the program's own wrap: the over-cap cell starts the next row.
    const d = await bufferOf(`https://example.com/abcdefghijklmnopq\r\nx${marks}yz\r\n`, 37);
    expect(urlsIn(d.read, d.length, 37)).toEqual([]);
  });

  it('a first buffer row that continues a row no longer held (scrolled off) is a cut run: nothing inside it is offered', async () => {
    // No scrollback: the address's first rows scroll off the top, and buffer row 0 is a terminal-wrapped continuation.
    const long = `https://example.com/a?q=${'x'.repeat(60)}&next=https://tail.example/next&end=1`;
    const term = new XTerm({ cols: 20, rows: 8, allowProposedApi: true, scrollback: 0 });
    await new Promise<void>((r) => term.write(`${long}\r\nSee https://ok.example/b\r\n`, r));
    const rows: TermRow[] = [];
    for (let i = 0; i < term.buffer.active.length; i++) rows.push(readRow(term.buffer.active.getLine(i), 20));
    term.dispose();
    expect(rows[0]!.wrapped).toBe(true);
    const read = (i: number): TermRow => rows[i]!;
    expect(urlsIn(read, rows.length, 20)).toEqual(['https://ok.example/b']);
    // Hovering any row: the cut run offers nothing, the address after it still opens.
    expect(rows.map((r) => r.text).join('')).toContain('https://tail.example/next');
    const hovered = new Set(rows.flatMap((_, i) => linksAt(read, rows.length, i, 20).map((u) => u.url)));
    expect([...hovered]).toEqual(['https://ok.example/b']);
  });

  it('a long tail of closing brackets is trimmed in one pass', () => {
    const tail = ')'.repeat(50_000);
    const t0 = performance.now();
    const found = findUrls([{ text: `https://example.com/a${tail}`, cols: [], wrapped: false, lastCol: 0 }], 80_000);
    expect(found.map((f) => f.url)).toEqual(['https://example.com/a']);
    expect(performance.now() - t0).toBeLessThan(2_000);
  });
});

describe('the sign-in link box (SignInLink)', () => {
  it('is a real link: it opens in a new tab with no opener, and its text is the whole address', () => {
    render(<SignInLink url={LINK} />);
    const a = screen.getByTestId('agents-login-link-url');
    expect(a.tagName).toBe('A');
    expect(a).toHaveAttribute('href', LINK);
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveTextContent(LINK);
    expect(screen.getByTestId('agents-login-link')).toHaveTextContent('Sign-in link');
    expect(screen.getByTestId('agents-login-link-copy')).toHaveTextContent('Copy link');
  });

  it('Copy link puts the whole address on the clipboard and says so; nothing is copied or opened before the press', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { rerender } = render(<SignInLink url="https://example.com/first" />);
    rerender(<SignInLink url={LINK} />);
    expect(writeText).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    fireEvent.click(screen.getByTestId('agents-login-link-copy'));
    expect(writeText).toHaveBeenCalledWith(LINK);
    await waitFor(() => expect(screen.getByTestId('agents-login-link-note')).toHaveTextContent('Copied. Paste it into your browser’s address bar.'));
  });

  it('a copy the browser refuses selects the link and says which keys copy it', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    vi.stubGlobal('navigator', { ...navigator, platform: 'MacIntel', clipboard: { writeText } });
    render(<SignInLink url={LINK} />);
    fireEvent.click(screen.getByTestId('agents-login-link-copy'));
    await waitFor(() => expect(screen.getByTestId('agents-login-link-note')).toHaveTextContent('Your browser didn’t allow the copy. The link is selected: press ⌘C to copy it.'));
    expect(window.getSelection()?.toString()).toBe(LINK);
    // The keyboard's copy goes to the link, not to whatever held focus (the terminal).
    expect(document.activeElement).toBe(screen.getByTestId('agents-login-link-url'));
  });

  it('a browser with no clipboard says so too, in this computer’s keys', async () => {
    vi.stubGlobal('navigator', { ...navigator, platform: 'Win32', clipboard: undefined });
    render(<SignInLink url={LINK} />);
    fireEvent.click(screen.getByTestId('agents-login-link-copy'));
    await waitFor(() => expect(screen.getByTestId('agents-login-link-note')).toHaveTextContent('press Ctrl+C to copy it.'));
  });

  it('a newer link starts without the last one’s note', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { rerender } = render(<SignInLink url={LINK} />);
    fireEvent.click(screen.getByTestId('agents-login-link-copy'));
    await screen.findByTestId('agents-login-link-note');
    await act(async () => { rerender(<SignInLink url="https://example.com/device" />); });
    expect(screen.queryByTestId('agents-login-link-note')).toBeNull();
    expect(screen.getByTestId('agents-login-link-url')).toHaveAttribute('href', 'https://example.com/device');
  });

  it('a copy still out when a newer link arrives says nothing and selects nothing (only the newest request answers)', async () => {
    let reject: (e: Error) => void = () => undefined;
    const writeText = vi.fn(() => new Promise<void>((_, r) => { reject = r; }));
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const { rerender } = render(<SignInLink url={LINK} />);
    fireEvent.click(screen.getByTestId('agents-login-link-copy'));
    await act(async () => { rerender(<SignInLink url="https://example.com/device" />); });
    window.getSelection()?.removeAllRanges();
    await act(async () => { reject(new Error('NotAllowedError')); await Promise.resolve(); });
    expect(screen.queryByTestId('agents-login-link-note')).toBeNull();
    expect(window.getSelection()?.toString()).toBe('');
  });

  it('only a web address is ever a link here', () => {
    const { container } = render(<SignInLink url="javascript:alert(1)" />);
    expect(container.querySelector('a')).toBeNull();
  });

  it('the words, per computer', () => {
    expect(linkCopyNote(true, true)).toBe('Copied. Paste it into your browser’s address bar.');
    expect(linkCopyNote(false, false)).toBe('Your browser didn’t allow the copy. The link is selected: press Ctrl+C to copy it.');
  });
});
