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
import { readRow, SCAN_ROWS_MAX, urlsIn, type TermRow } from '../src/board/terminalLinks.js';
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

  it('reads only the last SCAN_ROWS_MAX rows, and never offers a link cut by that start (it could be a longer one’s tail)', async () => {
    // The link's first row is the last row out of reach: its rest, in reach, is not offered as a link of its own.
    const filler = Array.from({ length: SCAN_ROWS_MAX }, (_, i) => `line ${i}`).join('\r\n');
    const rows = inkWrapped(LINK, 80).split('\r\n');
    const b = await bufferOf(inkWrapped(LINK, 80) + '\r\n' + filler + '\r\n', 80);
    expect(urlsIn(b.read, b.length, 80)).toEqual([]);
    // In reach, it is found whole.
    expect(urlsIn(b.read, b.length, 80, SCAN_ROWS_MAX + rows.length + 2)).toEqual([LINK]);
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

  it('Copy link puts the whole address on the clipboard and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    render(<SignInLink url={LINK} />);
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

  it('the words, per computer', () => {
    expect(linkCopyNote(true, true)).toBe('Copied. Paste it into your browser’s address bar.');
    expect(linkCopyNote(false, false)).toBe('Your browser didn’t allow the copy. The link is selected: press Ctrl+C to copy it.');
  });
});
