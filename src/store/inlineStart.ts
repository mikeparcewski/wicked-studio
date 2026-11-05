import type { AboutChip } from '../board/aboutChips.js';
import type { CatalogEntry } from '../board/workflowCatalog.js';
import { createByChat } from '../editors/apps/appTurns.js';
import { stashDraft } from '../components/apps/AppChat.js';
import { openChatFlow } from './chatFlow.js';
import { addAboutChip } from './composerChips.js';

/**
 * A WORKFLOW STARTS IN THE CHAT (ux-tonight, operator 2026-11-04: "clicking on a workflow opens a modal rather than
 * starting an inline chat, needs to be removed and chat done inline"; DES-CATALOG-002 rev 4 §0: "one click on a card
 * starts it in the chat"). A `/` pick, or a card picked from New job's catalog, puts the card on a chat's composer as
 * the work its next Enter starts. The composer asks there for what it still needs (the words, a repository, a
 * project) and launches into its chat, where the plan, gates and progress follow (`RunBlock`). Nothing starts on the
 * pick itself.
 */

let pickSeq = 0;

/** The composer chip that names the work (one at a time: a second pick replaces it). Each pick has its own key, so a
 *  start still in flight knows whether ITS pick is the one on the composer (codex r2: a re-pick is another start). */
export function workflowChipFor(e: Pick<CatalogEntry, 'id' | 'title' | 'launchId'>): AboutChip {
  pickSeq += 1;
  return { kind: 'workflow', key: `wf:${Date.now().toString(36)}:${pickSeq}`, label: e.title, workflowId: e.launchId, entryId: e.id };
}

/** From a surface with no chat in view (New job opened from the Desk or ⌘K): a new chat on its own page, with the
 *  card on its composer and the words waiting in it. Returns the chat's id. */
export function startInNewChat(e: Pick<CatalogEntry, 'id' | 'title' | 'launchId'>, opts: { projectId: string | null; intent: string }): string {
  const chatId = openChatFlow({ projectId: opts.projectId, seedText: opts.intent });
  addAboutChip(chatId, workflowChipFor(e));
  return chatId;
}

/**
 * A new app by chat, as the Apps page's "Make a new app" does (DES-APPS-001 §6.2): crew adds the app and the words are
 * its first turn; the app's page opens on that turn. An app made whose first message was not sent keeps the words in
 * that app's own chat (never a second app). Returns where to go, or why nothing was made.
 */
export async function startAppByChat(words: string, projectId: string): Promise<{ path: string } | { error: string }> {
  const r = await createByChat(words, projectId);
  const path = (slug: string): string => `/apps/${encodeURIComponent(slug)}`;
  if (r.ok) return { path: path(r.slug) };
  if (r.slug !== undefined) {
    stashDraft(r.slug, words);
    return { path: path(r.slug) };
  }
  return { error: `No app was made (${r.code}): ${r.message}` };
}
