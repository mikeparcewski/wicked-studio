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

/** Health and attention prose is safe even when full technical paths are enabled elsewhere. */
export function healthText(text: string): string {
  // A technical disclosure may contain JSON with escaped Windows separators.
  return displayText(text.replace(/\\\\/g, '\\'))
    .replace(/[0-9a-f]{32,}/gi, (id) => `${id.slice(0, 8)}…`)
    .replace(/\bclis\b/gi, 'helpers').replace(/\bcli\b/gi, 'helper')
    .replace(/\bagents\b/gi, 'helpers').replace(/\bagent\b/gi, 'helper')
    .replace(/\bseats\b/gi, 'helpers').replace(/\bseat\b/gi, 'helper')
    .replace(/\bcredentials?\b/gi, 'sign-in information')
    .replace(/\bbroker\b/gi, 'helper service')
    .replace(/\bsigned_out\b/g, 'not signed in')
    .replace(/\bsnapshot\b/gi, 'system check').replace(/\bvenv\b/g, 'Python environment');
}
