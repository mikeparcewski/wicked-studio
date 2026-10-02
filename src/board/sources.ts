import type { ChatCitationItem, ChatCitations } from '../api/chat-wire.js';

/**
 * SOURCES (DES-STUDIO-REBUILD-001 §3 scenes 33/34, slice S6b). Pure.
 *
 * "Based on 3 sources": a helper's reply names what it read, as chips. The chips are the daemon's
 * own citation verdicts (crew#561, the transcript's `citations` record) — only what it CONFIRMED
 * (verified, or found at a corrected place). An unverified or unchecked citation is never a source;
 * it keeps its warning mark where the chat surface shows it. Nothing here is guessed from the text.
 *
 * A chip's hover says where it is; a click opens the passage — read through the run's contained
 * file route (`GET /runs/:id/files`), the cited line highlighted. When no run of the session can
 * read it, the passage says so and names the place; it never shows a file it did not read.
 */

export interface SourceRef {
  /** Dedupe key: the confirmed place (`resolved` when the daemon corrected it, else the token). */
  key: string;
  /** The chip: the file's name, and the line when there is one (`checkout.ts:42`). */
  label: string;
  /** Repo-relative path as cited, without the line or symbol. */
  path: string;
  line: number | null;
  /** The hover: where it is, and the daemon's note when it gave one. */
  hover: string;
}

const PLACE_KINDS: ReadonlySet<ChatCitationItem['kind']> = new Set(['path', 'line', 'symbol']);

/** `src/a.ts:42` → { path: 'src/a.ts', line: 42 }; `src/a.ts:charge` → { path, line: null }. */
export function parsePlace(place: string): { path: string; line: number | null } {
  const m = /^(.*?):(\d+)(?::\d+)?$/.exec(place);
  if (m !== null && m[1] !== '') return { path: m[1]!, line: Number(m[2]) };
  const sym = /^(.*\.[A-Za-z0-9]+):[A-Za-z_$][\w$.]*$/.exec(place);
  if (sym !== null) return { path: sym[1]!, line: null };
  return { path: place, line: null };
}

/** The reply's sources, in reply order, each place once. */
export function sourcesOf(c: ChatCitations | undefined): SourceRef[] {
  const out: SourceRef[] = [];
  const seen = new Set<string>();
  for (const i of c?.items ?? []) {
    if ((i.status !== 'verified' && i.status !== 'corrected') || !PLACE_KINDS.has(i.kind)) continue;
    const place = (i.status === 'corrected' && i.resolved !== undefined && i.resolved !== '' ? i.resolved : i.raw).replace(/^`|`$/g, '');
    if (place === '' || seen.has(place)) continue;
    seen.add(place);
    const { path, line } = parsePlace(place);
    const name = path.split('/').filter(Boolean).pop() ?? path;
    const where = i.status === 'corrected' ? `${place} (the reply said ${i.raw})` : place;
    out.push({
      key: place, path, line,
      label: line !== null ? `${name}:${line}` : name,
      hover: i.note !== undefined && i.note !== '' ? `${where} — ${i.note}` : where,
    });
  }
  return out;
}

/** "Based on 3 sources" — null when there are none (no chips, no line). */
export function basedOnLine(n: number): string | null {
  if (n <= 0) return null;
  return `Based on ${n} source${n === 1 ? '' : 's'}`;
}

/** The absolute path to read under a run's worktree: the path as cited, and nothing else — a
 *  guessed variant (say, dropping a leading segment) could open a different file of the same name
 *  (codex). A place the worktree does not hold says so instead. */
export function passageCandidates(path: string, workdir: string | null | undefined): string[] {
  if (typeof workdir !== 'string' || workdir === '') return [];
  const root = workdir.replace(/\/+$/, '');
  const rel = path.replace(/^\.?\/+/, '');
  if (rel.split('/').includes('..')) return [];
  return [`${root}/${rel}`];
}

export interface PassageLine { n: number; text: string; hit: boolean }

/** The lines around the cited one (all of a short file), the cited line marked. */
export function passageWindow(content: string, line: number | null, radius = 6): PassageLine[] {
  const lines = content.split('\n');
  if (line === null || line < 1 || line > lines.length) {
    return lines.slice(0, radius * 2 + 1).map((text, i) => ({ n: i + 1, text, hit: false }));
  }
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const out: PassageLine[] = [];
  for (let n = from; n <= to; n++) out.push({ n, text: lines[n - 1]!, hit: n === line });
  return out;
}
