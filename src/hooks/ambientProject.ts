import type { AgentSession } from '../api/types.js';
import { modePath } from './useRoute.js';

/**
 * The ONE ambient-project derivation (DES-UX-001 §2.3 rule 1, slice S): every
 * launch entry point — the composer route, the make-picker, the rail's "+"
 * verbs, the palette rows, the repo-register form — derives "which project am
 * I standing in" from HERE, never by hand-rolling its own parse. The review's
 * J5 observation was exactly a hand-rolled entry point resetting to Unfiled.
 *
 * Two spellings of ambience, in precedence order:
 *   1. the project shell's path segment — `/p/:projectId[/...]`;
 *   2. the `?project=<id>` carry — for surfaces that live OUTSIDE the shell
 *      (the flat `/repos/new` register form) but are ENTERED from a project
 *      context: the navigating entry point spells the carry via
 *      `registerRepoPath`, and the form re-derives it from its own URL.
 *
 * `default` (the daemon's synthesized Unfiled bucket) is never ambient — a
 * helper hit there means *no project*, the same exclusion the board applies.
 */
export function ambientProjectId(pathname: string, search = ''): string | null {
  const [, first = '', second = ''] = pathname.split('/');
  const fromPath = first === 'p' && second !== '' ? safeDecode(second) : null;
  const fromSearch = new URLSearchParams(search).get('project');
  const id = fromPath ?? (fromSearch !== null && fromSearch !== '' ? fromSearch : null);
  return id === 'default' ? null : id;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Where a "new run" / "new chat" gesture lands (§2.3 rule 1): inside a project
 * context, the shell's pre-bound create route (`/p/:id/build/new`, `/p/:id/
 * chat/new` — the slice-B lock); outside one, the flat Unfiled-default forms.
 */
export function launchPath(ambient: string | null, verb: 'build' | 'chat'): string {
  if (ambient !== null) return `${modePath(ambient, verb)}/new`;
  return verb === 'chat' ? '/chat/new' : '/runs/new';
}

/**
 * Where a "register repo" gesture lands: the flat form, carrying the ambient
 * project as `?project=` so the form pre-binds instead of resetting to Unfiled.
 */
export function registerRepoPath(ambient: string | null): string {
  return ambient === null ? '/repos/new' : `/repos/new?project=${encodeURIComponent(ambient)}`;
}

/**
 * The run DTO's own project claim (CREW-UX-2, api-types 0.8.0 — `project_id`
 * echoed from the membership record on BOTH `GET /runs` and `GET /runs/:id`).
 * Three-valued on purpose, matching the wire contract exactly:
 *
 *   string     — filed into that project (daemon truth);
 *   null       — GENUINELY unfiled (the daemon's word, not a failed join);
 *   undefined  — a pre-0.8.0 daemon that never joins: the caller must fall
 *                back to the client-side membership join, never assume unfiled.
 *
 * The synthesized `default` bucket is normalized to `null` — it IS Unfiled.
 */
export function sessionProjectId(s: AgentSession): string | null | undefined {
  const pid = s.project_id;
  if (pid === undefined) return undefined;
  return pid === null || pid === 'default' ? null : pid;
}
