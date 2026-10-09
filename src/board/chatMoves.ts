import { sessionPath } from './sessionModel.js';
import { useSessionDrafts } from '../store/sessionDrafts.js';
import { addAboutChip } from '../store/composerChips.js';

/**
 * S16a-4e (DES-STUDIO-REBUILD-001 §4.1, §5.4; Amendment 5 §1): a chat IS its session.
 *
 * | Old address               | Lands on                                                    |
 * |---------------------------|-------------------------------------------------------------|
 * | `/chat/:id`               | `/s/:id` (search and hash kept)                             |
 * | `/p/:pid/chat/:run`       | `/s/run%3A:run` (search and hash kept)                      |
 * | `/chat/new`               | `/` — the Desk composer, focused; nothing is sent           |
 * | `/p/:pid/chat[/new]`      | `/` — the Desk composer with the project's `@` chip         |
 * | `/p/:pid/build/new`       | the same (S16a-4f: the composer launches; nothing is sent)  |
 */

function decode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** The new-chat forms — and S16a-4f's `/p/:pid/build/new`, the composer being where a build
 *  starts too: `{ projectId }` (null for `/chat/new`), else null. */
export function newChatOf(pathname: string): { projectId: string | null } | null {
  const segs = pathname.split('/');
  const [, first = '', second = '', third = '', fourth = ''] = segs;
  if (first === 'chat' && second === 'new' && segs.slice(3).every((x) => x === '')) return { projectId: null };
  if (first === 'p' && second !== '' && ((third === 'chat' && fourth === '') || ((third === 'chat' || third === 'build') && fourth === 'new')) && segs.slice(5).every((x) => x === '')) {
    return { projectId: decode(second) };
  }
  return null;
}

/** The chat / chat-run moves to a session, or null. */
export function chatSessionMove(pathname: string, search: string, hash: string): string | null {
  const segs = pathname.split('/');
  const [, first = '', second = '', third = '', fourth = ''] = segs;
  if (first === 'chat' && second !== '' && second !== 'new' && segs.slice(3).every((x) => x === '')) {
    return `${sessionPath(decode(second))}${search}${hash}`;
  }
  if (first === 'p' && second !== '' && third === 'chat' && fourth !== '' && fourth !== 'new' && segs.slice(5).every((x) => x === '')) {
    return `${sessionPath(`run:${decode(fourth)}`)}${search}${hash}`;
  }
  return null;
}

/** A new chat starts in the Desk composer: focused, with the project's `@` chip; nothing is sent. */
export function seedNewChat(projectId: string | null, projectName: string | null): void {
  if (projectId !== null && projectId !== 'default') {
    addAboutChip('desk', { kind: 'project', key: `project:${projectId}`, label: projectName ?? projectId, projectId });
  }
  const draft = useSessionDrafts.getState().drafts['desk'];
  if (draft === undefined) useSessionDrafts.getState().setDraft('desk', '');
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLTextAreaElement>('[data-testid="composer"][data-composer="desk"] textarea');
    el?.focus();
  });
}
