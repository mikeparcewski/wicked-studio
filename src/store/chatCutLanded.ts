/**
 * A VIDEO VERSION A CHAT MADE (crew#1814, studio#1140 option (a)). A `cut` card's Go is decided with the version the
 * video tool made; the editor showing that video hears it once, plays it at once (it does not wait for its idle
 * re-read) and offers Undo. Every card that shows the decision (the dock, the full chat, another tab's re-read) notes
 * it; each version is told once (R4), and only newer than the last one told for that video.
 *
 * Not a render store: the editor card subscribes for its own video while it is mounted.
 */
export interface CutLanded { ref: string; version: number; base: number }

const told = new Map<string, number>();
const listeners = new Map<string, Set<(l: CutLanded) => void>>();

/** A cut card's Go made `version` of `ref` from `base`. Told to that video's editor once. */
export function noteCutLanded(l: CutLanded): void {
  if ((told.get(l.ref) ?? 0) >= l.version) return;
  told.set(l.ref, l.version);
  for (const fn of listeners.get(l.ref) ?? []) fn(l);
}

/** The editor card of `ref` hears each version a chat makes of it while it is mounted. */
export function onCutLanded(ref: string, fn: (l: CutLanded) => void): () => void {
  const set = listeners.get(ref) ?? new Set();
  set.add(fn);
  listeners.set(ref, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(ref);
  };
}

/** Tests only. */
export function resetCutLanded(): void {
  told.clear();
  listeners.clear();
}
