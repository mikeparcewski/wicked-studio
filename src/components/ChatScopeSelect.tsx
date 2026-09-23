import type { ChatOpenBody, ChatScope, Project, RepoEntry } from '../api/types.js';

/**
 * The Ask dock's scope control (studio#323 R4) — the same vocabulary as GroupChat's chips:
 * `system` (the platform itself: no repository), `everything` (every registered repo), a
 * `project:<id>`, or a `repo:<id>`. The scope is decided at OPEN, so the control is shown only
 * before the first send; afterwards the dock states the scope the daemon resolved.
 */
export type AskScopeChoice = 'system' | 'everything' | `project:${string}` | `repo:${string}`;

/** The default: the project the route is in, else everything. */
export function defaultAskScope(routeProjectId: string | null): AskScopeChoice {
  return routeProjectId !== null ? `project:${routeProjectId}` : 'everything';
}

/**
 * The open-body fields a choice puts on `POST /chats`. `system` / `everything` NAME their kind
 * (`scopeKind`, api-types 0.39.0); a project or repo keeps the legacy body (`projectId` /
 * `repoRefs`) every scoped daemon already accepts and resolves the same way.
 */
export function askScopeOpenFields(choice: AskScopeChoice): Pick<ChatOpenBody, 'scopeKind' | 'projectId' | 'repoRefs'> {
  if (choice === 'system' || choice === 'everything') return { scopeKind: choice };
  if (choice.startsWith('project:')) return { projectId: choice.slice('project:'.length) };
  return { repoRefs: [choice.slice('repo:'.length)] };
}

/** Is the chat SCOPED (held to read-only repository roots)? Only `system` reads none. */
export function askScopeIsScoped(choice: AskScopeChoice): boolean {
  return choice !== 'system';
}

/** One line for a resolved scope — what the dock header states once the chat is open. */
export function describeResolvedScope(scope: ChatScope | null | undefined): string {
  if (scope === null || scope === undefined) return 'scope: not stated by the daemon';
  const n = scope.repos.length;
  const repos = `${n} repo${n === 1 ? '' : 's'}`;
  switch (scope.kind) {
    case 'system':
      return 'scope: system — the platform itself, no repositories';
    case 'everything':
      return `scope: everything · ${repos}`;
    case 'project':
      return `scope: project${scope.projectId !== undefined ? ` ${scope.projectId}` : ''} · ${repos}`;
    case 'repos':
      return `scope: ${scope.repos.map((r) => r.name).join(', ') || repos}`;
    default:
      return 'scope: unscoped — no repositories';
  }
}

export function ChatScopeSelect({ value, onChange, projects, repos }: {
  value: AskScopeChoice;
  onChange: (next: AskScopeChoice) => void;
  projects: readonly Pick<Project, 'id' | 'name'>[];
  repos: readonly Pick<RepoEntry, 'id' | 'name'>[];
}): React.ReactElement {
  // A default project the store has not loaded (or does not list) is still offered by id, so the
  // select never shows a value it has no option for.
  const valueProject = value.startsWith('project:') ? value.slice('project:'.length) : null;
  const listed = valueProject === null || projects.some((p) => p.id === valueProject);
  return (
    <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--ink-dim)' }}>
      <span className="font-mono uppercase tracking-widest text-[10px]">Scope</span>
      <select
        data-testid="ask-scope"
        aria-label="What the agents can read"
        value={value}
        onChange={(e) => onChange(e.target.value as AskScopeChoice)}
        className="rounded px-1 py-0.5 text-[11px]"
        style={{ background: 'var(--surface-raised)', color: 'var(--ink-high)', border: '1px solid var(--surface-overlay)' }}
      >
        <option value="system">System — the platform itself</option>
        <option value="everything">Everything — every registered repo</option>
        {!listed && <option value={value}>{`Project · ${valueProject}`}</option>}
        {projects.filter((p) => p.id !== 'default').map((p) => (
          <option key={`p-${p.id}`} value={`project:${p.id}`}>{`Project · ${p.name}`}</option>
        ))}
        {repos.map((r) => (
          <option key={`r-${r.id}`} value={`repo:${r.id}`}>{`Repo · ${r.name}`}</option>
        ))}
      </select>
    </label>
  );
}
