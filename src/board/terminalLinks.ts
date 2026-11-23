/**
 * What a person needs to get text OUT of studio's terminal (studio#1362): a printed web address opens on click, and a
 * program's clipboard write (OSC 52) is offered to the person to copy. Pure parts here; the terminal wires them to
 * xterm's own `registerLinkProvider` and `parser.registerOscHandler` (no extra addon).
 *
 * A sign-in link is long, so it spans rows. Two ways: the terminal wrapped it (the next row is marked wrapped: one
 * logical line), or the program wrapped it itself at the terminal's width (claude's Ink screen does: core
 * `seat_login.rs` reads the token it wraps the same way, "a row that ended exactly at the terminal width, the next row
 * holds token characters alone"). Both are joined into one link.
 */

import type { IBufferLine } from '@xterm/xterm';

/** One terminal row as drawn: its text (trailing blanks dropped), and the cell column of each UTF-16 unit of it. */
export interface TermRow {
  text: string;
  cols: number[];
  /** The terminal wrapped this row onto the one before (xterm `IBufferLine.isWrapped`). */
  wrapped: boolean;
  /** The last cell the row's text covers (a wide character's second cell included); -1 for a blank row. */
  lastCol: number;
}

/** One buffer row as text, with each character's cell column (a wide character takes two cells). */
export function readRow(line: IBufferLine | undefined, width: number): TermRow {
  if (line === undefined) return { text: '', cols: [], wrapped: false, lastCol: -1 };
  let text = '';
  const cols: number[] = [];
  const ends: number[] = [];
  for (let x = 0; x < width; x++) {
    const cell = line.getCell(x);
    if (cell === undefined) break;
    const w = cell.getWidth();
    if (w === 0) continue;
    const ch = cell.getChars() || ' ';
    for (let i = 0; i < ch.length; i++) { cols.push(x); ends.push(x + w - 1); }
    text += ch;
  }
  const trimmed = text.trimEnd();
  return { text: trimmed, cols: cols.slice(0, trimmed.length), wrapped: line.isWrapped, lastCol: trimmed.length > 0 ? ends[trimmed.length - 1]! : -1 };
}

export interface CellPos { row: number; col: number }
export interface FoundUrl { url: string; start: CellPos; end: CellPos }

/** A character an address may hold: the URL punctuation, and letters and digits of any script. */
const URL_RUN = /[\p{L}\p{N}\p{M}\-._~:/?#[\]@!$&'()*+,;=%]+/uy;
const URL_START = /https?:\/\/[\p{L}\p{N}\p{M}\-._~:/?#[\]@!$&'()*+,;=%]+/giu;
/** A row that starts a new address, or ends like a shell prompt, is never a link's continuation. */
const NEW_ADDRESS = /^[a-z][a-z0-9+.-]*:\/\//iu;
const PROMPT_END = /[$#%]$/u;

/** A row reaches the terminal's last cell. */
const isFull = (row: TermRow, width: number): boolean => row.lastCol + 1 >= width;

/** Rows the terminal wrapped, joined: each character keeps its row and cell. */
interface Line { text: string; pos: CellPos[] }

function logicalLines(rows: readonly TermRow[], width: number): Line[] {
  const lines: Line[] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const cur = row.wrapped && lines.length > 0 ? lines[lines.length - 1]! : null;
    const line = cur ?? { text: '', pos: [] };
    if (cur !== null) {
      // The row before was cut by the terminal: its blanks up to the width were real spaces (a whole blank row too).
      for (let c = rows[r - 1]!.lastCol + 1; c < width; c++) { line.text += ' '; line.pos.push({ row: r - 1, col: c }); }
    }
    line.text += row.text;
    for (let i = 0; i < row.text.length; i++) line.pos.push({ row: r, col: row.cols[i] ?? i });
    if (cur === null) lines.push(line);
  }
  for (const l of lines) {
    const t = l.text.trimEnd();
    l.text = t;
    l.pos.length = t.length;
  }
  return lines;
}

/** Where a run of address characters from `from` ends (by code point: a letter outside the first plane is one). */
function runOfUrlChars(text: string, from: number): number {
  URL_RUN.lastIndex = from;
  const m = URL_RUN.exec(text);
  return m === null ? from : from + m[0].length;
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

/** A whole http(s) address with a host, or false (a cut or malformed one is never offered). */
function isAddress(url: string): boolean {
  try {
    const u = new URL(url);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

/** Every http(s) address in the rows, each joined across the rows it spans. Rows and columns are 0-based. */
export function findUrls(rows: readonly TermRow[], width: number): FoundUrl[] {
  const lines = logicalLines(rows, width);
  const out: FoundUrl[] = [];
  /** Per line, the text index before which a link already took the line's text (a continuation). */
  const taken = new Array<number>(lines.length).fill(0);
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!;
    URL_START.lastIndex = taken[l]!;
    for (let m = URL_START.exec(line.text); m !== null; m = URL_START.exec(line.text)) {
      const startCol = line.pos[m.index]!.col;
      // Each piece: the line it is on and its text-index span [from, to).
      const pieces: Array<{ line: number; from: number; to: number }> = [{ line: l, from: m.index, to: m.index + m[0].length }];
      for (;;) {
        const last = pieces[pieces.length - 1]!;
        const lline = lines[last.line]!;
        // Only a piece that runs to the last cell of the line's last row can go on, onto the next line.
        const end = lline.pos[last.to - 1];
        if (last.to !== lline.text.length || end === undefined || !isFull(rows[end.row]!, width)) break;
        const next = lines[last.line + 1];
        if (next === undefined || next.pos.length === 0 || next.pos[0]!.row !== end.row + 1) break;
        // The program's own wrap: the next row holds address characters alone, indented no further than the link.
        const lead = next.text.length - next.text.trimStart().length;
        if ((next.pos[lead]?.col ?? lead) > startCol) break;
        const to = runOfUrlChars(next.text, lead);
        const piece = next.text.slice(lead, to);
        if (to === lead || next.text.slice(to).trim() !== '' || NEW_ADDRESS.test(piece)) break;
        const full = to === next.text.length && isFull(rows[next.pos[to - 1]!.row]!, width);
        if (!full && PROMPT_END.test(piece)) break;
        pieces.push({ line: last.line + 1, from: lead, to });
      }
      let url = pieces.map((p) => lines[p.line]!.text.slice(p.from, p.to)).join('');
      const keep = trimTail(url);
      // Trimmed characters come off the last pieces.
      let cut = url.length - keep;
      while (cut > 0) {
        const p = pieces[pieces.length - 1]!;
        const len = p.to - p.from;
        if (len > cut) { p.to -= cut; cut = 0; } else { pieces.pop(); cut -= len; }
      }
      url = url.slice(0, keep);
      const last = pieces[pieces.length - 1];
      if (last === undefined || !isAddress(url)) continue;
      for (const p of pieces.slice(1)) taken[p.line] = Math.max(taken[p.line]!, p.to);
      out.push({ url, start: line.pos[m.index]!, end: lines[last.line]!.pos[last.to - 1]! });
      if (pieces.length > 1) break; // the rest of this line was the link
    }
  }
  return out;
}

/** The most rows looked at either side of a hovered row (a 4,000-character address at 20 columns). */
export const LINK_ROWS_MAX = 200;

/**
 * The links on buffer row `y` (0-based): the rows that could belong to one link with it (terminal-wrapped, or each one
 * reaching the width) are read whole, so a link is never cut by a fixed window; a run of rows longer than
 * {@link LINK_ROWS_MAX} is cut, and a link touching that cut is not offered (it could be a part of an address).
 */
export function linksAt(read: (i: number) => TermRow, length: number, y: number, width: number): FoundUrl[] {
  const cache = new Map<number, TermRow>();
  const row = (i: number): TermRow => { let r = cache.get(i); if (r === undefined) { r = read(i); cache.set(i, r); } return r; };
  const joinsBack = (i: number): boolean => i > 0 && (row(i).wrapped || isFull(row(i - 1), width));
  const joinsOn = (i: number): boolean => i + 1 < length && (isFull(row(i), width) || row(i + 1).wrapped);
  let start = y;
  while (joinsBack(start) && y - start < LINK_ROWS_MAX) start--;
  let end = y;
  while (joinsOn(end) && end - y < LINK_ROWS_MAX) end++;
  const cutBefore = joinsBack(start);
  const cutAfter = joinsOn(end);
  const rows: TermRow[] = [];
  for (let i = start; i <= end; i++) rows.push(row(i));
  return findUrls(rows, width)
    .map((u) => ({ ...u, start: { row: u.start.row + start, col: u.start.col }, end: { row: u.end.row + start, col: u.end.col } }))
    .filter((u) => u.start.row <= y && u.end.row >= y && !(cutBefore && u.start.row === start) && !(cutAfter && u.end.row === end));
}

/** Open a printed address in a new tab, never handing this page to it. Only http(s). */
export function openUrl(url: string, open: typeof window.open = window.open.bind(window)): boolean {
  if (!/^https?:\/\//iu.test(url)) return false;
  open(url, '_blank', 'noopener,noreferrer');
  return true;
}

/**
 * Whether a release on a link is a click that opens it: the main button, no selection modifier (Option or Shift,
 * which select), and the pointer where it went down (a drag selects, it does not open).
 */
export function opensOnRelease(e: Pick<MouseEvent, 'button' | 'altKey' | 'shiftKey' | 'clientX' | 'clientY'>, down: { x: number; y: number } | null): boolean {
  if (e.button !== 0 || e.altKey || e.shiftKey) return false;
  return down === null || Math.hypot(e.clientX - down.x, e.clientY - down.y) <= 4;
}

/** The longest text a program may offer for the clipboard through the terminal (a sign-in link or token is far less). */
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

/** Is this a Mac (Option-drag selects, ⌘C copies), else Shift-drag and the right-click menu's Copy. */
export const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform || navigator.userAgent);

/** How to select and copy in the terminal, in this computer's keys. */
export function selectWords(mac = isMacPlatform()): string {
  return mac
    ? 'To copy text from the terminal, hold Option (⌥) while you drag over it, then press ⌘C.'
    : 'To copy text from the terminal, hold Shift while you drag over it, then right-click it and choose Copy.';
}

/** What the terminal says when its program asks to put text on the clipboard: nothing is copied until you say so. */
export function copyAskWords(chars: number): string {
  return `The program in this terminal wants to copy ${chars === 1 ? '1 character' : `${chars.toLocaleString('en-US')} characters`} to your clipboard.`;
}

/** What the terminal says after a copy. */
export function copyNote(ok: boolean, mac = isMacPlatform()): string {
  return ok ? 'Copied to your clipboard.' : `Your browser didn’t allow the copy. ${selectWords(mac)}`;
}
