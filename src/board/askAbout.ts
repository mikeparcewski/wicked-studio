import { api } from '../api/client.js';
import { artifactRefOf } from '../api/chatArtifacts-wire.js';
import { artifactChip } from './aboutChips.js';
import { composerOnScreen, focusComposer } from '../components/editorHost/composerBridge.js';
import type { ArtifactBinding } from '../editors/hostApi.js';
import { useGroupShown } from '../editors/hostApi.js';
import { inViewFor, setAskAboutSeed } from '../store/artifactInView.js';
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

/** The chat a document's run was launched from, read from crew's doc↔run index; `null` when none says. */
async function madeInChatOf(docId: string, projectId: string): Promise<string | null> {
  try {
    const { runs } = await api.listRunsForDoc(docId);
    const mount = projectId === '' || projectId === 'default' ? null : projectId;
    const hit = runs.find((v) => {
      const s = v.session as { chat_id?: string | null; project_id?: string | null };
      return typeof s.chat_id === 'string' && s.chat_id !== '' && (s.project_id ?? null) === mount;
    });
    return hit === undefined ? null : ((hit.session as { chat_id?: string }).chat_id ?? null);
  } catch {
    return null;
  }
}

function chatLive(chatId: string): boolean {
  const s = useLiveChatsStore.getState();
  return s.sessions[chatId] !== undefined && !s.retired.has(chatId);
}

/** The version this placement shows, for a chat opened after its card has gone. */
function shownVersion(b: ArtifactBinding): number | null {
  const placed = inViewFor(b.composerKey);
  if (placed !== null && placed.key === b.artifactKey) return placed.shown();
  const groups = useGroupShown.getState().shown;
  const own = Object.entries(groups).find(([k]) => k.endsWith(`::${b.artifactKey}`));
  return own?.[1] ?? null;
}

/** Ask about this artifact (the card's `host:ask`). */
export async function askAbout(b: ArtifactBinding): Promise<void> {
  const ref = b.source === 'interactive-doc' ? artifactRefOf(b.projectId, b.docId) : null;
  const onScreen = composerOnScreen(b.composerKey);
  // A part-less artifact (a demo video, a walkthrough) has no ref crew can read: the chip still says what it is about.
  const chip = artifactChip(ref ?? b.artifactKey, b.title);
  const madeIn = !onScreen && ref !== null && b.docId !== undefined ? await madeInChatOf(b.docId, b.projectId) : null;
  const route = askAboutRoute({
    composerKey: b.composerKey,
    projectId: b.projectId,
    composerOnScreen: onScreen,
    madeInChat: madeIn,
    chatLive,
    seedable: useCapabilities.getState().chatContext,
  });
  if (route.to === 'composer') {
    if (ref !== null) addAboutChip(route.composerKey, chip);
    focusComposer(route.composerKey);
    return;
  }
  if (ref !== null && b.docId !== undefined) {
    setAskAboutSeed({
      ref,
      label: chip.label,
      projectId: route.to === 'new' ? route.projectId : b.projectId === '' || b.projectId === 'default' ? null : b.projectId,
      docId: b.docId,
      version: shownVersion(b),
      seed: route.to === 'new' && route.seed,
    });
  }
  if (route.to === 'chat') {
    reopenSystemChat({ id: route.chatId, title: b.title, cli: null });
    return;
  }
  openAskDock({ fresh: true, projectId: route.projectId });
}
