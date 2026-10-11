import { useSessionDrafts } from '../store/sessionDrafts.js';
import { addAboutChip } from '../store/composerChips.js';

/**
 * S16a-4e (DES-STUDIO-REBUILD-001 §4.1, §5.4; Amendment 5 §1): a chat IS its session, and a new one
 * starts in the Desk composer. (X1 retired the `/chat/…` and `/p/:pid/chat…` addresses that once
 * redirected here.)
 */
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
