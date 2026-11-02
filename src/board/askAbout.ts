import { api } from '../api/client.js';
import { artifactRefOf } from '../api/chatArtifacts-wire.js';
import { artifactChip } from './aboutChips.js';
import { composerOnScreen, focusComposer } from '../components/editorHost/composerBridge.js';
import type { ArtifactBinding } from '../editors/hostApi.js';
import { useGroupShown } from '../editors/hostApi.js';
import { inViewByKey, setAskAboutSeed } from '../store/artifactInView.js';
import { openAskDock, reopenSystemChat } from '../store/askDock.js';
import { useCapabilities } from '../store/capabilities.js';
import { addAboutChip } from '../store/composerChips.js';
import { useLiveChatsStore } from '../store/liveChats.js';

/**
 * "ASK ABOUT THIS" WORKS EVERYWHERE (DES-CHAT-ARTIFACTS-001 §6.3, slice A1). It used to focus a composer by key, and
 * Made has none, so the press did nothing. Now:
 *  1. a composer with the binding's key on screen gets the artifact chip and the focus;
 *  2. else the chat the document was made in (its draft run's `chat_id`), if that chat is still open, comes back with
 *     the artifact;
 *  3. else a new chat opens beside it, in the document's project, with the artifact chip. An Unfiled document opens a
 *     chat in no project whose repositories crew seeds from the document's binding (`POST /chats {seedFromArtifact}`).
 */

export type AskAboutRoute =
  | { to: 'composer'; composerKey: string }
  | { to: 'chat'; chatId: string }
  | { to: 'new'; projectId: string | null; seed: boolean };

/** Where an Ask about this goes (pure). */
export function askAboutRoute(input: {
  composerKey: string;
  projectId: string;
  composerOnScreen: boolean;
  /** The chat the document was made in, when its draft run says. */
  madeInChat: string | null;
  chatLive: (chatId: string) => boolean;
  /** The daemon takes `seedFromArtifact` (`capabilities.chatArtifacts.context`). */
  seedable: boolean;
}): AskAboutRoute {
  if (input.composerOnScreen) return { to: 'composer', composerKey: input.composerKey };
  if (input.madeInChat !== null && input.chatLive(input.madeInChat)) return { to: 'chat', chatId: input.madeInChat };
  const unfiled = input.projectId === '' || input.projectId === 'default';
  return { to: 'new', projectId: unfiled ? null : input.projectId, seed: unfiled && input.seedable };
}

const unfiled = (projectId: string | null | undefined): boolean => projectId === undefined || projectId === null || projectId === '' || projectId === 'default';

/** Is a chat open on the daemon? This browser's live-chat record first; a chat it has no record of (after a reload)
 *  is asked of the daemon (`GET /chats/:id`: seats while it is open). */
async function chatLiveNow(chatId: string): Promise<boolean> {
  const s = useLiveChatsStore.getState();
  if (s.retired.has(chatId)) return false;
  if (s.sessions[chatId] !== undefined) return true;
  try {
    return (await api.getChat(chatId)).seats.length > 0;
  } catch {
    return false;
  }
}

/** The open chat a document was made in: of the runs that answered it in its own mount, the newest whose chat is
 *  still open. `null` when none is (or the doc↔run index cannot be read). */
async function madeInChatOf(docId: string, projectId: string): Promise<string | null> {
  let runs;
  try {
    ({ runs } = await api.listRunsForDoc(docId));
  } catch {
    return null;
  }
  const chats = runs
    .filter((v) => {
      const s = v.session as { chat_id?: string | null; project_id?: string | null };
      return typeof s.chat_id === 'string' && s.chat_id !== '' && (unfiled(s.project_id) ? unfiled(projectId) : s.project_id === projectId);
    })
    .sort((a, b) => Number((b.session as { created_at?: number }).created_at ?? 0) - Number((a.session as { created_at?: number }).created_at ?? 0))
    .map((v) => (v.session as { chat_id: string }).chat_id);
  for (const id of [...new Set(chats)]) if (await chatLiveNow(id)) return id;
  return null;
}

/** The version this placement shows, for a chat opened after its card has gone: its own registration, else the
 *  version its group last read. */
function shownVersion(b: ArtifactBinding): number | null {
  const placed = inViewByKey(b.artifactKey);
  if (placed !== null) return placed.shown();
  const groups = useGroupShown.getState().shown;
  const own = Object.entries(groups).find(([k]) => k.endsWith(`::${b.artifactKey}`));
  return own?.[1] ?? null;
}

/** Each press supersedes the one before: a slower lookup for an earlier press changes nothing. */
let pressSeq = 0;

/** Ask about this artifact (the card's `host:ask`). */
export async function askAbout(b: ArtifactBinding): Promise<void> {
  const press = ++pressSeq;
  const ref = b.source === 'interactive-doc' ? artifactRefOf(b.projectId, b.docId) : null;
  // What is on screen at the press, before anything awaits.
  const version = shownVersion(b);
  const onScreen = composerOnScreen(b.composerKey);
  if (onScreen) {
    // An artifact crew can read rides as its chip; one it cannot (a demo video, a walkthrough) still names its subject.
    addAboutChip(b.composerKey, ref !== null ? artifactChip(ref, b.title) : { kind: 'about', key: `art:${b.artifactKey}`, label: b.title.trim() === '' ? 'this' : b.title.trim() });
    focusComposer(b.composerKey);
    return;
  }
  // Whether the daemon takes `seedFromArtifact` decides the new chat's scope: known before deciding.
  if (!useCapabilities.getState().loaded) await useCapabilities.getState().load().catch(() => undefined);
  const madeIn = ref !== null && b.docId !== undefined ? await madeInChatOf(b.docId, b.projectId) : null;
  if (press !== pressSeq) return;
  const route = askAboutRoute({
    composerKey: b.composerKey,
    projectId: b.projectId,
    composerOnScreen: false,
    madeInChat: madeIn,
    chatLive: () => madeIn !== null,
    seedable: useCapabilities.getState().chatContext,
  });
  if (route.to === 'composer') return;
  if (ref !== null && b.docId !== undefined) {
    setAskAboutSeed({
      ref,
      label: b.title.trim() === '' ? ref : b.title.trim(),
      projectId: unfiled(b.projectId) ? null : b.projectId,
      docId: b.docId,
      version,
      seed: route.to === 'new' && route.seed,
    });
  }
  if (route.to === 'chat') {
    reopenSystemChat({ id: route.chatId, title: b.title, cli: null });
    return;
  }
  openAskDock({ fresh: true, projectId: route.projectId });
}
