import type { ChatArtifactContext } from '../api/chatArtifacts-wire.js';
import { CONTEXT_ANCHORS_MAX, isAnchorWid } from '../api/chatArtifacts-wire.js';

/**
 * THE ARTIFACTS ON SCREEN (DES-CHAT-ARTIFACTS-001 §5.1, slice A1). Every placed artifact card (a thread's inline card,
 * its pane, Made, full screen) registers here while it is mounted: its ref, the composer it belongs to, the version it
 * shows and how to wait for its in-flight writes. A chat message reads it at send time, so it names the artifact the
 * person is looking at and the version their last hand edit made.
 *
 * Not a render store: nothing re-renders from it, it is read when a message is sent.
 */

export type InViewSurface = 'full' | 'pane' | 'inline';

export interface InViewEntry {
  /** The placement (`ArtifactBinding.artifactKey`). */
  key: string;
  /** `<mount>/<doc>`. */
  ref: string;
  title: string;
  /** The composer this placement's chips go to (`made:<project>/<doc>` on Made, a session id in a thread). */
  composerKey: string;
  /** Where it is shown now. */
  surface: () => InViewSurface;
  /** The version it shows (its last read), `null` before the first. */
  shown: () => number | null;
  /** Wait for its writes in flight; answers the head after them. */
  flush: () => Promise<number | null>;
}

const entries = new Map<string, InViewEntry & { at: number }>();
let seq = 0;

/** Register a placement; the answer unregisters it (only if it is still this registration). */
export function registerInView(entry: InViewEntry): () => void {
  const mine = { ...entry, at: ++seq };
  entries.set(entry.key, mine);
  return () => {
    if (entries.get(entry.key) === mine) entries.delete(entry.key);
  };
}

const RANK: Record<InViewSurface, number> = { full: 3, pane: 2, inline: 1 };

function best(list: Array<InViewEntry & { at: number }>): InViewEntry | null {
  let top: (InViewEntry & { at: number }) | null = null;
  for (const e of list) {
    if (top === null || RANK[e.surface()] > RANK[top.surface()] || (RANK[e.surface()] === RANK[top.surface()] && e.at > top.at)) top = e;
  }
  return top;
}

/** The artifact a composer's message is about when no chip says: its full-screen card, else its pane, else its newest card. */
export function inViewFor(composerKey: string): InViewEntry | null {
  return best([...entries.values()].filter((e) => e.composerKey === composerKey));
}

/**
 * The artifact the floating chat sits beside: one in full screen or a pane, or one open on Made. A card that is only
 * inline in some thread is not "beside" the floating chat (its own composer carries it).
 */
export function inViewAnywhere(): InViewEntry | null {
  return best([...entries.values()].filter((e) => e.surface() !== 'inline' || e.composerKey.startsWith('made:')));
}

/** How long a send waits for an edit to land before it goes with the version on screen. */
export const FLUSH_WAIT_MS = 25_000;

/**
 * The `context.artifact` a message carries: every placement of `ref` has its writes waited for first, then the version
 * is the one the most prominent placement shows (`fallbackVersion` when none is mounted: an Ask about this whose card
 * has since closed). `null` when no version is known.
 */
export async function artifactContext(ref: string, anchors: readonly string[] = [], fallbackVersion: number | null = null, waitMs = FLUSH_WAIT_MS): Promise<ChatArtifactContext | null> {
  const placed = [...entries.values()].filter((e) => e.ref === ref);
  if (placed.length > 0) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(placed.map((e) => e.flush())),
      new Promise<void>((r) => { timer = setTimeout(r, waitMs); }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
  }
  const top = best(placed);
  const version = top?.shown() ?? fallbackVersion;
  if (version === null || !Number.isInteger(version) || version < 1) return null;
  const wids = [...new Set(anchors.filter(isAnchorWid))].slice(0, CONTEXT_ANCHORS_MAX);
  return { ref, version, ...(wids.length > 0 ? { anchors: wids } : {}) };
}

// ── "Ask about this" into a new chat (§6.3) ──────────────────────────────────────────────────────────────────────────

/** What `askAbout` hands the chat it opens: the artifact chip and, for an Unfiled document, the seed. */
export interface AskAboutSeed {
  ref: string;
  label: string;
  /** The document's project; `null` for an Unfiled document. */
  projectId: string | null;
  docId: string;
  /** The version on screen when Ask about this was pressed. */
  version: number | null;
  /** `POST /chats {seedFromArtifact}`: the chat's repositories come from the document's binding. */
  seed: boolean;
}

let pendingSeed: { seed: AskAboutSeed; at: number } | null = null;
/** A seed the chat did not open with in this long is stale (the open never happened): it is dropped. */
const SEED_FRESH_MS = 10_000;

export function setAskAboutSeed(seed: AskAboutSeed): void {
  pendingSeed = { seed, at: Date.now() };
}
/** Read without taking (a component initializer may run twice). */
export function peekAskAboutSeed(): AskAboutSeed | null {
  if (pendingSeed !== null && Date.now() - pendingSeed.at > SEED_FRESH_MS) pendingSeed = null;
  return pendingSeed?.seed ?? null;
}
export function takeAskAboutSeed(): void {
  pendingSeed = null;
}

/** Tests: forget everything. */
export function resetInView(): void {
  entries.clear();
  pendingSeed = null;
}
