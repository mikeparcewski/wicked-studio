import type { SessionView } from '../api/types.js';
import { inProject } from '../interactive/runBinding.js';
import { LIVE_RUN } from '../store/docThread.js';

/**
 * studio#765: what a document with no version yet says, from its DRAFT run — the run crew launched to
 * write it (`interactive-draft`; its declared write root is `<state>/interactive-drafts/<docId>`).
 * Before this, a document whose draft was still running, or had failed, opened on an empty page that
 * said only "The page could not be read (unavailable)".
 *
 *   writing  — the draft run is live: the page is being written; it opens here when it lands.
 *   stopped  — the draft run failed or was cancelled before any version: say so, and why.
 *   landing  — the draft run finished but the list still says no version: re-read it.
 *   none     — no draft run is known for it (the run list does not reach back that far, or none ran).
 */
export type DraftState = 'writing' | 'stopped' | 'landing' | 'none';

/** The run that drafts `docId` in `projectId`: newest live first, else the newest. Pure. */
export function draftRunOf(runs: readonly SessionView[], projectId: string, docId: string): SessionView | null {
  const mine = runs.filter((v) => inProject(v, projectId) && (v.session.extra_write_roots ?? []).some((root) => {
    const parts = root.split(/[\\/]+/).filter((p) => p !== '');
    return parts.length >= 2 && parts[parts.length - 2] === 'interactive-drafts' && parts[parts.length - 1] === docId;
  }));
  const newest = [...mine].sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0));
  return newest.find((v) => LIVE_RUN.has(v.session.status)) ?? newest[0] ?? null;
}

/** The state a version-less document is in, given its draft run (or none). */
export function draftState(run: SessionView | null): DraftState {
  if (run === null) return 'none';
  const st = run.session.status;
  if (LIVE_RUN.has(st)) return 'writing';
  if (st === 'failed' || st === 'cancelled') return 'stopped';
  return 'landing';
}

/** The plain line for each state (the stopped one is followed by the reason). */
export const DRAFT_WORDS: Readonly<Record<DraftState, string>> = {
  writing: 'This page is being written. It opens here when the first version lands.',
  stopped: 'The draft stopped before it wrote a first version.',
  landing: 'The draft finished. Reading its first version…',
  none: 'This page has no version yet, and no helper is writing it.',
};
