// Learn-a-theme and sources attach (DES-MERGE-001 §4.6, §4.9, §6.4 slice 16).
//
// Both are non-text inputs, so both are MESSAGES (§2.3): a theme learned from a website
// and a folder attached as reference are two of the clearest cases of a change whose
// reason is unreconstructable if it never reached the transcript.
//
// Two guarantees this module keeps, and both of them are ABSENCES:
//
//   1. NOTHING UPLOADS (§4.6, §4.9). A PDF, an image and a reference folder are all
//      submitted as a PATH the service reads in place. There is no `FormData`, no `File`
//      and no `Blob` in this file and no file input behind it — which is what makes
//      "it uses your actual numbers" a property rather than a promise.
//   2. THE SPA NEVER FETCHES THE TARGET. A learn-from-URL submission goes to the bridge
//      proxy and only there. The SSRF guard stays server-side and untouched (§4.6: http(s)
//      only, reject metadata/loopback/link-local/private/ULA/CGNAT, resolve every address
//      for the host and pin the validated one) — re-implementing any of it here would be a
//      second, weaker guard that drifts from the real one. So when the service refuses,
//      the client's whole job is to show the service's OWN reason, verbatim.

import {
  attachSource, learnTheme, ServiceHintError,
  type LearnKind, type LearnThemeBody, type SourceEntry,
} from '../api/interactive.js';
import { nextMsgId, threadKey, useDocThreadStore } from '../store/docThread.js';

/** Offered in §4.6's own order: the live URL first, then the two local kinds. */
export const LEARN_KINDS: readonly LearnKind[] = ['url', 'pdf', 'image'];

/** What the user is being asked for, per kind — the input's label and its placeholder. */
export const LEARN_LABEL: Record<LearnKind, { noun: string; placeholder: string }> = {
  url:   { noun: 'website',    placeholder: 'https://example.com' },
  pdf:   { noun: 'PDF file',   placeholder: '/path/to/brand-guide.pdf' },
  image: { noun: 'image file', placeholder: '/path/to/screenshot.png' },
};

/**
 * The submission, per kind: a URL travels as `url`, a local file as `path` — never as
 * bytes. The shapes differ because the SERVICE does different things with them (headless
 * capture vs. reading the file in place), so the client says which it means rather than
 * making the bridge guess from the string.
 */
export function learnBody(kind: LearnKind, value: string): LearnThemeBody {
  const trimmed = value.trim();
  return kind === 'url' ? { kind, url: trimmed } : { kind, path: trimmed };
}

/**
 * Submittable. Deliberately SHALLOW for URLs: `http(s)://` + a host is the shape check,
 * and nothing more — deciding whether an address is allowed is the server-side guard's
 * job, and a client that pre-rejects `169.254.169.254` would be answering with its own
 * opinion instead of the guard's stated reason (§4.6).
 */
export function learnReady(kind: LearnKind, value: string): boolean {
  const trimmed = value.trim();
  return kind === 'url' ? /^https?:\/\/\S+/i.test(trimmed) : trimmed !== '';
}

/** The ask, as the message it is (§2.3). */
export function learnAsk(kind: LearnKind, value: string): string {
  return kind === 'url'
    ? `Learn a theme from ${value.trim()}.`
    : `Learn a theme from the ${kind === 'pdf' ? 'PDF' : 'image'} at ${value.trim()}.`;
}

/**
 * §3.3 informative: the subject is WHAT is being learned from, and what is happening to
 * it. The local kinds also say the thing the UI is required to say (§4.6: "nothing
 * uploads — preserve that guarantee and say so in the UI").
 */
export function learnSubject(kind: LearnKind, value: string): string {
  const target = value.trim();
  return kind === 'url'
    ? `Learning a theme from ${target} — the service opens it in a headless browser and `
      + 'the agent reads the design back from what rendered.'
    : `Learning a theme from ${target} — read in place on this machine. `
      + 'The file is not uploaded.';
}

/** The service's own sentence, unwrapped from the client's `API <status>: ` framing so
 *  the refusal a human reads is the refusal the guard wrote (§4.6). */
export function serviceReason(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.replace(/^API \d{3}: /, '');
}

/** §3.3: an error with no next action is banned. The service's named fix wins whenever
 *  it gave one; otherwise the next action is the other way to learn the same theme. */
export function learnFix(kind: LearnKind, e: unknown): string {
  if (e instanceof ServiceHintError) return e.hint;
  return kind === 'url'
    ? 'Use a public http(s) address the service can reach, or learn the theme from a '
      + 'PDF or image instead — those are read from this machine.'
    : 'Check the path exists and the service can read it, then submit it again.';
}

export interface LearnArgs {
  projectId: string;
  docId: string;
  kind: LearnKind;
  value: string;
}

export type LearnOutcome =
  | { ok: true; themeId: string }
  | { ok: false; reason: string };

/**
 * Submit one source for the agent to learn, and put the whole of it in the conversation.
 * Never throws: a refusal is a message (§3.3 actionable), because the document is
 * untouched either way and a refused theme is exactly the kind of thing a reader
 * scrolling back needs to find.
 */
export async function learnThemeFromThread(
  { projectId, docId, kind, value }: LearnArgs,
): Promise<LearnOutcome> {
  const key = threadKey(projectId, docId);
  const store = useDocThreadStore.getState();
  store.addUserMsg(key, nextMsgId(), learnAsk(kind, value));
  store.addNarration(key, learnSubject(kind, value));
  try {
    const res = await learnTheme(projectId, learnBody(kind, value));
    // The bridge's own line wins where it wrote one — it knows what the agent is doing
    // with this source; we only know that it took it.
    store.addNarration(key, res.message ?? `Queued “${res.theme_id}” — it joins the theme `
      + 'library once the agent has read the design.');
    return { ok: true, themeId: res.theme_id };
  } catch (e: unknown) {
    const reason = serviceReason(e);
    store.addActionable(
      key,
      `The service refused to learn from ${value.trim()}: ${reason}`,
      learnFix(kind, e),
    );
    return { ok: false, reason };
  }
}

// ── Sources attach (§4.9) ────────────────────────────────────────────────────

/** The ask, as the message it is (§2.3). */
export function sourceAsk(path: string): string {
  return `Use ${path.trim()} as reference.`;
}

/** §3.3 informative, and §4.9's headline guarantee stated where the user can read it. */
export function sourceSubject(path: string): string {
  return `Attaching ${path.trim()} as a reference source — the service reads it in place `
    + 'on this machine. Nothing is uploaded.';
}

/** Where the attach got to, in the service's terms. Every branch names its subject. */
export function sourceStatusLine(entry: SourceEntry): string {
  return entry.status === 'indexed'
    ? `“${entry.path}” is indexed — the next generation can use what is in it.`
    : `“${entry.path}” is being indexed on the service — it becomes usable as it lands.`;
}

export type AttachOutcome =
  | { ok: true; entry: SourceEntry }
  | { ok: false; reason: string };

/**
 * Attach one reference path. The chip is the caller's to add and it is added only on
 * success — a chip for a folder the service could not read would claim context the
 * generation does not actually have.
 */
export async function attachSourceFromThread(
  { projectId, docId, path }: { projectId: string; docId: string; path: string },
): Promise<AttachOutcome> {
  const key = threadKey(projectId, docId);
  const store = useDocThreadStore.getState();
  store.addUserMsg(key, nextMsgId(), sourceAsk(path));
  store.addNarration(key, sourceSubject(path));
  try {
    const entry = await attachSource(projectId, docId, path.trim());
    if (entry.status === 'error') {
      store.addActionable(
        key,
        `“${entry.path}” was attached but could not be read, so nothing in it is available `
        + 'to the next generation.',
        'Check the path exists and the service can read it, then attach it again.',
      );
      return { ok: false, reason: 'the service could not read it' };
    }
    store.addNarration(key, sourceStatusLine(entry));
    return { ok: true, entry };
  } catch (e: unknown) {
    const reason = serviceReason(e);
    store.addActionable(
      key,
      `${path.trim()} was not attached: ${reason}`,
      e instanceof ServiceHintError ? e.hint
        : 'Check the path exists and the service can read it, then attach it again.',
    );
    return { ok: false, reason };
  }
}
