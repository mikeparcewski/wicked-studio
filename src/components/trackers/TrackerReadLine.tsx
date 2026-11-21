import { sourcesPath } from '../../api/sources.js';
import { agentAccessOf, type SourceAgentAccess } from '../../api/sourceAgents.js';
import { usePmSources } from './TrackerParts.js';

/** "acme-jira", "acme-jira and acme-gh", "a, b and c". */
function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type OffWhy = 'turned-off' | 'read' | 'project';

export type TrackerRead =
  /** The tools' switches are still being read: no claim yet. */
  | { kind: 'reading' }
  /** A linked tool's switches could not be read (or the tool is gone): no claim either way. */
  | { kind: 'unknown' }
  /**
   * These tools keep helpers from reading issues: `turned-off` = the tool itself is turned off; `read` = its see or
   * "read issues" switch is off; `project` = both are on but it names no project. The other linked tools may be
   * readable: the words name these only.
   */
  | { kind: 'off'; tools: Array<{ name: string; why: OffWhy }> }
  /** Every tool lets helpers read issues, some only in the projects they name. */
  | { kind: 'some'; tools: string[] }
  | { kind: 'all' };

/**
 * (studio#1013) Whether jobs on a repository can read its linked trackers, from each linked tool's Helpers switches
 * (`McpServer.agents`, the same record the tool's page shows). A link never turns a switch on (Q-PM1), so a tracker
 * linked to a tool whose "Helpers can read issues" is off (or a tool turned off: crew's PM gate refuses a disabled
 * server first) is linked but unread. Any tool off wins; then any tool
 * studio can't read, or no tool named at all (no claim); then tools limited to named projects; else every job can.
 */
export function trackerReadOf(linked: readonly string[], tools: ReadonlyArray<{ name: string; access: SourceAgentAccess | null; enabled?: boolean }> | null): TrackerRead {
  if (tools === null) return { kind: 'reading' };
  const names = [...new Set(linked)];
  if (names.length === 0) return { kind: 'unknown' };
  const off: Array<{ name: string; why: OffWhy }> = [];
  const some: string[] = [];
  let unknown = false;
  for (const name of names) {
    const tool = tools.find((t) => t.name === name);
    if (tool?.enabled === false) { off.push({ name, why: 'turned-off' }); continue; }
    const a = tool?.access ?? null;
    if (a === null) { unknown = true; continue; }
    if (!a.see || !a.query) off.push({ name, why: 'read' });
    else if (!a.everyProject && a.projects.length === 0) off.push({ name, why: 'project' });
    else if (!a.everyProject) some.push(name);
  }
  if (off.length > 0) return { kind: 'off', tools: off };
  if (unknown) return { kind: 'unknown' };
  if (some.length > 0) return { kind: 'some', tools: some };
  return { kind: 'all' };
}

/** Why helpers can't read issues from the tools named, when they share one reason. */
function offWhy(tools: ReadonlyArray<{ why: OffWhy }>): string {
  if (tools.every((t) => t.why === 'turned-off')) return tools.length === 1 ? ': it is turned off' : ': they are turned off';
  if (tools.every((t) => t.why === 'read')) return ': reading issues is off there';
  if (tools.every((t) => t.why === 'project')) return tools.length === 1 ? ': it names no project yet' : ': they name no project yet';
  return '';
}

/** The repository Overview's Trackers line: how many are linked, and whether jobs here can read them. */
export function TrackerReadLine({ count, sources, navigate }: { count: number; sources: readonly string[]; navigate: (path: string) => void }): React.ReactElement {
  // Read again when the window comes back: the switches may have changed on Data sources in another tab.
  const { sources: pm, error } = usePmSources(count > 0, { followFocus: true });
  // A read that failed claims nothing (never "reading" for good).
  const tools = error !== null ? [] : pm === null ? null : pm.map((s) => ({ name: s.name, access: agentAccessOf(s.server as { agents?: unknown }), enabled: (s.server as { enabled?: unknown }).enabled !== false }));
  const read = count === 0 ? null : trackerReadOf(sources, tools);
  const it = count === 1 ? 'it' : 'them';
  const open = (tool: string): React.ReactElement => (
    <a key={tool} className="wk-link" style={{ whiteSpace: 'nowrap' }} data-testid="repo-overview-trackers-tool" href={sourcesPath(tool)} onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); navigate(sourcesPath(tool)); }}>Open {tool}</a>
  );
  if (read === null) return <p className="wk-rp-note" data-testid="repo-overview-trackers-read" data-read="none">No tracker is linked yet.</p>;
  return (
    <p className="wk-rp-note" data-testid="repo-overview-trackers-read" data-read={read.kind}>
      <b>{count} linked.</b>{' '}
      {read.kind === 'all' && <>Jobs on this repository can read {it}.</>}
      {read.kind === 'some' && <>Jobs can read {it} in the projects {andList(read.tools)} {read.tools.length === 1 ? 'allows' : 'allow'}.</>}
      {read.kind === 'unknown' && <>Whether jobs can read {it} could not be checked just now.</>}
      {read.kind === 'off' && (
        <>
          Helpers can’t read issues from {andList(read.tools.map((t) => t.name))} yet{offWhy(read.tools)}.{' '}
          {read.tools.map((t, i) => <span key={t.name}>{i > 0 ? ' · ' : ''}{open(t.name)}</span>)}
        </>
      )}
    </p>
  );
}
