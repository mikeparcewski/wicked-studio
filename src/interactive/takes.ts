import type { VersionManifest } from '../api/interactive.js';
import type { DocMsg, GenState } from '../store/docThread.js';

/**
 * TAKES, NOT VERSIONS (Wave C, idea 12). When a document has produced more than one candidate,
 * the compare split already puts two of them side by side. This model names them as TAKES — the
 * left pane is take 1, the right pane take 2 — and gives each its next move, consequence first:
 *
 *  - PICK a take: it becomes the working version (the bridge's own fork when it is not already
 *    the head — the other take stays in the manifest untouched), and the pick is filed as a
 *    preference MEMORY PROPOSAL ("prefers takes like X") through crew's `POST /proposals`, so it
 *    lands in the review queue and nothing is learned until the person accepts it.
 *  - REMIX: a steer to the document agent — "build on take 2, keep take 1's <x>" — sent on the
 *    doc thread's own inject wire, forking first when the take built on is not the head.
 *
 * Only real candidates are takes: two versions from the document's own manifest. Nothing is
 * synthesized, and a one-version document has no takes (compare is disabled there).
 */

export type TakeNo = 1 | 2;

export interface Take {
  n: TakeNo;
  version: number;
  /** The ask that produced this version, when this session knows it (the thread's tagged user
   *  message); null otherwise — never guessed. */
  ask: string | null;
}

/** The longest ask quoted into a preference: the queue row stays one readable line. */
export const ASK_QUOTE_MAX = 140;

function quoteAsk(ask: string): string {
  const flat = ask.replace(/\s+/g, ' ').trim();
  return flat.length > ASK_QUOTE_MAX ? `${flat.slice(0, ASK_QUOTE_MAX - 1)}…` : flat;
}

/** version → the text of the user message that produced it, from one thread's transcript. */
export function asksByVersion(msgs: readonly DocMsg[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const m of msgs) {
    if (m.kind === 'user' && m.version !== undefined && m.text.trim() !== '') map.set(m.version, m.text);
  }
  return map;
}

/** The two takes of a compare split: left pane (the routed version) is take 1, right is take 2. */
export function takesOf(left: number, right: number, asks: Map<number, string>): [Take, Take] {
  return [
    { n: 1, version: left, ask: asks.get(left) ?? null },
    { n: 2, version: right, ask: asks.get(right) ?? null },
  ];
}

/** The other take of the pair. */
export function otherTake(takes: readonly [Take, Take], n: TakeNo): Take {
  return n === 1 ? takes[1] : takes[0];
}

/** Where the pick was made — rides the proposal payload as `source`. */
export function takeSource(docId: string, version: number): string {
  return `doc:${docId}@v${version}`;
}

/** The preference the pick files, in words the review queue shows as-is. */
export function preferenceContent(docId: string, picked: Take, other: Take): string {
  const base = `Prefers takes like v${picked.version} of “${docId}” (picked over v${other.version})`;
  return picked.ask === null ? `${base}.` : `${base}: the take made from “${quoteAsk(picked.ask)}”.`;
}

/** Whether picking this take forks: only a take that is not already the head does. */
export function pickForks(manifest: VersionManifest, picked: Take): boolean {
  return picked.version !== manifest.head;
}

/** What confirming a pick will do — shown BEFORE anything is sent. */
export function pickConsequence(manifest: VersionManifest, picked: Take, other: Take): string {
  const working = pickForks(manifest, picked)
    ? `v${picked.version} becomes the latest version (a fork of it; v${other.version} stays in the history)`
    : `v${picked.version} is already the latest version, so it stays the working one`;
  return `${working}, and “prefers takes like v${picked.version}” is filed for your review on Proposals — nothing is learned until you accept it.`;
}

/** The remix steer, verbatim — what the document agent receives. */
export function remixSteer(buildOn: Take, keepFrom: Take, keep: string): string {
  return `Build on take ${buildOn.n} (v${buildOn.version}), and keep take ${keepFrom.n}'s (v${keepFrom.version}) ${keep.replace(/\s+/g, ' ').trim()}.`;
}

/** Why a remix cannot be sent right now, or null when it can. */
export function remixBlockedReason(state: GenState, keep: string): string | null {
  if (state === 'gated') return 'The document agent is waiting on a question in the thread — answer it first.';
  if (state === 'idle') return 'Open a document first.';
  if (keep.trim() === '') return 'Name what to keep from the other take.';
  return null;
}
