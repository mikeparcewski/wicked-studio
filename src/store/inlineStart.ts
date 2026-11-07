import { create } from 'zustand';
import type { ChatOpenBody, ChatProposalView } from 'wicked-crew-api-types';
import { api } from '../api/client.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import type { AboutChip } from '../board/aboutChips.js';
import { cardForWorkflow } from '../board/slashCatalog.js';
import { catalogV2Now } from './catalogV2.js';
import type { CatalogEntry } from '../board/workflowCatalog.js';
import { createByChat } from '../editors/apps/appTurns.js';
import { stashDraft } from '../components/apps/AppChat.js';
import { openChat, openChatFlow } from './chatFlow.js';
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

// ── Job chips and the person-made proposal (DES-CATALOG-002 §4.6, §8.4-8.6; Lane E2) ──────────────────────────────────

/** A pick from the v2 `/` list (or a command typed whole) as the composer's JOB chip: the card, its option and depth,
 *  kept exactly. `card` is what the proposal names on the wire: the card id, or the alias that reached it. */
export function jobChipFor(pick: { card: string; wireCard?: string; option: string | null; depth: 'quick' | 'standard' | 'deep' | null; title: string; launchId: string }): AboutChip {
  pickSeq += 1;
  return {
    kind: 'workflow', key: `job:${Date.now().toString(36)}:${pickSeq}`, label: pick.title, workflowId: pick.launchId, entryId: pick.card,
    job: true, card: pick.wireCard ?? pick.card, option: pick.option, depth: pick.depth,
  };
}

/** What Enter posts for a job: the card (or alias), its option and depth, and the person's words. */
export interface JobPost {
  card: string;
  option: string | null;
  depth: 'quick' | 'standard' | 'deep' | null;
  words: string;
  source: 'pick' | 'command';
  /** The chat this composer stands in, live on the daemon; null = none yet (a seeded chat is opened). */
  chatId: string | null;
  /** For a seeded chat: where it opens (the project, the repository). */
  projectId: string | null;
  repoRef?: string | null;
  /** Kept per pick, so a retry of the same body is the same request (crew answers the same proposal). */
  pickKey: string;
}

/** The request id a pick's body was sent under: a retry of the same body reuses it, another body gets its own. */
const sent = new Map<string, { body: string; requestId: string }>();

function requestIdFor(pickKey: string, body: string): string {
  const prev = sent.get(pickKey);
  if (prev !== undefined && prev.body === body) return prev.requestId;
  const requestId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID() : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  sent.set(pickKey, { body, requestId });
  return requestId;
}

/** The scope a seeded chat opens in: the project, and the repository when one is named. */
function seedScope(projectId: string | null, repoRef: string | null | undefined): Pick<ChatOpenBody, 'projectId' | 'repoRefs'> {
  const project = projectId !== null && projectId !== '' && projectId !== 'default' ? { projectId } : {};
  return repoRef !== undefined && repoRef !== null && repoRef !== '' ? { repoRefs: [repoRef], ...project } : project;
}

/**
 * Post a job as the person's proposal, never a launch: into the live chat (`POST /chats/:id/proposals`), or, with no
 * live chat, as the seed of a new one (`POST /chats {seed}`), which then opens ({@link openChat}). Resolves to the
 * chat the proposal is in and its view. Throws with the daemon's words when it is refused.
 */
export async function postJob(p: JobPost): Promise<{ chatId: string; proposal: ChatProposalView | null }> {
  const fields = {
    card: p.card,
    ...(p.option !== null ? { option: p.option } : {}),
    ...(p.depth !== null ? { depth: p.depth } : {}),
    ...(p.words.trim() !== '' ? { words: p.words.trim() } : {}),
    source: p.source,
  };
  if (p.chatId !== null) {
    const body = JSON.stringify(['chat', p.chatId, fields]);
    const { view } = await api.proposeInChat(p.chatId, { ...fields, requestId: requestIdFor(p.pickKey, body) });
    return { chatId: p.chatId, proposal: view };
  }
  const scope = seedScope(p.projectId, p.repoRef);
  const body = JSON.stringify(['seed', fields, scope]);
  const res = await api.openChat({ seed: fields, requestId: requestIdFor(p.pickKey, body), ...scope });
  // A refused seed opened its chat but made no proposal: say why where the person is. A retry of the same body is the
  // same request, so crew answers that chat and completes its proposal (§4.6).
  if (res.proposal === undefined && res.seedRefused !== undefined) throw new Error(res.seedRefused.error);
  openChat(res.chatId);
  return { chatId: res.chatId, proposal: res.proposal ?? null };
}

/** Words a start could not post, shown on the composer it was moved to (`startInChat`'s fallback). */
export const useStartNotes = create<{ notes: Record<string, string> }>(() => ({ notes: {} }));

export function setStartNote(composerKey: string, note: string | null): void {
  useStartNotes.setState((s) => {
    const notes = { ...s.notes };
    if (note === null) delete notes[composerKey]; else notes[composerKey] = note;
    return { notes };
  });
}

/** A named job to start in a chat (Settings' "Create an editor plugin", Learn, New demo video, Draft epics…). */
export interface StartInChat {
  /** The workflow the opener names today (studio's openers keep what they pass; the card is read off the wire). */
  workflowId: string;
  words?: string;
  projectId?: string | null;
  repoRef?: string | null;
  requirements?: readonly { repoId: string; key: string; title: string }[];
}

/**
 * THE NAMED-LAUNCH BRIDGE (§8.6: `openLaunchWizard(draft)` becomes `startInChat(...)`). On a daemon that takes job
 * proposals and serves the v2 catalog: the card is resolved from the wire ({@link cardForWorkflow}), a seeded chat
 * opens with its proposal (the sentence and Start: nothing runs before Start), and chosen requirements fill the job's
 * requirements input as the person's own answer. Returns false when there is no card for it (the caller keeps today's
 * flow). A failure to post opens a new chat with the job on its composer and the reason under it, so Enter retries.
 */
export async function startInChat(s: StartInChat): Promise<boolean> {
  const projectId = s.projectId ?? null;
  const view = await catalogV2Now(projectId === UNFILED_MOUNT ? null : projectId);
  if (view === null) return false;
  const hit = cardForWorkflow(view, s.workflowId);
  if (hit === null) return false;
  const option = hit.option === null ? null : hit.card.variant?.options.find((o) => o.id === hit.option) ?? null;
  const chip = jobChipFor({
    card: hit.card.id, wireCard: hit.wireCard, option: hit.option, depth: null,
    title: option !== null ? `${hit.card.title} · ${option.title}` : hit.card.title,
    launchId: (option ?? hit.card).launch.kind === 'run' ? ((option ?? hit.card).launch as { workflow: string }).workflow : (option ?? hit.card).launch.kind,
  });
  const words = s.words ?? '';
  try {
    const out = await postJob({
      card: hit.wireCard, option: hit.option, depth: null, words, source: 'pick', chatId: null,
      projectId, repoRef: s.repoRef ?? null, pickKey: chip.key,
    });
    const reqInput = (option ?? hit.card).inputs.find((i) => i.kind === 'requirements') ?? hit.card.inputs.find((i) => i.kind === 'requirements');
    if (out.proposal !== null && reqInput !== undefined && s.requirements !== undefined && s.requirements.length > 0) {
      // The requirements the person chose on the page are their answer to the job's "which requirements?".
      await api.reviseChatProposal(out.chatId, {
        revises: out.proposal.proposal.pid,
        edits: { inputs: { [reqInput.id]: { kind: 'requirements', refs: s.requirements.map((r) => ({ repoId: r.repoId, key: r.key })) } } },
        source: 'question',
        requestId: `${chip.key}:requirements`,
      }).catch((e: unknown) => {
        setStartNote(out.chatId, `The requirements you chose were not added (${e instanceof Error ? e.message : String(e)}): pick them in the job.`);
      });
    }
  } catch (e) {
    const chatId = openChatFlow({ projectId, seedText: words });
    addAboutChip(chatId, chip);
    setStartNote(chatId, `${chip.label} could not be started (${e instanceof Error ? e.message : String(e)}). Press Enter to try again.`);
  }
  return true;
}
