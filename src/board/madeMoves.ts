import type { SessionView } from '../api/types.js';
import { docRunOf, inProject, isDocRun } from '../interactive/runBinding.js';
import { artifactKey } from '../store/artifactSizes.js';
import { artifactPath, versionOf } from './artifactAddress.js';
import { everythingPath } from './everythingModel.js';
import { sessionIdOf, sessionPath } from './sessionModel.js';

/**
 * S16a-4c (DES-STUDIO-REBUILD-001 §5.4, Amendment 5 §1-2): a made thing opens in the session that
 * made it. The project shell's document and video addresses MOVE:
 *
 * | Old address                          | Lands on                                                          |
 * |--------------------------------------|-------------------------------------------------------------------|
 * | `/p/:pid/video/:run`                 | `/s/<run's session>/a/<demo-video key>?size=full` (an unknown run: `/s/run%3A<run>`) |
 * | `/p/:pid/document/:doc[?v=N]`        | `/s/<bound run's session>/a/<doc key>?size=full[&v=N]` (live run first, else the newest, else the newest archived) |
 * | `/p/:pid/document/:doc` (no run)     | `/everything?tab=made&kind=documents&project=:pid&open=:doc`      |
 * | `/p/:pid/document[/new]`             | `/everything?tab=made&kind=documents&project=:pid`               |
 * | `/p/:pid/video[/new]`                | `/everything?tab=made&kind=videos&project=:pid`                  |
 */

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The shell's document / video address split, or null for any other address. */
export function madeAddress(pathname: string): { pid: string; mode: 'document' | 'video'; item: string | null } | null {
  const segs = pathname.split('/');
  const [, first = '', pid = '', mode = '', item = ''] = segs;
  if (first !== 'p' || pid === '' || (mode !== 'document' && mode !== 'video')) return null;
  if (segs.slice(5).some((x) => x !== '')) return null;
  return { pid: decode(pid), mode, item: item === '' || item === 'new' ? null : decode(item) };
}

/** Moves that need no run list (the bare and `/new` forms), or null. */
export function staticMadeMove(pathname: string): string | null {
  const a = madeAddress(pathname);
  if (a === null || a.item !== null) return null;
  return everythingPath({ tab: 'made', kind: a.mode === 'document' ? 'documents' : 'videos', project: a.pid });
}

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
    ? everythingPath({ tab: 'made', kind: 'documents', project: pid, open: item })
    : artifactPath(sessionIdOf(run, runChatId), artifactKey(pid, item, run.session.id), 'full', version);
}

/** The run-dependent moves (a named document or video), once the run list is read; else null. */
export function runMadeMove(pathname: string, search: string, runs: readonly SessionView[], runChatId: boolean): string | null {
  const a = madeAddress(pathname);
  if (a === null || a.item === null) return null;
  return madeOpenAddress(a.mode, a.pid, a.item, runs, runChatId, a.mode === 'document' ? versionOf(search) : null);
}
