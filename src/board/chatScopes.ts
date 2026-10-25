import type { ChatOpenBody } from '../api/types.js';

/**
 * "WHAT THE CHAT CAN SEE" (DES-SYSTEM-CHAT §6) — the system chat's scope chips, pure.
 *
 * Two kinds of chip, one rule: the request carries EXACTLY the chips that are on.
 *  - Wire chips (Project, Repo, All repos) decide the chat's read roots. They become the existing
 *    `POST /chats` scope fields (`scopeKind` / `projectId` / `repoRefs` — the scope wire is reused,
 *    nothing new on it), so they are fixed once the chat opens: an open chat's scope cannot change.
 *  - Context chips (This page, Memory, Steering, Recent runs, and any run or document added with
 *    + Add) decide what the context pack tells the seat. An unchosen one is named as not chosen, so
 *    the seat does not reach for it on its own.
 */

export type ScopeChipKind = 'page' | 'project' | 'repo' | 'all-repos' | 'memory' | 'steering' | 'runs' | 'run' | 'doc';

export interface ScopeChip {
  /** Unique per chip: `page`, `project:<id>`, `repo:<id>`, `run:<id>`, `doc:<project>/<name>`… */
  key: string;
  kind: ScopeChipKind;
  /** What the chip says. */
  label: string;
  /** The project / repo / run id, or a document's name. */
  ref?: string;
  /** A document's project. */
  projectId?: string;
  on: boolean;
  /** Added with + Add: clicking it removes it (a default chip toggles instead). */
  added?: boolean;
}

/** The chips whose referent decides the read roots (fixed once the chat opens). */
export const WIRE_KINDS: ReadonlySet<ScopeChipKind> = new Set(['project', 'repo', 'all-repos']);

export interface ScopeDefaultsInput {
  project: { id: string; name: string } | null;
  repo: { id: string; name: string } | null;
}

/**
 * The page's default chips: This page, its Project and its Repo on; Memory, Steering and Recent runs
 * off. A page with neither a project nor a repo (the Desk, settings pages) gets "All repos" on in their
 * place — what the chat read there before the chips (`everything`).
 */
export function defaultScopeChips({ project, repo }: ScopeDefaultsInput): ScopeChip[] {
  const chips: ScopeChip[] = [{ key: 'page', kind: 'page', label: 'This page', on: true }];
  if (project !== null) chips.push({ key: `project:${project.id}`, kind: 'project', label: project.name, ref: project.id, on: true });
  if (repo !== null) chips.push({ key: `repo:${repo.id}`, kind: 'repo', label: repo.name, ref: repo.id, on: true });
  if (project === null && repo === null) chips.push({ key: 'all-repos', kind: 'all-repos', label: 'All repos', on: true });
  chips.push(
    { key: 'memory', kind: 'memory', label: 'Memory', on: false },
    { key: 'steering', kind: 'steering', label: 'Steering', on: false },
    { key: 'runs', kind: 'runs', label: 'Recent runs', on: false },
  );
  return chips;
}

/** Click a chip: an added one leaves, a default one flips. */
export function clickChip(chips: readonly ScopeChip[], key: string): ScopeChip[] {
  const hit = chips.find((c) => c.key === key);
  if (hit === undefined) return [...chips];
  if (hit.added === true) return chips.filter((c) => c.key !== key);
  return chips.map((c) => (c.key === key ? { ...c, on: !c.on } : c));
}

/** + Add: the chip joins, on. One project at a time (the wire names one), so a new project replaces
 *  the one there; a chip already there is just turned on. */
export function addChip(chips: readonly ScopeChip[], chip: Omit<ScopeChip, 'on' | 'added'>): ScopeChip[] {
  if (chips.some((c) => c.key === chip.key)) return chips.map((c) => (c.key === chip.key ? { ...c, on: true } : c));
  const rest = chip.kind === 'project' ? chips.filter((c) => c.kind !== 'project') : [...chips];
  return [...rest, { ...chip, on: true, added: true }];
}

/** The chips that are on. */
export function chosenChips(chips: readonly ScopeChip[]): ScopeChip[] {
  return chips.filter((c) => c.on);
}

/** How a chip reads in the pack and the hover: "Project · API migration". */
export function chipWords(c: ScopeChip): string {
  switch (c.kind) {
    case 'project': return `Project · ${c.label}`;
    case 'repo': return `Repo · ${c.label}`;
    case 'run': return `Run · ${c.label}`;
    case 'doc': return `Doc · ${c.label}`;
    default: return c.label;
  }
}

/**
 * The `POST /chats` scope fields for the chips that are on (the existing wire, unchanged):
 *  - All repos → `scopeKind: 'everything'`;
 *  - Repo chips → `repoRefs` (with the Project chip's id only when that chip is on: its graph grounds them);
 *  - a Project chip alone → `projectId` (the project's repositories);
 *  - none of them → `scopeKind: 'system'`: no repository at all.
 * `filingProjectId` (the project page the chat was started on) files a System or All-repos chat that
 * names no project (there `projectId` only files; it reads nothing).
 */
export function chipsOpenFields(
  chips: readonly ScopeChip[],
  filingProjectId: string | null = null,
): Pick<ChatOpenBody, 'scopeKind' | 'projectId' | 'repoRefs'> {
  const on = chosenChips(chips);
  const project = on.find((c) => c.kind === 'project')?.ref ?? null;
  const repos = on.filter((c) => c.kind === 'repo' && c.ref !== undefined).map((c) => c.ref!);
  const filed = project ?? filingProjectId;
  const filing = filed !== null ? { projectId: filed } : {};
  if (on.some((c) => c.kind === 'all-repos')) return { scopeKind: 'everything', ...filing };
  // With repos, a `projectId` is not just filing: the PROJECT's graph grounds them. So it rides only
  // when the Project chip is on — a chat the user held to one repo never reads its project's graph.
  if (repos.length > 0) return { repoRefs: repos, ...(project !== null ? { projectId: project } : {}) };
  if (project !== null) return { projectId: project };
  return { scopeKind: 'system', ...filing };
}

/** Whether the chat reads any repository (the seats' SCOPED admission applies). */
export function chipsScoped(chips: readonly ScopeChip[]): boolean {
  return chipsOpenFields(chips).scopeKind !== 'system';
}

/** One chip set's identity: what changed since the last send. */
export function chipsSignature(chips: readonly ScopeChip[]): string {
  return chosenChips(chips).map((c) => c.key).sort().join('|');
}

export interface ScopePackRun { id: string; title: string; status: string }

/**
 * The context pack's scope lines: what the user chose, what they did not, and the referents of the
 * chosen context chips. Only chips that are ON contribute content.
 */
export function scopePackLines(chips: readonly ScopeChip[], recentRuns: readonly ScopePackRun[]): string[] {
  const on = chosenChips(chips);
  const off = chips.filter((c) => !c.on && !WIRE_KINDS.has(c.kind) && c.kind !== 'page');
  const lines = [`can see (chosen by the user): ${on.length === 0 ? 'nothing beyond this message' : on.map(chipWords).join(' · ')}`];
  if (off.length > 0) lines.push(`not chosen — do not consult: ${off.map(chipWords).join(' · ')}`);
  for (const c of on) {
    if (c.kind === 'memory') lines.push('memory: you may recall the operator\'s memories (the estate memory store, via wicked-garden mem recall).');
    if (c.kind === 'steering') lines.push('steering: you may consult the steering rules (estate rules.recall) and their rationale.');
    if (c.kind === 'run' && c.ref !== undefined) lines.push(`run ${c.ref}: ${c.label}`);
    if (c.kind === 'doc') lines.push(`document "${c.label}"${c.projectId !== undefined ? ` in project ${c.projectId}` : ''}`);
  }
  if (on.some((c) => c.kind === 'runs')) {
    lines.push(recentRuns.length === 0
      ? 'recent runs: none in the studio\'s list'
      : `recent runs (newest first): ${recentRuns.map((r) => `${r.title} (${r.id}, ${r.status})`).join(' · ')}`);
  }
  return lines;
}
