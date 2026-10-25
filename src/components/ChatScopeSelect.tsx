import type { ChatScope, Project } from '../api/types.js';

/**
 * The words for a chat's RESOLVED scope (studio#323 R4, studio#789) — what the system chat's header
 * states once the chat is open. The scope CHOICE is the scope chips now (DES-SYSTEM-CHAT §6,
 * `board/chatScopes.ts`); the dropdown that lived here is gone.
 */

/**
 * One line for a resolved scope — what the dock header states in plain words once the chat is
 * open (studio#789). Returns `""` when the daemon did not state a scope so the header omits the
 * scope suffix entirely.
 */
export function describeResolvedScope(
  scope: ChatScope | null | undefined,
  names?: { projects?: readonly Pick<Project, 'id' | 'name'>[] },
): string {
  if (scope === null || scope === undefined) return '';
  const n = scope.repos.length;
  const repos = n === 0 ? 'no repositories' : `${n} repo${n === 1 ? '' : 's'}`;
  switch (scope.kind) {
    case 'system':
      return 'the platform itself';
    case 'everything':
      return `every repository · ${repos}`;
    case 'project': {
      const name =
        scope.projectId !== undefined
          ? names?.projects?.find((p) => p.id === scope.projectId)?.name?.trim()
          : undefined;
      return `${name !== undefined && name !== '' ? name : 'a project'} · ${repos}`;
    }
    case 'repos':
      return scope.repos.map((r) => r.name).join(', ') || repos;
    default:
      return 'no repositories';
  }
}
