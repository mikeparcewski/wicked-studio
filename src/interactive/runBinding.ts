/**
 * Which governed run a document thread is bound to (acceptance finding F-4R2-006).
 *
 * Crew's interactive seams narrate their governed runs over `wicked.interactive.status.posted`
 * frames that carry `document_id` + `message` and NO run id; the bridge's announce history
 * (`GET /d/:doc/api/conversation`) keeps only `{role, text, ts}`. So after a reload the thread
 * could not know a run was still executing until the next heartbeat (≤15 s) — and for that
 * interval the composer read `terminal` over a live run. `GET /runs` carries no doc filter
 * either, but every seam DECLARES the run's own inbox as its write root
 * (`extraWriteRoots: [runDir]`, per-run isolation — crew#313/#314), and that directory is named
 * by the doc:
 *
 *   drafts   <state>/interactive-drafts/<docId>
 *   asks     <state>/interactive-chats/<docId>-m-<sourceMessageId>  |  <docId>-e-<eventId>
 *   edits    <state>/interactive-edits/<docId>-v<version>
 *   demos    <state>/interactive-demos/<docId>[-…]
 *
 * (`safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '-')` over `<docId>:m:<id>` / `<docId>:e:<n>` /
 * `<docId>:v<n>`; the doc grammar is `[a-z0-9-]`, so the `:`→`-` fold is unambiguous per seam.)
 * That is the binding this module reads back: a run is the doc's when one of its write roots
 * sits under an `interactive-*` directory and is named by the doc this way. The match is then
 * narrowed to the thread's project (the DTO's `project_id`, when the daemon joins it).
 */

import { api } from '../api/client.js';
import type { SessionView } from '../api/types.js';
import { LIVE_RUN, threadKey, useDocThreadStore } from '../store/docThread.js';

/** The seams' state-home directories — the parent a doc run's write root sits under. */
const SEAM_DIR = /^interactive-(drafts|chats|edits|demos)$/;

/** Is `base` (a write root's own name) the doc's, under the seams' key grammars? */
function namesDoc(base: string, docId: string): boolean {
  if (base === docId) return true;
  if (!base.startsWith(`${docId}-`)) return false;
  const tail = base.slice(docId.length + 1);
  // `-m-<msg>` / `-e-<n>` (asks), `-v<n>` (edits), or a demo handoff's `-v<n>`-style tail.
  return /^(m-.+|e-.+|v\d+)$/.test(tail);
}

/** True when this run's declared write roots bind it to `docId`. */
export function isDocRun(view: SessionView, docId: string): boolean {
  if (docId === '') return false;
  for (const root of view.session.extra_write_roots ?? []) {
    const parts = root.split(/[\\/]+/).filter((p) => p !== '');
    if (parts.length < 2) continue;
    const base = parts[parts.length - 1] ?? '';
    const parent = parts[parts.length - 2] ?? '';
    if (SEAM_DIR.test(parent) && namesDoc(base, docId)) return true;
  }
  return false;
}

/** Whether a run's filing agrees with the thread's project — an unjoined DTO (no `project_id`)
 *  cannot disagree; the Unfiled mount matches unfiled runs (`null` / `'default'`). */
function inProject(view: SessionView, projectId: string): boolean {
  const pid = view.session.project_id;
  if (pid === undefined) return true;
  if (pid === null || pid === 'default') return projectId === 'default';
  return pid === projectId;
}

/**
 * The doc's bound run off the run list, LIVE runs first (daemon order is actionable-first then
 * newest-first, so the first live match is the one executing now), else the newest terminal
 * record; `null` when no run declares this doc.
 */
export function docRunOf(runs: readonly SessionView[], projectId: string, docId: string): SessionView | null {
  const mine = runs.filter((v) => v.session.archived_at == null && inProject(v, projectId) && isDocRun(v, docId));
  return mine.find((v) => LIVE_RUN.has(v.session.status)) ?? mine[0] ?? null;
}

/** Threads whose run binding this session has already read (one `GET /runs` per doc open). */
const restored = new Set<string>();

/** Test seam. */
export function clearRunRestores(): void {
  restored.clear();
}

/**
 * Read the runs wire once for this doc and adopt what it says (F-4R2-006). Never throws: a
 * daemon that cannot list runs leaves the thread exactly as the conversation read left it.
 */
export async function restoreDocRun(projectId: string, docId: string): Promise<void> {
  const key = threadKey(projectId, docId);
  if (restored.has(key)) return;
  restored.add(key);
  let runs: SessionView[];
  try {
    ({ runs } = await api.listRuns());
  } catch {
    restored.delete(key); // nothing learned — the next open may try again
    return;
  }
  const run = docRunOf(runs, projectId, docId);
  if (run !== null) useDocThreadStore.getState().adoptRun(key, run);
}
