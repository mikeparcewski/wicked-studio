import type { SessionView } from '../api/types.js';
import { docRunOf, inProject, isDocRun } from '../interactive/runBinding.js';
import { artifactKey } from '../store/artifactSizes.js';
import { artifactPath } from './artifactAddress.js';
import { everythingPath } from './everythingModel.js';
import { sessionIdOf, sessionPath } from './sessionModel.js';

/**
 * S16a-4c (DES-STUDIO-REBUILD-001 §5.4, Amendment 5 §1-2): a made thing opens in the session that
 * made it — a video in its run's session (`/s/<session>/a/<demo-video key>?size=full`, an unknown
 * run `/s/run%3A<run>`), a document in its bound run's session (live run first, else the newest,
 * else the newest archived), else on the project's Made list (`…&open=<doc>`). X1 retired the
 * project-shell addresses this once redirected (`/p/:pid/document|video[/…]`).
 */

/** A document's run when no live / unarchived one is bound: the newest ARCHIVED bound run. */
function archivedDocRun(runs: readonly SessionView[], pid: string, doc: string): SessionView | null {
  const mine = runs.filter((v) => v.session.archived_at != null && inProject(v, pid) && isDocRun(v, doc));
  return [...mine].sort((a, b) => (b.session.created_at ?? 0) - (a.session.created_at ?? 0))[0] ?? null;
}

/** Where a made thing opens (the run list read): its session's artifact, or the Made list. */
export function madeOpenAddress(kind: 'document' | 'video', pid: string, item: string, runs: readonly SessionView[], runChatId: boolean, version: number | null = null): string {
  if (kind === 'video') {
    const v = runs.find((r) => r.session.id === item);
    return v === undefined ? sessionPath(`run:${item}`) : artifactPath(sessionIdOf(v, runChatId), artifactKey('run', 'demo-video', item), 'full');
  }
  const run = docRunOf(runs, pid, item) ?? archivedDocRun(runs, pid, item);
  return run === null
    // studio#768: All — a page or a deck opened under the Documents filter read "No documents yet".
    ? everythingPath({ tab: 'made', kind: 'all', project: pid, open: item })
    : artifactPath(sessionIdOf(run, runChatId), artifactKey(pid, item, run.session.id), 'full', version);
}
