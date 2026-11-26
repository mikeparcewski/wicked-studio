import { create } from 'zustand';
import type { ChatOpenBody, ChatProposalView } from 'wicked-crew-api-types';
import { api } from '../api/client.js';
import { ApiError } from '../api/errors.js';
import { UNFILED_MOUNT } from '../api/interactive.js';
import type { AboutChip } from '../board/aboutChips.js';
import { cardForWorkflow, refusalOf } from '../board/slashCatalog.js';
import { catalogV2Now } from './catalogV2.js';
import { projectsForRepo, repoNamedInWords } from './repoProjects.js';
import type { CatalogEntry } from '../board/workflowCatalog.js';
import { createByChat } from '../editors/apps/appTurns.js';
import { stashDraft } from '../components/apps/AppChat.js';
import { openChat, openChatFlow, useChatFlow } from './chatFlow.js';
import { addAboutChip } from './composerChips.js';
import { defaultSelection } from '../board/chatOpen.js';
import { userSeats } from '../board/seatNames.js';
import { chosenSeats, NO_SEAT_PICKED, useComposerSeats } from './composerSeats.js';
import { getCachedRoster, setCachedRoster } from './rosterCache.js';

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
  /** The person's own words, when `words` carries more (studio#1399's REST line): the repository they name is read from
   *  these, never from text studio added. Absent = `words`. */
  repoWords?: string;
  source: 'pick' | 'command';
  /** The chat this composer stands in, live on the daemon; null = none yet (a seeded chat is opened). */
  chatId: string | null;
  /** For a seeded chat: where it opens (the project, the repository). */
  projectId: string | null;
  repoRef?: string | null;
  /** A named helper leads the seeded chat, ahead of the other chosen seats. */
  lead?: string;
  /** Kept per pick, so a retry of the same body is the same request (crew answers the same proposal). */
  pickKey: string;
  /** The job takes a repository: a seed with none takes the one its words clearly name (F41), filed in the project
   *  that solely holds it when the box names no project. */
  repoFromWords?: boolean;
  /** Whether the person still wants this one (a later opener supersedes it): checked before the post and before the
   *  chat it made is opened. */
  stillWanted?: () => boolean;
}

/** The request id a pick's body was sent under: a retry of the same body reuses it, another body gets its own. Spent
 *  once the post is answered (codex r1: the next identical job is a new request). */
interface SentJob { body: string; requestId: string }
const sent = new Map<string, SentJob>();

function requestFor(pickKey: string, body: string): SentJob {
  const prev = sent.get(pickKey);
  const requestId = prev?.body === body ? prev.requestId
    : typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID() : `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  // Identical retries share the wire id; only the latest attempt may retire it.
  const mine = { body, requestId };
  sent.set(pickKey, mine);
  return mine;
}

/** What the person reads when the chat an earlier try opened was deleted (crew's 410 `chat_gone`). */
export const CHAT_GONE = 'the chat an earlier try opened has been deleted; the next try opens a new chat';

function isChatGone(e: unknown): boolean {
  if (!(e instanceof ApiError) || e.status !== 410) return false;
  const body = e.body;
  return typeof body === 'object' && body !== null && (body as { code?: unknown }).code === 'chat_gone';
}

/** A named opener's own envelope, kept with its job chip until the job is posted: where it opens (the project, the
 *  repository) and the requirements the person chose (codex r1: a retry after a failed seed keeps all of it). */
interface Envelope {
  projectId: string | null;
  repoRef: string | null;
  requirements: { inputId: string; refs: Array<{ repoId: string; key: string }> } | null;
}
const envelopes = new Map<string, Envelope>();
/** The repository a request's words named, as first read, kept until the request is answered (F41). */
const prepicked = new Map<string, { words: string; named: Awaited<ReturnType<typeof repoNamedInWords>> }>();

/** The scope a seeded chat opens in: the project, and the repository when one is named. */
function seedScope(projectId: string | null, repoRef: string | null | undefined): Pick<ChatOpenBody, 'projectId' | 'repoRefs'> {
  const project = projectId !== null && projectId !== '' && projectId !== 'default' && projectId !== UNFILED_MOUNT ? { projectId } : {};
  return repoRef !== undefined && repoRef !== null && repoRef !== '' ? { repoRefs: [repoRef], ...project } : project;
}

/**
 * Post a job as the person's proposal, never a launch: into the live chat (`POST /chats/:id/proposals`), or, with no
 * live chat, as the seed of a new one (`POST /chats {seed}`), which then opens ({@link openChat}). Resolves to the
 * chat the proposal is in and its view (null when the person no longer wants it). Throws with the daemon's words when
 * it is refused.
 */
export async function postJob(p: JobPost): Promise<{ chatId: string; proposal: ChatProposalView | null } | null> {
  // Where the person is now owns the screen: a job posted before they moved (another New job, another chat opened from
  // the rail or by Back) never navigates over it (codex r2-r3), whatever started it.
  const here = placeToken();
  const wanted = (): boolean => (p.stillWanted?.() ?? true) && placeToken() === here;
  if (!wanted()) return null;
  const env = envelopes.get(p.pickKey);
  const fields = {
    card: p.card,
    ...(p.option !== null ? { option: p.option } : {}),
    ...(p.depth !== null ? { depth: p.depth } : {}),
    ...(p.words.trim() !== '' ? { words: p.words.trim() } : {}),
    source: p.source,
  };
  let mine: SentJob;
  let seedClis: string[] | null = null;
  let out: { chatId: string; proposal: ChatProposalView | null };
  if (p.chatId !== null) {
    const body = JSON.stringify(['chat', p.chatId, fields]);
    mine = requestFor(p.pickKey, body);
    const { view } = await api.proposeInChat(p.chatId, { ...fields, requestId: mine.requestId });
    out = { chatId: p.chatId, proposal: view };
  } else {
    let projectId = p.projectId;
    let repoRef = p.repoRef ?? null;
    if (env === undefined && (repoRef === null || repoRef === '') && p.repoFromWords === true) {
      // F41: `/analyze domain Map the domain of rg1-api …` from a new chat: the chat opens on rg1-api, so crew's job has
      // its repository (a revision cannot add one outside the chat's scope). None or several named: the passage asks.
      // Read once per request: a retry sends the same scope under the same request id (codex r7), so a seed crew took
      // whose answer was lost is recovered, never doubled.
      // Kept for these words only: an edited request reads its own words again (codex r8).
      const kept = prepicked.get(p.pickKey);
      const own = p.repoWords ?? p.words;
      let named = kept !== undefined && kept.words === own ? kept.named : undefined;
      if (named === undefined) {
        named = await repoNamedInWords(own);
        if (!wanted()) return null;
        prepicked.set(p.pickKey, { words: own, named });
      }
      if (named !== null) {
        repoRef = named.repo.id;
        if (projectId === null || projectId === '' || projectId === UNFILED_MOUNT) projectId = named.projectId;
      }
    }
    const scope = env !== undefined ? seedScope(env.projectId, env.repoRef) : seedScope(projectId, repoRef);
    let roster = getCachedRoster();
    if (roster === null) {
      const fetched = await api.getRoster();
      setCachedRoster(fetched.roster);
      roster = fetched.roster;
    }
    if (!wanted()) return null;
    const addressable = new Set(userSeats(roster).map((s) => s.key));
    const eligible = defaultSelection(roster, scope.projectId !== undefined || (scope.repoRefs?.length ?? 0) > 0).filter((k) => addressable.has(k));
    const { dropped, picked } = useComposerSeats.getState();
    const chosen = chosenSeats(eligible, dropped, picked);
    if (chosen.length === 0) throw new Error(NO_SEAT_PICKED);
    const clis = p.lead !== undefined && chosen.includes(p.lead) ? [p.lead, ...chosen.filter((k) => k !== p.lead)] : chosen;
    seedClis = clis;
    const body = JSON.stringify(['seed', fields, scope, clis]);
    const seedReq = requestFor(p.pickKey, body);
    mine = seedReq;
    const res = await api.openChat({ seed: fields, clis, requestId: seedReq.requestId, ...scope }).catch((e: unknown) => {
      // studio#1282: crew answers 410 `chat_gone` when the chat this request opened was deleted since. That request id
      // is spent (every retry would get 410 again): it is dropped, so the next try is a new request and a new chat.
      if (isChatGone(e)) {
        // By wire id, not by attempt: an overlapping retry of the same body shares this id and is spent with it; a
        // newer, different request for the pick is kept (codex r1).
        if (sent.get(p.pickKey)?.requestId === seedReq.requestId) {
          sent.delete(p.pickKey);
          prepicked.delete(p.pickKey);
        }
        throw new Error(CHAT_GONE);
      }
      throw e;
    });
    // A refused seed opened its chat but made no proposal: say why where the person is. A retry of the same body is the
    // same request, so crew answers that chat and completes its proposal (§4.6).
    if (res.proposal === undefined && res.seedRefused !== undefined) throw new Error(res.seedRefused.error);
    out = { chatId: res.chatId, proposal: res.proposal ?? null };
    // The chat and its job stand; only its filing in the project failed: said on that chat (codex r2).
    if (typeof res.projectAttachError === 'string' && res.projectAttachError !== '') {
      addStartNote(res.chatId, `This chat was not filed in the project (${res.projectAttachError}). Its job is here; file the chat from its menu.`);
    }
  }
  if (sent.get(p.pickKey) === mine) {
    sent.delete(p.pickKey);
    prepicked.delete(p.pickKey);
  }
  const req = env?.requirements;
  const removeSeats = seedClis === null ? [] : (out.proposal?.proposal.seats?.keys ?? []).filter((key) => !seedClis.includes(key));
  if (out.proposal !== null && (req != null || removeSeats.length > 0)) {
    // Keep the page's requirements and helper choices in one revision of the seed proposal.
    await api.reviseChatProposal(out.chatId, {
      revises: out.proposal.proposal.pid,
      edits: {
        ...(req != null ? { inputs: { [req.inputId]: { kind: 'requirements' as const, refs: req.refs } } } : {}),
        ...(removeSeats.length > 0 ? { removeSeats } : {}),
      },
      source: 'question',
      requestId: `${p.pickKey}:choices`,
    }).catch((e: unknown) => {
      const error = e instanceof Error ? e.message : String(e);
      const note = req != null && removeSeats.length > 0
        ? `Your requirements and helper choices were not applied (${error}): set them in the job.`
        : removeSeats.length > 0
          ? `The helpers you turned off were not taken off this job (${error}): change them in the job.`
          : `The requirements you chose were not added (${error}): pick them in the job.`;
      addStartNote(out.chatId, note);
    });
  }
  envelopes.delete(p.pickKey);
  // A chat made for a job the person has since left is not opened over where they are now.
  if (p.chatId === null && wanted()) openChat(out.chatId);
  return out;
}

/** Where the person is: the last chat-flow open and the page's path. Either changes when they go somewhere else. */
export function placeToken(): string {
  const path = typeof window === 'undefined' ? '' : window.location.pathname;
  return `${useChatFlow.getState().request?.nonce ?? 0}\u0000${path}`;
}

/** Words a start could not post, shown on the composer it was moved to (`startInChat`'s fallback). */
export const useStartNotes = create<{ notes: Record<string, string> }>(() => ({ notes: {} }));

/** (studio#1472) The question a job waiting on a composer asks first (`StartInChat.askWords`), by composer key: the job
 *  line and the box say it, so the person's first words are the job's, not a question to crew. */
export const useJobAsks = create<{ asks: Record<string, string> }>(() => ({ asks: {} }));

/** Add a line to a composer's note (two things can go wrong on one start: both are said; codex r3). */
export function addStartNote(composerKey: string, note: string): void {
  const prev = useStartNotes.getState().notes[composerKey];
  setStartNote(composerKey, prev === undefined ? note : `${prev} ${note}`);
}

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
  /** (studio#1472) The question the job's words answer, asked BEFORE anything is posted: with no words yet, the job waits
   *  on a new chat's composer (its chip, its envelope) under this question, so the person's first Enter posts it with
   *  their words. Without it, a named job is posted at once (the card asks for what it lacks). */
  askWords?: string;
}

/**
 * THE NAMED-LAUNCH BRIDGE (§8.6: `openLaunchWizard(draft)` becomes `startInChat(...)`). On a daemon that takes job
 * proposals and serves the v2 catalog: the card is resolved from the wire ({@link cardForWorkflow}), a seeded chat
 * opens with its proposal (the sentence and Start: nothing runs before Start), and chosen requirements fill the job's
 * requirements input as the person's own answer. Returns false when the catalog has no card for it (the caller keeps
 * today's flow). A failure (the catalog unread, the post refused) opens a new chat that says why, with the job on its
 * composer when it was resolved, so Enter retries the same request. `stillWanted` = false: a later opener replaced it,
 * and it does nothing more.
 */
export async function startInChat(s: StartInChat, stillOpen: () => boolean = () => true): Promise<boolean> {
  // One rule for the opener's whole life, taken at its press: a later opener, or the person going elsewhere while the
  // catalog is read or the seed is out, makes every later step (post, refusal, fallback, navigation) do nothing (codex r3).
  const here = placeToken();
  const stillWanted = (): boolean => stillOpen() && placeToken() === here;
  // An opener that names only the repository (the Requirements page's "Generate it") files the job in the project that
  // holds it, when exactly one does (F39); with none or several, the job passage asks which, with chips.
  let projectId = s.projectId ?? null;
  if (projectId === null && s.repoRef != null && s.repoRef !== '') {
    try {
      const { holding, certain } = await projectsForRepo(s.repoRef);
      // Only a certain, single owner is chosen for the person; an unread membership leaves it to them (codex r4).
      if (certain && holding.length === 1) projectId = holding[0]!.id;
    } catch { /* the projects could not be read: the passage asks */ }
    if (!stillWanted()) return true;
  }
  const load = await catalogV2Now(projectId === UNFILED_MOUNT ? null : projectId);
  if (!stillWanted()) return true;
  const words = s.words ?? '';
  if (load.state !== 'ready') {
    const chatId = openChatFlow({ projectId, seedText: words });
    setStartNote(chatId, 'This daemon’s list of jobs could not be read, so nothing was started. Type / to pick the job.');
    return true;
  }
  const hit = cardForWorkflow(load.view, s.workflowId);
  if (hit === null) return false;
  const option = hit.option === null ? null : hit.card.variant?.options.find((o) => o.id === hit.option) ?? null;
  // The `/` list's rule holds here too (codex r2): a job that cannot start here, or takes an input this studio does not
  // know, is never posted; the person is told why, and nothing falls back to a launch.
  const refused = refusalOf(hit.card, option);
  if (refused !== null) {
    const chatId = openChatFlow({ projectId, seedText: words });
    setStartNote(chatId, refused);
    return true;
  }
  const resolved = option ?? hit.card;
  const chip = jobChipFor({
    card: hit.card.id, wireCard: hit.wireCard, option: hit.option, depth: null,
    title: option !== null ? `${hit.card.title} · ${option.title}` : hit.card.title,
    launchId: resolved.launch.kind === 'run' ? resolved.launch.workflow : resolved.launch.kind,
  });
  const reqInput = resolved.inputs.find((i) => i.kind === 'requirements') ?? hit.card.inputs.find((i) => i.kind === 'requirements');
  envelopes.set(chip.key, {
    projectId,
    repoRef: s.repoRef ?? null,
    requirements: reqInput !== undefined && s.requirements !== undefined && s.requirements.length > 0
      ? { inputId: reqInput.id, refs: s.requirements.map((r) => ({ repoId: r.repoId, key: r.key })) } : null,
  });
  // studio#1472: the words come first. A card posted with none is answered as a question when the person then types
  // the scope, so the job waits on the composer until they say it.
  if (s.askWords !== undefined && words.trim() === '') {
    const chatId = openChatFlow({ projectId });
    useJobAsks.setState((st) => ({ asks: { ...st.asks, [chatId]: s.askWords! } }));
    addAboutChip(chatId, chip);
    return true;
  }
  try {
    await postJob({ card: hit.wireCard, option: hit.option, depth: null, words, source: 'pick', chatId: null, projectId, repoRef: s.repoRef ?? null, pickKey: chip.key, stillWanted });
  } catch (e) {
    if (!stillWanted()) return true;
    // The job waits on a new chat's composer, with its envelope and request kept: Enter there retries the same request.
    const chatId = openChatFlow({ projectId, seedText: words });
    addAboutChip(chatId, chip);
    setStartNote(chatId, `${chip.label} could not be started (${e instanceof Error ? e.message : String(e)}). Press Enter to try again.`);
  }
  return true;
}
