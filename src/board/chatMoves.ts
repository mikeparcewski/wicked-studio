import { openAskDock } from '../store/askDock.js';

/**
 * S16a-4e (DES-STUDIO-REBUILD-001 §4.1, §5.4; Amendment 5 §1): a chat IS its session. Concept A
 * (DES-frontdoor, 2026-10-12): the Desk has no composer any more, so a new chat opens the one real
 * chat surface, the Ask dock — a fresh chat scoped to the project when one is named; nothing is sent.
 */
export function seedNewChat(projectId: string | null, _projectName: string | null = null): void {
  openAskDock({ projectId: projectId !== null && projectId !== 'default' ? projectId : null });
}
