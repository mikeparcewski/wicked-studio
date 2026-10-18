import type { SessionView } from '../api/types.js';
import type { SearchHit } from '../api/search.js';
import { rulePath } from '../api/decisions.js';
import { MEMORY_PATH } from '../api/memory.js';
import { deskTabPath } from '../components/desk/DeskV2.js';
import { projectDetailPath } from '../hooks/useRoute.js';
import { madeOpenAddress } from './madeMoves.js';
import { sessionPath } from './sessionModel.js';

/**
 * Where a search hit opens (the search modal, `GET /search`). Each target kind maps onto the
 * address studio already serves for that entity: a run (and a unit's transcript) its session — the
 * chat it was launched from when the daemon stamps one (`capabilities.runChatId`), else
 * `run:<id>`; a chat its session; a project its dashboard; a repo its page; a rule the Rules page
 * on that rule; a memory the Memory tab filtered to its words; a document the session that made it
 * (or the project's Made list).
 */
export function searchHitHref(hit: SearchHit, ctx: { runChatId: boolean; runs: readonly SessionView[] }): string {
  const t = hit.target;
  switch (t.kind) {
    case 'run':
    case 'unit':
      return sessionPath(ctx.runChatId && t.chat_id !== null ? t.chat_id : `run:${t.run_id}`);
    case 'chat':
      return sessionPath(t.chat_id);
    case 'project':
      return projectDetailPath(t.project_id);
    case 'repo':
      return `/repo-detail/${encodeURIComponent(t.repo_id)}`;
    case 'rule':
      return rulePath(t.rule_id);
    case 'memory':
      return deskTabPath('memory', `${MEMORY_PATH}?q=${encodeURIComponent(memoryNeedle(hit.title))}`);
    case 'doc':
      return madeOpenAddress('document', t.project_id, t.doc, ctx.runs, ctx.runChatId);
  }
}

/** The Memory page filters on a content substring: the hit's first words, without the cut mark. */
function memoryNeedle(title: string): string {
  return title.replace(/…$/u, '').slice(0, 60).trim();
}

// ── Recent searches (per viewer, this browser only) ───────────────────────────────────────────────

const RECENT_KEY = 'wk.search.recent';
const RECENT_MAX = 8;

export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const v: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

/** Remember a query that led somewhere (most recent first, no repeats). */
export function rememberSearch(q: string): string[] {
  const text = q.trim();
  if (text === '') return readRecentSearches();
  const next = [text, ...readRecentSearches().filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(0, RECENT_MAX);
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage refused: recents stay this page's */ }
  return next;
}

export function forgetRecentSearches(): void {
  try { window.localStorage.removeItem(RECENT_KEY); } catch { /* nothing to forget */ }
}
