import { displayText } from './homePath.js';
import type { SystemAttention } from '../api/system.js';

/**
 * THE ROW HEADLINE: what a needs-you or slowing-work row says as its title, for one of crew's attention items.
 * When the item is a gate whose run this page can read, the title is the gate's plain cause — the decision dock's
 * own headline ("GitHub Copilot CLI can review this instead", `board/gateHeadline.ts`, via `useRowHeadlines`) — and
 * the job's title moves to the row's line. Otherwise it is the item's title, crew's own words, with crew's reason
 * on the line. Every row that names an attention item (Needs you, the project home's Needs you, Nerve Center's
 * Slowing work now) reads it here.
 */
export function rowHeadline(item: SystemAttention, cause: string | null = null): string {
  return healthText(cause ?? item.text);
}

/** The row's first muted words: the job's title under a cause headline, else crew's reason. */
export function rowLead(item: SystemAttention, cause: string | null = null): string | null {
  const text = cause !== null && cause !== item.text ? item.text : item.reason;
  return text === null ? null : healthText(text);
}

/**
 * Health and attention prose, as crew wrote it, made safe to show (first-run, 2026-11-08): no home folder (`~/…`, also
 * JSON-escaped Windows paths) and no 32+ character hex id (its first 8 characters + "…"). Crew's words are its own:
 * the plain causes are crew's to write (lane fr-crew), so no wording is rewritten here.
 */
export function healthText(text: string): string {
  return displayText(text.replace(/\\\\/g, '\\'))
    .replace(/[0-9a-f]{32,}/gi, (id) => `${id.slice(0, 8)}…`);
}
