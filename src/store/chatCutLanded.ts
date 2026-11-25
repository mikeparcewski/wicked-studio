/**
 * A VIDEO VERSION A CHAT MADE (crew#1814, studio#1140 option (a)). A `cut` card's Go is decided with the version the
 * video tool made; the editor showing that video hears it, plays it at once (it does not wait for its idle re-read)
 * and offers Undo. Every card that shows the decision (the dock, the full chat, another tab's re-read) notes it.
 *
 * A landing is kept until an editor of that video has dealt with it: adopted it, or found a newer head and let it go.
 * An editor that couldn't (its re-read failed, it was unmounted meanwhile) leaves it for the next note or the next
 * editor of that video to mount, within the freshness window. Each version is dealt with once (R4), and only a version
 * newer than the last one dealt with for that video.
 *
 * Not a render store: the editor card subscribes for its own video while it is mounted.
 */
export interface CutLanded { ref: string; version: number; base: number }

/** An editor's answer: `true` once it dealt with the landing (adopted, or the head moved past it), `false` to leave
 *  it for another try. */
export type CutLandedListener = (l: CutLanded) => Promise<boolean>;

/** How long an undelivered landing waits for its video's editor (crew#1814). */
export const CUT_LANDED_KEEP_MS = 10 * 60_000;

const handled = new Map<string, number>();
const pending = new Map<string, CutLanded & { at: number }>();
const inFlight = new Set<string>();
/** Videos asked for again (a note, a new editor, a host that started) while a delivery was in flight. */
const again = new Set<string>();
const listeners = new Map<string, Set<CutLandedListener>>();

function deliver(ref: string): void {
  const l = pending.get(ref);
  const fns = listeners.get(ref);
  if (l === undefined || fns === undefined || fns.size === 0) return;
  if (inFlight.has(ref)) { again.add(ref); return; }
  if (Date.now() - l.at > CUT_LANDED_KEEP_MS) { pending.delete(ref); return; }
  inFlight.add(ref);
  const landing: CutLanded = { ref: l.ref, version: l.version, base: l.base };
  void Promise.all([...fns].map((fn) => Promise.resolve().then(() => fn(landing)).catch(() => false))).then((answers) => {
    inFlight.delete(ref);
    const asked = again.delete(ref);
    if (answers.some(Boolean)) {
      if ((handled.get(ref) ?? 0) < l.version) handled.set(ref, l.version);
      if (pending.get(ref)?.version === l.version) pending.delete(ref);
    }
    // A newer landing, or a new editor / note / host start while this one was in flight, is tried once more now.
    const next = pending.get(ref);
    if (next !== undefined && (next.version !== l.version || asked)) deliver(ref);
  });
}

/** A cut card's Go made `version` of `ref` from `base`. Its editor deals with it once. */
export function noteCutLanded(l: CutLanded): void {
  if ((handled.get(l.ref) ?? 0) >= l.version) return;
  const cur = pending.get(l.ref);
  if (cur === undefined || cur.version < l.version) pending.set(l.ref, { ...l, at: Date.now() });
  deliver(l.ref);
}

/** The editor card of `ref` hears each version a chat makes of it while it is mounted, and one still waiting. */
export function onCutLanded(ref: string, fn: CutLandedListener): () => void {
  const set = listeners.get(ref) ?? new Set();
  set.add(fn);
  listeners.set(ref, set);
  deliver(ref);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(ref);
  };
}

/** Offer a waiting landing to the editors of `ref` again (an editor's host just started). */
export function retryCutLanded(ref: string): void {
  deliver(ref);
}

/** Tests only. */
export function resetCutLanded(): void {
  handled.clear();
  pending.clear();
  inFlight.clear();
  again.clear();
  listeners.clear();
}
