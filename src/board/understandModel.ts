import type { ChatTranscriptRecord } from 'wicked-crew-api-types';

/**
 * UNDERSTAND's words (the calm page, desk-pages-redesign mockup 2026-10-26). Pure.
 *
 *  - The questions asked from the page's box: remembered in this browser (id, question, when), so the
 *    page can find each answer again as a chat (`GET /chats/:id/messages`). The question shown is the
 *    operator's own words, never the grounding line sent with it.
 *  - One line of what an answer found: the first sentence of the first reply, as plain words.
 *  - Three suggested questions, about the operator's own repositories when there are some.
 */

/** One question asked from Understand. */
export interface AskedQuestion {
  /** The chat it was asked in (minted by the page). */
  chatId: string;
  /** The operator's words. */
  question: string;
  /** Unix ms. */
  at: number;
}

export const ASKED_KEY = 'studio.understand.asked';
/** At most this many are remembered; Recent answers shows the newest few. */
export const ASKED_MAX = 20;

/** What is sent with the question, on its own line: the page promises cited answers. */
export const GROUNDING_LINE = 'Answer from the code itself and cite the files you read.';

export function questionMessage(question: string): string {
  return `${question.trim()}\n\n${GROUNDING_LINE}`;
}

function isAsked(v: unknown): v is AskedQuestion {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.chatId === 'string' && o.chatId !== '' && typeof o.question === 'string' && typeof o.at === 'number' && Number.isFinite(o.at);
}

/** The remembered questions, newest first. A broken store reads as none. */
export function readAsked(storage: Pick<Storage, 'getItem'> | null = safeStorage()): AskedQuestion[] {
  try {
    const raw: unknown = JSON.parse(storage?.getItem(ASKED_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter(isAsked).sort((a, b) => b.at - a.at).slice(0, ASKED_MAX) : [];
  } catch {
    return [];
  }
}

function writeAsked(list: readonly AskedQuestion[], storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(ASKED_KEY, JSON.stringify(list.slice(0, ASKED_MAX))); } catch { /* private mode: not remembered */ }
}

/** Remember a question (newest first, one entry per chat). */
export function rememberAsked(q: AskedQuestion, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): AskedQuestion[] {
  const next = [q, ...readAsked(storage).filter((x) => x.chatId !== q.chatId)].slice(0, ASKED_MAX);
  writeAsked(next, storage);
  return next;
}

/** Forget a question whose chat the daemon no longer has. */
export function forgetAsked(chatId: string, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): AskedQuestion[] {
  const next = readAsked(storage).filter((x) => x.chatId !== chatId);
  writeAsked(next, storage);
  return next;
}

function safeStorage(): Storage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** Markdown to one plain line: no headings, emphasis, code ticks, link targets or list marks. */
export function plainLine(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, '')
    .replace(/[*_`~]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The first sentence of a text, cut to `max` characters at a word. */
export function firstSentence(text: string, max = 120): string {
  const line = plainLine(text);
  if (line === '') return '';
  const m = /^(.+?[.!?])(\s|$)/.exec(line);
  const s = m !== null ? m[1]! : line;
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[,;:]$/, '')}…`;
}

/** The file a citation names, as a short name (`crates/x/src/seat_bench.rs:40` → `seat_bench.rs`). */
function citedName(item: { kind: string; raw: string; resolved?: string }): string | null {
  if (item.kind !== 'path' && item.kind !== 'line' && item.kind !== 'symbol') return null;
  const s = (item.kind === 'symbol' ? item.raw : item.resolved ?? item.raw).replace(/^`|`$/g, '').trim();
  if (s === '') return null;
  if (item.kind === 'symbol') return s;
  const file = s.split(/[\\/]/).pop() ?? s;
  return file.replace(/:\d+(-\d+)?$/, '') || null;
}

export interface AnswerLine {
  /** The answer has come back (an ok reply). */
  answered: boolean;
  /** One line of what it found; '' before the answer. */
  summary: string;
  /** The files (or symbols) it cites, de-duplicated, at most three. */
  cites: string[];
}

/** What an answer found, from its chat's transcript. */
export function answerLine(messages: readonly ChatTranscriptRecord[]): AnswerLine {
  const reply = messages.find((m): m is Extract<ChatTranscriptRecord, { kind: 'seat' }> => m.kind === 'seat' && m.ok && m.text.trim() !== '');
  const cites: string[] = [];
  for (const m of messages) {
    if (m.kind !== 'citations') continue;
    for (const it of m.items) {
      if (it.status === 'unverified') continue;
      const n = citedName(it);
      if (n !== null && !cites.includes(n)) cites.push(n);
    }
  }
  return { answered: reply !== undefined, summary: reply === undefined ? '' : firstSentence(reply.text), cites: cites.slice(0, 3) };
}

/** Three questions worth asking, about the operator's own repositories when there are some. */
export function suggestedQuestions(repoNames: readonly string[]): string[] {
  const [a, b] = repoNames;
  if (a === undefined) {
    return ['How do the parts of my code fit together?', 'Where are the riskiest files to change?', 'What changed in my code this week?'];
  }
  // Three or more (a project's repositories): the first question names them all, so no chosen
  // repository goes unmentioned.
  if (repoNames.length > 2) {
    const all = `${repoNames.slice(0, -1).join(', ')} and ${repoNames[repoNames.length - 1]}`;
    return [`How do ${all} fit together?`, `Where is ${a} riskiest to change?`, `What changed in ${b} this week?`];
  }
  return [
    `How is ${a} put together?`,
    `Where is ${b ?? a} riskiest to change?`,
    `What changed in ${a} this week?`,
  ];
}
