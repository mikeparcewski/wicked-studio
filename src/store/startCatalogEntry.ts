import { UNFILED_MOUNT } from '../api/interactive.js';
import { everythingPath, isDocFormat, madeKindForFormat } from '../board/everythingModel.js';
import { entryOffered, type CatalogEntry } from '../board/workflowCatalog.js';
import { registerRepoPath } from '../hooks/ambientProject.js';
import { openChatFlow } from './chatFlow.js';
import { seedNewDocumentBrief } from './newDocumentSeed.js';

/**
 * WHAT A PICK OF A CATALOG ENTRY DOES (slash-catalog, operator 2026-11-04): one handler for New job's
 * cards and every box's `/` rows, so a pick starts the same thing wherever it is made
 * (wf-catalog WIRE v1 `launch.kind`):
 *
 *  - `run`, `demo`, `compose`: the job is shaped in New job (its next step there; from a box, New job
 *    opens on it). The caller says how (`shape`).
 *  - `document`: New document on its list, in the format the card names, the words as its brief.
 *  - `chat`: a new chat on its own page, the words as its first message.
 *  - `repo` (ux-tonight): Add a repository, in the project the pick is made in; registering it onboards it.
 *  - `app` (ux-tonight): a new app by chat, which the caller starts in its chat like a run (`shape`).
 *  - `none`, or an entry that is not ready (coming soon, not available): nothing starts.
 */
export interface StartEntryContext {
  /** The project the pick is made in (a box's `@project` chip, New job's project); null = none. */
  projectId: string | null;
  /** The words the entry starts with: a run's intent, a document's brief, a chat's first message. */
  intent: string;
  navigate: (path: string) => void;
  /** A run, Demo video or Draft epics: New job's own next step, or New job opened on the entry. */
  shape: (e: CatalogEntry) => void;
  /** Called before a pick leaves for another surface (New document, a chat): New job closes. */
  leave?: () => void;
}

/** Start an entry. False when it is not offered (nothing happened). */
export function startCatalogEntry(e: CatalogEntry, ctx: StartEntryContext): boolean {
  if (!entryOffered(e)) return false;
  const project = ctx.projectId === null || ctx.projectId === '' || ctx.projectId === UNFILED_MOUNT ? null : ctx.projectId;
  if (e.launchKind === 'chat') {
    ctx.leave?.();
    openChatFlow({ projectId: project, seedText: ctx.intent });
    return true;
  }
  if (e.launchKind === 'repo') {
    ctx.leave?.();
    ctx.navigate(registerRepoPath(project));
    return true;
  }
  if (e.launchKind === 'document') {
    ctx.leave?.();
    const format = isDocFormat(e.docStyle) ? e.docStyle : '';
    seedNewDocumentBrief(ctx.intent);
    ctx.navigate(everythingPath({ tab: 'made', kind: madeKindForFormat(format), ...(project !== null ? { project } : {}), new: 'document', ...(format !== '' ? { format } : {}) }));
    return true;
  }
  ctx.shape(e);
  return true;
}
