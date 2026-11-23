/**
 * What a person needs to get text OUT of studio's terminal (studio#1362): a printed web address opens on click, and a
 * program's clipboard write (OSC 52) reaches the clipboard or says it did not. Pure parts here; the terminal wires
 * them to xterm's own `registerLinkProvider` and `parser.registerOscHandler` (no extra addon).
 *
 * A sign-in link is long, so it spans rows. Two ways: the terminal wrapped it (the next row is marked wrapped), or the
 * program wrapped it itself at the terminal's width (claude's Ink screen does: core `seat_login.rs` reads the token it
 * wraps the same way, "a row that ended exactly at the terminal width, the next row holds token characters alone").
 * Both are joined into one link.
 */

import type { IBufferLine } from '@xterm/xterm';

/** One terminal row as drawn: its text, and the cell column of each UTF-16 unit of that text. */
export interface TermRow {
  text: string;
  cols: number[];
  /** The terminal wrapped this row onto the one before (xterm `IBufferLine.isWrapped`). */
  wrapped: boolean;
}

/** One buffer row as text, with each character's cell column (a wide character takes two cells). */
export function readRow(line: IBufferLine | undefined, width: number): TermRow {
  if (line === undefined) return { text: '', cols: [], wrapped: false };
  let text = '';
  const cols: number[] = [];
  for (let x = 0; x < width; x++) {
    const cell = line.getCell(x);
    if (cell === undefined) break;
    if (cell.getWidth() === 0) continue;
    const ch = cell.getChars() || ' ';
    for (let i = 0; i < ch.length; i++) cols.push(x);
    text += ch;
  }
  const trimmed = text.trimEnd();
  return { text: trimmed, cols: cols.slice(0, trimmed.length), wrapped: line.isWrapped };
}

export interface CellPos { row: number; col: number }
export interface FoundUrl { url: string; start: CellPos; end: CellPos }

const URL_CHAR = /[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]/u;
const URL_START = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/gu;

function runOfUrlChars(text: string, from: number): number {
  let i = from;
  while (i < text.length && URL_CHAR.test(text[i]!)) i++;
  return i;
}

/** Drop what usually closes the sentence around a link ("(see https://x.y/z)." → "https://x.y/z"). */
function trimTail(url: string): number {
  let n = url.length;
  for (;;) {
    const c = url[n - 1];
    if (c === undefined) return n;
    if ('.,;:!?\'"'.includes(c)) { n--; continue; }
    if (c === ')' || c === ']') {
      const open = c === ')' ? '(' : '[';
      const s = url.slice(0, n);
      if (s.split(open).length < s.split(c).length) { n--; continue; }
    }
    return n;
  }
}

/** Every http(s) address in the rows, each joined across the rows it spans. Columns are 0-based cells. */
export function findUrls(rows: readonly TermRow[], width: number): FoundUrl[] {
  const out: FoundUrl[] = [];
  /** Per row, the text index before which a link already took the row's text (a continuation). */
  const taken = new Array<number>(rows.length).fill(0);
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    URL_START.lastIndex = taken[r]!;
    for (let m = URL_START.exec(row.text); m !== null; m = URL_START.exec(row.text)) {
      const startIdx = m.index;
      const startCol = row.cols[startIdx] ?? startIdx;
      // Each piece: the row it is on and its text-index span [from, to).
      const pieces: Array<{ row: number; from: number; to: number }> = [{ row: r, from: startIdx, to: startIdx + m[0].length }];
      for (;;) {
        const last = pieces[pieces.length - 1]!;
        const lrow = rows[last.row]!;
        // Only a piece that runs to the row's last cell can go on.
        const endCol = lrow.cols[last.to - 1];
        if (last.to !== lrow.text.length || endCol === undefined || endCol + 1 < width) break;
        const n = last.row + 1;
        const next = rows[n];
        if (next === undefined) break;
        if (next.wrapped) {
          const to = runOfUrlChars(next.text, 0);
          if (to === 0) break;
          pieces.push({ row: n, from: 0, to });
          continue;
        }
        // The program's own wrap: the next row holds address characters alone, indented no further than the link.
        const lead = next.text.length - next.text.trimStart().length;
        if ((next.cols[lead] ?? lead) > startCol) break;
        const to = runOfUrlChars(next.text, lead);
        if (to === lead || next.text.slice(to).trim() !== '') break;
        pieces.push({ row: n, from: lead, to });
      }
      let url = pieces.map((p) => rows[p.row]!.text.slice(p.from, p.to)).join('');
      const keep = trimTail(url);
      // Trimmed characters come off the last pieces.
      let cut = url.length - keep;
      while (cut > 0) {
        const p = pieces[pieces.length - 1]!;
        const len = p.to - p.from;
        if (len > cut) { p.to -= cut; cut = 0; } else { pieces.pop(); cut -= len; }
      }
      url = url.slice(0, keep);
      const end = pieces[pieces.length - 1];
      if (end === undefined || !/^https?:\/\/[^/?#]+/u.test(url)) continue;
      for (const p of pieces.slice(1)) taken[p.row] = Math.max(taken[p.row]!, p.to);
      const endRow = rows[end.row]!;
      out.push({ url, start: { row: r, col: startCol }, end: { row: end.row, col: endRow.cols[end.to - 1] ?? end.to - 1 } });
      if (pieces.length > 1) break; // the rest of this row was the link
    }
  }
  return out;
}

/** Open a printed address in a new tab, never handing this page to it. Only http(s). */
export function openUrl(url: string, open: typeof window.open = window.open.bind(window)): boolean {
  if (!/^https?:\/\//iu.test(url)) return false;
  open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/** The longest text a program may put on the clipboard through the terminal (a sign-in link or token is far less). */
export const OSC52_MAX_CHARS = 100_000;

/**
 * An OSC 52 clipboard write's text (`Pc;Pd`, Pd base64), or null: a query (`?`), a clear, a malformed or an
 * over-long write. Never the selection buffers' read.
 */
export function osc52Text(data: string): string | null {
  const semi = data.indexOf(';');
  if (semi < 0) return null;
  const payload = data.slice(semi + 1).trim();
  if (payload === '' || payload === '?' || payload.length > OSC52_MAX_CHARS * 2) return null;
  try {
    const bin = atob(payload);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return text === '' || text.length > OSC52_MAX_CHARS ? null : text;
  } catch {
    return null;
  }
}

/** Is this a Mac (Option-drag selects; ⌘C copies), else Shift-drag and Ctrl+Shift+C. */
export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);

/** How to select and copy in the terminal, in this computer's keys. */
export function selectWords(mac = isMacPlatform()): string {
  return mac
    ? 'To copy text from the terminal, hold Option (⌥) while you drag over it, then press ⌘C.'
    : 'To copy text from the terminal, hold Shift while you drag over it, then press Ctrl+Shift+C.';
}

/** What the terminal says after a program asked to copy something. */
export function copyNote(ok: boolean, mac = isMacPlatform()): string {
  return ok
    ? 'Copied to your clipboard.'
    : `The terminal tried to copy to your clipboard, but your browser didn’t allow it. ${selectWords(mac)}`;
}
